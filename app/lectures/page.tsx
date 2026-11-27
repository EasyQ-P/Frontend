"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bubble, Sticker } from "@/components/Brand";
import { Icon } from "@/components/Icon";
import { Empty, PageTitle, RoundButton, Screen, StatusPill, Tabs } from "@/components/ui";
import { EndReasonPill } from "@/components/lecture";
import { ApiError } from "@/lib/api/client";
import { listHostedLectures } from "@/lib/api/lectures";
import { DEMO } from "@/lib/demo";
import { lectureErrorMessage, sessionToLecture } from "@/lib/lectures";
import { lectures, logStats, questionLogs, statusOf, type Lecture, type LectureStatus } from "@/lib/mock";
import { useDemo } from "@/lib/store";

// 데모는 목업 강연, 실제 API는 내가 연 강연(API-14 scope=hosted)
export default function LecturesPage() {
  return DEMO ? <Lectures /> : <RemoteLectures />;
}

type Loaded = { kind: "loading" } | { kind: "ok"; list: Lecture[]; total: number } | { kind: "error"; message: string };

function RemoteLectures() {
  const router = useRouter();
  const [tab, setTab] = useState<LectureStatus>("ready");
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });

  useEffect(() => {
    let stopped = false;
    listHostedLectures().then(
      (page) => !stopped && setLoaded({ kind: "ok", list: page.items.map(sessionToLecture), total: page.total_count }),
      (e) => {
        if (stopped) return;
        if (e instanceof ApiError && e.code === "AUTH_REQUIRED") return router.replace(`/login?next=${encodeURIComponent("/lectures")}`);
        setLoaded({ kind: "error", message: lectureErrorMessage(e) });
      },
    );
    return () => {
      stopped = true;
    };
  }, [router]);

  const all = loaded.kind === "ok" ? loaded.list : [];
  const list = all.filter((l) => l.status === tab);

  return (
    <Screen nav>
      <PageTitle meta={loaded.kind === "ok" ? `${loaded.total}개 강연` : ""} action={<RoundButton href="/lectures/new" icon="plus" label="새 강연" />}>
        내 강연
      </PageTitle>
      <div className="px-5">
        <Tabs
          className="mt-6"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "live", label: "진행 중", count: all.filter((l) => l.status === "live").length },
            { value: "ready", label: "예정", count: all.filter((l) => l.status === "ready").length },
            { value: "ended", label: "지난 강연", count: all.filter((l) => l.status === "ended").length },
          ]}
        />
        {loaded.kind === "loading" && <p className="py-16 text-center text-sm text-muted">불러오는 중…</p>}
        {loaded.kind === "error" && <Empty emoji="⚠️" title="강연 목록을 불러오지 못했어요" desc={loaded.message} />}
        {loaded.kind === "ok" &&
          (list.length === 0 ? (
            <Empty title={all.length === 0 ? "아직 만든 강연이 없어요" : "해당하는 강연이 없어요"} desc={all.length === 0 ? "오른쪽 위 + 로 첫 강연을 만들어 보세요." : undefined} />
          ) : (
            <div className="mt-5">
              {list.map((l, i) => {
                // 지난 강연 리포트(API-39 등)는 아직 연결 전이라 링크 없이 보여준다
                const href = l.status === "live" ? `/lectures/${l.id}/live` : l.status === "ready" ? `/lectures/${l.id}` : null;
                const card = (
                  <Bubble tone={l.tone} tail={i % 2 ? "right" : "left"} className={`mb-[22px] ${i ? "-mt-1" : ""}`} style={{ zIndex: list.length - i }}>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <StatusPill status={l.status} onColor />
                        <p className="mt-2.5 text-[21px] font-extrabold leading-tight tracking-[-0.04em]">{l.title}</p>
                        <p className="mt-1 text-sm text-ink/60">
                          {l.date} {l.time}
                        </p>
                      </div>
                      <Sticker size={42} rotate={i % 2 ? -10 : 10}>
                        {l.emoji}
                      </Sticker>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-sm">
                      <span className="text-ink/65">{l.status === "live" ? `청중 ${l.audience}명 참여 중` : l.status === "ready" ? `입장 코드 ${l.code}` : `청중 ${l.audience}명`}</span>
                      <span className={`flex items-center gap-1 rounded-full px-3.5 py-2 text-xs font-semibold ${href ? "bg-ink text-white" : "bg-white/60 text-ink/60"}`}>
                        {l.status === "live" ? "대시보드" : l.status === "ready" ? "준비하기" : "리포트 준비 중"}
                        {href && <Icon name="right" size={14} />}
                      </span>
                    </div>
                  </Bubble>
                );
                return href ? (
                  <Link key={l.id} href={href} className="block animate-rise transition-transform hover:-translate-y-0.5">
                    {card}
                  </Link>
                ) : (
                  <div key={l.id} className="animate-rise">
                    {card}
                  </div>
                );
              })}
            </div>
          ))}
      </div>
    </Screen>
  );
}

function Lectures() {
  const { created, deletedLectures, endedLectures, startedLectures, endReasons } = useDemo();
  const [tab, setTab] = useState<LectureStatus>("live");

  const all = [
    ...(created ? [{ ...lectures[1], id: created.id, title: created.title, date: created.date, time: created.time, status: "ready" as const, tone: "berry" as const, emoji: "✨", file: null }] : []),
    ...lectures,
  ]
    .filter((l) => !deletedLectures.includes(l.id))
    .map((l) => ({ ...l, status: statusOf(l, endedLectures, startedLectures) }));
  const list = all.filter((l) => l.status === tab);

  return (
    <Screen nav>
      <PageTitle meta={`${all.length}개 강연`} action={<RoundButton href="/lectures/new" icon="plus" label="새 강연" />}>
        내 강연
      </PageTitle>

      <div className="px-5">
        <Tabs
          className="mt-6"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "live", label: "진행 중", count: all.filter((l) => l.status === "live").length },
            { value: "ready", label: "예정", count: all.filter((l) => l.status === "ready").length },
            { value: "ended", label: "지난 강연", count: all.filter((l) => l.status === "ended").length },
          ]}
        />

        {list.length === 0 ? (
          <Empty title="해당하는 강연이 없어요" />
        ) : (
          <div className="mt-5">
            {list.map((l, i) => {
              const href = l.status === "live" ? `/lectures/${l.id}/live` : l.status === "ended" ? `/lectures/${l.id}/report` : `/lectures/${l.id}`;
              return (
                <Link key={l.id} href={href} className="block animate-rise transition-transform hover:-translate-y-0.5">
                  <Bubble tone={l.tone} tail={i % 2 ? "right" : "left"} className={`mb-[22px] ${i ? "-mt-1" : ""}`} style={{ zIndex: list.length - i }}>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <StatusPill status={l.status} onColor />
                          {l.status === "ended" && <EndReasonPill reason={endReasons[l.id] ?? l.endReason ?? "manual"} />}
                        </span>
                        <p className="mt-2.5 text-[21px] font-extrabold leading-tight tracking-[-0.04em]">{l.title}</p>
                        <p className="mt-1 text-sm text-ink/60">
                          {l.date} {l.time}
                        </p>
                      </div>
                      <Sticker size={42} rotate={i % 2 ? -10 : 10}>
                        {l.emoji}
                      </Sticker>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-sm">
                      <span className="text-ink/65">
                        {l.status === "ended" && `질문 ${logStats(questionLogs[l.id] ?? []).questions} · 청중 ${l.audience}`}
                        {l.status === "live" && `청중 ${l.audience}명 참여 중`}
                        {l.status === "ready" && (l.file?.state === "done" ? "교안 준비 완료" : l.file ? "교안 처리 확인 필요" : "교안 업로드 전")}
                      </span>
                      <span className="flex items-center gap-1 rounded-full bg-ink px-3.5 py-2 text-xs font-semibold text-white">
                        {l.status === "live" ? "대시보드" : l.status === "ended" ? "리포트" : "준비하기"}
                        <Icon name="right" size={14} />
                      </span>
                    </div>
                  </Bubble>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </Screen>
  );
}
