/**
 * Model Configuration
 *
 * Defines available AI models and their providers
 */

export type Provider = "opencode" | "anthropic" | "openai";

export interface ModelConfig {
  id: string;
  provider: Provider;
  displayName: string;
  requiresKey: boolean;
}

export const AVAILABLE_MODELS: ModelConfig[] = [
  {
    id: "opencode/gpt-5-nano",
    provider: "opencode",
    displayName: "GPT 5 Nano (Free)",
    requiresKey: false,
  },
  {
    id: "anthropic/claude-sonnet-4-5-20250929",
    provider: "anthropic",
    displayName: "Claude Sonnet 4.5",
    requiresKey: true,
  },
  {
    id: "anthropic/claude-opus-4-5-20251101",
    provider: "anthropic",
    displayName: "Claude Opus 4.5",
    requiresKey: true,
  },
  {
    id: "openai/gpt-5.2",
    provider: "openai",
    displayName: "GPT 5.2",
    requiresKey: true,
  },
  {
    id: "openai/gpt-5.1-codex-max",
    provider: "openai",
    displayName: "GPT 5.1 Codex",
    requiresKey: true,
  },
];

export const DEFAULT_MODEL = AVAILABLE_MODELS[0];

/**
 * Check if a model requires an API key
 */
export function requiresApiKey(modelId: string): boolean {
  const model = AVAILABLE_MODELS.find((m) => m.id === modelId);
  return model?.requiresKey ?? false;
}

/**
 * Get model configuration by ID
 */
export function getModelById(modelId: string): ModelConfig | undefined {
  return AVAILABLE_MODELS.find((m) => m.id === modelId);
}

/**
 * Get provider from model ID
 */
export function getProviderFromModel(modelId: string): Provider | undefined {
  return getModelById(modelId)?.provider;
}
