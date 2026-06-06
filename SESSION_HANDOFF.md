# Daily Planner — Session Handoff

Hand this file to the new Claude session. It explains what's built, how to run it, and what's next.

---

## Project
A daily planner for product managers. Vite + React frontend, Express backend with JSON-file persistence. Path: `/Users/ayushmansingh/Desktop/Projects-Base/Daily Planner`.

## Run it
```
cd "/Users/ayushmansingh/Desktop/Projects-Base/Daily Planner"
npm run dev
```
- Web: http://localhost:5173
- API: http://localhost:5174
- Data: `server/data.json` (file-based; survives browser clears)

## Stack
- React 18 + Vite 5
- Express 4
- nanoid for IDs
- concurrently to run server + web together
- No CSS framework — hand-rolled in `src/styles.css`

## File map
```
Daily Planner/
├── package.json              # root, runs both via concurrently
├── vite.config.js            # proxies /api → 5174
├── index.html
├── server/
│   ├── index.js              # Express + JSON file storage
│   └── data.json             # the database
├── src/
│   ├── main.jsx
│   ├── App.jsx               # view routing + shortcuts
│   ├── api.js                # fetch wrappers
│   ├── utils.js              # date/sort/bucket helpers
│   ├── styles.css
│   └── components/
│       ├── Sidebar.jsx       # Focus / Across projects / Projects / Tags
│       ├── TodayView.jsx     # bucketed Today + momentum footer
│       ├── Board.jsx         # 3-column kanban for a project
│       ├── ListView.jsx      # cross-project grouped list
│       ├── TaskCard.jsx      # all card variants
│       ├── TaskModal.jsx     # full edit form
│       ├── QuickAdd.jsx      # keyboard `N` capture
│       └── DatePicker.jsx    # custom date picker (portal, position-fixed)
```

---

## What's built

### Data model (Task)
```
id, title, description, state ('active'|'pending'|'done'), priority (bool),
deadline (ISO, set to 17:00 local on chosen day),
followUpDate (ISO, set to 09:00 local on chosen day — separate from deadline),
waitingOn (string — '@ravi', 'legal', etc.),
tags (string[]),
projectId,
createdAt, updatedAt, completedAt
```
`updatedAt` is set on every PATCH. `completedAt` set when state → done, cleared otherwise. Used for staleness + momentum.

### Views
View key → behavior:
- `today` — TodayView
- `follow-ups` — tasks where followUpDate ≤ today + not done
- `stale` — tasks not updated in ≥7 days + not done
- `state:active` / `state:pending` / `state:done` — cross-project, grouped by project
- `tag:<name>` — cross-project, grouped by project
- `project:<id>` — Kanban board (Active/Pending/Done)

### Today view sections (priority order — task only appears once)
1. 🔴 Overdue
2. 🔔 Follow-ups due (today or earlier)
3. ☀️ Due today
4. ⭐ Priority (other, no deadline)
5. 📅 Upcoming (next 10)

Momentum footer at bottom: `N done today · M this week` + `🔥 on a roll` badge when ≥3 done today.

### Board (project view)
- 3 columns: Active (violet) · Pending (pink) · Done (green)
- Drag-and-drop between columns updates state
- Done column compresses to *today's* completed only with `↓ Show N older` expander
- Done cards rendered compact (no description)

### Task card variants
- **Default** — gray left border
- **Priority** — amber left border, warm gradient
- **Heavy** (priority + overdue) — 6px border, rose-yellow gradient, red shadow, larger title
- **Done** — 55% opacity, strikethrough
- **Stale** — desaturated, dashed `🪦 12d stale` chip
- **Compact** — no description, used in collapsed Done column

### Chips on cards
project (violet) · deadline (cyan, red+shake when overdue) · waiting-on (orange `⏳ @name`) · follow-up (blue `🔔 date`, bold if due) · tag (pink) · stale (dashed purple).

### Quick add (press `N`)
Inline shorthand parsed from a single input:
- `!!` → priority
- `#tag` → tag
- `due today` / `due tomorrow` / `due YYYY-MM-DD` → deadline at 17:00

### Date picker
Custom popover (no native picker). Renders via portal with `position: fixed` anchored to the trigger's bounding rect, so it escapes any modal `overflow: auto` clipping. Flips upward if there's no room below. Quick buttons: Today / Tomorrow / +1 week.

### Keyboard
- `N` — quick add
- `T` — jump to Today
- `Esc` — close any overlay
- (No j/k/cmd-K yet — planned)

### Visual direction
- Soft gradient background (peach → pink → sky → lavender)
- Frosted glass panels
- Primary action gradient: violet → hot pink (`#7c3aed → #ec4899`)
- Chunky rounded corners (12–20px), pill chips, soft shadows
- Animation: card lift on hover, checkbox pop on done, priority star wiggle, overdue chip shake
- Inter / system sans, gradient text on brand + section titles

---

## What's NOT built (roadmap, in rough priority order)
1. **⌘K command palette** — jump anywhere, create anything, search tasks
2. **Focus mode** — pick 1–3 tasks, full-screen, hide everything else
3. **Standup mode** — one-click PM-friendly copy-paste for daily standup
4. **Keyboard navigation** — j/k between cards, e edit, space toggle, p priority, 1/2/3 state
5. **Snooze** — defer task to a future date (hides until then)
6. **Eisenhower 2×2 view** — drag tasks across Urgent×Important
7. **Bulk actions** — multi-select cards, bulk done/move
8. **This Week view** — 7-column day grid

Full feature spec is *not* in this repo; the user has it pasted into Google Stitch for design generation. Ask the user if you need it.

---

## Gotchas / known issues
- `server/data.json` has legacy tasks without `updatedAt`/`completedAt`/`waitingOn`/`followUpDate`. Read paths fall back to `createdAt` and `|| ''`, so nothing breaks, but momentum stats and stale detection treat them as freshly created on the day the field landed.
- `Inbox` project (id: `inbox`) cannot be deleted. Deleting any other project moves its tasks back to Inbox.
- Vite dev proxy: `/api/*` → `localhost:5174`. If you change the server port, also change `vite.config.js`.
- When killing the dev process: kill the parent `npm run dev` (or `concurrently`), not the inner node processes individually — killing one child takes down the whole `concurrently` parent.

---

## Stitch MCP
User set up the Stitch MCP via:
```
claude mcp add stitch \
  --transport http \
  --header "X-Goog-Api-Key: <KEY>" \
  https://stitch.googleapis.com/mcp
```
Restarted Claude Code so it would register. In the new session, `mcp__stitch__*` tools should be available — use ToolSearch with `query: "stitch", max_results: 20` to load them.

**Security note:** the API key was pasted in the previous session's transcript. User should rotate it if real.

---

## How to pick up
1. Run `npm run dev` from the project dir.
2. Open http://localhost:5173.
3. Check `git status` / `git log` if the user has initialized git (likely not yet — repo is uncommitted).
4. Ask the user what they want next — usually one of: keep building from the roadmap, integrate Stitch designs, or refactor what's there.
