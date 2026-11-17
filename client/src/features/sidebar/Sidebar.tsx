import { CloseIcon, EditIcon, LogoMark, PanelIcon, ShieldIcon } from '../../components/icons'
import { groupByDay } from '../../lib/conversation-meta'
import { ADMIN_HASH } from '../../lib/hash-route'
import { startNewConversation } from '../../lib/navigation'
import { useHistoryStore } from '../../stores/historyStore'
import { ConversationRow } from './ConversationRow'
import { ThemeToggle } from './ThemeToggle'

// Sidebar (IMPLEMENTATION.md 15): app name, new conversation, this browser's conversations
// by day, Admin link and theme toggle.

interface SidebarProps {
  activeId: string | null
  adminActive: boolean
  /** Desktop: hide the sidebar. */
  onCollapse?: () => void
  /** Drawer: close it. */
  onClose?: () => void
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

const iconButton =
  'ml-auto inline-flex size-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-200/70 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'

export function Sidebar({ activeId, adminActive, onCollapse, onClose }: SidebarProps) {
  const entries = useHistoryStore((s) => s.entries)
  const groups = groupByDay(entries, new Date())

  return (
    <aside aria-label="Sidebar" className="flex h-full flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <LogoMark />
        <span className="font-semibold tracking-tight">QueryCraft</span>
        {onCollapse !== undefined && (
          <button type="button" aria-label="Hide the sidebar" onClick={onCollapse} className={iconButton}>
            <PanelIcon />
          </button>
        )}
        {onClose !== undefined && (
          <button type="button" aria-label="Close the sidebar" onClick={onClose} className={iconButton}>
            <CloseIcon />
          </button>
        )}
      </div>

      <div className="px-3 pt-1 pb-2">
        <button
          type="button"
          onClick={startNewConversation}
          aria-keyshortcuts="Control+Shift+O Meta+Shift+O"
          className="flex w-full items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400"
        >
          <EditIcon />
          New conversation
          <kbd className="ml-auto font-sans text-[11px] text-indigo-100">{isMac ? '⌘⇧O' : 'Ctrl+Shift+O'}</kbd>
        </button>
      </div>

      <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {groups.length === 0 ? (
          <p className="px-2.5 py-6 text-sm text-zinc-500 dark:text-zinc-400">
            No conversations yet. Questions you ask in this browser appear here.
          </p>
        ) : (
          groups.map((g) => (
            <section key={g.group} aria-label={g.group} className="mt-3 first:mt-1">
              <h2 className="px-2.5 pb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">{g.group}</h2>
              <ul className="space-y-0.5">
                {g.items.map((entry) => (
                  <ConversationRow key={entry.id} entry={entry} active={entry.id === activeId} />
                ))}
              </ul>
            </section>
          ))
        )}
      </nav>

      <div className="shrink-0 space-y-1 border-t border-zinc-200 p-2 dark:border-zinc-800">
        <a
          href={ADMIN_HASH}
          aria-current={adminActive ? 'page' : undefined}
          className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-500 ${
            adminActive
              ? 'bg-zinc-200/80 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
              : 'text-zinc-700 hover:bg-zinc-200/50 dark:text-zinc-300 dark:hover:bg-zinc-800/60'
          }`}
        >
          <ShieldIcon />
          Admin
        </a>
        <ThemeToggle />
      </div>
    </aside>
  )
}
