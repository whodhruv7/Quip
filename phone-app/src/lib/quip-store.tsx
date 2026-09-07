// Quip Phone App — Central State Store
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for: navigation, companion, theme, style, messages,
// memories, personality profile. React context + useReducer pattern.

import { createContext, useContext, useReducer, ReactNode, useCallback, useEffect } from "react";
import { getTheme, getStyle, type QuipTheme, type QuipStyle } from "./quip-design";
import { getCompanion } from "./companion-config";

// ─── Types ───────────────────────────────────────────────────────────────────
export type Screen =
  | "splash"
  | "onboarding"
  | "companion-select"
  | "home"
  | "memory"
  | "personality"
  | "settings";

export type Tab = "home" | "memory" | "personality" | "settings";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
  streaming?: boolean;
  trustNote?: string;
  tone?: string;
}

export interface Memory {
  id: string;
  key: string;
  value: string;
  kind: "contact" | "preference" | "fact" | "style";
  importance: "high" | "medium" | "low";
  pinned: boolean;
  createdAt: number;
}

export interface UserProfile {
  preferredLength: number;
  formality: number;       // 0-1
  emojiUsage: number;      // 0-1
  humorLevel: number;      // 0-1
  totalInteractions: number;
  topTopics: { topic: string; count: number }[];
}

export interface AppState {
  screen: Screen;
  activeTab: Tab;
  companionId: "pix" | "kai" | "ren";
  themeId: string;
  styleId: string;
  onboarded: boolean;
  messages: ChatMessage[];
  memories: Memory[];
  profile: UserProfile;
  activeTone: string | null;
  showKeyboard: boolean;
  typedText: string;
  showQuickActions: boolean;
}

type Action =
  | { type: "NAVIGATE"; screen: Screen }
  | { type: "SET_TAB"; tab: Tab }
  | { type: "SET_COMPANION"; id: "pix" | "kai" | "ren" }
  | { type: "SET_THEME"; id: string }
  | { type: "SET_STYLE"; id: string }
  | { type: "SET_ONBOARDED"; value: boolean }
  | { type: "ADD_MESSAGE"; message: ChatMessage }
  | { type: "UPDATE_MESSAGE"; id: string; content: string }
  | { type: "FINISH_STREAM"; id: string }
  | { type: "CLEAR_MESSAGES" }
  | { type: "ADD_MEMORY"; memory: Memory }
  | { type: "TOGGLE_PIN_MEMORY"; id: string }
  | { type: "DELETE_MEMORY"; id: string }
  | { type: "UPDATE_PROFILE"; patch: Partial<UserProfile> }
  | { type: "SET_TONE"; tone: string | null }
  | { type: "SET_KEYBOARD"; show: boolean }
  | { type: "SET_TYPED"; text: string }
  | { type: "TOGGLE_QUICK_ACTIONS" }
  | { type: "SET_QUICK_ACTIONS"; show: boolean };

// ─── Initial State ───────────────────────────────────────────────────────────
const initialState: AppState = {
  screen: "splash",
  activeTab: "home",
  companionId: "pix",
  themeId: "aurora",
  styleId: "glass",
  onboarded: false,
  messages: [],
  memories: [
    { id: "m1", key: "name", value: "Dhruv", kind: "fact", importance: "high", pinned: true, createdAt: Date.now() - 86400000 },
    { id: "m2", key: "language", value: "Prefers Hindi & English", kind: "preference", importance: "medium", pinned: false, createdAt: Date.now() - 43200000 },
    { id: "m3", key: "ceo", value: "Rajesh Gupta", kind: "contact", importance: "high", pinned: true, createdAt: Date.now() - 21600000 },
    { id: "m4", key: "style", value: "Casual, uses emojis often", kind: "style", importance: "medium", pinned: false, createdAt: Date.now() - 10800000 },
  ],
  profile: {
    preferredLength: 85,
    formality: 0.4,
    emojiUsage: 0.55,
    humorLevel: 0.6,
    totalInteractions: 47,
    topTopics: [
      { topic: "coding", count: 23 },
      { topic: "music", count: 15 },
      { topic: "travel", count: 9 },
      { topic: "food", count: 7 },
    ],
  },
  activeTone: null,
  showKeyboard: false,
  typedText: "",
  showQuickActions: false,
};

// ─── Reducer ─────────────────────────────────────────────────────────────────
function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "NAVIGATE":
      return { ...state, screen: action.screen };

    case "SET_TAB":
      return { ...state, activeTab: action.tab, screen: action.tab };

    case "SET_COMPANION":
      return { ...state, companionId: action.id };

    case "SET_THEME":
      return { ...state, themeId: action.id };

    case "SET_STYLE":
      return { ...state, styleId: action.id };

    case "SET_ONBOARDED":
      return { ...state, onboarded: action.value };

    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.message] };

    case "UPDATE_MESSAGE":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.id ? { ...m, content: action.content } : m
        ),
      };

    case "FINISH_STREAM":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.id ? { ...m, streaming: false } : m
        ),
      };

    case "CLEAR_MESSAGES":
      return { ...state, messages: [] };

    case "ADD_MEMORY":
      return { ...state, memories: [action.memory, ...state.memories] };

    case "TOGGLE_PIN_MEMORY":
      return {
        ...state,
        memories: state.memories.map((m) =>
          m.id === action.id ? { ...m, pinned: !m.pinned } : m
        ),
      };

    case "DELETE_MEMORY":
      return {
        ...state,
        memories: state.memories.filter((m) => m.id !== action.id),
      };

    case "UPDATE_PROFILE":
      return { ...state, profile: { ...state.profile, ...action.patch } };

    case "SET_TONE":
      return { ...state, activeTone: action.tone };

    case "SET_KEYBOARD":
      return { ...state, showKeyboard: action.show };

    case "SET_TYPED":
      return { ...state, typedText: action.text };

    case "TOGGLE_QUICK_ACTIONS":
      return { ...state, showQuickActions: !state.showQuickActions };

    case "SET_QUICK_ACTIONS":
      return { ...state, showQuickActions: action.show };

    default:
      return state;
  }
}

// ─── Context ─────────────────────────────────────────────────────────────────
interface StoreContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  theme: QuipTheme;
  style: QuipStyle;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const getInitialCompanion = () => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const comp = params.get("companion");
      if (comp === "pix" || comp === "kai" || comp === "ren") {
        return comp;
      }
    }
    return initialState.companionId;
  };

  const [state, dispatch] = useReducer(reducer, { ...initialState, companionId: getInitialCompanion() });
  
  // Inform main process of initial companion if needed, or any changes
  useEffect(() => {
    if (typeof window !== "undefined" && (window as any).quip?.setCompanion) {
      (window as any).quip.setCompanion(state.companionId);
    }
  }, [state.companionId]);
  const theme = getTheme(state.themeId);
  const style = getStyle(state.styleId);

  return (
    <StoreContext.Provider value={{ state, dispatch, theme, style }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
export const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
