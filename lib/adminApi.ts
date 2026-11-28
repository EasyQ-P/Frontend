// 관리자 화면 공통: 오류 문구, 로그인이 끊기면 관리자 로그인으로
import { ApiError, UNREACHABLE_MESSAGE, isUnreachable } from "./api/client";

export function adminErrorMessage(e: unknown) {
  if (isUnreachable(e) || !(e instanceof ApiError)) return UNREACHABLE_MESSAGE;
  const reason = (e.details as { reason?: string } | undefined)?.reason;
  switch (e.code) {
    case "SESSION_STATE_CONFLICT":
      return reason === "LAST_ADMIN" ? "마지막 관리자 계정은 정지할 수 없어요." : "지금 상태에서는 할 수 없는 작업이에요. 새로고침해 주세요.";
    case "VERSION_CONFLICT":
      return "다른 곳에서 먼저 바뀌었어요. 새로고침한 뒤 다시 시도해 주세요.";
    case "AUTH_SERVICE_UNAVAILABLE":
      return "인증 서버에 연결할 수 없어 복구하지 못했어요. 잠시 후 다시 시도해 주세요.";
    case "RESOURCE_NOT_FOUND":
      return "대상을 찾을 수 없어요. 새로고침해 주세요.";
    case "VALIDATION_ERROR":
      return "입력한 내용을 다시 확인해 주세요.";
    case "FORBIDDEN":
      return "관리자 권한이 없어요.";
    case "AUTH_REQUIRED":
      return "로그인이 만료됐어요. 다시 로그인해 주세요.";
    case "REVIEW_CONFLICT":
      return "이미 두 명이 검수한 후보예요.";
    case "DATASET_NOT_READY":
      return "학습에 쓸 수 없는 데이터셋이에요.";
    case "TRAINING_SERVER_UNAVAILABLE":
    case "SERVICE_UNAVAILABLE":
      return "학습서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.";
    case "LIVE_SESSION_IN_PROGRESS":
      return "진행 중인 강연이 있어 학습을 시작할 수 없어요. 판정 모델과 GPU를 함께 쓰기 때문이에요.";
    case "CANDIDATE_NOT_ELIGIBLE":
      return reason === "MERGING" ? "병합 중인 후보라 검수를 바꿀 수 없어요." : "검수 · 병합할 수 없는 후보가 있어요. 새로고침해 주세요.";
    case "MODEL_NOT_DEPLOYABLE":
    case "DEPLOY_CRITERIA_NOT_MET":
      return "배포 기준을 통과하지 못한 모델이에요.";
    case "TRAINING_ALREADY_FINISHED":
      return "이미 끝난 학습이에요.";
    case "TRAINER_BUSY":
      return "학습서버가 다른 작업 중이에요. 잠시 후 다시 시도해 주세요.";
    case "IDEMPOTENCY_CONFLICT":
      return "같은 요청이 이미 다른 내용으로 처리됐어요. 새로고침해 주세요.";
    default:
      return e.message && e.message !== e.code ? e.message : "잠시 후 다시 시도해 주세요.";
  }
}

/** 관리자 로그인이 끊겼는지 (관리자 로그인 화면으로 보낸다) */
export const adminLoggedOut = (e: unknown) => e instanceof ApiError && (e.code === "AUTH_REQUIRED" || e.code === "FORBIDDEN");
