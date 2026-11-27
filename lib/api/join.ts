// 입장 API (설계서 API-18 · 19). 처리 서버는 backend.
// 입장은 로그인 전에도 부르므로 CSRF 없이 Origin 검사만 받는다
import { api, setCsrfToken } from "./client";

/** API-18 입장 전 강연 확인. 참가를 만들지 않는다 */
export type JoinPreview = {
  title: string;
  host_display_name: string;
  scheduled_at: string;
  description: string | null;
  status: "DRAFT" | "LIVE";
  participant_count: number;
  capacity: number;
  is_full: boolean;
  /** 로그인한 회원 · 기존 게스트가 이미 참가했으면 true */
  already_joined: boolean;
};

export type Participation = {
  participant_id: string;
  session_id: string;
  kind: "MEMBER" | "GUEST";
  /** 게스트 닉네임, 회원은 표시명 */
  nickname: string | null;
  session_status: "DRAFT" | "LIVE";
  expires_at: string;
  /** 게스트 첫 입장에만 (Set-Cookie와 함께) */
  csrf_token?: string | null;
};

export function getJoinPreview(code: string) {
  return api.get<JoinPreview>(`/join-codes/${encodeURIComponent(code.trim().toUpperCase())}`);
}

/**
 * API-19 입장. 회원은 join_code만 보낸다(계정 동의 사용). 게스트는 nickname과 service_consent가 필수다.
 * idempotencyKey: 같은 입장 시도를 다시 보낼 때(네트워크 오류 · 503) 같은 값을 넘기면 같은 참가자를 재사용한다
 */
export async function participate(
  input: { code: string; guest?: { nickname: string; training: boolean }; serviceConsent?: boolean },
  idempotencyKey: string,
) {
  const body: Record<string, unknown> = { join_code: input.code.trim().toUpperCase() };
  if (input.guest) {
    body.nickname = input.guest.nickname;
    body.service_consent = true;
    body.training_consent = input.guest.training;
  } else if (input.serviceConsent) {
    body.service_consent = true;
  }
  const p = await api.post<Participation>("/participations", body, { csrf: false, idempotencyKey });
  if (p.csrf_token) setCsrfToken(p.csrf_token);
  return p;
}
