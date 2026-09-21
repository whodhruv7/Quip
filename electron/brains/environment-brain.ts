// Quip V2 — ENVIRONMENT BRAIN
// -----------------------------------------------------------------------------
// Runtime awareness of the device's CURRENT state (as opposed to the device
// profile, which is mostly static). The environment brain watches:
//
//   - battery level + charging
//   - network type + online/offline
//   - power source
//   - idle time
//
// The task brain consults this before choosing an execution path. E.g. if
// the battery is critical, prefer lightweight paths; if offline, don't
// promise web actions. It updates on an interval and pushes changes to the
// renderer via IPC.
// -----------------------------------------------------------------------------

import os from "node:os";
import { exec } from "node:child_process";
import type { EnvironmentState } from "../../src/types";

// ── REAL battery telemetry ───────────────────────────────────────────────
// The battery used to be hardcoded to supported:false / level:1 / charging:true,
// which silently disabled every low-power feature (prompt section, proactive
// check). We now read the REAL value on Windows via WMI (60s cache) and report
// an honest "unsupported" elsewhere — never a plausible lie.
type BatteryReading = { supported: boolean; level: number; charging: boolean };
let batteryCache: { at: number; reading: BatteryReading } | null = null;
const BATTERY_TTL_MS = 60_000;

function readBatteryViaWmi(): Promise<BatteryReading> {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve({ supported: false, level: 1, charging: true });
      return;
    }
    const cmd =
      'powershell -NoProfile -Command "$b=Get-CimInstance Win32_Battery; ' +
      'if ($b) { \\"{0}|{1}\\" -f $b.EstimatedChargeRemaining, ($b.BatteryStatus -ge 2) } ' +
      'else { \\"none\\" }"';
    exec(cmd, { timeout: 5000 }, (_err, stdout) => {
      const out = (stdout || "").trim();
      if (!out || out === "none") {
        // Desktop PC or inaccessible WMI — honest unsupported, not a fake value.
        resolve({ supported: false, level: 1, charging: true });
        return;
      }
      const parts = out.split("|");
      const pct = Number.parseFloat(parts[0]);
      const charging = parts[1] === "True" || parts[1] === "true";
      if (Number.isFinite(pct)) {
        resolve({
          supported: true,
          level: Math.min(1, Math.max(0, pct / 100)),
          charging,
        });
      } else {
        resolve({ supported: false, level: 1, charging: true });
      }
    });
  });
}

async function getBattery(): Promise<BatteryReading> {
  if (batteryCache && Date.now() - batteryCache.at < BATTERY_TTL_MS) {
    return batteryCache.reading;
  }
  const reading = await readBatteryViaWmi();
  batteryCache = { at: Date.now(), reading };
  return reading;
}

type Listener = (state: EnvironmentState) => void;

class EnvironmentBrain {
  private listeners = new Set<Listener>();
  private timer: NodeJS.Timeout | null = null;
  private intervalMs: number;
  private last: EnvironmentState | null = null;

  constructor(intervalMs = 5000) {
    this.intervalMs = intervalMs;
  }

  /** Read a single snapshot synchronously (best effort). */
  snapshot(): EnvironmentState {
    // Battery: last KNOWN reading (async WMI fills the cache in the
    // background). Until the first read completes this is honest-unsupported,
    // not a fake 100%.
    const battery: EnvironmentState["battery"] = batteryCache
      ? batteryCache.reading
      : { supported: false, level: 1, charging: true };

    const idleSeconds =
      typeof (powerMonitor as any)?.getSystemIdleTime === "function"
        ? Math.max(0, Math.floor((powerMonitor as any).getSystemIdleTime()))
        : 0;

    const online = typeof (globalThis as any).navigator?.onLine === "boolean"
      ? (globalThis as any).navigator.onLine
      : true;

    return {
      battery,
      network: {
        online,
        type: online ? "wifi" : "offline",
      },
      power: "unknown",
      idleSeconds,
      updated: Date.now(),
    };
  }

  /** Async snapshot — includes REAL battery where the platform provides it. */
  async snapshotAsync(): Promise<EnvironmentState> {
    const base = this.snapshot();
    try {
      base.battery = await getBattery();
      base.power = base.battery.charging ? "ac" : "battery";
    } catch {
      /* keep honest-unsupported fallback */
    }
    return base;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    const next = await this.snapshotAsync();
    if (this.changed(this.last, next)) {
      this.last = next;
      this.listeners.forEach((l) => l(next));
    } else {
      this.last = next;
    }
  }

  private changed(a: EnvironmentState | null, b: EnvironmentState): boolean {
    if (!a) return true;
    return (
      a.network.online !== b.network.online ||
      a.power !== b.power ||
      Math.abs(a.battery.level - b.battery.level) > 0.05 ||
      a.battery.charging !== b.battery.charging
    );
  }

  get(): EnvironmentState {
    return this.last ?? this.snapshot();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.last) listener(this.last);
    return () => this.listeners.delete(listener);
  }
}

// Lazily grab powerMonitor from electron when available (main process only).
let powerMonitor: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  powerMonitor = require("electron").powerMonitor;
} catch {
  /* not in electron */
}

// Singleton — one environment brain per process.
export const environmentBrain = new EnvironmentBrain(5000);
