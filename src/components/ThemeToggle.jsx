import { useTheme, THEMES } from '../theme.jsx';

const LABELS = { bauhaus: 'Bauhaus', japandi: 'Japandi', eightbit: '8-Bit' };

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => (
        <button
          key={t}
          role="radio"
          aria-checked={theme === t}
          className={`theme-toggle-btn ${theme === t ? 'active' : ''}`}
          onClick={() => setTheme(t)}
        >
          {LABELS[t]}
        </button>
      ))}
    </div>
  );
}
