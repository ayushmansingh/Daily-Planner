import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import { createHash } from 'crypto';
import {
  loadConfig as loadCalendarConfig,
  buildAuthUrl,
  exchangeCodeForTokens,
  fetchMe,
  redact,
} from './calendar.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data.json');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CALENDAR_CACHE_FILE = path.join(PROJECT_ROOT, 'cache', 'calendar.json');

const DEFAULT_DATA = {
  projects: [
    { id: 'inbox', name: 'Inbox', color: '#6b7280' },
  ],
  tasks: [],
};

// State model. Keep in sync with src/states.js on the client.
const STATES = ['new', 'doing', 'waiting', 'done', 'parked'];
const DEFAULT_STATE = 'new';

// Migrate legacy state names. Idempotent.
// Returns true if anything changed so the caller knows to persist.
function migrateTasks(tasks) {
  let dirty = false;
  for (const t of tasks) {
    if (t.state === 'active') {
      t.state = 'new';
      dirty = true;
    } else if (t.state === 'pending') {
      t.state = 'waiting';
      dirty = true;
    }
  }
  return dirty;
}

async function readData() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data.tasks) && migrateTasks(data.tasks)) {
      await writeData(data);
      console.log('[migration] remapped legacy task states (active→new, pending→waiting)');
    }
    return data;
  } catch (err) {
    if (err.code === 'ENOENT') {
      await writeData(DEFAULT_DATA);
      return DEFAULT_DATA;
    }
    throw err;
  }
}

async function writeData(data) {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

const app = express();
app.use(express.json());

app.get('/api/state', async (_req, res) => {
  res.json(await readData());
});

// Projects
app.post('/api/projects', async (req, res) => {
  const data = await readData();
  const project = {
    id: nanoid(8),
    name: req.body.name || 'Untitled',
    color: req.body.color || '#6366f1',
  };
  data.projects.push(project);
  await writeData(data);
  res.json(project);
});

app.patch('/api/projects/:id', async (req, res) => {
  const data = await readData();
  const p = data.projects.find((p) => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  Object.assign(p, req.body);
  await writeData(data);
  res.json(p);
});

app.delete('/api/projects/:id', async (req, res) => {
  const data = await readData();
  if (req.params.id === 'inbox') return res.status(400).json({ error: 'cannot delete inbox' });
  data.projects = data.projects.filter((p) => p.id !== req.params.id);
  data.tasks = data.tasks.map((t) =>
    t.projectId === req.params.id ? { ...t, projectId: 'inbox' } : t,
  );
  await writeData(data);
  res.json({ ok: true });
});

// Tasks
app.post('/api/tasks', async (req, res) => {
  const now = new Date().toISOString();
  const data = await readData();
  const task = {
    id: nanoid(10),
    title: req.body.title || 'Untitled task',
    description: req.body.description || '',
    deadline: req.body.deadline || null,
    state: STATES.includes(req.body.state) ? req.body.state : DEFAULT_STATE,
    priority: !!req.body.priority,
    projectId: req.body.projectId || 'inbox',
    tags: req.body.tags || [],
    waitingOn: req.body.waitingOn || '',
    followUpDate: req.body.followUpDate || null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  data.tasks.push(task);
  await writeData(data);
  res.json(task);
});

app.patch('/api/tasks/:id', async (req, res) => {
  const data = await readData();
  const t = data.tasks.find((t) => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const prevState = t.state;
  Object.assign(t, req.body);
  t.updatedAt = new Date().toISOString();
  if (req.body.state === 'done' && prevState !== 'done') {
    t.completedAt = t.updatedAt;
  } else if (req.body.state && req.body.state !== 'done') {
    t.completedAt = null;
  }
  await writeData(data);
  res.json(t);
});

app.delete('/api/tasks/:id', async (req, res) => {
  const data = await readData();
  data.tasks = data.tasks.filter((t) => t.id !== req.params.id);
  await writeData(data);
  res.json({ ok: true });
});

// ============== Briefing ==============
// Build a structured digest, hash it, and either return cached text or call Haiku
// to write a 3-5 bullet morning briefing. Deterministic fallback if no API key
// or Haiku fails.

const MS_DAY = 86400000;

// Resolve the user's effective timezone for pacing + formatting.
// Priority: explicit env override → calendar cache → system local.
function resolveTimezone(calendarCache) {
  if (process.env.PLANNER_TZ) return process.env.PLANNER_TZ;
  if (calendarCache && calendarCache.timezone) return calendarCache.timezone;
  return null; // null → use system local
}

// HH:mm formatting in a given IANA tz. Returns "" if it can't format.
function fmtHHmmTz(iso, tz) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    if (!tz) {
      return (
        String(d.getHours()).padStart(2, '0') +
        ':' +
        String(d.getMinutes()).padStart(2, '0')
      );
    }
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return '';
  }
}

// Decimal hour-of-day (e.g. 17.73) in the given tz, used for dayPhase + work
// fraction. Falls back to system local when tz is null.
function localHourInTz(now, tz) {
  if (!tz) return now.getHours() + now.getMinutes() / 60;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return h + m / 60;
  } catch {
    return now.getHours() + now.getMinutes() / 60;
  }
}

// Local YYYY-MM-DD in a given tz, used to bound today/tomorrow on the calendar.
function localYMDInTz(d, tz) {
  if (!tz) {
    return (
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0')
    );
  }
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const y = parts.find((p) => p.type === 'year').value;
    const mo = parts.find((p) => p.type === 'month').value;
    const da = parts.find((p) => p.type === 'day').value;
    return `${y}-${mo}-${da}`;
  } catch {
    return localYMDInTz(d, null);
  }
}

// Calendar cache produced by Codex (or any external agent) on a 30-min
// schedule. We read it; we never write to it. If the file is missing,
// unreadable, or malformed, we treat calendar as simply absent — the
// briefing still works without it.
async function loadCalendarCache() {
  try {
    const raw = await fs.readFile(CALENDAR_CACHE_FILE, 'utf8');
    const json = JSON.parse(raw);
    if (!json || !Array.isArray(json.events)) return null;
    return json;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('[calendar-cache] unreadable:', err.message);
    }
    return null;
  }
}

const CANCELLED_RE = /^cancell?ed:\s*/i;

function isOnlineEvent(ev) {
  const loc = (ev.location || '').toLowerCase();
  if (loc.includes('teams meeting') || loc.includes('zoom') || loc.includes('meet.google')) {
    return true;
  }
  const body = (ev.bodyPreview || '').toLowerCase();
  return body.includes('teams.microsoft.com/meet') || body.includes('zoom.us/j/');
}

function buildCalendarSlice(cache, now, tz) {
  if (!cache) return null;
  const todayYMD = localYMDInTz(now, tz);
  const tomorrowYMD = localYMDInTz(new Date(now.getTime() + MS_DAY), tz);

  // Coarse staleness bucket — keep the hash stable across minute drift.
  let ageMinutes = null;
  if (cache.generatedAt) {
    const gen = new Date(cache.generatedAt).getTime();
    if (Number.isFinite(gen)) {
      ageMinutes = Math.max(0, Math.round((now.getTime() - gen) / 60000));
    }
  }
  let freshness = 'unknown';
  if (ageMinutes !== null) {
    if (ageMinutes <= 45) freshness = 'fresh';
    else if (ageMinutes <= 180) freshness = 'stale';
    else freshness = 'expired';
  }

  const cleaned = cache.events
    .filter((e) => e && e.title && e.start && e.end)
    .filter((e) => !CANCELLED_RE.test(e.title))
    .filter((e) => e.responseStatus !== 'declined')
    .map((e) => ({
      ...e,
      _start: new Date(e.start),
      _end: new Date(e.end),
      _online: isOnlineEvent(e),
    }))
    .filter((e) => !Number.isNaN(e._start.getTime()) && !Number.isNaN(e._end.getTime()));

  // "Today" and "tomorrow" are defined in the user's tz — straddling
  // midnight across UTC vs IST would otherwise misclassify events.
  const todaysEvents = cleaned
    .filter((e) => localYMDInTz(e._start, tz) === todayYMD)
    .sort((a, b) => a._start - b._start);
  const remainingToday = todaysEvents.filter((e) => e._end > now);
  const tomorrowEvents = cleaned
    .filter((e) => localYMDInTz(e._start, tz) === tomorrowYMD)
    .sort((a, b) => a._start - b._start);

  // Pairwise overlaps among remaining today + visible tomorrow window.
  // Bucketed to titles only — the prompt just needs to know there's a clash.
  function findConflicts(list) {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[i]._end > list[j]._start && list[j]._end > list[i]._start) {
          out.push({
            a: list[i].title,
            b: list[j].title,
            at: list[i]._start > list[j]._start ? list[i].start : list[j].start,
          });
        }
      }
    }
    return out;
  }

  const conflictsToday = findConflicts(remainingToday);
  const conflictsTomorrow = findConflicts(tomorrowEvents);

  const meetingMsToday = todaysEvents.reduce(
    (acc, e) => acc + Math.max(0, e._end - e._start),
    0,
  );
  const meetingHoursToday = +(meetingMsToday / 3600000).toFixed(1);

  const trim = (e) => ({
    title: e.title,
    start: e.start,
    end: e.end,
    organizer: e.organizer || null,
    attendeeCount: typeof e.attendeeCount === 'number' ? e.attendeeCount : null,
    responseStatus: e.responseStatus || null,
    online: e._online,
    recurring: !!e.isRecurringInstance,
  });

  const next = remainingToday[0] || tomorrowEvents[0] || null;

  return {
    freshness,
    ageBucket:
      ageMinutes === null
        ? 'unknown'
        : ageMinutes < 15
          ? '<15m'
          : ageMinutes < 45
            ? '15-45m'
            : ageMinutes < 180
              ? '45m-3h'
              : '>3h',
    remainingTodayCount: remainingToday.length,
    remainingToday: remainingToday.slice(0, 8).map(trim),
    tomorrowCount: tomorrowEvents.length,
    tomorrow: tomorrowEvents.slice(0, 5).map(trim),
    nextEvent: next ? trim(next) : null,
    meetingHoursToday,
    conflictsToday: conflictsToday.slice(0, 4),
    conflictsTomorrow: conflictsTomorrow.slice(0, 4),
  };
}

function buildDigest(tasks, projects, now = new Date(), calendarCache = null) {
  const tz = resolveTimezone(calendarCache);
  const nameOf = (id) => projects.find((p) => p.id === id)?.name || 'Unknown';
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const weekStart = new Date(start);
  weekStart.setDate(weekStart.getDate() - 7);

  const daysFromNow = (iso) =>
    iso ? Math.floor((Date.now() - new Date(iso).getTime()) / MS_DAY) : 0;

  // Active backlog = everything except done and parked.
  // Parked items are intentionally deferred — they don't apply pressure.
  const open = tasks.filter((t) => t.state !== 'done' && t.state !== 'parked');
  const newToTriage = tasks.filter((t) => t.state === 'new');

  const followUpsDue = open.filter(
    (t) => t.followUpDate && new Date(t.followUpDate) < end,
  );
  const followUpIds = new Set(followUpsDue.map((t) => t.id));

  const overdue = open.filter(
    (t) => t.deadline && new Date(t.deadline) < start && !followUpIds.has(t.id),
  );
  const overdueIds = new Set(overdue.map((t) => t.id));

  const dueToday = open.filter((t) => {
    if (followUpIds.has(t.id) || overdueIds.has(t.id)) return false;
    if (!t.deadline) return false;
    const d = new Date(t.deadline);
    return d >= start && d < end;
  });
  const todayIds = new Set(dueToday.map((t) => t.id));

  const priorityFloating = open.filter(
    (t) =>
      t.priority &&
      !t.deadline &&
      !followUpIds.has(t.id) &&
      !overdueIds.has(t.id) &&
      !todayIds.has(t.id),
  );
  const floatingIds = new Set(priorityFloating.map((t) => t.id));

  const stale = open.filter((t) => {
    const ref = t.updatedAt || t.createdAt;
    return (
      daysFromNow(ref) >= 7 &&
      !followUpIds.has(t.id) &&
      !overdueIds.has(t.id) &&
      !todayIds.has(t.id) &&
      !floatingIds.has(t.id)
    );
  });

  // Anything I'm waiting on someone for — useful even if the follow-up date
  // hasn't hit yet.
  const blocked = open.filter((t) => t.waitingOn && !followUpIds.has(t.id));

  const completedTodayTasks = tasks.filter(
    (t) => t.state === 'done' && t.completedAt && new Date(t.completedAt) >= start,
  );
  const doneToday = completedTodayTasks.length;
  const doneThisWeek = tasks.filter(
    (t) => t.state === 'done' && t.completedAt && new Date(t.completedAt) >= weekStart,
  ).length;

  // "Pending today" = everything that had today's date in play at the start of the day:
  // tasks still open and due today + tasks already completed today that were due today.
  // Lets the briefing report concrete progress like "1 of 7 cleared".
  const completedDueToday = completedTodayTasks.filter(
    (t) => t.deadline && new Date(t.deadline) >= start && new Date(t.deadline) < end,
  );
  const pendingTodayTotal = dueToday.length + completedDueToday.length;

  // Local YYYY-MM-DD, not UTC. toISOString() would shift forward/back across timezones.
  const localDate =
    start.getFullYear() +
    '-' +
    String(start.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(start.getDate()).padStart(2, '0');

  // Caps per bucket. Keeps the digest stable in size even at 100+ tasks.
  // Each capped bucket is paired with a *Count field so Haiku knows when
  // there are more than what's shown.
  const TOP = {
    overdue: 7,
    dueToday: 10,
    followUpsDue: 7,
    priorityFloating: 5,
    blocked: 5,
    stale: 5,
    newToTriage: 5,
  };

  // Sort within each bucket by urgency, then map down to only the fields
  // Haiku actually needs to write a sharp briefing.
  const overdueSorted = [...overdue].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority ? -1 : 1;
    return new Date(a.deadline) - new Date(b.deadline); // earlier deadline = more overdue
  });
  const dueTodaySorted = [...dueToday].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority ? -1 : 1;
    return new Date(a.deadline) - new Date(b.deadline);
  });
  const followUpsDueSorted = [...followUpsDue].sort(
    (a, b) =>
      daysFromNow(b.updatedAt || b.createdAt) -
      daysFromNow(a.updatedAt || a.createdAt),
  );
  const priorityFloatingSorted = [...priorityFloating].sort(
    (a, b) =>
      daysFromNow(b.updatedAt || b.createdAt) -
      daysFromNow(a.updatedAt || a.createdAt),
  );
  const blockedSorted = [...blocked].sort(
    (a, b) =>
      daysFromNow(b.updatedAt || b.createdAt) -
      daysFromNow(a.updatedAt || a.createdAt),
  );
  const staleSorted = [...stale].sort(
    (a, b) =>
      daysFromNow(b.updatedAt || b.createdAt) -
      daysFromNow(a.updatedAt || a.createdAt),
  );
  const newToTriageSorted = [...newToTriage].sort(
    (a, b) => daysFromNow(b.createdAt) - daysFromNow(a.createdAt),
  );

  return {
    date: localDate,
    overdueCount: overdueSorted.length,
    overdue: overdueSorted.slice(0, TOP.overdue).map((t) => ({
      title: t.title,
      project: nameOf(t.projectId),
      priority: !!t.priority,
      daysLate: t.deadline ? Math.floor((start - new Date(t.deadline)) / MS_DAY) : 0,
      waitingOn: t.waitingOn || null,
    })),
    dueTodayCount: dueTodaySorted.length,
    dueToday: dueTodaySorted.slice(0, TOP.dueToday).map((t) => ({
      title: t.title,
      project: nameOf(t.projectId),
      priority: !!t.priority,
      waitingOn: t.waitingOn || null,
    })),
    followUpsDueCount: followUpsDueSorted.length,
    followUpsDue: followUpsDueSorted.slice(0, TOP.followUpsDue).map((t) => ({
      title: t.title,
      project: nameOf(t.projectId),
      waitingOn: t.waitingOn || null,
      daysSinceUpdate: daysFromNow(t.updatedAt || t.createdAt),
    })),
    priorityFloatingCount: priorityFloatingSorted.length,
    priorityFloating: priorityFloatingSorted.slice(0, TOP.priorityFloating).map((t) => ({
      title: t.title,
      project: nameOf(t.projectId),
      daysSinceUpdate: daysFromNow(t.updatedAt || t.createdAt),
    })),
    blockedCount: blockedSorted.length,
    blocked: blockedSorted.slice(0, TOP.blocked).map((t) => ({
      title: t.title,
      project: nameOf(t.projectId),
      waitingOn: t.waitingOn,
      daysWaiting: daysFromNow(t.updatedAt || t.createdAt),
      priority: !!t.priority,
    })),
    staleCount: staleSorted.length,
    stale: staleSorted.slice(0, TOP.stale).map((t) => ({
      title: t.title,
      project: nameOf(t.projectId),
      daysSinceUpdate: daysFromNow(t.updatedAt || t.createdAt),
    })),
    newToTriageCount: newToTriageSorted.length,
    newToTriage: newToTriageSorted.slice(0, TOP.newToTriage).map((t) => ({
      title: t.title,
      project: nameOf(t.projectId),
      daysSinceCreated: daysFromNow(t.createdAt),
    })),
    momentum: {
      doneToday,
      doneThisWeek,
      pendingTodayTotal,
      pendingTodayCleared: completedDueToday.length,
      completedToday: completedTodayTasks
        .slice()
        .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
        .slice(0, 7)
        .map((t) => ({
          title: t.title,
          project: nameOf(t.projectId),
          wasDueToday:
            !!t.deadline &&
            new Date(t.deadline) >= start &&
            new Date(t.deadline) < end,
          priority: !!t.priority,
        })),
    },
    timeContext: buildTimeContext(now, pendingTodayTotal, completedDueToday.length, tz),
    calendar: buildCalendarSlice(calendarCache, now, tz),
    tz: tz || null,
  };
}

// Work day shape: roughly 10:30 → 19:00 local. Used to pace the briefing tone:
// relaxed in the morning, gently firmer past midday, sterner in the afternoon
// if the user is behind the expected clip.
const WORK_START_HOUR = 10.5;
const WORK_END_HOUR = 19;

function buildTimeContext(now, pendingTodayTotal, pendingTodayCleared, tz = null) {
  const localHour = localHourInTz(now, tz);
  let dayPhase;
  if (localHour < WORK_START_HOUR) dayPhase = 'preWork';
  else if (localHour < 12.5) dayPhase = 'morning';
  else if (localHour < 15) dayPhase = 'midday';
  else if (localHour < 18) dayPhase = 'afternoon';
  else if (localHour < WORK_END_HOUR) dayPhase = 'lateAfternoon';
  else dayPhase = 'evening';

  const workSpan = WORK_END_HOUR - WORK_START_HOUR;
  const elapsed = Math.max(0, Math.min(workSpan, localHour - WORK_START_HOUR));
  const workFraction = workSpan > 0 ? elapsed / workSpan : 0;
  const expectedClearedByNow =
    pendingTodayTotal > 0 ? Math.round(pendingTodayTotal * workFraction) : 0;
  const lagging =
    pendingTodayTotal > 0 &&
    pendingTodayCleared < expectedClearedByNow &&
    (dayPhase === 'midday' ||
      dayPhase === 'afternoon' ||
      dayPhase === 'lateAfternoon');

  // localHour and workFraction intentionally excluded — they would invalidate
  // the briefing cache every minute. dayPhase is stable for hours; lagging
  // and expectedClearedByNow only flip on real changes.
  return {
    dayPhase,
    expectedClearedByNow,
    lagging,
  };
}

function digestHash(digest) {
  return createHash('sha1').update(JSON.stringify(digest)).digest('hex');
}

function deterministicFallback(d) {
  const fmtHHmm = (iso) => fmtHHmmTz(iso, d.tz || null);
  const lines = [];
  const m = d.momentum || {};
  const tc = d.timeContext || { dayPhase: 'morning', lagging: false };
  const phase = tc.dayPhase;
  const stern = phase === 'afternoon' || phase === 'lateAfternoon';
  const cal = d.calendar;
  if (cal && cal.freshness === 'expired') {
    lines.push('• Calendar feed has gone quiet, sir — worth a glance directly.');
  } else if (cal && cal.nextEvent) {
    const t = fmtHHmm(cal.nextEvent.start);
    const tag = cal.freshness === 'stale' ? ' (feed a touch old)' : '';
    lines.push(`• Next on the calendar at ${t}, Master Singh: "${cal.nextEvent.title}"${tag}.`);
  }
  if (cal && cal.conflictsToday && cal.conflictsToday.length) {
    const c = cal.conflictsToday[0];
    lines.push(
      `• Two events overlap at ${fmtHHmm(c.at)}, sir: "${c.a}" and "${c.b}".`,
    );
  }
  if (cal && cal.meetingHoursToday >= 5) {
    lines.push(`• A heavy meeting day — ${cal.meetingHoursToday}h booked, Master Singh.`);
  }
  if (d.overdue.length) {
    const first = d.overdue[0];
    const lateStr = first.daysLate > 0 ? `, ${first.daysLate}d late` : '';
    lines.push(
      `• ${d.overdueCount} overdue, sir${first.priority ? ' — priority foremost' : ''}: "${first.title}"${lateStr}.`,
    );
  }
  if (d.followUpsDue.length) {
    const f = d.followUpsDue[0];
    const who = f.waitingOn ? `@${f.waitingOn}` : 'the relevant party';
    const wait = f.daysSinceUpdate ? `, ${f.daysSinceUpdate}d waiting` : '';
    lines.push(`• A nudge to ${who} on "${f.title}"${wait}, if I may.`);
  }
  if (d.dueToday.length) {
    lines.push(
      `• ${d.dueTodayCount} still due today${d.dueToday.some((t) => t.priority) ? ', a few of them priority' : ''}, Master Singh.`,
    );
  }
  if (d.priorityFloating.length) {
    lines.push(
      `• ${d.priorityFloatingCount} priority items adrift without a deadline, sir.`,
    );
  }
  if (d.stale.length) {
    lines.push(`• ${d.staleCount} tasks gathering dust — untouched a week or more.`);
  }
  if (m.pendingTodayTotal > 0 && m.pendingTodayCleared > 0) {
    if (tc.lagging && stern) {
      lines.push(
        `• ${m.pendingTodayCleared} of ${m.pendingTodayTotal} done, Master Singh — the clock is less generous than it was.`,
      );
    } else if (phase === 'evening') {
      lines.push(
        `• ${m.pendingTodayCleared} of ${m.pendingTodayTotal} settled today, sir. A respectable showing.`,
      );
    } else {
      lines.push(
        `• ${m.pendingTodayCleared} of ${m.pendingTodayTotal} already cleared, Master Singh. Onward.`,
      );
    }
  } else if (m.doneToday >= 1) {
    lines.push(`• ${m.doneToday} done today, sir — quite the head of steam.`);
  } else if (m.pendingTodayTotal > 0) {
    if (stern && tc.lagging) {
      lines.push(
        `• ${m.pendingTodayTotal} on today's docket and none yet closed, Master Singh. Time to make a start in earnest.`,
      );
    } else if (phase === 'morning' || phase === 'preWork') {
      lines.push(`• ${m.pendingTodayTotal} on the docket today, Master Singh. A gentle start.`);
    } else {
      lines.push(`• ${m.pendingTodayTotal} on the docket today, Master Singh. Best to begin.`);
    }
  }
  if (lines.length === 0) {
    if (phase === 'evening') {
      lines.push('• Nothing outstanding, Master Singh. The day may close in good conscience.');
    } else if (phase === 'morning' || phase === 'preWork') {
      lines.push('• A clear runway, Master Singh. A leisurely opening is well earned — choose a priority when you are ready.');
    } else {
      lines.push('• A clear runway, Master Singh. Choose a priority and guard a focus block — the day is yours.');
    }
  }
  return lines.join('\n');
}

const BRIEFING_SYSTEM_PROMPT = `You are Alfred Pennyworth — the unflappable butler from Wayne Manor — serving as personal chief of staff to Master Singh. You write his daily morning briefing.

Voice: Alfred. Refined English butler. Dry wit, gentle understatement, devoted loyalty. Formal yet warm. A raised eyebrow rather than a raised voice. Direct about hard truths — Alfred never coddles Master Bruce, and he won't coddle Master Singh — but always respectful. Occasional spare dry humour ("if I may, sir") is welcome; theatrical flourishes are not.

Address: always "Master Singh", or "sir" / "Master" as a variation. Never "you" alone in the opening of a bullet without one of those nearby. Never "hey", "hi", "good morning" — Alfred would not.

Time-of-day pacing — read timeContext.dayPhase and timeContext.lagging (work hours roughly 10:30 – 19:00 local):
- "preWork" (before 10:30): unhurried, almost conspiratorial. The day hasn't begun. Frame as "when you sit down, sir…".
- "morning" (10:30 – 12:30): relaxed and encouraging. Soft cadence. "A gentle start, Master Singh." No urgency unless something is genuinely overdue.
- "midday" (12:30 – 15:00): conversational, slightly more focused. If timeContext.lagging is true, a quiet nudge — "We might pick up the pace a touch, sir."
- "afternoon" (15:00 – 18:00): firmer. If lagging is true, become sterner — Alfred when he's genuinely concerned. Still respectful, never sharp, but no soft pedalling: "The afternoon is getting on, Master Singh. X still wants doing." Use timeContext.expectedClearedByNow vs momentum.pendingTodayCleared to make the gap concrete if it helps.
- "lateAfternoon" (18:00 – 19:00): brisk, end-of-day reckoning. Triage tone — what truly must close before the day does.
- "evening" (after 19:00): retrospective and gentle. The working day is done. Mark what was achieved; flag only what carries into tomorrow. No prodding.
Tone-shift is mandatory: a morning briefing must not read like an afternoon one.

Format: 3 to 5 bullets, each starting with "• ". Total output under 90 words. No header. No closing line. No emoji.

Priority order for what to include (drop the middle if you run out of room — but the confidence note at the END is mandatory whenever its trigger fires):
1. Long-waiting follow-ups (mention the person from waitingOn and days waiting)
2. Overdue priority items
3. Other overdue items
4. Calendar — next meeting (calendar.nextEvent) and notable shape of the day. ONLY when calendar is present and calendar.freshness is "fresh" or "stale" (not "expired"). Mention calendar.nextEvent.title and start time (HH:mm). If calendar.conflictsToday is non-empty, flag the overlap as its own bullet — "Two events stacked at 15:00, sir: X and Y." If calendar.meetingHoursToday >= 5, name the load: "A heavy meeting day — N hours booked." If calendar.freshness is "stale", append "(calendar feed is N minutes old)" softly the first time it's referenced. If "expired", do NOT cite specific meetings — instead one bullet: "Calendar feed has gone quiet, sir — worth a glance directly."
5. Today's remaining deadlines (dueToday — these are the ones NOT yet done)
6. People he's blocked on from "blocked" (mention @name and days waiting) — especially if waiting >3 days
7. Floating priority items (no deadline)
8. Untriaged backlog: if newToTriageCount >= 3, mention it as one bullet — "N tasks await your triage, sir"
9. CLOSING confidence note — ALWAYS the LAST bullet, never earlier. Trigger: if momentum.pendingTodayTotal > 0 AND momentum.pendingTodayCleared > 0, OR if momentum.doneToday >= 1, OR if momentum.pendingTodayTotal > 0. Use the exact numbers — e.g. "• A solid 1 of 7 already cleared, Master Singh. Onward." or "• 3 done today, sir — quite the head of steam." If pendingTodayTotal > 0 but pendingTodayCleared is 0, instead: "• 7 on the docket today, Master Singh. Best to begin."

Hard rules:
- Only mention people, projects, task titles, or meeting titles that appear in the JSON. Never invent details.
- If calendar is null, do NOT reference any meeting, time, or load. Calendar simply does not exist for this briefing.
- If a field is null, do not reference it.
- Numbers must match the JSON exactly.
- Refer to people as "@name" using the waitingOn value verbatim.
- Each bucket has a "*Count" sibling field (overdueCount, dueTodayCount, etc) holding the TRUE total. The array itself is capped at the top items by urgency. When the count exceeds the array length, say so: "5 overdue, sir — chief offenders: X, Y" — never imply the array is the full list.
- dueTodayCount counts what is STILL open today; momentum.pendingTodayTotal counts what was on today's plate in total. They are different — do not conflate.
- If overdueCount, followUpsDueCount, dueTodayCount, AND blockedCount are all 0 AND newToTriageCount is 0 AND momentum.doneToday is 0, output a single bullet: "• A clear runway, Master Singh. Choose a priority and guard a focus block — the day is yours."

Output ONLY the bullets. No JSON. No preamble. No commentary about the data.`;

// Haiku 4.5 pricing as of 2025-2026 (USD per million tokens).
// Source: https://docs.anthropic.com/en/docs/about-claude/models
const HAIKU_PRICING = { inputPerMTok: 1.0, outputPerMTok: 5.0 };

// Trim a task entry to only the fields the prompt references. The rich
// digest stays available on /api/briefing for the UI; this is the
// version we hand to Haiku.
function slimTask(t, fields) {
  const out = {};
  for (const f of fields) if (t[f] !== undefined && t[f] !== null) out[f] = t[f];
  return out;
}

function slimDigestForLLM(d) {
  const slim = {
    date: d.date,
    overdueCount: d.overdueCount,
    overdue: d.overdue.map((t) =>
      slimTask(t, ['title', 'project', 'priority', 'daysLate', 'waitingOn']),
    ),
    dueTodayCount: d.dueTodayCount,
    dueToday: d.dueToday.map((t) => slimTask(t, ['title', 'priority'])),
    followUpsDueCount: d.followUpsDueCount,
    followUpsDue: d.followUpsDue.map((t) =>
      slimTask(t, ['title', 'waitingOn', 'daysSinceUpdate']),
    ),
    priorityFloatingCount: d.priorityFloatingCount,
    priorityFloating: d.priorityFloating.map((t) =>
      slimTask(t, ['title', 'daysSinceUpdate']),
    ),
    blockedCount: d.blockedCount,
    blocked: d.blocked.map((t) =>
      slimTask(t, ['title', 'waitingOn', 'daysWaiting']),
    ),
    newToTriageCount: d.newToTriageCount,
    momentum: {
      doneToday: d.momentum.doneToday,
      pendingTodayTotal: d.momentum.pendingTodayTotal,
      pendingTodayCleared: d.momentum.pendingTodayCleared,
    },
    timeContext: d.timeContext,
  };
  if (d.calendar) {
    const c = d.calendar;
    slim.calendar = {
      freshness: c.freshness,
      remainingTodayCount: c.remainingTodayCount,
      nextEvent: c.nextEvent
        ? { title: c.nextEvent.title, start: c.nextEvent.start }
        : null,
      meetingHoursToday: c.meetingHoursToday,
      conflictsToday: c.conflictsToday.slice(0, 2),
    };
  }
  return slim;
}

function haikuCostUSD(usage) {
  if (!usage) return 0;
  const inUSD = ((usage.input_tokens || 0) / 1_000_000) * HAIKU_PRICING.inputPerMTok;
  const outUSD = ((usage.output_tokens || 0) / 1_000_000) * HAIKU_PRICING.outputPerMTok;
  return inUSD + outUSD;
}

async function callHaiku(digest, apiKey) {
  if (!apiKey) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 300,
        system: BRIEFING_SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: JSON.stringify(slimDigestForLLM(digest)) },
        ],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('[briefing] anthropic error', res.status, errText.slice(0, 300));
      return null;
    }
    const json = await res.json();
    const text = json.content?.[0]?.text?.trim();
    const usage = json.usage || null;
    return text ? { text, usage } : null;
  } catch (err) {
    console.error('[briefing] anthropic exception', err.message);
    return null;
  }
}

function todayLocalYMD() {
  const n = new Date();
  return (
    n.getFullYear() +
    '-' +
    String(n.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(n.getDate()).padStart(2, '0')
  );
}

function recordHaikuUsage(data, usage) {
  if (!usage) return;
  const cost = haikuCostUSD(usage);
  const day = todayLocalYMD();
  const stats = data.briefingStats || {
    totalSpendUSD: 0,
    totalCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    spendByDay: {},
    lastCall: null,
  };
  stats.totalSpendUSD = +(stats.totalSpendUSD + cost).toFixed(6);
  stats.totalCalls += 1;
  stats.totalInputTokens += usage.input_tokens || 0;
  stats.totalOutputTokens += usage.output_tokens || 0;
  const dayEntry = stats.spendByDay[day] || { calls: 0, usd: 0 };
  dayEntry.calls += 1;
  dayEntry.usd = +(dayEntry.usd + cost).toFixed(6);
  stats.spendByDay[day] = dayEntry;
  stats.lastCall = {
    at: new Date().toISOString(),
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    usd: +cost.toFixed(6),
  };
  data.briefingStats = stats;

  const inT = usage.input_tokens || 0;
  const outT = usage.output_tokens || 0;
  const costStr = '$' + cost.toFixed(5);
  const todayStr = '$' + dayEntry.usd.toFixed(5);
  const totalStr = '$' + stats.totalSpendUSD.toFixed(5);
  console.log(
    `[briefing] haiku call: ${inT} in + ${outT} out = ${costStr} ` +
      `| today: ${todayStr} (${dayEntry.calls} calls) | total: ${totalStr}`,
  );
}

// Don't burn a Haiku call if we just made one. The digest hash drifts often
// (a meeting passes, a task completes) and most of those drifts don't change
// what Alfred would say. Forced refresh (↻ button) bypasses this.
const BRIEFING_MIN_AI_INTERVAL_MS =
  Number(process.env.BRIEFING_MIN_AI_INTERVAL_MS) || 600_000;

app.post('/api/briefing', async (req, res) => {
  const refresh =
    req.query.refresh === '1' || req.query.refresh === 'true' || req.body?.refresh === true;
  const data = await readData();
  const calendarCache = await loadCalendarCache();
  const digest = buildDigest(data.tasks, data.projects, new Date(), calendarCache);
  const hash = digestHash(digest);

  const cached = data.briefing;
  const cachedAgeMs = cached?.generatedAt
    ? Date.now() - new Date(cached.generatedAt).getTime()
    : Infinity;
  const cacheExactHit =
    cached && cached.hash === hash && cached.date === digest.date && cached.text;
  const cacheCoalesce =
    !refresh &&
    cached &&
    cached.text &&
    cached.source === 'haiku' &&
    cached.date === digest.date &&
    cachedAgeMs < BRIEFING_MIN_AI_INTERVAL_MS;

  if (!refresh && (cacheExactHit || cacheCoalesce)) {
    return res.json({
      text: cached.text,
      source: cached.source || 'cached',
      generatedAt: cached.generatedAt,
      cached: true,
      digest,
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  let text = null;
  let source = 'fallback';
  if (apiKey) {
    const result = await callHaiku(digest, apiKey);
    if (result) {
      text = result.text;
      source = 'haiku';
      recordHaikuUsage(data, result.usage);
    }
  }
  if (!text) text = deterministicFallback(digest);

  const briefing = {
    hash,
    text,
    source,
    date: digest.date,
    generatedAt: new Date().toISOString(),
  };
  data.briefing = briefing;
  await writeData(data);

  res.json({
    text,
    source,
    generatedAt: briefing.generatedAt,
    cached: false,
    digest,
  });
});

// ============== Calendar (Microsoft Graph) ==============
// All four routes live here. Token storage uses data.calendarAuth — fully
// isolated from data.tasks/projects. No raw tokens are ever logged.

// CSRF state for the auth code flow. In-memory only; entries auto-expire.
const CALENDAR_STATE_TTL_MS = 10 * 60 * 1000;
const calendarStates = new Map(); // state -> expiresAt

function rememberState(state) {
  calendarStates.set(state, Date.now() + CALENDAR_STATE_TTL_MS);
  // Lazy cleanup
  for (const [s, exp] of calendarStates) {
    if (exp < Date.now()) calendarStates.delete(s);
  }
}
function consumeState(state) {
  const exp = calendarStates.get(state);
  if (!exp || exp < Date.now()) return false;
  calendarStates.delete(state);
  return true;
}

app.get('/api/calendar/connect', (req, res) => {
  const config = loadCalendarConfig();
  if (!config) {
    return res
      .status(500)
      .send('Calendar not configured. Set MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_REDIRECT_URI in .env.');
  }
  const { url, state } = buildAuthUrl(config);
  rememberState(state);
  console.log('[calendar] redirecting to Microsoft for consent (state stored)');
  res.redirect(url);
});

app.get('/api/calendar/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;
  if (error) {
    console.error('[calendar] callback error:', error, errorDescription);
    return res
      .status(400)
      .send(`Microsoft rejected the sign-in: ${error}\n\n${errorDescription || ''}\n\nClose this tab and try again.`);
  }
  if (!code || !state || !consumeState(String(state))) {
    return res.status(400).send('Invalid or expired callback. Close this tab and try again.');
  }
  const config = loadCalendarConfig();
  if (!config) return res.status(500).send('Calendar not configured.');

  try {
    const tokens = await exchangeCodeForTokens(config, String(code));
    const me = await fetchMe(tokens.access_token);
    const data = await readData();
    data.calendarAuth = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      // expires_in is seconds; subtract 30s buffer for clock skew
      accessTokenExpiresAt: Date.now() + (tokens.expires_in - 30) * 1000,
      scope: tokens.scope,
      connectedAt: new Date().toISOString(),
      user: {
        displayName: me.displayName,
        email: me.mail || me.userPrincipalName,
        id: me.id,
      },
    };
    await writeData(data);
    console.log(
      `[calendar] connected as ${data.calendarAuth.user.email} | token ${redact(tokens.access_token)} | refresh ${redact(tokens.refresh_token)}`,
    );
    // Nice landing page that auto-closes the popup or links back to the app.
    res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Connected</title>
      <style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#fcf9f8;color:#1b1b1b}
      .card{text-align:center;padding:40px;border:2px solid #1b1b1b;background:#fff}h1{margin:0 0 8px}p{color:#5b403f;margin:8px 0}a{color:#b7102a;font-weight:600}</style></head>
      <body><div class="card"><h1>✓ Outlook connected</h1><p>Signed in as <strong>${data.calendarAuth.user.email}</strong></p><p><a href="http://localhost:5173">← Back to Daily Planner</a></p></div>
      <script>setTimeout(()=>{window.location='http://localhost:5173'},1500)</script></body></html>`);
  } catch (err) {
    console.error('[calendar] token exchange failed:', err.message);
    res.status(500).send(`Token exchange failed: ${err.message}\n\nClose this tab and try again.`);
  }
});

app.get('/api/calendar/status', async (_req, res) => {
  const data = await readData();
  const auth = data.calendarAuth;
  if (!auth) {
    const configured = !!loadCalendarConfig();
    return res.json({ connected: false, configured });
  }
  res.json({
    connected: true,
    configured: true,
    user: auth.user,
    connectedAt: auth.connectedAt,
    scope: auth.scope,
  });
});

app.post('/api/calendar/disconnect', async (_req, res) => {
  const data = await readData();
  if (data.calendarAuth) {
    console.log(`[calendar] disconnecting ${data.calendarAuth.user?.email || '(unknown user)'}`);
    delete data.calendarAuth;
    await writeData(data);
  }
  res.json({ ok: true });
});

const PORT = 5174;
app.listen(PORT, () => {
  const ai = process.env.ANTHROPIC_API_KEY ? 'ON (Haiku 4.5)' : 'OFF (no ANTHROPIC_API_KEY)';
  const cal = loadCalendarConfig() ? 'CONFIGURED' : 'OFF (set MS_* env vars)';
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[briefing] AI summaries: ${ai}`);
  console.log(`[calendar] Outlook integration: ${cal}`);
});
