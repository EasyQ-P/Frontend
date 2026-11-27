"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Folder } from "@/components/Brand";
import { Icon } from "@/components/Icon";
import { Button, Empty, Modal, PageTitle, RoundButton, Screen, inputCls, useToast } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { listJoinedLectures, type JoinedSession } from "@/lib/api/lectures";
import { DEMO } from "@/lib/demo";
import { lectureErrorMessage, sessionToLecture } from "@/lib/lectures";
import { archive, type ArchiveItem } from "@/lib/mock";
import { setDemo, useDemo } from "@/lib/store";

const paperStickers: Record<string, string[]> = {
  r1: ["🖼️", "🎨", "🌫️"],
  r2: ["🧩", "📊", "🧮"],
  r3: ["🚀", "💡", "🗒️"],
  r4: ["🧭", "⚛️", "📁"],
  r5: ["🗃️", "🔑", "🧮"],
};

const noteText = { ready: "요약 노트 있음", generating: "요약 노트 만드는 중", failed: "요약 노트 없음", none: "요약 노트 없음" };

// 데모는 목업 보관함, 실제 API는 내가 참여해 보관함에 둔 강연(API-14 scope=joined)
export default function ArchivePage() {
  return DEMO ? <Archive /> : <RemoteArchive />;
}

type Loaded = { kind: "loading" } | { kind: "ok"; items: JoinedSession[]; total: number } | { kind: "error"; message: string } | { kind: "guest" };

function RemoteArchive() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const toast = useToast();

  // 검색어가 바뀌면 잠깐 기다렸다가 서버에서 찾는다 (강연명 · 강연자)
  useEffect(() => {
    let stopped = false;
    const t = setTimeout(
      () =>
        listJoinedLectures(q).then(
          (page) => !stopped && setLoaded({ kind: "ok", items: page.items, total: page.total_count }),
          (e) => {
            if (stopped) return;
            if (e instanceof ApiError && e.code === "AUTH_REQUIRED") return router.replace(`/login?next=${encodeURIComponent("/archive")}`);
            // 게스트 세션(강연에 게스트로 입장한 뒤)은 보관함이 없다
            if (e instanceof ApiError && e.code === "FORBIDDEN") return setLoaded({ kind: "guest" });
            setLoaded({ kind: "error", message: lectureErrorMessage(e) });
          },
        ),
      q ? 300 : 0,
    );
    return () => {
      stopped = true;
      clearTimeout(t);
    };
  }, [q, router]);

  const items = loaded.kind === "ok" ? loaded.items : [];

  return (
    <Screen nav>
      {toast.node}
      <PageTitle meta={loaded.kind === "ok" ? `${loaded.total}개 강연` : ""} action={<RoundButton icon={searching ? "x" : "search"} label="검색" onClick={() => (setSearching((v) => !v), setQ(""))} />}>
        보관함
      </PageTitle>

      <div className="px-5">
        {searching && (
          <div className="relative mt-5 animate-rise">
            <Icon name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
            <input autoFocus className={`${inputCls} rounded-full pl-11`} placeholder="강연명, 강연자 검색" value={q} onChange={(e) => setQ(e.target.value)} maxLength={50} />
          </div>
        )}

        {loaded.kind === "loading" && <p className="py-16 text-center text-sm text-muted">불러오는 중…</p>}
        {loaded.kind === "error" && <Empty emoji="⚠️" title="보관함을 불러오지 못했어요" desc={loaded.message} />}
        {loaded.kind === "guest" && (
          <Empty emoji="🔐" title="회원으로 로그인해야 볼 수 있어요" desc="지금은 게스트로 들어와 있어요. 회원으로 로그인하면 보관함을(를) 볼 수 있어요.">
            <Button href={`/login?next=${encodeURIComponent("/archive")}`}>로그인</Button>
          </Empty>
        )}
        {loaded.kind === "ok" &&
          (items.length === 0 ? (
            <Empty title={q ? "검색 결과가 없어요" : "아직 참여한 강연이 없어요"} desc="QR을 찍고 강연에 참여하면 여기에 모여요.">
              <Button href="/join" icon="qr">
                강연 입장하기
              </Button>
            </Empty>
          ) : (
            <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-7 md:grid-cols-3 md:gap-x-6">
              {items.map((s, i) => {
                const l = sessionToLecture(s);
                return (
                  // 보관함 상세(내 질문 기록 API-12 · 요약 노트 API-37)는 아직 연결 전이라 누르면 안내만 한다
                  <button key={s.session_id} onClick={() => toast.show("강연 상세 기록은 곧 볼 수 있어요")} className="relative animate-rise text-left" style={{ animationDelay: `${i * 60}ms` }}>
                    <Folder
                      tone={l.tone}
                      title={s.title}
                      sub={
                        <>
                          <p className="truncate">
                            {s.host_display_name} · {l.date}
                          </p>
                          <p className="truncate">
                            내 질문 {s.my_question_count} · {s.status === "LIVE" ? "진행 중" : s.status === "DRAFT" ? "시작 전" : "요약 노트 준비 중"}
                          </p>
                        </>
                      }
                      stickers={[l.emoji]}
                    />
                  </button>
                );
              })}
            </div>
          ))}
      </div>
    </Screen>
  );
}

function Archive() {
  const { deletedArchives } = useDemo();
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [removing, setRemoving] = useState<ArchiveItem | null>(null);
  const toast = useToast();
  const items = archive.filter((a) => !deletedArchives.includes(a.id)).filter((a) => !q || a.title.includes(q) || a.speaker.includes(q));

  return (
    <Screen nav>
      {toast.node}
      <PageTitle meta={`${items.length}개 강연`} action={<RoundButton icon={searching ? "x" : "search"} label="검색" onClick={() => (setSearching((s) => !s), setQ(""))} />}>
        보관함
      </PageTitle>

      <div className="px-5">
        {searching && (
          <div className="relative mt-5 animate-rise">
            <Icon name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
            <input autoFocus className={`${inputCls} rounded-full pl-11`} placeholder="강연명, 강연자 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        )}

        {items.length === 0 ? (
          <Empty title={q ? "검색 결과가 없어요" : "아직 참여한 강연이 없어요"} desc="QR을 찍고 강연에 참여하면 여기에 모여요.">
            <Button href="/join" icon="qr">
              강연 입장하기
            </Button>
          </Empty>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-7 md:grid-cols-3 md:gap-x-6">
            {items.map((a, i) => (
              <div key={a.id} className="relative animate-rise" style={{ animationDelay: `${i * 60}ms` }}>
                <Link href={`/archive/${a.id}`} className="group block">
                  <Folder
                    tone={a.tone}
                    title={a.title}
                    sub={
                      <>
                        <p className="truncate">
                          {a.speaker} · {a.date}
                        </p>
                        <p className="truncate">
                          내 질문 {a.myQuestions.length} · {noteText[a.summary]}
                        </p>
                      </>
                    }
                    stickers={paperStickers[a.id] ?? [a.emoji]}
                  />
                </Link>
                <button
                  onClick={() => setRemoving(a)}
                  className="absolute bottom-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-white/60 text-ink/70 hover:bg-white"
                  aria-label={`${a.title} 강연 삭제`}
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={!!removing} onClose={() => setRemoving(null)} title="이 강연 기록을 지울까요?">
        <p className="rounded-2xl bg-white p-3.5 font-bold">{removing?.title}</p>
        <p className="mt-3 text-sm leading-relaxed text-muted">요약 노트와 내 질문 · 필기가 내 보관함에서 지워지고 되돌릴 수 없어요.</p>
        <div className="mt-6 flex gap-2">
          <Button variant="soft" className="flex-1" onClick={() => setRemoving(null)}>
            취소
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            onClick={() => {
              const id = removing?.id;
              if (id) setDemo((s) => ({ deletedArchives: [...s.deletedArchives, id] }));
              setRemoving(null);
              toast.show("강연 기록을 지웠어요");
            }}
          >
            지우기
          </Button>
        </div>
      </Modal>
    </Screen>
  );
}
