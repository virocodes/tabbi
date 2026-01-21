# Product Requirements Document: Convex Backend Implementation

## Overview

This document outlines the implementation plan for adding Convex as the backend for the inspect-mvp coding agent application. The goal is to replace the current insecure localStorage-based PAT storage with proper GitHub OAuth authentication and add multi-user support.

## Problem Statement

### Current State

- Users manually enter GitHub Personal Access Tokens (PAT) which are stored in browser localStorage
- Sessions are identified only by UUID with no user association
- Anyone who knows a session ID can access that session
- No persistent user data storage
- Single-user experience only

### Target State

- Users authenticate via GitHub OAuth (no manual PAT entry)
- Sessions are linked to authenticated users
- Users can only access their own sessions
- GitHub access tokens stored securely in Convex (encrypted at rest)
- Multi-user support with proper data isolation
- Messages persisted in Convex for durability

---

## Architecture

### Current Architecture

```
React Frontend ──► Cloudflare Workers ──► Modal Sandbox
     │                    │                    │
     │ localStorage PAT   │ Session state     │ OpenCode server
     │                    │ (Durable Objects) │
```

### New Architecture

```
React Frontend ──────► Convex Backend ──────► Cloudflare Workers ──► Modal Sandbox
     │                       │                       │                    │
     │ OAuth + Subscriptions │ Users, Sessions      │ Real-time WS      │ OpenCode
     │                       │ Tokens, Messages     │ Session state     │
```

### Key Changes

1. **Convex** manages users, authentication, session metadata, GitHub tokens, and message history
2. **Cloudflare Workers** validate requests via Convex-issued API tokens
3. **Sessions** are linked to authenticated users via userId foreign key
4. **GitHub OAuth tokens** stored in Convex with refresh token support
5. **SessionRegistry DO** removed - Convex handles session listing with real-time subscriptions
6. **Messages** synced from Cloudflare DO to Convex after each response

---

## Database Schema

### Tables

#### Better Auth Component Tables (managed by @convex-dev/better-auth)

- `user` - Base user records
- `session` - Auth sessions
- `account` - OAuth provider accounts (stores GitHub access tokens)
- `verification` - Verification codes

#### `userProfiles`

| Field          | Type    | Description                      |
| -------------- | ------- | -------------------------------- |
| authUserId     | string  | Reference to Better Auth user ID |
| githubUsername | string  | GitHub login                     |
| githubId       | number  | GitHub numeric ID                |
| avatarUrl      | string? | GitHub avatar URL                |
| name           | string? | Display name                     |
| email          | string? | Email address                    |
| createdAt      | number  | Timestamp                        |
| updatedAt      | number  | Timestamp                        |

**Indexes:** by_authUserId, by_githubId

#### `codingSessions`

| Field        | Type    | Description                         |
| ------------ | ------- | ----------------------------------- |
| authUserId   | string  | Session owner (Better Auth user ID) |
| sessionId    | string  | UUID for Cloudflare DO              |
| repo         | string  | GitHub repo "owner/repo"            |
| title        | string? | First user message                  |
| status       | enum    | idle/starting/running/paused/error  |
| isProcessing | boolean | Currently processing prompt         |
| snapshotId   | string? | Modal snapshot ID                   |
| errorMessage | string? | Error details                       |
| createdAt    | number  | Timestamp                           |
| updatedAt    | number  | Timestamp                           |

**Indexes:** by_authUserId, by_sessionId, by_authUserId_updatedAt

#### `sessionMessages`

| Field     | Type   | Description              |
| --------- | ------ | ------------------------ |
| sessionId | string | Parent session UUID      |
| messageId | string | OpenCode message ID      |
| role      | enum   | user/assistant/system    |
| parts     | array  | Text and tool call parts |
| timestamp | number | Message timestamp        |
| createdAt | number | Sync timestamp           |

**Indexes:** by_sessionId, by_sessionId_timestamp

#### `apiTokens`

| Field      | Type   | Description                       |
| ---------- | ------ | --------------------------------- |
| authUserId | string | Token owner (Better Auth user ID) |
| tokenHash  | string | SHA-256 hash                      |
| sessionId  | string | Associated session                |
| expiresAt  | number | Expiry timestamp                  |
| createdAt  | number | Timestamp                         |

**Indexes:** by_tokenHash, by_authUserId

---

## API Design

### Convex Functions

#### Queries (Real-time subscriptions)

| Function                      | Args      | Returns     | Description          |
| ----------------------------- | --------- | ----------- | -------------------- |
| `users.getCurrentUser`        | -         | UserProfile | Current user profile |
| `sessions.listUserSessions`   | -         | Session[]   | User's sessions      |
| `sessions.getSession`         | sessionId | Session     | Single session       |
| `messages.getSessionMessages` | sessionId | Message[]   | Session messages     |

#### Mutations

| Function                       | Args                   | Returns               | Description               |
| ------------------------------ | ---------------------- | --------------------- | ------------------------- |
| `sessions.createSession`       | repo                   | {sessionId, apiToken} | Create session + token    |
| `sessions.updateSessionStatus` | sessionId, status, ... | void                  | Update status             |
| `sessions.deleteSession`       | sessionId              | void                  | Delete session + messages |

#### Internal Mutations

| Function                  | Description               |
| ------------------------- | ------------------------- |
| `messages.syncMessage`    | Sync single message       |
| `messages.syncBatch`      | Batch sync messages       |
| `users.storeUserProfile`  | Store/update user profile |
| `tokens.createApiToken`   | Generate API token        |
| `tokens.validateApiToken` | Validate token            |

#### Actions (External API calls)

| Function                | Description                         |
| ----------------------- | ----------------------------------- |
| `github.fetchUserRepos` | Fetch repos from GitHub API         |
| `github.getValidToken`  | Get token from Better Auth accounts |

#### HTTP Actions

| Endpoint              | Method | Description           |
| --------------------- | ------ | --------------------- |
| `/api/validate-token` | POST   | Validate API token    |
| `/api/github-token`   | POST   | Get GitHub token      |
| `/api/session-status` | POST   | Update session status |
| `/api/sync-message`   | POST   | Sync message from CF  |

---

## Authentication Flow

### GitHub OAuth Setup

1. Configure GitHub OAuth App with callback URL: `https://<project>.convex.site/api/auth/callback/github`
2. Request scopes: `repo user:email`
3. Store `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` in Convex environment

### Flow Steps

1. User clicks "Sign in with GitHub"
2. `authClient.signIn.social({ provider: "github" })` redirects to GitHub OAuth consent
3. User approves access
4. GitHub redirects to `/api/auth/callback/github` with code
5. Better Auth exchanges code for access token
6. Token stored automatically in Better Auth `account` table
7. Frontend receives authenticated session
8. `useConvexAuth()` returns `{isAuthenticated: true}`

---

## Data Flows

### Session Creation

```
1. User selects repo, starts session
2. Frontend calls sessions.createSession mutation
3. Convex creates codingSessions record
4. Convex generates short-lived API token
5. Frontend receives {sessionId, apiToken}
6. Frontend connects WebSocket to Cloudflare
7. Cloudflare validates token via Convex HTTP action
8. Cloudflare fetches GitHub token from Convex
9. Cloudflare creates Modal sandbox
10. SessionAgent DO manages real-time state
```

### Message Processing

```
1. User sends prompt via WebSocket
2. SessionAgent adds user message to DO state
3. SessionAgent syncs user message to Convex
4. OpenCode processes prompt
5. SessionAgent broadcasts streaming updates
6. On completion, SessionAgent syncs assistant message
7. Frontend receives real-time updates via WS
8. On reconnect, messages load from Convex
```

---

## Files to Create

### Convex Directory (`convex/`)

| File               | Purpose                        |
| ------------------ | ------------------------------ |
| `convex.config.ts` | Register Better Auth component |
| `schema.ts`        | Database schema definition     |
| `auth.ts`          | Better Auth configuration      |
| `auth.config.ts`   | JWT provider configuration     |
| `users.ts`         | User profile queries/mutations |
| `sessions.ts`      | Session CRUD operations        |
| `messages.ts`      | Message sync and retrieval     |
| `github.ts`        | GitHub API actions             |
| `tokens.ts`        | API token management           |
| `http.ts`          | HTTP actions for Cloudflare    |

## Files to Modify

### Frontend (`web/`)

| File                            | Changes                                          |
| ------------------------------- | ------------------------------------------------ |
| `package.json`                  | Add convex, @convex-dev/better-auth, better-auth |
| `src/main.tsx`                  | Wrap with ConvexBetterAuthProvider               |
| `src/lib/auth-client.ts`        | Better Auth client setup                         |
| `src/hooks/useAuth.ts`          | Replace localStorage with Better Auth            |
| `src/hooks/useSession.ts`       | Use Convex mutations, pass API token             |
| `src/hooks/useSessions.ts`      | Replace with Convex query                        |
| `src/components/GitHubAuth.tsx` | Replace PAT input with OAuth button              |
| `src/components/Sidebar.tsx`    | Use Convex subscription                          |
| `src/App.tsx`                   | Update auth flow, URL-based routing              |

### Cloudflare (`cloudflare/`)

| File              | Changes                               |
| ----------------- | ------------------------------------- |
| `wrangler.toml`   | Add CONVEX_SITE_URL env var           |
| `src/index.ts`    | Add auth middleware                   |
| `src/agent.ts`    | Fetch token from Convex, store userId |
| `src/registry.ts` | DELETE (replaced by Convex)           |

---

## Environment Variables

### Convex Dashboard

```
SITE_URL=http://localhost:3000
BETTER_AUTH_SECRET=<generated-secret>
AUTH_GITHUB_ID=<github-oauth-client-id>
AUTH_GITHUB_SECRET=<github-oauth-secret>
```

### Cloudflare (wrangler.toml)

```
CONVEX_SITE_URL=https://<project>.convex.site
```

### Web (.env)

```
VITE_CONVEX_URL=https://<project>.convex.cloud
VITE_CONVEX_SITE_URL=https://<project>.convex.site
VITE_API_URL=http://localhost:8787
```

---

## Security Considerations

1. **GitHub tokens**: Encrypted at rest in Convex, never sent to frontend
2. **API tokens**: Short-lived (1 hour), hashed in database, validated per request
3. **Session ownership**: Every query/mutation validates userId matches
4. **WebSocket auth**: Token passed via Sec-WebSocket-Protocol header
5. **HTTPS only**: All communication over TLS

---

# Implementation Checklist

## Phase 1: Project Setup

### 1.1 Initialize Convex

- [x] Run `npx convex init` in project root
- [x] Verify `convex/` directory created
- [x] Verify `.env.local` created with CONVEX_URL
- [x] Run `npx convex dev` to start dev server
- [x] Verify Convex dashboard accessible

### 1.2 Install Dependencies

- [x] Install Convex packages: `npm install convex @convex-dev/better-auth better-auth`
- [x] Verify packages in web/package.json
- [x] Run `npm install` in web directory

### 1.3 GitHub OAuth App Setup

- [x] Go to GitHub Settings > Developer settings > OAuth Apps
- [x] Create new OAuth App for development
- [x] Set Homepage URL to `http://localhost:3000`
- [x] Set Callback URL to `https://<project>.convex.site/api/auth/callback/github`
- [x] Copy Client ID
- [x] Generate and copy Client Secret
- [x] Set `AUTH_GITHUB_ID` in Convex environment
- [x] Set `AUTH_GITHUB_SECRET` in Convex environment

---

## Phase 2: Convex Schema & Auth

### 2.1 Create Schema

- [x] Create `convex/schema.ts`
- [x] Define `userProfiles` table with fields and indexes
- [x] Define `codingSessions` table with all status fields
- [x] Define `sessionMessages` table with parts array
- [x] Define `apiTokens` table with hash and expiry
- [x] Run `npx convex dev` to validate schema
- [x] Verify tables created in Convex dashboard

Note: Better Auth manages its own tables via component - no need for `authTables` or `githubTokens` table

### 2.2 Configure Better Auth

- [x] Create `convex/convex.config.ts` - register Better Auth component
- [x] Create `convex/auth.ts` - Better Auth configuration
- [x] Create `convex/auth.config.ts` - JWT provider configuration
- [x] Configure GitHub provider with `repo user:email` scopes
- [x] Configure crossDomain and convex plugins

### 2.3 Implement Auth Routes

- [x] Register auth routes in `convex/http.ts`
- [x] Configure CORS for frontend origins

---

## Phase 3: Convex Functions

### 3.1 User Functions (`convex/users.ts`)

- [x] Create `getCurrentUser` query
  - [x] Get auth user with `safeGetAuthUser`
  - [x] Query `userProfiles` by authUserId
  - [x] Return profile or null
- [x] Create `storeUserProfile` internal mutation
  - [x] Accept authUserId, githubId, githubUsername, profile data
  - [x] Upsert into `userProfiles` table

### 3.2 Session Functions (`convex/sessions.ts`)

- [x] Create `listUserSessions` query
  - [x] Get auth user
  - [x] Query `codingSessions` by authUserId, order by updatedAt desc
  - [x] Return sessions array
- [x] Create `getSession` query
  - [x] Get auth user
  - [x] Query by sessionId
  - [x] Verify authUserId matches (authorization)
  - [x] Return session or null
- [x] Create `createSession` mutation
  - [x] Get auth user
  - [x] Generate sessionId with `crypto.randomUUID()`
  - [x] Insert into `codingSessions`
  - [x] Call internal `createApiToken` mutation
  - [x] Return `{sessionId, apiToken}`
- [x] Create `refreshSessionToken` mutation
  - [x] Verify user owns session
  - [x] Generate new API token
  - [x] Return `{apiToken}`
- [x] Create `updateSessionStatus` internal mutation
  - [x] Query session by sessionId
  - [x] Verify exists
  - [x] Patch with new status, isProcessing, etc.
- [x] Create `deleteSession` mutation
  - [x] Get auth user
  - [x] Query session by sessionId
  - [x] Verify authUserId matches
  - [x] Delete all messages for session
  - [x] Delete session record

### 3.3 Message Functions (`convex/messages.ts`)

- [x] Create `getSessionMessages` query
  - [x] Get auth user
  - [x] Query session to verify ownership
  - [x] Query messages by sessionId, order by timestamp
  - [x] Return messages array
- [x] Create `syncMessage` internal mutation
  - [x] Accept sessionId, messageId, role, parts, timestamp
  - [x] Upsert message by sessionId + messageId
  - [x] Update codingSessions.updatedAt
  - [x] Set session title from first user message
- [x] Create `syncBatch` internal mutation
  - [x] Accept array of messages
  - [x] Bulk upsert messages

### 3.4 Token Functions (`convex/tokens.ts`)

- [x] Create `hashToken` helper function
  - [x] Use crypto.subtle.digest SHA-256
  - [x] Return hex string
- [x] Create `generateToken` helper function
  - [x] Generate 32 random bytes
  - [x] Convert to base64url string
- [x] Create `createApiToken` internal mutation
  - [x] Hash token for storage
  - [x] Insert into `apiTokens` with expiry (1 hour)
  - [x] Return raw token (only time available)
- [x] Create `validateApiToken` internal query
  - [x] Hash provided token
  - [x] Query by tokenHash
  - [x] Check not expired
  - [x] Return `{authUserId, sessionId, valid}` or null
- [x] Create `cleanupExpiredTokens` internal mutation (optional)
  - [x] Query tokens where expiresAt < now
  - [x] Delete expired tokens

### 3.5 GitHub Functions (`convex/github.ts`)

- [x] Create `fetchUserRepos` action
  - [x] Get auth with Better Auth API
  - [x] Get GitHub access token
  - [x] Call GitHub API `/user/repos`
  - [x] Return repos array
- [x] Create `getValidToken` internal action
  - [x] Query Better Auth accounts table via component adapter
  - [x] Return access token

### 3.6 HTTP Actions (`convex/http.ts`)

- [x] Create HTTP router
- [x] Register Better Auth routes with CORS
- [x] Add `POST /api/validate-token` route
  - [x] Parse token from request body
  - [x] Call `validateApiToken` query
  - [x] Return userId/sessionId or 401
- [x] Add `POST /api/github-token` route
  - [x] Validate API token from Authorization header
  - [x] Call `getValidToken` action
  - [x] Return access token or error
- [x] Add `POST /api/session-status` route
  - [x] Validate API token
  - [x] Verify sessionId matches token
  - [x] Parse status update from body
  - [x] Call `updateSessionStatus` mutation
- [x] Add `POST /api/sync-message` route
  - [x] Validate API token
  - [x] Verify sessionId matches token
  - [x] Parse message from body
  - [x] Call `syncMessage` mutation
- [x] Export default http router

---

## Phase 4: Frontend Migration

### 4.1 Provider Setup

- [x] Update `web/src/main.tsx`
  - [x] Import `ConvexReactClient` from `convex/react`
  - [x] Import `ConvexBetterAuthProvider` from `@convex-dev/better-auth/react`
  - [x] Create Convex client with VITE_CONVEX_URL
  - [x] Wrap app with ConvexBetterAuthProvider
  - [x] Keep BrowserRouter inside provider

### 4.2 Create Auth Client

- [x] Create `web/src/lib/auth-client.ts`
  - [x] Import `createAuthClient` from `better-auth/react`
  - [x] Configure with convexClient and crossDomainClient plugins
  - [x] Set baseURL to VITE_CONVEX_SITE_URL

### 4.3 Update useAuth Hook

- [x] Modify `web/src/hooks/useAuth.ts`
  - [x] Import `useConvexAuth` from `convex/react`
  - [x] Import `authClient` from auth-client
  - [x] Import `useQuery`, `useAction` from `convex/react`
  - [x] Query `users.getCurrentUser` for profile
  - [x] Use `authClient.signIn.social()` for sign in
  - [x] Use `authClient.signOut()` for sign out
  - [x] Remove localStorage PAT logic
  - [x] Use Convex action for repos

### 4.4 Update GitHubAuth Component

- [x] Modify `web/src/components/GitHubAuth.tsx`
  - [x] Remove PAT input field
  - [x] Remove token validation logic
  - [x] Add "Sign in with GitHub" button
  - [x] Receive `onSignIn` prop that calls auth
  - [x] Show loading state during auth
  - [x] Handle auth errors

### 4.5 Update useSession Hook

- [x] Modify `web/src/hooks/useSession.ts`
  - [x] Import `useMutation` from `convex/react`
  - [x] Use Convex `createSession` mutation instead of direct fetch
  - [x] Use Convex `refreshSessionToken` mutation for reconnection
  - [x] Receive `{sessionId, apiToken}` from mutation
  - [x] Pass apiToken in WebSocket connection via subprotocol
  - [x] Remove PAT parameter from createSession

### 4.6 Update useSessions Hook

- [x] Modify `web/src/hooks/useSessions.ts`
  - [x] Import `useQuery`, `useMutation` from `convex/react`
  - [x] Replace fetch-based listing with `useQuery(api.sessions.listUserSessions)`
  - [x] Remove polling/refresh logic (Convex is real-time)
  - [x] Use Convex mutation for delete

### 4.7 Update Sidebar Component

- [x] Modify `web/src/components/Sidebar.tsx`
  - [x] Use sessions from Convex hook (passed as prop)
  - [x] No manual refresh button needed (real-time)
  - [x] Update delete to call Convex mutation
  - [x] Show user profile/avatar from Convex

### 4.8 Update App Component

- [x] Modify `web/src/App.tsx`
  - [x] Use new Convex auth hook
  - [x] Show skeleton loading state while auth loads
  - [x] Redirect unauthenticated users to sign in
  - [x] Remove PAT-related state
  - [x] Update session creation to not pass PAT
  - [x] Add URL-based routing for sessions

### 4.9 Update LandingPage

- [x] Modify `web/src/components/LandingPage.tsx`
  - [x] Add "Go to App" link

---

## Phase 5: Cloudflare Updates

### 5.1 Add Environment Variables

- [x] Update `cloudflare/wrangler.toml`
  - [x] Add `CONVEX_SITE_URL` to `[vars]`

### 5.2 Create Auth Middleware

- [x] Create auth middleware in `cloudflare/src/index.ts`
  - [x] Export `authMiddleware` function
  - [x] Extract token from Authorization header
  - [x] Handle WebSocket Sec-WebSocket-Protocol header
  - [x] Call Convex `/api/validate-token`
  - [x] Set userId and sessionId in context
  - [x] Return 401 if invalid

### 5.3 Update Routes

- [x] Modify `cloudflare/src/index.ts`
  - [x] Apply middleware to `/sessions/*` routes
  - [x] Verify sessionId matches token's sessionId
  - [x] Update POST /sessions to use Convex session ID
  - [x] Pass userId and apiToken to SessionAgent
  - [x] Remove direct PAT handling

### 5.4 Update SessionAgent

- [x] Modify `cloudflare/src/agent.ts`
  - [x] Add `userId` to session state
  - [x] Add `apiToken` and `convexSiteUrl` to stored config
  - [x] Create `fetchGitHubToken` method
    - [x] Call Convex `/api/github-token` endpoint
    - [x] Handle errors
  - [x] Create `updateConvexStatus` method
    - [x] Call Convex `/api/session-status` on status changes
  - [x] Create `syncMessageToConvex` method
    - [x] Call Convex `/api/sync-message` for messages
  - [x] Call Convex token endpoint in `createSandboxInBackground`
  - [x] Add message sync after prompt completion
    - [x] Sync user message immediately
    - [x] Sync assistant message after completion
  - [x] Accept WebSocket subprotocol header
  - [x] Add auto-resume from snapshot when sending to paused session

### 5.5 Remove SessionRegistry

- [x] Delete `cloudflare/src/registry.ts`
- [x] Remove SessionRegistry from `wrangler.toml` bindings
- [x] Remove SessionRegistry imports from `index.ts`
- [x] Remove registry update calls from `agent.ts`

### 5.6 Update Types

- [x] Modify `cloudflare/src/types.ts`
  - [x] Add userId to session state interface
  - [x] Add AuthContext interface
  - [x] Remove PAT from interfaces

---

## Phase 6: Testing

### 6.1 Authentication Tests

- [x] Test: Click "Sign in with GitHub" redirects to GitHub
- [x] Test: After approval, redirected back authenticated
- [x] Test: User profile displays (avatar, username)
- [x] Test: Page refresh maintains auth state
- [x] Test: Sign out clears session
- [x] Test: Protected routes redirect to sign in

### 6.2 Session Management Tests

- [x] Test: Create session creates record in Convex
- [x] Test: Session appears in sidebar immediately
- [x] Test: User A cannot see User B's sessions
- [x] Test: Session status updates in real-time
- [x] Test: Delete removes session and messages
- [x] Test: Reconnecting to session loads history

### 6.3 Message Sync Tests

- [x] Test: User message synced immediately
- [x] Test: Assistant message synced after completion
- [x] Test: Messages persist after browser refresh
- [x] Test: Tool calls preserved with inputs/outputs
- [x] Test: Message order maintained

### 6.4 Sandbox Tests

- [x] Test: Cloudflare receives valid API token
- [x] Test: GitHub token retrieved from Convex
- [x] Test: Modal sandbox clones repo successfully
- [x] Test: OpenCode accepts and processes prompts

### 6.5 Security Tests

- [x] Test: Unauthenticated requests get 401
- [x] Test: Wrong user accessing session gets 403
- [x] Test: Expired API tokens rejected
- [x] Test: GitHub token not in frontend state

---

## Phase 7: Cleanup & Deploy

### 7.1 Code Cleanup

- [x] Remove localStorage PAT code from useAuth
- [x] Remove unused GitHub API calls from frontend
- [x] Remove SessionRegistry references
- [x] Remove PAT from request/response types
- [x] Update comments and documentation

### 7.2 Environment Setup for Production

- [ ] Create production GitHub OAuth App
- [ ] Set production callback URL
- [ ] Configure production Convex environment
- [ ] Set production environment variables

### 7.3 Deployment

- [ ] Deploy Convex: `npx convex deploy`
- [ ] Deploy Cloudflare: `npm run deploy`
- [ ] Deploy web to hosting platform
- [ ] Verify all services connected

### 7.4 Documentation

- [x] CLAUDE.md has Convex commands
- [x] Environment variables documented above
- [x] Authentication flow documented above

---

## Summary Statistics

- **Total Tasks**: 150+
- **New Files**: 10 (Convex functions + auth-client)
- **Modified Files**: 12 (Frontend + Cloudflare)
- **Deleted Files**: 1 (registry.ts)
- **Tables**: 5 (4 custom + Better Auth component tables)
- **API Endpoints**: 4 HTTP actions
- **Test Cases**: 22

## Implementation Notes

1. **Better Auth vs @convex-dev/auth**: The implementation uses `@convex-dev/better-auth` and `better-auth` instead of `@convex-dev/auth`. This is an upgrade that provides:
   - Automatic GitHub token storage in the `account` table
   - No need for separate `githubTokens` table
   - Cross-domain authentication support
   - Simpler token retrieval via Better Auth API

2. **No Token Refresh**: GitHub OAuth tokens don't expire for user-authorized apps, so token refresh is not needed. The implementation stores tokens permanently in Better Auth's accounts table.

3. **URL-based Routing**: Sessions now have URL routes (`/app/session/:sessionId`) for better UX - users can bookmark, share, and reload sessions.

4. **Auto-resume**: Sessions automatically resume from snapshot when a user sends a message to a paused/idle session.
