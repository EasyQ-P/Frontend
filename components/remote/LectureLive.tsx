"use client";

// 진행 중 강연 대시보드 (실제 API). 전달된 질문(완료 처리 API-32) · AI 답변 검토(철회 API-33) · 참여 인원 · 입장 QR · 강연 종료.
// 질문 목록은 검토용 목록(API-28 scope=review)으로 받고, 바뀐 것은 WebSocket 이벤트로 반영한다.
// 음성 인식(STT 음성 스트림)은 아직 연결 전이다. 데모 모드는 app/lectures/[id]/live/page.tsx의 목업 화면을 쓴다
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Bubble, Sticker } from "@/components/Brand";
import { JoinQr } from "@/components/JoinQr";
import { Icon } from "@/components/Icon";
import { QrModal } from "@/components/QrModal";
import { SourceChips } from "@/components/SourceChips";
import { Button, Empty, Modal, Screen, StatusPill, TopBar, inputCls, useToast } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { getLecture, updateLecture, type Session } from "@/lib/api/lectures";
import { useLiveEvents, type LiveEvent } from "@/lib/api/live";
import { getQuestion, listQuestions, retractAnswer, setQuestionDone, type QuestionPrivate, type RetractReason } from "@/lib/api/questions";
import { lectureErrorMessage, sessionToLecture } from "@/lib/lectures";
import { toneCycle } from "@/lib/mock";
import { citationToSource, clockOf, questionErrorMessage } from "@/lib/questions";

// 실시간 연결이 끊긴 동안을 대비해 강연 상태를 다시 묻는 간격
const POLL_MS = 30_000;

const retractReasons: { value: RetractReason; label: string; desc: string }[] = [
  { value: "WRONG_OR_INSUFFICIENT", label: "근거가 부족해요", desc: "답변이 교안 · 발화 근거와 맞지 않거나 정확하지 않아요." },
  { value: "EXPLAIN_AGAIN", label: "제가 직접 답변할게요", desc: "AI 답변 대신 강연 중에 직접 설명할게요." },
];

type Loaded = { kind: "loading" } | { kind: "ok"; session: Session } | { kind: "error"; message: string };

export function RemoteLectureLive({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const showToast = toast.show;
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [qrOpen, setQrOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      getLecture(id).then(
        (s) => {
          if (stopped) return;
          if (s.status === "DRAFT") return router.replace(`/lectures/${id}`);
          if (s.status !== "LIVE") {
            showToast("강연이 끝났어요");
            return router.replace("/lectures");
          }
          if (s.my_role !== "HOST") return setLoaded({ kind: "error", message: "강연자만 대시보드를 볼 수 있어요." });
          setLoaded({ kind: "ok", session: s });
          timer = setTimeout(load, POLL_MS);
        },
        (e) => {
          if (stopped) return;
          if (e instanceof ApiError && e.code === "AUTH_REQUIRED") return router.replace(`/login?next=${encodeURIComponent(`/lectures/${id}/live`)}`);
          setLoaded({ kind: "error", message: lectureErrorMessage(e) });
        },
      );
    load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, router, showToast]);

  if (loaded.kind === "loading") return <Screen>{null}</Screen>;
  if (loaded.kind === "error")
    return (
      <Screen>
        <TopBar back="/lectures" />
        <Empty emoji="⚠️" title="강연을 불러오지 못했어요" desc={loaded.message}>
          <Button href="/lectures">내 강연으로</Button>
        </Empty>
      </Screen>
    );

  const s = loaded.session;
  const lecture = sessionToLecture(s);

  // 강연 종료 (API-16 status=ENDED)
  async function end() {
    setEnding(true);
    try {
      await updateLecture(id, s.version, { status: "ENDED" });
      router.push("/lectures");
    } catch (e) {
      setEnding(false);
      setEndOpen(false);
      showToast(lectureErrorMessage(e), "coral");
    }
  }

  return (
    <Screen width="wide">
      {toast.node}
      <TopBar back="/lectures" title="강연 진행 중" />
      <div className="flex-1 px-5 pb-10">
        <Bubble tone={lecture.tone}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <StatusPill status="live" onColor />
              <p className="mt-2.5 text-[24px] font-extrabold leading-tight tracking-[-0.04em]">{lecture.title}</p>
              <p className="mt-1 text-sm text-ink/60">
                청중 {s.participant_count}명 참여 중 · 정원 {s.capacity}명
              </p>
            </div>
            <Sticker size={44} rotate={10}>
              {lecture.emoji}
            </Sticker>
          </div>
        </Bubble>

        <section className="mt-6 flex items-center gap-4 rounded-[24px] bg-white p-4">
          <JoinQr code={s.join_code ?? ""} url={s.join_url} size={96} />
          <div className="flex-1">
            <p className="text-xs text-muted">입장 코드</p>
            <p className="text-3xl font-extrabold tracking-[0.2em]">{s.join_code}</p>
            <Button size="sm" variant="soft" icon="expand" className="mt-2" onClick={() => setQrOpen(true)}>
              강연장 화면에 크게 띄우기
            </Button>
          </div>
        </section>

        <HostQuestions
          sid={id}
          onSession={(patch) => setLoaded((l) => (l.kind === "ok" ? { kind: "ok", session: { ...l.session, ...patch } } : l))}
          onEnded={() => {
            showToast("강연이 끝났어요");
            router.replace("/lectures");
          }}
          toast={showToast}
        />

        <p className="mt-6 flex items-start gap-1.5 rounded-[20px] bg-white/60 px-4 py-3 text-xs leading-relaxed text-muted">
          <Icon name="mic" size={14} className="mt-0.5 shrink-0" />
          음성 인식(강연 발화 자막 · 근거)은 곧 연결돼요. 지금은 교안을 근거로 AI가 답해요.
        </p>

        <Button variant="danger" size="lg" icon="stop" className="mt-8 w-full" onClick={() => setEndOpen(true)}>
          강연 종료
        </Button>
      </div>

      <QrModal open={qrOpen} onClose={() => setQrOpen(false)} code={s.join_code ?? ""} title={s.title} url={s.join_url} />

      <Modal open={endOpen} onClose={() => setEndOpen(false)} title="강연을 끝낼까요?">
        <p className="flex items-start gap-1.5 text-sm leading-relaxed text-muted">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          끝내면 청중이 더 이상 질문할 수 없고 되돌릴 수 없어요. 회원 청중에게는 요약 노트가 보관함으로 가요.
        </p>
        <div className="mt-6 flex gap-2">
          <Button variant="soft" className="flex-1" onClick={() => setEndOpen(false)}>
            계속 진행
          </Button>
          <Button variant="danger" className="flex-1" disabled={ending} onClick={end}>
            {ending ? "끝내는 중…" : "강연 종료"}
          </Button>
        </div>
      </Modal>
    </Screen>
  );
}

// 전달된 질문 · AI 답변 검토. 강연자 연결은 질문 · 답변 이벤트를 모두 받는다 (7.3.10)
function HostQuestions({
  sid,
  onSession,
  onEnded,
  toast,
}: {
  sid: string;
  onSession: (patch: Partial<Session>) => void;
  onEnded: () => void;
  toast: (text: string, tone?: "coral" | "mint" | "ink") => void;
}) {
  const [qs, setQs] = useState<QuestionPrivate[]>([]);
  const [fresh, setFresh] = useState<string[]>([]);
  const [hideDone, setHideDone] = useState(false);
  const [openAi, setOpenAi] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [retracting, setRetracting] = useState<QuestionPrivate | null>(null);
  const [reason, setReason] = useState<RetractReason | null>(null);
  const [detail, setDetail] = useState("");

  const upsert = useCallback((q: QuestionPrivate) => setQs((list) => (list.some((x) => x.question_id === q.question_id) ? list.map((x) => (x.question_id === q.question_id ? q : x)) : [...list, q])), []);

  const reload = useCallback(
    () =>
      listQuestions(sid, "review", { sort: "latest" }).then(
        (r) => setQs(r.items),
        (e) => toast(questionErrorMessage(e), "coral"),
      ),
    [sid, toast],
  );

  useEffect(() => {
    let stopped = false;
    listQuestions(sid, "review", { sort: "latest" }).then(
      (r) => !stopped && setQs(r.items),
      (e) => !stopped && toast(questionErrorMessage(e), "coral"),
    );
    return () => {
      stopped = true;
    };
  }, [sid, toast]);

  const refetch = useCallback(
    (qid: string, isNew: boolean) =>
      getQuestion(sid, qid).then(
        (q) => {
          // 검토 목록에는 답변이 나왔거나 전달된 질문만 둔다 (처리 중인 질문은 기다린다)
          if (q.status === "QUEUED" || q.status === "PROCESSING") return;
          upsert(q);
          if (isNew) {
            setFresh((f) => [...f, qid]);
            if (q.status === "ESCALATED") toast("새 질문이 들어왔어요", "coral");
          }
        },
        () => {},
      ),
    [sid, upsert, toast],
  );

  const onEvent = useCallback(
    (e: LiveEvent) => {
      const d = e.data;
      const qid = typeof d.question_id === "string" ? d.question_id : "";
      switch (e.type) {
        case "session.updated":
          if (d.status === "ENDED" || d.status === "PURGED") return onEnded();
          onSession({
            ...(typeof d.participant_count === "number" ? { participant_count: d.participant_count } : {}),
            ...(typeof d.version === "number" ? { version: d.version } : {}),
          });
          return;
        case "public_question.updated":
          setQs((list) => list.map((x) => (x.question_id === d.question_id ? { ...x, vote_count: Number(d.vote_count), status: d.status as QuestionPrivate["status"], version: Number(d.version) } : x)));
          return;
        case "question.updated":
        case "answer.completed":
        case "answer.retracted":
          if (d.status === "QUEUED" || d.status === "PROCESSING") return;
          void refetch(qid, !qs.some((x) => x.question_id === qid));
          return;
      }
    },
    [qs, refetch, onSession, onEnded],
  );

  const live = useLiveEvents(sid, { onEvent, onReconnect: reload });

  // API-32 답변 완료 · 완료 취소
  async function toggleDone(q: QuestionPrivate) {
    const done = q.status !== "COMPLETED";
    setBusy(q.question_id);
    try {
      upsert(await setQuestionDone(sid, q.question_id, q.version, done));
      setFresh((f) => f.filter((x) => x !== q.question_id));
      toast(done ? "답변 완료로 표시했어요" : "다시 대기로 돌렸어요", done ? "mint" : "ink");
    } catch (e) {
      toast(questionErrorMessage(e), "coral");
      if (e instanceof ApiError && e.code === "VERSION_CONFLICT") void reload();
    } finally {
      setBusy(null);
    }
  }

  // API-33 AI 답변 철회 → 질문이 전달된 질문으로 옮겨진다
  async function retract() {
    if (!retracting || !reason) return;
    setBusy(retracting.question_id);
    try {
      await retractAnswer(sid, retracting.question_id, retracting.version, reason, detail.trim() || undefined);
      await refetch(retracting.question_id, false);
      setRetracting(null);
      toast("AI 답변을 철회했어요. 질문자에게는 “강연자가 직접 설명합니다”로 보여요", "coral");
    } catch (e) {
      toast(questionErrorMessage(e), "coral");
      if (e instanceof ApiError && e.code === "VERSION_CONFLICT") void reload();
    } finally {
      setBusy(null);
    }
  }

  const forwarded = qs.filter((q) => q.status === "ESCALATED" || q.status === "COMPLETED");
  const waiting = forwarded.filter((q) => q.status === "ESCALATED");
  const answered = qs.filter((q) => q.answer);
  const activeAi = answered.filter((q) => q.answer?.status === "ACTIVE").length;
  const aiRate = qs.length ? Math.round((activeAi / qs.length) * 100) : 0;
  // 대기 먼저, 그 안에서 공감순 · 오래된 순
  const visible = forwarded
    .filter((q) => !hideDone || q.status === "ESCALATED")
    .sort((a, b) => (a.status !== b.status ? (a.status === "ESCALATED" ? -1 : 1) : b.vote_count - a.vote_count || a.created_at.localeCompare(b.created_at)));

  return (
    <>
      {live === "closed" && <p className="mt-4 text-xs font-semibold text-coral-ink">실시간 연결이 끊겨 다시 연결하는 중이에요…</p>}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="대기 중 질문" value={waiting.length} color="#f4625a" emoji="🙋" />
        <Stat label="AI가 답한 질문" value={activeAi} color="#3dbf6e" emoji="✨" />
        <Stat label="AI 답변 비중" value={`${aiRate}%`} color="#3a82f7" emoji="📊" />
        <Stat label="받은 공감" value={forwarded.reduce((n, q) => n + q.vote_count, 0)} color="#ffc830" emoji="💛" />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-12">
        <section className="lg:col-span-7">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-[26px] font-extrabold tracking-[-0.045em]">전달된 질문</h2>
            <span className="text-sm">{waiting.length}개 대기</span>
            <button onClick={() => setHideDone((h) => !h)} className={`ml-auto rounded-full px-3 py-1.5 text-sm font-semibold ${hideDone ? "bg-ink text-white" : "text-muted"}`}>
              완료 숨기기
            </button>
          </div>
          <p className="mb-5 text-sm text-muted">AI가 답하지 못해 강연자에게 전달된 질문이에요. 구두로 답한 뒤 완료를 눌러주세요.</p>
          {visible.length === 0 && <Empty emoji="🎉" title="대기 중인 질문이 없어요!" />}
          {visible.map((q, i) => {
            const done = q.status === "COMPLETED";
            const isNew = fresh.includes(q.question_id) && !done;
            return (
              <Bubble
                key={q.question_id}
                tone={toneCycle[i % toneCycle.length]}
                tail={i % 2 ? "right" : "left"}
                muted={done}
                className={`mb-[18px] ${i ? "-mt-1" : ""} ${isNew ? "animate-pop" : ""}`}
                style={{ zIndex: visible.length - i }}
              >
                <div className="flex items-center gap-4">
                  <div className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-full ${done ? "bg-white/60" : "bg-ink text-white"}`}>
                    <Icon name="heart" size={15} />
                    <span className="text-lg font-extrabold leading-none tabular-nums">{q.vote_count}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="mb-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink/55">
                      <b className="text-ink">{q.document_id && q.page_no ? `교안 p.${q.page_no}` : "일반"}</b>
                      {clockOf(q.created_at)}
                      {q.escalation_reason === "RETRACTED" && <span className="rounded-full bg-white/70 px-2 py-0.5 font-bold text-ink">AI 답변 철회</span>}
                      {isNew && <span className="rounded-full bg-ink px-2 py-0.5 font-bold text-white">NEW</span>}
                    </p>
                    <p className={`text-[16px] font-medium leading-snug ${done ? "text-ink/45 line-through decoration-ink/30" : ""}`}>{q.content}</p>
                  </div>
                  <button
                    onClick={() => toggleDone(q)}
                    disabled={busy === q.question_id}
                    className={`flex h-11 shrink-0 items-center gap-1 rounded-full px-4 text-sm font-semibold transition-all disabled:opacity-50 ${done ? "bg-white/60 text-ink/60 hover:bg-white" : "bg-white text-ink hover:bg-white/80"}`}
                  >
                    <Icon name={done ? "undo" : "check"} size={16} stroke={2.6} />
                    <span className="hidden sm:inline">{done ? "완료 취소" : "답변 완료"}</span>
                  </button>
                </div>
              </Bubble>
            );
          })}
        </section>

        <section className="lg:col-span-5">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-[26px] font-extrabold tracking-[-0.045em]">AI 답변 검토</h2>
            <span className="text-sm">{answered.length}개</span>
          </div>
          <p className="mb-3 text-sm text-muted">질문자에게만 보인 답변이에요. 틀린 답은 철회할 수 있어요.</p>
          {answered.length === 0 && <Empty emoji="✨" title="아직 AI가 답한 질문이 없어요" />}
          <div className="space-y-2.5">
            {answered.map((q) => {
              const open = openAi === q.question_id;
              const retracted = q.answer?.status === "RETRACTED";
              return (
                <div key={q.question_id} className={`rounded-[24px] bg-white ${retracted ? "opacity-55" : ""}`}>
                  <button onClick={() => setOpenAi(open ? null : q.question_id)} className="flex w-full items-center gap-3 p-4 text-left" aria-expanded={open}>
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${retracted ? "bg-ink/8 text-muted" : "bg-mint text-ink"}`}>
                      <Icon name={retracted ? "x" : "spark"} size={17} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{q.content}</span>
                      <span className="text-xs text-muted">
                        {clockOf(q.created_at)}
                        {retracted && " · 철회됨"}
                      </span>
                    </span>
                    <Icon name="right" size={16} className={`shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`} />
                  </button>
                  {open && (
                    <div className="animate-rise border-t border-line px-4 pb-4 pt-3">
                      {retracted ? (
                        <p className="text-sm text-muted">철회한 답변이에요. 질문은 전달된 질문으로 옮겨졌어요.</p>
                      ) : (
                        <>
                          <p className="text-[15px] leading-relaxed">{q.answer?.content}</p>
                          <SourceChips sources={q.answer?.citations.map(citationToSource) ?? []} sid={sid} />
                          <div className="mt-3 flex justify-end">
                            <Button
                              size="sm"
                              variant="soft"
                              icon="undo"
                              onClick={() => {
                                setReason(null);
                                setDetail("");
                                setRetracting(q);
                              }}
                            >
                              답변 철회
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <Modal open={!!retracting} onClose={() => setRetracting(null)} title="이 AI 답변을 철회할까요?">
        <p className="rounded-2xl bg-white p-3.5 font-bold">{retracting?.content}</p>
        <p className="mt-5 text-sm font-semibold text-ink/70">철회 사유를 골라 주세요</p>
        <div role="radiogroup" aria-label="철회 사유" className="mt-2 space-y-2">
          {retractReasons.map((r) => {
            const on = reason === r.value;
            return (
              <button
                key={r.value}
                role="radio"
                aria-checked={on}
                onClick={() => setReason(r.value)}
                className={`flex w-full gap-3 rounded-[20px] bg-white p-3.5 text-left ring-inset transition-all ${on ? "ring-2 ring-ink" : "ring-0"}`}
              >
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white ${on ? "bg-ink" : "bg-ink/10"}`}>
                  <Icon name="check" size={14} stroke={3.2} />
                </span>
                <span>
                  <span className="block font-bold">{r.label}</span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-muted">{r.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
        <label className="mt-4 block">
          <span className="text-sm font-semibold text-ink/70">상세 사유 (선택)</span>
          <textarea className={`${inputCls} mt-2 h-20 resize-none text-sm`} value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={500} placeholder="어떤 점이 틀렸는지 적어 주면 판정 모델 개선에 쓰여요" />
        </label>
        <p className="mt-3 text-xs leading-relaxed text-muted">질문자 화면에서 답변이 가려지고 “강연자가 직접 설명합니다”로 바뀌어요. 질문은 공개 목록으로 옮겨지고, 철회한 답변은 판정 모델 재학습 데이터로 쓰여요.</p>
        <div className="mt-6 flex gap-2">
          <Button variant="soft" className="flex-1" onClick={() => setRetracting(null)}>
            취소
          </Button>
          <Button className="flex-1" onClick={retract} disabled={!reason || busy === retracting?.question_id}>
            철회하기
          </Button>
        </div>
      </Modal>
    </>
  );
}

function Stat({ label, value, color, emoji }: { label: string; value: React.ReactNode; color: string; emoji: string }) {
  return (
    <div className="relative overflow-hidden rounded-[24px] p-4 pb-5" style={{ backgroundColor: color }}>
      <p className="text-[34px] font-extrabold leading-none tracking-[-0.04em] tabular-nums">{value}</p>
      <p className="mt-2 text-sm font-medium text-ink/65">{label}</p>
      <Sticker size={34} rotate={12} className="absolute right-3 top-3">
        {emoji}
      </Sticker>
    </div>
  );
}
