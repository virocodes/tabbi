# Deployment Guide

This guide covers deploying all four components of the tabbi coding agent application to production.

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Web Frontend  │────▶│ Cloudflare Workers│────▶│  Modal Sandbox  │
│   (Vercel/CF)   │     │  + Durable Objects│     │   (OpenCode)    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
         │                       │
         │                       │
         ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Convex Backend                              │
│  (Auth, Sessions, Messages, GitHub Token Storage)                │
└─────────────────────────────────────────────────────────────────┘
```

**Data Flow:**

1. User authenticates via GitHub OAuth (Convex + Better Auth)
2. User creates session → Convex stores session, generates API token
3. Frontend connects to Cloudflare Worker via WebSocket
4. Worker creates Modal sandbox with cloned repo
5. Worker streams OpenCode responses back to frontend
6. Messages synced to Convex for persistence

## Prerequisites

### Accounts Required

- [Convex](https://convex.dev) - Backend database and auth
- [Cloudflare](https://cloudflare.com) - Workers and Durable Objects
- [Modal](https://modal.com) - Sandbox compute
- [GitHub](https://github.com) - OAuth App for authentication
- [Vercel](https://vercel.com) or Cloudflare Pages - Frontend hosting
- [OpenAI](https://openai.com) - API key for OpenCode

### Tools Required

```bash
# Node.js 18+
node --version

# Convex CLI
npm install -g convex

# Cloudflare Wrangler CLI
npm install -g wrangler

# Modal CLI
pip install modal
modal token new

# Verify installations
convex --version
wrangler --version
modal --version
```

---

## Phase 1: GitHub OAuth App Setup

Create a GitHub OAuth App for authentication.

### 1.1 Create OAuth App

1. Go to GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. Fill in:
   - **Application name:** `tabbi` (or your app name)
   - **Homepage URL:** `https://your-domain.com`
   - **Authorization callback URL:** `https://<your-convex-site>.convex.site/api/auth/callback/github`
3. Click "Register application"
4. Generate a new client secret
5. Save both values:
   - `Client ID` → `AUTH_GITHUB_ID`
   - `Client Secret` → `AUTH_GITHUB_SECRET`

### 1.2 Required Scopes

The app requests these GitHub scopes:

- `repo` - Full access to repositories (for cloning and pushing)
- `user:email` - Read user email address

---

## Phase 2: Convex Backend Deployment

Convex must be deployed first as it handles authentication and provides tokens for other services.

### 2.1 Create Convex Project

```bash
cd /path/to/project
npx convex dev
# Follow prompts to create a new project
# Note the deployment URL: https://<project-name>.convex.cloud
```

### 2.2 Set Environment Variables

In the [Convex Dashboard](https://dashboard.convex.dev):

1. Select your project
2. Go to Settings → Environment Variables
3. Add the following:

| Variable             | Value                     | Description                  |
| -------------------- | ------------------------- | ---------------------------- |
| `SITE_URL`           | `https://your-domain.com` | Your production frontend URL |
| `AUTH_GITHUB_ID`     | `Iv1.abc123...`           | GitHub OAuth Client ID       |
| `AUTH_GITHUB_SECRET` | `abc123secret...`         | GitHub OAuth Client Secret   |

### 2.3 Deploy Convex Functions

```bash
npx convex deploy
```

### 2.4 Note Your Convex URLs

After deployment, note these URLs (from Convex Dashboard):

- **Convex URL:** `https://<project>.convex.cloud` → `VITE_CONVEX_URL`
- **Site URL:** `https://<project>.convex.site` → `VITE_CONVEX_SITE_URL`

### 2.5 Update GitHub OAuth Callback

Update your GitHub OAuth App's callback URL to:

```
https://<project>.convex.site/api/auth/callback/github
```

---

## Phase 3: Modal Sandbox Deployment

Modal provides the isolated sandbox environments where OpenCode runs.

### 3.1 Create Modal Secrets

```bash
# Create secret for OpenAI API key
modal secret create openai-key OPENAI_API_KEY=sk-your-openai-key
```

### 3.2 Deploy Modal Functions

```bash
cd modal
modal deploy sandbox.py
```

### 3.3 Note Your Modal URLs

After deployment, Modal shows endpoints like:

```
https://<username>--coding-agent-sandbox-api-create-sandbox.modal.run
https://<username>--coding-agent-sandbox-api-pause-sandbox.modal.run
https://<username>--coding-agent-sandbox-api-resume-sandbox.modal.run
https://<username>--coding-agent-sandbox-api-terminate-sandbox.modal.run
```

The base URL pattern is:

```
https://<username>--coding-agent-sandbox
```

This becomes your `MODAL_API_URL`.

**Note:** Remove `-dev` suffix for production deployments.

---

## Phase 4: Cloudflare Workers Deployment

### 4.1 Login to Cloudflare

```bash
wrangler login
```

### 4.2 Configure wrangler.toml

Update `cloudflare/wrangler.toml` with production values:

```toml
name = "coding-agent-api"
main = "src/index.ts"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]

# Production environment
[env.production]
name = "coding-agent-api-production"

[env.production.vars]
MODAL_API_URL = "https://<username>--coding-agent-sandbox"
CONVEX_SITE_URL = "https://<project>.convex.site"

[[env.production.durable_objects.bindings]]
name = "SESSION_AGENT"
class_name = "SessionAgent"

[[env.production.migrations]]
tag = "v1"
new_classes = ["SessionAgent"]
```

### 4.3 Deploy to Production

```bash
cd cloudflare
wrangler deploy --env production
```

### 4.4 Note Your Worker URL

After deployment, note the worker URL:

```
https://coding-agent-api-production.<account>.workers.dev
```

This becomes your `VITE_API_URL`.

### 4.5 (Optional) Custom Domain

To use a custom domain for the API:

1. Go to Cloudflare Dashboard → Workers & Pages
2. Select your worker
3. Go to Triggers → Custom Domains
4. Add your domain (e.g., `api.your-domain.com`)

---

## Phase 5: Web Frontend Deployment

### 5.1 Environment Variables

Create production environment variables:

```bash
cd web

# Create .env.production
cat > .env.production << EOF
VITE_API_URL=https://coding-agent-api-production.<account>.workers.dev
VITE_CONVEX_URL=https://<project>.convex.cloud
VITE_CONVEX_SITE_URL=https://<project>.convex.site
EOF
```

### 5.2 Build for Production

```bash
npm install
npm run build
```

### 5.3 Deploy to Vercel

```bash
# Install Vercel CLI if needed
npm install -g vercel

# Deploy
vercel --prod
```

Or connect your GitHub repo to Vercel for automatic deployments.

**Vercel Environment Variables:**
In Vercel Dashboard → Project Settings → Environment Variables, add:

- `VITE_API_URL`
- `VITE_CONVEX_URL`
- `VITE_CONVEX_SITE_URL`

### 5.4 Alternative: Cloudflare Pages

```bash
# Build
npm run build

# Deploy to Cloudflare Pages
wrangler pages deploy dist --project-name=tabbi
```

---

## Phase 6: Verification

### 6.1 Check Convex

```bash
# Verify functions are deployed
npx convex functions

# Check logs
npx convex logs
```

### 6.2 Check Modal

```bash
# Check deployed functions
modal app list

# View logs
modal app logs coding-agent-sandbox
```

### 6.3 Check Cloudflare Worker

```bash
# View logs
wrangler tail --env production
```

### 6.4 End-to-End Test

1. Visit your production frontend URL
2. Click "Get started" → Should redirect to login
3. Click "Continue with GitHub" → Should redirect to GitHub OAuth
4. Authorize the app → Should redirect back and show your repos
5. Select a repo and type a message
6. Session should start (yellow indicator)
7. Message should be sent when ready (green indicator)
8. OpenCode should respond with code suggestions

---

## Environment Variables Summary

### Convex Dashboard

| Variable             | Example             | Description                |
| -------------------- | ------------------- | -------------------------- |
| `SITE_URL`           | `https://tabbi.app` | Production frontend URL    |
| `AUTH_GITHUB_ID`     | `Iv1.abc123`        | GitHub OAuth Client ID     |
| `AUTH_GITHUB_SECRET` | `secret123`         | GitHub OAuth Client Secret |

### Modal Secrets

| Secret Name  | Variable         | Description                 |
| ------------ | ---------------- | --------------------------- |
| `openai-key` | `OPENAI_API_KEY` | OpenAI API key for OpenCode |

### Cloudflare Workers (wrangler.toml)

| Variable          | Example                              | Description              |
| ----------------- | ------------------------------------ | ------------------------ |
| `MODAL_API_URL`   | `https://user--coding-agent-sandbox` | Modal endpoints base URL |
| `CONVEX_SITE_URL` | `https://project.convex.site`        | Convex HTTP actions URL  |

### Web Frontend (.env.production)

| Variable               | Example                        | Description           |
| ---------------------- | ------------------------------ | --------------------- |
| `VITE_API_URL`         | `https://api.tabbi.app`        | Cloudflare Worker URL |
| `VITE_CONVEX_URL`      | `https://project.convex.cloud` | Convex client URL     |
| `VITE_CONVEX_SITE_URL` | `https://project.convex.site`  | Convex auth URL       |

---

## Security Checklist

### Before Going Live

- [ ] **Rotate any exposed secrets** - If any keys were committed to git
- [ ] **Verify .gitignore** - Ensure `.env` files are not tracked
- [ ] **Update CORS origins** - Remove localhost from production config
- [ ] **Enable rate limiting** - Implement on Cloudflare Worker
- [ ] **Review GitHub OAuth scopes** - Only request necessary permissions
- [ ] **Set up monitoring** - Error tracking (Sentry), logs, alerts

### Convex Security

- [ ] Verify all queries check authentication
- [ ] Verify mutations check authorization (user owns resource)
- [ ] Token expiration is set (currently 1 hour)

### Cloudflare Security

- [ ] CORS configured for production domain only
- [ ] WebSocket connections require valid token
- [ ] Input validation on all endpoints

### Modal Security

- [ ] Secrets managed via Modal's secret system
- [ ] Sandbox timeout configured (10 minutes)
- [ ] No sensitive data in logs

---

## Monitoring & Operations

### Logs

```bash
# Convex logs
npx convex logs --follow

# Cloudflare Worker logs
wrangler tail --env production

# Modal logs
modal app logs coding-agent-sandbox
```

### Health Checks

**Cloudflare Worker:**

```bash
curl https://your-api.workers.dev/health
# Should return: {"status":"ok"}
```

**Modal Sandbox:**

```bash
# Health check happens automatically via Cloudflare Worker
# Check logs for "OpenCode server is ready!" messages
```

### Common Issues

**1. Session stuck in "starting"**

- Check Modal logs for sandbox creation errors
- Verify OPENAI_API_KEY is set in Modal secrets
- Check if GitHub token is valid

**2. Authentication fails**

- Verify GitHub OAuth callback URL matches Convex site URL
- Check AUTH_GITHUB_ID and AUTH_GITHUB_SECRET in Convex
- Ensure SITE_URL matches your frontend domain

**3. WebSocket connection fails**

- Check CORS configuration in Cloudflare Worker
- Verify API token is valid (not expired)
- Check Cloudflare Worker logs for errors

**4. Sandbox times out**

- Sessions auto-pause after 9 minutes of inactivity
- Resume happens automatically when sending new message
- Check for snapshot ID in Convex session record

---

## Rollback Procedure

### Convex

```bash
# Convex keeps version history
# Contact Convex support for rollback
```

### Cloudflare

```bash
# View deployments
wrangler deployments list --env production

# Rollback to previous
wrangler rollback --env production
```

### Modal

```bash
# Redeploy previous version from git
git checkout <previous-commit>
cd modal
modal deploy sandbox.py
```

### Frontend (Vercel)

- Go to Vercel Dashboard → Deployments
- Click "..." on previous deployment → "Promote to Production"

---

## Cost Considerations

### Convex

- Free tier: 1M function calls/month
- Paid: $25/month for additional usage

### Cloudflare Workers

- Free tier: 100k requests/day
- Paid: $5/month for 10M requests

### Modal

- Free tier: $30/month credits
- Pay-as-you-go after credits
- Sandbox costs: ~$0.001-0.01 per minute depending on resources

### Vercel

- Free tier: 100GB bandwidth/month
- Paid: $20/month for teams

---

## Support

- **Convex:** [Discord](https://convex.dev/community)
- **Cloudflare:** [Community Forums](https://community.cloudflare.com)
- **Modal:** [Slack Community](https://modal.com/slack)
- **Application Issues:** [GitHub Issues](https://github.com/your-repo/issues)
