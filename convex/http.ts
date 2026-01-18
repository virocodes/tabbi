import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

// Add Better Auth HTTP routes with CORS enabled
authComponent.registerRoutes(http, createAuth, {
  cors: {
    allowedOrigins: [
      "http://localhost:3000",
      "http://localhost:5173",
      process.env.SITE_URL || "http://localhost:3000",
    ],
  },
});

// Validate API token endpoint (called by Cloudflare Worker)
http.route({
  path: "/api/validate-token",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { token } = body as { token: string };

      if (!token) {
        return new Response(JSON.stringify({ error: "Missing token" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const validation = await ctx.runQuery(internal.tokens.validateApiToken, {
        token,
      });

      if (!validation?.valid) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired token" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({
          userId: validation.authUserId,  // Cloudflare expects 'userId'
          sessionId: validation.sessionId,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }),
});

// Get GitHub token endpoint (called by Cloudflare Worker)
http.route({
  path: "/api/github-token",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      // Validate API token from Authorization header
      const authHeader = request.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const token = authHeader.slice(7);
      const validation = await ctx.runQuery(internal.tokens.validateApiToken, {
        token,
      });

      if (!validation?.valid) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired token" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Get GitHub token (from Better Auth accounts table)
      const accessToken = await ctx.runAction(internal.github.getValidToken, {
        authUserId: validation.authUserId,
      });

      return new Response(JSON.stringify({ accessToken }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      // Log the actual error server-side for debugging
      console.error("GitHub token fetch error:", error);
      // Return generic error to client to avoid leaking implementation details
      return new Response(JSON.stringify({ error: "Failed to retrieve GitHub token" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }),
});

// Update session status endpoint (called by Cloudflare Worker)
http.route({
  path: "/api/session-status",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      // Validate API token
      const authHeader = request.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const token = authHeader.slice(7);
      const validation = await ctx.runQuery(internal.tokens.validateApiToken, {
        token,
      });

      if (!validation?.valid) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired token" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const body = await request.json();
      const { sessionId, status, isProcessing, title, snapshotId, errorMessage } =
        body as {
          sessionId: string;
          status?: string;
          isProcessing?: boolean;
          title?: string;
          snapshotId?: string;
          errorMessage?: string;
        };

      // Verify sessionId matches token
      if (sessionId !== validation.sessionId) {
        return new Response(
          JSON.stringify({ error: "Session ID mismatch" }),
          {
            status: 403,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Convert null values to undefined (Convex doesn't accept null for optional fields)
      await ctx.runMutation(internal.sessions.updateSessionStatus, {
        sessionId,
        status: status as any,
        isProcessing: isProcessing ?? undefined,
        title: title ?? undefined,
        snapshotId: snapshotId ?? undefined,
        errorMessage: errorMessage ?? undefined,
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      // Log the actual error server-side for debugging
      console.error("Session status update error:", error);
      // Return generic error to client to avoid leaking implementation details
      return new Response(JSON.stringify({ error: "Failed to update session status" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }),
});

// Sync message endpoint (called by Cloudflare Worker)
http.route({
  path: "/api/sync-message",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      // Validate API token
      const authHeader = request.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const token = authHeader.slice(7);
      const validation = await ctx.runQuery(internal.tokens.validateApiToken, {
        token,
      });

      if (!validation?.valid) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired token" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const body = await request.json();
      const { sessionId, messageId, role, parts, timestamp } = body as {
        sessionId: string;
        messageId: string;
        role: "user" | "assistant" | "system";
        parts: any[];
        timestamp: number;
      };

      // Verify sessionId matches token
      if (sessionId !== validation.sessionId) {
        return new Response(
          JSON.stringify({ error: "Session ID mismatch" }),
          {
            status: 403,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      await ctx.runMutation(internal.messages.syncMessage, {
        sessionId,
        messageId,
        role,
        parts,
        timestamp,
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      // Log the actual error server-side for debugging
      console.error("Message sync error:", error);
      // Return generic error to client to avoid leaking implementation details
      return new Response(JSON.stringify({ error: "Failed to sync message" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }),
});

export default http;
