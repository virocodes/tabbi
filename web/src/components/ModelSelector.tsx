/**
 * ModelSelector Component
 *
 * Dropdown for selecting AI model with API key requirement indicators
 */

import { AVAILABLE_MODELS, type Provider } from "../lib/models";

interface ModelSelectorProps {
  selectedModel: string;
  configuredProviders: Provider[];
  onModelChange: (modelId: string) => void;
  onConfigureKey: (provider: "anthropic" | "openai") => void;
  disabled?: boolean;
}

export function ModelSelector({
  selectedModel,
  configuredProviders,
  onModelChange,
  onConfigureKey,
  disabled = false,
}: ModelSelectorProps) {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const modelId = e.target.value;
    const model = AVAILABLE_MODELS.find((m) => m.id === modelId);

    if (!model) return;

    // Check if model requires API key and user hasn't configured it
    if (model.requiresKey && !configuredProviders.includes(model.provider)) {
      // Open settings modal to configure key for this provider
      if (model.provider === "anthropic" || model.provider === "openai") {
        onConfigureKey(model.provider);
      }
      return;
    }

    onModelChange(modelId);
  };

  return (
    <div className="model-selector">
      <select
        className="model-select"
        value={selectedModel}
        onChange={handleChange}
        disabled={disabled}
      >
        {AVAILABLE_MODELS.map((model) => {
          const isLocked = model.requiresKey && !configuredProviders.includes(model.provider);

          return (
            <option key={model.id} value={model.id}>
              {isLocked ? "🔒 " : ""}
              {model.displayName}
            </option>
          );
        })}
      </select>
    </div>
  );
}
