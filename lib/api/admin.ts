// 관리자 API (설계서 API-45 ~ 52, 64, 65). 처리 서버는 backend. 모든 요청은 ADMIN 계정만 (아니면 403)
import { api } from "./client";
import type { Inquiry, Notice } from "./me";
import type { Paginated } from "./types";

export type AdminUser = {
  user_id: string;
  email: string;
  display_name: string;
  role: "MEMBER" | "ADMIN";
  status: "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED" | "DELETING";
  email_verified_at: string | null;
  suspension_reason: string | null;
  created_at: string;
  consents: { SERVICE: { policy_version: string; granted: boolean } | null; TRAINING: { policy_version: string; granted: boolean } | null };
  joined_count: number;
  hosted_count: number;
  question_count: number;
};

/** API-45 회원 목록 (가입 최신순). q: 표시명 · 이메일 검색 */
export function listUsers(opts: { status?: AdminUser["status"]; q?: string; cursor?: string } = {}) {
  return api.get<Paginated<AdminUser>>("/admin/users", { query: { status: opts.status, q: opts.q?.trim() || undefined, cursor: opts.cursor, limit: 100 } });
}

/** API-46 계정 정지(SUSPENDED) · 복구(ACTIVE). 사유 필수(500자). 마지막 관리자는 정지할 수 없다 */
export function setUserStatus(userId: string, status: "ACTIVE" | "SUSPENDED", reason: string) {
  return api.patch<AdminUser>(`/admin/users/${userId}`, { status, reason });
}

export type AdminSession = {
  session_id: string;
  host_user_id: string | null;
  host_display_name: string;
  title: string;
  join_code: string;
  status: "DRAFT" | "LIVE" | "ENDED" | "PURGED" | "DELETING";
  end_reason: string | null;
  is_eval_lecture: boolean;
  scheduled_at: string;
  started_at: string | null;
  ended_at: string | null;
  participant_count: number;
  question_count: number;
  created_at: string;
  version: number;
};

/** API-47 강연 목록 (만든 최신순) */
export function listAdminSessions(opts: { status?: AdminSession["status"]; cursor?: string } = {}) {
  return api.get<Paginated<AdminSession>>("/admin/sessions", { query: { status: opts.status, cursor: opts.cursor, limit: 100 } });
}

/** API-48 평가용 강연 표시(시작 전만, 끌 수 없음) · 강제 종료(진행 중만). 사유 필수 */
export function patchAdminSession(sid: string, version: number, patch: { status: "ENDED" } | { is_eval_lecture: true }, reason: string) {
  return api.patch<{ session_id: string; status: AdminSession["status"]; is_eval_lecture: boolean; version: number }>(`/admin/sessions/${sid}`, { ...patch, reason }, { ifMatch: version });
}

/** 7.3.8 운영 지표 한 묶음 (날짜별 또는 강연별) */
export type MetricGroup = {
  date?: string;
  session_id?: string | null;
  question_count: number;
  ai_answer_count: number;
  escalated_count: number;
  ai_answer_share: number | null;
  escalation_rate: number | null;
  progress_max_ms: number | null;
  progress_p95_ms: number | null;
  first_token_p50_ms: number | null;
  final_p50_ms: number | null;
  final_p95_ms: number | null;
  stt_ingest_p95_ms: number | null;
  fallback_count: number;
  second_stage_escalated_count: number;
  retracted_count: number;
  feedback_counts: { retraction_reasons: Record<string, number>; audience: { HELPFUL: number; UNHELPFUL: number } };
  failed_jobs: number;
  external_calls: number;
  estimated_cost_by_currency: Record<string, number>;
};

export type Budget = {
  month: string;
  monthly_budget_krw: number;
  month_to_date_krw: number;
  reserved_krw: number;
  usage_ratio: number | null;
  warning: boolean;
  hard_cap_enabled: boolean;
  cap_reached: boolean;
};

export type Metrics = { period: { from: string; to: string }; group_by: "day" | "session"; groups: MetricGroup[]; budget: Budget | null; data_as_of: string };

/** API-64 운영 지표. from · to는 시간대가 있는 ISO 시각(to는 포함 안 함), 최대 90일. 날짜 묶음은 서울 날짜 기준 */
export function getMetrics(from: string, to: string, groupBy: "day" | "session") {
  return api.get<Metrics>("/admin/metrics", { query: { from, to, group_by: groupBy } });
}

/** API-65 월 API 예산 설정 (원 단위, 환율, 한도 도달 시 차단 여부, 사유) */
export function setBudget(input: { monthly_budget_krw: number; usd_krw_rate: number; hard_cap_enabled: boolean; reason: string }) {
  return api.put<Budget | Record<string, unknown>>("/admin/budget-settings", input);
}

/** API-49 공지 등록 */
export function createNotice(title: string, content: string) {
  return api.post<Notice>("/admin/notices", { title, content });
}

/** API-50 공지 수정 (version으로 보호) */
export function updateNotice(id: string, version: number, patch: { title?: string; content?: string }) {
  return api.patch<Notice>(`/admin/notices/${id}`, patch, { ifMatch: version });
}

/** API-51 공지 삭제 */
export function deleteNotice(id: string) {
  return api.delete(`/admin/notices/${id}`);
}

/** API-52 문의 답변 (다시 보내면 고친다) */
export function replyInquiry(id: string, reply: string) {
  return api.put<Inquiry>(`/admin/inquiries/${id}/reply`, { reply });
}

// ── 라벨 · 데이터셋 · 학습 · 모델 · 서빙 (API-53 ~ 63). 학습서버 값은 서비스가 동기화한 사본이다 ──

export type CandidateLabel = "ANSWERABLE" | "INSUFFICIENT_EVIDENCE" | "OPINION" | "REJECT";
export type CandidateEvent = "AUTO_ESCALATED" | "RETRACTED" | "AUDIENCE_HELPFUL" | "AUDIENCE_UNHELPFUL" | "SECOND_STAGE_INSUFFICIENT";
export type ReviewStatus = "PENDING" | "DISAGREEMENT" | "APPROVED" | "REJECTED" | "MERGING";

export type Evidence = {
  evidence_id: string;
  evidence_type: string;
  location_label: string;
  page_no: number | null;
  start_ms: number | null;
  end_ms: number | null;
  /** 개인정보를 가린 근거 원문 */
  text: string;
  rank: number | null;
  score: number | null;
};

export type Candidate = {
  candidate_id: string;
  event_type: CandidateEvent;
  session_title: string;
  default_label: CandidateLabel | null;
  sanitized_pair: { question_text?: string; evidence_id?: string; evidence_text?: string };
  retrieved_evidence: Evidence[];
  judgment_snapshot: { mode?: string; model_version?: string | null; score?: number | null; threshold?: number | null; margin?: number | null };
  review_status: ReviewStatus;
  final_label: CandidateLabel | null;
  /** 내 검수를 저장한 뒤에만 다른 검수자 결과까지 온다 */
  reviews: { reviewer_ref: string; label: CandidateLabel; evidence_id: string | null; comment: string | null; reviewed_at: string }[];
};

/** API-53 라벨 후보 목록. NEAR_THRESHOLD는 model_version의 임계값에 가까운 순 (자동 이관 후보만) */
export function listCandidates(opts: { review_status?: ReviewStatus; sort?: "CREATED_AT" | "NEAR_THRESHOLD"; model_version?: string } = {}) {
  return api.get<Paginated<Candidate>>("/admin/feedback-candidates", { query: { ...opts, limit: 100 } });
}

/** API-54 내 검수 저장. ANSWERABLE은 검색 후보 중 정답 근거(evidence_id)를 함께 보낸다 */
export function reviewCandidate(id: string, label: CandidateLabel, evidenceId?: string | null, comment?: string) {
  return api.put<Candidate>(`/admin/feedback-candidates/${id}/reviews/me`, { label, ...(evidenceId ? { evidence_id: evidenceId } : {}), ...(comment ? { comment } : {}) });
}

export type Dataset = {
  dataset_id: string;
  version_name: string;
  status: string;
  contains_aihub: boolean;
  statistics: Record<string, Record<string, number>>;
  script_version: string | null;
  retrieval_config_version: string | null;
  test_set_version: string | null;
  test_use_count: number | null;
  change_note: string | null;
  synced_at: string;
};

/** API-55 승인된 후보를 기준 데이터셋에 병합해 새 버전을 만든다 (202) */
export function mergeCandidates(baseVersion: string, candidateIds: string[], description?: string) {
  return api.post<{ resource_id: string; job_id: string; status: string }>(
    "/admin/datasets",
    { base_dataset_version: baseVersion, candidate_ids: candidateIds, ...(description ? { description } : {}) },
    { idempotencyKey: true },
  );
}

/** API-56 데이터셋 버전 (최신순). 부르면 학습서버와 동기화도 요청된다 */
export function listDatasets() {
  return api.get<Paginated<Dataset>>("/admin/datasets", { query: { limit: 100 } });
}

export type TrainingRun = {
  training_run_id: string;
  dataset_id: string;
  job_id: string | null;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "HELD" | "CANCELLED";
  stage: string | null;
  hold_reason: string | null;
  progress: number | null;
  learning_curve: { epoch: number; train_loss?: number; valid_loss?: number; valid_auc?: number }[];
  metrics: Record<string, number>;
  model_version: string | null;
  deployable: boolean | null;
  error_code: string | null;
  synced_at: string | null;
};

/** API-57 학습 요청 (202). 진행 중인 강연이 있으면 409 LIVE_SESSION_IN_PROGRESS */
export function startTraining(datasetId: string, config?: { epochs?: number; batch_size?: 8 | 16; learning_rate?: number }) {
  return api.post<{ resource_id: string; job_id: string; status: string }>("/admin/training-runs", { dataset_id: datasetId, ...(config ? { config } : {}) }, { idempotencyKey: true });
}

/** API-58 학습 진행 · 결과 */
export function getTrainingRun(id: string) {
  return api.get<TrainingRun>(`/admin/training-runs/${id}`);
}

/** API-59 학습 중단 (202) */
export function stopTraining(id: string) {
  return api.delete<{ resource_id: string; job_id: string; status: string }>(`/admin/training-runs/${id}`, { body: {} });
}

export type ModelVersion = {
  model_version_id: string;
  version_name: string;
  status: "REGISTERED" | "DELETED";
  threshold: number | null;
  metrics: Record<string, number>;
  deployable: boolean;
  compared_with: string | null;
  serving: boolean;
  served_before: boolean;
  memo: string | null;
  synced_at: string;
};

/** API-60 모델 버전 */
export function listModels() {
  return api.get<Paginated<ModelVersion>>("/admin/model-versions", { query: { status: "REGISTERED", limit: 100 } });
}

export type Evaluation = {
  evaluation_id: string;
  dataset_id: string;
  model_version_id: string | null;
  evaluator: string;
  scope: "QUESTION" | "PAIR" | "SERVICE";
  split: "VALIDATION" | "TEST";
  metrics: Record<string, number>;
  config: Record<string, unknown>;
  synced_at: string;
};

/** API-61 평가 결과 (데이터셋 기준) */
export function listEvaluations(datasetId: string) {
  return api.get<Paginated<Evaluation>>("/admin/evaluation-runs", { query: { dataset_id: datasetId } });
}

export type Serving = {
  mode: "CUSTOM" | "LLM_ONLY" | null;
  model_version: string | null;
  threshold: number | null;
  llm_only_threshold: number | null;
  llm_model_id: string | null;
  llm_prompt_version: string | null;
  deployed_at: string | null;
  synced_at: string | null;
  /** 학습서버에 닿지 못해 마지막으로 저장한 값을 보여주는 중 */
  stale: boolean;
};

export type Deployment = {
  deployment_id: string;
  requested_by: string;
  requested_mode: "CUSTOM" | "LLM_ONLY";
  requested_model_version: string | null;
  route: "SWITCH" | "ROLLBACK";
  status: "PENDING" | "ACTIVE" | "SUPERSEDED" | "FAILED";
  reason: string | null;
  error_code: string | null;
  created_at: string;
  synced_at: string | null;
};

/** API-63 현재 서빙 설정 · 전환 이력 */
export function getDeployments() {
  return api.get<{ active: Serving | null; items: Deployment[]; next_cursor: string | null }>("/admin/deployments", { query: { limit: 50 } });
}

/**
 * API-62 서빙 전환 · 롤백 · LLM_ONLY (202). 보는 사이 다른 관리자가 바꿨으면 409 VERSION_CONFLICT가 나도록
 * 지금 ACTIVE인 전환 기록 ID(첫 전환이면 null)를 함께 보낸다
 */
export function deploy(input: { mode: "CUSTOM"; modelVersionId: string } | { mode: "LLM_ONLY" }, expectedActiveId: string | null, reason: string) {
  return api.post<{ resource_id: string; job_id: string; status: string }>(
    "/admin/deployments",
    { mode: input.mode, ...(input.mode === "CUSTOM" ? { model_version_id: input.modelVersionId } : {}), expected_active_deployment_id: expectedActiveId, reason },
    { idempotencyKey: true },
  );
}
