// 인증 API (설계서 API-04 · 05 · 06 · 09). 처리 서버는 auth.
// 다른 API 모듈도 이 파일처럼 기능별로 lib/api/<이름>.ts에 만든다
import { ApiError, api, refreshCsrfToken, setCsrfToken } from "./client";
import type { Auth, User } from "./types";

/** API-04 로그인. 관리자도 같은 API를 쓴다 */
export async function login(email: string, password: string): Promise<Auth> {
  const auth = await api.post<Auth>("/auth/sessions", { email, password }, { csrf: false });
  setCsrfToken(auth.csrf_token);
  return auth;
}

/** API-05 로그아웃. 이미 폐기된 세션이어도 성공한다 */
export async function logout(): Promise<void> {
  try {
    await api.delete("/auth/sessions/current");
  } finally {
    setCsrfToken(null);
  }
}

/** API-09 내 계정 정보. 게스트는 403 */
export function getMe(): Promise<User> {
  return api.get<User>("/me");
}

/**
 * 새로고침 후 회원 로그인 상태 복구 (API-06 → API-09).
 * 로그인하지 않았거나 게스트 세션이면 null
 */
export async function restoreSession(): Promise<User | null> {
  const token = await refreshCsrfToken();
  if (!token) return null;
  try {
    return await getMe();
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
    throw e;
  }
}
