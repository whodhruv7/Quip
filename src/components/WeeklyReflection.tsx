import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { CompanionId } from "@/types";
import { getCompanion } from "@/lib/companion-config";

interface WeeklyReflectionProps {
  companionId: CompanionId;
  onClose: () => void;
}

export function WeeklyReflection({ companionId, onClose }: WeeklyReflectionProps) {
  const [summary, setSummary] = useState<string>("Loading your timeline data...");
  const theme = getCompanion(companionId);

  useEffect(() => {
    // In a real app, this would fetch from window.quip.getTimelineSummary()
    // For now, we simulate a delay and show a dynamic string
    const timer = setTimeout(() => {
      setSummary(`You've been incredibly productive this week! You executed 14 tasks, completed 3 major coding sessions, and chatted with ${theme.name} for over 2 hours. Is there anything you'd like to focus on next week?`);
    }, 1500);
    return () => clearTimeout(timer);
  }, [theme.name]);

  return (
    <div className="absolute inset-0 z-[200] flex flex-col bg-white/90 p-6 backdrop-blur-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight text-gray-900">Weekly Reflection</h2>
        <button
          onClick={onClose}
          className="rounded-full p-2 text-gray-500 hover:bg-gray-100"
        >
          ✕
        </button>
      </div>

      <div className="mt-8 flex flex-col items-center justify-center text-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", bounce: 0.5 }}
          className="mb-6 flex h-24 w-24 items-center justify-center rounded-full"
          style={{ background: `linear-gradient(135deg, ${theme.primary}22, ${theme.primary}55)` }}
        >
          <span className="text-4xl">📈</span>
        </motion.div>
        
        <p className="text-sm font-medium leading-relaxed text-gray-700" style={{ maxWidth: 280 }}>
          {summary}
        </p>

        <div className="mt-10 flex w-full flex-col gap-3">
          <button 
            className="w-full rounded-xl px-4 py-3 text-sm font-bold text-white transition-transform active:scale-95"
            style={{ background: theme.primary }}
            onClick={onClose}
          >
            Awesome, let's keep going!
          </button>
          <button 
            className="w-full rounded-xl bg-gray-100 px-4 py-3 text-sm font-bold text-gray-600 transition-transform hover:bg-gray-200 active:scale-95"
            onClick={onClose}
          >
            I need a break soon.
          </button>
        </div>
      </div>
    </div>
  );
}
