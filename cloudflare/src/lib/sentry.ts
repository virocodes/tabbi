import {
  captureException as sentryCaptureException,
  setUser as sentrySetUser,
} from "@sentry/cloudflare";

/**
 * Capture an exception with context.
 */
export function captureException(error: Error, context?: Record<string, unknown>) {
  try {
    sentryCaptureException(error, {
      extra: context,
    });
  } catch {
    // Sentry not initialized, just log
    console.error("[Sentry] Failed to capture exception:", error);
  }
}

/**
 * Set user context.
 */
export function setUser(user: { id: string; email?: string } | null) {
  try {
    sentrySetUser(user);
  } catch {
    // Sentry not initialized, ignore
  }
}

/**
 * Logger with optional Sentry integration.
 * Use this throughout the codebase for consistent logging.
 */
export const logger = {
  error(message: string, error?: Error, context?: Record<string, unknown>) {
    console.error(`[ERROR] ${message}`, error, context);
    if (error) {
      captureException(error, { message, ...context });
    }
  },

  warn(message: string, context?: Record<string, unknown>) {
    console.warn(`[WARN] ${message}`, context);
  },

  info(message: string, context?: Record<string, unknown>) {
    console.log(`[INFO] ${message}`, context);
  },

  debug(message: string, context?: Record<string, unknown>) {
    // Only log in dev mode (check should be done by caller)
    console.log(`[DEBUG] ${message}`, context);
  },
};
