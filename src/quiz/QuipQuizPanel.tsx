// Quip Quiz — compact quiz panel. Lives INSIDE the Quip chat experience:
// glass card, purple/white/blue theme, no separate dashboard.

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  isAnswerCorrect,
  type QuipQuizQuestion,
} from "./quiz-engine";
import type { QuizQuestionPayload } from "@/types";

interface QuipQuizPanelProps {
  questions: QuizQuestionPayload[];
  companionColor: string;
  sourceTitle: string;
  onClose: () => void;
}

type Phase = "question" | "feedback" | "done";

export function QuipQuizPanel({ questions, companionColor, sourceTitle, onClose }: QuipQuizPanelProps) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("question");
  const [selected, setSelected] = useState<string>("");
  const [score, setScore] = useState(0);

  const question: QuipQuizQuestion | undefined = questions[index];
  const progress = useMemo(
    () => questions.length ? Math.round(((index + (phase === "done" ? 1 : 0)) / questions.length) * 100) : 0,
    [index, phase, questions.length]
  );

  if (!question && phase !== "done") {
    return (
      <div style={{ padding: 16, fontSize: 12, color: "#6b7280" }}>
        No quiz questions were generated. Try pasting a bit more material first.
      </div>
    );
  }

  const submit = () => {
    if (!question) return;
    if (isAnswerCorrect(selected, question.expectedAnswer)) setScore((s) => s + 1);
    setPhase("feedback");
  };

  const next = () => {
    if (index + 1 >= questions.length) {
      setPhase("done");
    } else {
      setIndex((i) => i + 1);
      setSelected("");
      setPhase("question");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.98 }}
      style={{
        position: "absolute",
        inset: 12,
        zIndex: 120,
        borderRadius: 16,
        background: "rgba(255,255,255,0.9)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        border: "1px solid rgba(123,97,255,0.18)",
        boxShadow: "0 18px 50px rgba(0,0,0,0.14)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid rgba(0,0,0,0.05)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#10131f" }}>Quip Quiz</span>
          <span style={{ fontSize: 10, color: "#6b7280" }}>
            {sourceTitle ? `From: ${sourceTitle} · ` : ""}
            Score: {score}/{questions.length}
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close quiz"
          style={{
            border: "none",
            background: "rgba(0,0,0,0.04)",
            borderRadius: 8,
            width: 26,
            height: 26,
            cursor: "pointer",
            fontSize: 12,
            color: "#6b7280",
          }}
        >
          ✕
        </button>
      </div>

      {/* Progress bar */}
      <div style={{ height: 3, background: "rgba(0,0,0,0.04)" }}>
        <div
          style={{
            height: "100%",
            width: `${progress}%`,
            background: `linear-gradient(90deg, ${companionColor}, #7B61FF)`,
            transition: "width 300ms ease",
          }}
        />
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {phase === "done" ? (
          <div style={{ textAlign: "center", padding: "24px 8px" }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>{score === questions.length ? "🏆" : "🎯"}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#10131f", marginBottom: 4 }}>
              {score}/{questions.length} correct
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5, marginBottom: 16 }}>
              {score === questions.length
                ? "Perfect — you know this material cold."
                : `Review the explanations above, then try again. Focus on the questions you missed.`}
            </div>
            <button
              onClick={() => { setIndex(0); setScore(0); setSelected(""); setPhase("question"); }}
              style={{
                border: "none",
                borderRadius: 12,
                padding: "9px 18px",
                fontSize: 12,
                fontWeight: 600,
                color: "#fff",
                background: `linear-gradient(135deg, ${companionColor}, #7B61FF)`,
                cursor: "pointer",
                marginRight: 8,
              }}
            >
              Retry quiz
            </button>
            <button
              onClick={onClose}
              style={{
                border: "1px solid rgba(0,0,0,0.08)",
                borderRadius: 12,
                padding: "9px 18px",
                fontSize: 12,
                fontWeight: 500,
                color: "#374151",
                background: "white",
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 10, color: companionColor, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
              Question {index + 1} of {questions.length} · {question!.difficulty}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#10131f", lineHeight: 1.45, marginBottom: 14 }}>
              {question!.prompt}
            </div>

            {question!.choices && question!.choices.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {question!.choices!.map((choice, ci) => {
                  const isPicked = selected === choice;
                  const isCorrect = phase !== "question" && choice === question!.expectedAnswer;
                  const isWrongPick = phase === "feedback" && isPicked && !isCorrect;
                  return (
                    <button
                      key={ci}
                      disabled={phase !== "question"}
                      onClick={() => setSelected(choice)}
                      style={{
                        textAlign: "left",
                        padding: "10px 12px",
                        borderRadius: 12,
                        fontSize: 12.5,
                        cursor: phase === "question" ? "pointer" : "default",
                        border: `1px solid ${isCorrect ? "#22c55e55" : isWrongPick ? "#ef444455" : isPicked ? companionColor + "66" : "rgba(0,0,0,0.07)"}`,
                        background: isCorrect
                          ? "rgba(34,197,94,0.08)"
                          : isWrongPick
                            ? "rgba(239,68,68,0.06)"
                            : isPicked
                              ? companionColor + "0f"
                              : "white",
                        color: "#10131f",
                      }}
                    >
                      {choice}
                    </button>
                  );
                })}
              </div>
            ) : (
              <textarea
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                disabled={phase !== "question"}
                placeholder="Type your answer…"
                rows={3}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  resize: "none",
                  borderRadius: 12,
                  border: "1px solid rgba(0,0,0,0.08)",
                  padding: "10px 12px",
                  fontSize: 12.5,
                  fontFamily: "inherit",
                  color: "#10131f",
                  background: "white",
                  outline: "none",
                }}
              />
            )}

            {phase === "feedback" && (
              <div
                style={{
                  marginTop: 12,
                  padding: "10px 12px",
                  borderRadius: 12,
                  fontSize: 12,
                  lineHeight: 1.5,
                  background: isAnswerCorrect(selected, question!.expectedAnswer)
                    ? "rgba(34,197,94,0.08)"
                    : "rgba(245,158,11,0.08)",
                  color: "#374151",
                  border: `1px solid ${isAnswerCorrect(selected, question!.expectedAnswer) ? "#22c55e33" : "#f59e0b33"}`,
                }}
              >
                <strong style={{ color: isAnswerCorrect(selected, question!.expectedAnswer) ? "#16a34a" : "#d97706" }}>
                  {isAnswerCorrect(selected, question!.expectedAnswer) ? "Correct! " : "Not quite. "}
                </strong>
                {question!.expectedAnswer && !isAnswerCorrect(selected, question!.expectedAnswer) && (
                  <span>Answer: {question!.expectedAnswer}. </span>
                )}
                {question!.explanation}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer actions */}
      {phase !== "done" && (
        <div style={{ padding: "10px 14px", borderTop: "1px solid rgba(0,0,0,0.05)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {phase === "question" ? (
            <button
              onClick={submit}
              disabled={!selected.trim()}
              style={{
                border: "none",
                borderRadius: 12,
                padding: "9px 20px",
                fontSize: 12,
                fontWeight: 600,
                color: "#fff",
                background: selected.trim()
                  ? `linear-gradient(135deg, ${companionColor}, #7B61FF)`
                  : "rgba(0,0,0,0.08)",
                cursor: selected.trim() ? "pointer" : "not-allowed",
              }}
            >
              Submit
            </button>
          ) : (
            <button
              onClick={next}
              style={{
                border: "none",
                borderRadius: 12,
                padding: "9px 20px",
                fontSize: 12,
                fontWeight: 600,
                color: "#fff",
                background: `linear-gradient(135deg, ${companionColor}, #7B61FF)`,
                cursor: "pointer",
              }}
            >
              {index + 1 >= questions.length ? "See results" : "Next question"}
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
