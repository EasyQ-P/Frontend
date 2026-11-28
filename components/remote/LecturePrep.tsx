"use client";

// 강연 준비 화면 (실제 API). 데모 모드는 app/lectures/[id]/page.tsx의 목업 화면을 쓴다.
// API-15 강연 · API-22 교안 상태 · API-21 업로드 · API-23 재시도 · API-24 교안 삭제 · API-25 용어 사전 · API-17 QR 재발급 ·
// API-20 STT 동의 · API-16 시작 · API-40 강연 삭제
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bubble, Sticker } from "@/components/Brand";
import { JoinQr } from "@/components/JoinQr";
import { Icon } from "@/components/Icon";
import { MAX_MB, SttConsentModal, validateDeck } from "@/components/lecture";
import { QrModal } from "@/components/QrModal";
import { Button, Empty, Modal, Screen, StatusPill, TopBar, inputCls, useToast } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import {
  getLecture,
  listDocuments,
  reissueJoinLink,
  retryDocument,
  saveTerms,
  setLectureConsent,
  updateLecture,
  uploadDocument,
  type Session,
  type SessionDocument,
} from "@/lib/api/lectures";
import { deleteDocument, requestDeletion } from "@/lib/api/records";
import { documentFailReason, documentLine, isBudgetHeld, isWorking, lectureErrorMessage, sessionToLecture } from "@/lib/lectures";

// 전문용어 사전: 최대 100개, 용어당 1~40자 (API-25)
const TERMS_MAX = 100;
const TERM_LEN = 40;
// 처리 중인 교안 상태를 다시 묻는 간격
const POLL_MS = 3000;

type Loaded = { kind: "loading" } | { kind: "ok" } | { kind: "error"; message: string };

export function RemoteLecturePrep({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const showToast = toast.show;
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [session, setSession] = useState<Session | null>(null);
  const [docs, setDocs] = useState<SessionDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [newTerm, setNewTerm] = useState("");
  const [savingTerms, setSavingTerms] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [reissueOpen, setReissueOpen] = useState(false);
  const [warn, setWarn] = useState(false);
  const [sttOpen, setSttOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [removingDoc, setRemovingDoc] = useState<SessionDocument | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 처음 불러오기 (API-15 + API-22)
  useEffect(() => {
    let stopped = false;
    Promise.all([getLecture(id), listDocuments(id)]).then(
      ([s, d]) => {
        if (stopped) return;
        // 준비 화면은 시작 전 강연만. 진행 중이면 대시보드, 끝났으면 목록으로
        if (s.status === "LIVE") return router.replace(`/lectures/${id}/live`);
        if (s.status !== "DRAFT") return router.replace("/lectures");
        if (s.my_role !== "HOST") return setLoaded({ kind: "error", message: "강연자만 준비 화면을 볼 수 있어요." });
        setSession(s);
        setDocs(d.items);
        setLoaded({ kind: "ok" });
      },
      (e) => {
        if (stopped) return;
        if (e instanceof ApiError && e.code === "AUTH_REQUIRED") return router.replace(`/login?next=${encodeURIComponent(`/lectures/${id}`)}`);
        setLoaded({ kind: "error", message: lectureErrorMessage(e) });
      },
    );
    return () => {
      stopped = true;
    };
  }, [id, router]);

  // 처리 중인 교안이 있으면 상태를 다시 묻는다. 처리가 끝나면 자동으로 뽑힌 용어를 받으려고 강연도 다시 불러온다
  const working = docs.some(isWorking);
  useEffect(() => {
    if (!working) return;
    const t = setTimeout(() => {
      listDocuments(id).then(
        (d) => {
          setDocs(d.items);
          if (!d.items.some(isWorking)) {
            getLecture(id).then(setSession, () => {});
            const ok = d.items.filter((x) => x.status === "READY").length;
            if (ok) showToast("교안 준비가 끝났어요!", "mint");
          }
        },
        () => {},
      );
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [docs, id, working, showToast]);

  if (loaded.kind === "loading") return <Screen>{null}</Screen>;
  if (loaded.kind === "error" || !session)
    return (
      <Screen>
        <TopBar back="/lectures" />
        <Empty emoji="⚠️" title="강연을 불러오지 못했어요" desc={loaded.kind === "error" ? loaded.message : undefined}>
          <Button href="/lectures">내 강연으로</Button>
        </Empty>
      </Screen>
    );

  const s = session;
  const lecture = sessionToLecture(s);
  const terms = s.terms ?? [];
  const allReady = docs.length > 0 && docs.every((d) => d.status === "READY");

  async function refreshDocs() {
    const d = await listDocuments(id);
    setDocs(d.items);
  }

  // 교안 업로드 (API-21)
  async function pick(f: File) {
    const err = await validateDeck(f);
    if (err) return setFileError(err);
    setFileError("");
    setUploading(true);
    try {
      await uploadDocument(id, f, crypto.randomUUID());
      await refreshDocs();
      toast.show(`${f.name}을(를) 올렸어요. 처리하는 동안 다른 준비를 해도 돼요.`);
    } catch (e) {
      setFileError(lectureErrorMessage(e));
    } finally {
      setUploading(false);
    }
  }

  // 교안 처리 재시도 (API-23)
  async function retry(d: SessionDocument) {
    try {
      await retryDocument(id, d.document_id, crypto.randomUUID());
      await refreshDocs();
    } catch (e) {
      toast.show(lectureErrorMessage(e), "coral");
    }
  }

  // 교안 삭제 (API-24). 처리 중인 교안도 지울 수 있다(처리를 멈춘다)
  async function removeDoc() {
    if (!removingDoc) return;
    setBusy(true);
    try {
      await deleteDocument(id, removingDoc.document_id);
      setRemovingDoc(null);
      await refreshDocs();
      toast.show("교안을 삭제했어요");
    } catch (e) {
      toast.show(lectureErrorMessage(e), "coral");
    } finally {
      setBusy(false);
    }
  }

  // 시작 전 강연 삭제 (API-40 SESSION). 입장해 기다리던 청중은 입장이 취소된다
  async function removeLecture() {
    setBusy(true);
    try {
      await requestDeletion("SESSION", id);
      router.push("/lectures");
    } catch (e) {
      setBusy(false);
      setDelOpen(false);
      toast.show(lectureErrorMessage(e), "coral");
    }
  }

  // 용어 사전 저장 (API-25). 전체 목록을 덮어쓴다
  async function updateTerms(next: string[]) {
    setSavingTerms(true);
    try {
      const r = await saveTerms(id, s.version, next);
      setSession({ ...s, terms: r.terms, version: r.version });
    } catch (e) {
      toast.show(lectureErrorMessage(e), "coral");
      if (e instanceof ApiError && e.code === "VERSION_CONFLICT") getLecture(id).then(setSession, () => {});
    } finally {
      setSavingTerms(false);
    }
  }

  // QR 재발급 (API-17)
  async function reissue() {
    setReissueOpen(false);
    try {
      const r = await reissueJoinLink(id, s.version);
      setSession({ ...s, join_code: r.join_code, join_url: r.join_url, version: r.version });
      toast.show(`새 입장 코드 ${r.join_code}를 만들었어요. 이전 QR은 꺼졌어요`, "mint");
    } catch (e) {
      toast.show(lectureErrorMessage(e), "coral");
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(s.join_url ?? "");
      toast.show("입장 링크를 복사했어요");
    } catch {
      toast.show(s.join_url ?? "", "ink");
    }
  }

  // 교안이 없어도 시작할 수 있다. 처리 중 · 실패 · 보류면 경고만 하고, 시작 전에 음성 인식 동의를 받는다
  function begin(force = false) {
    if (docs.length > 0 && !allReady && !force) return setWarn(true);
    setWarn(false);
    setSttOpen(true);
  }

  // STT 동의 (API-20) → 시작 (API-16 status=LIVE)
  async function startLecture() {
    setStarting(true);
    try {
      await setLectureConsent(id, "STT", true);
      await updateLecture(id, s.version, { status: "LIVE" });
      router.push(`/lectures/${id}/live`);
    } catch (e) {
      setStarting(false);
      setSttOpen(false);
      toast.show(lectureErrorMessage(e), "coral");
      if (e instanceof ApiError && e.code === "VERSION_CONFLICT") getLecture(id).then(setSession, () => {});
    }
  }

  const failed = docs.find((d) => d.status === "FAILED");
  const held = docs.some(isBudgetHeld);

  return (
    <Screen>
      {toast.node}
      <TopBar back="/lectures" title="강연 준비" />

      <div className="flex-1 px-5 pb-32">
        <Bubble tone={lecture.tone}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <StatusPill status="ready" onColor />
              <p className="mt-2.5 text-[24px] font-extrabold leading-tight tracking-[-0.04em]">{lecture.title}</p>
              <p className="mt-1 text-sm text-ink/60">
                {lecture.date} {lecture.time}
              </p>
              {lecture.desc && <p className="mt-2 text-sm text-ink/75">{lecture.desc}</p>}
            </div>
            <Sticker size={44} rotate={10}>
              {lecture.emoji}
            </Sticker>
          </div>
        </Bubble>

        {/* 1. 교안 */}
        <Step n={1} title="교안 올리기" done={allReady} desc="교안 없이도 강연을 시작할 수 있어요. 진행 중에도 교안을 추가로 올릴 수 있어요.">
          <div className="space-y-3">
            {docs.map((d) => (
              <div key={d.document_id} className="rounded-[24px] bg-white p-4">
                <div className="flex items-center gap-3">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${d.status === "FAILED" ? "bg-[#e5484d]/12 text-[#e5484d]" : "bg-sand text-ink"}`}>
                    <Icon name="file" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{d.file_name}</p>
                    <p className="text-xs text-muted">{documentLine(d)}</p>
                  </div>
                  <DocPill d={d} />
                  <button onClick={() => setRemovingDoc(d)} className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-ink/5" aria-label={`${d.file_name} 삭제`}>
                    <Icon name="trash" size={16} />
                  </button>
                </div>
                {isWorking(d) && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink/8"><div className="h-full w-1/3 animate-pulse rounded-full bg-ink" /></div>}
                {isBudgetHeld(d) && (
                  <p className="mt-3 rounded-2xl bg-coral/12 p-3 text-sm text-ink/75">이번 달 AI 처리 예산 한도에 걸려 교안 처리를 잠시 멈췄어요. 교안 없이도 강연을 시작할 수 있어요.</p>
                )}
                {d.status === "FAILED" && (
                  <div className="mt-3 rounded-2xl bg-[#e5484d]/8 p-3">
                    <p className="flex items-center gap-1.5 text-sm font-bold text-[#e5484d]">
                      <Icon name="alert" size={16} /> 처리에 실패했어요
                    </p>
                    <p className="mt-1 text-sm text-muted">{documentFailReason(d)}</p>
                    {d.retryable && (
                      <Button size="sm" icon="undo" className="mt-3" onClick={() => retry(d)}>
                        다시 시도
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}

            <button
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) pick(f);
              }}
              disabled={uploading}
              className={`flex w-full flex-col items-center rounded-[24px] border-2 border-dashed border-ink/15 bg-white px-4 transition-colors hover:border-ink/40 disabled:opacity-60 ${docs.length ? "py-4" : "py-8"}`}
            >
              {docs.length === 0 && (
                <Sticker size={44} rotate={-8}>
                  📄
                </Sticker>
              )}
              <p className={`font-bold ${docs.length ? "text-sm" : "mt-3"}`}>{uploading ? "올리는 중…" : docs.length ? "교안 추가로 올리기" : "PDF · PPTX 교안을 끌어오거나 눌러서 선택"}</p>
              <p className="mt-1 text-xs text-muted">최대 {MAX_MB}MB · 텍스트가 없는 스캔 PDF는 읽을 수 없어요</p>
            </button>
          </div>
          <input ref={inputRef} type="file" accept=".pdf,.pptx" className="hidden" onChange={(e) => (e.target.files?.[0] && pick(e.target.files[0]), (e.target.value = ""))} />
          {fileError && <p className="mt-2 text-center text-sm text-[#e5484d]">{fileError}</p>}
        </Step>

        {/* 2. 용어 사전 */}
        <Step n={2} title="전문용어 사전" done={terms.length > 0} desc="음성 인식이 한영 혼용 용어를 더 잘 알아듣도록 힌트로 써요.">
          <div className="rounded-[24px] bg-white p-4">
            {terms.length === 0 ? (
              <p className="py-2 text-center text-sm text-muted">{working ? "교안에서 용어를 뽑는 중이에요..." : "교안을 올리면 자동으로 만들어져요."}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {terms.map((term) => (
                  <span key={term} className="inline-flex items-center gap-1 rounded-full bg-grape/35 py-1 pl-3 pr-1.5 text-sm font-medium">
                    {term}
                    <button
                      onClick={() => updateTerms(terms.filter((x) => x !== term))}
                      disabled={savingTerms}
                      className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-ink/10"
                      aria-label={`${term} 삭제`}
                    >
                      <Icon name="x" size={12} stroke={3} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const v = newTerm.trim();
                setNewTerm("");
                if (!v || v.length > TERM_LEN || terms.length >= TERMS_MAX || terms.some((t) => t.toLowerCase() === v.toLowerCase())) return;
                updateTerms([...terms, v]);
              }}
              className="mt-3 flex gap-2 border-t border-line pt-3"
            >
              <input className={`${inputCls} min-w-0 flex-1 !py-2`} placeholder="용어 직접 추가 (40자 이내)" value={newTerm} onChange={(e) => setNewTerm(e.target.value)} maxLength={TERM_LEN} />
              <Button size="sm" variant="soft" icon="plus" type="submit" className="!h-auto" disabled={terms.length >= TERMS_MAX || savingTerms}>
                추가
              </Button>
            </form>
            <p className="mt-2 text-right text-xs text-muted">
              {savingTerms ? "저장 중… · " : ""}
              {terms.length} / {TERMS_MAX}개 · 강연을 시작하면 고칠 수 없어요
            </p>
          </div>
        </Step>

        {/* 3. QR */}
        <Step n={3} title="청중 입장 QR" done desc="강연을 시작하면 청중이 이 QR로 들어와요.">
          <div className="flex items-center gap-4 rounded-[24px] bg-white p-4">
            <JoinQr code={s.join_code ?? ""} url={s.join_url} size={112} />
            <div className="flex-1">
              <p className="text-xs text-muted">입장 코드</p>
              <p className="text-3xl font-extrabold tracking-[0.2em]">{s.join_code}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="soft" icon="expand" onClick={() => setQrOpen(true)}>
                  크게 보기
                </Button>
                <Button size="sm" variant="ghost" icon="copy" onClick={copyLink}>
                  링크
                </Button>
                <Button size="sm" variant="ghost" icon="undo" onClick={() => setReissueOpen(true)}>
                  재발급
                </Button>
              </div>
            </div>
          </div>
        </Step>

        <button onClick={() => setDelOpen(true)} className="mt-10 flex w-full items-center justify-center gap-1.5 text-sm text-muted underline underline-offset-4">
          <Icon name="trash" size={15} /> 이 강연 삭제
        </button>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-paper via-paper to-transparent pb-7 pt-8">
        <div className="mx-auto px-5 md:max-w-3xl">
          <Button size="lg" icon="play" className="w-full" disabled={starting} onClick={() => begin()}>
            {starting ? "시작하는 중…" : "강연 시작"}
          </Button>
        </div>
      </div>

      <QrModal open={qrOpen} onClose={() => setQrOpen(false)} code={s.join_code ?? ""} title={s.title} url={s.join_url} />

      <Modal open={reissueOpen} onClose={() => setReissueOpen(false)} title="입장 QR을 재발급할까요?">
        <p className="text-sm leading-relaxed text-muted">새 QR과 입장 코드가 만들어지고, 이전 QR · 코드 · 링크로는 더 이상 들어올 수 없어요. 이미 입장한 청중은 그대로 참여해요.</p>
        <div className="mt-6 flex gap-2">
          <Button variant="soft" className="flex-1" onClick={() => setReissueOpen(false)}>
            취소
          </Button>
          <Button className="flex-1" onClick={reissue}>
            재발급하기
          </Button>
        </div>
      </Modal>

      {/* [강연 시작] 경고: 교안 처리 중 / 실패 / 보류 */}
      <Modal open={warn} onClose={() => setWarn(false)}>
        <div className="flex flex-col items-center text-center">
          <Sticker size={56} rotate={-8}>
            {failed ? "⚠️" : "⏳"}
          </Sticker>
          <p className="mt-4 text-[22px] font-extrabold tracking-[-0.04em]">{failed ? "처리에 실패한 교안이 있어요" : held ? "교안 처리가 보류됐어요" : "교안을 아직 처리하고 있어요"}</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">지금 시작하면 AI가 그 교안을 근거로 쓰지 못해 더 많은 질문이 강연자에게 넘어올 수 있어요.</p>
        </div>
        <div className="mt-6 flex gap-2">
          {failed?.retryable ? (
            <Button
              variant="soft"
              className="flex-1"
              icon="undo"
              onClick={() => {
                setWarn(false);
                retry(failed);
              }}
            >
              다시 시도
            </Button>
          ) : (
            <Button variant="soft" className="flex-1" onClick={() => setWarn(false)}>
              {failed ? "닫기" : "기다릴게요"}
            </Button>
          )}
          <Button className="flex-1" onClick={() => begin(true)}>
            그래도 시작
          </Button>
        </div>
      </Modal>

      <Modal open={!!removingDoc} onClose={() => setRemovingDoc(null)} title="교안을 삭제할까요?">
        <p className="rounded-2xl bg-white p-3.5 font-bold">{removingDoc?.file_name}</p>
        <p className="mt-3 text-sm leading-relaxed text-muted">교안 파일과 검색 색인이 지워지고 되돌릴 수 없어요. 교안에서 뽑은 전문용어는 그대로 남아요.</p>
        <div className="mt-6 flex gap-2">
          <Button variant="soft" className="flex-1" onClick={() => setRemovingDoc(null)}>
            취소
          </Button>
          <Button variant="danger" className="flex-1" disabled={busy} onClick={removeDoc}>
            삭제하기
          </Button>
        </div>
      </Modal>

      <Modal open={delOpen} onClose={() => setDelOpen(false)} title="이 강연을 삭제할까요?">
        <p className="rounded-2xl bg-white p-3.5 font-bold">{s.title}</p>
        <p className="mt-3 text-sm leading-relaxed text-muted">교안과 입장 QR이 함께 지워지고 되돌릴 수 없어요. 이미 입장해 기다리던 청중은 입장이 취소돼요.</p>
        <div className="mt-6 flex gap-2">
          <Button variant="soft" className="flex-1" onClick={() => setDelOpen(false)}>
            취소
          </Button>
          <Button variant="danger" className="flex-1" disabled={busy} onClick={removeLecture}>
            {busy ? "삭제하는 중…" : "삭제하기"}
          </Button>
        </div>
      </Modal>

      <SttConsentModal open={sttOpen} onClose={() => setSttOpen(false)} onConfirm={startLecture} noFile={docs.length === 0} />
    </Screen>
  );
}

function DocPill({ d }: { d: SessionDocument }) {
  const [cls, label] = isBudgetHeld(d)
    ? ["bg-coral/20 text-coral-ink", "보류"]
    : d.status === "READY"
      ? ["bg-mint/25", "완료"]
      : d.status === "FAILED"
        ? ["bg-[#e5484d]/12 text-[#e5484d]", "실패"]
        : d.status === "PROCESSING"
          ? ["bg-honey/40", "처리 중"]
          : ["bg-sand", "처리 대기"];
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{label}</span>;
}

function Step({ n, title, desc, done, children }: { n: number; title: string; desc?: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <div className="mb-3 flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${done ? "bg-mint text-ink" : "bg-ink text-white"}`}>{done ? <Icon name="check" size={15} stroke={3} /> : n}</span>
        <h2 className="text-[19px] font-bold tracking-[-0.03em]">{title}</h2>
      </div>
      {desc && <p className="-mt-1 mb-3 text-sm text-muted">{desc}</p>}
      {children}
    </section>
  );
}
