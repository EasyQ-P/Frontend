"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bubble, Sticker } from "@/components/Brand";
import { Icon } from "@/components/Icon";
import { NoteModal } from "@/components/NoteModal";
import { SourceChips } from "@/components/SourceChips";
import { Button, Empty, RoundButton, Screen, Tabs, useToast } from "@/components/ui";
import { getJoinPreview, participate, type JoinPreview } from "@/lib/api/join";
import { useLiveEvents, type LiveEvent } from "@/lib/api/live";
import {
  deleteNote,
  getQuestion,
  isPublic,
  listQuestions,
  rateAnswer,
  saveNote,
  searchSimilar,
  submitQuestion,
  unvote,
  vote,
  type QuestionPrivate,
  type QuestionPublic,
} from "@/lib/api/questions";
import { DEMO } from "@/lib/demo";
import { joinFailure, joinedSession, previewToLecture, rememberJoinedSession, type JoinFailure, type JoinedSession } from "@/lib/join";
import { citationToSource, clockOf, mineState, questionErrorMessage } from "@/lib/questions";
import { SESSION_CAPACITY, archiveHrefFor, cannedAnswers, discardedDrafts, demoClock, resolveCode, statusOf, liveAiQuestions, livePublicQuestions, type Lecture, type PublicQuestion, type Source, toneCycle } from "@/lib/mock";
import { setDemo, useDemo } from "@/lib/store";

// 내 질문 진행: 근거를 찾는 중 → 답변을 작성하는 중 → (답변 작성 중 표시 → 확정) 또는 강연자에게 전달됨
type Mine = {
  id: string;
  text: string;
  at: string;
  state: "searching" | "writing" | "ai" | "forwarded";
  answer?: string;
  sources?: Source[];
  feedback?: "up" | "down" | null;
  retracted?: boolean;
  streaming?: boolean;
  // 확정 전 답변(answer.delta provisional). 폐기되거나 확정될 때까지 작성 중으로 보인다
  provisional?: boolean;
  // 작성 중 답변이 폐기돼 강연자에게 전달됨
  discarded?: boolean;
};

const Q_MAX = 200;

// 새 질문 시각은 목업 강연 시간대 기준으로 찍는다
const now = demoClock;

// 데모는 목업 강연으로, 실제 API는 서버의 강연 상태(API-18)로 화면을 고른다
export default function AudienceLivePage() {
  const { code } = useParams<{ code: string }>();
  return DEMO ? <AudienceLive /> : <RemoteAudience code={code.toUpperCase()} />;
}

type Remote = { kind: "loading" } | { kind: "ok"; preview: JoinPreview } | { kind: "error"; failure: JoinFailure };

// 실제 API: 입장한 강연의 상태를 확인한다. 시작 전이면 10초마다 다시 확인해 시작되면 화면을 바꾼다
// (WebSocket session.updated를 붙이면 바로 바뀌게 할 수 있다)
function RemoteAudience({ code }: { code: string }) {
  const router = useRouter();
  const { name, authed, guestName } = useDemo();
  const [remote, setRemote] = useState<Remote>({ kind: "loading" });

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const preview = await getJoinPreview(code);
        if (stopped) return;
        setRemote({ kind: "ok", preview });
        // 입장 절차를 거치지 않았으면(또는 새 기기 · 만료) 입장 화면으로
        if (!preview.already_joined) return router.replace(`/join?code=${code}`);
        if (preview.status === "DRAFT") timer = setTimeout(load, 10_000);
      } catch (e) {
        if (!stopped) setRemote({ kind: "error", failure: joinFailure(e) });
      }
    };
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [code, router]);

  if (remote.kind === "loading" || (remote.kind === "ok" && !remote.preview.already_joined)) return <Screen>{null}</Screen>;

  if (remote.kind === "error") {
    const { failure } = remote;
    const member = authed && guestName === null;
    return (
      <Screen>
        {failure.ended ? (
          <Empty emoji="🏁" title="강연이 끝났어요" desc={member ? "내 질문과 요약 노트는 보관함에서 다시 볼 수 있어요." : "질문 접수가 마감됐어요. 참여해 주셔서 고마워요."}>
            <Button href={member ? "/archive" : "/"}>{member ? "보관함 보기" : "처음 화면으로"}</Button>
          </Empty>
        ) : (
          <Empty emoji="🔍" title="강연에 들어갈 수 없어요" desc={failure.message}>
            <Button href="/join">입장 코드 입력하기</Button>
          </Empty>
        )}
      </Screen>
    );
  }

  const lecture = previewToLecture(code, remote.preview);
  const who = `${guestName ?? (authed ? name : "게스트")}님`;
  if (remote.preview.status === "DRAFT") return <Waiting lecture={lecture} who={who} />;
  return <LiveEntry code={code} lecture={lecture} name={guestName ?? (authed ? name : null)} />;
}

// 진행 중 강연: 질문 · 실시간 API는 강연 ID로 부른다. 입장할 때 이 기기에 남긴 ID를 쓰고,
// 없으면(다른 기기에서 입장 · 저장소 삭제) 입장(API-19)을 다시 불러 같은 참가로 ID를 받는다.
// 회원은 쿠키로 같은 참가가 이어지고, 닉네임이 필요한 게스트는 실패하므로 입장 화면으로 보낸다
function LiveEntry({ code, lecture, name }: { code: string; lecture: Lecture; name: string | null }) {
  const router = useRouter();
  const [joined, setJoined] = useState<JoinedSession | null>(() => joinedSession(code));
  useEffect(() => {
    if (joined) return;
    let stopped = false;
    participate({ code }, crypto.randomUUID()).then(
      (p) => {
        rememberJoinedSession(code, p.session_id, p.kind);
        if (!stopped) setJoined({ sessionId: p.session_id, guest: p.kind === "GUEST" });
      },
      () => !stopped && router.replace(`/join?code=${code}`),
    );
    return () => {
      stopped = true;
    };
  }, [joined, code, router]);
  if (!joined) return <Screen>{null}</Screen>;
  const who = `${name ?? (joined.guest ? "게스트" : "회원")}님`;
  return <RemoteRoom sid={joined.sessionId} lecture={lecture} who={who} isGuest={joined.guest} />;
}

const withoutKey = <T,>(all: Record<string, T>, key: string) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== key));

// 작성 중 답변(answer.delta). 같은 생성 차례(generation_id)의 조각을 순서대로 잇는다
type Draft = { generation: string; sequence: number; text: string };

const boardOf = (q: QuestionPublic): PublicQuestion => ({
  id: q.question_id,
  text: q.content,
  page: q.document_id ? q.page_no : null,
  likes: q.vote_count,
  liked: q.voted_by_me,
  status: q.status === "COMPLETED" ? "done" : "waiting",
  at: clockOf(q.created_at),
});

// 서버 질문 + 실시간 진행 상태 → 화면의 내 질문 카드
function mineOf(q: QuestionPrivate, stage: string | undefined, draft: Draft | undefined, discarded: boolean): Mine {
  const base = { id: q.question_id, text: q.content, at: clockOf(q.created_at) };
  if (q.escalation_reason === "RETRACTED") return { ...base, state: "ai", retracted: true };
  const state = mineState(q);
  if (state === "ai" && q.answer)
    return {
      ...base,
      state,
      answer: q.answer.content ?? "",
      sources: q.answer.citations.map(citationToSource),
      feedback: q.answer.my_rating === "HELPFUL" ? "up" : q.answer.my_rating === "UNHELPFUL" ? "down" : null,
      retracted: q.answer.status === "RETRACTED",
    };
  if (state === "forwarded") return { ...base, state, discarded };
  // 처리 중: 작성 중 답변이 오고 있으면 그 글자를, 아니면 단계(근거 찾기 → 답변 쓰기)를 보여준다
  if (draft?.text) return { ...base, state: "ai", answer: draft.text, provisional: true };
  return { ...base, state: stage === "WRITING" ? "writing" : state };
}

// 질문 화면 (실제 API). 목록은 REST(API-28)로 받고, 바뀐 것은 WebSocket 이벤트로 반영한다
function RemoteRoom({ sid, lecture, who, isGuest }: { sid: string; lecture: Lecture; who: string; isGuest: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const showToast = toast.show;
  const [tab, setTab] = useState<"ask" | "board" | "mine">("ask");
  const [publicQs, setPublicQs] = useState<QuestionPublic[]>([]);
  const [mine, setMine] = useState<QuestionPrivate[]>([]);
  const [stages, setStages] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [discarded, setDiscarded] = useState<string[]>([]);
  const [ended, setEnded] = useState(false);
  const [audience, setAudience] = useState(lecture.audience);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [similar, setSimilar] = useState<QuestionPublic[]>([]);
  const [sort, setSort] = useState<"likes" | "recent">("likes");
  const [page, setPage] = useState<"all" | number | null>("all");
  const [noteFor, setNoteFor] = useState<QuestionPublic | null>(null);
  // 보내기에 실패한 질문을 다시 보낼 때 같은 키를 써서 두 번 등록되지 않게 한다
  const attempt = useRef<{ text: string; key: string } | null>(null);

  const upsertMine = useCallback((q: QuestionPrivate) => {
    setMine((list) => (list.some((x) => x.question_id === q.question_id) ? list.map((x) => (x.question_id === q.question_id ? q : x)) : [q, ...list]));
  }, []);

  const reload = useCallback(async () => {
    try {
      const [pub, my] = await Promise.all([listQuestions(sid, "public", { sort: "votes" }), listQuestions(sid, "mine", { sort: "latest" })]);
      setPublicQs(pub.items);
      setMine(my.items);
    } catch (e) {
      // 강연이 끝나 질문 목록이 닫혔으면 종료 화면으로
      if (e instanceof Error && "code" in e && (e as { code: string }).code === "SESSION_ENDED") return setEnded(true);
      showToast(questionErrorMessage(e), "coral");
    }
  }, [sid, showToast]);

  useEffect(() => {
    // 첫 목록. 화면이 열려 있는 동안의 변화는 아래 실시간 이벤트로 받는다
    let stopped = false;
    Promise.all([listQuestions(sid, "public", { sort: "votes" }), listQuestions(sid, "mine", { sort: "latest" })]).then(
      ([pub, my]) => {
        if (stopped) return;
        setPublicQs(pub.items);
        setMine(my.items);
      },
      (e) => !stopped && showToast(questionErrorMessage(e), "coral"),
    );
    return () => {
      stopped = true;
    };
  }, [sid, showToast]);

  const refetch = useCallback(
    (qid: string) =>
      getQuestion(sid, qid).then(
        (q) => {
          upsertMine(q);
          setDrafts((all) => withoutKey(all, qid));
        },
        () => {},
      ),
    [sid, upsertMine],
  );

  const onEvent = useCallback(
    (e: LiveEvent) => {
      const d = e.data;
      const qid = typeof d.question_id === "string" ? d.question_id : "";
      switch (e.type) {
        case "session.updated":
          if (typeof d.participant_count === "number") setAudience(d.participant_count);
          if (d.status === "ENDED" || d.status === "PURGED") setEnded(true);
          return;
        case "public_question.updated": {
          const q = d as unknown as Omit<QuestionPublic, "voted_by_me" | "my_note">;
          setPublicQs((list) => {
            const prev = list.find((x) => x.question_id === q.question_id);
            if (!isPublic(q.status)) return list.filter((x) => x.question_id !== q.question_id);
            const next = { voted_by_me: false, my_note: null, ...prev, ...q };
            return prev ? list.map((x) => (x.question_id === q.question_id ? next : x)) : [...list, next];
          });
          setMine((list) => list.map((x) => (x.question_id === q.question_id ? { ...x, vote_count: q.vote_count, status: q.status, version: q.version } : x)));
          return;
        }
        case "question.updated":
          // 처리 중 단계는 바로 반영하고, 결과(답변 · 전달)는 질문을 다시 받아 답변 · 인용까지 채운다
          if (d.status === "QUEUED" || d.status === "PROCESSING") {
            setMine((list) => list.map((x) => (x.question_id === qid ? { ...x, status: d.status as QuestionPrivate["status"] } : x)));
            if (!mine.some((x) => x.question_id === qid)) void refetch(qid);
          } else void refetch(qid);
          return;
        case "question.progress":
          if (typeof d.stage === "string") setStages((s) => ({ ...s, [qid]: d.stage as string }));
          return;
        case "answer.delta": {
          const generation = String(d.generation_id ?? "");
          const sequence = Number(d.sequence ?? 0);
          const piece = typeof d.text === "string" ? d.text : "";
          setDrafts((all) => {
            const cur = all[qid];
            if (cur && cur.generation === generation && sequence <= cur.sequence) return all;
            const base = cur && cur.generation === generation ? cur.text : "";
            return { ...all, [qid]: { generation, sequence, text: base + piece } };
          });
          return;
        }
        case "answer.discarded":
          setDrafts((all) => withoutKey(all, qid));
          setDiscarded((list) => [...list, qid]);
          return;
        case "answer.completed":
        case "answer.retracted":
          void refetch(qid);
          return;
      }
    },
    [mine, refetch],
  );

  const live = useLiveEvents(ended ? null : sid, {
    onEvent,
    onReconnect: reload,
    // 입장이 만료 · 취소됐다(1008). 강연이 끝나서 닫힌 경우는 종료 화면을 그대로 둔다
    onDenied: () => !ended && router.replace(`/join?code=${lecture.code}`),
  });

  // 입력 중 비슷한 공개 질문 (API-26). 잠깐 멈추면 묻고, 더 입력하면 이전 요청은 버린다
  const typed = text.trim();
  useEffect(() => {
    if (ended || typed.length < 4) return;
    const ctrl = new AbortController();
    const t = setTimeout(
      () =>
        searchSimilar(sid, typed, ctrl.signal).then(
          (r) => setSimilar(r.items.map((x) => x.question)),
          () => {},
        ),
      400,
    );
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [sid, typed, ended]);
  const shownSimilar = typed.length < 4 ? [] : similar;

  function patchPublic(qid: string, patch: Partial<QuestionPublic>) {
    setPublicQs((list) => list.map((x) => (x.question_id === qid ? { ...x, ...patch } : x)));
    setSimilar((list) => list.map((x) => (x.question_id === qid ? { ...x, ...patch } : x)));
  }

  // 공감 (API-30) · 공감 취소 (API-31). 누르자마자 바꾸고, 실패하면 되돌린다
  async function like(q: QuestionPublic) {
    if (ended) return;
    const on = !q.voted_by_me;
    patchPublic(q.question_id, { voted_by_me: on, vote_count: Math.max(0, q.vote_count + (on ? 1 : -1)) });
    try {
      if (on) {
        const r = await vote(sid, q.question_id);
        patchPublic(q.question_id, { vote_count: r.vote_count });
      } else await unvote(sid, q.question_id);
    } catch (e) {
      patchPublic(q.question_id, { voted_by_me: q.voted_by_me, vote_count: q.vote_count });
      showToast(questionErrorMessage(e), "coral");
    }
  }

  async function mergeInto(q: QuestionPublic) {
    if (!q.voted_by_me) await like(q);
    setText("");
    showToast("같은 질문에 공감으로 합쳤어요 💛", "coral");
  }

  // 질문 등록 (API-27)
  async function submit() {
    const t = text.trim();
    if (ended) return showToast("강연이 끝나 더 이상 질문할 수 없어요");
    if (!t || t.length > Q_MAX || sending) return;
    const key = attempt.current?.text === t ? attempt.current.key : crypto.randomUUID();
    attempt.current = { text: t, key };
    setSending(true);
    try {
      const job = await submitQuestion(sid, t, key);
      attempt.current = null;
      setText("");
      setTab("mine");
      // 이벤트보다 먼저 카드를 띄우고, 서버 질문으로 바로 채운다
      upsertMine({
        question_id: job.resource_id,
        content: t,
        status: "QUEUED",
        document_id: null,
        page_no: null,
        vote_count: 0,
        version: 1,
        created_at: new Date().toISOString(),
        voted_by_me: false,
        my_note: null,
        escalation_reason: null,
        answer: null,
        processing_error: null,
      });
      void refetch(job.resource_id);
    } catch (e) {
      if (e instanceof Error && "code" in e && (e as { code: string }).code === "SESSION_NOT_LIVE") setEnded(true);
      showToast(questionErrorMessage(e), "coral");
    } finally {
      setSending(false);
    }
  }

  // AI 답변 평가 (API-34). 평가는 지울 수 없고 바꿀 수만 있다
  async function rate(q: QuestionPrivate, f: "up" | "down") {
    if (!q.answer) return;
    const rating = f === "up" ? "HELPFUL" : "UNHELPFUL";
    if (q.answer.my_rating === rating) return;
    const prev = q.answer.my_rating;
    const set = (r: typeof prev) => setMine((list) => list.map((x) => (x.question_id === q.question_id && x.answer ? { ...x, answer: { ...x.answer, my_rating: r } } : x)));
    set(rating);
    try {
      await rateAnswer(sid, q.question_id, q.answer.answer_id, rating);
    } catch (e) {
      set(prev);
      showToast(questionErrorMessage(e), "coral");
    }
  }

  const boards = publicQs.map(boardOf);
  const pages = [...new Set(boards.map((q) => q.page))].sort((a, b) => (a ?? 999) - (b ?? 999));
  const shown = publicQs
    .filter((q) => page === "all" || (q.document_id ? q.page_no : null) === page)
    .sort((a, b) => (sort === "likes" ? b.vote_count - a.vote_count || a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)));

  if (ended && isGuest) return <GuestEnded lecture={lecture} who={who} />;

  return (
    <Screen>
      {toast.node}
      <header className="px-5 pt-5">
        <RoomHeader
          who={who}
          badge={
            <span className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-semibold">
              <span className={`h-1.5 w-1.5 rounded-full ${ended ? "bg-ink/30" : "animate-pulse bg-coral"}`} />
              {ended ? "종료됨" : `LIVE · ${audience}명`}
            </span>
          }
        />
        <div className="mt-6 flex items-end justify-between gap-3">
          <h1 className="text-[32px] font-extrabold leading-[1.08] tracking-[-0.05em]">{lecture.title}</h1>
          <Sticker size={46} rotate={10} className="shrink-0">
            {lecture.emoji}
          </Sticker>
        </div>
        {live === "closed" && !ended && <p className="mt-2 text-xs font-semibold text-coral-ink">실시간 연결이 끊겨 다시 연결하는 중이에요…</p>}
      </header>

      <div className="flex flex-1 flex-col px-5 pt-5">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "ask", label: "질문하기" },
            { value: "board", label: "모두의 질문", count: publicQs.length },
            { value: "mine", label: "내 질문", count: mine.length },
          ]}
        />

        {ended && (
          <div className="mt-4 flex items-center gap-3 rounded-[22px] bg-ink p-4 text-sm text-white">
            <Sticker size={28} rotate={-8}>
              📦
            </Sticker>
            <div className="min-w-0 flex-1">
              <p className="font-bold">강연이 끝났어요. 질문과 요약 노트는 내 보관함에서 볼 수 있어요</p>
            </div>
            <Button size="sm" variant="white" href="/archive">
              내 보관함에서 보기
            </Button>
          </div>
        )}

        {tab === "ask" && (
          <div className="animate-rise pb-8">
            <div className="mt-4 rounded-[26px] bg-white p-4">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, Q_MAX))}
                maxLength={Q_MAX}
                rows={4}
                disabled={ended}
                aria-label="질문 입력"
                placeholder={ended ? "강연이 끝나 질문을 받지 않아요" : "궁금한 걸 편하게 적어보세요. 교안 내용이면 AI가 먼저 답해줘요."}
                className="w-full resize-none bg-transparent text-[17px] leading-relaxed outline-none placeholder:text-ink/30"
              />
              <div className="flex items-center justify-between pt-2">
                <span className={`text-xs tabular-nums ${text.length >= Q_MAX ? "font-semibold text-coral-ink" : "text-muted"}`}>
                  {text.length} / {Q_MAX}
                </span>
                <Button size="sm" icon="send" onClick={submit} disabled={!text.trim() || ended || sending}>
                  {sending ? "보내는 중…" : "보내기"}
                </Button>
              </div>
            </div>

            {shownSimilar.length > 0 ? (
              <div className="mt-6 animate-rise">
                <p className="mb-3 text-[15px] font-bold">혹시 이 질문과 같나요?</p>
                <div className="space-y-2">
                  {shownSimilar.map((q) => (
                    <div key={q.question_id} className="flex items-center gap-3 rounded-[22px] bg-white p-3 pl-4">
                      <p className="flex-1 text-sm leading-snug">{q.content}</p>
                      <button
                        onClick={() => mergeInto(q)}
                        aria-pressed={q.voted_by_me}
                        className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-2 text-xs font-semibold ${q.voted_by_me ? "bg-coral text-ink" : "bg-ink text-white"}`}
                      >
                        <Icon name="heart" size={14} />
                        공감 {q.vote_count}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-8">
                <p className="text-[22px] font-bold leading-[1.45] tracking-[-0.035em] text-ink/35">
                  질문을 보내면 교안과 강연 발화에서 <span className="text-ink">근거를 찾고</span> <Sticker size={24} rotate={-8}>🔎</Sticker>, 충분하면{" "}
                  <span className="text-ink">AI가 나에게만</span> 답해요. 아니면 <span className="text-ink">강연자에게 전달</span>{" "}
                  <Sticker size={24} rotate={8}>📮</Sticker> 돼요.
                </p>
              </div>
            )}
          </div>
        )}

        {tab === "board" && (
          <div className="animate-rise pb-10">
            <div className="mt-5 flex items-center justify-between">
              <p className="text-sm text-muted">강연자에게 전달된 질문</p>
              <div className="flex gap-1 text-sm">
                {(["likes", "recent"] as const).map((s) => (
                  <button key={s} onClick={() => setSort(s)} aria-pressed={sort === s} className={`rounded-full px-3 py-1.5 font-semibold ${sort === s ? "bg-sand text-ink" : "text-muted"}`}>
                    {s === "likes" ? "공감순" : "최신순"}
                  </button>
                ))}
              </div>
            </div>
            {pages.length > 1 && (
              <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto" role="group" aria-label="교안 페이지 필터">
                {(["all", ...pages] as const).map((p) => (
                  <button
                    key={String(p)}
                    onClick={() => setPage(p)}
                    aria-pressed={page === p}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${page === p ? "bg-ink text-white" : "bg-white text-ink/60"}`}
                  >
                    {p === "all" ? "전체 페이지" : p === null ? "일반" : `교안 p.${p}`}
                  </button>
                ))}
              </div>
            )}
            {ended && <p className="mt-3 text-xs text-muted">강연이 끝나 공감은 더 할 수 없어요.</p>}
            <div className="mt-4">
              {shown.length === 0 && <Empty title="아직 전달된 질문이 없어요" emoji="💬" />}
              {shown.map((q, i) => (
                <BoardBubble
                  key={q.question_id}
                  q={boardOf(q)}
                  i={i}
                  total={shown.length}
                  ended={ended}
                  note={isGuest ? "" : (q.my_note?.content ?? "")}
                  canNote={!isGuest}
                  onLike={() => like(q)}
                  onNote={() => setNoteFor(q)}
                />
              ))}
            </div>
          </div>
        )}

        {tab === "mine" && (
          <div className="animate-rise space-y-3 pb-8 pt-4">
            {mine.length === 0 && <Empty title="아직 보낸 질문이 없어요" desc="궁금한 게 생기면 언제든 물어보세요!" emoji="💭" />}
            {mine.map((q) => {
              const pub = publicQs.find((p) => p.question_id === q.question_id);
              return (
                <MyQuestion
                  key={q.question_id}
                  sid={sid}
                  q={mineOf(q, stages[q.question_id], drafts[q.question_id], discarded.includes(q.question_id))}
                  pub={boardOf(pub ?? q)}
                  onUpdate={(patch) => patch.feedback && rate(q, patch.feedback)}
                />
              );
            })}
          </div>
        )}
      </div>

      {noteFor && (
        <NoteModal
          open
          onClose={() => setNoteFor(null)}
          questionId={noteFor.question_id}
          questionText={noteFor.content}
          initial={noteFor.my_note?.content ?? ""}
          save={async (t) => {
            try {
              const note = t ? await saveNote(sid, noteFor.question_id, t) : (await deleteNote(sid, noteFor.question_id), null);
              patchPublic(noteFor.question_id, { my_note: note });
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

function AudienceLive() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const { name, authed, guestName, endedLectures, startedLectures, codes, joinedCode } = useDemo();
  const { lecture, expired } = resolveCode(code, codes);
  const status = lecture ? statusOf(lecture, endedLectures, startedLectures) : null;
  const isGuest = guestName !== null;
  const full = !!lecture && status === "live" && lecture.audience >= SESSION_CAPACITY;
  // 입장 절차(회원 / 게스트 선택 · 로그인 또는 닉네임 · 동의)를 거치지 않고 QR로 바로 왔으면 입장 화면으로 보낸다 (F1-7)
  const needsEntry = !!lecture && !expired && !full && (joinedCode?.toUpperCase() !== code.toUpperCase() || (!isGuest && !authed));
  // 이 화면에 들어올 때 이미 끝난 강연이면 회원은 보관함으로 보낸다. 참여 중에 끝나면 화면에 남아 보관함 안내를 본다
  const [endedOnEntry] = useState(status === "ended");
  const goArchive = !needsEntry && !isGuest && endedOnEntry;
  useEffect(() => {
    if (needsEntry) router.replace(`/join?code=${code.toUpperCase()}`);
    else if (goArchive && lecture) router.replace(archiveHrefFor(lecture.id));
  }, [needsEntry, goArchive, code, lecture, endedLectures, router]);

  if (needsEntry || goArchive) return <Screen>{null}</Screen>;

  if (!lecture || expired || full) {
    const [emoji, title, desc] = !lecture
      ? ["🔍", "입장 코드를 찾을 수 없어요", "코드를 다시 확인하거나 강연자에게 QR을 요청해 주세요."]
      : expired
        ? ["🔄", "더 이상 쓸 수 없는 QR이에요", "강연자가 QR을 새로 발급했어요. 강연장 화면의 새 QR이나 코드로 들어와 주세요."]
        : ["🪑", "정원이 다 찬 강연이에요", `이 강연은 ${SESSION_CAPACITY}명까지 들어올 수 있어요. 자리가 나면 다시 들어와 주세요.`];
    return (
      <Screen>
        <Empty emoji={emoji} title={title} desc={desc}>
          <Button href="/join">입장 코드 입력하기</Button>
        </Empty>
      </Screen>
    );
  }

  const who = `${isGuest ? guestName : name}님`;
  // 게스트는 강연이 끝나면 종료 안내만 본다
  if (status === "ended" && isGuest) return <GuestEnded lecture={lecture} who={who} />;
  if (status === "ready") return <Waiting lecture={lecture} who={who} />;
  return <Room lecture={lecture} who={who} isGuest={isGuest} ended={status === "ended"} />;
}

// 화면 위쪽: 나가기 · 강연 상태 · 내 이름(게스트는 닉네임)
// 나가기: 회원은 홈, 게스트는 시작 화면으로
function RoomHeader({ who, badge }: { who: string; badge: React.ReactNode }) {
  const isGuest = useDemo().guestName !== null;
  return (
    <div className="flex items-center justify-between gap-2">
      <RoundButton href={isGuest ? "/" : "/home"} icon="back" label="나가기" />
      {badge}
      <span className="flex max-w-[40%] items-center gap-1.5 truncate rounded-full bg-white px-3 py-1.5 text-sm font-semibold">
        <Icon name="user" size={14} className="shrink-0" />
        <span className="truncate">{who}</span>
      </span>
    </div>
  );
}

// 강연 대기 (DRAFT). 강연자가 시작하면 같은 주소에서 질문 화면으로 바뀐다
function Waiting({ lecture, who }: { lecture: Lecture; who: string }) {
  return (
    <Screen>
      <header className="px-5 pt-5">
        <RoomHeader
          who={who}
          badge={
            <span className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-semibold">
              <span className="h-1.5 w-1.5 rounded-full bg-honey" /> 시작 전
            </span>
          }
        />
      </header>
      <div className="flex flex-1 flex-col px-5 pb-10 pt-6">
        <Bubble tone={lecture.tone}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[24px] font-extrabold leading-tight tracking-[-0.04em]">{lecture.title}</p>
              <p className="mt-1 text-sm text-ink/60">
                {lecture.date} {lecture.time} 시작 예정
              </p>
              {lecture.desc && <p className="mt-2 text-sm text-ink/75">{lecture.desc}</p>}
            </div>
            <Sticker size={44} rotate={10}>
              {lecture.emoji}
            </Sticker>
          </div>
        </Bubble>
        <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
          <Sticker size={72} rotate={-8} float>
            ⏳
          </Sticker>
          <p className="mt-6 text-[24px] font-extrabold tracking-[-0.04em]">강연 시작을 기다리고 있어요</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            강연자가 강연을 시작하면
            <br />
            이 화면이 바로 질문 화면으로 바뀌어요.
          </p>
          <div className="mt-5 flex gap-1.5" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-2.5 w-2.5 animate-bounce rounded-full bg-ink" style={{ animationDelay: `${i * 150}ms` }} />
            ))}
          </div>
        </div>
        {/* 데모: 다른 기기의 강연자가 시작한 것처럼 바꾼다 */}
        {DEMO && (
          <button onClick={() => setDemo((s) => ({ startedLectures: [...s.startedLectures, lecture.id] }))} className="mx-auto text-xs text-muted underline underline-offset-4">
            데모 · 강연자가 강연을 시작한 상황 보기
          </button>
        )}
      </div>
    </Screen>
  );
}

// 게스트 강연 종료 안내. 게스트는 보관함이 없어 종료 사실만 알린다
function GuestEnded({ lecture, who }: { lecture: Lecture; who: string }) {
  return (
    <Screen>
      <div className="flex flex-1 flex-col items-center px-8 pt-24 text-center">
        <Sticker size={88} rotate={-8} float>
          🏁
        </Sticker>
        <p className="mt-8 text-sm font-semibold text-muted">{who}, 참여해 주셔서 고마워요</p>
        <h1 className="mt-2 text-[32px] font-extrabold leading-tight tracking-[-0.05em]">강연이 끝났어요</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          <b className="text-ink">{lecture.title}</b>
          <br />
          질문 접수가 마감됐어요.
        </p>
        <div className="mt-auto w-full pb-10">
          <Button href="/" size="lg" variant="white" className="w-full">
            처음 화면으로
          </Button>
        </div>
      </div>
    </Screen>
  );
}

// 질문 화면 (LIVE). 참여 중에 강연이 끝나면 회원은 이 화면에서 보관함 안내를 본다
function Room({ lecture, who, isGuest, ended }: { lecture: Lecture; who: string; isGuest: boolean; ended: boolean }) {
  const toast = useToast();
  const { memos } = useDemo();
  // 데모 질문은 트랜스포머 강연(l1)에만 있다
  const seeded = lecture.id === "l1";
  const [tab, setTab] = useState<"ask" | "board" | "mine">("ask");
  const [publicQs, setPublicQs] = useState<PublicQuestion[]>(seeded ? livePublicQuestions : []);
  const [mine, setMine] = useState<Mine[]>(() =>
    seeded
      ? [
          ...liveAiQuestions.filter((q) => q.mine).map((q) => ({ id: q.id, text: q.text, at: q.at, state: "ai" as const, answer: q.answer, sources: q.sources, feedback: null })),
          ...livePublicQuestions.filter((q) => q.mine).map((q) => ({ id: q.id, text: q.text, at: q.at, state: "forwarded" as const })),
        ]
      : [],
  );
  const [text, setText] = useState("");
  const [sort, setSort] = useState<"likes" | "recent">("likes");
  const [page, setPage] = useState<"all" | number | null>("all");
  const [noteFor, setNoteFor] = useState<PublicQuestion | null>(null);

  // 실시간 이벤트 시뮬레이션: 다른 청중의 공감, 강연자 답변 완료, AI 답변 철회.
  // 따로 알림을 보내지 않고 목록 · 내 질문 화면의 상태로만 반영한다 (F5-6 삭제)
  useEffect(() => {
    if (ended || !seeded) return;
    const likeTimer = setInterval(() => {
      setPublicQs((qs) => {
        const waiting = qs.filter((q) => q.status === "waiting");
        if (!waiting.length) return qs;
        const pick = waiting[Math.floor(Math.random() * waiting.length)].id;
        return qs.map((q) => (q.id === pick ? { ...q, likes: q.likes + 1 } : q));
      });
    }, 3500);
    const doneTimer = setTimeout(() => {
      setPublicQs((qs) => qs.map((q) => (q.id === "p2" ? { ...q, status: "done" } : q)));
    }, 12000);
    const retractTimer = setTimeout(() => {
      setMine((m) => m.map((q) => (q.id === "a2" ? { ...q, retracted: true } : q)));
    }, 24000);
    return () => {
      clearInterval(likeTimer);
      clearTimeout(doneTimer);
      clearTimeout(retractTimer);
    };
  }, [ended, seeded]);

  // 입력 중 비슷한 공개 질문 최대 3개를 먼저 보여준다
  const similar = useMemo(() => {
    const words = text
      .replace(/[?.!,]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 2);
    if (!words.length) return [];
    return publicQs
      .map((q) => ({ q, hit: words.filter((w) => q.text.toLowerCase().includes(w.toLowerCase().slice(0, 3))).length }))
      .filter((x) => x.hit > 0)
      .sort((a, b) => b.hit - a.hit)
      .slice(0, 3)
      .map((x) => x.q);
  }, [text, publicQs]);

  function like(id: string) {
    if (ended) return;
    // 1인 1회. 다시 누르면 공감을 취소한다
    setPublicQs((qs) => qs.map((x) => (x.id === id ? { ...x, liked: !x.liked, likes: x.likes + (x.liked ? -1 : 1) } : x)));
  }

  function mergeInto(id: string) {
    if (!publicQs.find((x) => x.id === id)?.liked) like(id);
    setText("");
    toast.show("같은 질문에 공감으로 합쳤어요 💛", "coral");
  }

  function update(id: string, patch: Partial<Mine>) {
    setMine((m) => m.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  }

  function submit() {
    const t = text.trim();
    if (ended) return toast.show("강연이 끝나 더 이상 질문할 수 없어요");
    if (!t || t.length > Q_MAX) return;

    const id = crypto.randomUUID();
    setMine((m) => [{ id, text: t, at: now(), state: "searching" }, ...m]);
    setText("");
    setTab("mine");

    const hit = cannedAnswers.find((c) => c.keys.some((k) => t.toLowerCase().includes(k)));
    const draft = !hit && discardedDrafts.find((c) => c.keys.some((k) => t.includes(k)));
    const forward = () => setPublicQs((qs) => [...qs, { id, text: t, page: 26, likes: 0, status: "waiting", at: now(), mine: true, liked: false }]);
    setTimeout(() => update(id, { state: "writing" }), 1300);
    setTimeout(() => {
      if (draft) {
        // answer.delta로 작성 중 표시를 하다가 answer.discarded가 오면 글자를 지우고 전달됨으로 바꾼다
        update(id, { state: "ai", answer: draft.draft, feedback: null, streaming: true, provisional: true });
        setTimeout(() => {
          update(id, { state: "forwarded", answer: undefined, streaming: false, provisional: false, discarded: true });
          forward();
        }, 1600);
      } else if (hit) {
        update(id, { state: "ai", answer: hit.answer, sources: hit.sources, feedback: null, streaming: true });
      } else {
        // 근거가 부족하면 답변 대신 강연자에게 전달한다 (F4-5)
        update(id, { state: "forwarded" });
        forward();
      }
    }, 2600);
  }

  const pages = [...new Set(publicQs.map((q) => q.page))].sort((a, b) => (a ?? 999) - (b ?? 999));
  const shown = publicQs
    .filter((q) => page === "all" || q.page === page)
    .sort((a, b) => (sort === "likes" ? b.likes - a.likes : b.at.localeCompare(a.at)));

  return (
    <Screen>
      {toast.node}
      <header className="px-5 pt-5">
        <RoomHeader
          who={who}
          badge={
            <span className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-semibold">
              <span className={`h-1.5 w-1.5 rounded-full ${ended ? "bg-ink/30" : "animate-pulse bg-coral"}`} />
              {ended ? "종료됨" : `LIVE · ${lecture.audience}명`}
            </span>
          }
        />
        <div className="mt-6 flex items-end justify-between gap-3">
          <h1 className="text-[32px] font-extrabold leading-[1.08] tracking-[-0.05em]">{lecture.title}</h1>
          <Sticker size={46} rotate={10} className="shrink-0">
            {lecture.emoji}
          </Sticker>
        </div>
        {lecture.file && <p className="mt-2 text-sm text-muted">교안 {lecture.file.pages}쪽</p>}
      </header>

      <div className="flex flex-1 flex-col px-5 pt-5">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "ask", label: "질문하기" },
            { value: "board", label: "모두의 질문", count: publicQs.length },
            { value: "mine", label: "내 질문", count: mine.length },
          ]}
        />

        {ended && (
          <div className="mt-4 flex items-center gap-3 rounded-[22px] bg-ink p-4 text-sm text-white">
            <Sticker size={28} rotate={-8}>
              📦
            </Sticker>
            <div className="min-w-0 flex-1">
              <p className="font-bold">강연이 끝났어요. 질문과 요약 노트는 내 보관함에서 볼 수 있어요</p>
            </div>
            <Button size="sm" variant="white" href={archiveHrefFor(lecture.id)}>
              내 보관함에서 보기
            </Button>
          </div>
        )}

        {/* 질문하기 */}
        {tab === "ask" && (
          <div className="animate-rise pb-8">
            <div className="mt-4 rounded-[26px] bg-white p-4">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, Q_MAX))}
                maxLength={Q_MAX}
                rows={4}
                disabled={ended}
                aria-label="질문 입력"
                placeholder={ended ? "강연이 끝나 질문을 받지 않아요" : "궁금한 걸 편하게 적어보세요. 교안 내용이면 AI가 먼저 답해줘요."}
                className="w-full resize-none bg-transparent text-[17px] leading-relaxed outline-none placeholder:text-ink/30"
              />
              <div className="flex items-center justify-between pt-2">
                <span className={`text-xs tabular-nums ${text.length >= Q_MAX ? "font-semibold text-coral-ink" : "text-muted"}`}>
                  {text.length} / {Q_MAX}
                </span>
                <Button size="sm" icon="send" onClick={submit} disabled={!text.trim() || ended}>
                  보내기
                </Button>
              </div>
            </div>

            {similar.length > 0 ? (
              <div className="mt-6 animate-rise">
                <p className="mb-3 text-[15px] font-bold">혹시 이 질문과 같나요?</p>
                <div className="space-y-2">
                  {similar.map((q) => (
                    <div key={q.id} className="flex items-center gap-3 rounded-[22px] bg-white p-3 pl-4">
                      <p className="flex-1 text-sm leading-snug">{q.text}</p>
                      <button
                        onClick={() => mergeInto(q.id)}
                        aria-pressed={!!q.liked}
                        className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-2 text-xs font-semibold ${q.liked ? "bg-coral text-ink" : "bg-ink text-white"}`}
                      >
                        <Icon name="heart" size={14} />
                        공감 {q.likes}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-8">
                <p className="text-[22px] font-bold leading-[1.45] tracking-[-0.035em] text-ink/35">
                  질문을 보내면 교안과 강연 발화에서 <span className="text-ink">근거를 찾고</span> <Sticker size={24} rotate={-8}>🔎</Sticker>, 충분하면{" "}
                  <span className="text-ink">AI가 나에게만</span> 답해요. 아니면 <span className="text-ink">강연자에게 전달</span>{" "}
                  <Sticker size={24} rotate={8}>📮</Sticker> 돼요.
                </p>
              </div>
            )}
          </div>
        )}

        {/* 모두의 질문: 작성자는 보여주지 않는다 */}
        {tab === "board" && (
          <div className="animate-rise pb-10">
            <div className="mt-5 flex items-center justify-between">
              <p className="text-sm text-muted">강연자에게 전달된 질문</p>
              <div className="flex gap-1 text-sm">
                {(["likes", "recent"] as const).map((s) => (
                  <button key={s} onClick={() => setSort(s)} aria-pressed={sort === s} className={`rounded-full px-3 py-1.5 font-semibold ${sort === s ? "bg-sand text-ink" : "text-muted"}`}>
                    {s === "likes" ? "공감순" : "최신순"}
                  </button>
                ))}
              </div>
            </div>
            {pages.length > 1 && (
              <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto" role="group" aria-label="교안 페이지 필터">
                {(["all", ...pages] as const).map((p) => (
                  <button
                    key={String(p)}
                    onClick={() => setPage(p)}
                    aria-pressed={page === p}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${page === p ? "bg-ink text-white" : "bg-white text-ink/60"}`}
                  >
                    {p === "all" ? "전체 페이지" : p === null ? "일반" : `교안 p.${p}`}
                  </button>
                ))}
              </div>
            )}
            {ended && <p className="mt-3 text-xs text-muted">강연이 끝나 공감은 더 할 수 없어요.</p>}
            <div className="mt-4">
              {shown.length === 0 && <Empty title="아직 전달된 질문이 없어요" emoji="💬" />}
              {shown.map((q, i) => (
                <BoardBubble key={q.id} q={q} i={i} total={shown.length} ended={ended} note={isGuest ? "" : (memos[q.id] ?? "")} canNote={!isGuest} onLike={() => like(q.id)} onNote={() => setNoteFor(q)} />
              ))}
            </div>
          </div>
        )}

        {/* 내 질문 */}
        {tab === "mine" && (
          <div className="animate-rise space-y-3 pb-8 pt-4">
            {mine.length === 0 && <Empty title="아직 보낸 질문이 없어요" desc="궁금한 게 생기면 언제든 물어보세요!" emoji="💭" />}
            {mine.map((q) => (
              <MyQuestion key={q.id} q={q} pub={publicQs.find((p) => p.id === q.id)} onUpdate={(patch) => update(q.id, patch)} />
            ))}
          </div>
        )}
      </div>

      {noteFor && <NoteModal open onClose={() => setNoteFor(null)} questionId={noteFor.id} questionText={noteFor.text} initial={memos[noteFor.id] ?? ""} onSaved={(t) => toast.show(t ? "필기를 저장했어요" : "필기를 지웠어요", "mint")} />}
    </Screen>
  );
}

function MyQuestion({ q, pub, onUpdate, sid }: { q: Mine; pub?: PublicQuestion; onUpdate: (patch: Partial<Mine>) => void; sid?: string }) {
  return (
    <div className="animate-rise rounded-[26px] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[16px] font-bold leading-snug">{q.text}</p>
        <span className="shrink-0 pt-0.5 text-xs text-muted">{q.at}</span>
      </div>

      {(q.state === "searching" || q.state === "writing") && <Progress2 step={q.state === "searching" ? 0 : 1} />}

      {q.state === "ai" && q.retracted && (
        <div className="mt-3 rounded-[20px] bg-coral/15 p-4">
          <p className="inline-flex items-center gap-1 rounded-full bg-white/70 px-3 py-1.5 text-xs font-semibold">↩︎ AI 답변 철회됨</p>
          <p className="mt-2 text-[15px] font-bold">강연자가 직접 설명합니다</p>
        </div>
      )}

      {q.state === "ai" && !q.retracted && (
        <div className="mt-3 rounded-[20px] bg-mint/18 p-4">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[10px] text-white">✦</span>
            AI 답변 · 나에게만 보여요
            {(q.streaming || q.provisional) && (
              <span className="ml-auto flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 font-semibold text-ink/60">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink/60" /> 작성 중
              </span>
            )}
          </p>
          <p className="text-[15px] leading-relaxed">{q.streaming ? <StreamText text={q.answer ?? ""} onDone={() => onUpdate({ streaming: false })} /> : q.answer}</p>
          {!q.streaming && !q.provisional && (
            <>
              <SourceChips sources={q.sources ?? []} sid={sid} />
              <div className="mt-3 flex items-center gap-1.5 border-t border-ink/10 pt-3">
                <span className="flex-1 text-xs text-ink/55">{q.feedback ? "피드백 고마워요!" : "도움이 됐나요?"}</span>
                {(["up", "down"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => onUpdate({ feedback: q.feedback === f ? null : f })}
                    aria-pressed={q.feedback === f}
                    className={`flex h-9 items-center gap-1 rounded-full px-3 text-sm font-semibold transition-colors ${q.feedback === f ? "bg-ink text-white" : "bg-white/70 text-ink/60"}`}
                  >
                    <Icon name={f} size={15} />
                    {f === "up" ? "도움됨" : "부족해요"}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {q.state === "forwarded" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-honey/35 px-3 py-1.5 text-xs font-semibold">📮 강연자에게 전달됨</span>
          {pub?.status === "done" && <span className="inline-flex items-center gap-1 rounded-full bg-mint/25 px-3 py-1.5 text-xs font-semibold">✓ 답변 완료</span>}
          <span className="text-xs text-muted">공감 {pub?.likes ?? 0}</span>
          {q.discarded && <p className="w-full text-xs text-muted">작성 중이던 AI 답변은 근거가 부족해 지웠어요.</p>}
        </div>
      )}
    </div>
  );
}

// 질문 처리 2단계 진행 표시
function Progress2({ step }: { step: 0 | 1 }) {
  const steps = ["근거를 찾는 중…", "답변을 작성하는 중…"];
  return (
    <div className="mt-3 rounded-2xl bg-paper p-3" role="status">
      <div className="flex items-center gap-3">
        <Sticker size={26} className="animate-spin [animation-duration:2.4s]">
          {step === 0 ? "🔎" : "✍️"}
        </Sticker>
        <p className="text-sm font-semibold">{steps[step]}</p>
        <span className="ml-auto text-xs text-muted">{step + 1} / 2</span>
      </div>
      <div className="mt-2.5 flex gap-1.5">
        {steps.map((s, i) => (
          <span key={s} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-ink" : "bg-ink/10"}`} />
        ))}
      </div>
    </div>
  );
}

function BoardBubble({ q, i, total, ended, note, canNote, onLike, onNote }: { q: PublicQuestion; i: number; total: number; ended: boolean; note: string; canNote: boolean; onLike: () => void; onNote: () => void }) {
  const done = q.status === "done";
  return (
    <Bubble
      tone={toneCycle[i % toneCycle.length]}
      tail={i % 2 === 0 ? "left" : "right"}
      muted={done}
      className={`animate-rise ${i > 0 ? "-mt-1" : ""} mb-[18px]`}
      style={{ zIndex: total - i }}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink/55">
            <b className="text-ink">{q.page ? `교안 p.${q.page}` : "일반"}</b>
            {q.at}
            {done && <span className="rounded-full bg-ink px-2 py-0.5 font-bold text-white">✓ 답변 완료</span>}
            {q.liked && <span className="rounded-full bg-white/70 px-2 py-0.5 font-bold text-ink">💛 내가 공감</span>}
          </p>
          <p className="mt-1 text-[15px] leading-snug">{q.text}</p>
        </div>
        {ended ? (
          <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-full bg-white/40 text-ink/60" aria-label={`공감 ${q.likes}`}>
            <Icon name="heart" size={15} />
            <span className="text-xs font-bold leading-none">{q.likes}</span>
          </span>
        ) : (
          <button
            onClick={onLike}
            aria-label={q.liked ? `공감 취소 · 공감 ${q.likes}` : `공감 · 공감 ${q.likes}`}
            aria-pressed={!!q.liked}
            className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-full transition-all ${q.liked ? "bg-ink text-white" : "bg-white/55 text-ink hover:bg-white/80"}`}
          >
            <Icon name="heart" size={15} />
            <span className="text-xs font-bold leading-none">{q.likes}</span>
          </button>
        )}
        {canNote && (
          <button onClick={onNote} aria-label="필기 편집" className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-all ${note ? "bg-ink text-white" : "bg-white/55 text-ink hover:bg-white/80"}`}>
            <Icon name="pen" size={16} />
          </button>
        )}
      </div>
      {note && (
        <p className="mt-3 flex gap-1.5 rounded-2xl bg-white/55 px-3 py-2 text-sm text-ink/70">
          <Icon name="pen" size={14} className="mt-0.5 shrink-0" />
          {note}
        </p>
      )}
    </Bubble>
  );
}

// AI 답변을 글자가 이어서 나오도록 보여준다 (F4-4 스트리밍)
function StreamText({ text, onDone }: { text: string; onDone: () => void }) {
  const [n, setN] = useState(0);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  useEffect(() => {
    if (n >= text.length) return doneRef.current();
    const t = setTimeout(() => setN((v) => Math.min(text.length, v + 2)), 30);
    return () => clearTimeout(t);
  }, [n, text]);
  return (
    <>
      {text.slice(0, n)}
      {n < text.length && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-ink/60 align-middle" />}
    </>
  );
}
