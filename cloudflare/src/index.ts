/**
 * Cloudflare Worker Entry Point
 *
 * This worker handles HTTP routing and WebSocket upgrades for the coding agent API.
 * Authentication is handled via API tokens validated against Convex.
 */

import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Env, CreateSessionRequest, PromptRequest, SessionResponse, AuthContext } from "./types";
import { SessionAgent } from "./agent";

// Export the Durable Object classes
export { SessionAgent };

// Extend Hono context with auth
type Variables = {
  auth: AuthContext;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Dynamic CORS middleware using environment variable
app.use("*", async (c, next) => {
  const allowedOrigins = c.env.ALLOWED_ORIGINS?.split(",").map(o => o.trim()) || [];
  const origin = c.req.header("Origin") || "";

  // Check if origin is allowed
  const isAllowed = allowedOrigins.includes(origin) || allowedOrigins.includes("*");

  // Set CORS headers
  if (isAllowed) {
    c.header("Access-Control-Allow-Origin", origin);
  }
  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Sec-WebSocket-Protocol");
  c.header("Access-Control-Max-Age", "86400");

  // Handle preflight
  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }

  return next();
});

// Health check endpoint
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: Date.now() });
});

/**
 * Simple in-memory rate limiter
 * Note: This is per-Worker-instance. For distributed rate limiting,
 * use Cloudflare's Rate Limiting product or Durable Objects.
 */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per minute per user

function checkRateLimit(userId: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const key = userId;
  const record = rateLimitMap.get(key);

  if (!record || now > record.resetAt) {
    // New window
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0, resetAt: record.resetAt };
  }

  record.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - record.count, resetAt: record.resetAt };
}

/**
 * Auth middleware - validates API token with Convex
 */
async function authMiddleware(c: any, next: () => Promise<void>) {
  // Skip auth for health check
  if (c.req.path === "/health") return next();

  // Get token from Authorization header or WebSocket subprotocol
  let token: string | null = null;

  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  }

  // For WebSocket, check Sec-WebSocket-Protocol header
  const wsProtocol = c.req.header("Sec-WebSocket-Protocol");
  if (wsProtocol && !token) {
    // Format: "bearer, <token>"
    const parts = wsProtocol.split(", ");
    if (parts.length >= 2 && parts[0] === "bearer") {
      token = parts[1];
    }
  }

  if (!token) {
    return c.json({ error: "Unauthorized - missing token" }, 401);
  }

  // Validate token with Convex
  try {
    const response = await fetch(`${c.env.CONVEX_SITE_URL}/api/validate-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      return c.json({ error: "Invalid or expired token" }, 401);
    }

    const { userId, sessionId } = await response.json() as { userId: string; sessionId: string };

    // Check rate limit
    const rateLimit = checkRateLimit(userId);
    c.header("X-RateLimit-Limit", String(RATE_LIMIT_MAX_REQUESTS));
    c.header("X-RateLimit-Remaining", String(rateLimit.remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(rateLimit.resetAt / 1000)));

    if (!rateLimit.allowed) {
      return c.json({ error: "Rate limit exceeded. Please try again later." }, 429);
    }

    // Store auth context
    c.set("auth", { userId, sessionId, apiToken: token });
  } catch (error) {
    return c.json({ error: "Authentication failed" }, 500);
  }

  return next();
}

// Apply auth middleware to session routes
app.use("/sessions/*", authMiddleware);

/**
 * Create/initialize a new session
 * POST /sessions
 * Session ID comes from Convex (already created there)
 */
app.post("/sessions", async (c) => {
  const body = await c.req.json<CreateSessionRequest>();
  const auth = c.get("auth");

  if (!body.sessionId || !body.repo) {
    return c.json({ error: "Missing sessionId or repo" }, 400);
  }

  // Verify the sessionId matches the token's sessionId
  if (body.sessionId !== auth.sessionId) {
    return c.json({ error: "Session ID mismatch" }, 403);
  }

  // Get Durable Object stub
  const id = c.env.SESSION_AGENT.idFromName(body.sessionId);
  const stub = c.env.SESSION_AGENT.get(id);

  // Initialize the session with auth context
  const response = await stub.fetch(
    new Request("http://internal/initialize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: body.sessionId,
        repo: body.repo,
        userId: auth.userId,
        apiToken: auth.apiToken,
        convexSiteUrl: c.env.CONVEX_SITE_URL,
      }),
    })
  );

  const state = await response.json();

  return c.json(state as SessionResponse);
});

/**
 * Get session state
 * GET /sessions/:id
 */
app.get("/sessions/:id", async (c) => {
  const sessionId = c.req.param("id");
  const auth = c.get("auth");

  // Verify the user has access to this session
  if (sessionId !== auth.sessionId) {
    return c.json({ error: "Unauthorized - session mismatch" }, 403);
  }

  const id = c.env.SESSION_AGENT.idFromName(sessionId);
  const stub = c.env.SESSION_AGENT.get(id);

  const response = await stub.fetch(new Request("http://internal/state"));
  const state = await response.json();

  return c.json(state as SessionResponse);
});

/**
 * Send a prompt to the session
 * POST /sessions/:id/prompt
 */
app.post("/sessions/:id/prompt", async (c) => {
  const sessionId = c.req.param("id");
  const auth = c.get("auth");
  const body = await c.req.json<PromptRequest>();

  if (sessionId !== auth.sessionId) {
    return c.json({ error: "Unauthorized - session mismatch" }, 403);
  }

  if (!body.text) {
    return c.json({ error: "Missing text" }, 400);
  }

  const id = c.env.SESSION_AGENT.idFromName(sessionId);
  const stub = c.env.SESSION_AGENT.get(id);

  const response = await stub.fetch(
    new Request("http://internal/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );

  if (!response.ok) {
    const error = await response.text();
    return c.json({ error }, response.status as ContentfulStatusCode);
  }

  return c.json({ success: true });
});

/**
 * Pause a session
 * POST /sessions/:id/pause
 */
app.post("/sessions/:id/pause", async (c) => {
  const sessionId = c.req.param("id");
  const auth = c.get("auth");

  if (sessionId !== auth.sessionId) {
    return c.json({ error: "Unauthorized - session mismatch" }, 403);
  }

  const id = c.env.SESSION_AGENT.idFromName(sessionId);
  const stub = c.env.SESSION_AGENT.get(id);

  const response = await stub.fetch(new Request("http://internal/pause", { method: "POST" }));

  if (!response.ok) {
    const error = await response.text();
    return c.json({ error }, response.status as ContentfulStatusCode);
  }

  const state = await response.json();
  return c.json(state as SessionResponse);
});

/**
 * Resume a session
 * POST /sessions/:id/resume
 */
app.post("/sessions/:id/resume", async (c) => {
  const sessionId = c.req.param("id");
  const auth = c.get("auth");

  if (sessionId !== auth.sessionId) {
    return c.json({ error: "Unauthorized - session mismatch" }, 403);
  }

  const id = c.env.SESSION_AGENT.idFromName(sessionId);
  const stub = c.env.SESSION_AGENT.get(id);

  const response = await stub.fetch(new Request("http://internal/resume", { method: "POST" }));

  if (!response.ok) {
    const error = await response.text();
    return c.json({ error }, response.status as ContentfulStatusCode);
  }

  const state = await response.json();
  return c.json(state as SessionResponse);
});

/**
 * Stop a session
 * DELETE /sessions/:id
 */
app.delete("/sessions/:id", async (c) => {
  const sessionId = c.req.param("id");
  const auth = c.get("auth");

  if (sessionId !== auth.sessionId) {
    return c.json({ error: "Unauthorized - session mismatch" }, 403);
  }

  // Stop the session (terminates sandbox)
  const id = c.env.SESSION_AGENT.idFromName(sessionId);
  const stub = c.env.SESSION_AGENT.get(id);
  await stub.fetch(new Request("http://internal/stop", { method: "POST" }));

  return c.json({ success: true });
});

/**
 * WebSocket upgrade for real-time session updates
 * GET /sessions/:id/ws
 */
app.get("/sessions/:id/ws", async (c) => {
  const sessionId = c.req.param("id");
  const auth = c.get("auth");
  const upgradeHeader = c.req.header("Upgrade");

  if (upgradeHeader !== "websocket") {
    return c.json({ error: "Expected WebSocket upgrade" }, 426);
  }

  if (sessionId !== auth.sessionId) {
    return c.json({ error: "Unauthorized - session mismatch" }, 403);
  }

  const id = c.env.SESSION_AGENT.idFromName(sessionId);
  const stub = c.env.SESSION_AGENT.get(id);

  // Forward the WebSocket upgrade to the Durable Object
  // Include the auth context for the DO
  const headers = new Headers(c.req.raw.headers);
  headers.set("X-User-Id", auth.userId);
  headers.set("X-Api-Token", auth.apiToken);

  const request = new Request(c.req.raw.url, {
    method: c.req.raw.method,
    headers,
  });

  return stub.fetch(request);
});

export default app;
