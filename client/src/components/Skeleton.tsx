// Loading skeletons where content is expected (IMPLEMENTATION.md 15).

export function SkeletonLine({ className = 'w-full' }: { className?: string }) {
  return <span aria-hidden="true" className={`block h-3 rounded-md bg-zinc-200/80 motion-safe:animate-pulse dark:bg-zinc-800 ${className}`} />
}

/** An answer still being written: a few text lines. */
export function AnswerSkeleton() {
  return (
    <div role="status" aria-label="Waiting for the answer" className="space-y-2.5 py-1">
      <SkeletonLine className="w-11/12" />
      <SkeletonLine className="w-4/5" />
      <SkeletonLine className="w-2/5" />
    </div>
  )
}

/** A conversation being opened: a question and an answer. */
export function ThreadSkeleton() {
  return (
    <div role="status" aria-label="Loading the conversation" className="space-y-8 py-4">
      {[0, 1].map((i) => (
        <div key={i} className="space-y-4">
          <div className="flex justify-end">
            <SkeletonLine className="h-9 w-1/2 rounded-xl" />
          </div>
          <div className="space-y-2.5">
            <SkeletonLine className="w-1/3" />
            <SkeletonLine className="w-11/12" />
            <SkeletonLine className="w-3/4" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Sidebar rows being loaded. */
export function RowSkeleton() {
  return <SkeletonLine className="my-1 h-3.5 w-3/4" />
}
