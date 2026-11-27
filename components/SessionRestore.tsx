"use client";

import { useEffect } from "react";
import { restoreSession } from "@/lib/api/auth";
import { DEMO } from "@/lib/demo";
import { applyServerSession, restoreMember } from "@/lib/store";

// 앱이 뜰 때 회원 로그인 상태를 복구한다 (관리자는 AdminShell에서 복구)
export function SessionRestore() {
  useEffect(() => {
    if (DEMO) return restoreMember();
    // 서버에 연결할 수 없으면 지금 상태를 그대로 둔다
    restoreSession().then(applyServerSession, () => {});
  }, []);
  return null;
}
