/**
 * User Secrets Management
 *
 * Handles encrypted storage of API keys for external providers (Anthropic, OpenAI).
 * Keys are encrypted using AES-256-GCM before storage and only decrypted server-side.
 */

import { v } from "convex/values";
import { mutation, query, internalQuery } from "./_generated/server";
import { encryptSecret, decryptSecret } from "./lib/encryption";
import { authComponent } from "./auth";

const PROVIDER = v.union(v.literal("anthropic"), v.literal("openai"));

/**
 * Validates API key format for security
 */
function validateApiKey(provider: string, apiKey: string): void {
  if (provider === "anthropic") {
    if (!apiKey.startsWith("sk-ant-")) {
      throw new Error("Invalid Anthropic API key format. Must start with 'sk-ant-'");
    }
  } else if (provider === "openai") {
    if (!apiKey.startsWith("sk-")) {
      throw new Error("Invalid OpenAI API key format. Must start with 'sk-'");
    }
  }

  if (apiKey.length < 20) {
    throw new Error("API key appears to be too short");
  }
}

/**
 * Stores or updates an encrypted API key for a provider
 */
export const setApiKey = mutation({
  args: {
    provider: PROVIDER,
    apiKey: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error("Not authenticated");
    }
    const authUserId = String(authUser._id);

    // Validate API key format
    validateApiKey(args.provider, args.apiKey);

    // Get master secret from environment
    const masterSecret = process.env.ENCRYPTION_MASTER_SECRET;
    if (!masterSecret) {
      throw new Error("Encryption master secret not configured");
    }

    // Encrypt the API key
    const encrypted = await encryptSecret(args.apiKey, masterSecret);

    // Check if key already exists for this user+provider
    const existing = await ctx.db
      .query("userSecrets")
      .withIndex("by_authUserId_provider", (q) =>
        q.eq("authUserId", authUserId).eq("provider", args.provider)
      )
      .unique();

    const now = Date.now();

    if (existing) {
      // Update existing key
      await ctx.db.patch(existing._id, {
        encryptedKey: encrypted.encryptedKey,
        iv: encrypted.iv,
        salt: encrypted.salt,
        algorithm: encrypted.algorithm,
        updatedAt: now,
      });
    } else {
      // Insert new key
      await ctx.db.insert("userSecrets", {
        authUserId,
        provider: args.provider,
        encryptedKey: encrypted.encryptedKey,
        iv: encrypted.iv,
        salt: encrypted.salt,
        algorithm: encrypted.algorithm,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { success: true };
  },
});

/**
 * Lists providers that have configured API keys (does NOT return the keys)
 */
export const listConfiguredProviders = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      return [];
    }
    const authUserId = String(authUser._id);

    const secrets = await ctx.db
      .query("userSecrets")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", authUserId))
      .collect();

    return secrets.map((s) => ({
      provider: s.provider,
      updatedAt: s.updatedAt,
    }));
  },
});

/**
 * Deletes an API key for a provider
 */
export const deleteApiKey = mutation({
  args: {
    provider: PROVIDER,
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error("Not authenticated");
    }
    const authUserId = String(authUser._id);

    const existing = await ctx.db
      .query("userSecrets")
      .withIndex("by_authUserId_provider", (q) =>
        q.eq("authUserId", authUserId).eq("provider", args.provider)
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
    }

    return { success: true };
  },
});

/**
 * Internal query to get decrypted API key for a user and provider
 * This should ONLY be called from backend (Convex HTTP endpoints), never from client
 */
export const getDecryptedKey = internalQuery({
  args: {
    authUserId: v.string(),
    provider: PROVIDER,
  },
  handler: async (ctx, args) => {
    const secret = await ctx.db
      .query("userSecrets")
      .withIndex("by_authUserId_provider", (q) =>
        q.eq("authUserId", args.authUserId).eq("provider", args.provider)
      )
      .unique();

    if (!secret) {
      return null;
    }

    // Get master secret from environment
    const masterSecret = process.env.ENCRYPTION_MASTER_SECRET;
    if (!masterSecret) {
      throw new Error("Encryption master secret not configured");
    }

    // Decrypt and return the API key
    const decrypted = await decryptSecret(
      secret.encryptedKey,
      secret.iv,
      secret.salt,
      masterSecret
    );

    return decrypted;
  },
});
