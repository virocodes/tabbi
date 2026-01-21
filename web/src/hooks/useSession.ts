import { useState, useEffect, useCallback, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8787";

// Only log in development
const isDev = import.meta.env.DEV;
const log = (...args: unknown[]) => isDev && console.log(...args);
const logError = (...args: unknown[]) => isDev && console.error(...args);

// WebSocket reconnection settings
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;

export type SessionStatus = "idle" | "starting" | "running" | "paused" | "error";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  state?: "pending" | "running" | "completed" | "error";
}

export interface MessagePart {
  type: "text" | "tool";
  text?: string;
  toolCall?: ToolCall;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  parts: MessagePart[];
  timestamp: number;
}

export interface SessionState {
  sessionId: string;
  repo: string;
  status: SessionStatus;
  isProcessing?: boolean;
  messages: Message[];
  error?: string;
  selectedModel?: string;
  provider?: string;
  updatedAt?: number;
}

interface UseSessionOptions {
  onStatusChange?: (sessionId: string, status: SessionStatus, isProcessing: boolean) => void;
}

interface UseSessionResult {
  state: SessionState | null;
  isConnected: boolean;
  createSession: (repo: string, model: string) => Promise<void>;
  loadSession: (sessionId: string) => Promise<void>;
  clearSession: () => void;
  sendPrompt: (text: string) => void;
  pauseSession: () => void;
  resumeSession: () => void;
  stopSession: () => void;
  error: string | null;
}

/**
 * Deduplicate messages by ID
 */
function deduplicateMessages(messages: Message[]): Message[] {
  const seenIds = new Set<string>();
  return messages.filter((msg) => {
    if (seenIds.has(msg.id)) return false;
    seenIds.add(msg.id);
    return true;
  });
}

export function useSession(options?: UseSessionOptions): UseSessionResult {
  const [state, setState] = useState<SessionState | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const apiTokenRef = useRef<string | null>(null);
  const onStatusChangeRef = useRef(options?.onStatusChange);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isReconnectingRef = useRef(false);

  // Debouncing for streaming updates (50ms)
  const streamingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStreamingUpdateRef = useRef<{ messageId: string; parts: MessagePart[] } | null>(
    null
  );

  // Convex mutations
  const createSessionMutation = useMutation(api.sessions.createSession);
  const refreshTokenMutation = useMutation(api.sessions.refreshSessionToken);

  // Keep the callback ref updated
  onStatusChangeRef.current = options?.onStatusChange;

  // Cancel any pending reconnection attempt
  const cancelReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    isReconnectingRef.current = false;
  }, []);

  // Schedule a reconnection with exponential backoff
  const scheduleReconnect = useCallback(async () => {
    if (!sessionIdRef.current) {
      log("No session ID, skipping reconnect");
      return;
    }

    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      logError("Max reconnection attempts reached");
      setError("Connection lost. Please refresh the page.");
      return;
    }

    isReconnectingRef.current = true;
    reconnectAttemptsRef.current += 1;

    // Exponential backoff with jitter
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current - 1) +
        Math.random() * 1000,
      MAX_RECONNECT_DELAY_MS
    );

    log(`Scheduling reconnect attempt ${reconnectAttemptsRef.current} in ${delay}ms`);

    reconnectTimeoutRef.current = setTimeout(async () => {
      try {
        // Get a fresh token for reconnection
        const { apiToken } = await refreshTokenMutation({ sessionId: sessionIdRef.current! });
        apiTokenRef.current = apiToken;

        // Reconnect with new token
        connectWebSocketInternal(sessionIdRef.current!, apiToken);
      } catch (err) {
        logError("Failed to refresh token for reconnection:", err);
        // Try again
        scheduleReconnect();
      }
    }, delay);
  }, [refreshTokenMutation]);

  // Internal WebSocket connection function (used by both initial connect and reconnect)
  const connectWebSocketInternal = useCallback(
    (sessionId: string, apiToken: string) => {
      if (wsRef.current) {
        wsRef.current.close();
      }

      const wsUrl = API_URL.replace(/^http/, "ws");
      // Pass token via subprotocol
      const ws = new WebSocket(`${wsUrl}/sessions/${sessionId}/ws`, ["bearer", apiToken]);

      ws.onopen = () => {
        setIsConnected(true);
        setError(null);
        // Reset reconnection state on successful connect
        reconnectAttemptsRef.current = 0;
        isReconnectingRef.current = false;
        log("WebSocket connected successfully");
      };

      ws.onmessage = (event) => {
        log("WebSocket message received:", event.data);
        try {
          const data = JSON.parse(event.data);
          log("Parsed WebSocket data:", data);

          if (data.type === "state") {
            log("Setting state, messages:", data.payload?.messages?.length);
            // Deduplicate messages when receiving state updates
            const newState = data.payload as SessionState;
            setState((prev) => {
              // Only update if WebSocket state is newer (version comparison)
              if (prev && prev.sessionId === newState.sessionId) {
                if ((newState.updatedAt || 0) < (prev.updatedAt || 0)) {
                  log(
                    "Ignoring stale state update, current:",
                    prev.updatedAt,
                    "received:",
                    newState.updatedAt
                  );
                  return prev; // Ignore stale update
                }
              }
              return {
                ...newState,
                messages: deduplicateMessages(newState.messages),
              };
            });
            // Notify about status change
            if (onStatusChangeRef.current && newState.sessionId) {
              onStatusChangeRef.current(
                newState.sessionId,
                newState.status,
                newState.isProcessing ?? false
              );
            }
          } else if (data.type === "streaming") {
            // Real-time streaming update for in-progress message
            const { messageId, parts } = data.payload;
            log("Streaming update - messageId:", messageId, "parts:", parts?.length);

            // Filter out any empty parts
            const validParts = (parts || []).filter((p: MessagePart) => {
              if (p.type === "text") return p.text && p.text.length > 0;
              if (p.type === "tool") return p.toolCall;
              return false;
            });

            // Don't create/update message if there's no actual content
            if (validParts.length === 0) {
              log("Skipping streaming update - no valid parts");
              return;
            }

            // Store the pending update
            pendingStreamingUpdateRef.current = { messageId, parts: validParts };

            // Clear any existing debounce timeout
            if (streamingDebounceRef.current) {
              clearTimeout(streamingDebounceRef.current);
            }

            // Debounce the state update by 50ms
            streamingDebounceRef.current = setTimeout(() => {
              const pending = pendingStreamingUpdateRef.current;
              if (!pending) return;

              setState((prev) => {
                if (!prev) return prev;

                // Check if we already have this message (update it) or need to add it
                const existingIdx = prev.messages.findIndex((m) => m.id === pending.messageId);

                const streamingMessage: Message = {
                  id: pending.messageId,
                  role: "assistant",
                  parts: pending.parts,
                  timestamp: Date.now(),
                };

                if (existingIdx >= 0) {
                  // Update existing message
                  const newMessages = [...prev.messages];
                  newMessages[existingIdx] = streamingMessage;
                  return { ...prev, messages: newMessages };
                } else {
                  // Add new streaming message
                  return { ...prev, messages: [...prev.messages, streamingMessage] };
                }
              });

              pendingStreamingUpdateRef.current = null;
            }, 50);
          } else if (data.type === "event") {
            log("Event received:", data.payload);
          } else if (data.type === "error") {
            logError("Error received:", data.payload);
            setError(data.payload.message);
          }
        } catch (err) {
          logError("Failed to parse WebSocket message:", err);
        }
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        log("WebSocket closed, code:", event.code, "reason:", event.reason);

        // Only attempt reconnection if:
        // 1. We have a session ID
        // 2. The close was not intentional (code 1000 = normal closure)
        // 3. We're not already reconnecting
        if (sessionIdRef.current && event.code !== 1000 && !isReconnectingRef.current) {
          log("Unexpected close, attempting reconnection...");
          scheduleReconnect();
        }
      };

      ws.onerror = (event) => {
        logError("WebSocket error:", event);
        setError("WebSocket connection error");
        setIsConnected(false);
      };

      wsRef.current = ws;
      sessionIdRef.current = sessionId;
      apiTokenRef.current = apiToken;
    },
    [scheduleReconnect]
  );

  // Public wrapper that also stores session info for reconnection
  const connectWebSocket = useCallback(
    (sessionId: string, apiToken: string) => {
      // Cancel any pending reconnect first
      cancelReconnect();
      // Store session info for potential reconnection
      sessionIdRef.current = sessionId;
      apiTokenRef.current = apiToken;
      // Connect
      connectWebSocketInternal(sessionId, apiToken);
    },
    [connectWebSocketInternal, cancelReconnect]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelReconnect();
      if (wsRef.current) {
        wsRef.current.close();
      }
      // Clear debounce timeout
      if (streamingDebounceRef.current) {
        clearTimeout(streamingDebounceRef.current);
        streamingDebounceRef.current = null;
      }
      pendingStreamingUpdateRef.current = null;
    };
  }, [cancelReconnect]);

  // Create a new session via Convex
  const createSession = useCallback(
    async (repo: string, model: string) => {
      setError(null);

      // Extract provider from model
      const provider = model.split("/")[0] as "anthropic" | "openai" | "opencode";

      // Set loading state immediately
      setState({
        sessionId: "",
        repo,
        status: "starting",
        messages: [],
        selectedModel: model,
        provider,
      });

      try {
        log("Creating session for repo:", repo, "with model:", model);

        // Create session via Convex (returns sessionId + apiToken)
        const { sessionId, apiToken } = await createSessionMutation({
          repo,
          selectedModel: model,
          provider,
        });
        log("Session created:", sessionId);

        // Now call Cloudflare to initialize the DO
        const response = await fetch(`${API_URL}/sessions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiToken}`,
          },
          body: JSON.stringify({
            sessionId,
            repo,
            selectedModel: model,
            provider,
          }),
        });

        const responseText = await response.text();
        log("Cloudflare session response:", responseText);

        if (!response.ok) {
          let errorMessage = "Failed to create session";
          try {
            const errorData = JSON.parse(responseText);
            errorMessage = errorData.error || errorMessage;
          } catch {
            errorMessage = responseText || errorMessage;
          }
          throw new Error(errorMessage);
        }

        const sessionState = JSON.parse(responseText) as SessionState;
        log("Session state:", sessionState);
        setState({
          ...sessionState,
          messages: deduplicateMessages(sessionState.messages),
        });

        // Connect to WebSocket for real-time updates
        if (sessionState.sessionId) {
          connectWebSocket(sessionState.sessionId, apiToken);
        }
      } catch (err) {
        logError("Session creation error:", err);
        setError(err instanceof Error ? err.message : "Failed to create session");
        setState(null);
      }
    },
    [createSessionMutation, connectWebSocket]
  );

  // Load an existing session by ID
  const loadSession = useCallback(
    async (sessionId: string) => {
      setError(null);

      try {
        log("Loading session:", sessionId);

        // Get a fresh API token for this session
        const { apiToken } = await refreshTokenMutation({ sessionId });

        const response = await fetch(`${API_URL}/sessions/${sessionId}`, {
          headers: {
            Authorization: `Bearer ${apiToken}`,
          },
        });

        if (!response.ok) {
          throw new Error("Failed to load session");
        }

        const sessionState = (await response.json()) as SessionState;
        log("Loaded session state:", sessionState);

        // Deduplicate messages
        setState({
          ...sessionState,
          messages: deduplicateMessages(sessionState.messages),
        });

        // Connect to WebSocket for real-time updates
        connectWebSocket(sessionId, apiToken);
      } catch (err) {
        logError("Session load error:", err);
        setError(err instanceof Error ? err.message : "Failed to load session");
      }
    },
    [refreshTokenMutation, connectWebSocket]
  );

  // Send a prompt via WebSocket
  const sendPrompt = useCallback((text: string) => {
    log("sendPrompt called with:", text);
    log("WebSocket state:", wsRef.current?.readyState, "OPEN is", WebSocket.OPEN);

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      logError("WebSocket not connected");
      setError("Not connected to session");
      return;
    }

    // Optimistically add user message to state immediately
    const userMessage: Message = {
      id: `optimistic-${Date.now()}`,
      role: "user",
      parts: [{ type: "text", text }],
      timestamp: Date.now(),
    };

    setState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        messages: [...prev.messages, userMessage],
        isProcessing: true,
      };
    });

    const message = JSON.stringify({ type: "prompt", text });
    log("Sending WebSocket message:", message);
    wsRef.current.send(message);
  }, []);

  // Pause the session
  const pauseSession = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError("Not connected to session");
      return;
    }

    wsRef.current.send(JSON.stringify({ type: "pause" }));
  }, []);

  // Resume the session
  const resumeSession = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError("Not connected to session");
      return;
    }

    wsRef.current.send(JSON.stringify({ type: "resume" }));
  }, []);

  // Stop the session
  const stopSession = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError("Not connected to session");
      return;
    }

    wsRef.current.send(JSON.stringify({ type: "stop" }));
  }, []);

  // Clear session state (for starting fresh)
  const clearSession = useCallback(() => {
    cancelReconnect();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setState(null);
    setIsConnected(false);
    setError(null);
    sessionIdRef.current = null;
    apiTokenRef.current = null;
    reconnectAttemptsRef.current = 0;
  }, [cancelReconnect]);

  return {
    state,
    isConnected,
    createSession,
    loadSession,
    clearSession,
    sendPrompt,
    pauseSession,
    resumeSession,
    stopSession,
    error,
  };
}
