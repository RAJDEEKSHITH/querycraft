import type { ReactNode } from 'react'
import { Button } from './Button'
import { AlertIcon } from './icons'
import { SkeletonLine } from './Skeleton'

// Loading, empty and error states used by every view (IMPLEMENTATION.md 15). Loading is a
// skeleton where content is expected; errors are calm (red is reserved for blocked runs).

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-2.5 py-4">
      <SkeletonLine className="w-2/3" />
      <SkeletonLine className="w-11/12" />
      <SkeletonLine className="w-1/2" />
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center dark:border-zinc-700">
      <p className="font-medium text-zinc-700 dark:text-zinc-200">{title}</p>
      {children !== undefined && <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{children}</div>}
    </div>
  )
}

export function ErrorMessage({ message, onRetry, onDismiss }: { message: string; onRetry?: () => void; onDismiss?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-300 bg-zinc-50 px-3.5 py-2.5 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
    >
      <span className="flex items-start gap-2">
        <AlertIcon className="mt-0.5 size-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
        {message}
      </span>
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
