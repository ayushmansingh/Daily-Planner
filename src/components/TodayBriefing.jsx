import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';

// A small signature so the briefing only re-fetches when something
// the server actually cares about has changed. Matches the fields
// buildDigest() reads on the server.
function taskSignature(tasks) {
  return JSON.stringify(
    tasks.map((t) => [
      t.id,
      t.state,
      t.priority ? 1 : 0,
      t.deadline || '',
      t.followUpDate || '',
      t.waitingOn || '',
      t.completedAt || '',
      t.updatedAt || t.createdAt || '',
    ]),
  );
}

function sourceLabel(src) {
  if (src === 'haiku') return 'AI';
  if (src === 'cached') return 'AI';
  if (src === 'fallback') return 'auto';
  return src || '';
}

function calendarChipLabel(cal) {
  if (!cal) return null;
  if (cal.freshness === 'fresh') return '📅 live';
  if (cal.freshness === 'stale') return '📅 stale';
  if (cal.freshness === 'expired') return '📅 offline';
  return null;
}

export default function TodayBriefing({ tasks }) {
  const [data, setData] = useState(null); // { text, source, cached, generatedAt }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const sig = useMemo(() => taskSignature(tasks), [tasks]);

  // Dedup guard: avoid duplicate fetches from React StrictMode's double-mount
  // and from navigating back into Today when nothing has actually changed.
  // Manual refresh (the ↻ button) bypasses this by calling fetchBriefing(true).
  const lastFetchedSig = useRef(null);

  const fetchBriefing = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.briefing({ refresh });
      setData(result);
    } catch (err) {
      setError(err?.message || 'Could not load briefing');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (lastFetchedSig.current === sig) return;
    lastFetchedSig.current = sig;
    fetchBriefing();
  }, [sig, fetchBriefing]);

  if (!data && loading) {
    return (
      <div className="briefing briefing-loading" aria-busy="true">
        <div className="briefing-head">
          <div className="briefing-icon">☀️</div>
          <div className="briefing-label">Drawing up your morning…</div>
        </div>
        <div className="briefing-body">
          <div className="briefing-bullet briefing-skeleton" />
          <div className="briefing-bullet briefing-skeleton" />
          <div className="briefing-bullet briefing-skeleton" />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="briefing briefing-error">
        <div className="briefing-head">
          <div className="briefing-icon">⚠️</div>
          <div className="briefing-label">Briefing unavailable</div>
          <button className="briefing-refresh" onClick={() => fetchBriefing(true)} title="Retry">
            ↻
          </button>
        </div>
        <div className="briefing-body">
          <div className="briefing-bullet">{error}</div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const bullets = data.text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[•\-*]\s*/, ''));

  const cal = data.digest?.calendar;
  const calChip = calendarChipLabel(cal);
  const calTitle = cal
    ? `Calendar feed: ${cal.freshness} (age ${cal.ageBucket})` +
      (cal.remainingTodayCount != null ? ` · ${cal.remainingTodayCount} left today` : '')
    : null;

  return (
    <div className={`briefing briefing-${data.source}`}>
      <div className="briefing-head">
        <div className="briefing-icon">☀️</div>
        <div className="briefing-label">Morning briefing</div>
        <span
          className="briefing-source"
          title={`Source: ${data.source}${data.cached ? ' (cached)' : ''}`}
        >
          {sourceLabel(data.source)}
        </span>
        {calChip && (
          <span className="briefing-source" title={calTitle}>
            {calChip}
          </span>
        )}
        <button
          className="briefing-refresh"
          title="Re-generate"
          onClick={() => fetchBriefing(true)}
          disabled={loading}
        >
          {loading ? '…' : '↻'}
        </button>
      </div>
      <div className="briefing-body">
        {bullets.map((b, i) => (
          <div key={i} className="briefing-bullet">
            <span className="briefing-dot">•</span>
            <span>{b}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
