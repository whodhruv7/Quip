
export type CapabilityId = "openBrowser" | "openUrl" | "webSearch" | "launchApp" | "openEditor" | "openTerminal" | "openFiles" | "playMedia" | "readClipboard" | "openMusic" | "openSettings" | "systemControl" | "systemLock" | "systemPower" | "systemPrivilege" | "composeMail" | "openMail" | "noop";

export interface CapabilityImplementation {
  capability: CapabilityId;
  label: string;
  reason: string;
  executor: string;
  params: Record<string, unknown>;
}

export interface CapabilityResolution {
  capability: CapabilityId;
  available: boolean;
  implementation: CapabilityImplementation | null;
  fallback?: { capability?: CapabilityId; available: boolean; implementation: CapabilityImplementation } | null;
}
