import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { authComponent } from "./auth";
import { internal } from "./_generated/api";

// List user's sessions (for sidebar)
export const listUserSessions = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return [];

    const sessions = await ctx.db
      .query("codingSessions")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", String(authUser._id)))
      .order("desc")
      .take(50);

    // Sort by updatedAt descending
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

// Get a single session
export const getSession = query({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;

    const session = await ctx.db
      .query("codingSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();

    // Authorization check
    if (!session || session.authUserId !== String(authUser._id)) {
      return null;
    }

    return session;
  },
});

// Create a new session
export const createSession = mutation({
  args: {
    repo: v.string(),
    selectedModel: v.optional(v.string()),
    provider: v.optional(
      v.union(v.literal("anthropic"), v.literal("openai"), v.literal("opencode"))
    ),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error("Not authenticated");

    // Generate session ID
    const sessionId = crypto.randomUUID();

    // Create session record
    await ctx.db.insert("codingSessions", {
      authUserId: String(authUser._id),
      sessionId,
      repo: args.repo,
      selectedModel: args.selectedModel,
      provider: args.provider,
      status: "starting",
      isProcessing: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Generate short-lived API token for Cloudflare (1 hour)
    const tokenResult: { token: string; expiresAt: number } = await ctx.runMutation(
      internal.tokens.createApiToken,
      {
        authUserId: String(authUser._id),
        sessionId,
        expiresInMs: 60 * 60 * 1000, // 1 hour
      }
    );

    return {
      sessionId,
      apiToken: tokenResult.token,
      expiresAt: tokenResult.expiresAt,
    };
  },
});

// Generate a new API token for an existing session (for reconnection)
export const refreshSessionToken = mutation({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error("Not authenticated");

    // Verify user owns the session
    const session = await ctx.db
      .query("codingSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();

    if (!session || session.authUserId !== String(authUser._id)) {
      throw new Error("Session not found or unauthorized");
    }

    // Generate new API token
    const tokenResult: { token: string; expiresAt: number } = await ctx.runMutation(
      internal.tokens.createApiToken,
      {
        authUserId: String(authUser._id),
        sessionId: args.sessionId,
        expiresInMs: 60 * 60 * 1000, // 1 hour
      }
    );

    return {
      apiToken: tokenResult.token,
      expiresAt: tokenResult.expiresAt,
    };
  },
});

// Delete a session
export const deleteSession = mutation({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error("Not authenticated");

    const session = await ctx.db
      .query("codingSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();

    // Authorization check
    if (!session || session.authUserId !== String(authUser._id)) {
      throw new Error("Session not found or unauthorized");
    }

    // Delete all messages for this session
    const messages = await ctx.db
      .query("sessionMessages")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    for (const message of messages) {
      await ctx.db.delete(message._id);
    }

    // Delete the session
    await ctx.db.delete(session._id);
  },
});

// Update session status (internal - called by Cloudflare via HTTP action)
export const updateSessionStatus = internalMutation({
  args: {
    sessionId: v.string(),
    status: v.optional(
      v.union(
        v.literal("idle"),
        v.literal("starting"),
        v.literal("running"),
        v.literal("paused"),
        v.literal("error")
      )
    ),
    isProcessing: v.optional(v.boolean()),
    title: v.optional(v.string()),
    snapshotId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("codingSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();

    if (!session) {
      throw new Error("Session not found");
    }

    const updates: Record<string, unknown> = {
      updatedAt: Date.now(),
    };

    if (args.status !== undefined) {
      updates.status = args.status;
    }

    if (args.isProcessing !== undefined) updates.isProcessing = args.isProcessing;
    if (args.title !== undefined) updates.title = args.title;
    if (args.snapshotId !== undefined) updates.snapshotId = args.snapshotId;
    if (args.errorMessage !== undefined) updates.errorMessage = args.errorMessage;

    await ctx.db.patch(session._id, updates);
  },
});
