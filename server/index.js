import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import { createHash } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data.json');

const DEFAULT_DATA = {
  projects: [
    { id: 'inbox', name: 'Inbox', color: '#6b7280' },
  ],
  tasks: [],
};

async function readData() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(raw);
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
    state: req.body.state || 'active',
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

function buildDigest(tasks, projects, now = new Date()) {
  const nameOf = (id) => projects.find((p) => p.id === id)?.name || 'Unknown';
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const weekStart = new Date(start);
  weekStart.setDate(weekStart.getDate() - 7);

  const daysFromNow = (iso) =>
    iso ? Math.floor((Date.now() - new Date(iso).getTime()) / MS_DAY) : 0;

  const open = tasks.filter((t) => t.state !== 'done');

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

  const stale = open
    .filter((t) => {
      const ref = t.updatedAt || t.createdAt;
      return (
        daysFromNow(ref) >= 7 &&
        !followUpIds.has(t.id) &&
        !overdueIds.has(t.id) &&
        !todayIds.has(t.id) &&
        !floatingIds.has(t.id)
      );
    })
    .slice(0, 5);

  // Anything I'm waiting on someone for — useful even if the follow-up date
  // hasn't hit yet. Sorted by longest wait.
  const blocked = open
    .filter((t) => t.waitingOn && !followUpIds.has(t.id))
    .map((t) => ({
      title: t.title,
      project: nameOf(t.projectId),
      waitingOn: t.waitingOn,
      daysWaiting: daysFromNow(t.updatedAt || t.createdAt),
      priority: !!t.priority,
    }))
    .sort((a, b) => b.daysWaiting - a.daysWaiting)
    .slice(0, 5);

  const doneToday = tasks.filter(
    (t) => t.state === 'done' && t.completedAt && new Date(t.completedAt) >= start,
  ).length;
  const doneThisWeek = tasks.filter(
    (t) => t.state === 'done' && t.completedAt && new Date(t.completedAt) >= weekStart,
  ).length;

  // Local YYYY-MM-DD, not UTC. toISOString() would shift forward/back across timezones.
  const localDate =
    start.getFullYear() +
    '-' +
    String(start.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(start.getDate()).padStart(2, '0');

  return {
    date: localDate,
    overdue: overdue.map((t) => ({
      title: t.title,
      project: nameOf(t.projectId),
      priority: !!t.priority,
      daysLate: t.deadline ? Math.floor((start - new Date(t.deadline)) / MS_DAY) : 0,
      waitingOn: t.waitingOn || null,
    })),
    followUpsDue: followUpsDue.map((t) => ({
      title: t.title,
      project: nameOf(t.projectId),
      waitingOn: t.waitingOn || null,
      daysSinceUpdate: daysFromNow(t.updatedAt || t.createdAt),
    })),
    dueToday: dueToday.map((t) => ({
      title: t.title,
      project: nameOf(t.projectId),
      priority: !!t.priority,
      waitingOn: t.waitingOn || null,
    })),
    priorityFloating: priorityFloating.map((t) => ({
      title: t.title,
      project: nameOf(t.projectId),
      daysSinceUpdate: daysFromNow(t.updatedAt || t.createdAt),
    })),
    stale: stale.map((t) => ({
      title: t.title,
      project: nameOf(t.projectId),
      daysSinceUpdate: daysFromNow(t.updatedAt || t.createdAt),
    })),
    blocked,
    momentum: { doneToday, doneThisWeek },
  };
}

function digestHash(digest) {
  return createHash('sha1').update(JSON.stringify(digest)).digest('hex');
}

function deterministicFallback(d) {
  const lines = [];
  if (d.overdue.length) {
    const first = d.overdue[0];
    const lateStr = first.daysLate > 0 ? ` (${first.daysLate}d late)` : '';
    lines.push(
      `• ${d.overdue.length} overdue${first.priority ? ', priority first' : ''}: "${first.title}"${lateStr}.`,
    );
  }
  if (d.followUpsDue.length) {
    const f = d.followUpsDue[0];
    const who = f.waitingOn ? `@${f.waitingOn}` : 'someone';
    const wait = f.daysSinceUpdate ? ` (waiting ${f.daysSinceUpdate}d)` : '';
    lines.push(`• Follow up with ${who} on "${f.title}"${wait}.`);
  }
  if (d.dueToday.length) {
    lines.push(
      `• ${d.dueToday.length} due today${d.dueToday.some((t) => t.priority) ? ', some priority' : ''}.`,
    );
  }
  if (d.priorityFloating.length) {
    lines.push(
      `• ${d.priorityFloating.length} priority items still floating without a deadline.`,
    );
  }
  if (d.stale.length) {
    lines.push(`• ${d.stale.length} tasks gone stale (7+ days untouched).`);
  }
  if (d.momentum.doneToday >= 3) {
    lines.push(`• ${d.momentum.doneToday} done already today — keep the streak.`);
  }
  if (lines.length === 0) {
    lines.push('• Clear runway. Pick a priority task and protect a focus block.');
  }
  return lines.join('\n');
}

const BRIEFING_SYSTEM_PROMPT = `You write daily morning briefings for a personal task planner used by a product manager.

Voice: a sharp chief of staff. Brief, declarative, action-first. No greetings. No fluff. No "consider", "you might want to", "looks like", "it seems". Be direct.

Format: 3 to 5 bullet points, each starting with "• ". Total output under 80 words. No header. No closing line.

Priority order for what to include (drop the bottom if you run out of room):
1. Long-waiting follow-ups (mention the person from waitingOn and days waiting)
2. Overdue priority items
3. Other overdue items
4. Today's deadlines
5. People you're blocked on from "blocked" (mention @name and days waiting) — especially if waiting >3 days
6. Floating priority items (no deadline)

Hard rules:
- Only mention people, projects, or task titles that appear in the JSON. Never invent details.
- If a field is null, do not reference it.
- Numbers must match the JSON exactly.
- Refer to people as "@name" using the waitingOn value verbatim.
- If overdue, followUpsDue, dueToday, AND blocked are all empty, output a single bullet: "• Clear runway. Pick a priority task and protect a focus block."

Output ONLY the bullets. No JSON. No preamble. No commentary about the data.`;

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
          { role: 'user', content: JSON.stringify(digest, null, 2) },
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
    return text || null;
  } catch (err) {
    console.error('[briefing] anthropic exception', err.message);
    return null;
  }
}

app.post('/api/briefing', async (req, res) => {
  const refresh =
    req.query.refresh === '1' || req.query.refresh === 'true' || req.body?.refresh === true;
  const data = await readData();
  const digest = buildDigest(data.tasks, data.projects);
  const hash = digestHash(digest);

  const cached = data.briefing;
  if (
    !refresh &&
    cached &&
    cached.hash === hash &&
    cached.date === digest.date &&
    cached.text
  ) {
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
    text = await callHaiku(digest, apiKey);
    if (text) source = 'haiku';
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

const PORT = 5174;
app.listen(PORT, () => {
  const ai = process.env.ANTHROPIC_API_KEY ? 'ON (Haiku 4.5)' : 'OFF (no ANTHROPIC_API_KEY)';
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[briefing] AI summaries: ${ai}`);
});
