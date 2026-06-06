import { useEffect, useMemo, useRef, useState } from 'react';
import { STATE_LABELS } from '../states.js';

// Phase 1 scorer: substring match on title/description, weighted.
// Higher score = better match. Returns 0 for no match.
function scoreMatch(task, query) {
  if (!query) return 0;
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const title = (task.title || '').toLowerCase();
  const desc = (task.description || '').toLowerCase();
  const titleIdx = title.indexOf(q);
  const descIdx = desc.indexOf(q);
  if (titleIdx >= 0) return 1000 - Math.min(titleIdx, 100); // earlier hits rank higher
  if (descIdx >= 0) return 500 - Math.min(descIdx, 100);
  return 0;
}

export default function CommandPalette({ tasks, projects, onOpenTask, onClose }) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Autofocus the input the moment we mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    return tasks
      .map((t) => ({ task: t, score: scoreMatch(t, query) }))
      .filter((m) => m.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.task.priority !== b.task.priority) return a.task.priority ? -1 : 1;
        return new Date(b.task.createdAt) - new Date(a.task.createdAt);
      })
      .slice(0, 50)
      .map((m) => m.task);
  }, [tasks, query]);

  // Reset selection whenever the result set changes shape
  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  // Keep the selected row visible when arrowing past the viewport edge
  useEffect(() => {
    const el = listRef.current?.querySelector('.palette-row.selected');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx, results.length]);

  const handleKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const task = results[selectedIdx];
      if (task) onOpenTask(task);
    }
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search tasks"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKey}
      >
        <div className="palette-input-wrap">
          <span className="palette-icon">🔍</span>
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks…"
            spellCheck="false"
            autoComplete="off"
          />
          <span className="palette-count">
            {query.trim() ? `${results.length} ${results.length === 1 ? 'match' : 'matches'}` : ''}
          </span>
        </div>

        <div className="palette-results" ref={listRef}>
          {!query.trim() && (
            <div className="palette-empty">
              Type to search across all tasks. Matches title and description.
            </div>
          )}
          {query.trim() && results.length === 0 && (
            <div className="palette-empty">
              No tasks match <strong>"{query}"</strong>.
            </div>
          )}
          {results.map((t, i) => {
            const project = projects.find((p) => p.id === t.projectId);
            const selected = i === selectedIdx;
            return (
              <div
                key={t.id}
                className={`palette-row state-${t.state} ${selected ? 'selected' : ''}`}
                onMouseEnter={() => setSelectedIdx(i)}
                onClick={() => onOpenTask(t)}
              >
                <div className="palette-row-main">
                  <div className="palette-row-title">
                    {t.priority && <span className="palette-star">★</span>}
                    {t.title}
                  </div>
                  <div className="palette-row-meta">
                    {project && (
                      <span className="palette-project">
                        <span className="palette-dot" style={{ background: project.color }} />
                        {project.name}
                      </span>
                    )}
                    {t.waitingOn && <span className="palette-waiting">@{t.waitingOn}</span>}
                    {t.description && (
                      <span className="palette-desc">
                        {t.description.length > 80
                          ? t.description.slice(0, 80) + '…'
                          : t.description}
                      </span>
                    )}
                  </div>
                </div>
                <span className={`palette-state pill-${t.state}`}>
                  {STATE_LABELS[t.state] || t.state}
                </span>
              </div>
            );
          })}
        </div>

        <div className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>⏎</kbd> open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
