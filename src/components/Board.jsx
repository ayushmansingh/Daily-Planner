import { useState } from 'react';
import TaskCard from './TaskCard.jsx';
import { sortTasks, startOfToday } from '../utils.js';

const COLUMNS = [
  { id: 'active', label: 'Active' },
  { id: 'pending', label: 'Pending' },
  { id: 'done', label: 'Done' },
];

export default function Board({ projectId, tasks, projects, onEdit, onUpdate, onDelete }) {
  const [dragging, setDragging] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const [showAllDone, setShowAllDone] = useState(false);

  const today = startOfToday();

  const byColumn = (state) => {
    let list = tasks.filter((t) => t.state === state);
    if (state === 'done' && !showAllDone) {
      list = list.filter((t) => t.completedAt && new Date(t.completedAt) >= today);
    }
    return sortTasks(list);
  };

  const onDrop = (state) => {
    if (dragging && dragging.state !== state) {
      onUpdate(dragging.id, { state });
    }
    setDragging(null);
    setOverCol(null);
  };

  if (!projectId) return null;

  const totalDone = tasks.filter((t) => t.state === 'done').length;
  const doneToday = tasks.filter(
    (t) => t.state === 'done' && t.completedAt && new Date(t.completedAt) >= today,
  ).length;
  const hiddenDone = totalDone - doneToday;

  return (
    <div className="board">
      {COLUMNS.map((col) => {
        const items = byColumn(col.id);
        return (
          <div
            key={col.id}
            className={`column ${overCol === col.id ? 'over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOverCol(col.id);
            }}
            onDragLeave={() => setOverCol((c) => (c === col.id ? null : c))}
            onDrop={() => onDrop(col.id)}
          >
            <div className="column-header">
              <span>{col.label}</span>
              <span className="column-count">{items.length}</span>
            </div>
            <div className="column-body">
              {items.length === 0 && col.id !== 'done' && (
                <div className="empty">Drop tasks here</div>
              )}
              {col.id === 'done' && items.length === 0 && totalDone === 0 && (
                <div className="empty">Nothing shipped yet</div>
              )}
              {items.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  project={projects.find((p) => p.id === t.projectId)}
                  draggable
                  onDragStart={() => setDragging(t)}
                  onEdit={onEdit}
                  onUpdate={onUpdate}
                  onDelete={onDelete}
                  compact={col.id === 'done'}
                />
              ))}
              {col.id === 'done' && hiddenDone > 0 && (
                <button
                  className="show-more"
                  onClick={() => setShowAllDone((v) => !v)}
                >
                  {showAllDone
                    ? 'Show today only'
                    : `↓ Show ${hiddenDone} older`}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
