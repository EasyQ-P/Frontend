"use client";

// 지난 강연 리포트 (실제 API). 요약 노트(API-37) · 공개 질문(API-28 review) · 통계(API-39) · 교안 삭제(API-24) ·
// 강연 삭제(API-40 SESSION). 데모 모드는 app/lectures/[id]/report/page.tsx의 목업 화면을 쓴다
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Sticker } from "@/components/Brand";
import { Icon } from "@/components/Icon";
import { EndReasonPill } from "@/components/lecture";
import { SummaryView } from "@/components/remote/ArchiveDetail";
import { Button, Empty, Modal, Screen, StatusPill, Tabs, TopBar, useToast } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { getLecture, listDocuments, type Session, type SessionDocument } from "@/lib/api/lectures";
import { listQuestions, type QuestionPrivate } from "@/lib/api/questions";
import { deleteDocument, getStatistics, getSummary, requestDeletion, type Statistics, type Summary } from "@/lib/api/records";
import { lectureErrorMessage, sessionToLecture } from "@/lib/lectures";
import type { EndReason } from "@/lib/mock";

const SUMMARY_POLL_MS = 10_000;

const endReasonOf = (r: string | null): EndReason => (r === "ADMIN" ? "admin" : r === "AUTO_TIMEOUT" ? "auto" : "manual");

type Loaded =
  | { kind: "loading" }
  | { kind: "ok"; session: Session; stats: Statistics; questions: QuestionPrivate[]; docs: SessionDocument[] }
  | { kind: "error"; message: string };

export function RemoteLectureReport({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const showToast = toast.show;
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tab, setTab] = useState<"note" | "public" | "stats">("note");
  const [removingDoc, setRemovingDoc] = useState<SessionDocument | null>(null);
  const [del, setDel] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stopped = false;
    getLecture(id)
      .then(async (session) => {
        if (session.status === "DRAFT") return router.replace(`/lectures/${id}`);
        if (session.status === "LIVE") return router.replace(`/lectures/${id}/live`);
        if (session.my_role !== "HOST") throw new ApiError(403, "FORBIDDEN", "");
        const [stats, questions, docs] = await Promise.all([
          getStatistics(id),
          listQuestions(id, "review", { sort: "votes" }),
          // 원자료가 파기된 강연(PURGED)은 교안도 없다
          session.status === "ENDED" ? listDocuments(id) : Promise.resolve({ items: [] as SessionDocument[] }),
        ]);
        if (!stopped) setLoaded({ kind: "ok", session, stats, questions: questions.items, docs: docs.items });
      })
      .catch((e) => {
        if (stopped) return;
        if (e instanceof ApiError && e.code === "AUTH_REQUIRED") return router.replace(`/login?next=${encodeURIComponent(`/lectures/${id}/report`)}`);
        setLoaded({ kind: "error", message: e instanceof ApiError && e.code === "FORBIDDEN" ? "강연자만 리포트를 볼 수 있어요." : lectureErrorMessage(e) });
      });
    return () => {
      stopped = true;
    };
  }, [id, router]);

  // 요약 노트는 강연이 끝난 뒤 만들어진다. 만드는 중이면 완성될 때까지 다시 묻는다
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
        <TopBar back="/lectures" />
        <Empty emoji="🔍" title="리포트를 불러오지 못했어요" desc={loaded.message}>
          <Button href="/lectures">내 강연으로</Button>
        </Empty>
      </Screen>
    );

  const { session, stats, questions, docs } = loaded;
  const lecture = sessionToLecture(session);
  const publicLog = questions.filter((q) => q.status === "ESCALATED" || q.status === "COMPLETED");
  const aiRate = stats.ai_answer_share == null ? 0 : Math.round(stats.ai_answer_share * 100);
  const histogram = [
    ...stats.questions_by_page.map((p) => ({ key: `${p.document_id}-${p.page_no}`, label: stats.questions_by_page.some((x) => x.document_id !== p.document_id) ? `${p.file_name.slice(0, 6)} p.${p.page_no}` : `p.${p.page_no}`, count: p.count })),
    ...(stats.general_question_count ? [{ key: "general", label: "일반", count: stats.general_question_count }] : []),
  ];
  const maxBar = Math.max(1, ...histogram.map((p) => p.count));

  // 교안 삭제 (API-24). 접수하면 바로 목록에서 빠진다
  async function removeDoc() {
    if (!removingDoc) return;
    setBusy(true);
    try {
      await deleteDocument(id, removingDoc.document_id);
      const did = removingDoc.document_id;
      setLoaded((l) => (l.kind === "ok" ? { ...l, docs: l.docs.filter((d) => d.document_id !== did) } : l));
      showToast("교안을 삭제했어요");
      setRemovingDoc(null);
    } catch (e) {
      showToast(lectureErrorMessage(e), "coral");
    } finally {
      setBusy(false);
    }
  }

  // 강연 삭제 (API-40 SESSION)
  async function removeLecture() {
    setBusy(true);
    try {
      await requestDeletion("SESSION", id);
      router.push("/lectures");
    } catch (e) {
      setBusy(false);
      setDel(false);
      showToast(lectureErrorMessage(e), "coral");
    }
  }

  return (
    <Screen>
      {toast.node}
      <TopBar back="/lectures" title="강연 리포트" />

      <div className="px-5 pb-10">
        <div className="flex items-start justify-between gap-3 pt-2">
          <h1 className="text-[32px] font-extrabold leading-[1.08] tracking-[-0.05em]">{session.title}</h1>
          <Sticker size={48} rotate={10} className="shrink-0">
            {lecture.emoji}
          </Sticker>
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
          <StatusPill status="ended" />
          <EndReasonPill reason={endReasonOf(session.end_reason)} />
          {lecture.date} · 청중 {stats.participant_count.member + stats.participant_count.guest}명
        </p>

        <Tabs
          className="mt-5"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "note", label: "요약 노트" },
            { value: "public", label: "공개 질문", count: publicLog.length },
            { value: "stats", label: "통계" },
          ]}
        />

        {tab === "note" && (
          <div className="animate-rise pt-4">
            <SummaryView summary={summary} tone={lecture.tone} sid={id} originalExpired={session.status === "PURGED"} host />
          </div>
        )}

        {tab === "stats" && (
          <div className="animate-rise pt-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile n={stats.question_count} l="질문 수" c="#ffffff" e="💬" />
              <Tile n={`${aiRate}%`} l="AI 답변 비중" c="#3dbf6e" e="✨" />
              <Tile n={stats.ai_answer_count} l="AI 답변 수" c="#ffffff" e="🤖" />
              <Tile n={stats.escalated_count + stats.completed_count} l="이관 수" c="#f4625a" e="📮" />
              <Tile n={stats.completed_count} l="답변 완료 수" c="#ffffff" e="🙌" />
              <Tile n={stats.retracted_count} l="철회 수" c="#ffffff" e="↩️" />
              <Tile n={stats.vote_total} l="공감 합계" c="#ffc830" e="💛" />
              <Tile n={`${stats.participant_count.member} · ${stats.participant_count.guest}`} l="회원 · 게스트 참가자" c="#ffffff" e="👥" />
            </div>
            <p className="mt-2 text-xs text-muted">강연이 끝날 때 한 번 집계한 값이라 이후에는 바뀌지 않아요. 이관 수에는 철회돼 강연자에게 전달된 질문도 들어가요.</p>

            <div className="mt-3 rounded-[24px] bg-white p-5">
              <p className="font-bold">교안 페이지별 질문</p>
              <p className="text-xs text-muted">교안 페이지가 없는 질문은 “일반 질문”으로 묶어요</p>
              {histogram.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">받은 질문이 없어요</p>
              ) : (
                <div className="mt-4 flex h-36 items-end gap-2">
                  {histogram.map((p) => (
                    <div key={p.key} className="flex h-full flex-1 flex-col items-center gap-1">
                      <div className="flex w-full flex-1 flex-col items-center justify-end gap-1">
                        <span className="text-xs font-bold">{p.count}</span>
                        <div className={`w-full rounded-t-xl ${p.count === maxBar ? "bg-ink" : "bg-sand"}`} style={{ height: `${(p.count / maxBar) * 80}%` }} />
                      </div>
                      <span className="text-[10px] text-muted">{p.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "public" && (
          <div className="animate-rise space-y-2.5 pt-4">
            <p className="text-sm text-muted">강연자에게 전달된 질문이에요. 작성자는 보여주지 않아요.</p>
            {publicLog.length === 0 && <Empty title="남은 공개 질문이 없어요" />}
            {publicLog.map((q) => (
              <div key={q.question_id} className="flex items-center gap-3 rounded-[24px] bg-white p-4">
                <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-full bg-sand text-xs font-bold">
                  <Icon name="heart" size={13} />
                  {q.vote_count}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] leading-snug">{q.content}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    {q.document_id && q.page_no ? `교안 p.${q.page_no}` : "일반 질문"}
                    {q.status === "COMPLETED" && <span className="rounded-full bg-mint/25 px-2 py-0.5 font-semibold text-ink">✓ 답변 완료</span>}
                    {q.escalation_reason === "RETRACTED" && <span className="rounded-full bg-coral/20 px-2 py-0.5 font-semibold text-ink">AI 답변 철회됨</span>}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 교안: 종료 후에는 삭제만 할 수 있다 */}
        {session.status === "ENDED" && (
          <>
            <h2 className="mb-3 mt-8 text-[19px] font-bold tracking-[-0.03em]">교안</h2>
            {docs.length === 0 && <p className="rounded-[24px] bg-white p-4 text-center text-sm text-muted">올린 교안이 없어요</p>}
            <div className="space-y-2.5">
              {docs.map((d) => (
                <div key={d.document_id} className="flex items-center gap-3 rounded-[24px] bg-white p-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sand">
                    <Icon name="file" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{d.file_name}</p>
                    <p className="text-xs text-muted">{d.page_count ? `${d.page_count}쪽` : d.status === "FAILED" ? "처리 실패" : ""}</p>
                  </div>
                  <button onClick={() => setRemovingDoc(d)} className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-ink/5" aria-label={`${d.file_name} 삭제`}>
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <button onClick={() => setDel(true)} className="mt-8 flex w-full items-center justify-center gap-1.5 text-sm text-muted underline underline-offset-4">
          <Icon name="trash" size={15} /> 이 강연의 데이터 삭제
        </button>
      </div>

      <Modal open={!!removingDoc} onClose={() => setRemovingDoc(null)} title="교안을 삭제할까요?">
        <p className="rounded-2xl bg-white p-3.5 font-bold">{removingDoc?.file_name}</p>
        <p className="mt-3 text-sm leading-relaxed text-muted">교안 파일과 검색 색인이 지워지고 되돌릴 수 없어요. 이미 남은 AI 답변의 인용 구절은 그대로 보여요.</p>
        <div className="mt-6 flex gap-2">
          <Button variant="soft" className="flex-1" onClick={() => setRemovingDoc(null)}>
            취소
          </Button>
          <Button variant="danger" className="flex-1" disabled={busy} onClick={removeDoc}>
            삭제하기
          </Button>
        </div>
      </Modal>

      <Modal open={del} onClose={() => setDel(false)} title="강연 데이터를 삭제할까요?">
        <div className="space-y-2 text-sm leading-relaxed">
          <div className="rounded-2xl bg-white p-3.5">
            <p className="font-bold">지워지는 것</p>
            <p className="mt-0.5 text-muted">질문 · 답변 원문, 발화 기록, 교안 · 색인(강연 원자료)</p>
          </div>
          <div className="rounded-2xl bg-white p-3.5">
            <p className="font-bold">남는 것</p>
            <p className="mt-0.5 text-muted">이 강연을 보관함에 둔 회원이 있으면 강연 기록(제목 · 일시 · 요약 노트 · 공개 질문)과 그 회원의 개인 기록</p>
          </div>
          <p className="text-xs text-muted">강연자 리포트에서는 바로 사라지고 되돌릴 수 없어요.</p>
        </div>
        <div className="mt-6 flex gap-2">
          <Button variant="soft" className="flex-1" onClick={() => setDel(false)}>
            취소
          </Button>
          <Button variant="danger" className="flex-1" disabled={busy} onClick={removeLecture}>
            {busy ? "삭제하는 중…" : "삭제하기"}
          </Button>
        </div>
      </Modal>
    </Screen>
  );
}

function Tile({ n, l, c, e }: { n: React.ReactNode; l: string; c: string; e: string }) {
  return (
    <div className="relative rounded-[24px] p-4 pb-5" style={{ backgroundColor: c }}>
      <p className="text-[34px] font-extrabold leading-none tracking-[-0.04em]">{n}</p>
      <p className="mt-2 text-sm font-medium text-ink/60">{l}</p>
      <Sticker size={30} rotate={12} className="absolute right-3 top-3">
        {e}
      </Sticker>
    </div>
  );
}
