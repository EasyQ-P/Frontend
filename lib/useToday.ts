"use client";

import { useSyncExternalStore } from "react";

// 기기 시간 기준 오늘 날짜. 화면을 켜 둔 채 자정이 지나면 다음 날로 바뀐다.
// 서버 렌더링(빌드 시점)에서는 날짜를 알 수 없으므로 null을 돌려준다 → 화면은 날짜 자리를 비워 둔다
function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, 60_000);
  // 잠자기 · 다른 탭에 있다가 돌아왔을 때 바로 맞춘다
  document.addEventListener("visibilitychange", onChange);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onChange);
  };
}

// 같은 날에는 같은 문자열을 돌려줘야 다시 그리지 않는다
function snapshot() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function useToday(): { year: number; month: number; day: number; weekday: string } | null {
  const key = useSyncExternalStore(subscribe, snapshot, () => null);
  if (!key) return null;
  const [y, m, d] = key.split("-").map(Number);
  const weekday = new Date(y, m - 1, d).toLocaleDateString("ko-KR", { weekday: "long" });
  return { year: y, month: m, day: d, weekday };
}
