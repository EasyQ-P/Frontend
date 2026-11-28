// 질문 화면 도우미: 서버 질문 · 인용을 화면 모양으로 바꾸고, 오류 코드를 안내 문구로 바꾼다
import { ApiError, UNREACHABLE_MESSAGE, isUnreachable } from "./api/client";
import type { Citation, QuestionPrivate } from "./api/questions";
import type { Source } from "./mock";

const pad = (n: number) => String(n).padStart(2, "0");

/** 질문 시각 "14:05" (기기 시간대) */
export function clockOf(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** AI 답변 인용 → 근거 칩 (교안 p.9 · 발화 21:05) */
export function citationToSource(c: Citation): Source {
  const kind = c.source_type === "TRANSCRIPT" ? "speech" : "slide";
  const label = c.location_label ?? (kind === "slide" ? (c.page_no ? `교안 p.${c.page_no}` : "교안") : "발화");
  return { kind, label, quote: c.excerpt ?? "", chunkId: c.chunk_id ?? undefined };
}

/** 내 질문이 지금 어느 단계인지 (청중 화면) */
export type MineState = "searching" | "writing" | "ai" | "forwarded";

export function mineState(q: QuestionPrivate): MineState {
  if (q.status === "AI_ANSWERED") return "ai";
  if (q.status === "ESCALATED" || q.status === "COMPLETED") return "forwarded";
  return q.status === "PROCESSING" ? "writing" : "searching";
}

export function questionErrorMessage(e: unknown) {
  if (isUnreachable(e) || !(e instanceof ApiError)) return UNREACHABLE_MESSAGE;
  switch (e.code) {
    case "SESSION_NOT_LIVE":
      return "강연이 진행 중일 때만 할 수 있어요.";
    case "QUESTION_NOT_PUBLIC":
      return "강연자에게 전달된 질문에만 할 수 있어요.";
    case "ANSWER_NOT_ACTIVE":
      return "이미 철회된 답변이에요.";
    case "VERSION_CONFLICT":
      return "질문 상태가 바뀌었어요. 목록을 새로 불러왔어요.";
    case "SESSION_STATE_CONFLICT":
      return "지금 질문 상태에서는 할 수 없어요.";
    case "CONSENT_REQUIRED":
      return "서비스 이용 동의가 필요해요.";
    case "IDEMPOTENCY_CONFLICT":
      return "같은 질문을 이미 보냈어요.";
    case "RATE_LIMITED":
      return "질문을 너무 자주 보냈어요. 잠시 후 다시 보내 주세요.";
    case "VALIDATION_ERROR":
      return "질문은 1~200자로 적어 주세요.";
    case "RESOURCE_NOT_FOUND":
      return "질문을 찾을 수 없어요.";
    case "FORBIDDEN":
      return "이 기능을 쓸 권한이 없어요.";
    case "AUTH_REQUIRED":
      return "입장이 만료됐어요. 다시 입장해 주세요.";
    default:
      return "잠시 후 다시 시도해 주세요.";
  }
}
