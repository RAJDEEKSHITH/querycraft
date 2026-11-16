import type { ReactNode } from 'react'
import { Button } from './Button'

// Loading, empty and error states used by every view (IMPLEMENTATION.md 15).

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" className="flex items-center gap-2 py-6 text-sm text-zinc-500 dark:text-zinc-400">
      <span aria-hidden="true" className="size-3 animate-spin rounded-full border-2 border-zinc-300 border-t-sky-500" />
      {label}
    </p>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center dark:border-zinc-700">
      <p className="font-medium text-zinc-700 dark:text-zinc-200">{title}</p>
      {children !== undefined && <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{children}</div>}
    </div>
  )
}

export function ErrorMessage({ message, onRetry, onDismiss }: { message: string; onRetry?: () => void; onDismiss?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
    >
      <span>{message}</span>
      <span className="flex gap-2">
        {onRetry !== undefined && <Button onClick={onRetry}>Try again</Button>}
        {onDismiss !== undefined && (
          <Button variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        )}
      </span>
    </div>
  )
}
