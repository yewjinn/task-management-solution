# My Work Board

A private, single-user task board for handling a high volume of ad-hoc work with
as little status-maintenance overhead as possible.

- Live app: [my-work-board.yewjinn.chatgpt.site](https://my-work-board.yewjinn.chatgpt.site)
- Source: [github.com/yewjinn/task-management-solution](https://github.com/yewjinn/task-management-solution)
- Status snapshot: 21 July 2026

## Continuation Brief

This section is the primary handoff for future Codex build sessions.

### Objective

Provide one personal board that can absorb incoming work quickly, organize it by
time horizon, and keep the current workload easy to scan. The user deliberately
does **not** want an `In Progress` list because updating a task when work begins
would add unnecessary overhead.

The intended default workflow is:

1. `Today` — tasks to complete today
2. `Tomorrow` — tasks to complete by tomorrow
3. `This Week` — tasks to complete this week
4. `Later` — less urgent tasks
5. `Done` — completed work

These are seed values, not fixed columns. Lists can be created, renamed,
reordered, and deleted.

### Product Decisions to Preserve

- Keep the product focused on one private board for one owner. Collaboration is
  not currently required.
- Optimize for fast capture and low interaction cost rather than detailed
  workflow-state tracking.
- Use stable running task numbers (`Task #1`, `Task #2`, and so on) so a task can
  be referenced without ambiguity in conversation.
- Use `Asia/Singapore` when calculating Today, Tomorrow, and overdue states.
- Keep access owner-only through the Sites access policy. A shared application
  password was considered but was not selected.
- Continue using Sites and D1 unless a future requirement justifies moving to
  AWS or another platform.
- Do not add attachments until they are requested. The R2 binding is currently
  disabled.

### Current State

The web board is implemented, deployed, and backed by persistent D1 storage.
The native chat-update phase is **not implemented**; see [Planned Work](#planned-work).

## Implemented Functionality

### Board and Lists

- Seeds `Today`, `Tomorrow`, `This Week`, `Later`, and `Done` on first use.
- Creates, renames, reorders, and deletes lists.
- Reorders lists and cards with drag and drop.
- Moves cards between lists with drag and drop.
- Deleting a list also deletes its cards through the database cascade. The UI
  presents a confirmation first.

### Tasks

- Quick capture adds a task to the list named `Today`, falling back to the first
  available list if `Today` was renamed or deleted.
- Inline capture is available at the bottom of every list.
- Detailed create/edit supports:
  - title
  - notes
  - due date
  - priority: none, low, medium, or high
  - effort: small, medium, or large
  - up to eight tags
  - completion state
- Tasks can be deleted after confirmation.
- Marking a task complete moves it to a list named `Done` when that list exists.
  Marking it incomplete does not restore its previous list automatically.
- Moving a task into `Done` marks it complete; moving it elsewhere marks it
  incomplete.

### Stable Task IDs

- Every task has a human-facing, monotonically increasing `taskNumber` shown as
  `Task #<number>` on the card and in the task dialog.
- Existing unnumbered tasks are backfilled in creation order.
- The last assigned number is kept in `board_settings`.
- Deleted numbers are never reused.
- Search accepts forms such as `Task 12` and `Task #12`.

### Find and Prioritize

- Search covers Task ID, title, notes, and tags.
- Filters cover priority, effort, overdue, due today, upcoming, and no due date.
- The header reports open-task, due-today, and overdue counts.
- Overdue tasks receive a visual warning.

### Interface

- Responsive desktop and mobile layouts.
- Sticky header, horizontal board scrolling, dialogs, error recovery, and save
  status feedback.
- Keyboard focus styles, accessible control labels, and reduced-motion support.
- The desired readability requirement is a minimum visible font size of 13px.
  However, a 21 July 2026 source audit found explicit `9px`-`12px` declarations
  in `app/globals.css`. Treat the 13px floor as requiring another implementation
  and browser-verification pass before considering it complete.

## Architecture

| Area | Implementation | Main files |
|---|---|---|
| UI | Next.js 16, React 19, TypeScript | `app/page.tsx`, `app/task-board.tsx` |
| Styling | Tailwind import plus project CSS | `app/globals.css` |
| Board API | Same-origin JSON `GET`/`POST` route | `app/api/board/route.ts` |
| Persistence | Cloudflare D1, exposed as binding `DB` | `db/index.ts`, `.openai/hosting.json` |
| Schema | SQLite/Drizzle definitions and migrations | `db/schema.ts`, `drizzle/` |
| Runtime | Vinext/Vite on a Cloudflare Worker | `vite.config.ts`, `worker/index.ts` |
| Hosting | ChatGPT Sites | `.openai/hosting.json` |
| Verification | Build artifact checks and one rendered-HTML test | `scripts/`, `tests/` |

The app uses a single endpoint:

- `GET /api/board` returns all lists with their ordered cards.
- `POST /api/board` accepts an `action` and its payload. Current actions are
  `createList`, `renameList`, `deleteList`, `reorderLists`, `createCard`,
  `updateCard`, `deleteCard`, and `reorderCards`.

The route creates missing tables and indexes defensively at runtime, seeds the
initial lists once, backfills Task IDs when needed, and returns the complete
board after every mutation. Drizzle migration files remain the declarative
schema history.

### Data Model

- `board_settings`: initialization flags and the last Task ID value.
- `lists`: UUID, title, ordering position, and timestamps.
- `cards`: UUID, stable Task ID, parent list, task fields, ordering position,
  completion state, and timestamps.

Important current limits enforced by the API:

- List name: 80 characters.
- Task title: 240 characters.
- Notes: 4,000 characters.
- Tags: eight unique values, 24 characters each.
- Due dates: `YYYY-MM-DD` values.

## Access, Data, and Deployment

- Production is hosted by Sites at the live URL above.
- Access is a custom Sites allowlist containing only the owner.
- Authentication and authorization are currently enforced by the Sites hosting
  perimeter, not by per-user records in the application.
- The board has one shared D1 dataset and no tenant/user column. Do not make the
  Site public without first adding application-level authorization and data
  isolation appropriate to the new audience.
- `.openai/hosting.json` declares D1 binding `DB`; R2 is `null`.
- There is no `wrangler.jsonc`; local binding simulation lives in
  `vite.config.ts`.

There are two Git remotes in the Sites checkout:

- `origin` is the Sites source repository.
- `github` is `yewjinn/task-management-solution`.

Inspect both branches before pushing. Preserve both histories and do not force
push merely because the Sites remote lacks GitHub's initial README merge commit.

## Planned Work

### 1. Complete and Verify the 13px Readability Floor

Normalize visible labels, task metadata, tags, filters, and dialogs to at least
13px while preserving intentionally hidden text such as responsive button text
replaced by an icon. Add a browser-level regression check for computed font
sizes on desktop and mobile.

### 2. Add Chat-Based Board Updates

The desired experience is to support requests such as:

> Move Task #12 to Tomorrow.

> Add a high-priority task to Today, due Friday.

The preferred design discussed so far is a small companion ChatGPT app using a
protected MCP endpoint. It should be able to list/search tasks and create,
edit, move, and complete cards by Task ID. Deletion should remain web-only at
first to reduce accidental data loss.

Current blockers and constraints:

- No MCP or chat connector code exists in this repository yet.
- Connecting a custom MCP app to ChatGPT requires Developer Mode, which the
  owner does not currently have.
- Browser automation available in the prior Codex environment could not operate
  the authenticated private Sites session, so it is not a working fallback.
- The existing `/api/board` route relies on the Sites access perimeter. Do not
  expose it publicly for chat integration. Add explicit authentication,
  authorization, confirmation behavior for writes, and a narrowly scoped tool
  surface.

Before implementing this phase, confirm that Developer Mode or another approved
authenticated connector mechanism has become available.

### 3. Expand Automated Coverage

The current test only verifies the rendered development-preview metadata. Add
coverage for:

- initial list seeding
- Task ID backfill, incrementing, uniqueness, and non-reuse
- create/edit/move/complete/delete flows
- list deletion cascades
- search and filters
- Singapore date boundaries and overdue behavior
- desktop/mobile interactions and accessibility

### Explicit Non-Goals for Now

- Team collaboration, sharing, comments, or multiple boards.
- An `In Progress` list in the default workflow.
- Attachments or R2 storage.
- AWS migration.
- Shared-password authentication.

## Local Development

### Prerequisites

- Node.js `>=22.13.0`
- Linux with `flock`, `curl`, and GNU `timeout` for the Sites helper scripts

### Commands

```bash
npm run install:ci
npm run dev
npm run lint
npm test
npm run db:generate
```

`npm test` runs the production build, validates the Sites artifact, and runs the
Node test suite. The generated `.sites-runtime/`, `.wrangler/`, `.next/`, and
`dist/` directories are disposable and ignored by Git.

For normal Sites work, use the Sites lifecycle rather than treating the helper
scripts as a generic deployment pipeline. Checkpoint and verify coherent app
changes before publishing them. Documentation-only changes do not require a
production deployment.

## Safe Continuation Checklist

When starting another Codex build task:

1. Read this README and inspect `git status`, both remotes, and recent commits.
2. Open the existing Sites checkout; do not create a second Site.
3. Preserve `.openai/hosting.json`, the `DB` binding, the lockfile, and the
   current Vinext architecture.
4. Confirm whether the requested change affects the owner-only access model or
   persistent data before editing.
5. For schema changes, update both the runtime compatibility path and Drizzle
   schema/migrations.
6. Verify high-risk data behavior and responsive UI changes in an agent preview.
7. Checkpoint/deploy app changes through Sites and push the matching source
   history to the intended remote. Do not redeploy for README-only changes.

## Reference Links

- [Vinext](https://github.com/cloudflare/vinext)
- [Drizzle ORM with D1](https://orm.drizzle.team/docs/get-started/d1-new)
