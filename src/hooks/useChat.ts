// Quip V0.1 — chat hook (per-companion).
//
// Each companion has its own chat session. When you switch companions,
// the other's messages are preserved. When you "clear", the old session
// is archived so you can view past chats.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, CompanionId } from "@/types";
import {
  loadCurrentMessages,
  saveCurrentMessages,
  archiveSession,
  clearCurrentMessages,
} from "@/lib/storage";

const uid = () =>
  Math.random().toString(36).slice(2) + Date.now().toString(36);

export function useChat(companionId: CompanionId) {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    loadCurrentMessages(companionId)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeId = useRef<string | null>(null);

  // Persist for THIS companion.
  useEffect(() => {
    saveCurrentMessages(companionId, messages);
  }, [messages, companionId]);

  // Load messages when companion changes.
  useEffect(() => {
    const loaded = loadCurrentMessages(companionId);
    setMessages(loaded);
    setError(null);
    setBusy(false);
    activeId.current = null;
  }, [companionId]);

  // Subscribe to streamed events.
  useEffect(() => {
    const offChunk = window.quip.onChatChunk((delta) => {
      const id = activeId.current;
      if (!id) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, content: m.content + delta } : m
        )
      );
    });
    const offDone = window.quip.onChatDone(() => {
      const id = activeId.current;
      if (id) {
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, streaming: false } : m))
        );
      }
      activeId.current = null;
      setBusy(false);
    });
    const offErr = window.quip.onChatError((err) => {
      const id = activeId.current;
      if (id) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id
              ? { ...m, streaming: false, error: true, content: err.message }
              : m
          )
        );
      }
      activeId.current = null;
      setError(err.message);
      setBusy(false);
    });
    return () => {
      offChunk();
      offDone();
      offErr();
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
      const assistantMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: "",
        ts: Date.now(),
        streaming: true,
        companionId,
      };

      const history = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      activeId.current = assistantMsg.id;
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setBusy(true);

      await window.quip.chatSend({
        requestId: assistantMsg.id,
        history,
      });
    },
    [busy, messages, companionId]
  );

  const clear = useCallback(() => {
    archiveSession(companionId, messages);
    clearCurrentMessages(companionId);
    setMessages([]);
    setError(null);
  }, [companionId, messages]);

  return { messages, busy, error, send, clear };
}
