"use client";

// 청중 입장 QR. 입장 링크(/join?code=…)를 담은 실제로 스캔되는 QR을 브라우저에서 직접 그린다.
// 외부 QR 서비스를 부르지 않는다: 입장 링크(강연에 들어올 수 있는 값)를 다른 서버에 보내지 않기 위해서다
import QRCode from "qrcode";
import { useMemo, useSyncExternalStore } from "react";

const noop = () => () => {};

// 이 화면이 열린 주소(예: https://easyqna.live). 서버 렌더링에서는 알 수 없으므로 null
function useOrigin() {
  return useSyncExternalStore(noop, () => window.location.origin, () => null);
}

// 휴대폰 카메라로 찍으면 열릴 주소. 서버가 준 join_url이 있으면 그것을, 없으면(데모) 지금 주소로 만든다
export function useJoinUrl(code: string, url?: string) {
  const origin = useOrigin();
  if (url) return url;
  return origin ? `${origin}/join?code=${encodeURIComponent(code)}` : null;
}

// 흰 여백(모듈 칸 수). 표준은 4칸이지만 카드 안에서는 흰 바탕이 이어져 3칸으로도 잘 읽힌다
const QUIET = 3;

export function JoinQr({ code, url, size = 180, dim = false }: { code: string; url?: string; size?: number; dim?: boolean }) {
  const value = useJoinUrl(code, url);

  // 검은 칸을 한 줄 경로로 그린다 (칸마다 rect를 쓰는 것보다 가볍다)
  const qr = useMemo(() => {
    if (!value) return null;
    const { modules } = QRCode.create(value, { errorCorrectionLevel: "M" });
    let d = "";
    for (let y = 0; y < modules.size; y++) for (let x = 0; x < modules.size; x++) if (modules.get(y, x)) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
    return { d, n: modules.size + QUIET * 2 };
  }, [value]);

  return (
    <svg
      viewBox={`0 0 ${qr?.n ?? 1} ${qr?.n ?? 1}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={`shrink-0 rounded-xl ${dim ? "opacity-25 grayscale" : ""}`}
      role="img"
      aria-label={`입장 QR (${code})`}
    >
      <rect width="100%" height="100%" fill="#fff" />
      {qr && <path d={qr.d} fill="#121212" />}
    </svg>
  );
}
