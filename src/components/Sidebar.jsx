import { useState } from 'react';
import { isStale, isFollowUpDue, isOpen, daysAgo } from '../utils.js';
import { STATES, STATE_LABELS, STATE_ICONS } from '../states.js';

export default function Sidebar({
  projects,
  activeView,
  onSelect,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  tasks,
  allTags,
}) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');

  const open = tasks.filter(isOpen);

  const stateCounts = Object.fromEntries(
    STATES.map((s) => [s, tasks.filter((t) => t.state === s).length]),
  );

  const counts = {
    today: open.filter((t) => {
      if (!t.deadline) return false;
      const d = new Date(t.deadline);
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return d < end;
    }).length,
    followups: open.filter(isFollowUpDue).length,
    stale: open.filter(isStale).length,
    ...stateCounts,
  };

  const submit = (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    onCreateProject(newName.trim());
    setNewName('');
  };

  const startRename = (p) => {
    setEditingId(p.id);
    setEditingName(p.name);
  };

  const commitRename = () => {
    if (editingName.trim() && editingId) {
      onRenameProject(editingId, editingName.trim());
    }
    setEditingId(null);
  };

  const NavItem = ({ id, icon, label, count, accent }) => (
    <div
      className={`nav-item ${activeView === id ? 'active' : ''}`}
      onClick={() => onSelect(id)}
      style={accent ? { '--accent-pill': accent } : undefined}
    >
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
      {count > 0 && <span className="badge">{count}</span>}
    </div>
  );

  return (
    <aside className="sidebar">
      <div className="brand">✦ Planner</div>

      <div className="section-label">Focus</div>
      <NavItem id="today" icon="☀️" label="Today" count={counts.today} />
      <NavItem id="follow-ups" icon="🔔" label="Follow-ups" count={counts.followups} />
      <NavItem id="stale" icon="🪦" label="Stale" count={counts.stale} />

      <div className="section-label">Across projects</div>
      {STATES.map((s) => (
        <NavItem
          key={s}
          id={`state:${s}`}
          icon={STATE_ICONS[s]}
          label={`All ${STATE_LABELS[s]}`}
          count={counts[s]}
        />
      ))}

      <div className="section-label">Projects</div>
      {projects.map((p) => {
        const count = tasks.filter((t) => t.projectId === p.id && t.state !== 'done').length;
        const viewKey = `project:${p.id}`;
        return (
          <div
            key={p.id}
            className={`nav-item ${activeView === viewKey ? 'active' : ''}`}
            onClick={() => onSelect(viewKey)}
            onDoubleClick={() => startRename(p)}
          >
            <span className="project-dot" style={{ background: p.color }} />
            {editingId === p.id ? (
              <input
                autoFocus
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="inline-input"
              />
            ) : (
              <span className="nav-label">{p.name}</span>
            )}
            {count > 0 && editingId !== p.id && <span className="badge">{count}</span>}
            {p.id !== 'inbox' && editingId !== p.id && (
              <button
                className="del-btn"
                title="Delete project"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete project "${p.name}"? Its tasks move to Inbox.`)) {
                    onDeleteProject(p.id);
                  }
                }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}

      <form onSubmit={submit} className="new-project">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="+ New project"
        />
      </form>

      {allTags.length > 0 && (
        <>
          <div className="section-label">Tags</div>
          <div className="tag-list">
            {allTags.map((t) => {
              const viewKey = `tag:${t}`;
              return (
                <span
                  key={t}
                  className={`tag-chip ${activeView === viewKey ? 'active' : ''}`}
                  onClick={() => onSelect(viewKey)}
                >
                  #{t}
                </span>
              );
            })}
          </div>
        </>
      )}
    </aside>
  );
}
