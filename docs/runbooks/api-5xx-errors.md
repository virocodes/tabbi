# Runbook: API 5xx Errors

**Alert**: `api.error_rate > 5%`
**Severity**: P1 if > 5%, P0 if > 50%

## Symptoms

- Elevated error rate in dashboard
- Users seeing "Something went wrong"
- 500/502/503 responses

## Quick Diagnosis

```bash
# 1. Check error rate and recent errors
wrangler tail --env production --filter "status>=500" | head -20

# 2. Check Sentry for stack traces
# Go to: sentry.io/tabbi → Issues → Filter by "api"

# 3. Check recent deployments
wrangler deployments list --env production
```

## Resolution Steps

### If deployment-related:

```bash
wrangler rollback --env production
```

### If external dependency:

1. Check Modal: `modal app list`
2. Check Convex: `npx convex logs | tail -20`
3. Check GitHub: https://www.githubstatus.com/

### If code bug:

1. Identify failing endpoint from logs
2. Create hotfix PR
3. Fast-track review and deploy

## Verification

- Error rate returns to < 1%
- No new errors in Sentry
- Monitor for 10 minutes

## Escalation

If not resolved in 30 minutes, escalate to @eng-lead
