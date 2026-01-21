import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { authComponent, createAuth } from "./auth";
import { components } from "./_generated/api";

export interface Repository {
  id: number;
  full_name: string;
  private: boolean;
  description: string | null;
}

// Fetch user's repositories from GitHub
export const fetchUserRepos = action({
  args: {},
  handler: async (ctx): Promise<Repository[]> => {
    // Get the Better Auth API with headers
    const { auth, headers } = await authComponent.getAuth(createAuth, ctx);

    // Get the GitHub access token
    const tokenResult = await auth.api.getAccessToken({
      body: { providerId: "github" },
      headers,
    });

    if (!tokenResult?.accessToken) {
      throw new Error("GitHub token not found. Please sign out and sign in again.");
    }

    console.log("[fetchUserRepos] Token found, fetching repos...");

    // Fetch repos from GitHub API
    const response = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", {
      headers: {
        Authorization: `token ${tokenResult.accessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("GitHub token invalid. Please re-authenticate.");
      }
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const repos = await response.json();
    return repos.map((repo: any) => ({
      id: repo.id,
      full_name: repo.full_name,
      private: repo.private,
      description: repo.description,
    }));
  },
});

// Get a valid GitHub token (internal - called by HTTP endpoints)
// This uses the component's adapter directly since we don't have a session context
export const getValidToken = internalAction({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, args): Promise<string> => {
    // Query the Better Auth accounts table directly via the component adapter
    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "account",
      where: [
        { field: "userId", value: args.authUserId },
        { field: "providerId", value: "github" },
      ],
      paginationOpts: {
        cursor: null,
        numItems: 1,
      },
    });
    const accounts = result?.page;

    const githubAccount = accounts?.[0];
    if (!githubAccount?.accessToken) {
      throw new Error("GitHub token not found. Please sign out and sign in again.");
    }

    return githubAccount.accessToken;
  },
});
