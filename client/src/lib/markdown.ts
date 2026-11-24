// A deliberately small Markdown subset for answer text (NOTES.md D102): **bold**,
// *italic* / _italic_, `inline code`, and "-", "*", "+" or "1." lists. Everything else,
// including any HTML, stays literal text. The output is a plain tree that
// AnswerText renders as React elements, so nothing is ever parsed as HTML.

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'code'; text: string }

export type Block =
  | { kind: 'paragraph'; lines: Inline[][] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }

const BULLET = /^\s*[-*+]\s+(.*)$/
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/
const WORD = /[\p{L}\p{N}]/u

function pushText(out: Inline[], text: string): void {
  if (text === '') return
  const last = out[out.length - 1]
  if (last?.kind === 'text') last.text += text
  else out.push({ kind: 'text', text })
}

/** Index of a closing delimiter that follows non-space text; -1 when there is none. */
function findClose(text: string, delimiter: string, from: number): number {
  let at = text.indexOf(delimiter, from)
  while (at !== -1) {
    const before = text[at - 1]
    const after = text[at + delimiter.length]
    const closesWord = delimiter !== '_' || after === undefined || !WORD.test(after)
    // `**` must not be read as two `*`: skip a single `*` that is part of `**`.
    const partOfDouble = delimiter === '*' && (after === '*' || before === '*')
    if (at > from && before !== undefined && !/\s/.test(before) && closesWord && !partOfDouble) return at
    at = text.indexOf(delimiter, at + 1)
  }
  return -1
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i] ?? ''
    if (ch === '`') {
      const close = text.indexOf('`', i + 1)
      if (close > i + 1) {
        out.push({ kind: 'code', text: text.slice(i + 1, close) })
        i = close + 1
        continue
      }
    }
    const delimiter = text.startsWith('**', i) ? '**' : ch === '*' || ch === '_' ? ch : null
    if (delimiter !== null) {
      const next = text[i + delimiter.length]
      const prev = text[i - 1]
      const opens = next !== undefined && !/\s/.test(next) && (delimiter !== '_' || prev === undefined || !WORD.test(prev))
      const close = opens ? findClose(text, delimiter, i + delimiter.length) : -1
      if (close !== -1) {
        const children = parseInline(text.slice(i + delimiter.length, close))
        out.push(delimiter === '**' ? { kind: 'strong', children } : { kind: 'em', children })
        i = close + delimiter.length
        continue
      }
      pushText(out, delimiter)
      i += delimiter.length
      continue
    }
    pushText(out, ch)
    i += 1
  }
  return out
}

/** Paragraphs (lines kept as line breaks) and lists; blank lines separate blocks. */
export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = []
  let current: Block | null = null
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    if (line.trim() === '') {
      current = null
      continue
    }
    const bullet = BULLET.exec(line)
    const numbered = bullet === null ? NUMBERED.exec(line) : null
    const item = bullet?.[1] ?? numbered?.[1]
    if (item !== undefined) {
      const ordered = numbered !== null
      if (current?.kind !== 'list' || current.ordered !== ordered) {
        current = { kind: 'list', ordered, items: [] }
        blocks.push(current)
      }
      current.items.push(parseInline(item))
      continue
    }
    if (current?.kind !== 'paragraph') {
      current = { kind: 'paragraph', lines: [] }
      blocks.push(current)
    }
    current.lines.push(parseInline(line.trim()))
  }
  return blocks
}
