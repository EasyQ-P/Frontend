"use client";

// 진행 중 강연 대시보드 (실제 API). 질문 · 자막 API(API-26~36, STT 스트림)가 연결되기 전까지는
// 강연 정보 · 참여 인원 · 입장 QR · 강연 종료만 보여준다. 데모 모드는 app/lectures/[id]/live/page.tsx의 목업 화면을 쓴다
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bubble, Sticker } from "@/components/Brand";
import { FakeQR } from "@/components/FakeQR";
import { Icon } from "@/components/Icon";
import { QrModal } from "@/components/QrModal";
import { Button, Empty, Modal, Screen, StatusPill, TopBar, useToast } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { getLecture, updateLecture, type Session } from "@/lib/api/lectures";
import { lectureErrorMessage, sessionToLecture } from "@/lib/lectures";

// 참여 인원 · 상태를 다시 묻는 간격
const POLL_MS = 10_000;

type Loaded = { kind: "loading" } | { kind: "ok"; session: Session } | { kind: "error"; message: string };

export function RemoteLectureLive({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const showToast = toast.show;
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [qrOpen, setQrOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      getLecture(id).then(
        (s) => {
          if (stopped) return;
          if (s.status === "DRAFT") return router.replace(`/lectures/${id}`);
          if (s.status !== "LIVE") {
            showToast("강연이 끝났어요");
            return router.replace("/lectures");
          }
          if (s.my_role !== "HOST") return setLoaded({ kind: "error", message: "강연자만 대시보드를 볼 수 있어요." });
          setLoaded({ kind: "ok", session: s });
          timer = setTimeout(load, POLL_MS);
        },
        (e) => {
          if (stopped) return;
          if (e instanceof ApiError && e.code === "AUTH_REQUIRED") return router.replace(`/login?next=${encodeURIComponent(`/lectures/${id}/live`)}`);
          setLoaded({ kind: "error", message: lectureErrorMessage(e) });
        },
      );
    load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, router, showToast]);

  if (loaded.kind === "loading") return <Screen>{null}</Screen>;
  if (loaded.kind === "error")
    return (
      <Screen>
        <TopBar back="/lectures" />
        <Empty emoji="⚠️" title="강연을 불러오지 못했어요" desc={loaded.message}>
          <Button href="/lectures">내 강연으로</Button>
        </Empty>
      </Screen>
    );

  const s = loaded.session;
  const lecture = sessionToLecture(s);

  // 강연 종료 (API-16 status=ENDED)
  async function end() {
    setEnding(true);
    try {
      await updateLecture(id, s.version, { status: "ENDED" });
      router.push("/lectures");
    } catch (e) {
      setEnding(false);
      setEndOpen(false);
      showToast(lectureErrorMessage(e), "coral");
    }
  }

  return (
    <Screen>
      {toast.node}
      <TopBar back="/lectures" title="강연 진행 중" />
      <div className="flex-1 px-5 pb-10">
        <Bubble tone={lecture.tone}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <StatusPill status="live" onColor />
              <p className="mt-2.5 text-[24px] font-extrabold leading-tight tracking-[-0.04em]">{lecture.title}</p>
              <p className="mt-1 text-sm text-ink/60">
                청중 {s.participant_count}명 참여 중 · 정원 {s.capacity}명
              </p>
            </div>
            <Sticker size={44} rotate={10}>
              {lecture.emoji}
            </Sticker>
          </div>
        </Bubble>

        <section className="mt-6 flex items-center gap-4 rounded-[24px] bg-white p-4">
          <FakeQR code={s.join_code ?? ""} size={96} />
          <div className="flex-1">
            <p className="text-xs text-muted">입장 코드</p>
            <p className="text-3xl font-extrabold tracking-[0.2em]">{s.join_code}</p>
            <Button size="sm" variant="soft" icon="expand" className="mt-2" onClick={() => setQrOpen(true)}>
              강연장 화면에 크게 띄우기
            </Button>
          </div>
        </section>

        <section className="mt-4 flex flex-col items-center rounded-[24px] bg-white px-6 py-10 text-center">
          <Sticker size={56} rotate={-8}>
            🛠️
          </Sticker>
          <p className="mt-4 text-[20px] font-extrabold tracking-[-0.04em]">질문 · 자막 화면은 곧 연결돼요</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">강연은 진행 중이에요. 청중은 입장 코드로 들어올 수 있어요.</p>
        </section>

        <Button variant="danger" size="lg" icon="stop" className="mt-8 w-full" onClick={() => setEndOpen(true)}>
          강연 종료
        </Button>
      </div>

      <QrModal open={qrOpen} onClose={() => setQrOpen(false)} code={s.join_code ?? ""} title={s.title} />

      <Modal open={endOpen} onClose={() => setEndOpen(false)} title="강연을 끝낼까요?">
        <p className="flex items-start gap-1.5 text-sm leading-relaxed text-muted">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          끝내면 청중이 더 이상 질문할 수 없고 되돌릴 수 없어요.
        </p>
        <div className="mt-6 flex gap-2">
          <Button variant="soft" className="flex-1" onClick={() => setEndOpen(false)}>
            계속 진행
          </Button>
          <Button variant="danger" className="flex-1" disabled={ending} onClick={end}>
            {ending ? "끝내는 중…" : "강연 종료"}
          </Button>
        </div>
      </Modal>
    </Screen>
  );
}
