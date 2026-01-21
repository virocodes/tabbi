/**
 * Debug utilities for inspecting the database
 * Run with: npx convex run debug:inspectAuth
 */
import { query } from "./_generated/server";
import { components } from "./_generated/api";

/**
 * Inspect the authentication data across all tables.
 * This shows both Better Auth component tables and our userProfiles table.
 */
export const inspectAuth = query({
  args: {},
  handler: async (ctx) => {
    // Get all userProfiles from main schema
    const userProfiles = await ctx.db.query("userProfiles").collect();

    // Get all codingSessions
    const codingSessions = await ctx.db.query("codingSessions").collect();

    // Get all apiTokens
    const apiTokens = await ctx.db.query("apiTokens").collect();

    // Query Better Auth component tables via the adapter
    let betterAuthUsers: unknown[] = [];
    let betterAuthAccounts: unknown[] = [];
    let betterAuthSessions: unknown[] = [];

    try {
      // Get users from Better Auth component
      betterAuthUsers = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "user",
        where: [],
      });
    } catch {
      // Component query failed
    }

    try {
      // Get accounts from Better Auth component
      betterAuthAccounts = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "account",
        where: [],
      });
    } catch {
      // Component query failed
    }

    try {
      // Get sessions from Better Auth component
      betterAuthSessions = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "session",
        where: [],
      });
    } catch {
      // Component query failed
    }

    return {
      mainSchema: {
        userProfiles: {
          count: userProfiles.length,
          data: userProfiles,
        },
        codingSessions: {
          count: codingSessions.length,
          data: codingSessions,
        },
        apiTokens: {
          count: apiTokens.length,
          // Don't expose token hashes
          data: apiTokens.map((t) => ({
            authUserId: t.authUserId,
            sessionId: t.sessionId,
            expiresAt: new Date(t.expiresAt).toISOString(),
          })),
        },
      },
      betterAuthComponent: {
        users: {
          count: betterAuthUsers.length,
          data: betterAuthUsers,
        },
        accounts: {
          count: betterAuthAccounts.length,
          // Mask access tokens for security
          data: (betterAuthAccounts as Array<Record<string, unknown>>).map((a) => ({
            ...a,
            accessToken: a.accessToken ? "***" : undefined,
            refreshToken: a.refreshToken ? "***" : undefined,
          })),
        },
        sessions: {
          count: betterAuthSessions.length,
          data: betterAuthSessions,
        },
      },
    };
  },
});
