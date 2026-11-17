// Theme choice (IMPLEMENTATION.md 15): light, dark or system (default). The choice is a
// per-browser convenience in localStorage; the resolved theme is the `dark` class on <html>.
// index.html applies the same rules before the first paint (keep the key in sync).

export const THEME_KEY = 'querycraft.theme'
export const THEME_CHOICES = ['system', 'light', 'dark'] as const
export type ThemeChoice = (typeof THEME_CHOICES)[number]
export type ResolvedTheme = 'light' | 'dark'

export function parseTheme(raw: string | null | undefined): ThemeChoice {
  return THEME_CHOICES.find((c) => c === raw) ?? 'system'
}

export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): ResolvedTheme {
  if (choice === 'system') return systemPrefersDark ? 'dark' : 'light'
  return choice
}

export interface ThemeRoot {
  classList: { toggle(token: string, force?: boolean): boolean }
  style: { colorScheme: string }
}

/** Sets the `dark` class and the native colour scheme (form controls, scrollbars). */
export function applyTheme(root: ThemeRoot, theme: ResolvedTheme): void {
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}
