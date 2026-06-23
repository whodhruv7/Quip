// Quip V2 — companion drag (within the full-screen overlay).
//
// The Electron window now covers the whole screen and is click-through.
// So "dragging the companion" means moving it around INSIDE the window via
// local position state — smooth, instant, no IPC round-trip per pixel.
//
// We track pointer movement and forward deltas to the parent's onMove
// callback. We also distinguish a click (< threshold px) from a drag.

import { useCallback, useRef } from "react";

interface DragHandlers {
  onMove: (dx: number, dy: number) => void;
}

export function useWindowDrag(_enabled: boolean, handlers?: DragHandlers) {
  const dragging = useRef(false);
  const last = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const moved = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    moved.current = 0;
    last.current = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - last.current.x;
      const dy = e.clientY - last.current.y;
      last.current = { x: e.clientX, y: e.clientY };
      moved.current += Math.abs(dx) + Math.abs(dy);
      handlers?.onMove(dx, dy);
    },
    [handlers]
  );

  const endDrag = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }, []);

  const totalMoved = () => moved.current;

  return { onPointerDown, onPointerMove, onPointerUp: endDrag, totalMoved };
}
