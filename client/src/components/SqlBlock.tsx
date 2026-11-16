import { useState } from 'react'
import { Button } from './Button'

export function SqlBlock({ sql, label = 'SQL' }: { sql: string; label?: string }) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle')

  const copy = (): void => {
    navigator.clipboard.writeText(sql).then(
      () => {
        setCopied('copied')
      },
      () => {
        setCopied('failed')
      },
    )
  }

  return (
    <figure className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
      <figcaption className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        {label}
        <Button variant="ghost" className="px-2 py-0.5 text-xs" onClick={copy} aria-label={`Copy ${label}`}>
          {copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy'}
        </Button>
      </figcaption>
      <pre className="max-h-72 overflow-auto bg-white p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
        <code>{sql}</code>
      </pre>
    </figure>
  )
}
