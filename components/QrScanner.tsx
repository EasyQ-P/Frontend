"use client";

// 카메라로 입장 QR 읽기. 휴대폰 뒷면 카메라를 켜고, QR이 읽히면 onResult로 입장 코드를 넘긴다.
// 영상은 기기 안에서만 판독하고 어디에도 보내거나 저장하지 않는다
import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";

// 판독 간격. 매 프레임마다 읽으면 휴대폰이 뜨거워진다
const SCAN_MS = 150;
const CODE_RE = /^[A-Z0-9]{5}$/;

// QR 내용 → 입장 코드. EasyQ 입장 링크(…/join?code=XXXXX)나 코드 5자리만 받는다.
// 링크의 주소로 이동하지 않고 코드만 꺼내 쓴다 (다른 사이트로 보내는 QR을 막기 위해)
export function codeFromQr(text: string): string | null {
  const raw = text.trim();
  if (CODE_RE.test(raw.toUpperCase())) return raw.toUpperCase();
  try {
    const u = new URL(raw);
    const code = u.searchParams.get("code")?.trim().toUpperCase() ?? "";
    if (u.pathname.replace(/\/$/, "").endsWith("/join") && CODE_RE.test(code)) return code;
  } catch {}
  return null;
}

export type ScanError = "denied" | "missing" | "insecure" | "unknown";

export function QrScanner({ onResult, onError }: { onResult: (code: string) => void; onError: (e: ScanError) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [notEasyQ, setNotEasyQ] = useState(false);
  // 콜백이 바뀌어도 카메라를 다시 켜지 않도록 최신 값만 들고 있는다
  const handlers = useRef({ onResult, onError });
  useEffect(() => {
    handlers.current = { onResult, onError };
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const stop = () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };

    const scan = () => {
      const video = videoRef.current;
      if (stopped || !video || !ctx) return;
      if (video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth) {
        // 큰 화면은 줄여서 읽는다 (판독 속도)
        const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        if (found?.data) {
          const code = codeFromQr(found.data);
          if (code) {
            stop();
            return handlers.current.onResult(code);
          }
          setNotEasyQ(true);
        }
      }
      timer = setTimeout(scan, SCAN_MS);
    };

    (async () => {
      // 카메라는 https(또는 localhost)에서만 쓸 수 있다
      if (!navigator.mediaDevices?.getUserMedia) return handlers.current.onError(window.isSecureContext ? "missing" : "insecure");
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        scan();
      } catch (e) {
        if (stopped) return;
        const name = e instanceof DOMException ? e.name : "";
        handlers.current.onError(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" || name === "OverconstrainedError" || name === "NotReadableError" ? "missing" : "unknown");
      }
    })();

    return stop;
  }, []);

  return (
    <>
      <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
      {/* 가운데 읽는 영역 표시 */}
      <span className="pointer-events-none absolute left-1/2 top-1/2 h-[58%] max-h-64 w-[58%] max-w-64 -translate-x-1/2 -translate-y-1/2 rounded-3xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
      <p className="absolute inset-x-0 bottom-4 text-center text-sm font-semibold text-white drop-shadow">{notEasyQ ? "EasyQ 입장 QR이 아니에요. 강연장 화면의 QR을 비춰 주세요" : "강연장 화면의 QR을 네모 안에 비춰 주세요"}</p>
    </>
  );
}
