// 입장 (API-18 · 19) 화면용 도우미: 서버 응답을 화면의 Lecture 모양으로 바꾸고, 오류 코드를 안내 문구로 바꾼다
import { ApiError, UNREACHABLE_MESSAGE, isUnreachable } from "./api/client";
import type { JoinPreview } from "./api/join";
import type { Lecture } from "./mock";

const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (n: number) => String(n).padStart(2, "0");

// "2026-11-27T05:00:00Z" → 기기 시간대 기준 "2026.11.27 (금)" · "14:00"
export function formatSchedule(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  return {
    date: `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} (${weekdays[d.getDay()]})`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

// 입장 화면 · 대기 화면이 쓰는 Lecture 모양으로. 서버에 없는 색 · 이모지는 기본값을 쓴다
export function previewToLecture(code: string, p: JoinPreview): Lecture {
  const { date, time } = formatSchedule(p.scheduled_at);
  return {
    id: `join-${code}`,
    title: p.title,
    date,
    time,
    desc: p.description ?? "",
    status: p.status === "LIVE" ? "live" : "ready",
    code,
    tone: "ocean",
    emoji: "🎤",
    file: null,
    audience: p.participant_count,
    glossary: [],
    host: p.host_display_name,
  };
}

export type JoinFailure = {
  message: string;
  /** 입장 코드 자체가 틀림 → 잘못 입력한 횟수에 센다 */
  badCode?: boolean;
  /** 회원 쿠키가 무효 → 다시 로그인해야 함 */
  relogin?: boolean;
  /** 이 강연의 SERVICE 동의를 철회한 회원 → 다시 동의해야 들어올 수 있음 */
  consentRequired?: boolean;
  /** 끝난 강연 → 회원은 보관함에서 볼 수 있음 */
  ended?: boolean;
};

export function joinFailure(e: unknown): JoinFailure {
  if (isUnreachable(e) || !(e instanceof ApiError)) return { message: UNREACHABLE_MESSAGE };
  switch (e.code) {
    case "JOIN_CODE_INVALID":
      return { message: "입장 코드를 찾을 수 없어요. 다시 확인해 주세요.", badCode: true };
    case "JOIN_CODE_REVOKED":
      return { message: "재발급돼서 더 이상 쓸 수 없는 코드예요. 강연장 화면의 새 코드를 입력해 주세요." };
    case "SESSION_ENDED":
      return { message: "이미 끝난 강연이에요. 회원으로 참여했다면 보관함에서 다시 볼 수 있어요.", ended: true };
    case "SESSION_FULL":
      return { message: "정원(50명)이 가득 찬 강연이에요. 자리가 나면 다시 들어와 주세요." };
    case "SESSION_STATE_CONFLICT":
      return { message: "내가 연 강연에는 청중으로 들어갈 수 없어요. 내 강연에서 열어 주세요." };
    case "CONSENT_REQUIRED":
      return { message: "이 강연에 들어가려면 서비스 이용 동의가 필요해요.", consentRequired: true };
    case "AUTH_REQUIRED":
      return { message: "로그인이 만료됐어요. 다시 로그인해 주세요.", relogin: true };
    case "RATE_LIMITED": {
      const wait = e.retryAfter ? `${Math.max(1, Math.ceil(e.retryAfter / 60))}분 뒤에` : "잠시 후";
      return { message: `입장 코드 입력 횟수를 넘었어요. ${wait} 다시 시도해 주세요.` };
    }
    case "VALIDATION_ERROR":
      return { message: "입력한 내용을 다시 확인해 주세요." };
    default:
      // AUTH_SERVICE_UNAVAILABLE 등: 같은 요청을 다시 보내면 같은 참가자로 이어진다
      return { message: "잠시 후 다시 시도해 주세요." };
  }
}

// ── 입장한 강연 기억하기 ──
// 입장 확인(API-18)은 강연 ID를 주지 않아서, 입장(API-19) 응답의 session_id와 참가 종류를 코드별로 이 기기에 남긴다.
// 질문 · 실시간 API가 강연 ID로 부르기 때문이다. 접근 권한은 아니다(권한은 서버의 쿠키로 확인한다)
const JOINED_KEY = "easyq.joined";

export type JoinedSession = { sessionId: string; guest: boolean };

function readJoined(): Record<string, JoinedSession> {
  try {
    return JSON.parse(localStorage.getItem(JOINED_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

export function rememberJoinedSession(code: string, sessionId: string, kind: "MEMBER" | "GUEST") {
  try {
    // 오래된 코드가 쌓이지 않게 최근 20개만 둔다
    const entries = Object.entries({ ...readJoined(), [code.toUpperCase()]: { sessionId, guest: kind === "GUEST" } }).slice(-20);
    localStorage.setItem(JOINED_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // 저장소를 못 쓰면(사생활 보호 모드 등) 다음 방문 때 입장을 한 번 더 확인한다
  }
}

export function joinedSession(code: string): JoinedSession | null {
  const j = readJoined()[code.toUpperCase()];
  return j && typeof j.sessionId === "string" ? j : null;
}
