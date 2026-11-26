// 가입 · 이메일 인증 · 비밀번호 재설정. 데모 모드(NEXT_PUBLIC_DEMO=true)는 목업으로,
// 그 밖에는 auth 서버(API-01 · 02 · 03 · 07 · 08)로 처리한다. 화면은 결과의 field · message만 보여 주면 된다
import * as accountsApi from "./api/accounts";
import { ApiError } from "./api/client";
import { MOCK_VERIFY_CODE } from "./auth";
import { DEMO } from "./demo";

export type Fail<F extends string = "form"> = { ok: false; field: F | "form"; message: string };
export type Result<F extends string = "form", T = object> = ({ ok: true } & T) | Fail<F>;

const mockDelay = () => new Promise((r) => setTimeout(r, 600));

// 여러 API에 공통인 실패 (연결 끊김 · 요청 한도 · 입력 오류)
function common(e: unknown, action: string): Fail {
  if (!(e instanceof ApiError)) return { ok: false, field: "form", message: "서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요." };
  if (e.code === "RATE_LIMITED") {
    const wait = e.retryAfter ? `${Math.max(1, Math.ceil(e.retryAfter / 60))}분 뒤에` : "잠시 후";
    return { ok: false, field: "form", message: `${action} 요청이 너무 많아요. ${wait} 다시 시도해 주세요.` };
  }
  if (e.code === "VALIDATION_ERROR") return { ok: false, field: "form", message: "입력한 내용을 다시 확인해 주세요." };
  return { ok: false, field: "form", message: "잠시 후 다시 시도해 주세요." };
}

// ── API-01 회원가입 ──
export async function signup(input: { name: string; email: string; pw: string; learn: boolean }): Promise<Result<"email">> {
  const email = input.email.trim();
  if (DEMO) {
    await mockDelay();
    if (email === "juhye@gachon.ac.kr") return { ok: false, field: "email", message: "이미 가입된 이메일이에요." };
    return { ok: true };
  }
  try {
    await accountsApi.signup({ email, password: input.pw, displayName: input.name.trim(), training: input.learn });
    return { ok: true };
  } catch (e) {
    if (e instanceof ApiError && e.code === "EMAIL_ALREADY_EXISTS") return { ok: false, field: "email", message: "이미 가입된 이메일이에요." };
    if (e instanceof ApiError && e.code === "CONSENT_REQUIRED") return { ok: false, field: "form", message: "필수 항목에 동의해 주세요." };
    return common(e, "인증 메일");
  }
}

// ── API-03 인증 코드 확인 ──
export async function confirmEmail(email: string, code: string): Promise<Result> {
  if (DEMO) {
    if (code !== MOCK_VERIFY_CODE) return { ok: false, field: "form", message: "인증 코드가 맞지 않아요. 메일의 6자리 코드를 다시 확인해 주세요." };
    return { ok: true };
  }
  try {
    await accountsApi.confirmVerification(email.trim(), code);
    return { ok: true };
  } catch (e) {
    if (e instanceof ApiError && e.code === "EMAIL_VERIFICATION_INVALID")
      return { ok: false, field: "form", message: "인증 코드가 맞지 않거나 만료됐어요. 코드는 10분 동안 쓸 수 있어요. 다시 확인하거나 새 코드를 받아 주세요." };
    if (e instanceof ApiError && e.code === "EMAIL_VERIFICATION_ATTEMPTS_EXCEEDED")
      return { ok: false, field: "form", message: "코드를 5번 틀려서 이 코드는 더 쓸 수 없어요. 새 코드를 받아 주세요." };
    return common(e, "인증");
  }
}

// ── API-02 인증 메일 재발송 ──
export async function resendEmail(email: string): Promise<Result> {
  if (DEMO) return { ok: true };
  try {
    await accountsApi.resendVerification(email.trim());
    return { ok: true };
  } catch (e) {
    return common(e, "인증 메일");
  }
}

// ── API-07 비밀번호 재설정 메일 요청 ──
export async function requestReset(email: string): Promise<Result> {
  if (DEMO) return { ok: true };
  try {
    await accountsApi.requestPasswordReset(email.trim());
    return { ok: true };
  } catch (e) {
    return common(e, "재설정 메일");
  }
}

// ── API-08 비밀번호 재설정 ──
// expired: 링크가 만료 · 사용됐거나 올바르지 않음 → 화면은 "다시 받기"를 안내한다
export async function resetPassword(token: string, pw: string): Promise<Result<"form", object> | (Fail & { expired?: boolean })> {
  if (DEMO) {
    await mockDelay();
    return { ok: true };
  }
  try {
    await accountsApi.resetPassword(token, pw);
    return { ok: true };
  } catch (e) {
    if (e instanceof ApiError && e.code === "RESET_TOKEN_INVALID") return { ok: false, field: "form", message: "링크가 만료됐거나 이미 사용됐어요.", expired: true };
    return common(e, "비밀번호 변경");
  }
}
