# GitHub Projects Setup Guide

> Step-by-step guide to configuring GitHub Projects for Tabbi development.

---

## 1. Create Project Board

1. Go to repository → Projects → New project
2. Select "Board" template
3. Name: "Tabbi Development"
4. Description: "Main development board for Tabbi coding agent"

---

## 2. Configure Columns

Create these columns (in order):

| Column          | Description                   | Automation             |
| --------------- | ----------------------------- | ---------------------- |
| **Backlog**     | Ideas, future work, unrefined | -                      |
| **Ready**       | Refined, can be started       | -                      |
| **In Progress** | Being actively worked         | Auto: PR opened        |
| **In Review**   | PR open, awaiting review      | Auto: Review requested |
| **Done**        | Merged to main                | Auto: PR merged        |

### Column Automation Rules

**In Progress**:

- When: Pull request is opened
- Then: Move to "In Progress"

**In Review**:

- When: Review is requested
- Then: Move to "In Review"

**Done**:

- When: Pull request is merged
- Then: Move to "Done"

---

## 3. Create Labels

Run this script to create all labels:

```bash
#!/bin/bash
# scripts/setup-github-labels.sh

REPO="your-org/tabbi"

# Delete default labels (optional)
# gh label delete "bug" --repo $REPO --yes
# gh label delete "documentation" --repo $REPO --yes
# gh label delete "enhancement" --repo $REPO --yes

# Type labels
gh label create "type:feature" --color "0E8A16" --description "New functionality" --repo $REPO
gh label create "type:bug" --color "D93F0B" --description "Something broken" --repo $REPO
gh label create "type:chore" --color "FBCA04" --description "Maintenance, deps, config" --repo $REPO
gh label create "type:docs" --color "0075CA" --description "Documentation only" --repo $REPO
gh label create "type:refactor" --color "5319E7" --description "Code improvement, no behavior change" --repo $REPO
gh label create "type:test" --color "1D76DB" --description "Test additions only" --repo $REPO

# Priority labels
gh label create "priority:critical" --color "B60205" --description "Production down, immediate response" --repo $REPO
gh label create "priority:high" --color "D93F0B" --description "Major feature broken, < 4 hours" --repo $REPO
gh label create "priority:medium" --color "FBCA04" --description "Minor feature broken, < 1 day" --repo $REPO
gh label create "priority:low" --color "0E8A16" --description "Nice to have, next sprint" --repo $REPO

# Area labels
gh label create "area:web" --color "C5DEF5" --description "React frontend" --repo $REPO
gh label create "area:api" --color "BFD4F2" --description "Cloudflare Workers" --repo $REPO
gh label create "area:modal" --color "D4C5F9" --description "Modal sandbox" --repo $REPO
gh label create "area:convex" --color "F9D0C4" --description "Convex backend" --repo $REPO
gh label create "area:infra" --color "FEF2C0" --description "CI/CD, deployment" --repo $REPO

# Status labels
gh label create "blocked" --color "D93F0B" --description "Waiting on external dependency" --repo $REPO
gh label create "needs-design" --color "FBCA04" --description "Requires design decision" --repo $REPO
gh label create "needs-investigation" --color "FBCA04" --description "Root cause unknown" --repo $REPO
gh label create "good-first-issue" --color "7057FF" --description "Good for newcomers" --repo $REPO

echo "Labels created successfully!"
```

---

## 4. Issue Templates

Create `.github/ISSUE_TEMPLATE/` directory with these templates:

### Feature Request (`.github/ISSUE_TEMPLATE/feature_request.yml`)

```yaml
name: Feature Request
description: Suggest a new feature
title: "[Feature]: "
labels: ["type:feature"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for suggesting a feature! Please fill out the form below.

  - type: textarea
    id: summary
    attributes:
      label: Summary
      description: Brief description of the feature
      placeholder: What do you want to add?
    validations:
      required: true

  - type: textarea
    id: user-story
    attributes:
      label: User Story
      description: Who is this for and why?
      placeholder: "As a [user type], I want [goal] so that [benefit]."
    validations:
      required: true

  - type: textarea
    id: acceptance-criteria
    attributes:
      label: Acceptance Criteria
      description: How will we know this is done?
      placeholder: |
        - [ ] Criterion 1
        - [ ] Criterion 2
    validations:
      required: true

  - type: dropdown
    id: area
    attributes:
      label: Area
      description: Which part of the system?
      options:
        - Web (React frontend)
        - API (Cloudflare Workers)
        - Modal (Sandbox)
        - Convex (Backend)
        - Infrastructure
    validations:
      required: true

  - type: textarea
    id: technical-notes
    attributes:
      label: Technical Notes
      description: Any implementation hints or constraints
      placeholder: Optional

  - type: textarea
    id: design
    attributes:
      label: Design
      description: Link to mockups or designs
      placeholder: Optional
```

### Bug Report (`.github/ISSUE_TEMPLATE/bug_report.yml`)

```yaml
name: Bug Report
description: Report something that's broken
title: "[Bug]: "
labels: ["type:bug"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for reporting a bug! Please fill out the form below.

  - type: textarea
    id: description
    attributes:
      label: Description
      description: What's broken?
      placeholder: Describe the bug
    validations:
      required: true

  - type: textarea
    id: steps
    attributes:
      label: Steps to Reproduce
      description: How can we reproduce this?
      placeholder: |
        1. Go to...
        2. Click on...
        3. See error
    validations:
      required: true

  - type: textarea
    id: expected
    attributes:
      label: Expected Behavior
      description: What should happen?
    validations:
      required: true

  - type: textarea
    id: actual
    attributes:
      label: Actual Behavior
      description: What actually happens?
    validations:
      required: true

  - type: dropdown
    id: severity
    attributes:
      label: Severity
      options:
        - Critical (production down)
        - High (major feature broken)
        - Medium (minor feature broken)
        - Low (cosmetic/minor)
    validations:
      required: true

  - type: dropdown
    id: area
    attributes:
      label: Area
      options:
        - Web (React frontend)
        - API (Cloudflare Workers)
        - Modal (Sandbox)
        - Convex (Backend)
        - Infrastructure
    validations:
      required: true

  - type: textarea
    id: environment
    attributes:
      label: Environment
      description: Browser, OS, etc.
      placeholder: |
        - Browser: Chrome 120
        - OS: macOS 14
        - User type: Authenticated

  - type: textarea
    id: screenshots
    attributes:
      label: Screenshots/Logs
      description: Attach any relevant evidence
      placeholder: Drag and drop images or paste logs
```

### Chore (`.github/ISSUE_TEMPLATE/chore.yml`)

```yaml
name: Chore
description: Maintenance, dependencies, or configuration
title: "[Chore]: "
labels: ["type:chore"]
body:
  - type: textarea
    id: description
    attributes:
      label: Description
      description: What needs to be done?
    validations:
      required: true

  - type: dropdown
    id: area
    attributes:
      label: Area
      options:
        - Dependencies
        - CI/CD
        - Configuration
        - Documentation
        - Other
    validations:
      required: true

  - type: textarea
    id: rationale
    attributes:
      label: Rationale
      description: Why is this needed?
```

---

## 5. Milestones

Create milestones for major initiatives:

```bash
# Create milestones
gh api repos/your-org/tabbi/milestones -f title="v1.1 - Session Management" \
  -f description="Improved session lifecycle, pause/resume, snapshots" \
  -f due_on="2024-02-01T00:00:00Z"

gh api repos/your-org/tabbi/milestones -f title="v1.2 - Observability" \
  -f description="Error tracking, metrics, dashboards" \
  -f due_on="2024-03-01T00:00:00Z"

gh api repos/your-org/tabbi/milestones -f title="v1.3 - Performance" \
  -f description="Latency improvements, caching, optimization" \
  -f due_on="2024-04-01T00:00:00Z"
```

---

## 6. Project Views

### View 1: Sprint Board (Default)

- Layout: Board
- Group by: Status (column)
- Filter: `milestone:current`

### View 2: By Area

- Layout: Board
- Group by: Area label
- Filter: `is:open`

### View 3: Bugs

- Layout: Table
- Filter: `label:type:bug is:open`
- Sort: Priority (descending)

### View 4: My Items

- Layout: Table
- Filter: `assignee:@me is:open`
- Sort: Updated (descending)

---

## 7. Automation with GitHub Actions

### Auto-label PRs (`.github/workflows/auto-label.yml`)

```yaml
name: Auto Label

on:
  pull_request:
    types: [opened]

jobs:
  label:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/labeler@v5
        with:
          repo-token: "${{ secrets.GITHUB_TOKEN }}"
```

### Labeler config (`.github/labeler.yml`)

```yaml
area:web:
  - changed-files:
      - any-glob-to-any-file: "web/**"

area:api:
  - changed-files:
      - any-glob-to-any-file: "cloudflare/**"

area:modal:
  - changed-files:
      - any-glob-to-any-file: "modal/**"

area:convex:
  - changed-files:
      - any-glob-to-any-file: "convex/**"

area:infra:
  - changed-files:
      - any-glob-to-any-file:
          - ".github/**"
          - "scripts/**"
          - "*.json"
          - "*.yml"
```

---

## 8. Best Practices

### Issue Hygiene

1. **Every issue needs labels**: At minimum, type + area
2. **Close stale issues**: If no activity for 30 days, close or revive
3. **Link PRs to issues**: Use "Closes #123" in PR description
4. **Assign owners**: Don't leave issues unassigned in "In Progress"

### Sprint Planning

1. **Weekly cadence**: Plan on Monday, demo on Friday
2. **Capacity-based**: Don't overcommit
3. **Include buffer**: 20% for bugs and interrupts
4. **Prioritize ruthlessly**: P1s before P2s, features before nice-to-haves

### Definition of Done

An issue is done when:

- [ ] Code merged to main
- [ ] CI passes
- [ ] Tests added/updated
- [ ] Documentation updated (if needed)
- [ ] Deployed to staging
- [ ] Verified in staging

---

## Quick Commands

```bash
# Create issue
gh issue create --title "Add pause button" --label "type:feature,area:web"

# List open bugs
gh issue list --label "type:bug" --state open

# Assign issue
gh issue edit 123 --add-assignee @username

# Close with comment
gh issue close 123 --comment "Fixed in #456"

# Create milestone
gh api repos/OWNER/REPO/milestones -f title="v1.1"

# List milestones
gh api repos/OWNER/REPO/milestones
```
