"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminTitle, Panel } from "@/components/admin";
import { EndReasonPill } from "@/components/lecture";
import { Button, Empty, Field, Modal, StatusPill, Tabs, inputCls, useToast } from "@/components/ui";
import { listAdminSessions, patchAdminSession } from "@/lib/api/admin";
import { adminSessions, sessionToAdmin, type AdminSession } from "@/lib/admin";
import { adminErrorMessage, adminLoggedOut } from "@/lib/adminApi";
import { DEMO } from "@/lib/demo";
import { setAdmin, setDemo } from "@/lib/store";

// 데모는 목업 강연, 실제 API는 강연 목록(API-47) · 평가용 표시 · 강제 종료(API-48)
export default function AdminSessions() {
  const router = useRouter();
  const [list, setList] = useState<AdminSession[]>(DEMO ? adminSessions : []);
  const [loading, setLoading] = useState(!DEMO);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"all" | AdminSession["status"]>("all");
  const [target, setTarget] = useState<AdminSession | null>(null);
  const toast = useToast();
  const showToast = toast.show;

  useEffect(() => {
    if (DEMO) return;
    let stopped = false;
    listAdminSessions().then(
      (r) => {
        if (stopped) return;
        // 삭제 중인 강연은 관리할 것이 없어 뺀다
        setList(r.items.filter((x) => x.status !== "DELETING").map(sessionToAdmin));
        setLoading(false);
      },
      (e) => {
        if (stopped) return;
        if (adminLoggedOut(e)) return (setAdmin(null), router.replace("/admin/login"));
        setLoading(false);
        showToast(adminErrorMessage(e), "coral");
      },
    );
    return () => {
      stopped = true;
    };
  }, [router, showToast]);

  const shown = list.filter((s) => tab === "all" || s.status === tab);
  const count = (st: AdminSession["status"]) => list.filter((s) => s.status === st).length;

  // 강제 종료 (API-48 status=ENDED, 사유 필수)
  async function forceEnd() {
    if (!target) return;
    if (!DEMO) {
      setBusy(true);
      try {
        const r = await patchAdminSession(target.id, target.version ?? 0, { status: "ENDED" }, reason.trim());
        setList((l) => l.map((s) => (s.id === target.id ? { ...s, status: "ended", endReason: "admin", version: r.version } : s)));
      } catch (e) {
        setBusy(false);
        return toast.show(adminErrorMessage(e), "coral");
      }
      setBusy(false);
      setReason("");
      toast.show("강연을 강제 종료했어요. 질문이 마감되고 QR이 꺼졌어요.", "coral");
      return setTarget(null);
    }
    setList((l) => l.map((s) => (s.id === target.id ? { ...s, status: "ended", endReason: "admin" } : s)));
    // 데모 강연자 · 청중 화면에도 종료가 반영되도록
    setDemo((s) => ({ endedLectures: [...s.endedLectures, target.id], endReasons: { ...s.endReasons, [target.id]: "admin" } }));
    toast.show("강연을 강제 종료했어요. 질문이 마감되고 QR이 꺼졌어요.", "coral");
    setTarget(null);
  }

  // 평가용 강연 표시는 시작 전에만 켤 수 있고, 켜면 끌 수 없다
  async function markEval(target: AdminSession) {
    if (target.status !== "ready" || target.evaluation) return;
    if (!DEMO) {
      try {
        const r = await patchAdminSession(target.id, target.version ?? 0, { is_eval_lecture: true }, "평가용 강연 지정");
        setList((l) => l.map((s) => (s.id === target.id ? { ...s, evaluation: true, version: r.version } : s)));
      } catch (e) {
        return toast.show(adminErrorMessage(e), "coral");
      }
      return toast.show("평가용 강연으로 표시했어요. 처리 로그를 평가셋으로 따로 모아요", "mint");
    }
    setList((l) => l.map((s) => (s.id === target.id ? { ...s, evaluation: true } : s)));
    toast.show("평가용 강연으로 표시했어요. 처리 로그를 평가셋으로 따로 모아요", "mint");
  }

  return (
    <>
      {toast.node}
      <AdminTitle desc="모든 회원의 강연을 보고, 평가용 강연을 표시하거나 문제가 생긴 강연을 강제로 종료해요">강연 관리</AdminTitle>

      <Tabs
        className="mt-6"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "all", label: "전체", count: list.length },
          { value: "live", label: "진행 중", count: count("live") },
          { value: "ready", label: "준비", count: count("ready") },
          { value: "ended", label: "종료", count: count("ended") },
        ]}
      />

      <Panel className="mt-4">
        {loading ? (
          <p className="py-10 text-center text-sm text-muted">불러오는 중…</p>
        ) : shown.length === 0 ? (
          <Empty title="해당하는 강연이 없어요" />
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="pb-2 font-medium">강연</th>
                  <th className="pb-2 font-medium">강연자</th>
                  <th className="pb-2 font-medium">일시</th>
                  <th className="pb-2 text-right font-medium">청중</th>
                  <th className="pb-2 text-right font-medium">질문</th>
                  <th className="pb-2 pl-4 font-medium">상태</th>
                  <th className="pb-2 pl-4 font-medium">
                    평가용 <span className="font-normal">(시작 전만 · 켜면 끌 수 없음)</span>
                  </th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.id} className="border-b border-line last:border-0">
                    <td className="py-3 pr-3">
                      <p className="font-semibold">{s.title}</p>
                      <p className="text-xs text-muted">
                        입장 코드 {s.code}
                      </p>
                    </td>
                    <td className="py-3 text-ink/70">{s.speaker}</td>
                    <td className="py-3 text-ink/70">{s.date}</td>
                    <td className="py-3 text-right">{s.audience}</td>
                    <td className="py-3 text-right">{s.questions}</td>
                    <td className="py-3 pl-4">
                      <div className="flex flex-col items-start gap-1">
                        <StatusPill status={s.status} onColor />
                        {s.status === "ended" && s.endReason && <EndReasonPill reason={s.endReason} />}
                      </div>
                    </td>
                    <td className="py-3 pl-4">
                      <button
                        role="switch"
                        aria-checked={!!s.evaluation}
                        aria-label={`${s.title} 평가용 강연`}
                        disabled={s.status !== "ready" || !!s.evaluation}
                        title={s.evaluation ? "켜면 끌 수 없어요" : s.status !== "ready" ? "시작 전에만 켤 수 있어요" : undefined}
                        onClick={() => markEval(s)}
                        className={`flex h-7 w-12 items-center rounded-full p-1 transition-colors disabled:opacity-35 ${s.evaluation ? "bg-ink" : "bg-ink/15"}`}
                      >
                        <span className={`h-5 w-5 rounded-full bg-white transition-transform ${s.evaluation ? "translate-x-5" : ""}`} />
                      </button>
                    </td>
                    <td className="py-3 text-right">
                      {s.status === "live" && (
                        <Button size="sm" variant="ghost" onClick={() => setTarget(s)}>
                          강제 종료
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal open={!!target} onClose={() => setTarget(null)} title="강연을 강제 종료할까요?">
        <p className="font-semibold">{target?.title}</p>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          강연자가 종료한 것과 같이 처리돼요. 질문 접수가 마감되고 QR · 입장 링크가 꺼지며, 강연자와 청중 {target?.audience ?? 0}명에게 종료 안내가 가요.
        </p>
        <div className="mt-4">
          <Field label="종료 사유 (감사 기록에 남아요)">
            <textarea className={`${inputCls} h-20 resize-none`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="예: 부적절한 내용으로 신고 접수" />
          </Field>
        </div>
        <div className="mt-6 flex gap-2">
          <Button variant="soft" className="flex-1" onClick={() => setTarget(null)}>
            취소
          </Button>
          <Button variant="danger" className="flex-1" disabled={!reason.trim() || busy} onClick={forceEnd}>
            강제 종료
          </Button>
        </div>
      </Modal>
    </>
  );
}
