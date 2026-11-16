import { ErrorBoundary } from './components/ErrorBoundary'
import { AdminView } from './features/admin/AdminView'
import { AskView } from './features/ask/AskView'
import { HistoryView } from './features/history/HistoryView'
import { useHashView, VIEW_HASH, type View } from './lib/hash-route'

const NAV: { view: View; label: string }[] = [
  { view: 'ask', label: 'Ask' },
  { view: 'history', label: 'History' },
  { view: 'admin', label: 'Admin' },
]

function App() {
  const view = useHashView()
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold">QueryCraft</h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Ask your Postgres database questions in plain English. Safe by design, measured for accuracy.</p>
          </div>
          <nav aria-label="Views">
            <ul className="flex gap-1">
              {NAV.map((item) => (
                <li key={item.view}>
                  <a
                    href={VIEW_HASH[item.view]}
                    aria-current={view === item.view ? 'page' : undefined}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-sky-500 ${
                      view === item.view
                        ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                        : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        {/* Keyed by view: switching views clears a previous render error. */}
        <ErrorBoundary key={view} label="this view">
          {view === 'ask' && <AskView />}
          {view === 'history' && <HistoryView />}
          {view === 'admin' && <AdminView />}
        </ErrorBoundary>
      </main>
    </div>
  )
}

export default App
