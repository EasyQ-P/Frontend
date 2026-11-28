// 내 정보 · 공지 · 문의 API (설계서 API-10, 42 ~ 44). API-10은 auth, 나머지는 backend.
import { api, setCsrfToken } from "./client";
import type { Paginated, User } from "./types";

/**
 * API-10 표시명 · 비밀번호 변경. 비밀번호를 바꾸면 이 계정의 다른 로그인은 모두 끊기고
 * 이 브라우저에는 새 세션 쿠키가 온다. CSRF 토큰도 바뀌므로 버리고 다음 요청 때 API-06으로 다시 받는다
 */
export async function updateMe(patch: { display_name?: string } | { current_password: string; new_password: string }) {
  const user = await api.patch<User>("/me", patch);
  if ("new_password" in patch) setCsrfToken(null);
  return user;
}

export type Notice = { notice_id: string; title: string; content: string; version: number; created_at: string; updated_at: string };

/** API-42 공지 목록 (최신순) */
export function listNotices(cursor?: string) {
  return api.get<Paginated<Notice>>("/notices", { query: { cursor, limit: 50 } });
}

export type Inquiry = {
  inquiry_id: string;
  title: string;
  content: string;
  status: "WAITING" | "ANSWERED";
  reply: string | null;
  replied_at: string | null;
  created_at: string;
  /** 관리자 목록에만 */
  author_display_name?: string;
};

/** API-43 1:1 문의 등록 (제목 100자 · 내용 2,000자) */
export function createInquiry(title: string, content: string) {
  return api.post<Inquiry>("/inquiries", { title, content });
}

/** API-44 문의 목록. 회원은 내 문의, 관리자는 전체 */
export function listInquiries(opts: { status?: "WAITING" | "ANSWERED"; cursor?: string } = {}) {
  return api.get<Paginated<Inquiry>>("/inquiries", { query: { status: opts.status, cursor: opts.cursor, limit: 50 } });
}
