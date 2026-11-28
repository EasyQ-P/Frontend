// 질문 · 답변 · 공감 · 필기 API (설계서 API-12, 26 ~ 36, 38). 처리 서버는 backend.
// 공개 질문(ESCALATED · COMPLETED)은 작성자를 싣지 않는다. 그 밖의 질문과 답변은 질문자와 강연자에게만 온다
import { api } from "./client";
import type { AcceptedJob, Paginated } from "./types";

export type QuestionStatus = "QUEUED" | "PROCESSING" | "AI_ANSWERED" | "ESCALATED" | "COMPLETED";
export type EscalationReason =
  | "INSUFFICIENT_EVIDENCE"
  | "LOW_CONFIDENCE"
  | "SECOND_STAGE_INSUFFICIENT"
  | "PROVIDER_FAILURE"
  | "BUDGET_EXCEEDED"
  | "RETRACTED"
  | "FINALIZE_TIMEOUT";
export type Rating = "HELPFUL" | "UNHELPFUL";
export type RetractReason = "WRONG_OR_INSUFFICIENT" | "EXPLAIN_AGAIN";

export type Note = { content: string; question_text: string; updated_at: string };

/** 7.3.1 QuestionPublic */
export type QuestionPublic = {
  question_id: string;
  content: string;
  status: QuestionStatus;
  document_id: string | null;
  page_no: number | null;
  vote_count: number;
  version: number;
  created_at: string;
  voted_by_me: boolean;
  /** 회원 본인의 필기 (게스트 · 강연자는 null) */
  my_note: Note | null;
};

export type Citation = {
  citation_no: number | null;
  chunk_id: string | null;
  /** DOCUMENT(교안) · TRANSCRIPT(발화) */
  source_type: string | null;
  /** 교안 p.9 · 발화 21:05 */
  location_label: string | null;
  page_no: number | null;
  start_ms: number | null;
  end_ms: number | null;
  excerpt: string | null;
};

export type Answer = {
  answer_id: string;
  status: "ACTIVE" | "RETRACTED";
  /** 철회된 답변은 null */
  content: string | null;
  citations: Citation[];
  /** 질문자 본인의 평가 */
  my_rating: Rating | null;
};

/** 7.3.1 QuestionPrivate: 질문자 본인과 강연자에게만 */
export type QuestionPrivate = QuestionPublic & {
  escalation_reason: EscalationReason | null;
  answer: Answer | null;
  /** 답변 작업이 실패한 경우의 오류 코드 */
  processing_error: string | null;
};

export const isPublic = (s: QuestionStatus) => s === "ESCALATED" || s === "COMPLETED";

/** API-26 쓰는 중인 질문과 비슷한 공개 질문(공감 가능한 ESCALATED) 최대 3개. 입력한 문장은 저장되지 않는다 */
export function searchSimilar(sid: string, content: string, signal?: AbortSignal) {
  return api.post<{ items: { question: QuestionPublic; similarity: number }[] }>(`/sessions/${sid}/similar-question-searches`, { content }, { signal });
}

/** API-27 질문 등록 (202). 같은 질문을 다시 보낼 때(네트워크 오류)는 같은 UUID 키를 넘긴다 */
export function submitQuestion(sid: string, content: string, idempotencyKey: string) {
  return api.post<AcceptedJob>(`/sessions/${sid}/questions`, { content }, { idempotencyKey });
}

/**
 * API-28 질문 목록.
 * public: 강연자에게 전달된 공개 질문 · mine: 내가 한 질문(답변 포함) · review: 강연자 검토용(AI 답변 · 이관 · 완료)
 */
export function listQuestions<S extends "public" | "mine" | "review">(sid: string, scope: S, opts: { sort?: "votes" | "latest"; cursor?: string } = {}) {
  return api.get<Paginated<S extends "public" ? QuestionPublic : QuestionPrivate>>(`/sessions/${sid}/questions`, {
    query: { scope, sort: opts.sort, cursor: opts.cursor, limit: 100 },
  });
}

/** API-29 질문 · 답변 조회. 질문자 · 강연자는 QuestionPrivate, 그 밖에는 QuestionPublic */
export function getQuestion(sid: string, qid: string) {
  return api.get<QuestionPrivate>(`/sessions/${sid}/questions/${qid}`);
}

/** API-30 공감 (공개 대기 질문만, 1인 1회) */
export function vote(sid: string, qid: string) {
  return api.put<{ question_id: string; voted: true; vote_count: number }>(`/sessions/${sid}/questions/${qid}/votes/me`, {});
}

/** API-31 공감 취소 */
export function unvote(sid: string, qid: string) {
  return api.delete(`/sessions/${sid}/questions/${qid}/votes/me`, { body: {} });
}

/** API-32 이관 질문 답변 완료(COMPLETED) · 완료 취소(ESCALATED). 강연자 전용, 질문 version으로 보호 */
export function setQuestionDone(sid: string, qid: string, version: number, done: boolean) {
  return api.patch<QuestionPrivate>(`/sessions/${sid}/questions/${qid}`, { status: done ? "COMPLETED" : "ESCALATED" }, { ifMatch: version });
}

/** API-33 AI 답변 철회. 질문은 공개 목록(ESCALATED)으로 옮겨진다 */
export function retractAnswer(sid: string, qid: string, version: number, reason: RetractReason, detail?: string) {
  return api.post<{ question_id: string; question_version: number }>(
    `/sessions/${sid}/questions/${qid}/answer-retractions`,
    { reason_code: reason, ...(detail ? { reason_detail: detail } : {}) },
    { ifMatch: version },
  );
}

/** API-34 AI 답변 평가 (질문자 본인). 다시 보내면 바뀐다 */
export function rateAnswer(sid: string, qid: string, answerId: string, rating: Rating) {
  return api.put<{ answer_id: string; rating: Rating; version: number }>(`/sessions/${sid}/questions/${qid}/answer-ratings/me`, { answer_id: answerId, rating });
}

/** API-35 공개 질문에 내 필기 저장 (회원 전용, 1000자) */
export function saveNote(sid: string, qid: string, content: string) {
  return api.put<Note>(`/sessions/${sid}/questions/${qid}/notes/me`, { content });
}

/** API-36 필기 삭제 */
export function deleteNote(sid: string, qid: string) {
  return api.delete(`/sessions/${sid}/questions/${qid}/notes/me`, { body: {} });
}

/** API-38 인용 근거 원문. 원자료가 파기됐으면 404 (화면은 위치와 인용 구절만 남긴다) */
export function getSource(sid: string, chunkId: string) {
  return api.get<Citation & { content: string }>(`/sessions/${sid}/sources/${chunkId}`);
}

/** API-12 내 질문 기록 (회원 보관함). session_id로 한 강연만 */
export function listMyQuestions(sessionId?: string, cursor?: string) {
  return api.get<Paginated<QuestionPrivate & { session_id: string; session_title: string }>>("/me/questions", {
    query: { session_id: sessionId, cursor, limit: 100 },
  });
}
