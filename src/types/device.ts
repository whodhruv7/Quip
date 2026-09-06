
export type Platform = "win32" | "darwin" | "linux";
export type AppCategory = "browser" | "editor" | "music" | "mail" | "terminal" | "system" | "notes";

export interface InstalledApp {
  id: string;
  name: string;
  category: AppCategory;
  launchId?: string;
}

export interface DisplayInfo {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
  rotation: number;
}

export interface HardwareInfo {
  platform: Platform;
  platformLabel: string;
  osVersion: string;
  osRelease: string;
  hostname: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalMemoryGB: number;
  freeMemoryGB: number;
  storage: { totalGB: number; freeGB: number; usedGB: number };
  displays: DisplayInfo[];
  primaryDisplay: DisplayInfo;
  monitorCount: number;
  primaryResolution: { width: number; height: number };
  scaleFactor: number;
}

export interface SystemPreferences {
  locale: string;
  language: string;
  theme: "light" | "dark" | "unknown";
  taskbar: { edge: "bottom" | "top" | "left" | "right"; height: number };
}

export interface AppRegistry {
  apps: InstalledApp[];
  defaultBrowser: string | null;
  defaultMailApp: string | null;
  defaultEditor: string | null;
  defaultTerminal: string | null;
  browsers: { name: string; id: string }[];
  editors: { name: string; id: string }[];
  musicApps: { name: string; id: string }[];
  mailApps: { name: string; id: string }[];
  terminals: { name: string; id: string }[];
}

export type DeviceProfile = {
  schemaVersion: number;
  scannedAt: number;
  scanDurationMs: number;
} & HardwareInfo & SystemPreferences & AppRegistry;
