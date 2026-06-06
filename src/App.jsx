import { useEffect, useMemo, useState, useCallback } from 'react';
import { api } from './api.js';
import Sidebar from './components/Sidebar.jsx';
import Board from './components/Board.jsx';
import TodayView from './components/TodayView.jsx';
import ListView from './components/ListView.jsx';
import TaskModal from './components/TaskModal.jsx';
import QuickAdd from './components/QuickAdd.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import CalendarConnect from './components/CalendarConnect.jsx';
import { isStale, isFollowUpDue } from './utils.js';

function parseView(view) {
  if (view === 'today') return { kind: 'today' };
  if (view === 'follow-ups') return { kind: 'follow-ups' };
  if (view === 'stale') return { kind: 'stale' };
  if (view.startsWith('state:')) return { kind: 'state', state: view.slice(6) };
  if (view.startsWith('tag:')) return { kind: 'tag', tag: view.slice(4) };
  if (view.startsWith('project:')) return { kind: 'project', projectId: view.slice(8) };
  return { kind: 'today' };
}

export default function App() {
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [activeView, setActiveView] = useState('today');
  const [editingTask, setEditingTask] = useState(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const data = await api.state();
    setProjects(data.projects);
    setTasks(data.tasks);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onKey = (e) => {
      // ⌘K / Ctrl+K — works even when typing (toggles the palette)
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      const tag = e.target.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;
      if (typing) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setQuickAddOpen(true);
      } else if (e.key === 't' || e.key === 'T') {
        setActiveView('today');
      } else if (e.key === 'Escape') {
        setQuickAddOpen(false);
        setEditingTask(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const allTags = useMemo(() => {
    const s = new Set();
    tasks.forEach((t) => (t.tags || []).forEach((tg) => s.add(tg)));
    return [...s].sort();
  }, [tasks]);

  const view = parseView(activeView);

  const defaultProjectId = view.kind === 'project' ? view.projectId : 'inbox';

  const handleSaveTask = async (payload) => {
    if (editingTask && !editingTask.__new) {
      await api.updateTask(editingTask.id, payload);
    } else {
      await api.createTask({ ...payload, projectId: payload.projectId || defaultProjectId });
    }
    setEditingTask(null);
    refresh();
  };

  const handleQuickAdd = async (payload) => {
    await api.createTask({ ...payload, projectId: payload.projectId || defaultProjectId });
    setQuickAddOpen(false);
    refresh();
  };

  const updateTask = async (id, patch) => {
    await api.updateTask(id, patch);
    refresh();
  };

  const deleteTask = async (id) => {
    await api.deleteTask(id);
    refresh();
  };

  const createProject = async (name) => {
    const colors = ['#7c3aed', '#ec4899', '#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#06b6d4'];
    const color = colors[projects.length % colors.length];
    const p = await api.createProject({ name, color });
    setActiveView(`project:${p.id}`);
    refresh();
  };

  const renameProject = async (id, name) => {
    await api.updateProject(id, { name });
    refresh();
  };

  const deleteProject = async (id) => {
    await api.deleteProject(id);
    if (activeView === `project:${id}`) setActiveView('today');
    refresh();
  };

  if (!loaded) return <div className="loading">Loading…</div>;

  const headerInfo = (() => {
    switch (view.kind) {
      case 'today':
        return { title: 'Today', sub: 'What deserves your attention' };
      case 'follow-ups':
        return { title: 'Follow-ups', sub: 'Things to ping today or earlier' };
      case 'stale':
        return { title: 'Stale', sub: 'Untouched for a week — decide or kill' };
      case 'state':
        return {
          title: `All ${view.state.charAt(0).toUpperCase() + view.state.slice(1)}`,
          sub: 'Across every project',
        };
      case 'tag':
        return { title: `#${view.tag}`, sub: 'Tag filter across projects' };
      case 'project': {
        const p = projects.find((x) => x.id === view.projectId);
        return { title: p?.name || 'Project', sub: 'Drag cards between columns' };
      }
      default:
        return { title: 'Today', sub: '' };
    }
  })();

  const renderBody = () => {
    switch (view.kind) {
      case 'today':
        return (
          <TodayView
            tasks={tasks}
            projects={projects}
            onEdit={setEditingTask}
            onUpdate={updateTask}
            onDelete={deleteTask}
          />
        );
      case 'follow-ups': {
        const list = tasks.filter(isFollowUpDue);
        return (
          <ListView
            tasks={list}
            projects={projects}
            groupByProject
            emptyTitle="No follow-ups due 🎈"
            emptyHint="Add a follow-up date on any pending task — it'll surface here."
            onEdit={setEditingTask}
            onUpdate={updateTask}
            onDelete={deleteTask}
          />
        );
      }
      case 'stale': {
        const list = tasks.filter(isStale);
        return (
          <ListView
            tasks={list}
            projects={projects}
            groupByProject
            showStaleBadge
            emptyTitle="Nothing's rotting 🌱"
            emptyHint="Tasks untouched for 7+ days show up here."
            onEdit={setEditingTask}
            onUpdate={updateTask}
            onDelete={deleteTask}
          />
        );
      }
      case 'state': {
        const list = tasks.filter((t) => t.state === view.state);
        return (
          <ListView
            tasks={list}
            projects={projects}
            groupByProject
            emptyTitle={`No ${view.state} tasks`}
            emptyHint="Hit N to capture one."
            onEdit={setEditingTask}
            onUpdate={updateTask}
            onDelete={deleteTask}
          />
        );
      }
      case 'tag': {
        const list = tasks.filter((t) => (t.tags || []).includes(view.tag));
        return (
          <ListView
            tasks={list}
            projects={projects}
            groupByProject
            emptyTitle={`No tasks tagged #${view.tag}`}
            emptyHint="Add the tag to any task to see it here."
            onEdit={setEditingTask}
            onUpdate={updateTask}
            onDelete={deleteTask}
          />
        );
      }
      case 'project': {
        const list = tasks.filter((t) => t.projectId === view.projectId);
        if (list.length === 0) {
          return (
            <div className="today empty-state">
              <h2>This project is empty 📭</h2>
              <p>
                Press <kbd>N</kbd> or hit "+ New task" to add your first one. It will land in
                this project by default.
              </p>
            </div>
          );
        }
        return (
          <Board
            projectId={view.projectId}
            tasks={list}
            projects={projects}
            onEdit={setEditingTask}
            onUpdate={updateTask}
            onDelete={deleteTask}
          />
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className="app">
      <Sidebar
        projects={projects}
        activeView={activeView}
        onSelect={setActiveView}
        onCreateProject={createProject}
        onRenameProject={renameProject}
        onDeleteProject={deleteProject}
        tasks={tasks}
        allTags={allTags}
      />
      <main className="main">
        <header className="topbar">
          <div className="topbar-titleblock">
            <div className="topbar-title">{headerInfo.title}</div>
            {headerInfo.sub && <div className="topbar-sub">{headerInfo.sub}</div>}
          </div>
          <div className="topbar-actions">
            <CalendarConnect />
            <button className="btn-primary" onClick={() => setEditingTask({ __new: true })}>
              + New task
            </button>
            <span className="hint">
              <kbd>⌘K</kbd> search · <kbd>N</kbd> add · <kbd>T</kbd> today
            </span>
            <ThemeToggle />
          </div>
        </header>
        {renderBody()}
      </main>

      {editingTask && (
        <TaskModal
          task={editingTask.__new ? null : editingTask}
          projects={projects}
          defaultProjectId={defaultProjectId}
          onSave={handleSaveTask}
          onClose={() => setEditingTask(null)}
        />
      )}
      {quickAddOpen && (
        <QuickAdd
          projects={projects}
          defaultProjectId={defaultProjectId}
          onSave={handleQuickAdd}
          onClose={() => setQuickAddOpen(false)}
        />
      )}
      {paletteOpen && (
        <CommandPalette
          tasks={tasks}
          projects={projects}
          onOpenTask={(t) => {
            setPaletteOpen(false);
            setEditingTask(t);
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}
