// Quip V0.1 — drag Pix around the desktop.
//
// We track pointer movement and forward deltas to the Electron main process,
// which moves the frameless transparent window. This keeps drag smooth and
// works even though the window has no title bar.

import { useCallback, useRef } from "react";

export function useWindowDrag(enabled: boolean) {
  const dragging = useRef(false);
  const last = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const moved = useRef(0);

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

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const dx = e.screenX - last.current.x;
      const dy = e.screenY - last.current.y;
      last.current = { x: e.screenX, y: e.screenY };
      moved.current += Math.abs(dx) + Math.abs(dy);
      window.quip.moveWindow(dx, dy);
    },
    []
  );

  const endDrag = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }, []);

  // Returns the pixel distance dragged so the caller can distinguish a click
  // (small movement) from an actual drag.
  const totalMoved = () => moved.current;

  return { onPointerDown, onPointerMove, onPointerUp: endDrag, totalMoved };
}
