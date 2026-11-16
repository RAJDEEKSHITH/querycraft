import { create } from 'zustand'

// Admin token in memory only: never written to localStorage, sessionStorage or the
// URL (IMPLEMENTATION.md 15, CLAUDE.md 10). A page reload asks for it again.

interface AdminStore {
  token: string | null
  /** Why the token prompt is shown again (e.g. the server rejected the token). */
  notice: string | null
  signIn: (token: string) => void
  signOut: (notice?: string) => void
}

export const useAdminStore = create<AdminStore>()((set) => ({
  token: null,
  notice: null,
  signIn: (token) => {
    set({ token, notice: null })
  },
  signOut: (notice) => {
    set({ token: null, notice: notice ?? null })
  },
}))
