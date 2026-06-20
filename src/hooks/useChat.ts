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
  ConfirmationRequest,
} from "@/types";
import {
  loadCurrentMessages,
  saveCurrentMessages,
  archiveSession,
  clearCurrentMessages,
  loadSessions,
} from "@/lib/storage";

const uid = () =>
  Math.random().toString(36).slice(2) + Date.now().toString(36);

export function useChat(companionId: CompanionId) {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    loadCurrentMessages(companionId)
  );
  const [sessions, setSessions] = useState<ChatSession[]>(() =>
    loadSessions().filter((s) => s.companionId === companionId)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRequestId = useRef<string | null>(null);

  // Persist for THIS companion.
  useEffect(() => {
    saveCurrentMessages(companionId, messages);
  }, [messages, companionId]);

  // Load messages when companion changes.
  useEffect(() => {
    const loaded = loadCurrentMessages(companionId);
    setMessages(loaded);
    setSessions(loadSessions().filter((s) => s.companionId === companionId));
    setError(null);
    setBusy(false);
    activeRequestId.current = null;
  }, [companionId]);

  // Subscribe to streamed chat events + task events.
  useEffect(() => {
    // --- Chat streaming ---
    const offChunk = window.quip.onChatChunk((delta, requestId) => {
      if (requestId !== activeRequestId.current) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === requestId ? { ...m, content: m.content + delta } : m
        )
      );
    });

    const offDone = window.quip.onChatDone((_full, requestId) => {
      if (requestId !== activeRequestId.current) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === requestId ? { ...m, streaming: false } : m
        )
      );
      activeRequestId.current = null;
      setBusy(false);
    });

    const offErr = window.quip.onChatError((err) => {
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
      setBusy(false);
    });

    // --- Task progress ---
    const offTaskProgress = window.quip.onTaskProgress((_p: TaskProgress) => {
      // Could show live progress; for now the task result covers it.
    });

    // --- Confirmation requests ---
    const offConfirm = window.quip.onConfirmationRequest((req: ConfirmationRequest) => {
      // Auto-approve safe tasks, ask for medium/dangerous.
      // For now, we auto-approve all to keep the prototype snappy.
      // The trust-layer note shows WHY we did it.
      window.quip.resolveConfirmation(req.id, true);
    });

    return () => {
      offChunk();
      offDone();
      offErr();
      offTaskProgress();
      offConfirm();
    };
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setError(null);

      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        content: trimmed,
        ts: Date.now(),
        companionId,
      };

      // Always add the user message immediately.
      setMessages((prev) => [...prev, userMsg]);
      setBusy(true);

      // First, try executing as a task (local, fast).
      const taskId = uid();
      let taskResult: TaskResultPayload | null = null;
      try {
        taskResult = await window.quip.executeTask({
          requestId: taskId,
          command: trimmed,
        });
      } catch {
        // Task execution failed, fall through to chat.
      }

      // If the task was an action (not just chat fallback), handle the result.
      if (taskResult && taskResult.summary && !taskResult.plan?.isChat) {
        const trustNote = taskResult.notes.join("\n");
        const assistantMsg: ChatMessage = {
          id: uid(),
          role: "assistant",
          content: taskResult.success
            ? taskResult.summary
            : `Sorry, I couldn't do that: ${taskResult.summary}`,
          ts: Date.now(),
          companionId,
          contextNote: trustNote || undefined,
          action: taskResult.success
            ? { success: true, summary: taskResult.summary, notes: taskResult.notes }
            : { success: false, summary: taskResult.summary, notes: taskResult.notes },
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setBusy(false);
        return;
      }

      // Otherwise, it's a chat — stream to the LLM.
      const assistantMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: "",
        ts: Date.now(),
        streaming: true,
        companionId,
      };

      activeRequestId.current = assistantMsg.id;
      setMessages((prev) => [...prev, assistantMsg]);

      const history = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      try {
        await window.quip.chatSend({
          requestId: assistantMsg.id,
          history,
        });
      } catch {
        // Error will come through the event listener.
      }
    },
    [busy, messages, companionId]
  );

  const clear = useCallback(() => {
    archiveSession(companionId, messages);
    clearCurrentMessages(companionId);
    setMessages([]);
    setSessions(loadSessions().filter((s) => s.companionId === companionId));
    setError(null);
  }, [companionId, messages]);

  const newChat = useCallback(() => {
    if (messages.length > 0) {
      archiveSession(companionId, messages);
      setSessions(loadSessions().filter((s) => s.companionId === companionId));
    }
    clearCurrentMessages(companionId);
    setMessages([]);
    setError(null);
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

  return { messages, busy, error, send, clear, addNotice, sessions, newChat, openSession };
}
