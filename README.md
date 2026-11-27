# EasyQ Frontend

EasyQ 웹 프론트엔드입니다. Next.js 16 (App Router) · React 19 · Tailwind CSS 4로 만들었습니다.

지금은 목업 데이터로 동작하는 데모 상태이며, API 연동을 진행 중입니다. 데모 시점의 코드는 `demo-v1` 태그로 남겨 두었습니다.

## 시작하기

```bash
npm install
cp .env.example .env.local   # 환경변수 설정
npm run dev                  # http://localhost:3000
```

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 프로덕션 빌드 |
| `npm run start` | 빌드 결과 실행 |
| `npm run lint` | ESLint 검사 |

### 백엔드와 함께 실행

백엔드 레포([EasyQ-P/Backend](https://github.com/EasyQ-P/Backend))의 `docker compose up`으로 auth · backend · DB · Caddy를 띄운 뒤, 이 레포에서 `npm run dev`를 실행하고 **브라우저는 http://localhost:8080 으로 접속**합니다. Caddy가 `/api/v1`은 백엔드로, 나머지는 Next.js 개발 서버(:3000)로 보내 주므로 `API_PROXY_TARGET`은 필요 없습니다. 자세한 내용은 백엔드 레포의 `docs/service/frontend-dev.md`를 보세요.

| 계정 (로컬 개발 DB 전용) | 이메일 | 비밀번호 |
|---|---|---|
| 회원 | `member@easyq.local` | `easyq2026` |
| 관리자 | `admin@easyq.local` | `admin2026` |

## 환경변수

`.env.example`을 `.env.local`로 복사해서 씁니다. `.env.local`은 git에 올리지 않습니다.

| 이름 | 설명 |
|---|---|
| `NEXT_PUBLIC_DEMO` | `true`면 시연용 요소(데모 버튼 · 예시 코드 등)를 보여 줍니다. 기본값은 숨김 |
| `API_PROXY_TARGET` | 로컬 개발 전용. `/api/v1` 요청을 넘길 backend 주소 (예: `http://localhost:8000`) |
| `AUTH_PROXY_TARGET` | 로컬 개발 전용. auth 경로(`/api/v1/users` · `/api/v1/auth/*` · `/api/v1/me`)를 넘길 주소. 비우면 `API_PROXY_TARGET`으로 보냄 |

브라우저는 항상 같은 출처의 `/api/v1`만 호출합니다. 운영에서는 Caddy가 경로별로 auth · backend에 나눠 보내므로 API 주소 환경변수가 필요 없습니다. 로컬에서는 Caddy가 없으니 Next.js 개발 서버가 같은 규칙으로 대신 넘겨 줍니다([next.config.ts](next.config.ts)).

## API 호출

[lib/api/client.ts](lib/api/client.ts)의 `api`로 호출합니다. 공통 응답에서 `data`만 꺼내 주고, 실패하면 `ApiError`(`status` · `code` · `retryable` 등)를 던집니다.

```ts
import { api } from "@/lib/api/client";

const session = await api.get<Session>(`/sessions/${sid}`);
await api.patch(`/sessions/${sid}`, { status: "LIVE" }, { ifMatch: session.version });
await api.post(`/sessions/${sid}/documents/${did}/retries`, undefined, { idempotencyKey: true });
```

- 변경 요청에는 CSRF 토큰을 자동으로 붙입니다. 토큰은 메모리에만 두고, 없으면 `/auth/csrf-tokens`로 다시 받습니다.
- 가입 · 로그인 · 입장처럼 로그인 전에 부르는 API는 `{ csrf: false }`를 넘깁니다.
- 기능별 함수는 `lib/api/<이름>.ts`에 둡니다 (예: [lib/api/auth.ts](lib/api/auth.ts)).

## 화면

| 경로 | 화면 |
|---|---|
| `/` | 시작 |
| `/signup` · `/verify` · `/login` | 회원가입 · 이메일 인증 · 로그인 |
| `/password/forgot` · `/password/reset` | 비밀번호 찾기 · 재설정 |
| `/home` | 홈 |
| `/join` | QR · 코드 입장 |
| `/live/[code]` | 청중 실시간 화면 |
| `/archive` · `/archive/[id]` | 내 보관함 · 상세 |
| `/lectures` | 내 강의 목록 |
| `/lectures/new` | 강의 생성 |
| `/lectures/[id]` | 강의 준비 (교안 · 용어 사전 · QR) |
| `/lectures/[id]/live` | 강연자 라이브 대시보드 |
| `/lectures/[id]/report` | 강의 리포트 |
| `/me` | 내 정보 |
| `/admin/login` | 관리자 로그인 |
| `/admin` | 관리자 콘솔 (회원 · 세션 · 공지 · 모델 · 데이터) |

## 구조

```
app/         페이지 (라우트별 폴더)
components/  공통 컴포넌트 (UI 기본 요소 · 아이콘 · QR · 요약 노트 등)
lib/
  api/       API 클라이언트 · 응답 타입 · 기능별 호출 함수
  mock.ts    목업 데이터 → API 연동 시 실제 호출로 대체
  store.ts   페이지 이동 사이에 유지되는 클라이언트 상태
  auth.ts    로그인 · 비밀번호 검증 (현재 목업)
  admin.ts   관리자 콘솔 데이터 (현재 목업)
  demo.ts    데모 모드 플래그 (NEXT_PUBLIC_DEMO)
```

## 브랜치

| 브랜치 | 용도 |
|---|---|
| `main` | 배포용. `develop`에서 검증된 것만 합칩니다 |
| `develop` | 개발 통합. 기능 브랜치는 여기서 만들고 여기로 PR을 보냅니다 |
| `feature/<이름>` | 기능 작업 (예: `feature/api-auth`) |

## 참고

`AGENTS.md`는 `next dev`가 자동으로 만드는 파일입니다. 지우지 말고 그대로 두세요.
