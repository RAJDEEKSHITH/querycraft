import { useRef, useState, type KeyboardEvent } from 'react'
import { Button } from '../../components/Button'
import { useAdminStore } from '../../stores/adminStore'
import { AuditTab } from './AuditTab'
import { ExamplesTab } from './ExamplesTab'
import { TokenPrompt } from './TokenPrompt'

// Admin view: token prompt, then two tabs (IMPLEMENTATION.md 15, approved 2026-11-16).

const TABS = [
  { id: 'examples', label: 'Examples' },
  { id: 'audit', label: 'Audit' },
] as const
type TabId = (typeof TABS)[number]['id']

export function AdminView() {
  const token = useAdminStore((s) => s.token)
  const signOut = useAdminStore((s) => s.signOut)
  const [tab, setTab] = useState<TabId>('examples')
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  if (token === null) return <TokenPrompt />

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const index = TABS.findIndex((t) => t.id === tab)
    const next = TABS[(index + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
    if (next === undefined) return
    setTab(next.id)
    tabRefs.current[TABS.indexOf(next)]?.focus()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800">
        <div role="tablist" aria-label="Admin sections" onKeyDown={onKeyDown} className="flex gap-1">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[i] = el
              }}
              id={`tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-sky-500 ${
                tab === t.id
                  ? 'border-sky-600 text-zinc-900 dark:border-sky-400 dark:text-zinc-100'
                  : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Button variant="ghost" onClick={() => signOut()}>
          Sign out
        </Button>
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'examples' ? <ExamplesTab token={token} /> : <AuditTab token={token} />}
      </div>
    </div>
  )
}
