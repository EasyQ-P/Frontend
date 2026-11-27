// 강연 · 교안 API (설계서 API-13 ~ 17, 20 ~ 23, 25). 처리 서버는 backend.
import { POLICY } from "./accounts";
import { api } from "./client";
import type { AcceptedJob, Paginated } from "./types";

export type SessionStatus = "DRAFT" | "LIVE" | "ENDED" | "PURGED";
export type SttStatus = "STOPPED" | "CONNECTING" | "RUNNING" | "PAUSED" | "DEGRADED";

// 7.3.1 Session. join_code · join_url · terms는 강연자(HOST)에게만 온다
export type Session = {
  session_id: string;
  title: string;
  description: string | null;
  scheduled_at: string;
  host_display_name: string;
  status: SessionStatus;
  stt_status: SttStatus;
  end_reason: string | null;
  /** If-Match에 쓰는 리소스 버전 */
  version: number;
  started_at: string | null;
  ended_at: string | null;
  my_role: "HOST" | "AUDIENCE";
  participant_count: number;
  capacity: number;
  join_code?: string;
  join_url?: string;
  terms?: string[];
};

// API-22 교안 처리 상태
export type DocumentStatus = "PENDING" | "PROCESSING" | "READY" | "FAILED";
export type SessionDocument = {
  document_id: string;
  file_name: string;
  status: DocumentStatus;
  stage: string | null;
  page_count: number | null;
  chunk_count: number | null;
  /** DOCUMENT_PARSE_FAILED · INDEX_BUILD_FAILED · BUDGET_EXCEEDED 등 */
  error_code: string | null;
  /** FAILED일 때 같은 파일로 다시 시도할 수 있는지 */
  retryable: boolean;
};

/** API-13 강연 생성 (DRAFT). 입장 코드가 함께 발급된다 */
export function createLecture(input: { title: string; description?: string; scheduledAt: Date }) {
  return api.post<Session>("/sessions", {
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    scheduled_at: input.scheduledAt.toISOString(),
  });
}

/** API-14 내가 연 강연 목록 (최신 예정 시각 순) */
export function listHostedLectures(status?: "DRAFT" | "LIVE" | "ENDED", cursor?: string) {
  return api.get<Paginated<Session>>("/sessions", { query: { scope: "hosted", status, cursor, limit: 100 } });
}

/** API-15 강연 상태와 내 권한 */
export function getLecture(sid: string) {
  return api.get<Session>(`/sessions/${sid}`);
}

/** API-16 강연 수정 · 시작(LIVE) · 종료(ENDED). version이 다르면 409 VERSION_CONFLICT */
export function updateLecture(sid: string, version: number, patch: Partial<{ title: string; description: string; scheduled_at: string; status: "LIVE" | "ENDED"; stt_status: "RUNNING" | "PAUSED" }>) {
  return api.patch<Session>(`/sessions/${sid}`, patch, { ifMatch: version });
}

/** API-17 입장 QR 재발급. 이전 코드는 바로 쓸 수 없게 된다 */
export function reissueJoinLink(sid: string, version: number) {
  return api.post<{ join_code: string; join_url: string; version: number }>(`/sessions/${sid}/join-links`, undefined, { ifMatch: version });
}

/** API-20 강연 단위 동의. 강연자는 시작 전에 음성 인식(STT) 동의를 남긴다 */
export function setLectureConsent(sid: string, purpose: "SERVICE" | "TRAINING" | "STT", granted: boolean) {
  return api.post<unknown>(`/sessions/${sid}/consents`, { purpose, policy_version: POLICY[purpose], granted });
}

/** API-21 교안 업로드 (multipart, 필드 이름 file). 같은 파일을 다시 보낼 때는 같은 키를 넘긴다 */
export function uploadDocument(sid: string, file: File, idempotencyKey: string) {
  const form = new FormData();
  form.append("file", file, file.name);
  return api.post<AcceptedJob>(`/sessions/${sid}/documents`, form, { idempotencyKey });
}

/** API-22 교안 처리 상태 */
export function listDocuments(sid: string) {
  return api.get<Paginated<SessionDocument>>(`/sessions/${sid}/documents`);
}

/** API-23 실패한 교안을 같은 원본으로 처음부터 다시 처리 */
export function retryDocument(sid: string, did: string, idempotencyKey: string) {
  return api.post<AcceptedJob>(`/sessions/${sid}/documents/${did}/retries`, undefined, { idempotencyKey });
}

/** API-25 전문용어 사전 저장 (전체를 덮어쓴다). 시작 전(DRAFT)에만 */
export function saveTerms(sid: string, version: number, terms: string[]) {
  return api.put<{ terms: string[]; version: number }>(`/sessions/${sid}/terms`, { terms }, { ifMatch: version });
}
