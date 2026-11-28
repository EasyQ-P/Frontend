"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Bubble, Sticker } from "@/components/Brand";
import { Icon } from "@/components/Icon";
import { QrScanner, type ScanError } from "@/components/QrScanner";
import { Button, PageTitle, Screen, StatusPill, TopBar, inputCls } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { getJoinPreview, participate, type JoinPreview } from "@/lib/api/join";
import { DEMO } from "@/lib/demo";
import { joinFailure, previewToLecture, rememberJoinedSession } from "@/lib/join";
import { LEARN_CONSENT_TEXT, SESSION_CAPACITY, me, archiveHrefFor, resolveCode, statusOf, type Lecture, type LectureStatus } from "@/lib/mock";
import { setDemo, useDemo } from "@/lib/store";

// QR → 회원 / 게스트 선택 → (로그인) 또는 (닉네임 · 동의) → 강연 상태에 따라 대기 · 질문 · 종료 화면
// 회원은 가입 때 계정 단위로 동의했으니 바로 입장하고, 게스트만 입장할 때마다 동의를 받는다
type Step = "code" | "who" | "guest";

// 게스트 닉네임 1~20자
const NICK_MAX = 20;
const MAX_FAILS = 5;

// useSearchParams는 Suspense 안에서만 쓸 수 있다
export default function JoinPage() {
  return (
    <Suspense>
      <Join />
    </Suspense>
  );
}

function Join() {
  const router = useRouter();
  const { name, authed, endedLectures, startedLectures, codes } = useDemo();

  // 입장 코드 검사(API-18). 들어갈 수 없으면 error를 돌려준다
  // 404 JOIN_CODE_INVALID · 410 JOIN_CODE_REVOKED(재발급된 이전 QR) · SESSION_FULL(정원 초과)
  function evaluate(c: string): { lecture: Lecture | null; error: string } {
    const { lecture: l, expired } = resolveCode(c, codes);
    if (!l) return { lecture: null, error: "입장 코드를 찾을 수 없어요. 다시 확인해 주세요." };
    if (expired) return { lecture: null, error: "재발급돼서 더 이상 쓸 수 없는 코드예요. 강연장 화면의 새 코드를 입력해 주세요." };
    // 시작 전(대기 화면) · 종료(보관함 또는 종료 안내)도 입장 절차는 같고, 들어간 뒤 상태별 화면이 나뉜다
    if (statusOf(l, endedLectures, startedLectures) === "live" && l.audience >= SESSION_CAPACITY) return { lecture: null, error: `정원(${SESSION_CAPACITY}명)이 가득 찬 강연이에요. 자리가 나면 다시 들어와 주세요.` };
    return { lecture: l, error: "" };
  }

  // QR · 링크(/live/코드)로 들어오면 코드를 채운 채 입장 절차(누구로 · 동의)부터 시작한다
  const fromQr = useSearchParams().get("code")?.toUpperCase() ?? "";
  // 데모는 목업에서 바로 찾고, 실제 API는 아래 effect에서 API-18로 확인한다
  const [initial] = useState(() => (DEMO && fromQr ? evaluate(fromQr) : { lecture: null, error: "" }));
  const [step, setStep] = useState<Step>(initial.lecture ? "who" : "code");
  const [code, setCode] = useState(fromQr);
  const [error, setError] = useState(initial.error);
  const [lecture, setLecture] = useState<Lecture | null>(initial.lecture);
  const [agree, setAgree] = useState({ keep: false, learn: false });
  const [touched, setTouched] = useState(false);
  const [nick, setNick] = useState("");
  const [scanning, setScanning] = useState(false);
  // 잘못된 코드를 여러 번 넣으면 잠시 막는다 (429)
  const [fails, setFails] = useState(0);
  // 실제 API: 확인 · 입장 요청 중(QR로 들어오면 처음부터 확인 중), 입장 실패 안내, 동의를 다시 받아야 하는 회원
  const [busy, setBusy] = useState(!DEMO && !!fromQr);
  const [joinError, setJoinError] = useState("");
  const [consentAgain, setConsentAgain] = useState(false);
  // 같은 입장 요청을 다시 보낼 때(연결 실패 · 503)만 같은 Idempotency-Key를 쓴다 → 같은 참가자로 이어진다
  const attempt = useRef<{ body: string; key: string } | null>(null);

  // 입장 코드 확인 결과 (API-18)
  function showPreview(target: string, preview: JoinPreview) {
    setBusy(false);
    if (preview.is_full && !preview.already_joined) {
      setError(`정원(${preview.capacity}명)이 가득 찬 강연이에요. 자리가 나면 다시 들어와 주세요.`);
      return setStep("code");
    }
    attempt.current = null;
    setJoinError("");
    setConsentAgain(false);
    setCode(target);
    setLecture(previewToLecture(target, preview));
    setStep("who");
  }

  function showLookupError(e: unknown) {
    setBusy(false);
    const f = joinFailure(e);
    if (f.badCode) setFails((n) => n + 1);
    setError(f.message);
    setStep("code");
  }

  function lookup(c: string) {
    const target = c.trim().toUpperCase();
    setBusy(true);
    getJoinPreview(target).then((p) => showPreview(target, p), showLookupError);
  }

  // QR · 링크로 들어온 첫 화면 (실제 API). 결과는 응답 콜백에서 반영한다
  useEffect(() => {
    if (DEMO || !fromQr) return;
    let stopped = false;
    getJoinPreview(fromQr).then(
      (p) => !stopped && showPreview(fromQr, p),
      (e) => !stopped && showLookupError(e),
    );
    return () => {
      stopped = true;
    };
  }, [fromQr]);

  // 입장 (API-19)
  async function join(asGuest: boolean, serviceConsent = false) {
    const c = code.trim().toUpperCase();
    const loginNext = `/login?next=${encodeURIComponent(`/join?code=${c}`)}`;
    if (!asGuest && !authed) return router.push(loginNext);
    const body = JSON.stringify({ c, asGuest, nick: nick.trim(), learn: agree.learn, serviceConsent });
    const key = attempt.current?.body === body ? attempt.current.key : crypto.randomUUID();
    setBusy(true);
    setJoinError("");
    try {
      const p = await participate({ code: c, guest: asGuest ? { nickname: nick.trim(), training: agree.learn } : undefined, serviceConsent }, key);
      attempt.current = null;
      rememberJoinedSession(c, p.session_id, p.kind);
      setDemo({ guestName: p.kind === "GUEST" ? (p.nickname ?? nick.trim()) : null, joinedCode: c });
      router.push(`/live/${c}`);
    } catch (e) {
      const retryable = !(e instanceof ApiError) || e.retryable || e.status >= 500;
      attempt.current = retryable ? { body, key } : null;
      const f = joinFailure(e);
      setBusy(false);
      if (f.relogin) return router.push(loginNext);
      // 다시 동의하고 보냈는데도 막히면 계정 단위 동의가 없는 경우다(이 화면에서 해결할 수 없음)
      if (f.consentRequired && serviceConsent) {
        setConsentAgain(false);
        return setJoinError("계정의 서비스 이용 동의 기록이 없어 입장할 수 없어요. 내 정보에서 동의 상태를 확인해 주세요.");
      }
      setConsentAgain(!!f.consentRequired);
      setJoinError(f.message);
    }
  }


  function check(c: string) {
    if (fails >= MAX_FAILS) return setError("입장 코드 입력 횟수를 넘었어요. 잠시 후 다시 시도해 주세요.");
    if (!DEMO) return lookup(c);
    const r = evaluate(c);
    if (!r.lecture) {
      if (r.error.startsWith("입장 코드를 찾을 수 없어요")) setFails((n) => n + 1);
      return setError(r.error);
    }
    setLecture(r.lecture);
    setStep("who");
  }

  // 카메라로 QR 읽기. 읽혀야만 입장 코드를 확인한다 (데모 · 실제 같음)
  function scan() {
    setError("");
    setScanning(true);
  }

  function scanned(c: string) {
    setScanning(false);
    setCode(c);
    check(c);
  }

  function scanFailed(e: ScanError) {
    setScanning(false);
    setError(
      e === "denied"
        ? "카메라 권한이 없어요. 주소창의 사이트 설정에서 카메라를 허용하거나, 아래에 입장 코드를 입력해 주세요."
        : e === "insecure"
          ? "카메라는 https 주소에서만 쓸 수 있어요. 아래에 입장 코드를 입력해 주세요."
          : e === "missing"
            ? "카메라를 찾을 수 없어요. 아래에 입장 코드를 입력해 주세요."
            : "카메라를 켜지 못했어요. 아래에 입장 코드를 입력해 주세요.",
    );
  }

  // 회원은 로그인한 상태면 로그인 화면 없이 강연 상태별 화면으로 바로 간다
  // (DRAFT → 대기 화면, LIVE → 질문 화면, ENDED → 내 보관함의 해당 강연 상세). 아니면 로그인한 뒤 돌아온다
  function enter(asGuest: boolean) {
    if (!lecture) return;
    if (!DEMO) return void join(asGuest);
    const current = codes[lecture.id] ?? lecture.code;
    setDemo({ guestName: asGuest ? nick.trim() : null, joinedCode: current });
    if (!asGuest && !authed) return router.push(`/login?next=${encodeURIComponent(`/live/${current}`)}`);
    if (!asGuest && statusOf(lecture, endedLectures, startedLectures) === "ended") return router.push(archiveHrefFor(lecture.id));
    router.push(`/live/${current}`);
  }

  const status = lecture ? statusOf(lecture, endedLectures, startedLectures) : "ready";

  return (
    <Screen nav={step === "code"}>
      {step === "code" ? (
        <PageTitle meta={<span className="text-muted">QR · 코드</span>}>입장</PageTitle>
      ) : (
        <TopBar back={undefined} title={step === "guest" ? "게스트 입장" : "어떻게 들어갈까요?"} right={<button onClick={() => setStep(step === "guest" ? "who" : "code")} className="rounded-full bg-sand px-4 py-2 text-sm font-semibold">이전</button>} />
      )}

      {step === "code" && (
        <div className="flex flex-1 flex-col px-5 pt-6">
          {scanning ? (
            <div className="relative aspect-[1/0.9] w-full overflow-hidden rounded-[30px] bg-ink md:aspect-[16/8]">
              <QrScanner onResult={scanned} onError={scanFailed} />
              <button onClick={() => setScanning(false)} className="absolute right-4 top-4 rounded-full bg-white/90 px-4 py-2 text-sm font-semibold">
                닫기
              </button>
            </div>
          ) : (
            <button onClick={scan} disabled={busy} className="relative flex aspect-[1/0.9] w-full md:aspect-[16/8] items-center justify-center overflow-hidden rounded-[30px] bg-ink">
              {["left-6 top-6 border-l-[3px] border-t-[3px] rounded-tl-2xl", "right-6 top-6 border-r-[3px] border-t-[3px] rounded-tr-2xl", "bottom-6 left-6 border-b-[3px] border-l-[3px] rounded-bl-2xl", "bottom-6 right-6 border-b-[3px] border-r-[3px] rounded-br-2xl"].map((c) => (
                <span key={c} className={`absolute h-10 w-10 border-white/80 ${c}`} />
              ))}
              <div className="flex flex-col items-center text-white">
                <Sticker size={56} rotate={-8} float>
                  📷
                </Sticker>
                <p className="mt-4 text-lg font-bold">{busy ? "입장 코드 확인 중…" : "눌러서 QR 스캔하기"}</p>
                <p className="mt-1 text-sm text-white/55">카메라로 강연장 화면의 QR을 찍어요</p>
              </div>
            </button>
          )}

          <form
            className="mt-6"
            onSubmit={(e) => {
              e.preventDefault();
              check(code);
            }}
          >
            <p className="mb-2 text-sm font-semibold text-ink/70">또는 입장 코드</p>
            <div className="flex gap-2">
              <input
                className={`${inputCls} min-w-0 flex-1 text-center text-2xl font-extrabold uppercase tracking-[0.4em]`}
                maxLength={5}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setError("");
                }}
                placeholder="QX7K2"
              />
              <Button size="lg" className="shrink-0" disabled={code.length < 5 || busy} type="submit">
                {busy ? "확인 중…" : "입장"}
              </Button>
            </div>
            {error && (
              <p className="mt-2 flex items-center gap-1 text-sm text-[#e5484d]">
                <Icon name="alert" size={15} /> {error}
              </p>
            )}
          </form>
          {DEMO && <p className="mt-4 text-xs leading-relaxed text-muted">예시 코드 · QX7K2 진행 중 · DB4M8 시작 전 · SU3M7 종료 · MK4P2 정원 초과</p>}
        </div>
      )}

      {step === "who" && lecture && (
        <div className="flex flex-1 flex-col px-5 pb-8">
          <LectureCard lecture={lecture} status={status} />
          <h2 className="mt-8 text-[34px] font-extrabold leading-[1.1] tracking-[-0.05em]">
            누구로
            <br />
            <span className="text-ink/35">들어갈까요?</span>
          </h2>
          {joinError && (
            <div role="alert" className="mt-6 rounded-2xl bg-coral/15 p-3.5 text-sm text-coral-ink">
              {joinError}
              {consentAgain && (
                <Button size="sm" className="mt-3 w-full" disabled={busy} onClick={() => join(false, true)}>
                  서비스 이용에 다시 동의하고 입장
                </Button>
              )}
            </div>
          )}
          <button onClick={() => enter(false)} disabled={busy} className="mt-8 flex items-center gap-4 rounded-[24px] bg-ink p-5 text-left text-white transition-transform hover:-translate-y-0.5">
            <Sticker size={36} rotate={-6}>
              🙋
            </Sticker>
            <span className="flex-1">
              <span className="block text-lg font-bold">회원으로 입장</span>
              <span className="text-sm text-white/55">
                {authed ? `${name}님으로 바로 들어가요. ` : "로그인하고 들어가요. "}
                질문 · 필기 · 요약 노트가 보관함에 남아요
              </span>
            </span>
            <Icon name="right" className="text-white/50" />
          </button>
          <button onClick={() => setStep("guest")} disabled={busy} className="mt-3 flex items-center gap-4 rounded-[24px] bg-white p-5 text-left transition-transform hover:-translate-y-0.5">
            <Sticker size={36} rotate={8}>
              🕶️
            </Sticker>
            <span className="flex-1">
              <span className="block text-lg font-bold">게스트로 입장</span>
              <span className="block text-sm text-muted">로그인 없이 닉네임으로 질문해요. 입장할 때마다 동의를 받아요</span>
              <span className="mt-0.5 block text-sm text-muted">강연이 끝나면 내 질문과 답변을 다시 볼 수 없어요</span>
            </span>
            <Icon name="right" className="text-muted" />
          </button>
        </div>
      )}

      {step === "guest" && lecture && (
        <form
          className="flex flex-1 flex-col px-5 pb-8"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (nick.trim() && agree.keep) enter(true);
          }}
        >
          <LectureCard lecture={lecture} status={status} />

          <label className="mt-8 block">
            <span className="text-[19px] font-bold tracking-[-0.03em]">닉네임</span>
            <span className="mt-1 block text-sm text-muted">강연 화면 위쪽에 “{nick.trim() || "닉네임"}님”으로 보여요. 다른 청중에게는 보이지 않아요.</span>
            <input
              className={`${inputCls} mt-3`}
              value={nick}
              onChange={(e) => setNick(e.target.value.slice(0, NICK_MAX))}
              placeholder="예: 질문왕"
              maxLength={NICK_MAX}
              autoFocus
            />
            <span className="mt-1.5 flex justify-between text-xs">
              <span className="text-[#e5484d]">{touched && !nick.trim() ? "닉네임을 입력해 주세요." : ""}</span>
              <span className="text-muted">
                {nick.trim().length} / {NICK_MAX}
              </span>
            </span>
          </label>

          <p className="mt-6 text-[19px] font-bold tracking-[-0.03em]">입장 전에 확인해 주세요</p>
          <div className="mt-3 space-y-2">
            <Consent
              on={agree.keep}
              onClick={() => setAgree((a) => ({ ...a, keep: !a.keep }))}
              title="질문 · 답변 기록 보관"
              required
              desc="질문과 답변은 강연이 끝나면 지워져요. 학습 활용에 동의한 경우에만 익명 처리를 위해 강연 종료 후 90일까지 보관해요. 닉네임은 강연이 끝나면 지워지고, 음성 원본은 저장하지 않아요."
            />
            <Consent
              on={agree.learn}
              onClick={() => setAgree((a) => ({ ...a, learn: !a.learn }))}
              title="AI 개선을 위한 익명 활용"
              required={false}
              desc={LEARN_CONSENT_TEXT}
            />
          </div>
          <p className="mt-3 text-xs text-muted">필수 항목에 동의해야 입장할 수 있어요. 선택 항목은 동의하지 않아도 돼요.</p>

          {joinError && (
            <p role="alert" className="mt-4 rounded-2xl bg-coral/15 p-3.5 text-sm text-coral-ink">
              {joinError}
            </p>
          )}
          <Button size="lg" className="mt-auto w-full" type="submit" disabled={!nick.trim() || !agree.keep || busy}>
            {busy ? "입장 중…" : "동의하고 입장"}
          </Button>
        </form>
      )}
    </Screen>
  );
}

function Consent({ on, onClick, title, desc, required }: { on: boolean; onClick: () => void; title: string; desc: string; required: boolean }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} onClick={onClick} className={`flex w-full gap-3 rounded-[22px] bg-white p-4 text-left ring-inset transition-all ${on ? "ring-2 ring-ink" : "ring-0"}`}>
      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${on ? "bg-ink" : "bg-ink/10"} text-white`}>
        <Icon name="check" size={14} stroke={3.2} />
      </span>
      <span>
        <span className="block font-bold">
          {title} <span className={`font-semibold ${required ? "text-coral-ink" : "text-muted"}`}>({required ? "필수" : "선택"})</span>
        </span>
        <span className="mt-1 block text-sm leading-relaxed text-muted">{desc}</span>
      </span>
    </button>
  );
}

function LectureCard({ lecture, status }: { lecture: Lecture; status: LectureStatus }) {
  return (
    <Bubble tone={lecture.tone} className="mt-1">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <StatusPill status={status} onColor />
          <p className="mt-2.5 text-[22px] font-extrabold leading-tight tracking-[-0.04em]">{lecture.title}</p>
          {/* 강연 확인 (API-18): 강연명 · 강연자 · 예정 일시 · 설명 · 정원 */}
          <p className="mt-1 text-sm text-ink/60">
            {lecture.host ?? me.name} · {lecture.date} {lecture.time}
          </p>
          {lecture.desc && <p className="mt-1.5 text-sm text-ink/75">{lecture.desc}</p>}
          <p className="mt-1.5 text-xs font-semibold text-ink/55">
            정원 {SESSION_CAPACITY}명{status === "live" && ` · ${lecture.audience}명 참여 중`}
          </p>
        </div>
        <Sticker size={44} rotate={10}>
          {lecture.emoji}
        </Sticker>
      </div>
    </Bubble>
  );
}
