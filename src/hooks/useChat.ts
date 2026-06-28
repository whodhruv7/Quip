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
import { useProactiveCheckIn } from "./useProactiveCheckIn";

const uid = () => crypto.randomUUID();

export interface ApprovalRequestPayload {
  id: string;
  command: string;
  risk: string;
  reason?: string;
}

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
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequestPayload | null>(null);
  const activeRequestId = useRef<string | null>(null);
  const quipApiRef = useRef(quipApi);
  quipApiRef.current = quipApi;
  const messagesRef = useRef<ChatMessage[]>(messages);

  useEffect(() => {
    messagesRef.current = messages;
    saveCurrentMessages(companionId, messages.filter(m => !m.proactive));
  }, [messages, companionId]);

  useEffect(() => {
    const loaded = loadCurrentMessages(companionId);
    setMessages(loaded);
    setSessions(loadSessions().filter((s) => s.companionId === companionId));
    setError(null);
    setBusy(false);
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

    const offDone = quipApiRef.current.onChatDone((_full, requestId) => {
      if (requestId !== activeRequestId.current) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === requestId ? { ...m, streaming: false } : m
        )
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
      setBusy(false);
    });

    const offConfirm = quipApiRef.current.onApprovalRequest((req: ApprovalRequestPayload) => {
      setApprovalRequest(req);
    });

    return () => {
      offChunk();
      offDone();
      offErr();
      offConfirm();
    };
  }, [companionId]);

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

      const assistantMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: "",
        ts: Date.now(),
        streaming: true,
        companionId,
      };

      activeRequestId.current = assistantMsg.id;
      let currentMessages: ChatMessage[] = [];
      setMessages((prev) => {
        currentMessages = prev;
        return [...prev, assistantMsg];
      });

      const history = currentMessages
        .filter((m) => !m.proactive)
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

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

  const clearError = useCallback(() => setError(null), []);

  const resolveApproval = useCallback((id: string, approved: boolean) => {
    quipApiRef.current.resolveApproval(id, approved);
    setApprovalRequest(null);
  }, []);
  useProactiveCheckIn(messages, setMessages, busy, companionId);

  return { messages, busy, error, send, clear, addNotice, sessions, newChat, openSession, clearError, approvalRequest, resolveApproval };
}
