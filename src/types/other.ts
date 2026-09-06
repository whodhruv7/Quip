
export interface WorldModel {
  schemaVersion: number;
  generatedAt: number;
  canDo: string[];
  needsPermission: string[];
  cannotDo: string[];
  summary: string;
}

export type FormFactor = "ultrawide" | "desktop" | "tablet" | "phone";

export interface SpatialConfig {
  formFactor: FormFactor;
  windowSize: { width: number; height: number };
  companion: { x: number; y: number };
  chatPanel: { x: number; y: number; width: number; height: number };
  safeMargin: number;
  layout: "floating" | "dock" | "bottom-sheet" | "overlay";
}

export interface EnvironmentState {
  battery: { supported: boolean; level: number; charging: boolean };
  network: { online: boolean; type: "wifi" | "ethernet" | "offline" };
  power: "ac" | "battery" | "unknown";
  idleSeconds: number;
  updated: number;
}

export type BootstrapStage = "health-check" | "device-scan" | "environment" | "world-model" | "model-router" | "window" | "ready";

export interface BootstrapProgress {
  stage: BootstrapStage;
  message: string;
  progress: number;
  done: boolean;
  error: string | null;
}
