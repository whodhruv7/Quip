
export type ModelProvider = "groq" | "openrouter" | "local";

export interface ModelConfig {
  provider: ModelProvider;
  model: string;
  label: string;
  available: boolean;
}

export interface ModelRouterStatus {
  primary: ModelConfig;
  fallback: ModelConfig | null;
  active: ModelConfig;
  healthy: boolean;
}
