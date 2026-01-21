# Runbook: Session Creation Failures

**Alert**: `session.creation.success_rate < 95%`
**Severity**: P1

## Symptoms

- Sessions stuck in "starting" state
- "Failed to create session" errors
- Timeout errors in logs

## Quick Diagnosis

```bash
# 1. Check session creation rate
# Dashboard: Session Lifecycle → Success Rate

# 2. Check Modal sandbox logs
modal app logs coding-agent-sandbox | grep "create_sandbox" | tail -20

# 3. Check for timeout errors
modal app logs coding-agent-sandbox | grep -i "timeout" | tail -10
```

## Common Causes

### GitHub Token Issues

```bash
# Check Convex for token errors
npx convex logs | grep "github" | tail -20
```

**Fix**: User needs to re-authenticate

### Modal Timeout

- Large repo taking too long to clone
- Modal resources constrained

```bash
# Check Modal status
modal app list | grep coding-agent
```

### OpenCode Health Check Failing

```bash
# Check health check logs
modal app logs coding-agent-sandbox | grep "health" | tail -20
```

## Resolution Steps

### Modal Issues:

```bash
# Restart Modal app
modal app stop coding-agent-sandbox
modal deploy sandbox.py
```

### GitHub Auth:

1. Check OAuth app settings in GitHub
2. Verify callback URLs are correct
3. Ask user to sign out and back in

### Resource Constraints:

1. Check Modal dashboard for queue depth
2. Consider scaling Modal resources
3. Add caching for frequently-cloned repos

## Verification

- New sessions create successfully
- Success rate returns to > 98%
- Sandbox boot time < 30s

## Escalation

If Modal is unresponsive, check Modal status page and contact support
