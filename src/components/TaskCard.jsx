import { formatDeadline } from '../utils.js';

function formatFollowUp(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  let label;
  if (dDay.getTime() === today.getTime()) label = 'Today';
  else if (dDay.getTime() === tomorrow.getTime()) label = 'Tomorrow';
  else label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const due = dDay <= today;
  return { label, due };
}

export default function TaskCard({
  task,
  project,
  draggable = false,
  onDragStart,
  onEdit,
  onUpdate,
  onDelete,
  showProject = false,
  staleBadge = null,
  compact = false,
}) {
  const deadline = formatDeadline(task.deadline);
  const followUp = formatFollowUp(task.followUpDate);
  const isStale = staleBadge !== null && staleBadge >= 7;
  const isHeavy = task.priority && deadline?.overdue;

  return (
    <div
      className={`task-card ${task.priority ? 'priority' : ''} ${task.state === 'done' ? 'done' : ''} ${isHeavy ? 'heavy' : ''} ${isStale ? 'stale' : ''} ${compact ? 'compact' : ''}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={() => onEdit(task)}
    >
      <div className="task-top">
        <button
          className={`checkbox ${task.state === 'done' ? 'checked' : ''}`}
          title="Toggle done"
          onClick={(e) => {
            e.stopPropagation();
            onUpdate(task.id, { state: task.state === 'done' ? 'active' : 'done' });
          }}
        >
          {task.state === 'done' ? '✓' : ''}
        </button>
        <div className="task-title">{task.title}</div>
        <button
          className={`star ${task.priority ? 'on' : ''}`}
          title="Toggle priority"
          onClick={(e) => {
            e.stopPropagation();
            onUpdate(task.id, { priority: !task.priority });
          }}
        >
          ★
        </button>
      </div>

      {task.description && !compact && <div className="task-desc">{task.description}</div>}

      <div className="task-meta">
        {showProject && project && (
          <span className="meta-chip project-chip">
            <span className="project-dot" style={{ background: project.color }} />
            {project.name}
          </span>
        )}
        {deadline && (
          <span className={`meta-chip deadline ${deadline.overdue ? 'overdue' : ''}`}>
            🗓 {deadline.label}
          </span>
        )}
        {task.waitingOn && (
          <span className="meta-chip waiting">
            ⏳ @{task.waitingOn}
          </span>
        )}
        {followUp && (
          <span className={`meta-chip followup ${followUp.due ? 'due' : ''}`}>
            🔔 {followUp.label}
          </span>
        )}
        {(task.tags || []).map((t) => (
          <span key={t} className="meta-chip tag">#{t}</span>
        ))}
        {isStale && (
          <span className="meta-chip stale-chip">
            🪦 {staleBadge}d stale
          </span>
        )}
        <button
          className="del-task"
          title="Delete"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm('Delete this task?')) onDelete(task.id);
          }}
        >
          🗑
        </button>
      </div>
    </div>
  );
}
