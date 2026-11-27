// 공통 API 클라이언트. 설계서 7.1.1 권한과 인증 · 7.1.2 공통 규칙을 따른다.
// - 브라우저는 같은 출처의 /api/v1만 호출한다 (쿠키는 HttpOnly라 JS에서 읽지 않는다)
// - 변경 요청(POST · PUT · PATCH · DELETE)에는 X-CSRF-Token을 붙인다
// - CSRF 토큰은 메모리에만 둔다. 새로고침으로 사라지면 API-06으로 다시 받는다
import type { ApiErrorBody, ApiSuccess } from "./types";

export const API_BASE = "/api/v1";

// API-06 CSRF 재발급에 필요한 헤더 (백엔드 docs/service/frontend-dev.md)
const CLIENT_HEADER = { "X-EasyQ-Client": "web" };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly retryable = false,
    readonly requestId?: string,
    /** 429 RATE_LIMITED일 때 Retry-After(초) */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * 서버(API)에 닿지 못한 실패: 네트워크 오류, 또는 API 대신 다른 응답(HTML 404 · 프록시 502 등)이 온 경우.
 * API 오류는 늘 {request_id, error}로 오므로, 그 모양이 아니면 code가 HTTP_<상태>가 된다
 */
export function isUnreachable(e: unknown) {
  return !(e instanceof ApiError) || e.code.startsWith("HTTP_");
}

export const UNREACHABLE_MESSAGE = "서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.";

/** 회원만 쓸 수 있는 기능에 로그인 없이(401) 또는 게스트 세션으로(403) 들어온 경우 */
export function needsMemberLogin(e: unknown) {
  return e instanceof ApiError && (e.code === "AUTH_REQUIRED" || e.code === "FORBIDDEN");
}

// ── CSRF 토큰 (메모리 보관) ──
let csrfToken: string | null = null;
let csrfRefresh: Promise<string | null> | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

/** API-06. 로그인 상태가 아니면(401) null을 돌려준다. 동시에 여러 번 불러도 요청은 한 번만 보낸다 */
export function refreshCsrfToken(): Promise<string | null> {
  csrfRefresh ??= (async () => {
    try {
      const data = await request<{ csrf_token: string }>("POST", "/auth/csrf-tokens", { csrf: false });
      csrfToken = data.csrf_token;
      return csrfToken;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        csrfToken = null;
        return null;
      }
      throw e;
    } finally {
      csrfRefresh = null;
    }
  })();
  return csrfRefresh;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RequestOptions = {
  body?: unknown;
  /** 쿼리 문자열. undefined · null 값은 빠진다 */
  query?: Record<string, string | number | boolean | null | undefined>;
  /**
   * CSRF 토큰을 붙일지. 변경 요청은 기본 true.
   * 가입 · 인증 메일 · 인증 확인 · 로그인 · 입장 · 비밀번호 재설정 · CSRF 재발급은 false (Origin 검사만)
   */
  csrf?: boolean;
  /** 강연 · 질문 상태 변경 시 리소스 version (If-Match) */
  ifMatch?: number | string;
  /** 비동기 POST의 Idempotency-Key. true면 새로 만든다. 재시도할 때는 같은 키를 넘긴다 */
  idempotencyKey?: string | true;
  signal?: AbortSignal;
};

async function request<T>(method: Method, path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const { body, query, ifMatch, signal } = opts;
  // 재시도해도 같은 키를 보내도록 여기서 한 번만 만든다
  const idempotencyKey = opts.idempotencyKey === true ? crypto.randomUUID() : opts.idempotencyKey;
  const needsCsrf = opts.csrf ?? method !== "GET";

  let url = API_BASE + path;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v != null) qs.set(k, String(v));
    const s = qs.toString();
    if (s) url += `?${s}`;
  }

  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const headers: Record<string, string> = { Accept: "application/json", ...CLIENT_HEADER };
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  if (ifMatch !== undefined) headers["If-Match"] = `"${ifMatch}"`;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  if (needsCsrf) {
    const token = csrfToken ?? (await refreshCsrfToken());
    if (token) headers["X-CSRF-Token"] = token;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });

  if (res.status === 204) return undefined as T;

  const json = (await res.json().catch(() => null)) as ApiSuccess<T> | ApiErrorBody | null;

  if (!res.ok) {
    const err = json && "error" in json ? json.error : null;
    // CSRF 실패(403 + details.reason = "CSRF")만 토큰을 다시 받아 한 번 재시도한다
    const reason = (err?.details as { reason?: string } | undefined)?.reason;
    if (res.status === 403 && reason === "CSRF" && needsCsrf && !retried) {
      csrfToken = null;
      if (await refreshCsrfToken()) return request<T>(method, path, { ...opts, idempotencyKey }, true);
    }
    const retryAfter = Number(res.headers.get("Retry-After")) || undefined;
    throw new ApiError(
      res.status,
      err?.code ?? `HTTP_${res.status}`,
      err?.message ?? res.statusText,
      err?.details,
      err?.retryable ?? false,
      json?.request_id,
      retryAfter,
    );
  }

  return (json as ApiSuccess<T>).data;
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, "body">) => request<T>("GET", path, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("POST", path, { ...opts, body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("PUT", path, { ...opts, body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("PATCH", path, { ...opts, body }),
  delete: <T = void>(path: string, opts?: RequestOptions) => request<T>("DELETE", path, opts),
};
