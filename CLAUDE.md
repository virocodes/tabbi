# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a coding agent application with four components:

- **web/** - React frontend (Vite + TypeScript)
- **cloudflare/** - API backend (Cloudflare Workers + Durable Objects + Hono)
- **modal/** - Sandbox runtime (Modal Python sandboxes running OpenCode server)
- **convex/** - Backend database and auth (Convex TypeScript functions)

## Architecture

The system enables browser-based coding sessions where users can interact with an AI coding agent:

1. **Web Client** authenticates via GitHub OAuth (Convex + Better Auth)
2. **Web Client** connects via WebSocket to the Cloudflare API
3. **SessionAgent Durable Object** manages session state, spawns Modal sandboxes, and proxies to OpenCode
4. **SessionRegistry Durable Object** tracks all sessions for the sidebar
5. **Modal Sandbox** runs OpenCode server in an isolated container with the cloned repository
6. **Convex Backend** stores sessions, messages, API tokens, and encrypted user API keys

Data flow: User prompt -> WebSocket -> SessionAgent DO -> Modal Sandbox (OpenCode) -> SSE events -> WebSocket broadcast -> UI update -> Convex sync

## Development Commands

### Convex Backend (Terminal 1)

```bash
npx convex dev           # Start Convex dev server
npx convex deploy -y     # Deploy to production
```

### Modal Backend (Terminal 2)

```bash
cd modal
pip install -r requirements.txt
modal serve sandbox.py   # Development server (hot reload)
modal deploy sandbox.py  # Production deployment
```

### Cloudflare Workers (Terminal 3 - port 8787)

```bash
cd cloudflare
npm install
npm run dev          # wrangler dev
npm run deploy       # wrangler deploy
npm run typecheck    # tsc --noEmit
```

### Web (Terminal 4 - port 3000)

```bash
cd web
npm install
npm run dev          # Vite dev server (uses .env.local)
npm run build        # TypeScript compile + Vite build
```

## Key Files

### Cloudflare Worker

- `cloudflare/src/agent.ts` - SessionAgent DO: sandbox lifecycle, OpenCode SSE streaming, WebSocket broadcast, API key fetching
- `cloudflare/src/registry.ts` - SessionRegistry DO: session list for sidebar
- `cloudflare/src/index.ts` - Hono HTTP routes and WebSocket upgrade handler
- `cloudflare/wrangler.toml` - Durable Object bindings and Modal API URL config

### Modal Sandbox

- `modal/sandbox.py` - Modal sandbox functions: create (with API keys), pause (snapshot), resume, terminate

### Convex Backend

- `convex/schema.ts` - Database schema: users, sessions, messages, apiTokens, userSecrets
- `convex/userSecrets.ts` - API key CRUD operations (encrypted storage)
- `convex/lib/encryption.ts` - AES-256-GCM encryption utilities for API keys
- `convex/http.ts` - HTTP endpoints for auth and API key retrieval
- `convex/sessions.ts` - Session management with model selection

### Web Frontend

- `web/src/hooks/useSession.ts` - WebSocket connection and state management
- `web/src/components/ModelSelector.tsx` - Model selection dropdown with lock indicators
- `web/src/components/ApiKeySettingsModal.tsx` - Tab-based provider settings for API keys
- `web/src/lib/models.ts` - Available models configuration (GPT 5 Nano, Claude Sonnet/Opus 4.5, GPT 5.2/Codex)

## Environment Variables

### Convex (Dashboard)

- `ENCRYPTION_MASTER_SECRET` - Base64-encoded secret for AES-256-GCM encryption of user API keys (REQUIRED)
- `SITE_URL` - Production frontend URL (e.g., `https://tabbi.vercel.app`)
- `AUTH_GITHUB_ID` - GitHub OAuth App Client ID
- `AUTH_GITHUB_SECRET` - GitHub OAuth App Client Secret

### Web (`web/.env.local` for development)

- `VITE_API_URL` - Cloudflare Worker URL (default: `http://localhost:8787`)
- `VITE_CONVEX_URL` - Convex deployment URL (e.g., `https://<project>.convex.cloud`)
- `VITE_CONVEX_SITE_URL` - Convex site URL (e.g., `https://<project>.convex.site`)

### Cloudflare (`cloudflare/wrangler.toml`)

- `MODAL_API_URL` - Modal sandbox base URL
- `CONVEX_SITE_URL` - Convex site URL for API calls

### Modal (set via `modal secret create`)

- `MODAL_API_SECRET` - Secret for authenticating API requests (optional)

**Note:** User API keys (Anthropic, OpenAI) are now stored encrypted in Convex, not as environment variables. OpenCode receives them as environment variables when the sandbox starts.

## Model Selection & API Keys

Users can select from 5 AI models:

1. **GPT 5 Nano** (Free, default - via OpenCode)
2. **Claude Sonnet 4.5** (Requires Anthropic API key)
3. **Claude Opus 4.5** (Requires Anthropic API key)
4. **GPT 5.2** (Requires OpenAI API key)
5. **GPT 5.1 Codex** (Requires OpenAI API key)

API keys are:

- Encrypted with AES-256-GCM before storage in Convex
- Decrypted server-side when creating Modal sandboxes
- Passed as environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) to OpenCode
- Never exposed to the client

## Session States

`idle` -> `starting` -> `running` <-> `paused` -> `error`

- Sessions store selected model and provider
- Pause creates a filesystem snapshot (including env vars with API keys)
- Resume restores from snapshot into new sandbox with API keys intact
