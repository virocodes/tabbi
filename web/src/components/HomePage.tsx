import { useState, useRef, useEffect } from "react";
import type { Repository } from "../hooks/useAuth";
import { FloatingCatChars } from "./FloatingCatChars";

interface HomePageProps {
  repos: Repository[];
  isLoadingRepos: boolean;
  isStarting: boolean;
  isReady: boolean;
  isPendingSubmit: boolean;
  startupPhase: string | null;
  onStartTyping: (repo: string) => void;
  onSubmitMessage: (message: string) => void;
}

export function HomePage({
  repos,
  isLoadingRepos,
  isStarting,
  isReady,
  isPendingSubmit,
  startupPhase,
  onStartTyping,
  onSubmitMessage,
}: HomePageProps) {
  const [selectedRepo, setSelectedRepo] = useState("");
  const [message, setMessage] = useState("");
  const [hasStartedTyping, setHasStartedTyping] = useState(false);
  const [selectWidth, setSelectWidth] = useState<number | undefined>(undefined);
  const [isTypingNow, setIsTypingNow] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const typingTimeoutRef = useRef<number>();

  // Track active typing (reset after 1.5s of no input)
  const handleTypingActivity = () => {
    setIsTypingNow(true);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = window.setTimeout(() => {
      setIsTypingNow(false);
    }, 1500);
  };

  // Measure text width for dynamic select sizing
  useEffect(() => {
    if (measureRef.current) {
      const width = measureRef.current.offsetWidth;
      // Add padding: 12px left + 32px right (for arrow) + 12px buffer
      const minWidth = 100;
      const maxWidth = 280;
      setSelectWidth(Math.min(Math.max(width + 56, minWidth), maxWidth));
    }
  }, [selectedRepo, repos]);

  // Handle text input - start session on first character
  const handleMessageChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setMessage(newValue);
    handleTypingActivity();

    // Start session when user types first character
    if (newValue.length > 0 && !hasStartedTyping && selectedRepo) {
      setHasStartedTyping(true);
      onStartTyping(selectedRepo);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      onSubmitMessage(message.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const canSubmit = selectedRepo && message.trim() && !isLoadingRepos && !isPendingSubmit;

  const getButtonText = () => {
    if (isPendingSubmit) return "Waiting...";
    return "Send";
  };

  return (
    <div className="home-page">
      <FloatingCatChars isTyping={isTypingNow} />
      <h1 className="home-title">What would you like to build?</h1>

      <div className="home-input-container">
        <form onSubmit={handleSubmit}>
          <div className="home-input-wrapper">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={handleMessageChange}
              onKeyDown={handleKeyDown}
              placeholder={selectedRepo ? "Describe what you'd like to build or fix..." : "Select a repo to get started..."}
              disabled={!selectedRepo || isPendingSubmit}
            />

            <div className="home-input-footer">
              <div className="home-input-footer-left">
                {/* Repo Selector */}
                <div className="home-repo-selector-inline">
                  {/* Hidden span to measure text width */}
                  <span ref={measureRef} className="repo-measure">
                    {selectedRepo || "Select repo"}
                  </span>
                  {isLoadingRepos ? (
                    <span className="loading-spinner" />
                  ) : (
                    <select
                      value={selectedRepo}
                      onChange={(e) => setSelectedRepo(e.target.value)}
                      disabled={hasStartedTyping || repos.length === 0}
                      style={selectWidth ? { width: selectWidth } : undefined}
                    >
                      {repos.length === 0 ? (
                        <option value="">No repos</option>
                      ) : (
                        <>
                          <option value="" disabled>
                            Select repo
                          </option>
                          {repos.map((repo) => (
                            <option key={repo.id} value={repo.full_name}>
                              {repo.full_name}
                            </option>
                          ))}
                        </>
                      )}
                    </select>
                  )}
                </div>

                {/* Status indicator */}
                {hasStartedTyping && (
                  <div className="home-session-status">
                    {isStarting && (
                      <>
                        <span className="status-dot starting" />
                        <span className="status-text">{startupPhase || "Starting..."}</span>
                      </>
                    )}
                    {isReady && (
                      <>
                        <span className="status-dot ready" />
                        <span className="status-text">Ready</span>
                      </>
                    )}
                    {isPendingSubmit && (
                      <>
                        <span className="status-dot pending" />
                        <span className="status-text">Sending...</span>
                      </>
                    )}
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={!canSubmit}
                className="home-submit-btn"
              >
                {getButtonText()}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
