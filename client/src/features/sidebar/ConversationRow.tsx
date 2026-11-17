import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { MoreIcon, TrashIcon } from '../../components/icons'
import { RowSkeleton } from '../../components/Skeleton'
import { conversationHash } from '../../lib/hash-route'
import { startNewConversation } from '../../lib/navigation'
import { useHistoryStore, type HistoryEntry } from '../../stores/historyStore'
import { useBackfillState } from './use-backfill-titles'

export function ConversationRow({ entry, active }: { entry: HistoryEntry; active: boolean }) {
  const failed = useBackfillState((s) => s.failed.includes(entry.id))
  const remove = useHistoryStore((s) => s.remove)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const firstItem = useRef<HTMLButtonElement>(null)
  const title = entry.title ?? (failed ? 'Untitled conversation' : null)

  useEffect(() => {
    if (menuOpen) firstItem.current?.focus()
  }, [menuOpen])

  const closeMenu = (refocus: boolean): void => {
    setMenuOpen(false)
    if (refocus) menuButton.current?.focus()
  }

  const onRemove = (): void => {
    setMenuOpen(false)
    remove(entry.id)
    // Removing the open conversation leaves an empty thread behind: start a new one.
    if (active) startNewConversation()
  }

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      closeMenu(true)
    }
  }

  const onMenuBlur = (e: FocusEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.contains(e.relatedTarget)) closeMenu(false)
  }

  return (
    <li className="group relative">
      <a
        href={conversationHash(entry.id)}
        aria-current={active ? 'page' : undefined}
        className={`flex min-h-9 items-center rounded-md py-2 pr-9 pl-2.5 text-sm qc-focus-inset ${
          active
            ? 'bg-zinc-200/80 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
            : 'text-zinc-700 hover:bg-zinc-200/50 dark:text-zinc-300 dark:hover:bg-zinc-800/60'
        }`}
      >
        {title === null ? (
          <>
            <span className="sr-only">Loading the title</span>
            <RowSkeleton />
          </>
        ) : (
          <span className="truncate">{title}</span>
        )}
      </a>
      <button
        ref={menuButton}
        type="button"
        aria-label={`Options for ${title ?? 'this conversation'}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
        className={`absolute top-1/2 right-1 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-300/60 hover:text-zinc-900 focus-visible:opacity-100 qc-focus dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100 ${
          menuOpen || active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100'
        }`}
      >
        <MoreIcon />
      </button>
      {menuOpen && (
        <div
          role="menu"
          aria-label="Conversation options"
          onKeyDown={onMenuKey}
          onBlur={onMenuBlur}
          className="qc-fade-in absolute top-full right-1 z-20 mt-1 w-56 rounded-xl border border-zinc-200 bg-white p-1 shadow-md dark:border-zinc-700 dark:bg-zinc-900"
        >
          <button
            ref={firstItem}
            type="button"
            role="menuitem"
            onClick={onRemove}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 focus-visible:bg-zinc-100 focus-visible:outline-none dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:bg-zinc-800"
          >
            <TrashIcon />
            Remove from history
          </button>
          <p className="px-2.5 pt-0.5 pb-1.5 text-xs leading-snug text-zinc-500 dark:text-zinc-400">
            Only this browser forgets it. Nothing is deleted on the server.
          </p>
        </div>
      )}
    </li>
  )
}
