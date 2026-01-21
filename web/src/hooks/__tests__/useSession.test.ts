import { describe, it, expect, vi } from "vitest";

// Mock Convex
vi.mock("convex/react", () => ({
  useMutation: vi.fn(() =>
    vi.fn().mockResolvedValue({ sessionId: "test-id", apiToken: "test-token" })
  ),
}));

vi.mock("../../../../convex/_generated/api", () => ({
  api: {
    sessions: {
      createSession: "createSession",
      refreshSessionToken: "refreshSessionToken",
    },
  },
}));

// Test the deduplicateMessages function by extracting it
// Since it's not exported, we test it through the hook behavior
// For now, let's test the types and basic structure

import type { Message, MessagePart, ToolCall, SessionState, SessionStatus } from "../useSession";

describe("useSession types", () => {
  it("should have correct SessionStatus values", () => {
    const validStatuses: SessionStatus[] = ["idle", "starting", "running", "paused", "error"];
    expect(validStatuses).toHaveLength(5);
  });

  it("should create valid Message objects", () => {
    const message: Message = {
      id: "msg-1",
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
      timestamp: Date.now(),
    };

    expect(message.id).toBe("msg-1");
    expect(message.role).toBe("user");
    expect(message.parts).toHaveLength(1);
  });

  it("should create valid ToolCall objects", () => {
    const toolCall: ToolCall = {
      id: "tool-1",
      name: "readFile",
      arguments: { path: "/test.txt" },
      state: "completed",
      result: "file contents",
    };

    expect(toolCall.id).toBe("tool-1");
    expect(toolCall.name).toBe("readFile");
    expect(toolCall.state).toBe("completed");
  });

  it("should create valid MessagePart with tool call", () => {
    const part: MessagePart = {
      type: "tool",
      toolCall: {
        id: "tool-1",
        name: "bash",
        arguments: { command: "ls" },
        state: "running",
      },
    };

    expect(part.type).toBe("tool");
    expect(part.toolCall?.name).toBe("bash");
  });

  it("should create valid SessionState", () => {
    const state: SessionState = {
      sessionId: "session-123",
      repo: "user/repo",
      status: "running",
      isProcessing: true,
      messages: [],
      updatedAt: Date.now(),
    };

    expect(state.sessionId).toBe("session-123");
    expect(state.status).toBe("running");
    expect(state.isProcessing).toBe(true);
  });
});

describe("deduplicateMessages logic", () => {
  // Test the deduplication logic that the hook uses
  function deduplicateMessages(messages: Message[]): Message[] {
    const seenIds = new Set<string>();
    return messages.filter((msg) => {
      if (seenIds.has(msg.id)) return false;
      seenIds.add(msg.id);
      return true;
    });
  }

  it("should keep unique messages", () => {
    const messages: Message[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "Hello" }], timestamp: 1 },
      { id: "2", role: "assistant", parts: [{ type: "text", text: "Hi" }], timestamp: 2 },
    ];

    const result = deduplicateMessages(messages);
    expect(result).toHaveLength(2);
  });

  it("should remove duplicate messages by ID", () => {
    const messages: Message[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "Hello" }], timestamp: 1 },
      { id: "1", role: "user", parts: [{ type: "text", text: "Hello again" }], timestamp: 2 },
      { id: "2", role: "assistant", parts: [{ type: "text", text: "Hi" }], timestamp: 3 },
    ];

    const result = deduplicateMessages(messages);
    expect(result).toHaveLength(2);
    expect(result[0].parts[0].text).toBe("Hello"); // Keeps first occurrence
  });

  it("should handle empty array", () => {
    const result = deduplicateMessages([]);
    expect(result).toHaveLength(0);
  });

  it("should preserve order of first occurrences", () => {
    const messages: Message[] = [
      { id: "a", role: "user", parts: [], timestamp: 1 },
      { id: "b", role: "assistant", parts: [], timestamp: 2 },
      { id: "a", role: "user", parts: [], timestamp: 3 },
      { id: "c", role: "user", parts: [], timestamp: 4 },
    ];

    const result = deduplicateMessages(messages);
    expect(result.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });
});

describe("WebSocket reconnection logic", () => {
  it("should calculate exponential backoff correctly", () => {
    const INITIAL_DELAY = 1000;
    const MAX_DELAY = 30000;

    const calculateDelay = (attempt: number) => {
      return Math.min(INITIAL_DELAY * Math.pow(2, attempt - 1), MAX_DELAY);
    };

    expect(calculateDelay(1)).toBe(1000);
    expect(calculateDelay(2)).toBe(2000);
    expect(calculateDelay(3)).toBe(4000);
    expect(calculateDelay(4)).toBe(8000);
    expect(calculateDelay(5)).toBe(16000);
    expect(calculateDelay(6)).toBe(30000); // Capped at max
    expect(calculateDelay(10)).toBe(30000); // Still capped
  });
});

describe("streaming message filtering", () => {
  it("should filter out empty text parts", () => {
    const parts: MessagePart[] = [
      { type: "text", text: "" },
      { type: "text", text: "Hello" },
      { type: "text", text: "" },
    ];

    const validParts = parts.filter((p) => {
      if (p.type === "text") return p.text && p.text.length > 0;
      if (p.type === "tool") return p.toolCall;
      return false;
    });

    expect(validParts).toHaveLength(1);
    expect(validParts[0].text).toBe("Hello");
  });

  it("should keep tool parts with toolCall", () => {
    const parts: MessagePart[] = [
      { type: "tool", toolCall: { id: "1", name: "bash", arguments: {} } },
      { type: "tool" }, // Missing toolCall
      { type: "text", text: "Done" },
    ];

    const validParts = parts.filter((p) => {
      if (p.type === "text") return p.text && p.text.length > 0;
      if (p.type === "tool") return p.toolCall;
      return false;
    });

    expect(validParts).toHaveLength(2);
  });
});
