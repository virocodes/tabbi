/**
 * SessionAgent - Durable Object for managing coding sessions
 *
 * This agent handles:
 * - Session state management with SQLite persistence
 * - Modal sandbox lifecycle (create, pause, resume, terminate)
 * - OpenCode server communication
 * - WebSocket connections for real-time updates
 * - Auto-pause via alarms before Modal sandbox timeout
 * - Convex integration for auth, session status, and message syncing
 */

// Auto-pause timeout: 9 minutes (before Modal's 10 minute timeout)
const AUTO_PAUSE_TIMEOUT_MS = 9 * 60 * 1000;

// Timeout for external API calls (30 seconds)
const EXTERNAL_API_TIMEOUT_MS = 30 * 1000;

// Timeout for Modal sandbox creation (2 minutes - cloning repos can take time)
const SANDBOX_CREATE_TIMEOUT_MS = 2 * 60 * 1000;

import type {
  Env,
  SessionState,
  Message,
  MessagePart,
  OpenCodePart,
  TrackedPart,
} from "./types";

// Initialize request now includes auth context
interface InitializeRequest {
  sessionId: string;
  repo: string;
  userId: string;
  apiToken: string;
  convexSiteUrl: string;
}

export class SessionAgent implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private sessionState: SessionState;

  // Convex integration - stored after initialization
  private convexSiteUrl: string | null = null;
  private apiToken: string | null = null;

  /**
   * Dev-only logging helpers - only log when DEV_MODE is enabled
   */
  private log(...args: unknown[]): void {
    if (this.env.DEV_MODE === "true") {
      console.log(...args);
    }
  }

  private logError(...args: unknown[]): void {
    if (this.env.DEV_MODE === "true") {
      console.error(...args);
    }
  }

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.sessionState = {
      sessionId: "",
      repo: "",
      sandboxId: null,
      sandboxUrl: null,
      snapshotId: null,
      opencodeSessionId: null,
      status: "idle",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Load state from storage
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<SessionState>("session");
      if (stored) {
        this.sessionState = stored;
      }
      // Load Convex config
      const convexUrl = await this.state.storage.get<string>("convexSiteUrl");
      const token = await this.state.storage.get<string>("apiToken");
      if (convexUrl) this.convexSiteUrl = convexUrl;
      if (token) this.apiToken = token;
    });
  }

  /**
   * Build Modal endpoint URL from function name
   * Uses .modal.run for production (modal deploy)
   * Uses -dev.modal.run for development (modal serve)
   */
  private getModalUrl(functionName: string): string {
    const suffix = this.env.MODAL_ENV === "production" ? ".modal.run" : "-dev.modal.run";
    return `${this.env.MODAL_API_URL}-${functionName}${suffix}`;
  }

  /**
   * Build headers for Modal API requests (includes auth if configured)
   */
  private getModalHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.env.MODAL_API_SECRET) {
      headers["Authorization"] = `Bearer ${this.env.MODAL_API_SECRET}`;
    }
    return headers;
  }

  /**
   * Fetch GitHub token from Convex (with auto-refresh)
   */
  private async fetchGitHubToken(): Promise<string> {
    if (!this.convexSiteUrl || !this.apiToken) {
      throw new Error("Convex not configured - missing convexSiteUrl or apiToken");
    }

    const response = await fetch(`${this.convexSiteUrl}/api/github-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiToken}`,
      },
      signal: AbortSignal.timeout(EXTERNAL_API_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch GitHub token: ${error}`);
    }

    const { accessToken } = await response.json() as { accessToken: string };
    return accessToken;
  }

  /**
   * Update session status in Convex
   */
  private async updateConvexStatus(): Promise<void> {
    if (!this.convexSiteUrl || !this.apiToken) {
      this.log("Skipping Convex status update - not configured");
      return;
    }

    try {
      const response = await fetch(`${this.convexSiteUrl}/api/session-status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify({
          sessionId: this.sessionState.sessionId,
          status: this.sessionState.status,
          isProcessing: this.sessionState.isProcessing || false,
          snapshotId: this.sessionState.snapshotId,
          errorMessage: this.sessionState.error,
        }),
        signal: AbortSignal.timeout(EXTERNAL_API_TIMEOUT_MS),
      });

      if (!response.ok) {
        this.logError("Failed to update Convex status:", await response.text());
      }
    } catch (err) {
      this.logError("Error updating Convex status:", err);
    }
  }

  /**
   * Sync a message to Convex
   */
  private async syncMessageToConvex(message: Message): Promise<void> {
    if (!this.convexSiteUrl || !this.apiToken) {
      this.log("Skipping Convex message sync - not configured");
      return;
    }

    try {
      const response = await fetch(`${this.convexSiteUrl}/api/sync-message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify({
          sessionId: this.sessionState.sessionId,
          messageId: message.id,
          role: message.role,
          parts: message.parts,
          timestamp: message.timestamp,
        }),
        signal: AbortSignal.timeout(EXTERNAL_API_TIMEOUT_MS),
      });

      if (!response.ok) {
        this.logError("Failed to sync message to Convex:", await response.text());
      }
    } catch (err) {
      this.logError("Error syncing message to Convex:", err);
    }
  }

  /**
   * Get session state for clients (with streamingMessage merged into messages)
   */
  private getStateForClient(): SessionState {
    if (this.sessionState.streamingMessage) {
      return {
        ...this.sessionState,
        messages: [...this.sessionState.messages, this.sessionState.streamingMessage],
      };
    }
    return this.sessionState;
  }

  /**
   * Save state to storage and broadcast to WebSocket clients
   */
  private async saveAndBroadcast(): Promise<void> {
    await this.state.storage.put("session", this.sessionState);
    this.broadcast({
      type: "state",
      payload: this.getStateForClient(),
    });
  }

  /**
   * Broadcast a message to all connected WebSocket clients
   */
  private broadcast(message: object): void {
    const data = JSON.stringify(message);
    const webSockets = this.state.getWebSockets();
    this.log("Broadcasting to", webSockets.length, "connections");
    for (const ws of webSockets) {
      try {
        this.log("Sending to WebSocket, readyState:", ws.readyState);
        ws.send(data);
      } catch (err) {
        this.logError("Failed to send to WebSocket:", err);
      }
    }
  }

  /**
   * Handle HTTP requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      this.state.acceptWebSocket(server);

      // Send current state (with streamingMessage merged into messages)
      server.send(JSON.stringify({
        type: "state",
        payload: this.getStateForClient(),
      }));

      // If session shows "running", verify sandbox is still alive in the background
      // and send updated state if it's dead
      if (this.sessionState.status === "running" && this.sessionState.sandboxUrl) {
        this.verifySandboxHealthOnConnect();
      }

      // Accept the "bearer" subprotocol that the client sends
      const protocol = request.headers.get("Sec-WebSocket-Protocol");
      const headers: HeadersInit = {};
      if (protocol) {
        // Client sends "bearer, <token>" - we accept "bearer"
        headers["Sec-WebSocket-Protocol"] = "bearer";
      }

      return new Response(null, { status: 101, webSocket: client, headers });
    }

    // HTTP endpoints
    if (path === "/initialize" && request.method === "POST") {
      const body = await request.json() as InitializeRequest;
      const result = await this.initialize(body);
      return Response.json(result);
    }

    if (path === "/state" && request.method === "GET") {
      return Response.json(this.getStateForClient());
    }

    if (path === "/prompt" && request.method === "POST") {
      const body = await request.json() as { text: string };
      try {
        await this.handlePrompt(body.text);
        return Response.json({ success: true });
      } catch (error) {
        return Response.json({ error: String(error) }, { status: 400 });
      }
    }

    if (path === "/pause" && request.method === "POST") {
      try {
        await this.handlePause();
        return Response.json(this.sessionState);
      } catch (error) {
        return Response.json({ error: String(error) }, { status: 400 });
      }
    }

    if (path === "/resume" && request.method === "POST") {
      try {
        await this.handleResume();
        return Response.json(this.sessionState);
      } catch (error) {
        return Response.json({ error: String(error) }, { status: 400 });
      }
    }

    if (path === "/stop" && request.method === "POST") {
      await this.handleStop();
      return Response.json({ success: true });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  }

  /**
   * Handle WebSocket messages
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    this.log("WebSocket message received:", message);
    try {
      const msgString = typeof message === "string" ? message : new TextDecoder().decode(message);
      const data = JSON.parse(msgString);
      this.log("Parsed message:", data);

      switch (data.type) {
        case "prompt":
          this.log("Handling prompt:", data.text);
          await this.handlePrompt(data.text);
          break;
        case "pause":
          await this.handlePause();
          break;
        case "resume":
          await this.handleResume();
          break;
        case "stop":
          await this.handleStop();
          break;
        default:
          ws.send(JSON.stringify({
            type: "error",
            payload: { message: `Unknown message type: ${data.type}` },
          }));
      }
    } catch (error) {
      ws.send(JSON.stringify({
        type: "error",
        payload: { message: String(error) },
      }));
    }
  }

  /**
   * Handle WebSocket close
   */
  async webSocketClose(ws: WebSocket): Promise<void> {
    this.log("WebSocket closed");
  }

  /**
   * Handle Durable Object alarm - auto-pause before Modal timeout
   */
  async alarm(): Promise<void> {
    this.log("Alarm triggered - checking if auto-pause needed");

    // Only auto-pause if sandbox is running
    if (this.sessionState.status === "running" && this.sessionState.sandboxId) {
      this.log("Auto-pausing sandbox before timeout...");
      try {
        await this.handlePause();
        this.log("Auto-pause successful");
      } catch (error) {
        this.logError("Auto-pause failed:", error);
        // If pause fails, the sandbox may timeout anyway - nothing we can do
      }
    } else {
      this.log("Skipping auto-pause - status:", this.sessionState.status);
    }
  }

  /**
   * Schedule auto-pause alarm (resets any existing alarm)
   */
  private async scheduleAutoPause(): Promise<void> {
    if (this.sessionState.status === "running") {
      const alarmTime = Date.now() + AUTO_PAUSE_TIMEOUT_MS;
      await this.state.storage.setAlarm(alarmTime);
      this.log("Auto-pause alarm scheduled for", new Date(alarmTime).toISOString());
    }
  }

  /**
   * Cancel auto-pause alarm
   */
  private async cancelAutoPause(): Promise<void> {
    await this.state.storage.deleteAlarm();
    this.log("Auto-pause alarm cancelled");
  }

  /**
   * Initialize a new session with a repository
   * Returns immediately with "starting" status, creates sandbox in background
   */
  async initialize(request: InitializeRequest): Promise<SessionState> {
    // Store Convex config for this session
    this.convexSiteUrl = request.convexSiteUrl;
    this.apiToken = request.apiToken;
    await this.state.storage.put("convexSiteUrl", request.convexSiteUrl);
    await this.state.storage.put("apiToken", request.apiToken);

    // Use the sessionId passed from the worker (matches DO name)
    this.sessionState = {
      ...this.sessionState,
      sessionId: request.sessionId,
      repo: request.repo,
      userId: request.userId,
      status: "starting",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this.saveAndBroadcast();
    await this.updateConvexStatus();

    // Start sandbox creation in background (fire-and-forget)
    // The client will get status updates via WebSocket
    this.createSandboxInBackground(request);

    // Return immediately so client can connect via WebSocket
    return this.sessionState;
  }

  /**
   * Create sandbox in background - updates state via saveAndBroadcast
   */
  private async createSandboxInBackground(request: InitializeRequest): Promise<void> {
    try {
      // Fetch GitHub token from Convex (with auto-refresh)
      this.log("Fetching GitHub token from Convex...");
      const gitHubToken = await this.fetchGitHubToken();

      // Call Modal API to create sandbox (longer timeout for repo cloning)
      const response = await fetch(this.getModalUrl("api-create-sandbox"), {
        method: "POST",
        headers: this.getModalHeaders(),
        body: JSON.stringify({
          repo: request.repo,
          pat: gitHubToken,  // Use GitHub token fetched from Convex
        }),
        signal: AbortSignal.timeout(SANDBOX_CREATE_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`Modal API error: ${response.statusText}`);
      }

      const result = (await response.json()) as {
        sandbox_id?: string;
        tunnel_url?: string;
        error?: string;
      };

      if (result.error) {
        throw new Error(result.error);
      }

      this.sessionState = {
        ...this.sessionState,
        sandboxId: result.sandbox_id!,
        sandboxUrl: result.tunnel_url!,
        updatedAt: Date.now(),
      };

      // Wait for OpenCode server to be ready and create session
      this.log("Waiting for OpenCode server to be ready...");
      await this.waitForOpenCode(result.tunnel_url!);

      this.log("Creating OpenCode session...");
      const opencodeSessionId = await this.createOpenCodeSession(result.tunnel_url!);

      this.sessionState = {
        ...this.sessionState,
        opencodeSessionId,
        status: "running",
        updatedAt: Date.now(),
      };

      await this.saveAndBroadcast();
      await this.updateConvexStatus();
      await this.scheduleAutoPause();
    } catch (error) {
      this.logError("Sandbox creation failed:", error);
      this.sessionState = {
        ...this.sessionState,
        status: "error",
        error: String(error),
        updatedAt: Date.now(),
      };

      await this.saveAndBroadcast();
      await this.updateConvexStatus();
    }
  }

  /**
   * Wait for OpenCode server to be ready
   */
  private async waitForOpenCode(sandboxUrl: string, maxAttempts = 30): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        this.log(`Checking OpenCode health (attempt ${i + 1}/${maxAttempts})...`);
        const response = await fetch(`${sandboxUrl}/global/health`, {
          method: "GET",
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          this.log("OpenCode server is ready!");
          return;
        }
        this.log(`Health check returned ${response.status}, retrying...`);
      } catch (err) {
        this.log(`Health check failed: ${err}, retrying...`);
      }

      // Wait 2 seconds before next attempt
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    throw new Error("OpenCode server failed to start after " + maxAttempts + " attempts");
  }

  /**
   * Quick health check to verify sandbox is still alive
   * Returns true if healthy, false if unreachable/dead
   */
  private async checkSandboxHealth(): Promise<boolean> {
    if (!this.sessionState.sandboxUrl) {
      return false;
    }

    try {
      const response = await fetch(`${this.sessionState.sandboxUrl}/global/health`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Verify sandbox health when a client connects
   * Updates status and broadcasts if sandbox is dead
   * Called asynchronously to not block WebSocket connection
   */
  private async verifySandboxHealthOnConnect(): Promise<void> {
    this.log("Verifying sandbox health on connect...");

    const isHealthy = await this.checkSandboxHealth();

    if (!isHealthy) {
      this.log("Sandbox dead on connect - updating status");

      // Determine new status based on whether we have a snapshot
      const newStatus = this.sessionState.snapshotId ? "paused" : "idle";

      this.sessionState = {
        ...this.sessionState,
        status: newStatus,
        sandboxId: null,
        sandboxUrl: null,
        opencodeSessionId: null,
        updatedAt: Date.now(),
      };

      await this.saveAndBroadcast();
      await this.updateConvexStatus();

      this.log(`Session status updated to '${newStatus}' due to dead sandbox`);
    } else {
      this.log("Sandbox is healthy");
    }
  }

  /**
   * Create a session on the OpenCode server
   */
  private async createOpenCodeSession(sandboxUrl: string): Promise<string> {
    const response = await fetch(`${sandboxUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to create OpenCode session: ${response.status} ${errText}`);
    }

    const data = await response.json() as { id: string };
    this.log("OpenCode session created:", data.id);
    return data.id;
  }

  /**
   * Send a prompt to the OpenCode server with real-time streaming
   * Auto-resumes from snapshot if session is paused or stopped
   */
  async handlePrompt(text: string): Promise<void> {
    this.log("handlePrompt called, status:", this.sessionState.status, "sandboxUrl:", this.sessionState.sandboxUrl);

    // Add user message to state FIRST (before any resume) so it's included in all broadcasts
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text }],
      timestamp: Date.now(),
    };

    this.sessionState = {
      ...this.sessionState,
      messages: [...this.sessionState.messages, userMessage],
      isProcessing: true,
      updatedAt: Date.now(),
    };
    await this.saveAndBroadcast();
    // Sync user message to Convex immediately
    await this.syncMessageToConvex(userMessage);

    // Check if we need to resume or verify sandbox is alive
    if (this.sessionState.status === "running") {
      // Status says running - verify the sandbox is actually alive
      this.log("Verifying sandbox health...");
      const isHealthy = await this.checkSandboxHealth();

      if (!isHealthy) {
        this.log("Sandbox is dead but status was 'running'. Attempting recovery...");

        if (this.sessionState.snapshotId) {
          // We have a snapshot - mark as paused and auto-resume
          this.log("Auto-resuming from snapshot after detecting dead sandbox");
          this.sessionState = {
            ...this.sessionState,
            status: "paused",
            sandboxId: null,
            sandboxUrl: null,
            opencodeSessionId: null,
            updatedAt: Date.now(),
          };
          await this.saveAndBroadcast();
          await this.updateConvexStatus();
          await this.handleResumeInternal();
        } else {
          // No snapshot - mark as idle with error
          this.sessionState = {
            ...this.sessionState,
            status: "idle",
            sandboxId: null,
            sandboxUrl: null,
            opencodeSessionId: null,
            error: "Sandbox timed out and no snapshot available",
            updatedAt: Date.now(),
          };
          await this.saveAndBroadcast();
          await this.updateConvexStatus();
          throw new Error("Sandbox has timed out. Please start a new session.");
        }
      }
    } else if (this.sessionState.status === "paused" || this.sessionState.status === "idle") {
      // Session is paused/idle - try to resume from snapshot
      if (this.sessionState.snapshotId) {
        this.log("Auto-resuming session from snapshot:", this.sessionState.snapshotId);
        await this.handleResumeInternal();
      } else {
        throw new Error("Session is not running and has no snapshot to resume from");
      }
    } else if (this.sessionState.status === "starting") {
      throw new Error("Session is still starting, please wait");
    } else {
      throw new Error("Session is not running and has no snapshot to resume from");
    }

    if (!this.sessionState.sandboxUrl) {
      throw new Error("Sandbox URL not available");
    }

    // Update Convex status now that we're running
    await this.updateConvexStatus();

    try {
      if (!this.sessionState.opencodeSessionId) {
        throw new Error("OpenCode session not initialized");
      }

      // Create a placeholder assistant message that we'll update with streaming content
      const assistantMessageId = crypto.randomUUID();

      // Store the user's prompt text for echo detection
      const userPromptText = text.trim();

      // Track parts by their unique ID from OpenCode
      // Key: part.id (or generated ID), Value: TrackedPart with ordering metadata
      const partsTracker = new Map<string, TrackedPart>();

      // Track the current text part ID for streaming updates without explicit IDs
      let currentTextPartId: string | null = null;

      // Save streaming progress every 2 seconds (throttled)
      let lastSaveTime = 0;
      const SAVE_INTERVAL_MS = 2000;

      const saveStreamingProgress = async () => {
        const now = Date.now();
        if (now - lastSaveTime < SAVE_INTERVAL_MS) return;
        lastSaveTime = now;

        const streamingParts = getPartsInOrder();
        if (streamingParts.length > 0) {
          this.sessionState = {
            ...this.sessionState,
            streamingMessage: {
              id: assistantMessageId,
              role: "assistant",
              parts: streamingParts,
              timestamp: Date.now(),
            },
            updatedAt: Date.now(),
          };
          await this.state.storage.put("session", this.sessionState);
        }
      };

      // Helper to check if a part is a tool call (OpenCode uses various type names)
      const isToolPart = (part: OpenCodePart): boolean => {
        const toolTypes = ["tool", "tool-call", "tool_call", "tool-invocation", "tool_use"];
        return toolTypes.includes(part?.type);
      };

      // Helper to extract tool call info from a part
      const extractToolCall = (part: OpenCodePart): { id: string; name: string; arguments: Record<string, unknown>; result?: string; state: 'pending' | 'running' | 'completed' | 'error' } => {
        const rawState = part.state?.status || part.status || "running";
        // Map OpenCode state to our ToolCall state type
        const stateMap: Record<string, 'pending' | 'running' | 'completed' | 'error'> = {
          'pending': 'pending',
          'running': 'running',
          'completed': 'completed',
          'error': 'error',
          'success': 'completed',
          'failed': 'error',
        };
        return {
          id: part.id || part.callID || part.toolCallId || crypto.randomUUID(),
          name: part.tool || part.name || part.toolName || "unknown",
          arguments: part.state?.input || part.input || part.arguments || {},
          result: part.state?.output || part.output || part.result,
          state: stateMap[rawState] || 'running',
        };
      };

      // Helper to check if text is just the user's prompt (echo detection)
      const isUserPromptEcho = (responseText: string): boolean => {
        const trimmed = responseText.trim();
        return trimmed === userPromptText;
      };

      // Get parts in chronological order based on firstSeenAt timestamp
      const getPartsInOrder = (): MessagePart[] => {
        return Array.from(partsTracker.values())
          .sort((a, b) => a.firstSeenAt - b.firstSeenAt)
          .map(t => t.part)
          .filter(p => {
            if (p.type === "text") return p.text && p.text.length > 0;
            if (p.type === "tool") return p.toolCall;
            return false;
          });
      };

      // Start SSE subscription for real-time events
      this.log("Subscribing to SSE events...");
      const eventController = new AbortController();
      let sessionIdleReceived = false;
      let sseConnected = false;
      let idleResolver: (() => void) | null = null;
      let connectedResolver: (() => void) | null = null;

      const idlePromise = new Promise<void>((resolve) => {
        idleResolver = resolve;
      });
      const connectedPromise = new Promise<void>((resolve) => {
        connectedResolver = resolve;
      });

      const eventPromise = this.subscribeToEvents(eventController.signal, (event) => {
        // Track when SSE is connected
        if (event.type === "server.connected" && !sseConnected) {
          this.log("SSE connected to OpenCode server");
          sseConnected = true;
          if (connectedResolver) connectedResolver();
        }
        // Forward events to WebSocket clients
        this.broadcast({
          type: "event",
          payload: event,
        });

        // Check for session.idle event to know when AI is done
        if (event.type === "session.idle") {
          this.log("Session idle received - AI finished responding");
          sessionIdleReceived = true;
          if (idleResolver) idleResolver();
        }

        // Update parts based on event type - using part ID for tracking
        if (event.type === "message.part.updated") {
          const part = event.properties?.part as OpenCodePart | undefined;
          if (!part) {
            this.log("Part updated event missing part, skipping");
            return;
          }

          const eventIndex = event.properties?.index;
          const messageId = part.messageID || "unknown";

          this.log("Part updated:", part.type, "eventIndex:", eventIndex, "part.id:", part.id, "messageId:", messageId);

          if (part.type === "text" && part.text !== undefined) {
            const textContent = part.text;

            // Skip if text is just the user's prompt echo
            if (isUserPromptEcho(textContent)) {
              this.log("Skipping text part - is user prompt echo");
              return;
            }

            // Skip empty text
            if (!textContent || textContent.trim().length === 0) {
              this.log("Skipping empty text part");
              return;
            }

            // Determine part ID for text:
            // 1. Use explicit part.id if provided
            // 2. Use index-based ID if index provided
            // 3. Use/reuse currentTextPartId for streaming updates
            let partId: string;
            if (part.id) {
              partId = part.id;
            } else if (typeof eventIndex === "number") {
              partId = `text-${eventIndex}`;
            } else if (currentTextPartId && partsTracker.has(currentTextPartId)) {
              // Reuse current text part ID for streaming updates
              partId = currentTextPartId;
            } else {
              // Generate new ID for new text part
              partId = `text-${Date.now()}`;
            }

            const existing = partsTracker.get(partId);
            if (existing) {
              // Update existing part (same ID = same part, just new content)
              existing.part = { type: "text", text: textContent };
              this.log("Updated existing text part:", partId);
            } else {
              // New part - add with timestamp for ordering
              partsTracker.set(partId, {
                partId,
                messageId,
                firstSeenAt: Date.now(),
                part: { type: "text", text: textContent },
              });
              this.log("Added new text part:", partId);
            }

            // Track this as the current text part for subsequent updates
            currentTextPartId = partId;

            this.broadcastStreamingParts(assistantMessageId, getPartsInOrder());
            saveStreamingProgress();

          } else if (isToolPart(part)) {
            // Tool parts reset the current text tracking (text after tool is new)
            currentTextPartId = null;

            const toolCall = extractToolCall(part);

            // For tool parts, use the tool's ID
            const partId = part.id || part.callID || part.toolCallId || toolCall.id ||
              (typeof eventIndex === "number" ? `tool-${eventIndex}` : `tool-${Date.now()}`);

            const existing = partsTracker.get(partId);
            if (existing) {
              // Update existing tool part
              existing.part = { type: "tool", toolCall };
              this.log("Updated existing tool part:", partId);
            } else {
              // New tool part
              partsTracker.set(partId, {
                partId,
                messageId,
                firstSeenAt: Date.now(),
                part: { type: "tool", toolCall },
              });
              this.log("Added new tool part:", partId);
            }

            this.broadcastStreamingParts(assistantMessageId, getPartsInOrder());
            saveStreamingProgress();
          }
        }
      });

      // Wait for SSE connection before sending prompt (with timeout)
      this.log("Waiting for SSE connection...");
      const connectedTimeout = new Promise<void>((resolve) => {
        setTimeout(() => {
          if (!sseConnected) {
            this.log("SSE connection timeout - proceeding anyway");
          }
          resolve();
        }, 3000);
      });
      await Promise.race([connectedPromise, connectedTimeout]);

      // Send prompt to OpenCode with agentic mode enabled
      this.log("Sending prompt to OpenCode session:", this.sessionState.opencodeSessionId);
      const requestBody = {
        agent: "build",  // Enable agentic mode with full tool access
        parts: [{ type: "text", text }],
      };
      this.log("Request body:", JSON.stringify(requestBody));

      const promptRes = await fetch(
        `${this.sessionState.sandboxUrl}/session/${this.sessionState.opencodeSessionId}/message`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        }
      );

      this.log("OpenCode prompt response status:", promptRes.status);

      if (!promptRes.ok) {
        const errText = await promptRes.text();
        throw new Error(`OpenCode error: ${promptRes.status} ${errText}`);
      }

      // Wait for session.idle event (with timeout of 5 minutes)
      this.log("Waiting for session.idle event...");
      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          this.log("Timeout waiting for session.idle after 5 minutes");
          resolve();
        }, 5 * 60 * 1000);
      });

      await Promise.race([idlePromise, timeoutPromise]);
      this.log("Session processing complete, sessionIdleReceived:", sessionIdleReceived);

      // Give a small buffer for any final events
      await new Promise(resolve => setTimeout(resolve, 200));
      eventController.abort();

      // Fetch final messages to ensure we have everything
      const messagesRes = await fetch(
        `${this.sessionState.sandboxUrl}/session/${this.sessionState.opencodeSessionId}/message`
      );

      // Build final parts array from the LAST assistant message
      let finalParts: MessagePart[] = [];

      if (messagesRes.ok) {
        const allMessages = await messagesRes.json() as Array<{
          info: { id: string; role: string };
          parts: Array<OpenCodePart>;
        }>;

        this.log("Fetched messages count:", allMessages.length);
        const assistantMessages = allMessages.filter(m => m.info.role === "assistant");
        const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];

        if (lastAssistantMessage) {
          this.log("Last assistant message parts:", lastAssistantMessage.parts?.length);

          // Process parts in order - the API returns them in correct order
          for (const part of lastAssistantMessage.parts) {
            this.log("Processing part type:", part.type);

            if (part.type === "text" && part.text) {
              // Skip if text is just the user's prompt echo
              if (!isUserPromptEcho(part.text) && part.text.trim().length > 0) {
                finalParts.push({ type: "text", text: part.text });
              }
            } else if (isToolPart(part)) {
              finalParts.push({ type: "tool", toolCall: extractToolCall(part) });
            }
          }
        }
      }

      // Get streaming parts
      const streamingParts = getPartsInOrder();

      // Compare streaming parts vs final fetch
      const streamingToolCount = streamingParts.filter(p => p.type === "tool").length;
      const finalToolCount = finalParts.filter(p => p.type === "tool").length;
      const streamingTextLen = streamingParts.filter(p => p.type === "text").reduce((sum, p) => sum + (p.text?.length || 0), 0);
      const finalTextLen = finalParts.filter(p => p.type === "text").reduce((sum, p) => sum + (p.text?.length || 0), 0);
      this.log("Streaming - tools:", streamingToolCount, "textLen:", streamingTextLen);
      this.log("Final - tools:", finalToolCount, "textLen:", finalTextLen);

      // Prefer final fetch as it has the correct structure from OpenCode
      // Only use streaming if final fetch failed or has no tools while streaming does
      if (finalParts.length === 0 || (finalToolCount === 0 && streamingToolCount > 0)) {
        this.log("Using streaming parts (final fetch incomplete)");
        finalParts = streamingParts;
      } else {
        this.log("Using final fetch parts (authoritative structure)");
      }

      this.log("Final parts count:", finalParts.length);

      // Add final assistant message to state and clear isProcessing
      const assistantMessage: Message = {
        id: assistantMessageId,
        role: "assistant",
        parts: finalParts,
        timestamp: Date.now(),
      };

      this.sessionState = {
        ...this.sessionState,
        messages: [...this.sessionState.messages, assistantMessage],
        streamingMessage: undefined,  // Clear - now saved in messages
        isProcessing: false,
        updatedAt: Date.now(),
      };
      this.log("Broadcasting final state with", this.sessionState.messages.length, "messages");
      await this.saveAndBroadcast();
      await this.updateConvexStatus();
      // Sync assistant message to Convex after completion
      await this.syncMessageToConvex(assistantMessage);

      // Reset auto-pause timer after activity
      await this.scheduleAutoPause();

    } catch (error) {
      this.logError("OpenCode error:", error);

      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: "system",
        parts: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        timestamp: Date.now(),
      };

      this.sessionState = {
        ...this.sessionState,
        messages: [...this.sessionState.messages, errorMessage],
        streamingMessage: undefined,  // Clear on error
        isProcessing: false,
        updatedAt: Date.now(),
      };
      await this.saveAndBroadcast();
      await this.updateConvexStatus();
      // Sync error message to Convex
      await this.syncMessageToConvex(errorMessage);

      // Reset auto-pause timer even after errors (session still running)
      await this.scheduleAutoPause();
    }
  }

  /**
   * Subscribe to OpenCode SSE events
   */
  private async subscribeToEvents(
    signal: AbortSignal,
    onEvent: (event: { type: string; properties?: any }) => void
  ): Promise<void> {
    try {
      const response = await fetch(`${this.sessionState.sandboxUrl}/event`, {
        headers: { Accept: "text/event-stream" },
        signal,
      });

      if (!response.ok || !response.body) {
        this.logError("Failed to connect to SSE:", response.status);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              this.log("SSE event:", data.type);
              onEvent(data);
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        this.logError("SSE error:", error);
      }
    }
  }

  /**
   * Broadcast streaming parts for an in-progress message
   * Parts are already deduplicated by unique part ID from partsTracker
   */
  private broadcastStreamingParts(
    messageId: string,
    parts: MessagePart[]
  ): void {
    // Only broadcast if there's actual content to show
    if (parts.length === 0) {
      return;
    }

    this.broadcast({
      type: "streaming",
      payload: {
        messageId,
        parts,
      },
    });
  }

  /**
   * Pause the session by snapshotting the sandbox
   */
  async handlePause(): Promise<void> {
    if (this.sessionState.status !== "running" || !this.sessionState.sandboxId) {
      throw new Error("Session is not running");
    }

    // Cancel auto-pause alarm since we're manually pausing
    await this.cancelAutoPause();

    this.sessionState = {
      ...this.sessionState,
      status: "starting",
      updatedAt: Date.now(),
    };

    await this.saveAndBroadcast();

    try {
      const response = await fetch(this.getModalUrl("api-pause-sandbox"), {
        method: "POST",
        headers: this.getModalHeaders(),
        body: JSON.stringify({
          sandbox_id: this.sessionState.sandboxId,
        }),
        signal: AbortSignal.timeout(EXTERNAL_API_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`Modal API error: ${response.statusText}`);
      }

      const result = (await response.json()) as { snapshot_id?: string; error?: string };

      if (result.error) {
        throw new Error(result.error);
      }

      this.sessionState = {
        ...this.sessionState,
        snapshotId: result.snapshot_id!,
        sandboxId: null,
        sandboxUrl: null,
        status: "paused",
        updatedAt: Date.now(),
      };

      await this.saveAndBroadcast();
      await this.updateConvexStatus();
    } catch (error) {
      this.sessionState = {
        ...this.sessionState,
        status: "error",
        error: String(error),
        updatedAt: Date.now(),
      };

      await this.saveAndBroadcast();
      await this.updateConvexStatus();
    }
  }

  /**
   * Resume the session from a snapshot (public API - validates state)
   */
  async handleResume(): Promise<void> {
    if (this.sessionState.status !== "paused" || !this.sessionState.snapshotId) {
      throw new Error("Session is not paused");
    }

    await this.handleResumeInternal();
  }

  /**
   * Internal resume logic - called by handleResume and handlePrompt
   * Requires snapshotId to be set, but allows any non-running status
   */
  private async handleResumeInternal(): Promise<void> {
    if (!this.sessionState.snapshotId) {
      throw new Error("No snapshot available to resume from");
    }

    this.sessionState = {
      ...this.sessionState,
      status: "starting",
      updatedAt: Date.now(),
    };

    await this.saveAndBroadcast();
    await this.updateConvexStatus();

    try {
      // Resume creates a new sandbox, so use longer timeout
      const response = await fetch(this.getModalUrl("api-resume-sandbox"), {
        method: "POST",
        headers: this.getModalHeaders(),
        body: JSON.stringify({
          snapshot_id: this.sessionState.snapshotId,
        }),
        signal: AbortSignal.timeout(SANDBOX_CREATE_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`Modal API error: ${response.statusText}`);
      }

      const result = (await response.json()) as {
        sandbox_id?: string;
        tunnel_url?: string;
        error?: string;
      };

      if (result.error) {
        throw new Error(result.error);
      }

      this.sessionState = {
        ...this.sessionState,
        sandboxId: result.sandbox_id!,
        sandboxUrl: result.tunnel_url!,
        updatedAt: Date.now(),
      };

      // Wait for OpenCode server to be ready
      this.log("Waiting for OpenCode server after resume...");
      await this.waitForOpenCode(result.tunnel_url!);

      // Create a new OpenCode session after resume
      this.log("Creating new OpenCode session after resume...");
      const opencodeSessionId = await this.createOpenCodeSession(result.tunnel_url!);

      this.sessionState = {
        ...this.sessionState,
        opencodeSessionId,
        status: "running",
        updatedAt: Date.now(),
      };

      await this.saveAndBroadcast();
      await this.updateConvexStatus();
      await this.scheduleAutoPause();
    } catch (error) {
      this.sessionState = {
        ...this.sessionState,
        status: "error",
        error: String(error),
        updatedAt: Date.now(),
      };

      await this.saveAndBroadcast();
      await this.updateConvexStatus();
      throw error; // Re-throw so handlePrompt knows resume failed
    }
  }

  /**
   * Stop the session completely
   */
  async handleStop(): Promise<void> {
    // Cancel auto-pause alarm
    await this.cancelAutoPause();

    if (this.sessionState.sandboxId) {
      try {
        await fetch(this.getModalUrl("api-terminate-sandbox"), {
          method: "POST",
          headers: this.getModalHeaders(),
          body: JSON.stringify({
            sandbox_id: this.sessionState.sandboxId,
          }),
          signal: AbortSignal.timeout(EXTERNAL_API_TIMEOUT_MS),
        });
      } catch {
        // Ignore termination errors
      }
    }

    this.sessionState = {
      ...this.sessionState,
      sandboxId: null,
      sandboxUrl: null,
      opencodeSessionId: null,
      status: "idle",
      updatedAt: Date.now(),
    };

    await this.saveAndBroadcast();
    await this.updateConvexStatus();
  }
}
