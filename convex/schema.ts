import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Message part types
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

export default defineSchema({
  // Better Auth manages its own tables via the component
  // No need to spread authTables here

  // Extended user profile (linked to Better Auth user via authUserId string)
  userProfiles: defineTable({
    authUserId: v.string(),
    githubUsername: v.string(),
    githubId: v.number(),
    avatarUrl: v.optional(v.string()),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_authUserId", ["authUserId"])
    .index("by_githubId", ["githubId"]),

  // GitHub OAuth tokens are now stored in Better Auth's accounts table
  // No need for a separate githubTokens table

  // Coding sessions (replaces SessionRegistry DO)
  codingSessions: defineTable({
    authUserId: v.string(),
    sessionId: v.string(),
    repo: v.string(),
    title: v.optional(v.string()),
    status: v.union(
      v.literal("idle"),
      v.literal("starting"),
      v.literal("running"),
      v.literal("paused"),
      v.literal("error")
    ),
    isProcessing: v.boolean(),
    snapshotId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    selectedModel: v.optional(v.string()),
    provider: v.optional(
      v.union(v.literal("anthropic"), v.literal("openai"), v.literal("opencode"))
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_authUserId", ["authUserId"])
    .index("by_sessionId", ["sessionId"])
    .index("by_authUserId_updatedAt", ["authUserId", "updatedAt"]),

  // Session messages (synced from Cloudflare DO)
  sessionMessages: defineTable({
    sessionId: v.string(),
    messageId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
    parts: v.array(messagePart),
    timestamp: v.number(),
    createdAt: v.number(),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_sessionId_timestamp", ["sessionId", "timestamp"]),

  // Short-lived API tokens for Cloudflare auth
  apiTokens: defineTable({
    authUserId: v.string(),
    tokenHash: v.string(),
    sessionId: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_authUserId", ["authUserId"]),

  // User API secrets (encrypted with AES-256-GCM)
  userSecrets: defineTable({
    authUserId: v.string(),
    provider: v.union(v.literal("anthropic"), v.literal("openai")),
    encryptedKey: v.string(),
    iv: v.string(),
    salt: v.string(),
    algorithm: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_authUserId", ["authUserId"])
    .index("by_authUserId_provider", ["authUserId", "provider"]),
});
