import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { components } from "./_generated/api";
import { DataModel } from "./_generated/dataModel";
import { betterAuth } from "better-auth";
import authConfig from "./auth.config";

const siteUrl = process.env.SITE_URL || "http://localhost:3000";

// Create the auth component client
export const authComponent = createClient<DataModel>(components.betterAuth);

// Create the Better Auth instance
export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(ctx),
    socialProviders: {
      github: {
        clientId: process.env.AUTH_GITHUB_ID!,
        clientSecret: process.env.AUTH_GITHUB_SECRET!,
        scope: ["repo", "user:email"],
      },
    },
    plugins: [
      crossDomain({ siteUrl }),
      convex({ authConfig }),
    ],
  });
};
