/**
 * API Key Settings Modal
 *
 * Minimal modal for managing API keys (Anthropic, OpenAI)
 */

import { useState, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Provider } from "../lib/models";

interface ConfiguredProvider {
  provider: Provider;
  updatedAt: number;
}

interface ApiKeySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialProvider?: "anthropic" | "openai";
  configuredProviders: ConfiguredProvider[];
}

export function ApiKeySettingsModal({
  isOpen,
  onClose,
  initialProvider = "anthropic",
  configuredProviders,
}: ApiKeySettingsModalProps) {
  const [selectedProvider, setSelectedProvider] = useState<"anthropic" | "openai">(initialProvider);

  // Update selected provider when modal opens with a new initialProvider
  useEffect(() => {
    if (isOpen) {
      setSelectedProvider(initialProvider);
    }
  }, [isOpen, initialProvider]);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const setApiKeyMutation = useMutation(api.userSecrets.setApiKey);
  const deleteApiKeyMutation = useMutation(api.userSecrets.deleteApiKey);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      await setApiKeyMutation({
        provider: selectedProvider,
        apiKey,
      });

      setSuccess("Saved");
      setApiKey("");

      setTimeout(() => {
        setSuccess(null);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (provider: "anthropic" | "openai") => {
    setError(null);
    setSuccess(null);

    try {
      await deleteApiKeyMutation({ provider });
      setSuccess("Removed");

      setTimeout(() => {
        setSuccess(null);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove");
    }
  };

  const anthropicConfigured = configuredProviders.some((p) => p.provider === "anthropic");
  const openaiConfigured = configuredProviders.some((p) => p.provider === "openai");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="api-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="api-settings-header">
          <h2>API Keys</h2>
          <button onClick={onClose} className="modal-close-btn" aria-label="Close">
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M1 1L13 13M13 1L1 13" />
            </svg>
          </button>
        </div>

        {error && <div className="api-settings-alert api-settings-alert-error">{error}</div>}
        {success && <div className="api-settings-alert api-settings-alert-success">{success}</div>}

        <div className="api-settings-content">
          {/* Provider tabs */}
          <div className="api-provider-tabs">
            <button
              type="button"
              className={`api-provider-tab ${selectedProvider === "anthropic" ? "active" : ""}`}
              onClick={() => setSelectedProvider("anthropic")}
            >
              Anthropic
            </button>
            <button
              type="button"
              className={`api-provider-tab ${selectedProvider === "openai" ? "active" : ""}`}
              onClick={() => setSelectedProvider("openai")}
            >
              OpenAI
            </button>
          </div>

          {/* Anthropic section */}
          {selectedProvider === "anthropic" && (
            <div className="api-provider-section">
              {anthropicConfigured && (
                <div className="api-configured-badge">
                  <span className="api-configured-text">Configured</span>
                  <button
                    type="button"
                    onClick={() => handleDelete("anthropic")}
                    className="api-configured-remove"
                  >
                    Remove
                  </button>
                </div>
              )}

              <form onSubmit={handleSubmit} className="api-key-form">
                <input
                  type="password"
                  className="api-key-input-full"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-ant-..."
                  required
                />

                <button type="submit" className="api-save-btn-full" disabled={isSubmitting}>
                  {isSubmitting ? "Saving..." : anthropicConfigured ? "Update Key" : "Save Key"}
                </button>

                <div className="api-help-text">
                  Get your API key from{" "}
                  <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer">
                    console.anthropic.com
                  </a>
                </div>
              </form>
            </div>
          )}

          {/* OpenAI section */}
          {selectedProvider === "openai" && (
            <div className="api-provider-section">
              {openaiConfigured && (
                <div className="api-configured-badge">
                  <span className="api-configured-text">Configured</span>
                  <button
                    type="button"
                    onClick={() => handleDelete("openai")}
                    className="api-configured-remove"
                  >
                    Remove
                  </button>
                </div>
              )}

              <form onSubmit={handleSubmit} className="api-key-form">
                <input
                  type="password"
                  className="api-key-input-full"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  required
                />

                <button type="submit" className="api-save-btn-full" disabled={isSubmitting}>
                  {isSubmitting ? "Saving..." : openaiConfigured ? "Update Key" : "Save Key"}
                </button>

                <div className="api-help-text">
                  Get your API key from{" "}
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    platform.openai.com
                  </a>
                </div>
              </form>
            </div>
          )}

          <div className="api-security-note">Keys are encrypted with AES-256-GCM</div>
        </div>
      </div>
    </div>
  );
}
