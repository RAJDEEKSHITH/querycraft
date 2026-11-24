import { Fragment, type ReactNode } from 'react'
import { parseMarkdown, type Inline } from '../lib/markdown'

// The model's answer with its small Markdown subset (bold, italics, lists, inline
// code). Only React elements and text nodes are produced, so HTML in the answer is
// shown as text and never interpreted.

function renderInline(nodes: readonly Inline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.kind) {
      case 'text':
        return <Fragment key={i}>{node.text}</Fragment>
      case 'strong':
        return <strong key={i} className="font-semibold">{renderInline(node.children)}</strong>
      case 'em':
        return <em key={i}>{renderInline(node.children)}</em>
      case 'code':
        return (
          <code key={i} className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.9em] dark:bg-zinc-800">
            {node.text}
          </code>
        )
    }
  })
}

export function AnswerText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={`space-y-2 ${className ?? ''}`}>
      {parseMarkdown(text).map((block, i) => {
        if (block.kind === 'paragraph') {
          return (
            <p key={i}>
              {block.lines.map((line, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  {renderInline(line)}
                </Fragment>
              ))}
            </p>
          )
        }
        const items = block.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)
        return block.ordered ? (
          <ol key={i} className="list-decimal space-y-1 pl-5">{items}</ol>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-5">{items}</ul>
        )
      })}
    </div>
  )
}
