"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar, Sticker } from "@/components/Brand";
import { Icon, type IconName } from "@/components/Icon";
import { Button, Field, Modal, Screen, inputCls, useToast } from "@/components/ui";
import { ApiError, UNREACHABLE_MESSAGE, isUnreachable } from "@/lib/api/client";
import { changeAccountConsent } from "@/lib/api/accounts";
import { getMe, login as apiLogin } from "@/lib/api/auth";
import { listHostedLectures, listJoinedLectures } from "@/lib/api/lectures";
import { createInquiry, listInquiries, listNotices, updateMe } from "@/lib/api/me";
import { listMyQuestions } from "@/lib/api/questions";
import { requestDeletion } from "@/lib/api/records";
import { MOCK_PASSWORD, logout, pwValid } from "@/lib/auth";
import { DEMO } from "@/lib/demo";
import { formatSchedule } from "@/lib/join";
import { LEARN_CONSENT_TEXT, archive, inquiries, lectures, me, notices, statusOf } from "@/lib/mock";
import { setDemo, useDemo } from "@/lib/store";

type Sheet = null | "name" | "pw" | "consent" | "notice" | "inquiry" | "reauth" | "leave";

// 탈퇴는 최근 10분 안에 로그인한 상태에서만 할 수 있다
const REAUTH_MS = 10 * 60 * 1000;

// 실제 API에서 불러온 계정 정보 · 숫자
type Account = { userId: string; email: string; stats: [number, number, number]; hasLive: boolean };
type NoticeView = { id: string; title: string; date: string; body: string };
type InquiryView = { id: string; title: string; date: string; answered: boolean; answer: string | null };

// 이벤트 처리 중에 부르는 현재 시각
const now = () => Date.now();

const dateOf = (iso: string) => formatSchedule(iso).date.replace(/ \(.\)$/, "");

// 계정 변경 오류 → 안내 문구 (API-10 · 40 · 43)
function accountError(e: unknown) {
  if (isUnreachable(e) || !(e instanceof ApiError)) return UNREACHABLE_MESSAGE;
  switch (e.code) {
    case "AUTH_INVALID_CREDENTIALS":
      return "현재 비밀번호가 맞지 않아요.";
    case "RATE_LIMITED": {
      const wait = e.retryAfter ? `${Math.max(1, Math.ceil(e.retryAfter / 60))}분 뒤에` : "잠시 후";
      return `비밀번호 확인 횟수를 넘었어요. ${wait} 다시 시도해 주세요.`;
    }
    case "HOSTING_LIVE_SESSION":
      return "진행 중인 강연을 먼저 종료해 주세요.";
    case "VALIDATION_ERROR":
      return "입력한 내용을 다시 확인해 주세요.";
    case "AUTH_REQUIRED":
      return "로그인이 만료됐어요. 다시 로그인해 주세요.";
    case "FORBIDDEN":
      return "이 계정으로는 할 수 없어요.";
    default:
      return "잠시 후 다시 시도해 주세요.";
  }
}

export default function Me() {
  const router = useRouter();
  const toast = useToast();
  const { name, consent, loginAt, signup, endedLectures, startedLectures, deletedArchives, deletedLectures, isAdmin, admin } = useDemo();
  const myArchive = archive.filter((a) => !deletedArchives.includes(a.id));
  const [sheet, setSheet] = useState<Sheet>(null);
  const [draftName, setDraftName] = useState(name);
  const [pw, setPw] = useState({ cur: "", next: "" });
  const [pwError, setPwError] = useState("");
  const [openNotice, setOpenNotice] = useState<string | null>(null);
  const [inq, setInq] = useState({ title: "", body: "" });
  const [reauthPw, setReauthPw] = useState("");
  const [consentBusy, setConsentBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState("");
  const [inqError, setInqError] = useState("");
  const [account, setAccount] = useState<Account | null>(null);
  const [remoteNotices, setRemoteNotices] = useState<NoticeView[] | null>(null);
  const [remoteInquiries, setRemoteInquiries] = useState<InquiryView[] | null>(null);

  // 실제 API: 계정(API-09) · 동의 상태와 숫자(참여 강연 · 내 질문 · 만든 강연)를 서버에서 불러온다
  useEffect(() => {
    if (DEMO) return;
    let stopped = false;
    getMe().then(
      async (u) => {
        if (stopped) return;
        setDemo((st) => ({ name: u.display_name, consent: { ...st.consent, learn: !!u.consents.TRAINING?.granted } }));
        // 숫자는 회원만 (관리자는 강연 · 보관함이 없다). 못 불러와도 화면은 연다
        const count = (p: Promise<{ total_count: number }>) => p.then((r) => r.total_count, () => 0);
        const member = u.role === "MEMBER";
        const [joined, questions, hosted, live] = await Promise.all([
          member ? count(listJoinedLectures()) : 0,
          member ? count(listMyQuestions()) : 0,
          member ? count(listHostedLectures()) : 0,
          member ? count(listHostedLectures("LIVE")) : 0,
        ]);
        if (!stopped) setAccount({ userId: u.user_id, email: u.email, stats: [joined, questions, hosted], hasLive: live > 0 });
      },
      (e) => {
        if (!stopped && e instanceof ApiError && e.code === "AUTH_REQUIRED") router.replace(`/login?next=${encodeURIComponent("/me")}`);
      },
    );
    return () => {
      stopped = true;
    };
  }, [router]);

  // 공지 · 문의는 창을 열 때 불러온다 (API-42 · 44)
  function openSheet(next: Sheet) {
    setSheet(next);
    if (DEMO) return;
    if (next === "notice")
      listNotices().then(
        (r) => setRemoteNotices(r.items.map((n) => ({ id: n.notice_id, title: n.title, date: dateOf(n.created_at), body: n.content }))),
        () => setRemoteNotices([]),
      );
    if (next === "inquiry") loadInquiries();
  }

  function loadInquiries() {
    listInquiries().then(
      (r) => setRemoteInquiries(r.items.map((q) => ({ id: q.inquiry_id, title: q.title, date: dateOf(q.created_at), answered: q.status === "ANSWERED", answer: q.reply }))),
      () => setRemoteInquiries([]),
    );
  }

  // 표시명 변경 (API-10)
  async function saveName() {
    const next = draftName.trim();
    if (!DEMO) {
      setBusy(true);
      setNameError("");
      try {
        await updateMe({ display_name: next });
      } catch (e) {
        setBusy(false);
        return setNameError(accountError(e));
      }
      setBusy(false);
    }
    setDemo({ name: next });
    setSheet(null);
    toast.show("표시명을 바꿨어요", "mint");
  }

  // 비밀번호 변경 (API-10). 다른 기기의 로그인은 모두 끊긴다
  async function savePassword() {
    if (!pwValid(pw.next)) return setPwError("새 비밀번호 규칙을 확인해 주세요.");
    if (DEMO) {
      if (pw.cur !== MOCK_PASSWORD) return setPwError("현재 비밀번호가 맞지 않아요.");
    } else {
      setBusy(true);
      try {
        await updateMe({ current_password: pw.cur, new_password: pw.next });
      } catch (e) {
        setBusy(false);
        return setPwError(accountError(e));
      }
      setBusy(false);
      setDemo({ loginAt: now() });
    }
    setPwError("");
    setPw({ cur: "", next: "" });
    setSheet(null);
    toast.show(DEMO ? "비밀번호를 바꿨어요" : "비밀번호를 바꿨어요. 다른 기기의 로그인은 모두 끊었어요", "mint");
  }

  // 1:1 문의 (API-43)
  async function sendInquiry() {
    if (!DEMO) {
      setBusy(true);
      setInqError("");
      try {
        await createInquiry(inq.title.trim(), inq.body.trim());
      } catch (e) {
        setBusy(false);
        return setInqError(accountError(e));
      }
      setBusy(false);
    }
    setInq({ title: "", body: "" });
    setSheet(null);
    toast.show("문의를 보냈어요. 답변이 오면 알려드릴게요", "mint");
  }

  // 탈퇴 전 재로그인 (API-04). 서버는 로그인한 지 10분이 넘은 세션의 탈퇴를 막는다
  async function reauth() {
    if (DEMO) {
      if (reauthPw !== (signup?.verified ? signup.pw : MOCK_PASSWORD)) return setReauthError("비밀번호가 맞지 않아요.");
    } else {
      setBusy(true);
      try {
        await apiLogin(account?.email ?? "", reauthPw);
      } catch (e) {
        setBusy(false);
        return setReauthError(accountError(e) === "현재 비밀번호가 맞지 않아요." ? "비밀번호가 맞지 않아요." : accountError(e));
      }
      setBusy(false);
    }
    setDemo({ authed: true, loginAt: now() });
    setReauthPw("");
    setReauthError("");
    setSheet("leave");
  }

  // 탈퇴 접수 (API-40 ACCOUNT). 접수 즉시 로그인이 끊기므로 진행 상태는 묻지 않고 처음 화면으로 보낸다 (N2)
  async function leave() {
    if (!DEMO) {
      setBusy(true);
      try {
        await requestDeletion("ACCOUNT", account?.userId ?? "");
      } catch (e) {
        setBusy(false);
        if (e instanceof ApiError && e.code === "RECENT_LOGIN_REQUIRED") return setSheet("reauth");
        return toast.show(accountError(e), "coral");
      }
      setSheet(null);
      await logout();
      setDemo({ authed: false, loginAt: 0, isAdmin: false });
      toast.show("탈퇴가 접수되었어요. 그동안 이용해 주셔서 고마워요");
      return setTimeout(() => router.push("/"), 1200);
    }
    setDemo({ authed: false, loginAt: 0 });
    router.push("/");
  }

  // 학습 활용(TRAINING) 동의 바꾸기. 실제 API는 API-11로 저장한다
  async function toggleLearn() {
    const next = !consent.learn;
    if (!DEMO) {
      setConsentBusy(true);
      try {
        await changeAccountConsent("TRAINING", next);
      } catch {
        setConsentBusy(false);
        return toast.show("동의 상태를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.", "coral");
      }
      setConsentBusy(false);
    }
    setDemo({ consent: { ...consent, learn: next } });
    toast.show(next ? "익명 활용에 동의했어요" : "익명 활용 동의를 철회했어요", "mint");
  }
  const [reauthError, setReauthError] = useState("");
  const hasLive = DEMO ? lectures.some((l) => statusOf(l, endedLectures, startedLectures) === "live") : !!account?.hasLive;
  const noticeList: NoticeView[] = DEMO ? notices.map((n) => ({ id: n.id, title: n.title, date: n.date, body: n.body })) : (remoteNotices ?? []);
  const inquiryList: InquiryView[] = DEMO ? inquiries.map((q) => ({ id: q.id, title: q.title, date: q.date, answered: true, answer: q.answer })) : (remoteInquiries ?? []);
  const stats: [number, number, number] = DEMO
    ? [myArchive.length, myArchive.reduce((n, a) => n + a.myQuestions.length, 0), lectures.filter((l) => !deletedLectures.includes(l.id)).length]
    : (account?.stats ?? [0, 0, 0]);

  const menu: { icon: IconName; label: string; sheet: Sheet; badge?: string }[] = [
    { icon: "pen", label: "표시명 변경", sheet: "name" },
    { icon: "lock", label: "비밀번호 변경", sheet: "pw" },
    { icon: "shield", label: "학습 활용 동의", sheet: "consent" },
    { icon: "megaphone", label: "공지사항", sheet: "notice", badge: DEMO ? "N" : undefined },
    { icon: "chat", label: "1:1 문의", sheet: "inquiry" },
  ];

  return (
    <Screen nav>
      {toast.node}
      <div className="flex flex-col items-center px-5 pt-10">
        <div className="relative">
          <Avatar name={name} size={96} className="!ring-4" />
          <button onClick={() => openSheet("name")} className="absolute -right-1 bottom-0 flex h-8 w-8 items-center justify-center rounded-full bg-ink text-white" aria-label="표시명 변경">
            <Icon name="pen" size={14} />
          </button>
        </div>
        <p className="mt-3 text-[26px] font-extrabold tracking-[-0.04em]">{name}</p>
        <p className="text-sm text-muted">{DEMO ? me.email : (account?.email ?? "")}</p>
      </div>

      <div className="px-5">
        <div className="mt-6 grid grid-cols-3 rounded-[24px] bg-white py-4 text-center">
          {[
            [stats[0], "참여 강연"],
            [stats[1], "내 질문"],
            [stats[2], "만든 강연"],
          ].map(([n, l]) => (
            <div key={l}>
              <p className="text-[26px] font-extrabold tracking-[-0.04em]">{n}</p>
              <p className="text-xs text-muted">{l}</p>
            </div>
          ))}
        </div>

        <div className="mt-7 space-y-2">
          {menu.map((m) => (
            <button key={m.label} onClick={() => openSheet(m.sheet)} className="flex w-full items-center gap-3 rounded-[20px] bg-white px-4 py-4 text-left">
              <Icon name={m.icon} size={19} className="text-muted" />
              <span className="flex-1">{m.label}</span>
              {m.badge && <span className="h-2 w-2 rounded-full bg-coral" />}
              <Icon name="right" size={16} className="text-muted" />
            </button>
          ))}
          <button
            onClick={async () => {
              await logout();
              setDemo({ authed: false, loginAt: 0, isAdmin: false });
              setAccount(null);
              router.push("/");
            }}
            className="flex w-full items-center gap-3 rounded-[20px] bg-white px-4 py-4 text-left"
          >
            <Icon name="logout" size={19} className="text-muted" />
            <span className="flex-1">로그아웃</span>
          </button>
        </div>
        {/* 관리자 계정은 탈퇴할 수 없다(서버 403). 관리자로 로그인한 채 /me에 들어와도 버튼을 숨긴다 */}
        {!(isAdmin || admin) && (
          <button onClick={() => setSheet(Date.now() - loginAt < REAUTH_MS ? "leave" : "reauth")} className="mx-auto mb-6 mt-6 block text-sm text-muted underline underline-offset-4">
            회원 탈퇴
          </button>
        )}
      </div>

      {/* 표시명 */}
      <Modal open={sheet === "name"} onClose={() => setSheet(null)} title="표시명 변경">
        <Field label="표시명" hint="강연자 이름과 보관함에 보여요 (50자 이내)" error={nameError}>
          <input className={inputCls} value={draftName} onChange={(e) => setDraftName(e.target.value)} maxLength={50} />
        </Field>
        <Button className="mt-4 w-full" disabled={!draftName.trim() || draftName.trim() === name || busy} onClick={saveName}>
          저장
        </Button>
      </Modal>

      {/* 학습 활용 동의 (API-48) · 계정 단위로 저장돼 다음 입장부터 적용 */}
      <Modal open={sheet === "consent"} onClose={() => setSheet(null)} title="학습 활용 동의">
        <div className="space-y-2">
          <div className="flex gap-3 rounded-[20px] bg-white p-4">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-white">
              <Icon name="check" size={14} stroke={3.2} />
            </span>
            <span>
              <span className="block font-bold">
                질문 · 답변 기록 보관 <span className="font-semibold text-coral-ink">(필수)</span>
              </span>
              <span className="mt-1 block text-sm leading-relaxed text-muted">서비스 이용에 꼭 필요해서 끌 수 없어요. 회원 탈퇴하면 철회돼요.</span>
            </span>
          </div>
          <button
            onClick={toggleLearn}
            disabled={consentBusy}
            role="switch"
            aria-checked={consent.learn}
            className="flex w-full gap-3 rounded-[20px] bg-white p-4 text-left"
          >
            <span className="flex-1">
              <span className="block font-bold">
                AI 개선을 위한 익명 활용 <span className="font-semibold text-muted">(선택)</span>
              </span>
              <span className="mt-1 block text-sm leading-relaxed text-muted">{LEARN_CONSENT_TEXT}</span>
            </span>
            <span className={`mt-0.5 flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors ${consent.learn ? "bg-ink" : "bg-ink/15"}`}>
              <span className={`h-5 w-5 rounded-full bg-white transition-transform ${consent.learn ? "translate-x-5" : ""}`} />
            </span>
          </button>
        </div>
        <p className="mt-3 flex items-start gap-1.5 rounded-2xl bg-honey/30 px-3 py-2.5 text-xs leading-relaxed">
          <Icon name="alert" size={14} className="mt-px shrink-0" />
          동의를 철회해도 이미 학습에 반영된 익명 데이터는 남아요. 철회한 뒤의 질문부터 학습에 쓰지 않아요.
        </p>
      </Modal>

      {/* 비밀번호 */}
      <Modal open={sheet === "pw"} onClose={() => setSheet(null)} title="비밀번호 변경">
        <div className="space-y-3">
          <Field label="현재 비밀번호" error={pwError}>
            <input type="password" className={inputCls} value={pw.cur} onChange={(e) => setPw({ ...pw, cur: e.target.value })} />
          </Field>
          <Field label="새 비밀번호" hint="8~20자, 영문 · 숫자 포함">
            <input type="password" className={inputCls} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </Field>
        </div>
        {!DEMO && <p className="mt-3 text-xs leading-relaxed text-muted">바꾸면 다른 기기에서 로그인한 상태는 모두 끊기고, 이 기기는 그대로 로그인돼 있어요.</p>}
        <Button className="mt-4 w-full" disabled={!pw.cur || !pw.next || busy} onClick={savePassword}>
          {busy ? "바꾸는 중…" : "변경하기"}
        </Button>
      </Modal>

      {/* 공지 */}
      <Modal open={sheet === "notice"} onClose={() => setSheet(null)} title="공지사항">
        {!DEMO && remoteNotices === null && <p className="py-6 text-center text-sm text-muted">불러오는 중…</p>}
        {!DEMO && remoteNotices?.length === 0 && <p className="py-6 text-center text-sm text-muted">아직 공지가 없어요</p>}
        <ul className="space-y-2">
          {noticeList.map((n) => (
            <li key={n.id} className="rounded-[20px] bg-white">
              <button onClick={() => setOpenNotice(openNotice === n.id ? null : n.id)} className="flex w-full items-center gap-2 p-4 text-left">
                <span className="flex-1">
                  <span className="block font-bold">{n.title}</span>
                  <span className="text-xs text-muted">{n.date}</span>
                </span>
                <Icon name="right" size={16} className={`text-muted transition-transform ${openNotice === n.id ? "rotate-90" : ""}`} />
              </button>
              {openNotice === n.id && <p className="animate-rise whitespace-pre-wrap border-t border-line px-4 pb-4 pt-3 text-sm leading-relaxed text-muted">{n.body}</p>}
            </li>
          ))}
        </ul>
      </Modal>

      {/* 문의 */}
      <Modal open={sheet === "inquiry"} onClose={() => setSheet(null)} title="1:1 문의">
        {!DEMO && remoteInquiries === null && <p className="py-4 text-center text-sm text-muted">불러오는 중…</p>}
        <div className="space-y-2">
          {inquiryList.map((q) => (
            <div key={q.id} className="rounded-[20px] bg-white p-4">
              <div className="flex items-center gap-2">
                <p className="flex-1 font-bold">{q.title}</p>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${q.answered ? "bg-mint" : "bg-sand"}`}>{q.answered ? "답변 완료" : "답변 대기"}</span>
              </div>
              <p className="mt-1 text-xs text-muted">{q.date}</p>
              {q.answer && <p className="mt-2 whitespace-pre-wrap rounded-xl bg-paper p-3 text-sm text-muted">↳ {q.answer}</p>}
            </div>
          ))}
        </div>
        <div className="mt-4 space-y-2">
          <input className={inputCls} placeholder="문의 제목 (100자 이내)" value={inq.title} onChange={(e) => setInq({ ...inq, title: e.target.value })} maxLength={100} />
          <textarea className={`${inputCls} resize-none`} rows={3} placeholder="어떤 점이 궁금하신가요? (2,000자 이내)" maxLength={2000} value={inq.body} onChange={(e) => setInq({ ...inq, body: e.target.value })} />
        </div>
        {inqError && <p className="mt-2 text-sm text-[#e5484d]">{inqError}</p>}
        <Button className="mt-3 w-full" disabled={!inq.title.trim() || !inq.body.trim() || busy} onClick={sendInquiry}>
          {busy ? "보내는 중…" : "문의 보내기"}
        </Button>
      </Modal>

      {/* 탈퇴 전 재로그인: 마지막 로그인이 10분보다 오래됐으면 비밀번호를 다시 확인한다 */}
      <Modal
        open={sheet === "reauth"}
        onClose={() => {
          setSheet(null);
          setReauthPw("");
          setReauthError("");
        }}
        title="다시 로그인해 주세요"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void reauth();
          }}
        >
          <p className="text-sm leading-relaxed text-muted">탈퇴는 최근 10분 안에 로그인한 상태에서만 할 수 있어요. 본인 확인을 위해 비밀번호를 입력해 주세요.</p>
          <div className="mt-4 space-y-3">
            <Field label="이메일">
              <input className={`${inputCls} text-muted`} value={DEMO ? (signup?.verified ? signup.email : me.email) : (account?.email ?? "")} readOnly />
            </Field>
            <Field label="비밀번호" error={reauthError}>
              <input type="password" className={inputCls} value={reauthPw} onChange={(e) => setReauthPw(e.target.value)} autoFocus />
            </Field>
          </div>
          <Button type="submit" className="mt-5 w-full" disabled={!reauthPw || busy}>
            로그인하고 계속
          </Button>
        </form>
      </Modal>

      {/* 탈퇴 */}
      <Modal open={sheet === "leave"} onClose={() => setSheet(null)}>
        <div className="flex flex-col items-center text-center">
          <Sticker size={56} rotate={-8}>
            🥲
          </Sticker>
          <p className="mt-4 text-[22px] font-extrabold tracking-[-0.04em]">정말 떠나시나요?</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">탈퇴하면 내 질문 · 답변 · 요약 노트와 내가 만든 강연 데이터가 모두 지워지고 되돌릴 수 없어요.</p>
          {hasLive && (
            <p className="mt-3 flex items-center gap-1.5 rounded-2xl bg-coral/20 px-3 py-2.5 text-left text-sm">
              <Icon name="alert" size={16} className="shrink-0" />
              진행 중인 강연을 먼저 종료해 주세요
            </p>
          )}
        </div>
        <div className="mt-6 flex gap-2">
          <Button variant="soft" className="flex-1" onClick={() => setSheet(null)}>
            더 써볼게요
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            disabled={hasLive || busy}
            onClick={leave}
          >
            {busy ? "접수하는 중…" : "탈퇴하기"}
          </Button>
        </div>
      </Modal>
    </Screen>
  );
}
