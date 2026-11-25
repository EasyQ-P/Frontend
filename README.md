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

## 환경변수

`.env.example`을 `.env.local`로 복사해서 씁니다. `.env.local`은 git에 올리지 않습니다.

| 이름 | 설명 |
|---|---|
| `NEXT_PUBLIC_DEMO` | `true`면 시연용 요소(데모 버튼 · 예시 코드 등)를 보여 줍니다. 기본값은 숨김 |
| `NEXT_PUBLIC_API_BASE_URL` | 백엔드 API 주소 (연동 시 사용 예정) |

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
