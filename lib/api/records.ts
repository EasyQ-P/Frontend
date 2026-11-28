// 강연 기록 · 삭제 API (설계서 API-24, 37, 39, 40). 처리 서버는 backend.
import { api } from "./client";
import type { Citation } from "./questions";
import type { AcceptedJob } from "./types";

export type SummaryStatus = "QUEUED" | "RUNNING" | "READY" | "FAILED" | "SKIPPED";

/** 8.2.19 요약 노트 4구역 (READY일 때만) */
export type SummaryContent = {
  one_line: string;
  key_concepts: { term: string; description: string }[];
  emphases: string[];
  keywords: string[];
};

export type Summary = {
  /** 종료 처리(FINALIZE)가 아직이면 null */
  summary_id: string | null;
  status: SummaryStatus;
  content: SummaryContent | null;
  sources: Citation[];
  generated_at: string | null;
};

/** API-37 요약 노트. 끝난 강연(ENDED · PURGED)의 강연자와 보관함 회원만 (게스트 403) */
export function getSummary(sid: string) {
  return api.get<Summary>(`/sessions/${sid}/summary`);
}

/** 7.3.1 Statistics. 강연 종료 때 한 번 집계한 값 */
export type Statistics = {
  question_count: number;
  ai_answer_count: number;
  escalated_count: number;
  completed_count: number;
  retracted_count: number;
  vote_total: number;
  participant_count: { member: number; guest: number };
  /** 0~1. 질문이 없으면 null */
  ai_answer_share: number | null;
  questions_by_page: { document_id: string; file_name: string; page_no: number; count: number }[];
  general_question_count: number;
  computed_at: string;
};

/** API-39 강연 통계 (강연자, 끝난 강연) */
export function getStatistics(sid: string) {
  return api.get<Statistics>(`/sessions/${sid}/statistics`);
}

/** API-24 교안 삭제 (202). 진행 중에는 근거 조각이 없는 실패 교안만 지울 수 있다 */
export function deleteDocument(sid: string, did: string) {
  return api.delete<AcceptedJob>(`/sessions/${sid}/documents/${did}`, { idempotencyKey: true });
}

/**
 * API-40 삭제 접수 (202). 접수하는 순간 접근이 막히고 실제 삭제는 뒤에서 처리된다.
 * QUESTION: 내 질문 기록 · ARCHIVE: 내 보관함의 강연 기록 · SESSION: 내가 연 강연 · ACCOUNT: 회원 탈퇴
 */
export function requestDeletion(targetType: "QUESTION" | "ARCHIVE" | "SESSION" | "ACCOUNT", targetId: string) {
  return api.post<AcceptedJob>("/deletion-requests", { target_type: targetType, target_id: targetId }, { idempotencyKey: true });
}
