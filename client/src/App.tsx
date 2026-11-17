import { useCallback, useEffect, useRef, useState } from 'react'
import { IconButton } from './components/Button'
import { ErrorBoundary } from './components/ErrorBoundary'
import { MenuIcon, EditIcon, PanelIcon } from './components/icons'
import { AdminView } from './features/admin/AdminView'
import { ChatView } from './features/ask/ChatView'
import { MobileDrawer } from './features/sidebar/MobileDrawer'
import { Sidebar } from './features/sidebar/Sidebar'
import { isLegacyHistoryHash, NEW_CONVERSATION_HASH, routeFromHash, useHash } from './lib/hash-route'
import { startNewConversation } from './lib/navigation'
import { useApplyTheme } from './lib/use-theme'
import { useBackfillTitles } from './features/sidebar/use-backfill-titles'

// Chat-style layout (IMPLEMENTATION.md 15): sidebar (a drawer on narrow screens) and the
// main area with the current conversation or the Admin view.

function App() {
  useApplyTheme()
  useBackfillTitles()
  const hash = useHash()
  const route = routeFromHash(hash)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)

  // On every hash change (adjusting state during render, not in an effect): the old History
  // view's hash opens the sidebar (it lives there now, approved 2026-11-17); any other
  // navigation (a conversation picked, Admin, new conversation) closes the drawer, except
  // the redirect away from that old hash.
  const [lastHash, setLastHash] = useState<string | null>(null)
  if (hash !== lastHash) {
    setLastHash(hash)
    if (isLegacyHistoryHash(hash)) {
      setSidebarOpen(true)
      setDrawerOpen(window.matchMedia('(max-width: 767px)').matches)
    } else if (lastHash === null || !isLegacyHistoryHash(lastHash)) {
      setDrawerOpen(false)
    }
  }

  // The old History hash is replaced by #/ (no extra history entry).
  useEffect(() => {
    if (isLegacyHistoryHash(hash)) window.location.replace(NEW_CONVERSATION_HASH)
  }, [hash])

  // Ctrl/Cmd+Shift+O: new conversation (the button is the fallback where the browser keeps it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        startNewConversation()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    menuButton.current?.focus()
  }, [])

  const activeId = route.view === 'chat' ? route.conversationId : null

  return (
    <div className="flex h-dvh overflow-hidden bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <a
        href="#composer"
        className="sr-only z-50 rounded-md bg-indigo-600 px-3 py-2 text-sm text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to the question box
      </a>

      {sidebarOpen && (
        <div className="hidden w-[260px] shrink-0 md:block">
          <Sidebar activeId={activeId} adminActive={route.view === 'admin'} onCollapse={() => setSidebarOpen(false)} />
        </div>
      )}

      <MobileDrawer open={drawerOpen} onClose={closeDrawer}>
        <Sidebar activeId={activeId} adminActive={route.view === 'admin'} onClose={closeDrawer} />
      </MobileDrawer>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className={`flex h-12 shrink-0 items-center gap-1 px-2 ${sidebarOpen ? 'md:hidden' : ''}`}>
          <IconButton ref={menuButton} aria-label="Open the sidebar" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)} className="md:hidden">
            <MenuIcon className="size-4" />
          </IconButton>
          {!sidebarOpen && (
            <IconButton aria-label="Show the sidebar" onClick={() => setSidebarOpen(true)} className="hidden md:inline-flex">
              <PanelIcon className="size-4" />
            </IconButton>
          )}
          <span className="px-1 text-sm font-medium">QueryCraft</span>
          <IconButton aria-label="New conversation" onClick={startNewConversation} className="ml-auto">
            <EditIcon className="size-4" />
          </IconButton>
        </header>

        <main className="flex min-h-0 flex-1 flex-col">
          {/* Keyed by view: switching views clears a previous render error. */}
          <ErrorBoundary key={route.view} label="this view">
            {route.view === 'chat' ? (
              <ChatView conversationId={route.conversationId} />
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto max-w-5xl px-4 py-6">
                  <h1 className="mb-6 text-xl font-medium">Admin</h1>
                  <AdminView />
                </div>
              </div>
            )}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}

export default App
