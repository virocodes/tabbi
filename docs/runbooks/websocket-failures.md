# Runbook: WebSocket Connection Failures

**Alert**: `websocket.connection_failures > 10/min`
**Severity**: P1

## Symptoms

- Users stuck on "Connecting..."
- "Not connected" errors in UI
- WebSocket upgrade failures in logs

## Quick Diagnosis

```bash
# 1. Check WebSocket upgrades
wrangler tail --env production --filter "ws" | head -20

# 2. Test endpoint manually
curl -I https://api.tabbi.dev/sessions/test/ws
# Expected: 426 Upgrade Required (this is correct)

# 3. Check CORS configuration
grep ALLOWED_ORIGINS cloudflare/wrangler.toml
```

## Common Causes

### CORS Misconfiguration

```bash
# Check if production domain is in ALLOWED_ORIGINS
# Should include: https://tabbi.dev,https://www.tabbi.dev
```

### Durable Object Issues

```bash
# Check DO errors
wrangler tail --env production --filter "DurableObject"
```

### Cloudflare Outage

- Check: https://www.cloudflarestatus.com/

## Resolution Steps

### Fix CORS:

1. Update `cloudflare/wrangler.toml` ALLOWED_ORIGINS
2. Deploy: `wrangler deploy --env production`

### DO Issues:

1. Check if specific session is affected
2. May need to wait for DO to recover
3. Users can try creating new session

## Verification

- WebSocket connections succeed
- Users can connect to chat
- No CORS errors in browser console

## Escalation

If affecting > 50% of connections, escalate immediately
