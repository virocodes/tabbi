# Tabbi Observability Plan

> Comprehensive monitoring, logging, and alerting strategy for production reliability.

---

## Table of Contents

1. [Observability Stack](#1-observability-stack)
2. [Instrumentation Priorities](#2-instrumentation-priorities)
3. [Logging Strategy](#3-logging-strategy)
4. [Metrics & Dashboards](#4-metrics--dashboards)
5. [Distributed Tracing](#5-distributed-tracing)
6. [Alerting](#6-alerting)
7. [Implementation Roadmap](#7-implementation-roadmap)

---

## 1. Observability Stack

### Recommended Tools

| Layer                    | Tool                           | Purpose                               | Why                                  |
| ------------------------ | ------------------------------ | ------------------------------------- | ------------------------------------ |
| **Error Tracking**       | Sentry                         | JS errors, stack traces, user context | Best-in-class for frontend + workers |
| **Logs**                 | Cloudflare Logpush → Datadog   | Structured logs, search, retention    | Native CF integration                |
| **Metrics**              | Cloudflare Analytics + Grafana | Time-series metrics, dashboards       | Built-in + customizable              |
| **Tracing**              | OpenTelemetry → Jaeger         | Distributed traces across services    | Vendor-neutral, comprehensive        |
| **Uptime**               | Better Uptime / Checkly        | External availability monitoring      | Independent verification             |
| **Real User Monitoring** | Sentry Performance             | Core Web Vitals, user sessions        | Integrated with error tracking       |

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           USER BROWSER                               │
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │ Sentry SDK  │  │ OTel Traces │  │ Performance │                 │
│  │ (Errors)    │  │ (Spans)     │  │ (Vitals)    │                 │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                 │
└─────────┼────────────────┼────────────────┼─────────────────────────┘
          │                │                │
          ▼                ▼                ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │  Sentry  │    │  Jaeger  │    │  Sentry  │
    │  Cloud   │    │  (Trace) │    │  Perf    │
    └──────────┘    └──────────┘    └──────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                      CLOUDFLARE WORKERS                              │
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │ Sentry SDK  │  │ Logpush    │  │ Analytics   │                 │
│  │ (Errors)    │  │ (Logs)     │  │ (Metrics)   │                 │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                 │
└─────────┼────────────────┼────────────────┼─────────────────────────┘
          │                │                │
          ▼                ▼                ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │  Sentry  │    │ Datadog  │    │ Grafana  │
    │  Cloud   │    │  Logs    │    │  Cloud   │
    └──────────┘    └──────────┘    └──────────┘
```

---

## 2. Instrumentation Priorities

### Priority 1: Critical Path (Week 1)

| Component              | Instrumentation                    | Why                                  |
| ---------------------- | ---------------------------------- | ------------------------------------ |
| **API Error Handling** | Sentry in Cloudflare Workers       | Catch unhandled errors, stack traces |
| **Frontend Errors**    | Sentry in React                    | JS exceptions, React errors          |
| **Session Creation**   | Custom metrics                     | Most important user flow             |
| **WebSocket Health**   | Connection success/failure metrics | Core functionality                   |

### Priority 2: User Experience (Week 2)

| Component                 | Instrumentation                 | Why                    |
| ------------------------- | ------------------------------- | ---------------------- |
| **Core Web Vitals**       | Sentry Performance              | LCP, FID, CLS tracking |
| **API Latency**           | P50/P95/P99 metrics             | Performance baseline   |
| **Session State Machine** | State transition logging        | Debug session issues   |
| **Modal Sandbox**         | Boot time, health check metrics | Critical dependency    |

### Priority 3: Operational (Week 3-4)

| Component               | Instrumentation                 | Why                           |
| ----------------------- | ------------------------------- | ----------------------------- |
| **Distributed Tracing** | OpenTelemetry spans             | End-to-end request visibility |
| **Convex Operations**   | Mutation/query logging          | Backend visibility            |
| **GitHub API Calls**    | Rate limit tracking             | External dependency           |
| **Auto-Pause Alarms**   | Alarm scheduling/firing metrics | Background job visibility     |

### Priority 4: Business (Month 2)

| Component            | Instrumentation              | Why                    |
| -------------------- | ---------------------------- | ---------------------- |
| **User Funnels**     | Conversion tracking          | Product analytics      |
| **Feature Usage**    | Feature flag metrics         | Adoption tracking      |
| **Session Duration** | Time-based metrics           | Engagement analysis    |
| **Error Recovery**   | Retry/recovery success rates | Resilience measurement |

---

## 3. Logging Strategy

### Log Levels

| Level   | When to Use                             | Example                                 |
| ------- | --------------------------------------- | --------------------------------------- |
| `error` | Unexpected failures, requires attention | `Failed to create sandbox: timeout`     |
| `warn`  | Recoverable issues, degraded state      | `Retrying Modal API call (attempt 2/3)` |
| `info`  | Key business events, state changes      | `Session created: ${sessionId}`         |
| `debug` | Detailed diagnostic info (dev only)     | `WebSocket message received: ${type}`   |

### Structured Logging Format

```typescript
// Log structure
interface LogEntry {
  timestamp: string; // ISO 8601
  level: "error" | "warn" | "info" | "debug";
  message: string; // Human-readable
  service: string; // 'web' | 'api' | 'modal' | 'convex'

  // Context (always include when available)
  sessionId?: string;
  userId?: string;
  requestId?: string;

  // Error details
  error?: {
    name: string;
    message: string;
    stack?: string;
  };

  // Additional metadata
  metadata?: Record<string, unknown>;
}
```

### Logging Implementation

**Cloudflare Workers** (`cloudflare/src/lib/logger.ts`):

```typescript
import * as Sentry from "@sentry/cloudflare";

interface LogContext {
  sessionId?: string;
  userId?: string;
  requestId?: string;
}

class Logger {
  private context: LogContext = {};

  setContext(ctx: LogContext) {
    this.context = { ...this.context, ...ctx };
  }

  private log(level: string, message: string, metadata?: Record<string, unknown>) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: "api",
      ...this.context,
      metadata,
    };

    console.log(JSON.stringify(entry));

    // Send errors to Sentry
    if (level === "error" && metadata?.error) {
      Sentry.captureException(metadata.error, {
        extra: { ...this.context, ...metadata },
      });
    }
  }

  error(message: string, error?: Error, metadata?: Record<string, unknown>) {
    this.log("error", message, {
      error: error ? { name: error.name, message: error.message, stack: error.stack } : undefined,
      ...metadata,
    });
  }

  warn(message: string, metadata?: Record<string, unknown>) {
    this.log("warn", message, metadata);
  }

  info(message: string, metadata?: Record<string, unknown>) {
    this.log("info", message, metadata);
  }

  debug(message: string, metadata?: Record<string, unknown>) {
    if (process.env.NODE_ENV !== "production") {
      this.log("debug", message, metadata);
    }
  }
}

export const logger = new Logger();
```

**React Frontend** (`web/src/lib/logger.ts`):

```typescript
import * as Sentry from "@sentry/react";

export const logger = {
  error(message: string, error?: Error, context?: Record<string, unknown>) {
    console.error(message, error);
    if (error) {
      Sentry.captureException(error, { extra: context });
    }
  },

  warn(message: string, context?: Record<string, unknown>) {
    console.warn(message, context);
    Sentry.addBreadcrumb({ message, level: "warning", data: context });
  },

  info(message: string, context?: Record<string, unknown>) {
    console.log(message, context);
    Sentry.addBreadcrumb({ message, level: "info", data: context });
  },
};
```

### What to Log

**Always Log**:

- Session creation (success/failure)
- Authentication events
- State machine transitions
- External API calls (request/response status)
- Error recovery attempts

**Never Log**:

- API keys, tokens, secrets
- Full user credentials
- PII without consent
- High-frequency debug messages in production

---

## 4. Metrics & Dashboards

### Key Metrics

#### API Health

| Metric                   | Type      | Description                  |
| ------------------------ | --------- | ---------------------------- |
| `api.requests.total`     | Counter   | Total API requests           |
| `api.requests.errors`    | Counter   | Failed requests (4xx/5xx)    |
| `api.latency`            | Histogram | Request latency (ms)         |
| `api.active_connections` | Gauge     | Active WebSocket connections |

#### Session Lifecycle

| Metric                     | Type      | Description                    |
| -------------------------- | --------- | ------------------------------ |
| `session.created`          | Counter   | Sessions created               |
| `session.create_latency`   | Histogram | Time to create session (ms)    |
| `session.state_transition` | Counter   | State transitions (by from/to) |
| `session.auto_paused`      | Counter   | Auto-pause triggers            |
| `session.resumed`          | Counter   | Resume from snapshot           |

#### Modal Sandbox

| Metric                         | Type      | Description               |
| ------------------------------ | --------- | ------------------------- |
| `sandbox.created`              | Counter   | Sandboxes created         |
| `sandbox.boot_time`            | Histogram | Time to boot sandbox (ms) |
| `sandbox.health_check.success` | Counter   | Successful health checks  |
| `sandbox.health_check.failure` | Counter   | Failed health checks      |

#### Frontend

| Metric       | Type      | Description                   |
| ------------ | --------- | ----------------------------- |
| `web.lcp`    | Histogram | Largest Contentful Paint (ms) |
| `web.fid`    | Histogram | First Input Delay (ms)        |
| `web.cls`    | Histogram | Cumulative Layout Shift       |
| `web.errors` | Counter   | JavaScript errors             |

### Dashboard Layouts

#### Service Health Dashboard

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SERVICE HEALTH                                │
├─────────────────────┬─────────────────────┬─────────────────────────┤
│   Error Rate (%)    │    P95 Latency      │      Throughput         │
│   ┌───────────┐     │    ┌───────────┐    │    ┌───────────┐        │
│   │  0.02%    │     │    │   245ms   │    │    │  1.2k/min │        │
│   └───────────┘     │    └───────────┘    │    └───────────┘        │
├─────────────────────┴─────────────────────┴─────────────────────────┤
│                    Request Rate (24h)                                │
│   ████████████████████████████████████████████████████████████      │
│   ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔      │
├─────────────────────────────────────────────────────────────────────┤
│                    Error Rate by Endpoint                            │
│   POST /sessions        0.1% ██                                      │
│   GET /sessions/:id     0.0%                                         │
│   WS /sessions/:id/ws   0.5% █████                                   │
└─────────────────────────────────────────────────────────────────────┘
```

#### Session Lifecycle Dashboard

```
┌─────────────────────────────────────────────────────────────────────┐
│                     SESSION LIFECYCLE                                │
├─────────────────────┬─────────────────────┬─────────────────────────┤
│  Active Sessions    │   Success Rate      │   Avg Boot Time         │
│   ┌───────────┐     │    ┌───────────┐    │    ┌───────────┐        │
│   │    127    │     │    │   98.5%   │    │    │   12.3s   │        │
│   └───────────┘     │    └───────────┘    │    └───────────┘        │
├─────────────────────┴─────────────────────┴─────────────────────────┤
│              Sessions by State (Real-time)                           │
│   Running:  89 ████████████████████████████                          │
│   Paused:   32 ████████████                                          │
│   Starting:  6 ██                                                    │
│   Error:     0                                                       │
├─────────────────────────────────────────────────────────────────────┤
│              State Transitions (24h)                                 │
│   idle → starting:     234                                           │
│   starting → running:  229 (97.9%)                                   │
│   starting → error:      5 (2.1%)                                    │
│   running → paused:    156                                           │
│   paused → running:    142                                           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 5. Distributed Tracing

### Trace Context Propagation

```
Browser                 Cloudflare              Modal                   OpenCode
   │                        │                      │                        │
   │  X-Request-ID: abc123  │                      │                        │
   │ ──────────────────────>│                      │                        │
   │                        │  X-Request-ID: abc123│                        │
   │                        │ ────────────────────>│                        │
   │                        │                      │  X-Request-ID: abc123  │
   │                        │                      │ ──────────────────────>│
   │                        │                      │                        │
   │                        │                      │<─────── SSE events ────│
   │                        │<─────── Response ────│                        │
   │<─────── WebSocket ─────│                      │                        │
```

### Span Structure

```
Trace: Create Session (abc123)
│
├── [web] User clicks "Start Session"
│   └── Duration: 50ms
│
├── [api] POST /sessions
│   ├── Duration: 2500ms
│   ├── [api] Validate token
│   │   └── Duration: 15ms
│   ├── [api] Initialize Durable Object
│   │   └── Duration: 50ms
│   └── [api] Create sandbox (background)
│       └── Duration: 2400ms
│
└── [modal] create_sandbox
    ├── Duration: 2300ms
    ├── [modal] Clone repository
    │   └── Duration: 1800ms
    └── [modal] Start OpenCode
        └── Duration: 500ms
```

### OpenTelemetry Setup

**Cloudflare Workers** (`cloudflare/src/lib/tracing.ts`):

```typescript
import { trace, SpanKind, context } from "@opentelemetry/api";

const tracer = trace.getTracer("tabbi-api");

export function withSpan<T>(
  name: string,
  fn: () => Promise<T>,
  attributes?: Record<string, string>
): Promise<T> {
  return tracer.startActiveSpan(name, { kind: SpanKind.INTERNAL, attributes }, async (span) => {
    try {
      const result = await fn();
      span.setStatus({ code: 0 });
      return result;
    } catch (error) {
      span.setStatus({ code: 2, message: String(error) });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}
```

---

## 6. Alerting

### Alert Definitions

#### P0 (Page Immediately)

| Alert                        | Condition                     | Action                 |
| ---------------------------- | ----------------------------- | ---------------------- |
| API Down                     | Error rate > 50% for 2 min    | Page on-call, rollback |
| Database Unavailable         | Convex errors > 10% for 2 min | Page on-call           |
| All Sandbox Creation Failing | Success rate < 50% for 5 min  | Page on-call           |

#### P1 (Page During Business Hours)

| Alert             | Condition                 | Action                  |
| ----------------- | ------------------------- | ----------------------- |
| High Error Rate   | Error rate > 5% for 5 min | Investigate immediately |
| High Latency      | P95 > 2s for 5 min        | Investigate             |
| Sandbox Boot Slow | P95 > 60s for 10 min      | Check Modal status      |

#### P2 (Ticket)

| Alert            | Condition                  | Action             |
| ---------------- | -------------------------- | ------------------ |
| Elevated Errors  | Error rate > 1% for 30 min | Create issue       |
| Elevated Latency | P95 > 1s for 30 min        | Create issue       |
| Low Sessions     | Sessions created < 10/hour | Investigate funnel |

### Alert Routing

```yaml
# PagerDuty / Opsgenie configuration
routes:
  - match:
      severity: critical
    receiver: oncall-primary
    continue: true

  - match:
      severity: warning
      time: business_hours
    receiver: oncall-secondary

  - match:
      severity: info
    receiver: slack-alerts

receivers:
  - name: oncall-primary
    pagerduty_configs:
      - service_key: $PAGERDUTY_KEY

  - name: slack-alerts
    slack_configs:
      - channel: "#alerts"
        send_resolved: true
```

### Alert Best Practices

1. **Alert on symptoms, not causes**: Alert on "high error rate", not "database CPU high"
2. **Include runbook link**: Every alert should link to resolution steps
3. **Set appropriate thresholds**: Start high, tune down based on experience
4. **Avoid alert fatigue**: If an alert doesn't require action, it shouldn't page
5. **Test alerts regularly**: Ensure alerting pipeline works before you need it

---

## 7. Implementation Roadmap

### Week 1: Foundation

- [ ] Set up Sentry project (web + cloudflare)
- [ ] Add Sentry SDK to web (`@sentry/react`)
- [ ] Add Sentry SDK to cloudflare (`@sentry/cloudflare`)
- [ ] Create basic error tracking
- [ ] Set up Slack integration for alerts

### Week 2: Core Metrics

- [ ] Implement structured logging in Cloudflare
- [ ] Add session lifecycle metrics
- [ ] Create Service Health dashboard
- [ ] Set up P0/P1 alerts

### Week 3: User Experience

- [ ] Enable Sentry Performance (Core Web Vitals)
- [ ] Add API latency tracking
- [ ] Create Session Lifecycle dashboard
- [ ] Add frontend error tracking

### Week 4: Operations

- [ ] Set up Cloudflare Logpush
- [ ] Implement request ID propagation
- [ ] Add Modal sandbox metrics
- [ ] Create runbooks for common alerts

### Month 2: Advanced

- [ ] Implement OpenTelemetry tracing
- [ ] Set up trace visualization (Jaeger)
- [ ] Add business metrics
- [ ] Create SLO dashboards
- [ ] Implement automated anomaly detection

---

## Appendix: Sentry Configuration

### Web Setup (`web/src/main.tsx`):

```typescript
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
  tracesSampleRate: 0.1, // 10% of transactions
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});
```

### Cloudflare Setup (`cloudflare/src/index.ts`):

```typescript
import * as Sentry from "@sentry/cloudflare";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return Sentry.withSentry({ dsn: env.SENTRY_DSN }, () => app.fetch(request, env, ctx));
  },
};
```
