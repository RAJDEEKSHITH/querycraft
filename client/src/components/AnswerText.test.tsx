import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown } from '../lib/markdown'
import { AnswerText } from './AnswerText'

// Answer Markdown (NOTES.md D102): only bold, italics, lists and inline code; raw HTML
// is never interpreted. The 2026-11-24 real runs showed literal "**" in answers.

const html = (text: string): string => renderToStaticMarkup(<AnswerText text={text} />)

describe('AnswerText', () => {
  it('renders bold, italics and inline code', () => {
    expect(html('The pair **“Water Bottle – 30 oz.”** was *often* bought; see `times_bought_together`.')).toBe(
      '<div class="space-y-2 "><p>The pair <strong class="font-semibold">“Water Bottle – 30 oz.”</strong> was <em>often</em> bought; see ' +
        '<code class="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.9em] dark:bg-zinc-800">times_bought_together</code>.</p></div>',
    )
    expect(html('_Note_: done')).toContain('<em>Note</em>')
  })

  it('renders bullet and numbered lists, and keeps line breaks inside a paragraph', () => {
    const out = html('Top products:\n- **Mountain-200 Black, 42**\n- Road-250 Red\n\n1. First\n2. Second\nLine one  \nline two')
    expect(out).toContain('<p>Top products:</p>')
    expect(out).toContain('<ul class="list-disc space-y-1 pl-5"><li><strong class="font-semibold">Mountain-200 Black, 42</strong></li><li>Road-250 Red</li></ul>')
    expect(out).toContain('<ol class="list-decimal space-y-1 pl-5"><li>First</li><li>Second</li></ol>')
    expect(out).toContain('<p>Line one<br/>line two</p>')
  })

  it('renders a real answer from the 2014 run without asterisks', () => {
    const out = html('There is no data for 2014.  \nIn 2023, the top product was **Mountain‑200 Black, 42** with revenue **$1,167,802.98**.')
    expect(out).not.toContain('*')
    expect(out).toContain('<strong class="font-semibold">Mountain‑200 Black, 42</strong>')
  })

  it('shows <script> and <img onerror> as plain text', () => {
    const attack = '<script>alert(1)</script> and <img src=x onerror="alert(2)">'
    for (const text of [attack, `**${attack}**`, `- ${attack}`, `\`${attack}\``, `*${attack}*`]) {
      const out = html(text)
      expect(out).not.toMatch(/<script|<img/i)
      expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
      expect(out).toContain('&lt;img src=x onerror=&quot;alert(2)&quot;&gt;')
    }
  })

  it('leaves links, headings and other Markdown as literal text', () => {
    const out = html('# Title\n[click](javascript:alert(1)) ![x](http://e/x.png) > quote')
    expect(out).not.toMatch(/<a |<h1|<img|<blockquote/)
    expect(out).toContain('# Title')
    expect(out).toContain('[click](javascript:alert(1))')
  })
})

describe('parseInline', () => {
  it('keeps arithmetic, snake_case names and unclosed markers literal', () => {
    expect(parseInline('2 * 3 * 4')).toEqual([{ kind: 'text', text: '2 * 3 * 4' }])
    expect(parseInline('revenue_2023 vs revenue_2024')).toEqual([{ kind: 'text', text: 'revenue_2023 vs revenue_2024' }])
    expect(parseInline('**not closed')).toEqual([{ kind: 'text', text: '**not closed' }])
    expect(parseInline('a ` b')).toEqual([{ kind: 'text', text: 'a ` b' }])
  })

  it('nests italics inside bold', () => {
    expect(parseInline('**a *b* c**')).toEqual([
      { kind: 'strong', children: [{ kind: 'text', text: 'a ' }, { kind: 'em', children: [{ kind: 'text', text: 'b' }] }, { kind: 'text', text: ' c' }] },
    ])
  })
})

describe('parseMarkdown', () => {
  it('a line starting with *word* is italic text, not a list item', () => {
    expect(parseMarkdown('*Note* this')).toEqual([
      { kind: 'paragraph', lines: [[{ kind: 'em', children: [{ kind: 'text', text: 'Note' }] }, { kind: 'text', text: ' this' }]] },
    ])
  })

  it('plain text is one paragraph', () => {
    expect(parseMarkdown('We have 19820 customers.')).toEqual([{ kind: 'paragraph', lines: [[{ kind: 'text', text: 'We have 19820 customers.' }]] }])
  })
})
