# Tabbi Production Issues Playbook

> A comprehensive guide for diagnosing and resolving production issues.

---

## Table of Contents

1. [First Response Protocol](#1-first-response-protocol)
2. [Severity Classification](#2-severity-classification)
3. [Common Issues & Runbooks](#3-common-issues--runbooks)
4. [Service-Specific Debugging](#4-service-specific-debugging)
5. [Communication Templates](#5-communication-templates)
6. [Postmortem Process](#6-postmortem-process)

---

## 1. First Response Protocol

### The First 15 Minutes

When an alert fires or issue is reported, follow this checklist:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    FIRST 15 MINUTES CHECKLIST                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  □ 1. ACKNOWLEDGE (0-2 min)                                         │
│     • Claim the incident in #incidents channel                      │
│     • Acknowledge the alert in PagerDuty/Opsgenie                   │
│                                                                      │
│  □ 2. ASSESS (2-5 min)                                              │
│     • Check Sentry for error details and stack traces               │
│     • Check service dashboards for anomalies                        │
│     • Identify affected service(s) and scope                        │
│                                                                      │
│  □ 3. CHECK RECENT CHANGES (5-8 min)                                │
│     • Review deployments in last 24 hours                           │
│     • Check for config changes                                      │
│     • Review any infrastructure changes                             │
│                                                                      │
│  □ 4. REPRODUCE (8-12 min)                                          │
│     • Try to reproduce in production (if safe)                      │
│     • Try to reproduce in staging                                   │
│     • Gather reproduction steps                                     │
│                                                                      │
│  □ 5. COMMUNICATE (12-15 min)                                       │
│     • Post initial status update                                    │
│     • Update status page (if P0/P1)                                 │
│     • Escalate if needed                                            │
│                                                                      │
│  □ 6. DECIDE: MITIGATE OR INVESTIGATE                               │
│     • If cause is clear → rollback or hotfix                        │
│     • If cause unclear → continue investigation                     │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Quick Diagnostic Commands

```bash
# Check Cloudflare Worker status
curl -I https://api.tabbi.dev/health

# Stream Cloudflare Worker logs
wrangler tail --env production

# Check Modal sandbox status
modal app list | grep coding-agent

# Stream Modal logs
modal app logs coding-agent-sandbox

# Check Convex status
npx convex dashboard

# Check recent deployments (Cloudflare)
wrangler deployments list --env production
```

---

## 2. Severity Classification

### Severity Matrix

| Severity | Impact              | Examples                                                    | Response              |
| -------- | ------------------- | ----------------------------------------------------------- | --------------------- |
| **P0**   | Complete outage     | API down, database unavailable, all users blocked           | Immediate (all hands) |
| **P1**   | Major degradation   | Login broken, session creation failing >50%, data loss risk | < 1 hour              |
| **P2**   | Partial degradation | Single feature broken, slow performance, errors < 10%       | < 4 hours             |
| **P3**   | Minor issue         | UI glitch, non-critical error, edge case bug                | Next business day     |

### Severity Decision Tree

```
Is the service completely unavailable?
├── YES → P0
└── NO
    │
    Can users complete their primary task (code with AI)?
    ├── NO → P1
    └── YES
        │
        Is there visible degradation or errors?
        ├── YES → P2
        └── NO → P3
```

### Escalation Path

```
P0: On-call Primary → (5 min) → On-call Secondary → (10 min) → Eng Lead → (15 min) → CTO
P1: On-call Primary → (30 min) → On-call Secondary → (1 hour) → Eng Lead
P2: On-call Primary → (4 hours) → Eng Lead
P3: Create issue, assign to next sprint
```

---

## 3. Common Issues & Runbooks

### Issue: API Returning 5xx Errors

**Symptoms**:

- Elevated error rate in dashboard
- Users seeing "Something went wrong" messages
- 500/502/503 responses from API

**Runbook**:

1. **Identify the scope**

   ```bash
   # Check error rate by endpoint
   wrangler tail --env production --filter "status>=500" | head -20
   ```

2. **Check Sentry for stack traces**
   - Go to Sentry → Issues → Filter by "api" service
   - Look for the most frequent error

3. **Check for recent deployments**

   ```bash
   wrangler deployments list --env production
   ```

4. **If deployment-related**:

   ```bash
   # Rollback to previous deployment
   wrangler rollback --env production
   ```

5. **If not deployment-related**:
   - Check external dependencies (Modal, Convex)
   - Check for rate limiting
   - Review the specific error in logs

6. **Verify recovery**
   - Monitor error rate for 5 minutes
   - Confirm specific error is resolved

---

### Issue: WebSocket Connections Failing

**Symptoms**:

- Users stuck on "Connecting..." in chat
- "Not connected" errors
- WebSocket upgrade failures in logs

**Runbook**:

1. **Check WebSocket upgrade success rate**

   ```bash
   # In Cloudflare logs
   wrangler tail --env production --filter "ws upgrade"
   ```

2. **Verify WebSocket endpoint is responsive**

   ```bash
   # Should get 426 (Upgrade Required) - that's correct
   curl -I https://api.tabbi.dev/sessions/test/ws
   ```

3. **Check for CORS issues**
   - Verify `ALLOWED_ORIGINS` in wrangler.toml includes production domain
   - Check browser console for CORS errors

4. **Check Durable Object status**
   - DO might be hibernated or crashed
   - Check for DO-specific errors in logs

5. **If widespread**:
   - Check Cloudflare status page
   - Consider rolling back recent changes

6. **Resolution steps**:
   ```bash
   # If CORS issue
   # Update wrangler.toml ALLOWED_ORIGINS and redeploy
   wrangler deploy --env production
   ```

---

### Issue: Session Creation Failing

**Symptoms**:

- Sessions stuck in "starting" state
- "Failed to create session" errors
- Sandbox creation timeouts

**Runbook**:

1. **Check session creation success rate**
   - Dashboard: Session Lifecycle → Success Rate
   - Target: > 95%

2. **Identify failure point**

   ```bash
   # Check Modal sandbox creation
   modal app logs coding-agent-sandbox | grep "create_sandbox" | tail -20
   ```

3. **Common causes**:

   **a) GitHub token expired**
   - Check Convex logs for token refresh errors
   - User needs to re-authenticate

   **b) Modal sandbox timeout**
   - Large repo taking too long to clone
   - Check Modal dashboard for resource issues

   **c) OpenCode health check failing**
   - Sandbox started but OpenCode not responding
   - Check Modal logs for startup errors

4. **If Modal is the issue**:

   ```bash
   # Check Modal status
   modal app list

   # Restart Modal app (if stuck)
   modal app stop coding-agent-sandbox
   modal deploy sandbox.py
   ```

5. **If GitHub auth is the issue**:
   - Check Convex github.ts logs
   - Verify GitHub OAuth app is functioning

---

### Issue: Sessions Auto-Pausing Unexpectedly

**Symptoms**:

- Sessions pause before 9-minute timeout
- Users losing work unexpectedly
- "Session paused" messages appearing early

**Runbook**:

1. **Check alarm scheduling**

   ```bash
   wrangler tail --env production --filter "alarm"
   ```

2. **Verify timeout configuration**
   - Check `AUTO_PAUSE_TIMEOUT_MS` in agent.ts
   - Should be 9 _ 60 _ 1000 = 540000ms

3. **Check for duplicate alarm scheduling**
   - Multiple activity events might reschedule incorrectly
   - Look for rapid alarm rescheduling in logs

4. **If Modal timeout (not our pause)**:
   - Modal has a 10-minute timeout for served apps
   - Check if sandbox timed out at Modal level
   ```bash
   modal app logs coding-agent-sandbox | grep "timeout"
   ```

---

### Issue: Messages Not Appearing in Chat

**Symptoms**:

- User sends message, nothing appears
- Assistant responses missing
- Chat shows stale state

**Runbook**:

1. **Check WebSocket connection**
   - Browser DevTools → Network → WS
   - Should show active connection

2. **Check message deduplication**
   - Duplicate message IDs being filtered?
   - Check `deduplicateMessages` in useSession.ts

3. **Check streaming state**

   ```bash
   # Look for streaming events
   wrangler tail --env production --filter "streaming"
   ```

4. **Check Convex sync**

   ```bash
   npx convex logs | grep "messages"
   ```

5. **If WebSocket is working but no messages**:
   - Check OpenCode SSE connection in Cloudflare logs
   - Verify sandbox is still running
   - Check for Modal sandbox timeout

---

### Issue: High Latency / Slow Response

**Symptoms**:

- P95 latency > 2s
- Users reporting slow responses
- Dashboard showing latency spike

**Runbook**:

1. **Identify slow endpoint(s)**
   - Check API dashboard for per-endpoint latency
   - Focus on outliers

2. **Check external dependencies**

   ```bash
   # Modal response times
   curl -w "%{time_total}\n" -o /dev/null \
     -X POST https://dbellan1291--coding-agent-sandbox-health-dev.modal.run

   # Convex response times
   curl -w "%{time_total}\n" -o /dev/null \
     https://cheery-anaconda-510.convex.site/api/health
   ```

3. **Check for resource constraints**
   - Cloudflare Workers CPU time (check dashboard)
   - Modal sandbox resource usage

4. **If cold start issue**:
   - First request to a DO is slower
   - Consider implementing warm-up requests

5. **If Modal is slow**:
   - Check Modal dashboard for queue depth
   - Large repos take longer to clone
   - Consider caching or pre-warming

---

### Issue: Authentication Failures

**Symptoms**:

- Users can't log in
- "Unauthorized" errors
- Token validation failing

**Runbook**:

1. **Check auth provider status**
   - GitHub status: https://www.githubstatus.com/
   - Better Auth / Convex auth logs

2. **Check token validation**

   ```bash
   npx convex logs | grep "validate-token"
   ```

3. **Common causes**:

   **a) GitHub OAuth app misconfigured**
   - Check OAuth callback URL
   - Verify client ID/secret

   **b) Convex auth issues**
   - Check auth.ts and auth.config.ts
   - Verify Convex deployment

   **c) Token expired**
   - Check token expiry logic
   - Session tokens should refresh

4. **If OAuth callback failing**:
   - Check browser network tab for callback response
   - Verify redirect URIs in GitHub OAuth app settings

---

## 4. Service-Specific Debugging

### Cloudflare Workers

**Dashboard**: https://dash.cloudflare.com/

**Key Metrics**:

- Requests/min
- Error rate
- CPU time
- Durable Object storage

**Logs**:

```bash
# Real-time logs
wrangler tail --env production

# Filter by status
wrangler tail --env production --filter "status>=400"

# Filter by path
wrangler tail --env production --filter "pathname:/sessions"
```

**Common Issues**:

- DO storage limits (128KB per key)
- CPU time limits (50ms per request)
- Memory limits (128MB)

---

### Modal Sandbox

**Dashboard**: https://modal.com/apps

**Key Metrics**:

- Active sandboxes
- Boot time
- Memory usage
- Network I/O

**Logs**:

```bash
# All logs
modal app logs coding-agent-sandbox

# Filter by function
modal app logs coding-agent-sandbox --function create_sandbox
```

**Common Issues**:

- Cold start latency (first request slow)
- Resource limits exceeded
- Network timeout during repo clone
- OpenCode process crashes

---

### Convex Backend

**Dashboard**: https://dashboard.convex.dev/

**Key Metrics**:

- Function calls/min
- Errors
- Database reads/writes
- Bandwidth

**Logs**:

```bash
# Stream logs
npx convex logs

# Filter by function
npx convex logs --function sessions:createSession
```

**Common Issues**:

- Rate limiting (too many writes)
- Function timeout (10s limit)
- Database size limits

---

### Web Frontend

**Tools**: Browser DevTools, Sentry

**Key Checks**:

- Console errors (DevTools → Console)
- Network requests (DevTools → Network)
- React state (React DevTools)
- WebSocket connection (Network → WS)

**Common Issues**:

- JavaScript bundle errors
- API connection failures
- State synchronization bugs
- Rendering errors (ErrorBoundary catches these)

---

## 5. Communication Templates

### Initial Status Update (P0/P1)

```
🔴 INCIDENT: [Brief Description]

Status: Investigating
Severity: P0/P1
Started: [Time UTC]

Impact:
[What users are experiencing]

Current Actions:
[What we're doing right now]

Next Update: [Time] or when we have more information

Incident Lead: @[name]
```

### Progress Update

```
🟡 UPDATE: [Brief Description]

Status: Identified / Mitigating
Severity: P0/P1
Duration: [X minutes]

Root Cause:
[What we found]

Actions Taken:
- [Action 1]
- [Action 2]

Next Steps:
[What we're doing next]

Next Update: [Time]
```

### Resolution Update

```
🟢 RESOLVED: [Brief Description]

Status: Resolved
Duration: [Total time]

Root Cause:
[Brief explanation]

Resolution:
[What fixed it]

Impact Summary:
- Duration: [X minutes]
- Users affected: [estimate]

Follow-up:
- Postmortem scheduled for [date]
- Issue created: #[number]
```

### Status Page Update

```
[Investigating|Identified|Monitoring|Resolved]

[Time] - [Status message]

Example:
Investigating - We are investigating reports of slow session creation.
Identified - The issue has been identified as a Modal infrastructure delay.
Monitoring - A fix has been deployed. We are monitoring for recovery.
Resolved - Session creation is operating normally.
```

---

## 6. Postmortem Process

### When to Write a Postmortem

- **Required**: All P0 and P1 incidents
- **Recommended**: P2 incidents with interesting learnings
- **Optional**: P3 incidents if there's a pattern

### Timeline

| Day     | Action                                   |
| ------- | ---------------------------------------- |
| Day 0   | Incident resolved, create postmortem doc |
| Day 1-2 | Fill in timeline and root cause          |
| Day 3   | Review with team                         |
| Day 5   | Finalize and share broadly               |

### Postmortem Template

```markdown
# Incident Postmortem: [Title]

**Date**: YYYY-MM-DD
**Duration**: X hours Y minutes
**Severity**: P0/P1/P2
**Author**: @handle
**Reviewers**: @handle1, @handle2
**Status**: Draft / Reviewed / Final

---

## Executive Summary

[2-3 sentences describing what happened, impact, and resolution]

---

## Impact

| Metric           | Value              |
| ---------------- | ------------------ |
| Duration         | X minutes          |
| Users Affected   | ~Y                 |
| Errors Generated | Z                  |
| Revenue Impact   | $N (if applicable) |

---

## Timeline (UTC)

| Time  | Event                                  |
| ----- | -------------------------------------- |
| HH:MM | [First symptom observed / alert fired] |
| HH:MM | [Incident acknowledged]                |
| HH:MM | [Investigation started]                |
| HH:MM | [Root cause identified]                |
| HH:MM | [Mitigation applied]                   |
| HH:MM | [Service restored]                     |
| HH:MM | [All clear declared]                   |

---

## Root Cause

[Detailed technical explanation of what went wrong]

### Contributing Factors

1. [Factor 1]
2. [Factor 2]

---

## Resolution

[What was done to fix the immediate issue]

---

## Detection

**How was this detected?**

- [ ] Automated alert
- [ ] Customer report
- [ ] Internal observation
- [ ] Other: \_\_\_

**Detection time**: X minutes from start of incident

**Could we have detected this faster?**
[Yes/No - explanation]

---

## Response Analysis

### What Went Well

- [Thing that worked]
- [Thing that worked]

### What Went Poorly

- [Thing that didn't work]
- [Thing that didn't work]

### Where We Got Lucky

- [Thing that could have been worse]

---

## Action Items

| Action                  | Owner   | Priority | Due Date   | Status |
| ----------------------- | ------- | -------- | ---------- | ------ |
| [Add monitoring for X]  | @handle | P1       | YYYY-MM-DD | Open   |
| [Fix bug that caused Y] | @handle | P1       | YYYY-MM-DD | Open   |
| [Update runbook for Z]  | @handle | P2       | YYYY-MM-DD | Open   |
| [Add test for W]        | @handle | P2       | YYYY-MM-DD | Open   |

---

## Lessons Learned

[Key takeaways that should inform future work]

---

## Appendix

### Supporting Data

[Graphs, logs, screenshots]

### Related Incidents

[Links to similar past incidents]
```

### Blameless Culture

Postmortems are about **learning, not blaming**. Guidelines:

1. **Focus on systems, not individuals**
   - "The deploy process didn't catch this" NOT "Bob deployed broken code"

2. **Assume good intentions**
   - Everyone was trying to do the right thing

3. **Ask "how" not "who"**
   - "How did this get to production?" NOT "Who approved this PR?"

4. **Look for systemic fixes**
   - If a human could make this mistake, the system should prevent it

5. **Share broadly**
   - Postmortems are learning opportunities for the whole organization

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────────────┐
│                    INCIDENT QUICK REFERENCE                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  DASHBOARDS                                                          │
│  • Sentry: sentry.io/tabbi                                          │
│  • Cloudflare: dash.cloudflare.com                                  │
│  • Modal: modal.com/apps                                            │
│  • Convex: dashboard.convex.dev                                     │
│                                                                      │
│  LOGS                                                                │
│  • Cloudflare: wrangler tail --env production                       │
│  • Modal: modal app logs coding-agent-sandbox                       │
│  • Convex: npx convex logs                                          │
│                                                                      │
│  ROLLBACK                                                            │
│  • Cloudflare: wrangler rollback --env production                   │
│  • Vercel: Dashboard → Deployments → Promote                        │
│  • Modal: git checkout <prev> && modal deploy                       │
│                                                                      │
│  CONTACTS                                                            │
│  • On-call: #incidents channel                                      │
│  • Escalation: @eng-lead                                            │
│  • External: support@tabbi.dev                                      │
│                                                                      │
│  STATUS PAGE                                                         │
│  • Update: status.tabbi.dev/admin                                   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```
