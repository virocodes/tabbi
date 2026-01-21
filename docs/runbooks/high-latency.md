# Runbook: High Latency

**Alert**: `api.latency.p95 > 2s`
**Severity**: P2 (P1 if > 5s)

## Symptoms

- Slow API responses
- Users reporting lag
- Dashboard showing latency spike

## Quick Diagnosis

```bash
# 1. Identify slow endpoint(s)
# Dashboard: API Health → Latency by Endpoint

# 2. Check external dependency latency
curl -w "Total: %{time_total}s\n" -o /dev/null -s \
  -X POST https://dbellan1291--coding-agent-sandbox-health-dev.modal.run

# 3. Check Cloudflare CPU time
# Dashboard: Cloudflare → Workers → CPU Time
```

## Common Causes

### Cold Start

- First request to hibernated DO is slow
- First Modal request after idle period

### External Dependency Slow

```bash
# Test Modal
curl -w "%{time_total}\n" -o /dev/null -s \
  https://dbellan1291--coding-agent-sandbox-health-dev.modal.run

# Test Convex
curl -w "%{time_total}\n" -o /dev/null -s \
  https://cheery-anaconda-510.convex.site/api/health
```

### Large Payload

- Big messages or tool outputs
- Check response sizes in logs

### Resource Exhaustion

- Cloudflare CPU limits (50ms)
- Modal memory limits

## Resolution Steps

### If Cold Start:

- Implement warm-up requests
- Consider always-on DO (costs more)

### If Modal Slow:

1. Check Modal dashboard
2. Reduce repo clone time (shallow clone)
3. Scale Modal resources

### If Convex Slow:

1. Check Convex dashboard
2. Review query patterns
3. Add indexes if needed

### If Large Payloads:

1. Implement pagination
2. Truncate large tool outputs
3. Compress responses

## Verification

- P95 latency < 500ms
- No timeouts
- User experience feels responsive

## Escalation

If latency persists > 1 hour, investigate deeper or escalate
