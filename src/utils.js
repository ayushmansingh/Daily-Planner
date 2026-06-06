export function startOfToday() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

export function endOfToday() {
  const e = startOfToday();
  e.setDate(e.getDate() + 1);
  return e;
}

export function daysAgo(iso) {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function isStale(task) {
  if (task.state === 'done') return false;
  const ref = task.updatedAt || task.createdAt;
  return daysAgo(ref) >= 7;
}

export function isFollowUpDue(task) {
  if (task.state === 'done') return false;
  if (!task.followUpDate) return false;
  return new Date(task.followUpDate) < endOfToday();
}

export function isDueToday(task) {
  if (!task.deadline) return false;
  const d = new Date(task.deadline);
  return d >= startOfToday() && d < endOfToday();
}

export function isOverdue(task) {
  if (!task.deadline) return false;
  return new Date(task.deadline) < startOfToday();
}

export function formatDeadline(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const today = startOfToday();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const overdue = d < new Date();
  let label;
  if (dDay.getTime() === today.getTime()) label = 'Today';
  else if (dDay.getTime() === tomorrow.getTime()) label = 'Tomorrow';
  else
    label = d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
    });
  return { label, overdue: overdue && dDay < today };
}

export function sortTasks(list) {
  return [...list].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority ? -1 : 1;
    const da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
    const db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
    if (da !== db) return da - db;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}
