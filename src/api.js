const j = (r) => r.json();

export const api = {
  state: () => fetch('/api/state').then(j),

  createProject: (body) =>
    fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(j),
  updateProject: (id, body) =>
    fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(j),
  deleteProject: (id) =>
    fetch(`/api/projects/${id}`, { method: 'DELETE' }).then(j),

  createTask: (body) =>
    fetch('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(j),
  updateTask: (id, body) =>
    fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(j),
  deleteTask: (id) =>
    fetch(`/api/tasks/${id}`, { method: 'DELETE' }).then(j),

  briefing: ({ refresh = false } = {}) =>
    fetch(`/api/briefing${refresh ? '?refresh=1' : ''}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).then(j),

  calendar: {
    status: () => fetch('/api/calendar/status').then(j),
    // Full-page navigation — the OAuth flow needs the browser to follow
    // 302s through Microsoft and back to /callback. fetch() doesn't navigate.
    connect: () => {
      window.location.href = '/api/calendar/connect';
    },
    disconnect: () => fetch('/api/calendar/disconnect', { method: 'POST' }).then(j),
  },
};
