import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { authComponent } from "./auth";

// Get current user's profile
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;

    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", String(authUser._id)))
      .unique();

    return profile;
  },
});

// Store user profile after OAuth (internal - called from auth callback or http handler)
export const storeUserProfile = internalMutation({
  args: {
    authUserId: v.string(),
    githubId: v.number(),
    githubUsername: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Upsert user profile
    const existingProfile = await ctx.db
      .query("userProfiles")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", args.authUserId))
      .unique();

    if (existingProfile) {
      await ctx.db.patch(existingProfile._id, {
        githubUsername: args.githubUsername,
        githubId: args.githubId,
        avatarUrl: args.avatarUrl,
        name: args.name,
        email: args.email,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("userProfiles", {
        authUserId: args.authUserId,
        githubId: args.githubId,
        githubUsername: args.githubUsername,
        avatarUrl: args.avatarUrl,
        name: args.name,
        email: args.email,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});
