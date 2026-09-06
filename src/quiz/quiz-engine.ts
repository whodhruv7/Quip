// Quip Quiz — shared, pure quiz helpers (no Electron imports; testable).

export interface QuipQuizQuestion {
  id: string;
  prompt: string;
  choices?: string[];
  expectedAnswer?: string;
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
}

export interface QuipQuizSession {
  id: string;
  sourceTitle: string;
  sourceText: string;
  questions: QuipQuizQuestion[];
  currentIndex: number;
  score: number;
  createdAt: number;
}

/** Compact quiz-generation prompt — capped source to keep tokens low. */
export function buildQuizPrompt(sourceText: string, requestedCount = 5): string {
  return [
    "Create a concise quiz from the user's material.",
    "Return JSON only: {\"questions\":[{\"prompt\":string,\"choices\":string[]|null,\"expectedAnswer\":string,\"explanation\":string,\"difficulty\":\"easy\"|\"medium\"|\"hard\"}]}",
    `Question count: ${Math.max(1, Math.min(requestedCount, 10))}`,
    "Each question must include prompt, optional choices, expectedAnswer, explanation, and difficulty.",
    "Source:",
    sourceText.slice(0, 8000),
  ].join("\n");
}

/** Normalize raw model JSON into safe quiz questions (drops malformed items). */
export function normalizeQuizQuestions(raw: unknown): QuipQuizQuestion[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.questions)
      ? (raw as any).questions
      : [];
  if (!Array.isArray(list)) return [];
  return list.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const q = item as Record<string, unknown>;
    if (typeof q.prompt !== "string" || typeof q.explanation !== "string") return [];
    return [{
      id: typeof q.id === "string" ? q.id : `q-${index + 1}`,
      prompt: q.prompt,
      choices: Array.isArray(q.choices) ? q.choices.filter((x): x is string => typeof x === "string") : undefined,
      expectedAnswer: typeof q.expectedAnswer === "string" ? q.expectedAnswer : undefined,
      explanation: q.explanation,
      difficulty: q.difficulty === "hard" || q.difficulty === "medium" || q.difficulty === "easy" ? q.difficulty : "medium",
    }];
  });
}

/** Loose answer check — tolerant of phrasing differences. */
export function isAnswerCorrect(given: string, expected?: string): boolean {
  if (!expected) return true;
  const norm = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9 ]/g, "");
  const g = norm(given);
  const e = norm(expected);
  if (!g) return false;
  return g === e || e.includes(g) || g.includes(e);
}
