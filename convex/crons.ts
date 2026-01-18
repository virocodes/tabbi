import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Clean up expired API tokens every hour
crons.interval(
  "cleanup expired tokens",
  { hours: 1 },
  internal.tokens.cleanupExpiredTokens
);

export default crons;
