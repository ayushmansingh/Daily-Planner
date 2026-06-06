import TaskCard from './TaskCard.jsx';
import TodayBriefing from './TodayBriefing.jsx';
import { sortTasks, startOfToday, endOfToday, isFollowUpDue } from '../utils.js';

export default function TodayView({ tasks, projects, onEdit, onUpdate, onDelete }) {
  const start = startOfToday();
  const end = endOfToday();

  const open = tasks.filter((t) => t.state !== 'done');

  const followUpsToday = open.filter(isFollowUpDue);
  const followUpIds = new Set(followUpsToday.map((t) => t.id));

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
  const placedIds = new Set([
    ...followUpIds,
    ...overdueIds,
    ...dueToday.map((t) => t.id),
  ]);

  const priorityOther = open.filter((t) => t.priority && !placedIds.has(t.id));
  priorityOther.forEach((t) => placedIds.add(t.id));

  const upcoming = open
    .filter((t) => t.deadline && new Date(t.deadline) >= end && !placedIds.has(t.id))
    .slice(0, 10);

  // momentum
  const doneToday = tasks.filter(
    (t) => t.state === 'done' && t.completedAt && new Date(t.completedAt) >= start,
  ).length;
  const weekStart = new Date(start);
  weekStart.setDate(weekStart.getDate() - 7);
  const doneThisWeek = tasks.filter(
    (t) => t.state === 'done' && t.completedAt && new Date(t.completedAt) >= weekStart,
  ).length;

  const sections = [
    { label: '🔴 Overdue', tasks: sortTasks(overdue), tone: 'overdue' },
    { label: '🔔 Follow-ups due', tasks: sortTasks(followUpsToday), tone: 'followup' },
    { label: '☀️ Due today', tasks: sortTasks(dueToday), tone: 'today' },
    { label: '⭐ Priority', tasks: sortTasks(priorityOther), tone: 'priority' },
    { label: '📅 Upcoming', tasks: sortTasks(upcoming), tone: 'upcoming' },
  ];

  const anyTasks = sections.some((s) => s.tasks.length > 0);

  if (!anyTasks && doneToday === 0) {
    return (
      <div className="today empty-state">
        <h2>A clean slate ✨</h2>
        <p>
          Press <kbd>N</kbd> to capture a task, or hit "+ New task".
        </p>
        <p className="empty-hint">
          Try the inline shortcuts: <code>Ship pricing page !! #launch due tomorrow</code>
        </p>
      </div>
    );
  }

  return (
    <div className="today">
      <TodayBriefing tasks={tasks} />
      {sections.map(
        (s) =>
          s.tasks.length > 0 && (
            <section key={s.label} className={`today-section tone-${s.tone}`}>
              <h3>
                {s.label}
                <span className="group-count">{s.tasks.length}</span>
              </h3>
              <div className="today-list">
                {s.tasks.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    project={projects.find((p) => p.id === t.projectId)}
                    showProject
                    onEdit={onEdit}
                    onUpdate={onUpdate}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            </section>
          ),
      )}

      <div className="momentum">
        <span>
          <strong>{doneToday}</strong> done today
        </span>
        <span className="dot">·</span>
        <span>
          <strong>{doneThisWeek}</strong> this week
        </span>
        {doneToday >= 3 && <span className="momentum-streak">🔥 on a roll</span>}
      </div>
    </div>
  );
}
