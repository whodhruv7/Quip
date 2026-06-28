import { useEffect } from "react";
import type { ChatMessage, CompanionId } from "@/types";

export const PROACTIVE_PHRASES = [
  "Hey! What are you working on right now?",
  "Just checking in! Let me know if you need any help.",
  "I'm here if you want to bounce some ideas around.",
  "How is your day going so far?",
  "Don't forget to take a quick screen break if you've been working hard!",
  "Hello! Any fun projects happening today?",
  "Just hanging out here. Need anything?",
  "Remember to stay hydrated! 💧",
];

const MIN_CHECKIN_DELAY_MS = 60000;
const MAX_CHECKIN_DELAY_MS = 180000;

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export function useProactiveCheckIn(
  messages: ChatMessage[],
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  busy: boolean,
  companionId: CompanionId
) {
  useEffect(() => {
    if (busy) return;
    
    const delay = MIN_CHECKIN_DELAY_MS + Math.random() * (MAX_CHECKIN_DELAY_MS - MIN_CHECKIN_DELAY_MS);
    
    const timer = setTimeout(() => {
      const msg = PROACTIVE_PHRASES[Math.floor(Math.random() * PROACTIVE_PHRASES.length)];
      
      setMessages((prev) => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.role === "assistant" && lastMsg.proactive) {
          return prev;
        }
        return [
          ...prev,
          {
            id: uid(),
            role: "assistant",
            content: msg,
            ts: Date.now(),
            companionId,
            proactive: true,
          }
        ];
      });
    }, delay);

    return () => clearTimeout(timer);
  }, [messages, busy, companionId, setMessages]);
}
