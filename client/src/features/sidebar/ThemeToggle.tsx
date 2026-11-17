import { MonitorIcon, MoonIcon, SunIcon } from '../../components/icons'
import type { ThemeChoice } from '../../lib/theme'
import { useThemeStore } from '../../stores/themeStore'

const OPTIONS: { id: ThemeChoice; label: string; Icon: typeof SunIcon }[] = [
  { id: 'system', label: 'System theme', Icon: MonitorIcon },
  { id: 'light', label: 'Light theme', Icon: SunIcon },
  { id: 'dark', label: 'Dark theme', Icon: MoonIcon },
]

export function ThemeToggle() {
  const choice = useThemeStore((s) => s.choice)
  const setChoice = useThemeStore((s) => s.setChoice)
  return (
    <div className="flex items-center justify-between gap-2 px-2.5 py-1">
      <span id="theme-label" className="text-xs text-zinc-500 dark:text-zinc-400">
        Theme
      </span>
      <div role="group" aria-labelledby="theme-label" className="flex rounded-md border border-zinc-200 p-0.5 dark:border-zinc-700">
        {OPTIONS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-pressed={choice === id}
            title={label}
            onClick={() => setChoice(id)}
            className={`inline-flex size-7 items-center justify-center rounded-md qc-focus ${
              choice === id
                ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50'
                : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            <Icon className="size-3.5" />
          </button>
        ))}
      </div>
    </div>
  )
}
