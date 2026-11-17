const TONES: Record<string, string> = {
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  red: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  blue: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300',
  gray: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
}

const STATUS_TONE: Record<string, keyof typeof TONES> = {
  answered: 'green',
  verified: 'green',
  allowed: 'green',
  blocked: 'red',
  awaiting_clarification: 'amber',
  awaiting_approval: 'amber',
  needs_approval: 'amber',
  pending: 'amber',
  running: 'blue',
}

const LABELS: Record<string, string> = {
  awaiting_clarification: 'needs clarification',
  awaiting_approval: 'needs approval',
  cannot_answer: 'cannot answer',
  needs_approval: 'needs approval',
}

export function StatusBadge({ status }: { status: string }) {
  const tone = TONES[STATUS_TONE[status] ?? 'gray']
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {LABELS[status] ?? status.replaceAll('_', ' ')}
    </span>
  )
}
