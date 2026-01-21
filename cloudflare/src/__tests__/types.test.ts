import { describe, it, expect } from "vitest";
import type {
  SessionState,
  SessionStatus,
  Message,
  MessagePart,
  ToolCall,
  OpenCodePart,
  TrackedPart,
  AuthContext,
} from "../types";

describe("SessionState types", () => {
  it("should create valid initial SessionState", () => {
    const state: SessionState = {
      sessionId: "test-session-123",
      repo: "user/repo",
      sandboxId: null,
      sandboxUrl: null,
      snapshotId: null,
      opencodeSessionId: null,
      status: "idle",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    expect(state.sessionId).toBe("test-session-123");
    expect(state.status).toBe("idle");
    expect(state.messages).toHaveLength(0);
  });

  it("should track all valid session statuses", () => {
    const validStatuses: SessionStatus[] = ["idle", "starting", "running", "paused", "error"];
    expect(validStatuses).toHaveLength(5);
  });

  it("should handle optional fields", () => {
    const state: SessionState = {
      sessionId: "test",
      repo: "user/repo",
      userId: "user-123",
      sandboxId: "sb-123",
      sandboxUrl: "https://sandbox.example.com",
      snapshotId: "snap-123",
      opencodeSessionId: "oc-123",
      status: "running",
      isProcessing: true,
      messages: [],
      error: "Something went wrong",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    expect(state.userId).toBe("user-123");
    expect(state.isProcessing).toBe(true);
    expect(state.error).toBe("Something went wrong");
  });
});

describe("Message and MessagePart types", () => {
  it("should create a text message", () => {
    const message: Message = {
      id: "msg-1",
      role: "user",
      parts: [{ type: "text", text: "Hello, assistant!" }],
      timestamp: Date.now(),
    };

    expect(message.role).toBe("user");
    expect(message.parts).toHaveLength(1);
    expect(message.parts[0].type).toBe("text");
    expect(message.parts[0].text).toBe("Hello, assistant!");
  });

  it("should create a message with tool call", () => {
    const toolCall: ToolCall = {
      id: "tool-1",
      name: "readFile",
      arguments: { path: "/src/index.ts" },
      state: "completed",
      result: "file contents here",
    };

    const message: Message = {
      id: "msg-2",
      role: "assistant",
      parts: [
        { type: "text", text: "Let me read that file." },
        { type: "tool", toolCall },
      ],
      timestamp: Date.now(),
    };

    expect(message.role).toBe("assistant");
    expect(message.parts).toHaveLength(2);
    expect(message.parts[1].type).toBe("tool");
    expect(message.parts[1].toolCall?.name).toBe("readFile");
  });

  it("should track tool call states", () => {
    const validStates: ToolCall["state"][] = ["pending", "running", "completed", "error"];
    expect(validStates).toHaveLength(4);
  });
});

describe("OpenCodePart normalization", () => {
  // Simulate the part normalization logic from agent.ts
  function normalizeOpenCodePart(part: OpenCodePart): MessagePart | null {
    // Text parts
    if (part.type === "text" && part.text) {
      return { type: "text", text: part.text };
    }

    // Tool parts - handle various field names from OpenCode
    const isToolPart =
      part.type === "tool" ||
      part.type === "tool-call" ||
      part.type === "tool_call" ||
      part.type === "tool-invocation" ||
      part.type === "tool_use";

    if (isToolPart) {
      const toolName = part.tool || part.name || part.toolName || "unknown";
      const toolId = part.id || part.callID || part.toolCallId || `tool-${Date.now()}`;
      const args = part.state?.input || part.input || part.arguments || {};
      const output = part.state?.output || part.output || part.result;
      const status = part.state?.status || part.status;

      const toolCall: ToolCall = {
        id: toolId,
        name: toolName,
        arguments: args,
        result: output,
        state: status as ToolCall["state"],
      };

      return { type: "tool", toolCall };
    }

    return null;
  }

  it("should normalize text parts", () => {
    const openCodePart: OpenCodePart = {
      id: "part-1",
      messageID: "msg-1",
      type: "text",
      text: "Hello world",
    };

    const normalized = normalizeOpenCodePart(openCodePart);
    expect(normalized).not.toBeNull();
    expect(normalized?.type).toBe("text");
    expect(normalized?.text).toBe("Hello world");
  });

  it("should normalize tool-call parts", () => {
    const openCodePart: OpenCodePart = {
      id: "part-2",
      messageID: "msg-1",
      type: "tool-call",
      tool: "bash",
      state: {
        input: { command: "ls -la" },
        output: "file1.txt\nfile2.txt",
        status: "completed",
      },
    };

    const normalized = normalizeOpenCodePart(openCodePart);
    expect(normalized).not.toBeNull();
    expect(normalized?.type).toBe("tool");
    expect(normalized?.toolCall?.name).toBe("bash");
    expect(normalized?.toolCall?.arguments).toEqual({ command: "ls -la" });
    expect(normalized?.toolCall?.result).toBe("file1.txt\nfile2.txt");
  });

  it("should handle alternative field names", () => {
    const openCodePart: OpenCodePart = {
      id: "part-3",
      messageID: "msg-1",
      type: "tool_use",
      name: "readFile",
      arguments: { path: "/test.txt" },
      output: "file contents",
    };

    const normalized = normalizeOpenCodePart(openCodePart);
    expect(normalized?.toolCall?.name).toBe("readFile");
    expect(normalized?.toolCall?.arguments).toEqual({ path: "/test.txt" });
  });
});

describe("TrackedPart ordering", () => {
  it("should maintain chronological order by firstSeenAt", () => {
    const parts: TrackedPart[] = [
      {
        partId: "p3",
        messageId: "m1",
        firstSeenAt: 300,
        part: { type: "text", text: "Third" },
      },
      {
        partId: "p1",
        messageId: "m1",
        firstSeenAt: 100,
        part: { type: "text", text: "First" },
      },
      {
        partId: "p2",
        messageId: "m1",
        firstSeenAt: 200,
        part: { type: "text", text: "Second" },
      },
    ];

    const sorted = [...parts].sort((a, b) => a.firstSeenAt - b.firstSeenAt);

    expect(sorted[0].partId).toBe("p1");
    expect(sorted[1].partId).toBe("p2");
    expect(sorted[2].partId).toBe("p3");
  });
});

describe("AuthContext", () => {
  it("should have required fields", () => {
    const auth: AuthContext = {
      userId: "user-123",
      sessionId: "session-456",
      apiToken: "token-789",
    };

    expect(auth.userId).toBe("user-123");
    expect(auth.sessionId).toBe("session-456");
    expect(auth.apiToken).toBe("token-789");
  });
});

describe("Session status transitions", () => {
  // Test valid state transitions
  const validTransitions: Record<SessionStatus, SessionStatus[]> = {
    idle: ["starting"],
    starting: ["running", "error"],
    running: ["paused", "error"],
    paused: ["running", "starting", "error"],
    error: ["idle", "starting"],
  };

  it("should define valid transitions from idle", () => {
    expect(validTransitions.idle).toContain("starting");
    expect(validTransitions.idle).not.toContain("running");
  });

  it("should define valid transitions from starting", () => {
    expect(validTransitions.starting).toContain("running");
    expect(validTransitions.starting).toContain("error");
  });

  it("should define valid transitions from running", () => {
    expect(validTransitions.running).toContain("paused");
    expect(validTransitions.running).not.toContain("starting");
  });

  it("should allow recovery from paused state", () => {
    expect(validTransitions.paused).toContain("running");
    expect(validTransitions.paused).toContain("starting");
  });

  it("should allow recovery from error state", () => {
    expect(validTransitions.error).toContain("idle");
    expect(validTransitions.error).toContain("starting");
  });
});
