'use client'

// Quip Phone App — Main Entry
// ─────────────────────────────────────────────────────────────────────────────
// Screen router. Renders the correct screen based on state.
// Smooth transitions between screens.

import { AnimatePresence } from "framer-motion";
import { PhoneFrame } from "@/components/phone/PhoneFrame";
import { StoreProvider, useStore } from "@/lib/quip-store";
import { SplashScreen } from "@/screens/SplashScreen";
import { OnboardingScreen } from "@/screens/OnboardingScreen";
import { CompanionSelectScreen } from "@/screens/CompanionSelectScreen";
import { HomeChatScreen } from "@/screens/HomeChatScreen";
import { MemoryScreen } from "@/screens/MemoryScreen";
import { PersonalityScreen } from "@/screens/PersonalityScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";

function ScreenRouter() {
  const { state } = useStore();

  return (
    <PhoneFrame>
      <AnimatePresence mode="wait">
        {state.screen === "splash" && <SplashScreen key="splash" />}
        {state.screen === "onboarding" && <OnboardingScreen key="onboarding" />}
        {state.screen === "companion-select" && <CompanionSelectScreen key="companion-select" />}
        {state.screen === "home" && <HomeChatScreen key="home" />}
        {state.screen === "memory" && <MemoryScreen key="memory" />}
        {state.screen === "personality" && <PersonalityScreen key="personality" />}
        {state.screen === "settings" && <SettingsScreen key="settings" />}
      </AnimatePresence>
    </PhoneFrame>
  );
}

export default function Home() {
  return (
    <StoreProvider>
      <ScreenRouter />
    </StoreProvider>
  );
}
