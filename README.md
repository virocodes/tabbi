# Tabbi

An AI-powered coding agent platform that lets you interact with an AI assistant to work on your GitHub repositories in isolated cloud sandboxes.

## Features

- **GitHub Integration** - Sign in with GitHub and select any of your repositories
- **Isolated Sandboxes** - Each session runs in a secure Modal sandbox with your repo cloned
- **Real-time Streaming** - Watch the AI work in real-time via WebSocket updates
- **Session Persistence** - Pause and resume sessions with filesystem snapshots
- **Automatic Branch Creation** - Changes are made on a dedicated branch for easy PR creation

## Architecture

```
┌─────────────┐     WebSocket      ┌──────────────────┐     HTTP      ┌─────────────────┐
│   React     │◄──────────────────►│   Cloudflare     │◄────────────►│     Modal       │
│   Frontend  │                    │   Workers (DO)   │              │    Sandboxes    │
└─────────────┘                    └──────────────────┘              └─────────────────┘
       │                                   │                                │
       │                                   │                                │
       ▼                                   ▼                                ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              Convex Backend                                          │
│                    (Auth, Sessions, Messages, GitHub Tokens)                        │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Components

| Component | Technology | Purpose |
|-----------|------------|---------|
| **web/** | React + Vite + TypeScript | Frontend application |
| **cloudflare/** | Cloudflare Workers + Durable Objects + Hono | API layer and session management |
| **modal/** | Modal + Python | Isolated sandbox environments running OpenCode |
| **convex/** | Convex | Backend database, auth, and real-time sync |

## Getting Started

### Prerequisites

- Node.js 20+
- Python 3.11+
- Accounts: [Cloudflare](https://cloudflare.com), [Modal](https://modal.com), [Convex](https://convex.dev), [GitHub OAuth App](https://github.com/settings/developers)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/virocodes/tabbi.git
   cd tabbi
   ```

2. **Install dependencies**
   ```bash
   # Root dependencies (Convex)
   npm install

   # Web frontend
   cd web && npm install && cd ..

   # Cloudflare worker
   cd cloudflare && npm install && cd ..

   # Modal sandbox
   cd modal && pip install -r requirements.txt && cd ..
   ```

3. **Configure environment variables**

   Copy the example files and fill in your values:
   ```bash
   cp .env.example .env
   cp web/.env.example web/.env
   ```

4. **Set up Convex**
   ```bash
   npx convex dev
   ```

   Then set environment variables in the Convex dashboard:
   - `SITE_URL`
   - `BETTER_AUTH_SECRET`
   - `AUTH_GITHUB_ID`
   - `AUTH_GITHUB_SECRET`

5. **Deploy Modal sandbox**
   ```bash
   cd modal
   modal deploy sandbox.py
   ```

6. **Start development servers**
   ```bash
   # Terminal 1: Convex
   npx convex dev

   # Terminal 2: Cloudflare Worker
   cd cloudflare && npm run dev

   # Terminal 3: Web frontend
   cd web && npm run dev
   ```

7. **Open the app**

   Navigate to `http://localhost:3000`

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for comprehensive production deployment instructions.

## Development Commands

### Web Frontend
```bash
cd web
npm run dev          # Start dev server (port 3000)
npm run build        # Production build
npm run preview      # Preview production build
```

### Cloudflare Worker
```bash
cd cloudflare
npm run dev          # Start local dev server (port 8787)
npm run deploy       # Deploy to Cloudflare
npm run typecheck    # Type checking
```

### Modal Sandbox
```bash
cd modal
modal serve sandbox.py    # Development with hot reload
modal deploy sandbox.py   # Production deployment
```

### Convex Backend
```bash
npx convex dev       # Development with hot reload
npx convex deploy    # Production deployment
```

## Session States

```
idle → starting → running ⟷ paused → error
```

- **idle** - No active sandbox
- **starting** - Creating sandbox and cloning repo
- **running** - Sandbox active, ready for prompts
- **paused** - Sandbox snapshotted, can resume
- **error** - Something went wrong

## License

MIT


