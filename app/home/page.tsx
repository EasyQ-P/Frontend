"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar, Sticker } from "@/components/Brand";
import { Icon } from "@/components/Icon";
import { RoundButton, Screen } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { listDocuments, listHostedLectures, listJoinedLectures, type Session, type SessionDocument } from "@/lib/api/lectures";
import { DEMO } from "@/lib/demo";
import { buildToday, dateKey, type Today, type TodayLecture } from "@/lib/homeToday";
import { isBudgetHeld, sessionToLecture } from "@/lib/lectures";
import { archive, lectures, statusOf, tones, type Tone } from "@/lib/mock";
import { useDemo } from "@/lib/store";
import { useToday } from "@/lib/useToday";

const linkCls = "text-white underline decoration-white/25 underline-offset-[6px] hover:decoration-white";

// 화면에 필요한 값만 모은 모양. 데모(목업)와 실제 API가 같은 화면을 쓴다
type RecentItem = { id: string; href: string | null; speaker: string; title: string; detail: React.ReactNode; emoji: string };
type OpenLecture = { id: string; title: string; date: string; time: string; status: "ready" | "live"; tone: Tone };
type HomeData = {
  lectures: TodayLecture[];
  readyNotes: number;
  archiveCount: number;
  recent: RecentItem[];
  open: OpenLecture[];
  myLectureCount: number;
  avatars: string[];
};

export default function HomePage() {
  return DEMO ? <DemoHome /> : <RemoteHome />;
}

// ── 데모: 목업 강연 · 보관함 ──
function DemoHome() {
  const { name, deletedArchives, deletedLectures, endedLectures, startedLectures } = useDemo();
  // 내가 연 강연 (다른 사람이 연 강연은 host가 있다)
  const myLectures = lectures.filter((l) => !l.host && !deletedLectures.includes(l.id)).map((l) => ({ ...l, status: statusOf(l, endedLectures, startedLectures) }));
  // 보관함 화면과 같은 목록에서 센다. 홈에는 최근 3개만 보여준다
  const myArchive = archive.filter((a) => !deletedArchives.includes(a.id));
  const data: HomeData = {
    lectures: myLectures,
    readyNotes: myArchive.filter((a) => a.summary === "ready").length,
    archiveCount: myArchive.length,
    recent: myArchive.slice(0, 3).map((a) => {
      const q = a.myQuestions[0];
      return {
        id: a.id,
        href: `/archive/${a.id}`,
        speaker: a.speaker,
        title: a.title.split("·")[1]?.trim() ?? a.title,
        detail: q && (
          <>
            에서 <span className="text-ink">‘{q.text}’</span> 질문을 남겼어요
          </>
        ),
        emoji: a.emoji,
      };
    }),
    open: myLectures.filter((l): l is typeof l & { status: "ready" | "live" } => l.status !== "ended"),
    myLectureCount: myLectures.length,
    avatars: ["김", "박", "이"],
  };
  return <HomeView name={name} data={data} />;
}

// ── 실제 API: 내 강연(API-14 hosted) · 보관함(API-14 joined) · 교안 상태(API-22) ──
function docsState(docs: SessionDocument[]): NonNullable<TodayLecture["file"]>["state"] | null {
  if (docs.length === 0) return null;
  if (docs.some((d) => d.status === "FAILED")) return "failed";
  if (docs.every((d) => d.status === "READY")) return "done";
  if (docs.some(isBudgetHeld)) return "pending";
  return "processing";
}

function RemoteHome() {
  const router = useRouter();
  const { name } = useDemo();
  const [data, setData] = useState<HomeData | null>(null);

  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        const [hosted, joined] = await Promise.all([listHostedLectures(), listJoinedLectures()]);
        const open = hosted.items.filter((s) => s.status === "DRAFT" || s.status === "LIVE");
        // 아직 끝나지 않은 강연만 교안 상태를 본다 ("교안을 올리고" 문장용)
        const docs = await Promise.all(open.map((s) => listDocuments(s.session_id).then((d) => d.items, () => [] as SessionDocument[])));
        const fileOf = new Map(open.map((s, i) => [s.session_id, docsState(docs[i])]));
        const toToday = (s: Session): TodayLecture => {
          const l = sessionToLecture(s);
          const state = fileOf.get(s.session_id);
          return { ...l, file: state ? { state } : null };
        };
        if (stopped) return;
        setData({
          lectures: hosted.items.map(toToday),
          // 요약 노트 API(API-37)가 아직 없어 0으로 둔다
          readyNotes: 0,
          archiveCount: joined.total_count,
          recent: joined.items.slice(0, 3).map((s) => {
            const l = sessionToLecture(s);
            return {
              id: s.session_id,
              // 보관함 상세(API-12 · 37)는 아직 연결 전
              href: null,
              speaker: s.host_display_name,
              title: s.title,
              detail: s.my_question_count > 0 ? <>에서 질문 {s.my_question_count}개를 남겼어요</> : <>에 참여했어요</>,
              emoji: l.emoji,
            };
          }),
          open: open.map((s) => {
            const l = sessionToLecture(s);
            return { id: l.id, title: l.title, date: l.date, time: l.time, status: l.status === "live" ? "live" : "ready", tone: l.tone };
          }),
          myLectureCount: hosted.total_count,
          avatars: [...new Set(joined.items.map((s) => s.host_display_name.slice(0, 1)))].slice(0, 3),
        });
      } catch (e) {
        if (stopped) return;
        if (e instanceof ApiError && e.code === "AUTH_REQUIRED") return router.replace(`/login?next=${encodeURIComponent("/home")}`);
        // 불러오지 못하면 빈 홈을 보여준다 (문장 · 목록은 빈 상태 안내)
        setData({ lectures: [], readyNotes: 0, archiveCount: 0, recent: [], open: [], myLectureCount: 0, avatars: [] });
      }
    })();
    return () => {
      stopped = true;
    };
  }, [router]);

  return <HomeView name={name} data={data} />;
}

// ── 화면 ──
function HomeView({ name, data }: { name: string; data: HomeData | null }) {
  const today = useToday();
  const plan =
    data &&
    buildToday({
      lectures: data.lectures,
      readyNotes: data.readyNotes,
      archiveCount: data.archiveCount,
      today: today && dateKey(new Date(today.year, today.month - 1, today.day)),
    });

  return (
    <Screen nav dark width="wide">
      <div className="flex flex-1 flex-col lg:grid lg:grid-cols-[1fr_1.05fr] lg:items-start lg:gap-10 lg:px-6 lg:py-10">
        {/* 시안의 Today 화면 */}
        <section className="px-6 pb-10 pt-9 md:px-8 lg:sticky lg:top-0 lg:px-2 lg:pt-4">
          <div className="flex items-start justify-between">
            <h1 className="text-[44px] font-extrabold leading-none tracking-[-0.05em] md:text-[56px]">오늘</h1>
            <p className="pt-1 text-right text-[15px] leading-tight">
              <span className="mr-1.5 inline-block h-1.5 w-1.5 -translate-y-0.5 rounded-full bg-coral" />
              {/* 날짜를 읽기 전에는 자리만 잡아 둔다 */}
              {today ? `${today.month}월 ${today.day}일` : " "}
              <br />
              <span className="text-white/45">{today?.weekday ?? " "}</span>
            </p>
          </div>

          <p className="mt-12 text-[25px] font-semibold leading-[1.45] md:text-[30px] tracking-[-0.035em] text-white/40">
            {plan ? <TodaySentence name={name} plan={plan} /> : <>{name}님, 오늘 할 일을 살펴보고 있어요…</>}
          </p>

          {plan && plan.kind !== "welcome" && data.avatars.length > 0 && (
            <div className="mt-6 flex items-center gap-2 text-xs text-white/45">
              내 강연 · 보관함 기준
              <span className="flex -space-x-2">
                {data.avatars.map((n) => (
                  <Avatar key={n} name={n} size={22} className="!ring-ink" />
                ))}
              </span>
            </div>
          )}
        </section>

        {/* 아래 흰 시트 */}
        <section className="flex-1 rounded-t-[34px] bg-paper px-5 pb-6 pt-6 text-ink md:px-8 md:pt-8 lg:flex-none lg:rounded-[34px] lg:px-7 lg:pb-7">
          <Link href="/join" className="flex items-center gap-4 rounded-[24px] bg-coral p-5 transition-transform hover:-translate-y-0.5">
            <div className="flex-1">
              <p className="text-[21px] font-extrabold leading-tight tracking-[-0.04em]">QR 찍고 질문하러 가기</p>
              <p className="mt-1 text-sm text-ink/60">입장 코드 5자리로도 들어갈 수 있어요</p>
            </div>
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ink text-white">
              <Icon name="qr" />
            </span>
          </Link>

          <div className="mb-1 mt-7 flex items-center justify-between">
            <h2 className="text-[17px] font-bold">보관함에서:</h2>
            <Link href="/archive" className="flex items-center gap-1.5 text-sm">
              전체 {data?.archiveCount ?? 0}개 강연 <Icon name="right" size={15} />
            </Link>
          </div>
          {data && data.recent.length === 0 && (
            <p className="rounded-[22px] bg-white p-4 text-sm leading-relaxed text-muted">
              아직 참여한 강연이 없어요. QR로 강연에 들어가면 질문과 요약 노트가 여기 모여요.
            </p>
          )}
          <ul className="divide-y divide-line">
            {data?.recent.map((a) => {
              const body = (
                <>
                  <Avatar name={a.speaker} size={46} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-bold">{a.speaker} 강연:</p>
                    <p className="line-clamp-2 text-sm leading-snug text-muted">
                      … {a.title}
                      {a.detail && <> {a.detail}</>}
                    </p>
                  </div>
                  <Sticker size={34} rotate={8}>
                    {a.emoji}
                  </Sticker>
                </>
              );
              return (
                <li key={a.id}>
                  {a.href ? (
                    <Link href={a.href} className="flex items-center gap-3 py-4">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 py-4">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="mb-3 mt-6 flex items-center justify-between">
            <h2 className="text-[17px] font-bold">내 강연:</h2>
            <RoundButton href="/lectures/new" icon="plus" label="새 강연" />
          </div>
          <div className="space-y-2">
            {data && data.open.length === 0 && (
              <Link href="/lectures/new" className="block rounded-[22px] bg-white p-4 text-sm leading-relaxed text-muted">
                {data.myLectureCount === 0 ? "아직 만든 강연이 없어요." : "진행 중이거나 예정된 강연이 없어요."}{" "}
                <span className="font-semibold text-ink underline underline-offset-4">새 강연 만들기</span>
              </Link>
            )}
            {data?.open.map((l) => (
              <Link
                key={l.id}
                href={l.status === "live" ? `/lectures/${l.id}/live` : `/lectures/${l.id}`}
                className="flex items-center gap-3 rounded-[22px] p-4"
                style={{ backgroundColor: tones[l.tone].hex }}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{l.title}</p>
                  <p className="text-xs text-ink/60">
                    {l.date} {l.time}
                  </p>
                </div>
                <span className="rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-white">{l.status === "live" ? "대시보드" : "준비하기"}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </Screen>
  );
}

// "오늘" 문장. 할 일 조각을 쉼표로 잇고, 마지막 조각만 "~할 차례예요"로 끝낸다
const rotations = [-8, 8, -6];

function TodaySentence({ name, plan }: { name: string; plan: Today }) {
  if (plan.kind === "welcome")
    return (
      <>
        {name}님, 반가워요!{" "}
        <Sticker size={28} rotate={-8}>
          👋
        </Sticker>{" "}
        강연을 듣고 있다면{" "}
        <Link href="/join" className={linkCls}>
          QR을 찍어 질문
        </Link>
        하고, 강연을 한다면{" "}
        <Link href="/lectures/new" className={linkCls}>
          첫 강연을 만들어
        </Link>{" "}
        보세요.
      </>
    );

  if (plan.kind === "clear")
    return (
      <>
        {name}님, 오늘은 확인할 일이 없어요.{" "}
        <Sticker size={28} rotate={8}>
          ☕
        </Sticker>{" "}
        새 질문이 생기면{" "}
        <Link href="/join" className={linkCls}>
          QR로 들어가
        </Link>{" "}
        보세요.
      </>
    );

  const last = plan.clauses.length - 1;
  return (
    <>
      {name}님, 오늘은{" "}
      {plan.clauses.map((c, i) => {
        const sticker = (
          <Sticker size={28} rotate={rotations[i % rotations.length]}>
            {c.emoji}
          </Sticker>
        );
        const link = (
          <Link href={c.href} className={linkCls}>
            {c.label}
          </Link>
        );
        const verb = i === last ? `${c.lastVerb} 차례예요.` : `${c.verb}, `;
        return (
          <span key={c.key}>
            {c.stickerFirst ? (
              <>
                {sticker} {link}
                {c.josa} {verb}
              </>
            ) : (
              <>
                {link} {sticker} {c.josa} {verb}
              </>
            )}
          </span>
        );
      })}
    </>
  );
}
