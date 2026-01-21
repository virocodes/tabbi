# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a coding agent application with three components:

- **web/** - React frontend (Vite + TypeScript)
- **cloudflare/** - API backend (Cloudflare Workers + Durable Objects + Hono)
- **modal/** - Sandbox runtime (Modal Python sandboxes running OpenCode server)

## Architecture

The system enables browser-based coding sessions where users can interact with an AI coding agent:

1. **Web Client** connects via WebSocket to the Cloudflare API
2. **SessionAgent Durable Object** manages session state, spawns Modal sandboxes, and proxies to OpenCode
3. **SessionRegistry Durable Object** tracks all sessions for the sidebar
4. **Modal Sandbox** runs OpenCode server in an isolated container with the cloned repository

Data flow: User prompt -> WebSocket -> SessionAgent DO -> OpenCode SSE events -> WebSocket broadcast -> UI update

## Development Commands

### Web (port 3000)

```bash
cd web
npm install
VITE_API_URL=http://localhost:8787 npm run dev
npm run build        # TypeScript compile + Vite build
```

### Cloudflare Workers (port 8787)

```bash
cd cloudflare
npm install
npm run dev          # wrangler dev
npm run deploy       # wrangler deploy
npm run typecheck    # tsc --noEmit
```

### Modal Backend

```bash
cd modal
pip install -r requirements.txt
modal serve sandbox.py   # Development server (hot reload)
modal deploy sandbox.py  # Production deployment
```

## Key Files

- `cloudflare/src/agent.ts` - SessionAgent DO: sandbox lifecycle, OpenCode SSE streaming, WebSocket broadcast
- `cloudflare/src/registry.ts` - SessionRegistry DO: session list for sidebar
- `cloudflare/src/index.ts` - Hono HTTP routes and WebSocket upgrade handler
- `cloudflare/wrangler.toml` - Durable Object bindings and Modal API URL config
- `modal/sandbox.py` - Modal sandbox functions: create, pause (snapshot), resume, terminate
- `web/src/hooks/useSession.ts` - WebSocket connection and state management

## Environment Variables

- Root `.env`: `OPENAI_API_KEY` (used by OpenCode in sandbox)
- Web: `VITE_API_URL` defaults to `http://localhost:8787`
- Cloudflare: `MODAL_API_URL` configured in wrangler.toml

## Session States

`idle` -> `starting` -> `running` <-> `paused` -> `error`

Pause creates a filesystem snapshot; resume restores from snapshot into new sandbox.
