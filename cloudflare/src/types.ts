/**
 * TypeScript types for the Coding Agent API
 */

export interface Env {
  SESSION_AGENT: DurableObjectNamespace;
  MODAL_API_URL: string;
  MODAL_API_SECRET?: string;  // Secret for authenticating with Modal endpoints
  CONVEX_SITE_URL: string;
  ALLOWED_ORIGINS: string;  // Comma-separated list of allowed origins for CORS
  DEV_MODE?: string;  // Set to "true" to enable debug logging
}

export type SessionStatus = 'idle' | 'starting' | 'running' | 'paused' | 'error';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: MessagePart[];
  timestamp: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  state?: 'pending' | 'running' | 'completed' | 'error';
}

// A message part - either text or a tool call
export interface MessagePart {
  type: 'text' | 'tool';
  text?: string;
  toolCall?: ToolCall;
}

export interface SessionState {
  sessionId: string;
  repo: string;
  userId?: string;
  sandboxId: string | null;
  sandboxUrl: string | null;
  snapshotId: string | null;
  opencodeSessionId: string | null;
  status: SessionStatus;
  isProcessing?: boolean;
  messages: Message[];
  streamingMessage?: Message;  // In-progress assistant message (persisted during streaming)
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateSessionRequest {
  sessionId: string;
  repo: string;
}

export interface PromptRequest {
  text: string;
}

export interface SessionResponse {
  sessionId: string;
  status: SessionStatus;
  messages?: Message[];
  error?: string;
}

// Auth context added by middleware
export interface AuthContext {
  userId: string;
  sessionId: string;
  apiToken: string;
}

// OpenCode SDK types - Event types from SSE stream
export type OpenCodeEventType =
  | 'server.connected'
  | 'session.idle'
  | 'message.part.updated'
  | 'message.start'
  | 'message.complete'
  | 'error';

export interface OpenCodeEvent {
  type: OpenCodeEventType;
  sessionId?: string;
  properties?: {
    part?: OpenCodePart;
    delta?: string;
    index?: number;
  };
}

// Structure of parts from OpenCode SSE events
export interface OpenCodePart {
  id: string;           // Unique part ID from OpenCode
  messageID: string;    // Which message this belongs to
  type: 'text' | 'tool' | 'tool-call' | 'tool_call' | 'tool-invocation' | 'tool_use';
  text?: string;        // Full accumulated text (for text parts)
  tool?: string;        // Tool name (for tool parts)
  name?: string;        // Alternative tool name field
  toolName?: string;    // Alternative tool name field
  callID?: string;      // Alternative part ID field
  toolCallId?: string;  // Alternative part ID field
  state?: {
    input?: Record<string, unknown>;
    output?: string;
    status?: string;
  };
  input?: Record<string, unknown>;
  output?: string;
  result?: string;
  arguments?: Record<string, unknown>;
  status?: string;
}

// Internal tracking structure for parts with ordering metadata
export interface TrackedPart {
  partId: string;       // OpenCode's unique part ID
  messageId: string;    // OpenCode's message ID
  firstSeenAt: number;  // For chronological ordering
  part: MessagePart;    // Normalized part for UI
}

// WebSocket message types
export interface WSMessage {
  type: 'state' | 'event' | 'error';
  payload: unknown;
}
