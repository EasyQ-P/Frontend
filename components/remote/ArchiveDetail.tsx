"use client";

// 보관함 강연 기록 (실제 API). 요약 노트(API-37) · 내 질문 기록(API-12) · 전체 공개 질문(API-28) · 필기(API-35/36) ·
// 근거 원문(API-38) · 삭제(API-40 QUESTION · ARCHIVE). 데모 모드는 app/archive/[id]/page.tsx의 목업 화면을 쓴다
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar, Sticker } from "@/components/Brand";
import { Icon } from "@/components/Icon";
import { NoteModal } from "@/components/NoteModal";
import { SourceChips } from "@/components/SourceChips";
import { SummaryNote } from "@/components/SummaryNote";
import { Button, Empty, Modal, RoundButton, Screen, Tabs, TopBar, useToast } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { getLecture, type Session } from "@/lib/api/lectures";
import { deleteNote, listMyQuestions, listQuestions, saveNote, type QuestionPrivate, type QuestionPublic } from "@/lib/api/questions";
import { getSummary, requestDeletion, type Summary } from "@/lib/api/records";
import { lectureErrorMessage, sessionToLecture } from "@/lib/lectures";
import { ORIGINAL_KEEP_DAYS } from "@/lib/mock";
import { citationToSource, questionErrorMessage, summaryToNote } from "@/lib/questions";

// 요약 노트를 만드는 중이면 다시 묻는 간격
const SUMMARY_POLL_MS = 10_000;

type Loaded =
  | { kind: "loading" }
  | { kind: "ok"; session: Session; mine: QuestionPrivate[]; all: QuestionPublic[] }
  | { kind: "error"; message: string; gone?: boolean };

export function RemoteArchiveDetail({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const showToast = toast.show;
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tab, setTab] = useState<"note" | "mine" | "all">("note");
  const [noteFor, setNoteFor] = useState<QuestionPublic | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "one"; q: QuestionPrivate } | { kind: "all" }>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let stopped = false;
    Promise.all([getLecture(id), listMyQuestions(id), listQuestions(id, "public", { sort: "votes" })]).then(
      ([session, mine, all]) => !stopped && setLoaded({ kind: "ok", session, mine: mine.items, all: all.items }),
      (e) => {
        if (stopped) return;
        if (e instanceof ApiError && e.code === "AUTH_REQUIRED") return router.replace(`/login?next=${encodeURIComponent(`/archive/${id}`)}`);
        const gone = e instanceof ApiError && (e.code === "RESOURCE_NOT_FOUND" || e.code === "FORBIDDEN");
        setLoaded({ kind: "error", gone, message: gone ? "지워졌거나 내 보관함에 없는 기록이에요." : lectureErrorMessage(e) });
      },
    );
    return () => {
      stopped = true;
    };
  }, [id, router]);

  // 요약 노트: 만드는 중(QUEUED · RUNNING)이면 완성될 때까지 다시 묻는다
  const pending = !summary || summary.status === "QUEUED" || summary.status === "RUNNING";
  useEffect(() => {
    if (!pending) return;
    let stopped = false;
    const t = setTimeout(
      () =>
        getSummary(id).then(
          (r) => !stopped && setSummary(r),
          () => !stopped && setSummary((s) => s ?? { summary_id: null, status: "FAILED", content: null, sources: [], generated_at: null }),
        ),
      summary ? SUMMARY_POLL_MS : 0,
    );
    return () => {
      stopped = true;
      clearTimeout(t);
    };
  }, [id, pending, summary]);

  if (loaded.kind === "loading") return <Screen>{null}</Screen>;
  if (loaded.kind === "error")
    return (
      <Screen>
        <TopBar back="/archive" />
        <Empty emoji={loaded.gone ? "🔍" : "⚠️"} title={loaded.gone ? "기록을 찾을 수 없어요" : "기록을 불러오지 못했어요"} desc={loaded.message}>
          <Button href="/archive">보관함으로</Button>
        </Empty>
      </Screen>
    );

  const { session, mine, all } = loaded;
  const lecture = sessionToLecture(session);
  // 강연 후 90일이 지나 원자료가 파기되면(PURGED) 근거 원문 대신 위치와 인용 구절만 보여준다
  const originalExpired = session.status === "PURGED";

  function setNote(qid: string, note: QuestionPublic["my_note"]) {
    setLoaded((l) => (l.kind === "ok" ? { ...l, all: l.all.map((q) => (q.question_id === qid ? { ...q, my_note: note } : q)) } : l));
  }

  // 삭제 접수 (API-40). 접수하면 바로 보이지 않는다
  async function doDelete() {
    if (!confirm) return;
    setDeleting(true);
    try {
      if (confirm.kind === "all") {
        await requestDeletion("ARCHIVE", id);
        return router.push("/archive");
      }
      await requestDeletion("QUESTION", confirm.q.question_id);
      const qid = confirm.q.question_id;
      setLoaded((l) => (l.kind === "ok" ? { ...l, mine: l.mine.filter((q) => q.question_id !== qid) } : l));
      showToast("질문 기록을 지웠어요");
      setConfirm(null);
    } catch (e) {
      showToast(lectureErrorMessage(e), "coral");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Screen>
      {toast.node}
      <TopBar back="/archive" right={<RoundButton icon="trash" label="강연 기록 삭제" onClick={() => setConfirm({ kind: "all" })} />} />
      <div className="px-5">
        <div className="flex items-start justify-between gap-3 pt-2">
          <h1 className="text-[32px] font-extrabold leading-[1.08] tracking-[-0.05em]">{session.title}</h1>
          <Sticker size={48} rotate={10} className="shrink-0">
            {lecture.emoji}
          </Sticker>
        </div>
        <p className="mt-3 flex items-center gap-2 text-sm text-muted">
          <Avatar name={session.host_display_name} size={24} />
          {session.host_display_name} · {lecture.date}
        </p>
        {originalExpired && (
          <p className="mt-3 flex items-start gap-1.5 rounded-2xl bg-white px-3 py-2.5 text-xs leading-relaxed text-muted">
            <Icon name="clock" size={14} className="mt-px shrink-0" />
            강연 후 {ORIGINAL_KEEP_DAYS}일이 지나 근거 원문은 지워졌어요. 근거 위치와 인용 구절만 볼 수 있어요.
          </p>
        )}
      </div>

      <div className="flex-1 px-5 pb-10 pt-6">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "note", label: "요약 노트" },
            { value: "mine", label: "내 질문", count: mine.length },
            { value: "all", label: "전체 질문", count: all.length },
          ]}
        />

        {tab === "note" && (
          <div className="animate-rise pt-4">
            <SummaryView summary={summary} tone={lecture.tone} sid={id} originalExpired={originalExpired} />
          </div>
        )}

        {tab === "mine" && (
          <div className="animate-rise space-y-3 pt-4">
            {mine.length === 0 && <Empty title="남은 질문 기록이 없어요" />}
            {mine.map((q) => {
              const retracted = q.escalation_reason === "RETRACTED" || q.answer?.status === "RETRACTED";
              return (
                <div key={q.question_id} className="rounded-[24px] bg-white p-4">
                  <div className="flex items-start gap-2">
                    <p className="flex-1 font-bold leading-snug">{q.content}</p>
                    <button onClick={() => setConfirm({ kind: "one", q })} className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-ink/5" aria-label="질문 삭제">
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                  {retracted ? (
                    <div className="mt-3 rounded-[20px] bg-coral/15 p-4">
                      <p className="inline-flex items-center gap-1 rounded-full bg-white/70 px-3 py-1.5 text-xs font-semibold">↩︎ AI 답변 철회됨</p>
                      <p className="mt-2 text-[15px] font-bold">강연자가 직접 설명합니다</p>
                    </div>
                  ) : q.status === "AI_ANSWERED" && q.answer ? (
                    <div className="mt-3 rounded-[20px] bg-mint/18 p-4">
                      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[10px] text-white">✦</span> AI 답변
                      </p>
                      <p className="text-sm leading-relaxed">{q.answer.content}</p>
                      <SourceChips sources={q.answer.citations.map(citationToSource)} originalExpired={originalExpired} sid={id} />
                    </div>
                  ) : q.status === "ESCALATED" || q.status === "COMPLETED" ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-full bg-honey/35 px-3 py-1.5 text-xs font-semibold">📮 강연자에게 전달됨</span>
                      {q.status === "COMPLETED" && <span className="inline-flex items-center gap-1 rounded-full bg-mint/25 px-3 py-1.5 text-xs font-semibold">✓ 답변 완료</span>}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted">강연이 끝나기 전에 답변이 나오지 않았어요.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === "all" && (
          <div className="animate-rise space-y-3 pt-4">
            {all.length === 0 && <Empty title="강연자에게 전달된 질문이 없어요" />}
            {all.map((q) => (
              <div key={q.question_id} className="rounded-[24px] bg-white p-4">
                <div className="flex items-start gap-3">
                  <p className="min-w-0 flex-1 text-[15px] leading-snug">{q.content}</p>
                  <button
                    onClick={() => setNoteFor(q)}
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${q.my_note?.content ? "bg-ink text-white" : "bg-sand text-ink"}`}
                    aria-label="필기 편집"
                  >
                    <Icon name="pen" size={15} />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs font-semibold">
                  <span className="inline-flex items-center gap-1 rounded-full bg-sand px-2.5 py-1">
                    <Icon name="heart" size={12} /> 공감 {q.vote_count}
                  </span>
                  {q.status === "COMPLETED" && <span className="rounded-full bg-mint/25 px-2.5 py-1">✓ 답변 완료</span>}
                  {q.voted_by_me && <span className="rounded-full bg-coral/20 px-2.5 py-1">💛 내가 공감</span>}
                </div>
                {q.my_note?.content && (
                  <p className="mt-2 flex gap-1.5 rounded-2xl bg-paper px-3 py-2 text-sm text-ink/70">
                    <Icon name="pen" size={14} className="mt-0.5 shrink-0" />
                    {q.my_note.content}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.kind === "all" ? "이 강연 기록을 모두 지울까요?" : "이 질문 기록을 지울까요?"}>
        <p className="text-sm leading-relaxed text-muted">
          {confirm?.kind === "all"
            ? "요약 노트와 내 질문 · 필기가 내 보관함에서 모두 지워지고 되돌릴 수 없어요."
            : confirm?.kind === "one" && (confirm.q.status === "ESCALATED" || confirm.q.status === "COMPLETED")
              ? "내 보관함에서 지워져요. 강연자에게 전달된 질문이라 작성자 없이 강연 기록에는 남아요."
              : "내 보관함에서 지워지고 되돌릴 수 없어요."}
        </p>
        <div className="mt-6 flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={() => setConfirm(null)}>
            취소
          </Button>
          <Button variant="danger" className="flex-1" disabled={deleting} onClick={doDelete}>
            {deleting ? "지우는 중…" : "지우기"}
          </Button>
        </div>
      </Modal>

      {noteFor && (
        <NoteModal
          open
          onClose={() => setNoteFor(null)}
          questionId={noteFor.question_id}
          questionText={noteFor.content}
          initial={noteFor.my_note?.content ?? ""}
          save={async (t) => {
            try {
              const note = t ? await saveNote(id, noteFor.question_id, t) : (await deleteNote(id, noteFor.question_id), null);
              setNote(noteFor.question_id, note);
            } catch (e) {
              throw new Error(questionErrorMessage(e));
            }
          }}
          onSaved={(t) => showToast(t ? "필기를 저장했어요" : "필기를 지웠어요", "mint")}
        />
      )}
    </Screen>
  );
}

// 요약 노트 상태별 화면. 강연자 리포트와 같이 쓴다
export function SummaryView({ summary, tone, sid, originalExpired = false, host = false }: { summary: Summary | null; tone: Parameters<typeof SummaryNote>[0]["tone"]; sid: string; originalExpired?: boolean; host?: boolean }) {
  if (!summary || summary.status === "QUEUED" || summary.status === "RUNNING")
    return (
      <div className="flex flex-col items-center rounded-[24px] bg-white px-6 py-10 text-center">
        <Sticker size={56} rotate={-8} float>
          ✍️
        </Sticker>
        <p className="mt-5 text-lg font-bold">요약 노트를 만드는 중이에요</p>
        <p className="mt-1 text-sm text-muted">{host ? "강연 발화와 교안을 읽고 있어요. 완성되면 청중 보관함에도 보내드려요." : "강연 발화와 교안을 읽고 있어요. 완성되면 여기에 바로 보여드릴게요."}</p>
      </div>
    );
  if (summary.status === "READY" && summary.content)
    return (
      <>
        <SummaryNote note={summaryToNote(summary.content)} tone={tone} />
        {summary.sources.length > 0 && (
          <div className="mt-3 rounded-[24px] bg-white p-5">
            <p className="font-bold">근거</p>
            <SourceChips sources={summary.sources.map(citationToSource)} originalExpired={originalExpired} sid={sid} />
          </div>
        )}
      </>
    );
  if (summary.status === "SKIPPED") return <Empty emoji="🫙" title="요약 노트가 만들어지지 않았어요" desc="강연 발화가 너무 짧으면 요약 노트를 만들지 않아요." />;
  return <Empty emoji="⚠️" title="요약 노트가 만들어지지 않았어요" desc="요약 노트 생성에 실패했어요." />;
}
