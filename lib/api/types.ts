// API 설계서 7.1.2 공통 규칙 · 7.3.1 공통 응답 객체

export type ApiSuccess<T> = { request_id: string; data: T };

export type ApiErrorBody = {
  request_id: string;
  error: {
    code: string;
    message: string;
    details?: unknown;
    retryable?: boolean;
  };
};

// 목록 응답 (cursor 방식, limit 기본 20 · 최대 100)
export type Paginated<T> = {
  items: T[];
  next_cursor: string | null;
  total_count: number;
};

// 202 Accepted로 받는 비동기 작업 (Location: /api/v1/jobs/{job_id})
export type AcceptedJob = {
  resource_id: string;
  job_id: string;
  status: string;
};

export type Consent = { policy_version: string; granted: boolean };

export type User = {
  user_id: string;
  email: string;
  display_name: string;
  role: "MEMBER" | "ADMIN";
  status: "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED" | "DELETING";
  email_verified_at: string | null;
  consents: { SERVICE?: Consent; TRAINING?: Consent };
};

// 로그인 응답. 세션 토큰은 HttpOnly 쿠키로만 오고 본문에는 csrf_token만 온다
export type Auth = {
  user: User;
  expires_at: string;
  csrf_token: string;
};
