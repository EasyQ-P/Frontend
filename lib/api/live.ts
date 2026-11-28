"use client";

// 강연 실시간 이벤트 (설계서 7.3.10 WebSocket /api/v1/ws/sessions/{sid}).
// 같은 출처의 HttpOnly 쿠키로 인증하고, 서버가 받는 사람 권한에 맞는 이벤트만 보낸다.
// 연결이 끊기면 다시 연결하고, 다시 연결될 때마다 onReconnect로 화면이 REST로 최신 상태를 다시 받게 한다
// (끊긴 동안 놓친 이벤트를 서버가 다시 보내 주지 않는다)
import { useEffect, useRef, useState } from "react";
import { API_BASE, setCsrfToken } from "./client";

export type LiveEvent = {
  type: string;
  event_id: number | null;
  session_id: string;
  resource_version: number | null;
  data: Record<string, unknown>;
};

export type LiveState = "connecting" | "open" | "closed";

// 1008(권한 없음 · 세션 만료)은 다시 연결해도 같으므로 멈춘다
const POLICY_CLOSE = 1008;
const RETRY_MS = [1000, 2000, 5000, 10_000];

export function useLiveEvents(sid: string | null, handlers: { onEvent: (e: LiveEvent) => void; onReconnect?: () => void; onDenied?: () => void }) {
  const [state, setState] = useState<LiveState>("connecting");
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    if (!sid) return;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;
    let opened = false;

    const connect = () => {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${window.location.host}${API_BASE}/ws/sessions/${sid}`);
      ws.onopen = () => {
        setState("open");
        if (opened) ref.current.onReconnect?.();
        opened = true;
        attempt = 0;
      };
      ws.onmessage = (m) => {
        if (typeof m.data !== "string") return;
        let e: LiveEvent;
        try {
          e = JSON.parse(m.data);
        } catch {
          return;
        }
        // 서버 ping에는 pong으로 답해 연결을 유지한다 (60초 동안 아무 메시지가 없으면 서버가 닫는다)
        if (e.type === "ping") return ws?.send(JSON.stringify({ type: "pong", data: {} }));
        // 서버가 CSRF 토큰을 바꿨다: 들고 있던 토큰을 버리면 다음 변경 요청 전에 API-06으로 새로 받는다
        if (e.type === "auth.csrf_rotated") return setCsrfToken(null);
        ref.current.onEvent(e);
      };
      ws.onclose = (c) => {
        if (stopped) return;
        setState("closed");
        if (c.code === POLICY_CLOSE) return ref.current.onDenied?.();
        timer = setTimeout(connect, RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)]);
      };
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close(1000);
    };
  }, [sid]);

  return state;
}
