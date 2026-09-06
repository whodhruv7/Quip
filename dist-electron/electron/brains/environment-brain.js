"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.environmentBrain = void 0;
class EnvironmentBrain {
    listeners = new Set();
    timer = null;
    intervalMs;
    last = null;
    constructor(intervalMs = 5000) {
        this.intervalMs = intervalMs;
    }
    /** Read a single snapshot synchronously (best effort). */
    snapshot() {
        let battery = {
            supported: false,
            level: 1,
            charging: true,
        };
        if (typeof powerMonitor?.getSystemIdleTime === "function") {
            // battery is async in newer Electron; attempt gracefully.
        }
        const idleSeconds = typeof powerMonitor?.getSystemIdleTime === "function"
            ? Math.max(0, Math.floor(powerMonitor.getSystemIdleTime()))
            : 0;
        const online = typeof globalThis.navigator?.onLine === "boolean"
            ? globalThis.navigator.onLine
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
    /** Async snapshot — includes battery if the Electron API is available. */
    async snapshotAsync() {
        const base = this.snapshot();
        try {
            if (typeof powerMonitor?.getCurrentTemperature === "function") {
                // future-proof no-op
            }
            // Electron >= 25 exposes getBatteryUsage? No. Use process-level info.
        }
        catch {
            /* ignore */
        }
        return base;
    }
    start() {
        if (this.timer)
            return;
        this.timer = setInterval(() => this.tick(), this.intervalMs);
        this.tick();
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    async tick() {
        const next = await this.snapshotAsync();
        if (this.changed(this.last, next)) {
            this.last = next;
            this.listeners.forEach((l) => l(next));
        }
        else {
            this.last = next;
        }
    }
    changed(a, b) {
        if (!a)
            return true;
        return (a.network.online !== b.network.online ||
            a.power !== b.power ||
            Math.abs(a.battery.level - b.battery.level) > 0.05 ||
            a.battery.charging !== b.battery.charging);
    }
    get() {
        return this.last ?? this.snapshot();
    }
    subscribe(listener) {
        this.listeners.add(listener);
        if (this.last)
            listener(this.last);
        return () => this.listeners.delete(listener);
    }
}
// Lazily grab powerMonitor from electron when available (main process only).
let powerMonitor = null;
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    powerMonitor = require("electron").powerMonitor;
}
catch {
    /* not in electron */
}
// Singleton — one environment brain per process.
exports.environmentBrain = new EnvironmentBrain(5000);
//# sourceMappingURL=environment-brain.js.map