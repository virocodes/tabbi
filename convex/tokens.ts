import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// Hash a token using SHA-256
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Generate a random token
function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // Convert to base64url
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// Create a short-lived API token for Cloudflare
export const createApiToken = internalMutation({
  args: {
    authUserId: v.string(),
    sessionId: v.string(),
    expiresInMs: v.number(),
  },
  handler: async (ctx, args) => {
    const token = generateToken();
    const tokenHash = await hashToken(token);

    await ctx.db.insert("apiTokens", {
      authUserId: args.authUserId,
      tokenHash,
      sessionId: args.sessionId,
      expiresAt: Date.now() + args.expiresInMs,
      createdAt: Date.now(),
    });

    // Return raw token (only time it's available)
    return {
      token,
      expiresAt: Date.now() + args.expiresInMs,
    };
  },
});

// Validate an API token
export const validateApiToken = internalQuery({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const tokenHash = await hashToken(args.token);

    const apiToken = await ctx.db
      .query("apiTokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();

    if (!apiToken) return null;
    if (apiToken.expiresAt < Date.now()) return null;

    return {
      authUserId: apiToken.authUserId,
      sessionId: apiToken.sessionId,
      valid: true,
    };
  },
});

// Cleanup expired tokens (can be scheduled)
export const cleanupExpiredTokens = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expiredTokens = await ctx.db
      .query("apiTokens")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect();

    for (const token of expiredTokens) {
      await ctx.db.delete(token._id);
    }

    return { deleted: expiredTokens.length };
  },
});
