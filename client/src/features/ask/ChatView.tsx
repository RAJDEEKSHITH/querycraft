import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { AlertIcon, ArrowDownIcon } from '../../components/icons'
import { ThreadSkeleton } from '../../components/Skeleton'
import { ErrorMessage } from '../../components/States'
import { conversationHash, routeFromHash } from '../../lib/hash-route'
import { startNewConversation } from '../../lib/navigation'
import { isNearBottom } from '../../lib/scroll'
import { useAskStore } from '../../stores/askStore'
import { useHistoryStore } from '../../stores/historyStore'
import { Composer } from './Composer'
import { EmptyThread } from './EmptyThread'
import { ThreadTurn } from './ThreadTurn'

// One conversation as a chat thread (IMPLEMENTATION.md 15). The route decides which
// conversation is shown; a new conversation's id is put into the route after its first question.

function LoadFailed() {
  const loadError = useAskStore((s) => s.loadError)
  const openRoute = useAskStore((s) => s.openRoute)
  const remove = useHistoryStore((s) => s.remove)
  if (loadError === null) return null
  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <AlertIcon className="size-6 text-zinc-400" />
      <h1 className="text-xl font-medium text-zinc-900 dark:text-zinc-100">
        {loadError.notFound ? 'This conversation is no longer on the server' : 'The conversation could not be opened'}
      </h1>
      <p className="max-w-md text-sm text-zinc-500 dark:text-zinc-400">{loadError.message}</p>
      <div className="mt-2 flex gap-2">
        {loadError.notFound ? (
          <Button
            onClick={() => {
              remove(loadError.conversationId)
              startNewConversation()
            }}
          >
            Remove from history
          </Button>
        ) : (
          <Button onClick={() => void openRoute(loadError.conversationId)}>Try again</Button>
        )}
        <Button onClick={startNewConversation}>New conversation</Button>
      </div>
    </div>
  )
}

export function ChatView({ conversationId }: { conversationId: string | null }) {
  const openRoute = useAskStore((s) => s.openRoute)
  const storeId = useAskStore((s) => s.conversationId)
  const turns = useAskStore((s) => s.turns)
  const loading = useAskStore((s) => s.loading)
  const loadError = useAskStore((s) => s.loadError)
  const busy = useAskStore((s) => s.busy)
  const ask = useAskStore((s) => s.ask)
  const actionError = useAskStore((s) => s.actionError)
  const dismissError = useAskStore((s) => s.dismissError)

  const scroller = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const [atBottom, setAtBottom] = useState(true)

  // Route → store: open the conversation in the URL (or start a new one).
  useEffect(() => {
    void openRoute(conversationId)
  }, [conversationId, openRoute])

  // Store → route: a new conversation gets its #/c/<id> once the server created it.
  useEffect(() => {
    if (storeId === null) return
    const route = routeFromHash(window.location.hash)
    if (route.view === 'chat' && route.conversationId !== storeId) window.location.hash = conversationHash(storeId)
  }, [storeId])

  // Follow the stream while the reader is at the bottom.
  useEffect(() => {
    const el = scroller.current
    if (el !== null && follow.current) el.scrollTop = el.scrollHeight
  }, [turns])

  // A new question (or a conversation just opened) always scrolls to the bottom.
  const count = turns.length
  useEffect(() => {
    follow.current = true
    const el = scroller.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [count])

  const onScroll = (): void => {
    const el = scroller.current
    if (el === null) return
    const near = isNearBottom(el)
    follow.current = near
    setAtBottom(near)
  }

  const jumpToLatest = (): void => {
    follow.current = true
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }

  const showEmpty = loading === null && loadError === null && turns.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="absolute inset-0 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-4 py-6">
            {loading !== null ? (
              <ThreadSkeleton />
            ) : loadError !== null ? (
              <LoadFailed />
            ) : showEmpty ? (
              <EmptyThread disabled={busy} onPick={(q) => void ask(q)} />
            ) : (
              <div className="space-y-10">
                {turns.map((turn) => (
                  <ThreadTurn key={turn.questionId} turn={turn} />
                ))}
              </div>
            )}
            {actionError !== null && (
              <div className="mt-6">
                <ErrorMessage message={actionError} onDismiss={dismissError} />
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Its own row between the thread and the composer: it never covers the thread. */}
      {!atBottom && turns.length > 0 && (
        <div className="flex shrink-0 justify-center px-4 pt-2">
          <button
            type="button"
            onClick={jumpToLatest}
            className="qc-fade-in qc-focus inline-flex h-7 items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <ArrowDownIcon className="size-3.5" />
            Jump to latest
          </button>
        </div>
      )}
      <Composer />
    </div>
  )
}
