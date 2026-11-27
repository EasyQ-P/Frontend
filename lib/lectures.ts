// 강연 · 교안 (API-13 ~ 25) 화면용 도우미: 서버 응답 → 화면 모양, 오류 코드 → 안내 문구
import { ApiError } from "./api/client";
import type { Session, SessionDocument } from "./api/lectures";
import { formatSchedule } from "./join";
import type { Lecture, LectureStatus, Tone } from "./mock";

const tones: Tone[] = ["ocean", "mint", "grape", "honey", "coral", "berry", "leaf"];
const emojis = ["🎤", "📚", "💡", "🧪", "🧭", "🛰️", "🧩"];

// 같은 강연은 늘 같은 색 · 이모지가 나오도록 id로 고른다 (서버에는 색이 없다)
function pick<T>(list: T[], id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

export function lectureStatus(s: Pick<Session, "status">): LectureStatus {
  return s.status === "DRAFT" ? "ready" : s.status === "LIVE" ? "live" : "ended";
}

export function sessionToLecture(s: Session): Lecture {
  const { date, time } = formatSchedule(s.scheduled_at);
  return {
    id: s.session_id,
    title: s.title,
    date,
    time,
    desc: s.description ?? "",
    status: lectureStatus(s),
    code: s.join_code ?? "",
    tone: pick(tones, s.session_id),
    emoji: pick(emojis, s.session_id),
    file: null,
    audience: s.participant_count,
    glossary: s.terms ?? [],
  };
}

// <input type="date"> · <input type="time"> 값 → Date (기기 시간대 기준)
export function localDateTime(date: string, time: string) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

// ── 교안 ──
export const isBudgetHeld = (d: SessionDocument) => d.status === "PENDING" && d.error_code === "BUDGET_EXCEEDED";
// 아직 처리 중이라 상태를 다시 물어봐야 하는 교안 (예산 보류는 기다려도 바로 바뀌지 않으니 뺀다)
export const isWorking = (d: SessionDocument) => (d.status === "PENDING" && !isBudgetHeld(d)) || d.status === "PROCESSING";

const stageText: Record<string, string> = {
  UPLOADED: "업로드됨",
  EXTRACTING: "텍스트 추출 · 청킹",
  INDEXING: "임베딩 · 색인",
  TERMS: "용어 추출",
};

export function documentLine(d: SessionDocument) {
  if (isBudgetHeld(d)) return "예산 한도로 처리가 보류되었어요";
  // 앞선 시도가 실패해 서버가 자동으로 다시 시도하려고 기다리는 중
  if (d.status === "PENDING" && d.error_code) return "처리 중 문제가 생겨 자동으로 다시 시도하고 있어요";
  if (d.status === "PENDING") return "처리 대기 중이에요";
  if (d.status === "PROCESSING") return `AI가 교안을 읽는 중이에요${d.stage && stageText[d.stage] ? ` · ${stageText[d.stage]}` : ""}`;
  if (d.status === "FAILED") return "처리 실패";
  return `${d.page_count ?? 0}쪽 · 검색 조각 ${d.chunk_count ?? 0}개`;
}

export function documentFailReason(d: SessionDocument) {
  if (d.error_code === "DOCUMENT_PARSE_FAILED") return "텍스트를 추출하지 못했어요. 스캔한 PDF이거나 손상된 파일일 수 있어요. 텍스트가 있는 PDF · PPTX로 다시 올려 주세요.";
  if (d.error_code === "INDEX_BUILD_FAILED") return "검색 색인을 만들지 못했어요. 잠시 후 다시 시도해 주세요.";
  return d.retryable ? "처리하지 못했어요. 다시 시도해 주세요." : "이 파일은 처리할 수 없어요. 다른 파일을 올려 주세요.";
}

// ── 오류 문구 ──
export function lectureErrorMessage(e: unknown) {
  if (!(e instanceof ApiError)) return "서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.";
  switch (e.code) {
    case "VERSION_CONFLICT":
      return "다른 화면에서 강연 정보가 바뀌었어요. 새로고침한 뒤 다시 시도해 주세요.";
    case "SESSION_STATE_CONFLICT":
      return "지금 강연 상태에서는 할 수 없는 작업이에요. 새로고침해 주세요.";
    case "CONSENT_REQUIRED":
      return "서비스 이용 동의가 필요해요. 내 정보에서 동의 상태를 확인해 주세요.";
    case "FILE_TOO_LARGE":
      return "파일이 너무 커요. 50MB 이하로 올려 주세요.";
    case "FILE_TYPE_UNSUPPORTED":
      return "PDF 또는 PPTX 파일만 올릴 수 있어요. 파일이 손상되지 않았는지 확인해 주세요.";
    case "IDEMPOTENCY_CONFLICT":
      return "같은 요청이 이미 다른 내용으로 처리됐어요. 새로고침해 주세요.";
    case "RESOURCE_NOT_FOUND":
      return "강연을 찾을 수 없어요.";
    case "FORBIDDEN":
      return "이 강연을 관리할 권한이 없어요.";
    case "AUTH_REQUIRED":
      return "로그인이 필요해요.";
    case "RATE_LIMITED":
      return "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.";
    case "VALIDATION_ERROR":
      return "입력한 내용을 다시 확인해 주세요.";
    default:
      return "잠시 후 다시 시도해 주세요.";
  }
}
