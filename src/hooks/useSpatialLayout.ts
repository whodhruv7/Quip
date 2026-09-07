// Quip V2 — spatial layout hook.
//
// Consumes spatial brain data from main process for responsive positioning.

import { useEffect, useState } from "react";
import type { SpatialConfig } from "@/types";

export function useSpatialLayout() {
  const [config, setConfig] = useState<SpatialConfig | null>(null);

  useEffect(() => {
    let mounted = true;
    window.quip.getSpatialConfig().then((cfg) => {
      if (mounted) setConfig(cfg);
    }).catch(() => {});

    const off = window.quip.onSpatialChange((cfg) => {
      if (mounted) setConfig(cfg);
    });

    return () => { mounted = false; off(); };
  }, []);

  return config;
}
