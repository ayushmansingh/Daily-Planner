import { useState } from 'react';
import TaskCard from './TaskCard.jsx';
import { sortTasks, startOfToday } from '../utils.js';
import { BOARD_COLUMNS, STATE_LABELS, STATE_ICONS } from '../states.js';

export default function Board({ projectId, tasks, projects, onEdit, onUpdate, onDelete }) {
  const [dragging, setDragging] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const [showAllDone, setShowAllDone] = useState(false);
  const [parkedOpen, setParkedOpen] = useState(false);

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

  const parked = sortTasks(tasks.filter((t) => t.state === 'parked'));

  return (
    <div className="board-wrap">
      <div className="board">
        {BOARD_COLUMNS.map((colId) => {
          const items = byColumn(colId);
          return (
            <div
              key={colId}
              className={`column column-${colId} ${overCol === colId ? 'over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOverCol(colId);
              }}
              onDragLeave={() => setOverCol((c) => (c === colId ? null : c))}
              onDrop={() => onDrop(colId)}
            >
              <div className="column-header">
                <span>{STATE_LABELS[colId]}</span>
                <span className="column-count">{items.length}</span>
              </div>
              <div className="column-body">
                {items.length === 0 && colId !== 'done' && (
                  <div className="empty">Drop tasks here</div>
                )}
                {colId === 'done' && items.length === 0 && totalDone === 0 && (
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
                    compact={colId === 'done'}
                  />
                ))}
                {colId === 'done' && hiddenDone > 0 && (
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

      <div
        className={`parked-drawer ${parkedOpen ? 'open' : ''} ${overCol === 'parked' ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOverCol('parked');
        }}
        onDragLeave={() => setOverCol((c) => (c === 'parked' ? null : c))}
        onDrop={() => onDrop('parked')}
      >
        <button
          className="parked-header"
          onClick={() => setParkedOpen((v) => !v)}
          aria-expanded={parkedOpen}
        >
          <span className="parked-icon">{STATE_ICONS.parked}</span>
          <span className="parked-label">
            {parked.length} {STATE_LABELS.parked}
          </span>
          <span className="parked-hint">
            {parked.length === 0
              ? 'Drag tasks here to defer'
              : parkedOpen
                ? 'Click to collapse'
                : 'Click to expand'}
          </span>
          <span className="parked-caret">{parkedOpen ? '▾' : '▸'}</span>
        </button>
        {parkedOpen && (
          <div className="parked-body">
            {parked.length === 0 ? (
              <div className="empty">Nothing parked. Drag tasks here to defer them.</div>
            ) : (
              parked.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  project={projects.find((p) => p.id === t.projectId)}
                  draggable
                  onDragStart={() => setDragging(t)}
                  onEdit={onEdit}
                  onUpdate={onUpdate}
                  onDelete={onDelete}
                  compact
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
