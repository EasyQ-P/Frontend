// 홈 화면 "오늘" 문장. 내 강연 · 보관함 상태에 맞는 할 일만 골라 한 문장으로 잇는다.
// 화면과 떨어진 순수 함수라 상황별로 시험할 수 있다. 데이터는 지금 목업이고, API-14 · API-22를 붙이면 그대로 넘기면 된다

export type TodayLecture = {
  id: string;
  title: string;
  /** 문장에 쓸 짧은 이름 (예: "트랜스포머 강연"). 없으면 제목에서 만든다 */
  short?: string;
  status: "ready" | "live" | "ended";
  /** "2026.10.22 (목)" 형식 */
  date: string;
  emoji: string;
  /** 교안 상태. null이면 아직 안 올림 */
  file: { state: "none" | "processing" | "failed" | "done" } | null;
};

export type TodayClause = {
  key: "lecture" | "document" | "notes";
  href: string;
  label: string;
  /** 목적격 조사 (을/를) */
  josa: string;
  emoji: string;
  /** 이어지는 동사 · 마지막 동사 (예: "진행하고" / "진행할") */
  verb: string;
  lastVerb: string;
  /** 링크 앞에 둘 말 (예: "다시") 은 verb에 포함한다. 스티커를 링크 앞에 둘지 */
  stickerFirst?: boolean;
};

export type Today =
  | { kind: "todo"; clauses: TodayClause[] }
  // 내 강연도 참여한 강연도 없음 (처음 가입)
  | { kind: "welcome" }
  // 할 일을 다 마침
  | { kind: "clear" };

const pad = (n: number) => String(n).padStart(2, "0");
export const dateKey = (d: Date) => `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;

// 받침 유무로 을/를. 한글이 아니면(영문 · 숫자 · 기호) 둘 다 쓴다
export function objectJosa(word: string) {
  const code = word.trim().slice(-1).charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return "을(를)";
  return code % 28 ? "을" : "를";
}

// "인공지능 개론 7주차 · 트랜스포머" → "트랜스포머 강연"
export function shortName(l: Pick<TodayLecture, "title" | "short">) {
  if (l.short) return l.short;
  const tail = l.title.split("·").pop()!.trim();
  return /강연|특강|세미나|강의$/.test(tail) ? tail : `${tail} 강연`;
}

export function buildToday(input: { lectures: TodayLecture[]; readyNotes: number; archiveCount: number; today: string | null }): Today {
  const { lectures, readyNotes, archiveCount, today } = input;
  if (lectures.length === 0 && archiveCount === 0) return { kind: "welcome" };

  const open = lectures.filter((l) => l.status !== "ended");
  const clauses: TodayClause[] = [];

  // 1. 진행 중인 강연, 없으면 오늘 예정된 강연
  const running = open.find((l) => l.status === "live") ?? (today ? open.find((l) => l.status === "ready" && l.date.startsWith(today)) : undefined);
  if (running) {
    const label = shortName(running);
    clauses.push({
      key: "lecture",
      href: running.status === "live" ? `/lectures/${running.id}/live` : `/lectures/${running.id}`,
      label,
      josa: objectJosa(label),
      emoji: running.emoji,
      verb: "진행하고",
      lastVerb: "진행할",
    });
  }

  // 2. 교안을 아직 안 올렸거나 처리에 실패한 강연
  const needsDoc = open.find((l) => !l.file || l.file.state === "none" || l.file.state === "failed");
  if (needsDoc) {
    const label = `${shortName(needsDoc).replace(/ 강연$/, "")} 교안`;
    const again = needsDoc.file?.state === "failed";
    clauses.push({
      key: "document",
      href: `/lectures/${needsDoc.id}`,
      label,
      josa: objectJosa(label),
      emoji: "📄",
      verb: again ? "다시 올리고" : "올리고",
      lastVerb: again ? "다시 올릴" : "올릴",
      stickerFirst: true,
    });
  }

  // 3. 완성된 요약 노트
  if (readyNotes > 0) {
    const label = `요약 노트 ${readyNotes}개`;
    clauses.push({ key: "notes", href: "/archive", label, josa: objectJosa(label), emoji: "📝", verb: "확인하고", lastVerb: "확인할" });
  }

  return clauses.length ? { kind: "todo", clauses } : { kind: "clear" };
}
