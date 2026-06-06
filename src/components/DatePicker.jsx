import { useState, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function parseValue(value) {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmt(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function prettyLabel(date) {
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, tomorrow)) return 'Tomorrow';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

export default function DatePicker({ value, onChange, placeholder = 'Pick a date' }) {
  const selected = parseValue(value);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => selected || new Date());
  const [pos, setPos] = useState({ top: 0, left: 0, openUp: false });
  const triggerRef = useRef(null);
  const popRef = useRef(null);

  useEffect(() => {
    if (open && selected) setView(new Date(selected.getFullYear(), selected.getMonth(), 1));
  }, [open]); // eslint-disable-line

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const computePos = () => {
      const r = triggerRef.current.getBoundingClientRect();
      const popHeight = 360;
      const spaceBelow = window.innerHeight - r.bottom;
      const openUp = spaceBelow < popHeight + 16 && r.top > popHeight + 16;
      setPos({
        top: openUp ? r.top - 6 : r.bottom + 6,
        left: Math.max(8, Math.min(r.left, window.innerWidth - 300)),
        openUp,
      });
    };
    computePos();
    window.addEventListener('resize', computePos);
    window.addEventListener('scroll', computePos, true);
    return () => {
      window.removeEventListener('resize', computePos);
      window.removeEventListener('scroll', computePos, true);
    };
  }, [open]);

  useEffect(() => {
    const onClick = (e) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        popRef.current && !popRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const grid = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const startCol = first.getDay(); // 0..6 Sun..Sat
    const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startCol; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(new Date(view.getFullYear(), view.getMonth(), d));
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [view]);

  const today = new Date();

  const pick = (date) => {
    onChange(fmt(date));
    setOpen(false);
  };

  const shift = (months) => {
    setView(new Date(view.getFullYear(), view.getMonth() + months, 1));
  };

  return (
    <div className="datepicker">
      <button
        ref={triggerRef}
        type="button"
        className={`dp-trigger ${selected ? 'has-value' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="dp-icon">📅</span>
        <span className="dp-label">
          {selected ? prettyLabel(selected) : placeholder}
        </span>
        {selected && (
          <span
            className="dp-clear"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
          >
            ×
          </span>
        )}
      </button>

      {open && createPortal(
        <div
          ref={popRef}
          className="dp-pop"
          style={{
            top: pos.top,
            left: pos.left,
            transform: pos.openUp ? 'translateY(-100%)' : 'none',
          }}
        >
          <div className="dp-quick">
            <button type="button" onClick={() => pick(new Date())}>Today</button>
            <button
              type="button"
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() + 1);
                pick(d);
              }}
            >
              Tomorrow
            </button>
            <button
              type="button"
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() + 7);
                pick(d);
              }}
            >
              +1 week
            </button>
          </div>

          <div className="dp-head">
            <button type="button" className="dp-nav" onClick={() => shift(-1)}>‹</button>
            <div className="dp-title">
              {MONTHS[view.getMonth()]} {view.getFullYear()}
            </div>
            <button type="button" className="dp-nav" onClick={() => shift(1)}>›</button>
          </div>

          <div className="dp-grid">
            {DAYS.map((d, i) => (
              <div key={i} className="dp-dow">{d}</div>
            ))}
            {grid.map((date, i) =>
              date ? (
                <button
                  type="button"
                  key={i}
                  className={`dp-cell ${
                    selected && sameDay(date, selected) ? 'selected' : ''
                  } ${sameDay(date, today) ? 'today' : ''}`}
                  onClick={() => pick(date)}
                >
                  {date.getDate()}
                </button>
              ) : (
                <div key={i} className="dp-cell empty" />
              ),
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
