"use client";

import { useState } from "react";
import { Button, Modal, inputCls } from "./ui";
import { setDemo } from "@/lib/store";

const NOTE_MAX = 1000;

// 공개 질문에 남기는 내 필기 편집 (회원 전용). 강연 화면과 보관함 전체 질문 탭에서 같이 쓴다.
// save를 넘기면(실제 API) 그 함수로 저장한다. 빈 문자열은 필기 삭제다. 실패하면 창을 닫지 않고 오류를 보여준다
export function NoteModal({
  open,
  onClose,
  questionId,
  questionText,
  initial,
  onSaved,
  save,
}: {
  open: boolean;
  onClose: () => void;
  questionId: string;
  questionText: string;
  initial: string;
  onSaved?: (text: string) => void;
  save?: (text: string) => Promise<void>;
}) {
  return (
    <Modal open={open} onClose={onClose} title="필기 편집">
      {/* 열 때마다 저장된 필기로 다시 채운다 */}
      {open && (
        <NoteForm
          key={questionId}
          questionId={questionId}
          questionText={questionText}
          initial={initial}
          onClose={onClose}
          onSaved={onSaved}
          remoteSave={save}
        />
      )}
    </Modal>
  );
}

function NoteForm({
  questionId,
  questionText,
  initial,
  onClose,
  onSaved,
  remoteSave,
}: {
  questionId: string;
  questionText: string;
  initial: string;
  onClose: () => void;
  onSaved?: (text: string) => void;
  remoteSave?: (text: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(text: string) {
    if (remoteSave) {
      setBusy(true);
      setError("");
      try {
        await remoteSave(text);
      } catch (e) {
        setBusy(false);
        return setError(e instanceof Error && e.message ? e.message : "저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
    } else {
      // 지운 필기도 빈 문자열로 남겨, 보관함에 미리 있던 필기가 다시 보이지 않게 한다
      setDemo((s) => ({ memos: { ...s.memos, [questionId]: text } }));
    }
    onSaved?.(text);
    onClose();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(draft.trim());
      }}
    >
      <p className="rounded-2xl bg-white p-3.5 text-sm font-semibold leading-snug">
        {questionText}
      </p>
      <textarea
        className={`${inputCls} mt-3 h-32 resize-none`}
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, NOTE_MAX))}
        placeholder="나만 보는 필기 · 강연이 끝나면 보관함에 남아요"
        autoFocus
      />
      <p className="mt-1 text-right text-xs text-muted">
        {draft.length} / {NOTE_MAX}자
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-coral-ink">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        {initial && (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => save("")}>
            지우기
          </Button>
        )}
        <Button
          type="button"
          variant="soft"
          className="flex-1"
          onClick={onClose}
        >
          취소
        </Button>
        <Button
          type="submit"
          className="flex-1"
          disabled={busy || draft.trim() === initial}
        >
          저장
        </Button>
      </div>
    </form>
  );
}
