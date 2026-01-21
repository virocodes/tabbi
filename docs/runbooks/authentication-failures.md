# Runbook: Authentication Failures

**Alert**: `auth.failures > 10/min`
**Severity**: P1

## Symptoms

- Users can't log in
- "Unauthorized" errors
- Token validation failures

## Quick Diagnosis

```bash
# 1. Check auth provider status
# GitHub: https://www.githubstatus.com/

# 2. Check Convex auth logs
npx convex logs | grep -E "auth|token" | tail -20

# 3. Check token validation
npx convex logs | grep "validate-token" | tail -10
```

## Common Causes

### GitHub OAuth Misconfigured

- Wrong callback URL
- Client ID/secret changed
- OAuth app disabled

### Token Expired/Invalid

```bash
# Check token expiry logic in Convex
npx convex logs | grep "expired" | tail -10
```

### Convex Auth Issues

- Better Auth configuration
- Session management bugs

## Resolution Steps

### GitHub OAuth Issues:

1. Go to GitHub → Settings → Developer settings → OAuth Apps
2. Verify:
   - Homepage URL: `https://tabbi.dev`
   - Callback URL: `https://cheery-anaconda-510.convex.site/api/auth/callback/github`
3. Check client ID matches environment

### Token Issues:

1. Check token creation in `convex/tokens.ts`
2. Verify expiry calculation
3. Check token refresh logic

### Session Issues:

1. Check `convex/auth.ts` configuration
2. Verify Better Auth setup
3. Check session storage

## Verification

- Users can log in successfully
- API requests are authenticated
- No auth errors in Convex logs

## Escalation

If GitHub OAuth app issue, may need org admin access
