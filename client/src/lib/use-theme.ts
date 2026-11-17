import { useEffect } from 'react'
import { useThemeStore } from '../stores/themeStore'
import { applyTheme, resolveTheme } from './theme'

/** Applies the theme choice to <html>; "system" follows OS changes while the page is open. */
export function useApplyTheme(): void {
  const choice = useThemeStore((s) => s.choice)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      applyTheme(document.documentElement, resolveTheme(choice, media.matches))
    }
    apply()
    if (choice !== 'system') return undefined
    media.addEventListener('change', apply)
    return () => {
      media.removeEventListener('change', apply)
    }
  }, [choice])
}
