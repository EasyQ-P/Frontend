"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sticker } from "@/components/Brand";
import { Button, Field, Screen, TopBar, inputCls } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { createLecture } from "@/lib/api/lectures";
import { DEMO } from "@/lib/demo";
import { lectureErrorMessage, localDateTime, todayInput } from "@/lib/lectures";
import { setDemo } from "@/lib/store";

export default function NewLecture() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  // 데모는 목업 기준일, 실제 API는 오늘
  const [date, setDate] = useState(() => (DEMO ? "2026-10-22" : todayInput()));
  const [time, setTime] = useState("13:00");
  const [desc, setDesc] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!title.trim() || !date || !time || busy) return;
    // 실제 API: 강연 생성(API-13) 후 준비 화면으로
    if (!DEMO) {
      setBusy(true);
      setError("");
      try {
        const s = await createLecture({ title: title.trim(), description: desc.trim() || undefined, scheduledAt: localDateTime(date, time) });
        router.push(`/lectures/${s.session_id}`);
      } catch (err) {
        setBusy(false);
        if (err instanceof ApiError && err.code === "AUTH_REQUIRED") return router.push(`/login?next=${encodeURIComponent("/lectures/new")}`);
        setError(lectureErrorMessage(err));
      }
      return;
    }
    const d = new Date(date);
    const label = `${date.replaceAll("-", ".")} (${"일월화수목금토"[d.getDay()]})`;
    setDemo({ created: { id: "new-lecture", title: title.trim(), date: label, time, desc } });
    router.push("/lectures/new-lecture");
  }

  return (
    <Screen>
      <TopBar back="/lectures" />
      <form onSubmit={submit} className="flex flex-1 flex-col px-6 pb-10">
        <h1 className="pt-2 text-[38px] font-extrabold leading-[1.08] tracking-[-0.05em]">
          새 강연 <Sticker size={34} rotate={10}>🎤</Sticker>
          <br />
          <span className="text-ink/35">승인 없이 바로 만들어요</span>
        </h1>

        <div className="mt-6 space-y-4">
          <Field label="강연명" error={touched && !title.trim() ? "강연명을 입력해 주세요." : undefined}>
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 인공지능 개론 8주차 · GPT" maxLength={100} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="날짜" error={touched && !date ? "날짜를 골라 주세요." : undefined}>
              <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="시작 시각" error={touched && !time ? "시작 시각을 골라 주세요." : undefined}>
              <input type="time" className={inputCls} value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
          </div>
          <p className="-mt-2 text-xs text-muted">예정 시각이 돼도 자동으로 시작하지 않아요. 시작 전에는 언제든 고칠 수 있어요.</p>
          <Field label="설명 (선택)" hint="청중 입장 화면에 보여요 · 500자 이내">
            <textarea className={`${inputCls} resize-none`} rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} placeholder="이번 강연에서 다룰 내용" />
          </Field>
        </div>

        {error && (
          <p role="alert" className="mt-6 rounded-2xl bg-coral/15 p-3.5 text-sm text-coral-ink">
            {error}
          </p>
        )}
        <div className="mt-auto pt-8">
          <Button size="lg" className="w-full" type="submit" disabled={busy}>
            {busy ? "만드는 중…" : "만들고 교안 올리기"}
          </Button>
        </div>
      </form>
    </Screen>
  );
}
