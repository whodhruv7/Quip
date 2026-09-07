/**
 * Abstracts communication with the desktop host environment,
 * preventing tight coupling to the global window object in UI components.
 */
export const hostBridge = {
  spawnCompanion: (companionId: string) => {
    if (typeof window !== "undefined" && (window as any).quip?.spawnCompanion) {
      (window as any).quip.spawnCompanion(companionId);
    }
  },
};
