import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { authComponent } from "./auth";

// Message part validators
const textPart = v.object({
  type: v.literal("text"),
  text: v.string(),
});

const toolCallPart = v.object({
  type: v.literal("tool"),
  toolCall: v.object({
    id: v.string(),
    name: v.string(),
    arguments: v.any(),
    result: v.optional(v.string()),
    state: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("error")
    ),
  }),
});

const messagePart = v.union(textPart, toolCallPart);

// Get all messages for a session
export const getSessionMessages = query({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return [];

    // Verify user owns the session
    const session = await ctx.db
      .query("codingSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();

    if (!session || session.authUserId !== String(authUser._id)) {
      return [];
    }

    // Get messages ordered by timestamp
    const messages = await ctx.db
      .query("sessionMessages")
      .withIndex("by_sessionId_timestamp", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    return messages;
  },
});

// Sync a single message from Cloudflare (internal)
export const syncMessage = internalMutation({
  args: {
    sessionId: v.string(),
    messageId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
    parts: v.array(messagePart),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    // Check if message already exists (upsert)
    const existing = await ctx.db
      .query("sessionMessages")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .filter((q) => q.eq(q.field("messageId"), args.messageId))
      .unique();

    if (existing) {
      // Update existing message
      await ctx.db.patch(existing._id, {
        parts: args.parts,
        timestamp: args.timestamp,
      });
    } else {
      // Insert new message
      await ctx.db.insert("sessionMessages", {
        sessionId: args.sessionId,
        messageId: args.messageId,
        role: args.role,
        parts: args.parts,
        timestamp: args.timestamp,
        createdAt: Date.now(),
      });
    }

    // Update session's updatedAt and set title if this is first user message
    const session = await ctx.db
      .query("codingSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();

    if (session) {
      const updates: Record<string, unknown> = {
        updatedAt: Date.now(),
      };

      // Set title from first user message if not set
      if (!session.title && args.role === "user") {
        const textPart = args.parts.find((p) => p.type === "text");
        if (textPart && textPart.type === "text") {
          // Truncate to first 100 chars
          updates.title = textPart.text.slice(0, 100);
        }
      }

      await ctx.db.patch(session._id, updates);
    }
  },
});

// Batch sync multiple messages (internal)
export const syncBatch = internalMutation({
  args: {
    sessionId: v.string(),
    messages: v.array(
      v.object({
        messageId: v.string(),
        role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
        parts: v.array(messagePart),
        timestamp: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    for (const msg of args.messages) {
      // Check if message already exists
      const existing = await ctx.db
        .query("sessionMessages")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
        .filter((q) => q.eq(q.field("messageId"), msg.messageId))
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, {
          parts: msg.parts,
          timestamp: msg.timestamp,
        });
      } else {
        await ctx.db.insert("sessionMessages", {
          sessionId: args.sessionId,
          messageId: msg.messageId,
          role: msg.role,
          parts: msg.parts,
          timestamp: msg.timestamp,
          createdAt: Date.now(),
        });
      }
    }

    // Update session's updatedAt
    const session = await ctx.db
      .query("codingSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();

    if (session) {
      await ctx.db.patch(session._id, {
        updatedAt: Date.now(),
      });
    }
  },
});
