import { useState } from 'react';

export default function QuickAdd({ projects, defaultProjectId, onSave, onClose }) {
  const [text, setText] = useState('');
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [priority, setPriority] = useState(false);

  const submit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;

    // parse inline: !! = priority, #tag, "due tomorrow", "due 2026-06-10"
    let title = text.trim();
    let isPriority = priority;
    const tags = [];
    let deadline = null;

    if (/(^|\s)!!(\s|$)/.test(title)) {
      isPriority = true;
      title = title.replace(/(^|\s)!!(\s|$)/g, ' ').trim();
    }

    title = title.replace(/#([\w-]+)/g, (_, t) => {
      tags.push(t);
      return '';
    });

    const todayMatch = /\bdue today\b/i.test(title);
    const tomorrowMatch = /\bdue tomorrow\b/i.test(title);
    const dateMatch = title.match(/\bdue (\d{4}-\d{2}-\d{2})\b/i);
    if (todayMatch) {
      const d = new Date();
      d.setHours(17, 0, 0, 0);
      deadline = d.toISOString();
      title = title.replace(/\bdue today\b/i, '');
    } else if (tomorrowMatch) {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(17, 0, 0, 0);
      deadline = d.toISOString();
      title = title.replace(/\bdue tomorrow\b/i, '');
    } else if (dateMatch) {
      const d = new Date(dateMatch[1]);
      d.setHours(17, 0, 0, 0);
      deadline = d.toISOString();
      title = title.replace(dateMatch[0], '');
    }

    title = title.replace(/\s+/g, ' ').trim();
    if (!title) return;

    onSave({
      title,
      description: '',
      deadline,
      state: 'active',
      priority: isPriority,
      projectId,
      tags,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="quick-add" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={submit}>
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='Try: "Draft PRD for billing !! #design due tomorrow"'
          />
          <div className="quick-row">
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <label className="checkbox-row inline">
              <input
                type="checkbox"
                checked={priority}
                onChange={(e) => setPriority(e.target.checked)}
              />
              ⭐ Priority
            </label>
            <div className="spacer" />
            <button type="button" className="btn-ghost" onClick={onClose}>
              Esc
            </button>
            <button type="submit" className="btn-primary">
              Add (⏎)
            </button>
          </div>
          <div className="quick-hints">
            <code>!!</code> priority · <code>#tag</code> tag · <code>due today/tomorrow/YYYY-MM-DD</code>
          </div>
        </form>
      </div>
    </div>
  );
}
