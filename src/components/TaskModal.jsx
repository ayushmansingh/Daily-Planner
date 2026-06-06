import { useState } from 'react';
import DatePicker from './DatePicker.jsx';

function toDateInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromDateInput(str, hour = 17) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d, hour, 0, 0).toISOString();
}

export default function TaskModal({ task, projects, defaultProjectId, onSave, onClose }) {
  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [deadline, setDeadline] = useState(toDateInput(task?.deadline));
  const [followUpDate, setFollowUpDate] = useState(toDateInput(task?.followUpDate));
  const [state, setState] = useState(task?.state || 'active');
  const [priority, setPriority] = useState(!!task?.priority);
  const [projectId, setProjectId] = useState(task?.projectId || defaultProjectId);
  const [waitingOn, setWaitingOn] = useState(task?.waitingOn || '');
  const [tagsRaw, setTagsRaw] = useState((task?.tags || []).join(', '));

  const submit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      description: description.trim(),
      deadline: fromDateInput(deadline, 17),
      followUpDate: fromDateInput(followUpDate, 9),
      state,
      priority,
      projectId,
      waitingOn: waitingOn.trim(),
      tags: tagsRaw
        .split(',')
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean),
    });
  };

  const pendingHint = state === 'pending' && !waitingOn;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={submit}>
          <h2>{task ? 'Edit task' : 'New task'}</h2>

          <label>Title</label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
            required
          />

          <label>Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Details, context, links…"
            rows={3}
          />

          <div className="row">
            <div className="col">
              <label>Project</label>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col">
              <label>State</label>
              <select value={state} onChange={(e) => setState(e.target.value)}>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="done">Done</option>
              </select>
            </div>
          </div>

          <div className="row">
            <div className="col">
              <label>Deadline</label>
              <DatePicker value={deadline} onChange={setDeadline} placeholder="Set a deadline" />
            </div>
            <div className="col">
              <label>Tags (comma separated)</label>
              <input
                value={tagsRaw}
                onChange={(e) => setTagsRaw(e.target.value)}
                placeholder="design, blocker"
              />
            </div>
          </div>

          <div className="row">
            <div className="col">
              <label>Waiting on {pendingHint && <span className="hint-inline">(recommended for pending)</span>}</label>
              <input
                value={waitingOn}
                onChange={(e) => setWaitingOn(e.target.value)}
                placeholder="ravi, legal, customer…"
              />
            </div>
            <div className="col">
              <label>Follow-up on</label>
              <DatePicker
                value={followUpDate}
                onChange={setFollowUpDate}
                placeholder="Ping me on…"
              />
            </div>
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={priority}
              onChange={(e) => setPriority(e.target.checked)}
            />
            <span>⭐ Priority — overrides everything else</span>
          </label>

          <div className="actions">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              {task ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
