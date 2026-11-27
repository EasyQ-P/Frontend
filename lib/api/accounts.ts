// 가입 · 이메일 인증 · 비밀번호 재설정 API (설계서 API-01 · 02 · 03 · 07 · 08). 처리 서버는 auth.
// 모두 로그인 전에 부르므로 CSRF 없이 Origin 검사만 받는다
import { api } from "./client";

// 동의 문서 버전. 백엔드 기본값(SERVICE_POLICY_VERSION · TRAINING_POLICY_VERSION)과 같아야 한다
export const POLICY = { SERVICE: "service-v1", TRAINING: "training-v1", STT: "stt-v1" } as const;

export type SignupData = {
  user_id: string;
  status: "PENDING_VERIFICATION";
  /** 인증 메일을 다시 보낼 수 있는 시각 */
  resend_available_at: string;
};

/** API-01 회원가입. 인증 메일이 함께 나가고, 인증 전에는 로그인할 수 없다 */
export function signup(input: { email: string; password: string; displayName: string; training: boolean }) {
  return api.post<SignupData>(
    "/users",
    {
      email: input.email,
      password: input.password,
      display_name: input.displayName,
      consents: {
        SERVICE: { policy_version: POLICY.SERVICE, granted: true },
        TRAINING: { policy_version: POLICY.TRAINING, granted: input.training },
      },
    },
    { csrf: false },
  );
}

/** API-02 인증 메일 재발송. 계정이 있는지와 관계없이 같은 응답 */
export function resendVerification(email: string) {
  return api.post<{ message: string }>("/auth/email-verifications", { email }, { csrf: false });
}

/** API-03 인증 코드 확인. 인증이 끝나도 자동 로그인하지 않는다 */
export function confirmVerification(email: string, code: string) {
  return api.post<{ email_verified: true; next_action: "LOGIN" }>("/auth/email-verifications/confirm", { email, code }, { csrf: false });
}

/** API-07 비밀번호 재설정 메일 요청. 가입 여부와 관계없이 같은 응답 */
export function requestPasswordReset(email: string) {
  return api.post<Record<string, never>>("/auth/password-reset-requests", { email }, { csrf: false });
}

/** API-08 비밀번호 재설정. 그 계정의 모든 세션이 닫힌다 */
export function resetPassword(token: string, newPassword: string) {
  return api.post<void>("/auth/password-resets", { token, new_password: newPassword }, { csrf: false });
}

/** API-11 계정 단위 동의 변경. SERVICE 철회는 탈퇴로만 할 수 있어 여기서는 TRAINING만 바꾼다 */
export function changeAccountConsent(purpose: "TRAINING", granted: boolean) {
  return api.post<{ consent_id: string; purpose: string; policy_version: string; granted: boolean; recorded_at: string; deletion_job_id?: string }>("/me/consents", {
    purpose,
    policy_version: POLICY[purpose],
    granted,
  });
}
