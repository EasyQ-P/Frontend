"use client";

// 데이터 · 라벨 (실제 API). 데이터셋 버전(API-56) · 라벨 후보 검수(API-53/54) · 승인 후보 병합(API-55).
// 데모 모드는 app/admin/(console)/data/page.tsx의 목업 화면을 쓴다
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AdminTitle, Panel } from "@/components/admin";
import { Icon } from "@/components/Icon";
import { Button, Empty, Pill, Tabs, useToast } from "@/components/ui";
import { listCandidates, listDatasets, mergeCandidates, reviewCandidate, type Candidate, type CandidateLabel, type Dataset, type ReviewStatus } from "@/lib/api/admin";
import { adminErrorMessage, adminLoggedOut } from "@/lib/adminApi";
import { setAdmin } from "@/lib/store";

const eventText: Record<Candidate["event_type"], string> = {
  AUTO_ESCALATED: "자동 이관",
  RETRACTED: "강연자 철회",
  AUDIENCE_HELPFUL: "청중 👍",
  AUDIENCE_UNHELPFUL: "청중 👎",
  SECOND_STAGE_INSUFFICIENT: "2차 근거 부족",
};
const eventTone: Record<Candidate["event_type"], string> = {
  AUTO_ESCALATED: "bg-ocean/15",
  RETRACTED: "bg-coral/20",
  AUDIENCE_HELPFUL: "bg-mint/25",
  AUDIENCE_UNHELPFUL: "bg-honey/40",
  SECOND_STAGE_INSUFFICIENT: "bg-sand",
};
const labelName: Record<CandidateLabel, string> = { ANSWERABLE: "AI 답변 가능", INSUFFICIENT_EVIDENCE: "근거 부족 (이관)", OPINION: "의견 · 운영 (이관)", REJECT: "정답 근거 없음 (제외)" };
const statusText: Record<ReviewStatus, string> = { PENDING: "검수 중", DISAGREEMENT: "불일치", APPROVED: "승인", REJECTED: "제외", MERGING: "병합 중" };
const statLabel: Record<string, string> = { TRAIN: "학습", VALIDATION: "검증", TEST: "시험" };

export function RemoteAdminData() {
  const router = useRouter();
  const toast = useToast();
  const showToast = toast.show;
  const [tab, setTab] = useState<"dataset" | "review">("dataset");
  const [datasets, setDatasets] = useState<Dataset[] | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);

  const fail = useCallback(
    (e: unknown) => {
      if (adminLoggedOut(e)) return (setAdmin(null), router.replace("/admin/login"));
      showToast(adminErrorMessage(e), "coral");
    },
    [router, showToast],
  );

  useEffect(() => {
    let stopped = false;
    Promise.all([listDatasets(), listCandidates()]).then(
      ([d, c]) => {
        if (stopped) return;
        setDatasets(d.items);
        setCandidates(c.items);
      },
      (e) => !stopped && (setDatasets([]), setCandidates([]), fail(e)),
    );
    return () => {
      stopped = true;
    };
  }, [fail]);

  const open = (candidates ?? []).filter((c) => c.review_status === "PENDING" || c.review_status === "DISAGREEMENT").length;

  return (
    <>
      {toast.node}
      <AdminTitle desc="판정 모델 학습 데이터와, 서비스에서 모인 라벨 후보를 관리해요">데이터 · 라벨</AdminTitle>
      <Tabs
        className="mt-6"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "dataset", label: "데이터셋 현황" },
          { value: "review", label: "라벨 검수", count: open },
        ]}
      />
      {tab === "dataset" ? (
        <DatasetView datasets={datasets} />
      ) : (
        <ReviewView
          candidates={candidates}
          latest={datasets?.find((d) => !["DELETED", "FAILED", "INVALID"].includes(d.status))?.version_name ?? null}
          onChange={(c) => setCandidates((l) => (l ?? []).map((x) => (x.candidate_id === c.candidate_id ? c : x)))}
          onMerged={(ids) => setCandidates((l) => (l ?? []).map((x) => (ids.includes(x.candidate_id) ? { ...x, review_status: "MERGING" } : x)))}
          toast={showToast}
          fail={fail}
        />
      )}
    </>
  );
}

function DatasetView({ datasets }: { datasets: Dataset[] | null }) {
  const [selected, setSelected] = useState<string | null>(null);
  if (!datasets) return <p className="py-16 text-center text-sm text-muted">불러오는 중…</p>;
  if (datasets.length === 0) return <Empty emoji="🗂️" title="아직 동기화된 데이터셋이 없어요" desc="학습서버와 동기화되면 여기에 보여요. 잠시 뒤 새로고침해 주세요." />;
  const ds = datasets.find((d) => d.dataset_id === selected) ?? datasets[0];
  const splits = Object.entries(ds.statistics);

  return (
    <div className="mt-4 grid animate-rise gap-3 lg:grid-cols-[300px_1fr]">
      <Panel title="버전">
        <div className="space-y-2">
          {datasets.map((d, i) => {
            const on = d.dataset_id === ds.dataset_id;
            return (
              <button key={d.dataset_id} onClick={() => setSelected(d.dataset_id)} className={`w-full rounded-[18px] p-3.5 text-left transition-colors ${on ? "bg-ink text-white" : "bg-paper hover:bg-sand"}`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold">{d.version_name}</span>
                  {i === 0 && <span className={`text-xs font-semibold ${on ? "text-white/60" : "text-muted"}`}>최신</span>}
                </div>
                <p className={`mt-0.5 text-xs ${on ? "text-white/60" : "text-muted"}`}>{d.status}</p>
              </button>
            );
          })}
        </div>
      </Panel>
      <div className="space-y-3">
        <Panel title={`${ds.version_name} 구성`} desc={ds.change_note ?? undefined}>
          {splits.length === 0 ? (
            <p className="text-sm text-muted">분할 통계가 없어요</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {splits.map(([split, v]) => (
                <div key={split} className="rounded-2xl bg-paper p-3.5">
                  <p className="text-xs text-muted">{statLabel[split] ?? split}</p>
                  {Object.entries(v).map(([k, n]) => (
                    <p key={k} className="mt-1 text-sm">
                      <b className="text-lg">{n.toLocaleString()}</b> <span className="text-muted">{k === "questions" ? "질문" : k === "pairs" ? "질문-근거 쌍" : k}</span>
                    </p>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="버전 정보">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
            {[
              ["AIHub 데이터 포함", ds.contains_aihub ? "예 (외부 공유 불가)" : "아니요"],
              ["생성 스크립트", ds.script_version ?? "–"],
              ["검색 설정", ds.retrieval_config_version ?? "–"],
              ["시험셋", `${ds.test_set_version ?? "–"} · 사용 ${ds.test_use_count ?? 0}회`],
              ["동기화", new Date(ds.synced_at).toLocaleString("ko-KR")],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
    </div>
  );
}

function ReviewView({
  candidates,
  latest,
  onChange,
  onMerged,
  toast,
  fail,
}: {
  candidates: Candidate[] | null;
  latest: string | null;
  onChange: (c: Candidate) => void;
  onMerged: (ids: string[]) => void;
  toast: (t: string, tone?: "ink" | "coral" | "mint") => void;
  fail: (e: unknown) => void;
}) {
  const [filter, setFilter] = useState<"open" | "APPROVED" | "all">("open");
  const [picked, setPicked] = useState<Record<string, { label: CandidateLabel; evidence: string | null }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  if (!candidates) return <p className="py-16 text-center text-sm text-muted">불러오는 중…</p>;
  const approved = candidates.filter((c) => c.review_status === "APPROVED");
  const shown = candidates.filter((c) => (filter === "all" ? true : filter === "APPROVED" ? c.review_status === "APPROVED" : c.review_status === "PENDING" || c.review_status === "DISAGREEMENT"));

  // 검수 저장 (API-54). 두 검수자가 같으면 승인 · 제외, 다르면 불일치가 된다
  async function save(c: Candidate) {
    const p = picked[c.candidate_id];
    if (!p) return;
    setBusy(c.candidate_id);
    try {
      onChange(await reviewCandidate(c.candidate_id, p.label, p.label === "ANSWERABLE" ? p.evidence : null));
      toast("검수를 저장했어요", "mint");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  // 승인된 후보를 최신 데이터셋에 병합 (API-55)
  async function merge() {
    if (!latest || approved.length === 0) return;
    setBusy("merge");
    const ids = approved.map((c) => c.candidate_id);
    try {
      await mergeCandidates(latest, ids, `관리자 화면 병합 ${ids.length}건`);
      onMerged(ids);
      toast(`승인 ${ids.length}건을 ${latest}에 병합하도록 요청했어요. 새 데이터셋 버전이 만들어지면 데이터셋 현황에 보여요`, "mint");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 animate-rise">
      <div className="flex flex-wrap items-center gap-3 rounded-[24px] bg-ink p-4 text-white">
        <div className="min-w-0 flex-1 text-sm">
          <p className="text-base font-bold">승인 {approved.length}건 · 전체 {candidates.length}건</p>
          <p className="text-white/55">철회 · 자동 이관 · 청중 평가가 익명 라벨 후보로 모여요. 두 명이 같은 결과로 검수하면 승인돼요.</p>
        </div>
        <Button size="sm" variant="white" icon="layers" disabled={!latest || approved.length === 0 || busy === "merge"} onClick={merge}>
          {latest ? `승인 후보를 ${latest}에 병합` : "병합할 데이터셋 없음"}
        </Button>
      </div>

      <Tabs
        className="mt-3"
        value={filter}
        onChange={setFilter}
        tabs={[
          { value: "open", label: "검수할 후보" },
          { value: "APPROVED", label: "승인", count: approved.length },
          { value: "all", label: "전체", count: candidates.length },
        ]}
      />

      {shown.length === 0 && <Empty emoji="🏷️" title="해당하는 라벨 후보가 없어요" desc="학습 활용에 동의한 청중의 철회 · 이관 · 평가가 생기면 모여요." />}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {shown.map((c) => {
          const p = picked[c.candidate_id];
          const mine = c.reviews.length > 0;
          const j = c.judgment_snapshot;
          const editable = c.review_status === "PENDING" || c.review_status === "DISAGREEMENT";
          return (
            <div key={c.candidate_id} className={`flex flex-col rounded-[24px] bg-white p-5 ${c.review_status === "DISAGREEMENT" ? "ring-2 ring-coral" : ""}`}>
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill className={eventTone[c.event_type]}>{eventText[c.event_type]}</Pill>
                <span className="text-xs text-muted">{c.session_title}</span>
                <Pill className="ml-auto bg-paper">{statusText[c.review_status]}</Pill>
              </div>
              <p className="mt-3 text-[16px] font-semibold leading-snug">{c.sanitized_pair.question_text ?? "(질문 없음)"}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-2xl bg-paper p-3">
                  <p className="text-muted">기본 라벨</p>
                  <p className="mt-0.5 font-bold">{c.default_label ? labelName[c.default_label] : "–"}</p>
                </div>
                <div className="rounded-2xl bg-paper p-3">
                  <p className="text-muted">{j.model_version ?? j.mode ?? "판정"} 점수</p>
                  <p className="mt-0.5 font-bold">
                    {typeof j.score === "number" ? j.score.toFixed(2) : "–"}
                    {typeof j.threshold === "number" && <span className="font-normal text-muted"> (임계값 {j.threshold.toFixed(2)})</span>}
                  </p>
                </div>
              </div>

              {mine && (
                <div className="mt-3 space-y-1.5 text-xs">
                  {c.reviews.map((r) => (
                    <p key={r.reviewer_ref} className="rounded-xl bg-paper p-2.5">
                      <b>{r.reviewer_ref}</b> · {labelName[r.label]}
                      {r.evidence_id && <span className="text-muted"> · 근거 {c.retrieved_evidence.find((e) => e.evidence_id === r.evidence_id)?.location_label ?? "선택됨"}</span>}
                    </p>
                  ))}
                  {c.review_status === "DISAGREEMENT" && <p className="font-semibold text-coral-ink">두 검수 결과가 달라요. 다시 골라 저장하면 바뀌어요.</p>}
                </div>
              )}

              {editable && (
                <>
                  <p className="mt-4 text-xs font-semibold text-ink/70">검색 후보 중 정답 근거를 고르거나, 이관 · 제외 사유를 골라 주세요</p>
                  <div role="radiogroup" aria-label="검수 결과" className="mt-2 space-y-1.5">
                    {c.retrieved_evidence.map((e) => {
                      const on = p?.label === "ANSWERABLE" && p.evidence === e.evidence_id;
                      return (
                        <button
                          key={e.evidence_id}
                          role="radio"
                          aria-checked={on}
                          onClick={() => setPicked((m) => ({ ...m, [c.candidate_id]: { label: "ANSWERABLE", evidence: e.evidence_id } }))}
                          className={`flex w-full items-start gap-2 rounded-xl bg-paper p-2.5 text-left text-xs ring-inset ${on ? "ring-2 ring-ink" : ""}`}
                        >
                          <Icon name="check" size={12} className={`mt-px shrink-0 ${on ? "" : "opacity-20"}`} />
                          <span className="flex-1">
                            <b>{e.location_label}</b> · {e.text.slice(0, 120)}
                          </span>
                          {typeof e.score === "number" && <span className="shrink-0 text-muted tabular-nums">{e.score.toFixed(2)}</span>}
                        </button>
                      );
                    })}
                    {(["INSUFFICIENT_EVIDENCE", "OPINION", "REJECT"] as const).map((l) => {
                      const on = p?.label === l;
                      return (
                        <button
                          key={l}
                          role="radio"
                          aria-checked={on}
                          onClick={() => setPicked((m) => ({ ...m, [c.candidate_id]: { label: l, evidence: null } }))}
                          className={`flex w-full items-center gap-2 rounded-xl bg-paper p-2.5 text-left text-xs ring-inset ${on ? "ring-2 ring-ink" : ""}`}
                        >
                          <Icon name="check" size={12} className={`shrink-0 ${on ? "" : "opacity-20"}`} />
                          {labelName[l]}
                        </button>
                      );
                    })}
                  </div>
                  {!mine && (
                    <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
                      <Icon name="lock" size={12} /> 다른 검수자의 결과는 내 검수를 저장한 뒤에 보여요
                    </p>
                  )}
                  <div className="mt-auto pt-3">
                    <Button size="sm" className="w-full" icon="check" disabled={!p || busy === c.candidate_id} onClick={() => save(c)}>
                      {mine ? "검수 다시 저장" : "검수 저장"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
