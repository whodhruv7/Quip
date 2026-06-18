// Quip V0.1 — Pix state machine.
//
// Pix has 5 states: idle, hover, thinking, responding, sleeping.
// The state is derived from chat activity + user hover, with a "sleeping"
// fallback after long inactivity.

import { useEffect, useRef, useState } from "react";
import type { PixState } from "@/types";

const SLEEP_AFTER_MS = 60_000; // 1 min of nothing → doze off

export function usePixState(chatBusy: boolean, panelOpen: boolean) {
  const [hovering, setHovering] = useState(false);
  const [sleeping, setSleeping] = useState(false);
  const lastActivity = useRef<number>(Date.now());

  useEffect(() => {
    lastActivity.current = Date.now();
    setSleeping(false);
  }, [chatBusy, panelOpen, hovering]);

  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - lastActivity.current > SLEEP_AFTER_MS) {
        setSleeping(true);
      }
    }, 5_000);
    return () => clearInterval(id);
  }, []);

  const wake = () => {
    lastActivity.current = Date.now();
    setSleeping(false);
  };

  // Priority: thinking/responding (from chat) > sleeping > hover > idle
  let state: PixState = "idle";
  if (chatBusy) {
    state = "thinking";
  } else if (sleeping) {
    state = "sleeping";
  } else if (hovering) {
    state = "hover";
  }

  return { state, hovering, setHovering, sleeping, wake };
}
