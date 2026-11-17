import { create } from 'zustand'
import { parseTheme, THEME_KEY, type ThemeChoice } from '../lib/theme'

// Theme choice (IMPLEMENTATION.md 15), persisted to localStorage as a per-browser
// convenience; without storage the choice lasts for this page only.

function readChoice(): ThemeChoice {
  try {
    return typeof window === 'undefined' ? 'system' : parseTheme(window.localStorage.getItem(THEME_KEY))
  } catch {
    return 'system'
  }
}

interface ThemeStore {
  choice: ThemeChoice
  setChoice: (choice: ThemeChoice) => void
}

export const useThemeStore = create<ThemeStore>()((set) => ({
  choice: readChoice(),
  setChoice: (choice) => {
    try {
      window.localStorage.setItem(THEME_KEY, choice)
    } catch {
      // Storage refused: keep the choice in memory only.
    }
    set({ choice })
  },
}))
