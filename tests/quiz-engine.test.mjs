// Tests: quiz engine (pure helpers)
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildQuizPrompt,
  normalizeQuizQuestions,
  isAnswerCorrect,
} from "../dist-test/src/quiz/quiz-engine.js";

test("buildQuizPrompt caps the source and requests JSON only", () => {
  const long = "x".repeat(50000);
  const prompt = buildQuizPrompt(long, 5);
  assert.ok(prompt.includes("Return JSON only"));
  assert.ok(prompt.length < 10000, "prompt should be token-capped");
});

test("buildQuizPrompt clamps question count between 1 and 10", () => {
  assert.ok(buildQuizPrompt("source", 0).includes("Question count: 1"));
  assert.ok(buildQuizPrompt("source", 25).includes("Question count: 10"));
  assert.ok(buildQuizPrompt("source", 5).includes("Question count: 5"));
});

test("normalizeQuizQuestions keeps valid questions and drops malformed ones", () => {
  const raw = {
    questions: [
      { prompt: "What is 2+2?", choices: ["3", "4"], expectedAnswer: "4", explanation: "Basic math.", difficulty: "easy" },
      { prompt: "no explanation" }, // missing explanation → dropped
      null, // dropped
      { prompt: "What is the capital of France?", expectedAnswer: "Paris", explanation: "Geography.", difficulty: "hard" },
    ],
  };
  const questions = normalizeQuizQuestions(raw);
  assert.equal(questions.length, 2);
  assert.equal(questions[0].id, "q-1");
  assert.equal(questions[1].difficulty, "hard");
  assert.deepEqual(questions[1].choices, undefined);
});

test("normalizeQuizQuestions accepts a bare array and handles garbage", () => {
  assert.equal(normalizeQuizQuestions([{ prompt: "p", explanation: "e" }]).length, 1);
  assert.equal(normalizeQuizQuestions("garbage").length, 0);
  assert.equal(normalizeQuizQuestions(null).length, 0);
  assert.equal(normalizeQuizQuestions({ questions: "nope" }).length, 0);
});

test("answer checking is tolerant of casing and phrasing", () => {
  assert.equal(isAnswerCorrect("Paris", "Paris"), true);
  assert.equal(isAnswerCorrect("  paris ", "Paris"), true);
  assert.equal(isAnswerCorrect("the city of paris", "Paris"), true);
  assert.equal(isAnswerCorrect("London", "Paris"), false);
  assert.equal(isAnswerCorrect("", "Paris"), false);
  // no expected answer → anything accepted
  assert.equal(isAnswerCorrect("anything", undefined), true);
});
