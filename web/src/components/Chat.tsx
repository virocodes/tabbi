import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import type { Message, MessagePart, SessionStatus } from "../hooks/useSession";
import { ToolChip } from "./ToolChip";
import { FloatingCatChars } from "./FloatingCatChars";

interface ChatProps {
  messages: Message[];
  status: SessionStatus;
  repo: string;
  onSendPrompt: (text: string) => void;
  pendingMessage?: string | null;
  startupPhase?: string | null;
}

export function Chat({
  messages,
  status,
  repo,
  onSendPrompt,
  pendingMessage,
  startupPhase,
}: ChatProps) {
  const [input, setInput] = useState("");
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Loading timeout - show error if loading takes too long
  useEffect(() => {
    if (!repo) {
      setLoadingTimeout(false);
      const timer = setTimeout(() => setLoadingTimeout(true), 10000);
      return () => clearTimeout(timer);
    }
    setLoadingTimeout(false);
  }, [repo]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px";
    }
  }, [input]);

  // Allow sending when running, paused, or idle (auto-resume will kick in)
  const canSendStatus = status === "running" || status === "paused" || status === "idle";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && canSendStatus) {
      onSendPrompt(input.trim());
      setInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Render a single message part (text or tool)
  const renderPart = (part: MessagePart, index: number, role: string) => {
    if (part.type === "text" && part.text) {
      // Render markdown for assistant messages, plain text for user
      if (role === "assistant") {
        return (
          <div key={index} className="message-text markdown-content">
            <ReactMarkdown>{part.text}</ReactMarkdown>
          </div>
        );
      }
      return (
        <div key={index} className="message-text">
          {part.text}
        </div>
      );
    }
    if (part.type === "tool" && part.toolCall) {
      return (
        <div key={index} className="message-tool">
          <ToolChip tool={part.toolCall} />
        </div>
      );
    }
    return null;
  };

  const canSend = canSendStatus && input.trim();

  // Determine if agent is working (waiting for response or streaming)
  const lastMessage = messages[messages.length - 1];
  const isAgentWorking =
    (status === "starting" && pendingMessage) ||
    (status === "running" && lastMessage?.role === "user");

  return (
    <div className="chat-container">
      {/* Header with status */}
      <div className="chat-header">
        <div className="chat-header-info">
          <span className={`chat-header-status ${status}`} />
          <span className="chat-header-title">{repo.split("/").pop() || repo}</span>
        </div>
      </div>

      {/* Messages area */}
      <div className="chat-messages">
        <div className="chat-messages-inner">
          {/* Loading state - show cat when switching sessions (no repo yet) */}
          {!repo ? (
            <div className="chat-loading-state">
              {loadingTimeout ? (
                <div className="loading-error">
                  <p>Session taking too long to load.</p>
                  <p className="loading-error-hint">Try refreshing or selecting another session.</p>
                </div>
              ) : (
                <FloatingCatChars />
              )}
            </div>
          ) : messages.length === 0 && !pendingMessage ? (
            <div className="empty-state">
              <p>
                {status === "starting"
                  ? "Setting up your coding environment..."
                  : status === "running"
                    ? "Ready to chat! Send a message to start coding."
                    : status === "paused" || status === "idle"
                      ? "Session is paused. Send a message to resume."
                      : "Waiting for session..."}
              </p>
            </div>
          ) : (
            <>
              {messages.map((message) => (
                <div key={message.id} className={`message ${message.role}`}>
                  <div className="message-content">
                    {message.parts.map((part, index) => renderPart(part, index, message.role))}
                  </div>
                </div>
              ))}

              {/* Show pending message while session is starting */}
              {pendingMessage && messages.length === 0 && (
                <div className="message user">
                  <div className="message-content">
                    <div className="message-text">{pendingMessage}</div>
                  </div>
                </div>
              )}

              {/* Working indicator */}
              {isAgentWorking && (
                <div className="agent-working">
                  <div className="agent-working-indicator">
                    <span className="agent-working-dot" />
                    <span className="agent-working-dot" />
                    <span className="agent-working-dot" />
                  </div>
                  {status === "starting" && startupPhase && (
                    <span className="agent-working-text">{startupPhase}</span>
                  )}
                </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="chat-input-container">
        <div className="chat-input-inner">
          <form onSubmit={handleSubmit} className="chat-input-wrapper">
            <textarea
              ref={textareaRef}
              className="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                status === "running"
                  ? "Ask or build anything"
                  : status === "starting"
                    ? "Waiting for session to start..."
                    : status === "paused" || status === "idle"
                      ? "Send a message to resume session..."
                      : "Session not available"
              }
              disabled={!canSendStatus}
              rows={1}
            />
            <button type="submit" className="chat-send-btn" disabled={!canSend}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5"></line>
                <polyline points="5 12 12 5 19 12"></polyline>
              </svg>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
