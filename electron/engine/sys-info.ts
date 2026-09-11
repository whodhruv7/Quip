// Quip V3 — live system info (Skales "System Monitor" + "Network & Devices").
// ─────────────────────────────────────────────────────────────────────────────
// Real, read-only probes of the laptop's live state: CPU load, memory,
// disks, battery, top processes, and network configuration. Windows-first
// (PowerShell), honest fallback for other OSes. Read-only — never mutates.
// ─────────────────────────────────────────────────────────────────────────────

import { execFile } from "node:child_process";

export interface SysInfoResult {
  ok: boolean;
  summary: string;
  evidence: string[];
}

function run(cmd: string, args: string[], timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 2_000_000 }, (err, stdout, stderr) => {
      if (err && !stdout) reject(new Error(String((err as any).message ?? err) || String(stderr)));
      else resolve(String(stdout ?? ""));
    });
  });
}

/** Live CPU / memory / disk / battery snapshot (Windows PowerShell; POSIX fallback). */
export async function sysInfo(): Promise<SysInfoResult> {
  try {
    if (process.platform === "win32") {
      const ps =
        `$cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average; ` +
        `$os = Get-CimInstance Win32_OperatingSystem; ` +
        `$memTotal = [math]::Round($os.TotalVisibleMemorySize/1MB,1); ` +
        `$memFree = [math]::Round($os.FreePhysicalMemory/1MB,1); ` +
        `$up = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime; ` +
        `"CPU=$cpu%|MEMTOTAL=$memTotal GB|MEMFREE=$memFree GB|BOOT=$up"`;
      const out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps]);
      const cpu = out.match(/CPU=([\d.]+)%/)?.[1] ?? "?";
      const memTotal = out.match(/MEMTOTAL=([\d.]+) GB/)?.[1] ?? "?";
      const memFree = out.match(/MEMFREE=([\d.]+) GB/)?.[1] ?? "?";
      const boot = out.match(/BOOT=(.+)$/m)?.[1]?.trim() ?? "?";

      let diskLine = "";
      try {
        const diskOut = await run("powershell.exe", [
          "-NoProfile", "-NonInteractive", "-Command",
          `Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { "$($_.DeviceID) $([math]::Round($_.FreeSpace/1GB,0))GB free of $([math]::Round($_.Size/1GB,0))GB" }`,
        ]);
        diskLine = diskOut.trim().split(/\r?\n/).filter(Boolean).slice(0, 4).join(" | ");
      } catch {
        /* disk probe optional */
      }

      let batteryLine = "";
      try {
        const bat = await run("powershell.exe", [
          "-NoProfile", "-NonInteractive", "-Command",
          `$b = Get-CimInstance Win32_Battery; if ($b) { "Battery: $([math]::Round($b.EstimatedChargeRemaining,0))% ($($b.BatteryStatus))" } else { "Battery: none (desktop)" }`,
        ]);
        batteryLine = bat.trim();
      } catch {
        /* battery optional */
      }

      return {
        ok: true,
        summary:
          `Live system status:\n` +
          `CPU load: ${cpu}%\n` +
          `Memory: ${memFree} GB free of ${memTotal} GB\n` +
          (diskLine ? `Disks: ${diskLine}\n` : "") +
          (batteryLine ? `${batteryLine}\n` : "") +
          `Last boot: ${boot}`,
        evidence: ["powershell cim", "win32"],
      };
    }

    // POSIX fallback (Linux/macOS dev boxes) — real /proc reads.
    const uptime = await run("cat", ["/proc/uptime"]).catch(() => "");
    let memLine = "";
    try {
      const meminfo = await run("cat", ["/proc/meminfo"]);
      const total = Number(meminfo.match(/MemTotal:\s+(\d+)/)?.[1] ?? 0) / 1024 / 1024;
      const avail = Number(meminfo.match(/MemAvailable:\s+(\d+)/)?.[1] ?? 0) / 1024 / 1024;
      memLine = `Memory: ${avail.toFixed(1)} GB available of ${total.toFixed(1)} GB`;
    } catch {
      /* optional */
    }
    let loadLine = "";
    try {
      loadLine = (await run("cat", ["/proc/loadavg"])).split(" ").slice(0, 3).join(" / ");
    } catch {
      /* optional */
    }
    const upHours = uptime ? (Number(uptime.split(" ")[0]) / 3600).toFixed(1) : "?";
    return {
      ok: true,
      summary:
        `Live system status:\n` +
        (loadLine ? `Load average: ${loadLine}\n` : "") +
        (memLine ? `${memLine}\n` : "") +
        `Uptime: ${upHours} h`,
      evidence: ["proc fs"],
    };
  } catch (e: any) {
    return { ok: false, summary: `I couldn't read the system stats — ${e?.message ?? e}.`, evidence: ["sysinfo failed"] };
  }
}

/** Network configuration: adapters, local IP, Wi-Fi state, ARP neighbours. */
export async function networkInfo(): Promise<SysInfoResult> {
  try {
    const parts: string[] = [];
    if (process.platform === "win32") {
      const ipOut = await run("ipconfig", ["/all"], 15_000);
      const adapters = ipOut
        .split(/(?:\r?\n){2,}/)
        .map((block) => block.trim())
        .filter((block) => /IPv4|DHCP/i.test(block))
        .slice(0, 6);
      parts.push(
        adapters
          .map((b) => {
            const name = b.split(/\r?\n/)[0]?.replace(/:$/, "").trim() ?? "adapter";
            const ipv4 = b.match(/IPv4[^\n:]*:\s*([0-9.]+)/)?.[1] ?? "";
            const gw = b.match(/Default Gateway[^\n:]*:\s*([0-9.]+)/)?.[1] ?? "";
            return `- ${name}${ipv4 ? ` · IP ${ipv4}` : ""}${gw && gw !== "0.0.0.0" ? ` · gateway ${gw}` : ""}`;
          })
          .join("\n")
      );
      const wifi = await run("netsh", ["wlan", "show", "interfaces"], 10_000).catch(() => "");
      const ssid = wifi.match(/^\s*SSID\s*:\s*(.+)$/m)?.[1]?.trim();
      const signal = wifi.match(/^\s*Signal\s*:\s*(.+)$/m)?.[1]?.trim();
      if (ssid) parts.push(`Wi-Fi: connected to "${ssid}"${signal ? ` (${signal})` : ""}`);
      const arp = await run("arp", ["-a"], 10_000).catch(() => "");
      const entries = (arp.match(/^\s*(\d+\.\d+\.\d+\.\d+)\s+/gm) ?? []).map((s) => s.trim()).slice(0, 12);
      if (entries.length) parts.push(`Devices on your network (ARP): ${entries.join(", ")}`);
    } else {
      const ipOut = await run("ip", ["-4", "addr", "show"], 10_000).catch(() => "");
      const ips = ipOut.match(/inet\s+([0-9.]+)/g)?.map((s) => s.replace("inet ", "")) ?? [];
      parts.push(`Local IPs: ${ips.length ? ips.join(", ") : "none found"}`);
      const arp = await run("ip", ["neigh"], 10_000).catch(() => "");
      const entries = arp.match(/^\s*(\d+\.\d+\.\d+\.\d+)/gm)?.map((s) => s.trim()).slice(0, 12) ?? [];
      if (entries.length) parts.push(`Devices on your network (ARP): ${entries.join(", ")}`);
    }
    if (parts.length === 0) {
      return { ok: false, summary: "I couldn't read the network configuration.", evidence: ["netinfo empty"] };
    }
    return { ok: true, summary: `Network status:\n${parts.join("\n")}`, evidence: ["ipconfig/arp/netsh"] };
  } catch (e: any) {
    return { ok: false, summary: `Network check failed — ${e?.message ?? e}.`, evidence: ["netinfo failed"] };
  }
}
