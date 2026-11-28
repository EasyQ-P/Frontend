"use client";

// 모델 (실제 API). 서빙 설정 · 전환 이력(API-63) · 전환 · 롤백 · LLM_ONLY(API-62) · 재학습(API-57/58/59) ·
// 모델 버전(API-60) · 평가 결과(API-61). 데모 모드는 app/admin/(console)/models/page.tsx의 목업 화면을 쓴다
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AdminTitle, Dot, Panel } from "@/components/admin";
import { Icon } from "@/components/Icon";
import { Button, Empty, Field, Modal, Pill, Progress, inputCls, useToast } from "@/components/ui";
import {
  deploy,
  getDeployments,
  getTrainingRun,
  listDatasets,
  listEvaluations,
  listModels,
  startTraining,
  stopTraining,
  type Dataset,
  type Deployment,
  type Evaluation,
  type ModelVersion,
  type Serving,
  type TrainingRun,
} from "@/lib/api/admin";
import { adminErrorMessage, adminLoggedOut } from "@/lib/adminApi";
import { setAdmin, setDemo } from "@/lib/store";

const RUN_KEY = "easyq.admin.trainingRun";
const RUN_POLL_MS = 3000;
const DONE: TrainingRun["status"][] = ["SUCCEEDED", "FAILED", "HELD", "CANCELLED"];
const runText: Record<TrainingRun["status"], string> = { QUEUED: "대기", RUNNING: "학습 중", SUCCEEDED: "완료", FAILED: "실패", HELD: "등록 보류", CANCELLED: "중단됨" };
const deployText: Record<Deployment["status"], string> = { PENDING: "적용 확인 중", ACTIVE: "서빙 중", SUPERSEDED: "교체됨", FAILED: "실패" };

const fmt = (v: unknown) => (typeof v === "number" ? (Math.abs(v) < 10 && !Number.isInteger(v) ? v.toFixed(3) : v.toLocaleString()) : String(v ?? "–"));
// 지표 중 숫자만 (학습서버가 보내는 baselines 같은 묶음 값은 뺀다)
const numeric = (m: Record<string, unknown>) => Object.entries(m).filter((e): e is [string, number] => typeof e[1] === "number");
const metricText = (m: Record<string, unknown>) =>
  numeric(m)
    .map(([k, v]) => `${k} ${fmt(v)}`)
    .join(" · ");
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ko-KR") : "–");

function readRun() {
  try {
    return localStorage.getItem(RUN_KEY);
  } catch {
    return null;
  }
}
function writeRun(id: string | null) {
  try {
    if (id) localStorage.setItem(RUN_KEY, id);
    else localStorage.removeItem(RUN_KEY);
  } catch {}
}

type Loaded = { serving: Serving | null; history: Deployment[]; models: ModelVersion[]; datasets: Dataset[] };
type Confirm = { kind: "CUSTOM"; model: ModelVersion } | { kind: "LLM_ONLY" };

export function RemoteAdminModels() {
  const router = useRouter();
  const toast = useToast();
  const showToast = toast.show;
  const [data, setData] = useState<Loaded | null>(null);
  const [evals, setEvals] = useState<Evaluation[]>([]);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [datasetId, setDatasetId] = useState("");
  const [epochs, setEpochs] = useState("");
  const [runId, setRunId] = useState<string | null>(() => readRun());
  const [run, setRun] = useState<TrainingRun | null>(null);
  const [stopOpen, setStopOpen] = useState(false);

  const fail = useCallback(
    (e: unknown) => {
      if (adminLoggedOut(e)) return (setAdmin(null), router.replace("/admin/login"));
      showToast(adminErrorMessage(e), "coral");
    },
    [router, showToast],
  );

  const load = useCallback(
    () =>
      Promise.all([getDeployments(), listModels(), listDatasets()]).then(([d, m, ds]) => {
        setData({ serving: d.active, history: d.items, models: m.items, datasets: ds.items });
        // 사이드바의 "현재 서빙 모델"도 같이 바꾼다
        if (d.active) setDemo({ servingVersion: d.active.mode === "LLM_ONLY" ? "LLM_ONLY" : (d.active.model_version ?? "LLM_ONLY") });
        return ds.items;
      }),
    [],
  );

  useEffect(() => {
    let stopped = false;
    load().then(
      (ds) => {
        if (stopped || !ds[0]) return;
        listEvaluations(ds[0].dataset_id).then((r) => !stopped && setEvals(r.items), () => {});
      },
      (e) => !stopped && (setData({ serving: null, history: [], models: [], datasets: [] }), fail(e)),
    );
    return () => {
      stopped = true;
    };
  }, [load, fail]);

  // 학습 진행 (API-58). 끝날 때까지 다시 묻는다
  useEffect(() => {
    if (!runId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () =>
      getTrainingRun(runId).then(
        (r) => {
          if (stopped) return;
          setRun(r);
          if (DONE.includes(r.status)) {
            void load();
            return;
          }
          timer = setTimeout(tick, RUN_POLL_MS);
        },
        () => {
          if (stopped) return;
          writeRun(null);
          setRunId(null);
        },
      );
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [runId, load]);

  if (!data) return <p className="py-16 text-center text-sm text-muted">불러오는 중…</p>;
  const { serving, history, models, datasets } = data;
  const activeId = history.find((h) => h.status === "ACTIVE")?.deployment_id ?? null;
  const pending = history.some((h) => h.status === "PENDING");
  const running = !!run && !DONE.includes(run.status);
  const chosen = datasetId || datasets[0]?.dataset_id || "";

  // 서빙 전환 · 롤백 · LLM_ONLY (API-62)
  async function doDeploy() {
    if (!confirm || !reason.trim()) return;
    setBusy(true);
    try {
      const r = await deploy(confirm.kind === "CUSTOM" ? { mode: "CUSTOM", modelVersionId: confirm.model.model_version_id } : { mode: "LLM_ONLY" }, activeId, reason.trim());
      setConfirm(null);
      setReason("");
      showToast(r.status === "FAILED" ? "학습서버가 모델을 올리지 못해 기존 서빙을 그대로 유지해요" : "전환을 요청했어요. 학습서버에서 적용을 확인하면 서빙 중으로 바뀌어요", r.status === "FAILED" ? "coral" : "mint");
      await load();
    } catch (e) {
      fail(e);
      if (e instanceof Error && "code" in e && (e as { code: string }).code === "VERSION_CONFLICT") void load();
    } finally {
      setBusy(false);
    }
  }

  // 재학습 요청 (API-57)
  async function train() {
    if (!chosen) return;
    setBusy(true);
    try {
      const n = Number(epochs);
      const r = await startTraining(chosen, epochs && Number.isInteger(n) ? { epochs: n } : undefined);
      writeRun(r.resource_id);
      setRun(null);
      setRunId(r.resource_id);
      showToast("학습을 요청했어요. 진행 상황을 여기서 볼 수 있어요", "mint");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  // 학습 중단 (API-59)
  async function stop() {
    if (!runId) return;
    setBusy(true);
    try {
      await stopTraining(runId);
      setStopOpen(false);
      showToast("중단을 요청했어요");
      setRun((r) => (r ? { ...r, status: "CANCELLED" } : r));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const evalOf = (m: ModelVersion) => evals.filter((e) => e.model_version_id === m.model_version_id);

  return (
    <>
      {toast.node}
      <AdminTitle desc="판정 모델을 학습 · 비교하고, 서비스에 쓸 모델을 바꿔요">모델</AdminTitle>

      <Panel className="mt-6" title="서빙 설정" desc="질문 판정에 지금 쓰는 모델이에요. 판정이 800ms를 넘기거나 실패하면 그 질문만 LLM 단독으로 판정해요">
        {serving ? (
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[26px] font-extrabold tracking-[-0.04em]">{serving.mode === "LLM_ONLY" ? "LLM_ONLY" : serving.model_version}</p>
              <p className="mt-1 text-sm text-muted">
                {serving.mode === "LLM_ONLY"
                  ? `판정 모델 없이 ${serving.llm_model_id ?? "LLM"}이 판정 · 기준 ${serving.llm_only_threshold ?? "–"}점`
                  : `임계값 ${fmt(serving.threshold)} · 대체 판정 ${serving.llm_model_id ?? "LLM"}`}
                {" · "}적용 {when(serving.deployed_at)}
              </p>
              {serving.stale && <p className="mt-1 text-xs font-semibold text-coral-ink">학습서버에 연결할 수 없어 마지막으로 확인한 값을 보여주고 있어요</p>}
              {pending && <p className="mt-1 text-xs font-semibold text-ink/70">전환을 적용하는 중이에요. 잠시 뒤 새로고침해 주세요</p>}
            </div>
            {serving.mode !== "LLM_ONLY" && (
              <Button variant="soft" icon="undo" disabled={pending} onClick={() => setConfirm({ kind: "LLM_ONLY" })}>
                LLM_ONLY로 되돌리기
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted">서빙 상태를 알 수 없어요. 학습서버 연결을 확인해 주세요.</p>
        )}
      </Panel>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.4fr]">
        <Panel title="재학습" desc="데이터셋 버전으로 새 모델을 학습해요. 진행 중인 강연이 있으면 시작할 수 없어요">
          {running || (run && runId) ? (
            <div>
              <div className="flex items-center gap-2">
                <Pill className={run?.status === "FAILED" || run?.status === "HELD" ? "bg-coral/20" : run?.status === "SUCCEEDED" ? "bg-mint/25" : "bg-honey/40"}>{run ? runText[run.status] : "확인 중"}</Pill>
                {run?.stage && <span className="text-xs text-muted">{run.stage}</span>}
              </div>
              <Progress value={(run?.progress ?? 0) * 100} className="mt-3 !h-2.5" />
              {run?.learning_curve.length ? (
                <div className="mt-3 rounded-2xl bg-paper p-3 text-xs">
                  {run.learning_curve.map((p) => (
                    <p key={p.epoch} className="tabular-nums">
                      epoch {p.epoch} · 학습 손실 {fmt(p.train_loss)} · 검증 손실 {fmt(p.valid_loss)}
                      {p.valid_auc != null && ` · AUC ${fmt(p.valid_auc)}`}
                    </p>
                  ))}
                </div>
              ) : null}
              {run?.model_version && (
                <p className="mt-3 text-sm">
                  새 버전 <b>{run.model_version}</b> · {run.deployable ? "배포 기준 통과" : "배포 기준 미달"}
                </p>
              )}
              {run?.hold_reason && <p className="mt-2 text-sm text-coral-ink">보류 사유: {run.hold_reason}</p>}
              {run?.error_code && <p className="mt-2 text-sm text-coral-ink">오류: {run.error_code}</p>}
              <div className="mt-4 flex gap-2">
                {running ? (
                  <Button variant="danger" size="sm" icon="stop" onClick={() => setStopOpen(true)}>
                    학습 중단
                  </Button>
                ) : (
                  <Button
                    variant="soft"
                    size="sm"
                    onClick={() => {
                      writeRun(null);
                      setRunId(null);
                      setRun(null);
                    }}
                  >
                    닫기
                  </Button>
                )}
              </div>
            </div>
          ) : datasets.length === 0 ? (
            <p className="text-sm text-muted">학습할 데이터셋이 없어요. 데이터 · 라벨에서 확인해 주세요.</p>
          ) : (
            <div className="space-y-3">
              <Field label="데이터셋">
                <select className={inputCls} value={chosen} onChange={(e) => setDatasetId(e.target.value)}>
                  {datasets.map((d) => (
                    <option key={d.dataset_id} value={d.dataset_id}>
                      {d.version_name} · {d.status}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="epoch (선택, 1~10)" hint="비우면 학습서버 기본값을 써요">
                <input className={inputCls} inputMode="numeric" value={epochs} onChange={(e) => setEpochs(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} />
              </Field>
              <Button className="w-full" icon="play" disabled={busy || (!!epochs && (Number(epochs) < 1 || Number(epochs) > 10))} onClick={train}>
                학습 시작
              </Button>
            </div>
          )}
        </Panel>

        <Panel title="모델 버전" desc="학습서버에 등록된 판정 모델이에요">
          {models.length === 0 ? (
            <Empty emoji="🧠" title="등록된 모델이 없어요" desc="학습이 끝나 배포 기준을 통과하면 여기에 보여요." />
          ) : (
            <div className="space-y-2">
              {models.map((m) => {
                const ev = evalOf(m);
                return (
                  <div key={m.model_version_id} className="rounded-[18px] bg-paper p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-lg font-bold">{m.version_name}</p>
                      {m.serving && (
                        <Pill className="bg-mint/30">
                          <Dot className="bg-mint" /> 서빙 중
                        </Pill>
                      )}
                      {!m.deployable && !m.served_before && <Pill className="bg-coral/20">배포 기준 미달</Pill>}
                      <span className="ml-auto text-xs text-muted">임계값 {fmt(m.threshold)}</span>
                    </div>
                    {numeric(m.metrics).length > 0 && <p className="mt-1.5 text-xs text-ink/70">{metricText(m.metrics)}</p>}
                    {ev.length > 0 && (
                      <div className="mt-2 space-y-0.5 text-xs text-muted">
                        {ev.map((e) => (
                          <p key={e.evaluation_id}>
                            평가 · {e.split === "TEST" ? "시험셋" : "검증셋"} {e.scope}: {metricText(e.metrics) || "–"}
                          </p>
                        ))}
                      </div>
                    )}
                    {m.memo && <p className="mt-1 text-xs text-muted">{m.memo}</p>}
                    {!m.serving && (m.deployable || m.served_before) && (
                      <div className="mt-3 flex justify-end">
                        <Button size="sm" variant="soft" icon={m.served_before ? "undo" : "check"} disabled={pending} onClick={() => setConfirm({ kind: "CUSTOM", model: m })}>
                          {m.served_before ? "이 버전으로 롤백" : "이 버전으로 전환"}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      <Panel className="mt-3" title="전환 이력">
        {history.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">아직 전환한 적이 없어요</p>
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="pb-2 font-medium">요청</th>
                  <th className="pb-2 font-medium">대상</th>
                  <th className="pb-2 font-medium">상태</th>
                  <th className="pb-2 font-medium">사유</th>
                  <th className="pb-2 font-medium">요청한 관리자</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.deployment_id} className="border-b border-line last:border-0">
                    <td className="py-2.5 text-ink/70">{when(h.created_at)}</td>
                    <td className="py-2.5 font-semibold">
                      {h.requested_mode === "LLM_ONLY" ? "LLM_ONLY" : h.requested_model_version} <span className="font-normal text-muted">· {h.route === "SWITCH" ? "전환" : "롤백"}</span>
                    </td>
                    <td className="py-2.5">
                      {deployText[h.status]}
                      {h.error_code && <span className="text-xs text-coral-ink"> · {h.error_code}</span>}
                    </td>
                    <td className="py-2.5 text-ink/70">{h.reason}</td>
                    <td className="py-2.5 text-ink/70">{h.requested_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.kind === "LLM_ONLY" ? "LLM_ONLY로 되돌릴까요?" : `${confirm?.model.version_name}(으)로 ${confirm?.model.served_before ? "롤백" : "전환"}할까요?`}>
        <p className="flex items-start gap-1.5 text-sm leading-relaxed text-muted">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          다음 질문부터 바로 적용돼요. 진행 중인 강연이 있으면 그 강연의 판정도 바뀌어요.
        </p>
        <div className="mt-4">
          <Field label="사유 (감사 기록에 남아요)">
            <textarea className={`${inputCls} h-20 resize-none`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="예: 평가 결과 오답 즉답률 개선" />
          </Field>
        </div>
        <div className="mt-6 flex gap-2">
          <Button variant="soft" className="flex-1" onClick={() => setConfirm(null)}>
            취소
          </Button>
          <Button className="flex-1" disabled={!reason.trim() || busy} onClick={doDeploy}>
            {busy ? "요청하는 중…" : "적용하기"}
          </Button>
        </div>
      </Modal>

      <Modal open={stopOpen} onClose={() => setStopOpen(false)} title="학습을 중단할까요?">
        <p className="text-sm leading-relaxed text-muted">지금까지 학습한 내용은 모델로 등록되지 않아요.</p>
        <div className="mt-6 flex gap-2">
          <Button variant="soft" className="flex-1" onClick={() => setStopOpen(false)}>
            계속 학습
          </Button>
          <Button variant="danger" className="flex-1" disabled={busy} onClick={stop}>
            중단하기
          </Button>
        </div>
      </Modal>
    </>
  );
}
