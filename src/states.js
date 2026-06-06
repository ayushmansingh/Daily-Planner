// Task state model. Keep in sync with the STATES list in server/index.js.

export const DEFAULT_STATE = 'new';

export const STATES = ['new', 'doing', 'waiting', 'done', 'parked'];

// What appears in the active backlog (counts, today view, etc).
// 'done' and 'parked' are intentionally out of pressure circulation.
export const OPEN_STATES = ['new', 'doing', 'waiting'];

// Display order for the project board columns. Parked lives in its own drawer.
export const BOARD_COLUMNS = ['new', 'doing', 'waiting', 'done'];

export const STATE_LABELS = {
  new: 'New',
  doing: 'Doing',
  waiting: 'Waiting',
  done: 'Done',
  parked: 'Parked',
};

export const STATE_ICONS = {
  new: '🆕',
  doing: '🚀',
  waiting: '⏳',
  done: '✅',
  parked: '🅿️',
};

export const STATE_HINTS = {
  new: 'Just captured — needs triage',
  doing: 'Actively pushing this',
  waiting: 'Blocked on someone else',
  done: 'Shipped',
  parked: 'Deprioritized for now — might revisit',
};

export function isOpenState(state) {
  return OPEN_STATES.includes(state);
}
