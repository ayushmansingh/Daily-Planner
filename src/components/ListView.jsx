import TaskCard from './TaskCard.jsx';
import { sortTasks, daysAgo } from '../utils.js';

export default function ListView({
  tasks,
  projects,
  groupByProject = true,
  emptyTitle = 'Nothing here',
  emptyHint = 'Press N to add a task.',
  onEdit,
  onUpdate,
  onDelete,
  showStaleBadge = false,
}) {
  if (tasks.length === 0) {
    return (
      <div className="empty-state">
        <h2>{emptyTitle}</h2>
        <p>{emptyHint}</p>
      </div>
    );
  }

  if (!groupByProject) {
    return (
      <div className="today">
        <div className="today-list">
          {sortTasks(tasks).map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              project={projects.find((p) => p.id === t.projectId)}
              showProject
              staleBadge={showStaleBadge ? daysAgo(t.updatedAt || t.createdAt) : null}
              onEdit={onEdit}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
        </div>
      </div>
    );
  }

  const byProject = new Map();
  sortTasks(tasks).forEach((t) => {
    if (!byProject.has(t.projectId)) byProject.set(t.projectId, []);
    byProject.get(t.projectId).push(t);
  });

  return (
    <div className="today">
      {[...byProject.entries()].map(([pid, list]) => {
        const project = projects.find((p) => p.id === pid);
        return (
          <section key={pid} className="today-section">
            <h3 className="group-head">
              {project && (
                <span className="project-dot" style={{ background: project.color }} />
              )}
              {project?.name || 'Unknown'}
              <span className="group-count">{list.length}</span>
            </h3>
            <div className="today-list">
              {list.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  project={project}
                  staleBadge={showStaleBadge ? daysAgo(t.updatedAt || t.createdAt) : null}
                  onEdit={onEdit}
                  onUpdate={onUpdate}
                  onDelete={onDelete}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
