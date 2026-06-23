<<<<<<< HEAD
// Quip V0.1 — drag Pix around the desktop.
//
// We track pointer movement and forward deltas to the Electron main process,
// which moves the frameless transparent window. This keeps drag smooth and
// works even though the window has no title bar.

import { useCallback, useRef } from "react";

export function useWindowDrag(enabled: boolean) {
=======
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
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
  const dragging = useRef(false);
  const last = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const moved = useRef(0);

<<<<<<< HEAD
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled) return;
      dragging.current = true;
      moved.current = 0;
      last.current = { x: e.screenX, y: e.screenY };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    [enabled]
  );
=======
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    moved.current = 0;
    last.current = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, []);
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
<<<<<<< HEAD
      const dx = e.screenX - last.current.x;
      const dy = e.screenY - last.current.y;
      last.current = { x: e.screenX, y: e.screenY };
      moved.current += Math.abs(dx) + Math.abs(dy);
      window.quip.moveWindow(dx, dy);
    },
    []
=======
      const dx = e.clientX - last.current.x;
      const dy = e.clientY - last.current.y;
      last.current = { x: e.clientX, y: e.clientY };
      moved.current += Math.abs(dx) + Math.abs(dy);
      handlers?.onMove(dx, dy);
    },
    [handlers]
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
  );

  const endDrag = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }, []);

<<<<<<< HEAD
  // Returns the pixel distance dragged so the caller can distinguish a click
  // (small movement) from an actual drag.
=======
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
  const totalMoved = () => moved.current;

  return { onPointerDown, onPointerMove, onPointerUp: endDrag, totalMoved };
}
