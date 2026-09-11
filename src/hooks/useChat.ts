// Quip V2 — unified chat + task hook.
//
// Single input, auto-detects if the user wants to chat or execute an action.
// If the task brain says intent != "chat", we execute the task locally (fast).
// Otherwise, we stream to the LLM as normal.
// Trust-layer notes are attached to assistant messages so the user always
// sees WHY Quip did what it did.

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChatMessage,
  ChatSession,
  CompanionId,
  TaskProgress,
  TaskResultPayload,
} from "@/types";
import {
  loadCurrentMessages,
  saveCurrentMessages,
  archiveSession,
  clearCurrentMessages,
  loadSessions,
} from "@/lib/storage";
import type { ApprovalRequestUI } from "@/types/api";

const uid = () => crypto.randomUUID();

export function useChat(
  companionId: CompanionId,
  initialMessages?: ChatMessage[],
  quipApi = window.quip
) {
  const [messages, setMessages] = useState<ChatMessage[]>(
    () => initialMessages ?? loadCurrentMessages(companionId)
  );
  const [sessions, setSessions] = useState<ChatSession[]>(() =>
    loadSessions().filter((s) => s.companionId === companionId)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<string | null>(null);
  /** Drives the companion's success/error/cancelled animation — timestamped
   *  so the UI can flash it briefly and fall back to idle. */
  const [taskOutcome, setTaskOutcome] = useState<{
    success: boolean;
    at: number;
    cancelled?: boolean;
  } | null>(null);
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequestUI | null>(null);
  const [taskProgress, setTaskProgress] = useState<TaskProgress | null>(null);
  const activeRequestId = useRef<string | null>(null);
  const quipApiRef = useRef(quipApi);
  quipApiRef.current = quipApi;
  const messagesRef = useRef<ChatMessage[]>(messages);
  /** Current spoken audio element — new reply replaces the old voice. */
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
    saveCurrentMessages(companionId, messages.filter(m => !m.proactive));
  }, [messages, companionId]);

  useEffect(() => {
    const loaded = loadCurrentMessages(companionId);
    setMessages(loaded);
    setSessions(loadSessions().filter((s) => s.companionId === companionId));
    setError(null);
    setErrorKind(null);
    setBusy(false);
    setApprovalRequest(null);
    setTaskProgress(null);
    activeRequestId.current = null;
    try {
      quipApiRef.current.setCompanion(companionId);
    } catch (err) {
      console.error("Failed to set companion:", err);
    }
  }, [companionId]);

  useEffect(() => {
    const offChunk = quipApiRef.current.onChatChunk((delta, requestId) => {
      if (requestId !== activeRequestId.current) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === requestId ? { ...m, content: m.content + delta } : m
        )
      );
    });

    const offDone = quipApiRef.current.onChatDone((_full, requestId, meta) => {
      if (requestId !== activeRequestId.current) return;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== requestId) return m;
          // Failover notice: the primary brain failed, another one answered.
          const note =
            meta?.switched && meta.provider
              ? `${m.contextNote ? `${m.contextNote}\n` : ""}Auto-switched to ${meta.provider} — your primary provider didn't answer.`
              : m.contextNote;
          return { ...m, streaming: false, ...(note ? { contextNote: note } : {}) };
        })
      );
      activeRequestId.current = null;
      setBusy(false);
    });

    const offErr = quipApiRef.current.onChatError((err) => {
      if (err.requestId !== activeRequestId.current) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === err.requestId
            ? { ...m, streaming: false, error: true, content: err.message }
            : m
        )
      );
      activeRequestId.current = null;
      setError(err.message);
      setErrorKind(err.kind ?? null);
      setBusy(false);
    });

    const offConfirm = quipApiRef.current.onApprovalRequest((req: ApprovalRequestUI) => {
      setApprovalRequest(req);
    });

    // Live step progress for multi-step tasks — the trust layer the user sees.
    const offProgress = quipApiRef.current.onTaskProgress((p: TaskProgress) => {
      setTaskProgress(p);
    });

    // ─── Proactive check-ins (ONE authoritative source: the main process) ──
    // The main-process reminder engine owns scheduling/cooldowns/quiet-hours
    // and the Settings toggle. The renderer only displays what arrives —
    // no UI timers, no duplicated schedulers.
    const offProactive = quipApiRef.current.onProactiveSuggestion((s) => {
      if (!s || typeof s.message !== "string" || !s.message.trim()) return;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && last.proactive && last.content === s.message) {
          return prev; // de-dupe double deliveries
        }
        return [
          ...prev,
          {
            id: uid(),
            role: "assistant" as const,
            content: s.message,
            ts: Date.now(),
            companionId,
            proactive: true,
          },
        ];
      });
    });

    // ─── The companion's VOICE — play wav audio sent by the main process ──
    // (Groq playai-tts engine; the local Windows engine speaks in main and
    // needs no renderer audio.)
    const offTts = quipApiRef.current.onTtsAudio((data) => {
      try {
        if (audioRef.current && !audioRef.current.paused) audioRef.current.pause();
        const el = new Audio(`data:${data.mime || "audio/wav"};base64,${data.audioBase64}`);
        audioRef.current = el;
        el.play().catch(() => {
          /* autoplay blocked until first interaction — harmless, text is shown */
        });
      } catch {
        /* speech is best-effort */
      }
    });

    return () => {
      offChunk();
      offDone();
      offErr();
      offConfirm();
      offProgress();
      offProactive();
      offTts();
    };
  }, [companionId]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setError(null);
      setErrorKind(null);
      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        content: trimmed,
        ts: Date.now(),
        companionId,
      };

      setMessages((prev) => [...prev, userMsg]);
      setBusy(true);

      const taskId = uid();
      let taskResult: TaskResultPayload | null = null;
      try {
        taskResult = await quipApiRef.current.executeTask({
          requestId: taskId,
          command: trimmed,
        });
      } catch (err: any) {
        console.error("Task execution failed, falling back to chat:", err);
        setError(err.message || "Task execution failed.");
        setBusy(false);
        return;
      }

      if (taskResult && taskResult.summary && !taskResult.plan?.isChat) {
        // Honest failure reporting: plain-language reasons for what went wrong.
        const failureLines = (taskResult.failures ?? []).filter(Boolean);
        const trustNote = [...failureLines, ...taskResult.notes].filter(Boolean).join("\n");
        const cancelled = taskResult.cancelled === true;
        const assistantMsg: ChatMessage = {
          id: uid(),
          role: "assistant",
          content: taskResult.success
            ? taskResult.summary
            : taskResult.summary,
          ts: Date.now(),
          companionId,
          contextNote: trustNote || undefined,
          action: {
            success: taskResult.success,
            summary: taskResult.summary,
            notes: taskResult.notes,
          },
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setTaskProgress(null);
        setTaskOutcome({ success: taskResult.success, at: Date.now(), cancelled });
        setBusy(false);
        return;
      }

      const assistantMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: "",
        ts: Date.now(),
        streaming: true,
        companionId,
      };

      activeRequestId.current = assistantMsg.id;
      // History from the ref — the ref is committed after the user message
      // render, so it ALWAYS reflects reality. (Reading a state updater's
      // capture here sent the model stale or empty history, which is why
      // follow-ups used to lose context.)
      const history = messagesRef.current
        .filter((m) => !m.proactive && !m.streaming && m.content.trim().length > 0)
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      setMessages((prev) => [...prev, assistantMsg]);

      try {
        await quipApiRef.current.chatSend({
          requestId: assistantMsg.id,
          history,
        });
      } catch (err: any) {
        console.error("Failed to send chat:", err);
        setError(err.message || "Failed to send chat.");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, streaming: false, error: true, content: err.message || "Failed to send chat." }
              : m
          )
        );
        activeRequestId.current = null;
        setTaskProgress(null);
        setBusy(false);
      }
    },
    [busy, companionId]
  );

  const clear = useCallback(() => {
    const toArchive = messages.filter(m => !m.proactive);
    archiveSession(companionId, toArchive);
    clearCurrentMessages(companionId);
    setMessages([]);
    setSessions(loadSessions().filter((s) => s.companionId === companionId));
    setError(null);
    setErrorKind(null);
  }, [companionId, messages]);

  const newChat = useCallback(() => {
    const toArchive = messages.filter(m => !m.proactive);
    if (toArchive.length > 0) {
      archiveSession(companionId, toArchive);
      setSessions(loadSessions().filter((s) => s.companionId === companionId));
    }
    clearCurrentMessages(companionId);
    setMessages([]);
    setError(null);
    setErrorKind(null);
    activeRequestId.current = null;
    setBusy(false);
  }, [companionId, messages]);

  const openSession = useCallback(
    (session: ChatSession) => {
      if (session.companionId !== companionId) return;
      clearCurrentMessages(companionId);
      saveCurrentMessages(companionId, session.messages);
      setMessages(session.messages);
      setError(null);
      setErrorKind(null);
      setBusy(false);
      activeRequestId.current = null;
    },
    [companionId]
  );

  const addNotice = useCallback(
    (content: string, contextNote?: string) => {
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          content,
          ts: Date.now(),
          companionId,
          contextNote,
        },
      ]);
    },
    [companionId]
  );

  const clearError = useCallback(() => {
    setError(null);
    setErrorKind(null);
  }, []);

  /** Stop button — asks the main process to cancel the running task before
   *  its next step. The orchestrator returns an honest "stopped" result. */
  const cancelTask = useCallback(() => {
    try {
      quipApiRef.current.cancelTask();
    } catch {
      /* non-fatal — the task will finish on its own */
    }
  }, []);

  const resolveApproval = useCallback((id: string, approved: boolean) => {
    quipApiRef.current.resolveApproval(id, approved);
    setApprovalRequest(null);
  }, []);

  return { messages, busy, error, errorKind, taskOutcome, send, clear, addNotice, sessions, newChat, openSession, clearError, approvalRequest, resolveApproval, taskProgress, cancelTask };
}
