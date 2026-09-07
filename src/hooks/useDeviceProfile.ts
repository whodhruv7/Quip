// Quip V2 — device profile hook.
//
// Fetches the device profile from main process (via preload bridge).
// Used by settings panel and other components that need device info.

import { useEffect, useState } from "react";
import type { DeviceProfile } from "@/types";

export function useDeviceProfile() {
  const [profile, setProfile] = useState<DeviceProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    window.quip.getDeviceProfile().then((p) => {
      if (mounted) {
        setProfile(p);
        setLoading(false);
      }
    }).catch(() => {
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, []);

  const rescan = async () => {
    const p = await window.quip.rescanDevice();
    setProfile(p);
    return p;
  };

  return { profile, loading, rescan };
}
