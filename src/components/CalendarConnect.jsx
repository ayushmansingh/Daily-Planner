import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

export default function CalendarConnect() {
  const [status, setStatus] = useState(null); // null = loading
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await api.calendar.status();
      setStatus(s);
    } catch (err) {
      setStatus({ connected: false, configured: false, error: err?.message });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!status) return null;

  // Calendar env not set — show nothing rather than a broken button
  if (!status.configured) return null;

  if (!status.connected) {
    return (
      <button
        className="cal-connect cal-connect-off"
        onClick={() => {
          setBusy(true);
          api.calendar.connect();
        }}
        disabled={busy}
        title="Sign in to Outlook with read-only calendar access"
      >
        <span className="cal-icon">📅</span>
        <span>{busy ? 'Redirecting…' : 'Connect Outlook'}</span>
      </button>
    );
  }

  const email = status.user?.email || 'connected';
  return (
    <div className="cal-connect cal-connect-on" title={`Read-only access, ${status.scope || ''}`}>
      <span className="cal-icon">📅</span>
      <span className="cal-email">{email}</span>
      <button
        className="cal-disconnect"
        title="Disconnect (revokes the stored refresh token)"
        onClick={async () => {
          if (!confirm(`Disconnect ${email}? You'll need to re-authorize to reconnect.`)) return;
          setBusy(true);
          await api.calendar.disconnect();
          await refresh();
          setBusy(false);
        }}
        disabled={busy}
      >
        ✕
      </button>
    </div>
  );
}
