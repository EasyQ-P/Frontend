"use client";

// 운영 지표 (실제 API). API-64 운영 지표(일별 · 강연별) · 예산 사용률, API-65 월 예산 설정.
// 데모 모드는 app/admin/(console)/page.tsx의 목업 화면을 쓴다
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminTitle, Dot, Panel, Stat } from "@/components/admin";
import { Icon } from "@/components/Icon";
import { Button, Progress, Tabs, inputCls, useToast } from "@/components/ui";
import { getMetrics, listAdminSessions, setBudget, type Budget, type MetricGroup } from "@/lib/api/admin";
import { latencyTarget, type Period } from "@/lib/admin";
import { adminErrorMessage, adminLoggedOut } from "@/lib/adminApi";
import { setAdmin } from "@/lib/store";

const won = (n: number) => `${Math.round(n).toLocaleString()}원`;
// 표본이 없으면 0이 아니라 "–"
const sec = (ms: number | null | undefined) => (ms == null ? "–" : `${(ms / 1000).toFixed(1)}s`);
const pct = (r: number | null | undefined) => (r == null ? "–" : `${Math.round(r * 100)}%`);
const maxOf = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? Math.max(...v) : null;
};

// 기간 시작 · 끝 (기기 시간대 자정 기준). to는 포함하지 않는다
function rangeOf(period: Period) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(today);
  to.setDate(to.getDate() + 1);
  const from = period === "today" ? today : period === "week" ? new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6) : new Date(today.getFullYear(), today.getMonth(), 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

// 여러 묶음(일 · 강연)을 기간 합계로. 지연 시간은 묶음별 백분위라 합칠 수 없어 가장 나쁜 값을 보여준다
function total(groups: MetricGroup[]) {
  const sum = (f: (g: MetricGroup) => number) => groups.reduce((n, g) => n + f(g), 0);
  const questions = sum((g) => g.question_count);
  const ai = sum((g) => g.ai_answer_count);
  const escalated = sum((g) => g.escalated_count);
  const cost: Record<string, number> = {};
  for (const g of groups) for (const [c, v] of Object.entries(g.estimated_cost_by_currency)) cost[c] = (cost[c] ?? 0) + v;
  return {
    questions,
    ai,
    escalated,
    aiShare: questions ? ai / questions : null,
    escalation: questions ? escalated / questions : null,
    progressMax: maxOf(groups.map((g) => g.progress_max_ms)),
    progressP95: maxOf(groups.map((g) => g.progress_p95_ms)),
    firstP50: maxOf(groups.map((g) => g.first_token_p50_ms)),
    finalP50: maxOf(groups.map((g) => g.final_p50_ms)),
    finalP95: maxOf(groups.map((g) => g.final_p95_ms)),
    sttP95: maxOf(groups.map((g) => g.stt_ingest_p95_ms)),
    fallback: sum((g) => g.fallback_count),
    retracted: sum((g) => g.retracted_count),
    ratings: sum((g) => g.feedback_counts.audience.HELPFUL + g.feedback_counts.audience.UNHELPFUL),
    failedJobs: sum((g) => g.failed_jobs),
    calls: sum((g) => g.external_calls),
    cost,
  };
}

const costText = (cost: Record<string, number>) => {
  const parts = Object.entries(cost).map(([c, v]) => (c === "KRW" ? won(v) : `${c} ${v.toFixed(2)}`));
  return parts.length ? parts.join(" · ") : "0원";
};

type Loaded = { days: MetricGroup[]; sessions: (MetricGroup & { title: string })[]; budget: Budget | null; asOf: string };

export function RemoteAdminDashboard() {
  const router = useRouter();
  const toast = useToast();
  const showToast = toast.show;
  const [period, setPeriod] = useState<Period>("week");
  const [data, setData] = useState<Loaded | null>(null);
  const [budgetDraft, setBudgetDraft] = useState("");
  const [rateDraft, setRateDraft] = useState("1400");
  const [hardCap, setHardCap] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let stopped = false;
    const { from, to } = rangeOf(period);
    Promise.all([getMetrics(from, to, "day"), getMetrics(from, to, "session"), listAdminSessions()]).then(
      ([days, sessions, list]) => {
        if (stopped) return;
        const titles = new Map(list.items.map((s) => [s.session_id, s.title]));
        setData({
          days: days.groups,
          sessions: sessions.groups.filter((g) => g.session_id).map((g) => ({ ...g, title: titles.get(g.session_id!) ?? "(삭제된 강연)" })),
          budget: days.budget,
          asOf: days.data_as_of,
        });
        if (days.budget) {
          setBudgetDraft((d) => d || String(days.budget!.monthly_budget_krw));
          setHardCap(days.budget.hard_cap_enabled);
        }
      },
      (e) => {
        if (stopped) return;
        if (adminLoggedOut(e)) return (setAdmin(null), router.replace("/admin/login"));
        showToast(adminErrorMessage(e), "coral");
      },
    );
    return () => {
      stopped = true;
    };
  }, [period, router, showToast]);

  const m = total(data?.days ?? []);
  const budget = data?.budget ?? null;
  const used = budget ? budget.month_to_date_krw + budget.reserved_krw : 0;
  const ratio = budget?.usage_ratio ?? 0;
  const draftValue = Number(budgetDraft);
  const rateValue = Number(rateDraft);
  const draftValid = Number.isInteger(draftValue) && draftValue >= 1000 && draftValue <= 10_000_000 && rateValue > 0;
  const changed = !budget || draftValue !== budget.monthly_budget_krw || hardCap !== budget.hard_cap_enabled;
  const maxQ = Math.max(1, ...(data?.days ?? []).map((d) => d.question_count));

  // 월 예산 설정 (API-65)
  async function saveBudget(e: React.FormEvent) {
    e.preventDefault();
    if (!draftValid) return;
    setSaving(true);
    try {
      await setBudget({ monthly_budget_krw: draftValue, usd_krw_rate: rateValue, hard_cap_enabled: hardCap, reason: "운영 지표 화면에서 월 예산 변경" });
      const { from, to } = rangeOf(period);
      const r = await getMetrics(from, to, "day");
      setData((d) => (d ? { ...d, budget: r.budget } : d));
      toast.show(`월 예산을 ${won(draftValue)}으로 저장했어요`, "mint");
    } catch (err) {
      toast.show(adminErrorMessage(err), "coral");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {toast.node}
      <AdminTitle
        desc="처리 로그를 일 · 강연 단위로 모았어요"
        action={
          <Tabs
            value={period}
            onChange={setPeriod}
            tabs={[
              { value: "today", label: "오늘" },
              { value: "week", label: "최근 7일" },
              { value: "month", label: "이번 달" },
            ]}
          />
        }
      >
        운영 지표
      </AdminTitle>

      {budget?.warning && (
        <div className="mt-6 flex animate-pop items-center gap-3 rounded-[24px] bg-ink p-4 text-white">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-coral text-ink">
            <Icon name="alert" size={19} />
          </span>
          <div className="min-w-0 flex-1 text-sm">
            <p className="text-base font-bold">
              이번 달 API 비용이 한도의 {Math.round(ratio * 100)}%에 도달했어요{budget.cap_reached ? " · 처리가 멈췄어요" : ""}
            </p>
            <p className="text-white/55">
              {won(used)} / {won(budget.monthly_budget_krw)} · 80%를 넘으면 경고를 보여줘요
            </p>
          </div>
        </div>
      )}

      {!data ? (
        <p className="py-16 text-center text-sm text-muted">불러오는 중…</p>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="질문 수" value={m.questions.toLocaleString()} sub={`강연 ${data.sessions.length}회`} />
            <Stat label="AI 답변 비중" value={pct(m.aiShare)} sub="목표 50% 이상" tone="#3dbf6e" />
            <Stat label="이관 비율" value={pct(m.escalation)} sub={`${m.escalated.toLocaleString()}건 강연자에게 전달`} tone="#f4625a" />
            <Stat label="외부 호출 · 추정 비용" value={costText(m.cost)} sub={`호출 ${m.calls.toLocaleString()}회`} tone="#ffc830" />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="진행 상태 표시 최댓값 · p95"
              value={`${sec(m.progressMax)} · ${sec(m.progressP95)}`}
              sub={`질문 제출 → 첫 진행 상태 · 목표 최댓값 ${latencyTarget.progressMax}초 이하`}
              warn={(m.progressMax ?? 0) > latencyTarget.progressMax * 1000}
            />
            <Stat label="첫 글자 p50" value={sec(m.firstP50)} sub={`AI 답변 첫 글자까지 · 목표 ${latencyTarget.firstP50}초 이하`} warn={(m.firstP50 ?? 0) > latencyTarget.firstP50 * 1000} />
            <Stat
              label="최종 확정 p50 · p95"
              value={`${sec(m.finalP50)} · ${sec(m.finalP95)}`}
              sub={`목표 p50 ≤ ${latencyTarget.finalP50}초 · p95 ≤ ${latencyTarget.finalP95}초`}
              warn={(m.finalP50 ?? 0) > latencyTarget.finalP50 * 1000 || (m.finalP95 ?? 0) > latencyTarget.finalP95 * 1000}
            />
            <Stat label="발화 반영 지연 p95" value={sec(m.sttP95)} sub={`목표 ${latencyTarget.speechLag}초 이내`} warn={(m.sttP95 ?? 0) > latencyTarget.speechLag * 1000} />
          </div>
          {period !== "today" && <p className="mt-2 text-xs text-muted">지연 시간은 날짜별 값 중 가장 나쁜 값이에요.</p>}

          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label="대체 판정 수" value={m.fallback.toLocaleString()} sub="판정 모델 대신 LLM 단독으로 판정" />
            <Stat label="철회 · 청중 평가 수" value={`${m.retracted} · ${m.ratings}`} sub="강연자 철회 · 도움됨 / 부족해요" />
            <Stat label="실패 작업" value={m.failedJobs} sub="교안 처리 · 요약 노트 · 임베딩" warn={m.failedJobs > 0} />
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
            <Panel title="일별 질문 처리" desc="막대 위쪽이 AI가 답한 질문">
              {data.days.length === 0 ? (
                <p className="py-14 text-center text-sm text-muted">이 기간에 들어온 질문이 없어요</p>
              ) : (
                <div className="flex h-48 items-end gap-2 md:gap-3">
                  {data.days.map((d) => (
                    <div key={d.date} className="flex h-full flex-1 flex-col items-center gap-1">
                      <div className="flex w-full flex-1 flex-col items-center justify-end">
                        <span className="mb-1 text-xs font-bold">{d.question_count || "–"}</span>
                        <div className="flex w-full flex-col overflow-hidden rounded-t-xl" style={{ height: `${(d.question_count / maxQ) * 80}%` }}>
                          <div className="bg-mint" style={{ height: `${d.question_count ? (d.ai_answer_count / d.question_count) * 100 : 0}%` }} />
                          <div className="flex-1 bg-coral" />
                        </div>
                      </div>
                      <span className="text-[10px] text-muted">{d.date?.slice(5).replace("-", ".")}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 flex gap-4 text-xs text-muted">
                <span className="flex items-center gap-1.5">
                  <Dot className="bg-mint" /> AI 답변
                </span>
                <span className="flex items-center gap-1.5">
                  <Dot className="bg-coral" /> 강연자 이관
                </span>
              </div>
            </Panel>

            <Panel title="이번 달 비용 한도" desc="임베딩 · 판정 · 답변 · 요약 노트 호출 합계 (서울 기준 월)">
              {budget ? (
                <>
                  <p className="text-[30px] font-extrabold leading-none tracking-[-0.04em]">
                    {won(used)}
                    <span className="text-base font-semibold text-muted"> / {won(budget.monthly_budget_krw)}</span>
                  </p>
                  <Progress value={ratio * 100} className="mt-4 !h-3" color={budget.warning ? "bg-coral" : "bg-ink"} />
                  <p className="mt-2 text-xs text-muted">
                    확정 {won(budget.month_to_date_krw)} · 진행 중 예약 {won(budget.reserved_krw)} · {budget.hard_cap_enabled ? "한도에 닿으면 AI 처리를 멈춰요" : "한도를 넘어도 처리해요"}
                  </p>
                </>
              ) : (
                <p className="rounded-2xl bg-honey/30 p-3 text-sm">아직 월 예산을 정하지 않았어요. 아래에서 정하면 사용률과 경고를 보여드려요.</p>
              )}
              <form onSubmit={saveBudget} className="mt-5 space-y-2 border-t border-line pt-4">
                <label htmlFor="budget" className="text-xs font-semibold text-muted">
                  월 예산 설정
                </label>
                <div className="relative">
                  <input id="budget" inputMode="numeric" className={`${inputCls} pr-9`} value={budgetDraft} onChange={(e) => setBudgetDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 8))} placeholder="예: 50000" />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted">원</span>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex flex-1 items-center gap-2 text-sm">
                    <span className="shrink-0 text-muted">환율 1달러 =</span>
                    <input inputMode="decimal" className={`${inputCls} !py-2`} value={rateDraft} onChange={(e) => setRateDraft(e.target.value.replace(/[^0-9.]/g, "").slice(0, 7))} />
                    <span className="shrink-0 text-muted">원</span>
                  </label>
                </div>
                <button type="button" role="switch" aria-checked={hardCap} onClick={() => setHardCap((v) => !v)} className="flex w-full items-center gap-3 rounded-2xl bg-paper p-3 text-left text-sm">
                  <span className="flex-1">한도에 닿으면 AI 처리 멈추기</span>
                  <span className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${hardCap ? "bg-ink" : "bg-ink/15"}`}>
                    <span className={`h-5 w-5 rounded-full bg-white transition-transform ${hardCap ? "translate-x-5" : ""}`} />
                  </span>
                </button>
                <Button type="submit" variant="soft" className="w-full" disabled={!draftValid || !changed || saving}>
                  {saving ? "저장하는 중…" : "저장"}
                </Button>
                {budgetDraft && !draftValid && <p className="text-xs text-coral-ink">1,000원 ~ 1,000만 원 사이로 입력해 주세요.</p>}
              </form>
            </Panel>
          </div>

          <Panel title="강연별 지표" desc="표본이 없으면 – 로 표시해요" className="mt-3">
            {data.sessions.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">이 기간에 질문이 들어온 강연이 없어요</p>
            ) : (
              <div className="-mx-5 overflow-x-auto px-5">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr className="border-b border-line">
                      <th className="pb-2 font-medium">강연</th>
                      <th className="pb-2 text-right font-medium">질문</th>
                      <th className="pb-2 pl-4 font-medium">AI 답변 비중</th>
                      <th className="pb-2 text-right font-medium">진행 상태 p95</th>
                      <th className="pb-2 text-right font-medium">첫 글자 p50</th>
                      <th className="pb-2 text-right font-medium">최종 확정 p50</th>
                      <th className="pb-2 text-right font-medium">비용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sessions.map((s) => {
                      const share = Math.round((s.ai_answer_share ?? 0) * 100);
                      return (
                        <tr key={s.session_id} className="border-b border-line last:border-0">
                          <td className="py-3 pr-3 font-semibold">{s.title}</td>
                          <td className="py-3 text-right">{s.question_count}</td>
                          <td className="w-40 py-3 pl-4">
                            <div className="flex items-center gap-2">
                              <Progress value={share} className="flex-1" color={share < 50 ? "bg-coral" : "bg-mint"} />
                              <span className={`w-9 text-right text-xs font-semibold ${share < 50 ? "text-coral-ink" : ""}`}>{share}%</span>
                            </div>
                          </td>
                          <td className="py-3 text-right">{sec(s.progress_p95_ms)}</td>
                          <td className="py-3 text-right">{sec(s.first_token_p50_ms)}</td>
                          <td className={`py-3 text-right ${(s.final_p50_ms ?? 0) > latencyTarget.finalP50 * 1000 ? "font-semibold text-coral-ink" : ""}`}>{sec(s.final_p50_ms)}</td>
                          <td className="py-3 text-right">{costText(s.estimated_cost_by_currency)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <p className="mt-3 text-right text-xs text-muted">집계 시각 {new Date(data.asOf).toLocaleString("ko-KR")}</p>
        </>
      )}
    </>
  );
}
