# Tabbi Engineering Operating System

> A comprehensive guide to rituals, workflows, and tooling for high-velocity, low-regression development.

---

## Table of Contents

1. [Work Tracking](#1-work-tracking)
2. [Development Workflow](#2-development-workflow)
3. [Release Process](#3-release-process)
4. [Observability](#4-observability)
5. [Incident Response](#5-incident-response)
6. [Team Rituals](#6-team-rituals)

---

## 1. Work Tracking

### Platform: GitHub Projects

We use GitHub Projects for task tracking, tightly integrated with our repository for seamless PR linking.

### Project Board Structure

```
┌─────────────┬─────────────┬─────────────┬─────────────┬─────────────┐
│   Backlog   │    Ready    │ In Progress │  In Review  │    Done     │
├─────────────┼─────────────┼─────────────┼─────────────┼─────────────┤
│ Ideas and   │ Refined,    │ Being       │ PR open,    │ Merged to   │
│ future work │ can start   │ worked on   │ awaiting    │ main        │
│             │             │             │ review      │             │
└─────────────┴─────────────┴─────────────┴─────────────┴─────────────┘
```

### Issue Hierarchy

```
Epic (Milestone)
├── Feature Issue
│   ├── Task Issue
│   └── Task Issue
└── Feature Issue
    └── Task Issue
```

| Level       | GitHub Construct          | Scope                  | Example                                 |
| ----------- | ------------------------- | ---------------------- | --------------------------------------- |
| **Epic**    | Milestone                 | Multi-week initiative  | "Session Management v2"                 |
| **Feature** | Issue with `type:feature` | User-facing capability | "Add session pause/resume UI"           |
| **Task**    | Issue with `type:task`    | Implementation unit    | "Add pause button to Chat header"       |
| **Bug**     | Issue with `type:bug`     | Defect fix             | "WebSocket reconnect fails after pause" |

### Labels

#### Type Labels (Required - Pick One)

| Label           | Color                  | Description                          |
| --------------- | ---------------------- | ------------------------------------ |
| `type:feature`  | `#0E8A16` (green)      | New functionality                    |
| `type:bug`      | `#D93F0B` (red)        | Something broken                     |
| `type:chore`    | `#FBCA04` (yellow)     | Maintenance, deps, config            |
| `type:docs`     | `#0075CA` (blue)       | Documentation only                   |
| `type:refactor` | `#5319E7` (purple)     | Code improvement, no behavior change |
| `type:test`     | `#1D76DB` (light blue) | Test additions only                  |

#### Priority Labels (Required for Bugs)

| Label               | Color                | Description          | Response Time |
| ------------------- | -------------------- | -------------------- | ------------- |
| `priority:critical` | `#B60205` (dark red) | Production down      | Immediate     |
| `priority:high`     | `#D93F0B` (red)      | Major feature broken | < 4 hours     |
| `priority:medium`   | `#FBCA04` (yellow)   | Minor feature broken | < 1 day       |
| `priority:low`      | `#0E8A16` (green)    | Nice to have         | Next sprint   |

#### Area Labels (Required)

| Label         | Color     | Description        |
| ------------- | --------- | ------------------ |
| `area:web`    | `#C5DEF5` | React frontend     |
| `area:api`    | `#BFD4F2` | Cloudflare Workers |
| `area:modal`  | `#D4C5F9` | Modal sandbox      |
| `area:convex` | `#F9D0C4` | Convex backend     |
| `area:infra`  | `#FEF2C0` | CI/CD, deployment  |

#### Status Labels (Optional)

| Label                 | Description                    |
| --------------------- | ------------------------------ |
| `blocked`             | Waiting on external dependency |
| `needs-design`        | Requires design decision       |
| `needs-investigation` | Root cause unknown             |
| `good-first-issue`    | Suitable for new contributors  |

### Issue Templates

#### Feature Request

```markdown
## Summary

Brief description of the feature.

## User Story

As a [user type], I want [goal] so that [benefit].

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Technical Notes

Any implementation hints or constraints.

## Design

Link to design mockups if applicable.
```

#### Bug Report

```markdown
## Description

What's broken?

## Steps to Reproduce

1. Go to...
2. Click on...
3. See error

## Expected Behavior

What should happen?

## Actual Behavior

What actually happens?

## Environment

- Browser:
- OS:
- User type: (authenticated/anonymous)

## Screenshots/Logs

Attach relevant evidence.
```

### Definition of Done

A task is **Done** when:

- [ ] Code is merged to `main`
- [ ] All CI checks pass (typecheck, lint, tests)
- [ ] PR has been reviewed and approved
- [ ] No `TODO` comments left in code
- [ ] Documentation updated (if user-facing change)
- [ ] Tested in staging (if applicable)
- [ ] Product owner has accepted (for features)

### Ownership

| Area           | Primary Owner  | Backup        |
| -------------- | -------------- | ------------- |
| Web Frontend   | @frontend-lead | @fullstack    |
| Cloudflare API | @backend-lead  | @fullstack    |
| Modal Sandbox  | @infra-lead    | @backend-lead |
| Convex Backend | @backend-lead  | @fullstack    |
| CI/CD          | @infra-lead    | @backend-lead |

---

## 2. Development Workflow

### Branch Strategy

```
main (protected)
  │
  ├── feature/TAB-123-add-pause-button
  ├── fix/TAB-456-websocket-reconnect
  ├── chore/TAB-789-update-deps
  └── refactor/TAB-012-extract-hook
```

**Naming Convention**: `{type}/{issue-number}-{short-description}`

### Commit Message Format

```
type(scope): subject

body (optional)

footer (optional)
```

**Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`
**Scopes**: `web`, `api`, `modal`, `convex`, `ci`

**Examples**:

```
feat(web): add session pause button

- Added pause button to Chat header
- Wired up to useSession hook
- Added loading state during pause

Closes #123
```

### PR Size Guidelines

| Size | Lines Changed | Review Time | Recommendation     |
| ---- | ------------- | ----------- | ------------------ |
| XS   | < 50          | < 15 min    | Ideal for fixes    |
| S    | 50-150        | 15-30 min   | Ideal for features |
| M    | 150-300       | 30-60 min   | Split if possible  |
| L    | 300-500       | 1-2 hours   | Must split         |
| XL   | > 500         | Reject      | Always split       |

**Target**: 80% of PRs should be S or smaller.

### Agentic Development Workflow

For Claude Code autonomous development:

```
1. Issue Created
   └─> Claude reads issue, creates TodoWrite plan

2. Implementation
   ├─> Small, focused changes (one file at a time)
   ├─> Run typecheck after each file
   └─> Commit frequently (every logical unit)

3. Testing
   ├─> Write/update tests
   ├─> Run full test suite
   └─> Fix any failures before PR

4. Pull Request
   ├─> Create PR with template
   ├─> Link to issue
   └─> Request review

5. Review & Merge
   ├─> Address feedback
   ├─> Squash and merge
   └─> Delete branch
```

### Code Review SLA

| PR Size | First Review | Merge Target |
| ------- | ------------ | ------------ |
| XS/S    | < 4 hours    | Same day     |
| M       | < 8 hours    | Next day     |
| L       | < 24 hours   | 2 days       |

---

## 3. Release Process

### Environment Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                      PRODUCTION                              │
│  tabbi.dev                                                  │
│  coding-agent-api-production.workers.dev                    │
│  Modal: coding-agent-sandbox (deployed)                     │
│  Convex: cheery-anaconda-510                                │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ Manual promotion
                              │ (after staging validation)
┌─────────────────────────────────────────────────────────────┐
│                       STAGING                                │
│  staging.tabbi.dev                                          │
│  coding-agent-api-staging.workers.dev                       │
│  Modal: coding-agent-sandbox (served)                       │
│  Convex: brilliant-meadowlark-939                           │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ Auto-deploy on merge to main
                              │
┌─────────────────────────────────────────────────────────────┐
│                     DEVELOPMENT                              │
│  localhost:3000 (web)                                       │
│  localhost:8787 (cloudflare)                                │
│  Modal: coding-agent-sandbox (modal serve)                  │
│  Convex: (dev instance)                                     │
└─────────────────────────────────────────────────────────────┘
```

### Deployment Pipeline

```yaml
# Triggered by: merge to main
Staging Deploy: 1. Run CI (typecheck, lint, test)
  2. Deploy Convex (staging)
  3. Deploy Cloudflare Workers (staging)
  4. Deploy Web to Vercel (staging)
  5. Run E2E tests against staging
  6. Notify #releases channel

# Triggered by: manual or tag
Production Deploy: 1. Verify staging E2E passed
  2. Create release tag (vX.Y.Z)
  3. Deploy Convex (production)
  4. Deploy Cloudflare Workers (production)
  5. Deploy Modal (production)
  6. Deploy Web to Vercel (production)
  7. Smoke test production
  8. Notify #releases channel
```

### Versioning

We use **Semantic Versioning** (SemVer):

```
v{MAJOR}.{MINOR}.{PATCH}

MAJOR: Breaking changes (API, data format)
MINOR: New features (backward compatible)
PATCH: Bug fixes (backward compatible)
```

**Release Cadence**:

- **Patch**: As needed for bug fixes
- **Minor**: Weekly (every Monday)
- **Major**: Quarterly or as needed

### Feature Flags

For gradual rollouts, use feature flags stored in Convex:

```typescript
// convex/featureFlags.ts
export const featureFlags = {
  // Format: flag_name: { enabled: boolean, rollout: percentage }
  new_chat_ui: { enabled: false, rollout: 0 },
  auto_pause: { enabled: true, rollout: 100 },
  experimental_tools: { enabled: true, rollout: 10 }, // 10% of users
};

// Usage in web
const { isEnabled } = useFeatureFlag("new_chat_ui");
if (isEnabled) {
  return <NewChatUI />;
}
```

### Rollback Plan

#### Automatic Rollback Triggers

- Error rate > 5% for 5 minutes
- P95 latency > 5s for 5 minutes
- Health check failures

#### Manual Rollback Steps

**Cloudflare Workers**:

```bash
# List recent deployments
wrangler deployments list

# Rollback to previous version
wrangler rollback --env production
```

**Vercel (Web)**:

```bash
# Via Vercel dashboard
# Deployments > Previous deployment > Promote to Production
```

**Modal**:

```bash
# Redeploy previous commit
git checkout <previous-commit>
modal deploy sandbox.py
```

**Convex** (Schema changes only):

```bash
# Convex doesn't support automatic rollback
# For breaking changes, deploy a fix-forward migration
```

### Release Checklist

- [ ] All CI checks pass on main
- [ ] E2E tests pass on staging
- [ ] Manual smoke test on staging
- [ ] Release notes prepared
- [ ] On-call engineer identified
- [ ] Rollback plan reviewed
- [ ] Deploy during low-traffic window (if possible)
- [ ] Monitor dashboards for 30 minutes post-deploy

---

## 4. Observability

See [OBSERVABILITY_PLAN.md](./OBSERVABILITY_PLAN.md) for detailed instrumentation.

### Key Dashboards

| Dashboard             | Purpose               | Key Metrics                              |
| --------------------- | --------------------- | ---------------------------------------- |
| **Service Health**    | Overall system status | Error rate, latency, throughput          |
| **Session Lifecycle** | Session operations    | Creation success, pause/resume, timeouts |
| **User Experience**   | Frontend performance  | Core Web Vitals, JS errors               |
| **Infrastructure**    | Resource utilization  | Worker CPU, Modal sandbox usage          |

### SLOs (Service Level Objectives)

| Service          | Metric             | Target  | Alerting Threshold |
| ---------------- | ------------------ | ------- | ------------------ |
| API              | Availability       | 99.9%   | < 99.5%            |
| API              | P95 Latency        | < 500ms | > 1s               |
| Session Creation | Success Rate       | 99%     | < 95%              |
| WebSocket        | Connection Success | 99%     | < 95%              |
| Modal Sandbox    | Boot Time          | < 30s   | > 60s              |

### On-Call Rotation

- **Primary**: Responds to P0/P1 alerts
- **Secondary**: Backup for primary, handles P2
- **Weekly rotation**: Monday 9 AM handoff
- **Escalation**: Primary → Secondary → Engineering Lead → CTO

---

## 5. Incident Response

See [PRODUCTION_ISSUES_PLAYBOOK.md](./PRODUCTION_ISSUES_PLAYBOOK.md) for detailed runbooks.

### Severity Levels

| Level  | Description                      | Response Time     | Communication                 |
| ------ | -------------------------------- | ----------------- | ----------------------------- |
| **P0** | Service down, all users affected | Immediate         | All hands, public status page |
| **P1** | Major feature broken             | < 1 hour          | Team notified, status page    |
| **P2** | Minor feature broken             | < 4 hours         | Team notified                 |
| **P3** | Cosmetic/minor                   | Next business day | Issue tracker                 |

### First 15 Minutes Checklist

1. [ ] Acknowledge alert
2. [ ] Check status page / error tracking
3. [ ] Identify affected service(s)
4. [ ] Check recent deployments
5. [ ] Reproduce if possible
6. [ ] Communicate status
7. [ ] Begin investigation or rollback

### Postmortem Template

Required for all P0 and P1 incidents:

```markdown
# Incident: [Title]

**Date**: YYYY-MM-DD
**Duration**: X hours Y minutes
**Severity**: P0/P1
**Author**: @handle
**Status**: Draft / Final

## Summary

One paragraph description.

## Impact

- Users affected: X
- Revenue impact: $Y (if applicable)
- Duration: Z minutes

## Timeline (all times UTC)

- HH:MM - First alert
- HH:MM - Investigation started
- HH:MM - Root cause identified
- HH:MM - Mitigation applied
- HH:MM - Fully resolved

## Root Cause

Technical explanation of what went wrong.

## Resolution

What was done to fix it.

## Lessons Learned

What went well:

- Item 1

What went poorly:

- Item 1

## Action Items

| Action               | Owner   | Due Date   | Status |
| -------------------- | ------- | ---------- | ------ |
| Add monitoring for X | @handle | YYYY-MM-DD | Open   |
| Fix bug Y            | @handle | YYYY-MM-DD | Open   |
```

---

## 6. Team Rituals

### Daily

- **Async Standup** (Slack): What I did, what I'm doing, blockers
- **Alert Review**: Check dashboards, acknowledge/resolve alerts

### Weekly

- **Sprint Planning** (Monday): Review backlog, assign work
- **Demo** (Friday): Show completed work to stakeholders
- **Retrospective** (Friday, biweekly): What to improve

### Per Release

- **Release Review**: Verify checklist, identify risks
- **Post-Release Monitoring**: Watch dashboards for 30 min

### Per Incident (P0/P1)

- **Incident Call**: Real-time coordination
- **Postmortem** (within 48 hours): Document and learn

### Quarterly

- **OKR Review**: Check progress on objectives
- **Architecture Review**: Discuss tech debt, major changes
- **Dependency Audit**: Update dependencies, security patches

---

## Quick Reference

### Commands

```bash
# Development
npm run dev                 # Start all services
npm run typecheck           # Check types
npm run lint                # Run linter
npm run test                # Run tests

# Deployment
npm run deploy:staging      # Deploy to staging
npm run deploy:production   # Deploy to production

# Debugging
wrangler tail               # Stream Cloudflare logs
modal app logs              # Stream Modal logs
npx convex logs             # Stream Convex logs
```

### Key URLs

| Environment | Web               | API                   | Dashboard      |
| ----------- | ----------------- | --------------------- | -------------- |
| Production  | tabbi.dev         | api.tabbi.dev         | dash.tabbi.dev |
| Staging     | staging.tabbi.dev | api-staging.tabbi.dev | -              |
| Local       | localhost:3000    | localhost:8787        | -              |

### Emergency Contacts

| Role              | Contact           | Escalation       |
| ----------------- | ----------------- | ---------------- |
| On-Call Primary   | @oncall-primary   | Slack #incidents |
| On-Call Secondary | @oncall-secondary | Slack #incidents |
| Engineering Lead  | @eng-lead         | Direct message   |
| CTO               | @cto              | Phone (P0 only)  |
