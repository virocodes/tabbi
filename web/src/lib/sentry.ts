import * as Sentry from "@sentry/react";

/**
 * Initialize Sentry for error tracking and performance monitoring.
 * Call this early in the application lifecycle (before rendering).
 */
export function initSentry() {
  // Only initialize if DSN is provided
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    if (import.meta.env.DEV) {
      console.log("Sentry DSN not configured, skipping initialization");
    }
    return;
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE, // 'development' or 'production'
    release: import.meta.env.VITE_APP_VERSION || "dev",

    // Performance Monitoring
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],

    // Sampling rates
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0, // 10% in prod, 100% in dev
    replaysSessionSampleRate: 0.1, // 10% of sessions
    replaysOnErrorSampleRate: 1.0, // 100% of sessions with errors

    // Filter out noisy errors
    ignoreErrors: [
      // Browser extensions
      "top.GLOBALS",
      "canvas.contentDocument",
      "MyApp_RemoveAllHighlights",
      // Network errors
      "Network request failed",
      "Failed to fetch",
      "Load failed",
      // Benign errors
      "ResizeObserver loop",
      "Non-Error promise rejection",
    ],

    // Don't send PII
    beforeSend(event: Sentry.ErrorEvent) {
      // Scrub sensitive data
      if (event.request?.headers) {
        delete event.request.headers["Authorization"];
      }
      return event;
    },
  });
}

/**
 * Set user context for Sentry.
 * Call this after user authenticates.
 */
export function setSentryUser(user: { id: string; email?: string; username?: string } | null) {
  if (user) {
    Sentry.setUser({
      id: user.id,
      email: user.email,
      username: user.username,
    });
  } else {
    Sentry.setUser(null);
  }
}

/**
 * Add a breadcrumb for debugging.
 */
export function addBreadcrumb(
  message: string,
  category: string,
  level: Sentry.SeverityLevel = "info",
  data?: Record<string, unknown>
) {
  Sentry.addBreadcrumb({
    message,
    category,
    level,
    data,
  });
}

/**
 * Capture an exception manually.
 */
export function captureException(error: Error, context?: Record<string, unknown>) {
  Sentry.captureException(error, {
    extra: context,
  });
}

/**
 * Capture a message manually.
 */
export function captureMessage(message: string, level: Sentry.SeverityLevel = "info") {
  Sentry.captureMessage(message, level);
}

// Re-export Sentry for direct access if needed
export { Sentry };
