import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLlmClient, type ChatMessage } from '../../src/agent/llm.js'
import { createMockChatProvider } from '../../src/agent/mock-llm.js'
import { closeAppPool, getAppPool } from '../../src/db/app.js'
import { DESCRIBE_BATCH_SIZE, draftMissingDescriptions, parseDescriptionsReply } from '../../src/kb/describe.js'
import type { SchemaFile, TableDescriptions } from '../../src/kb/seed-files.js'

vi.stubEnv('DAILY_TOKEN_BUDGET', '1000000')

function table(name: string, extra: SchemaFile['tables'][number]['columns'] = []): SchemaFile['tables'][number] {
  return {
    schema: 'sales',
    table: name,
    comment: `Comment for ${name}.`,
    columns: [{ name: 'id', type: 'int', nullable: false, fk: null, pii: null, denied: false }, ...extra],
  }
}

/** Replies with a description for every table named in the user message. */
function describeAll(messages: readonly ChatMessage[]): string {
  const names = [...(messages[1]?.content ?? '').matchAll(/^(sales\.\w+)$/gm)].map((m) => m[1] ?? '')
  return JSON.stringify(Object.fromEntries(names.map((n) => [n, `Rows of ${n}.`])))
}

beforeEach(async () => {
  await getAppPool().query('TRUNCATE daily_usage')
})

afterAll(async () => {
  await closeAppPool()
})

describe('parseDescriptionsReply', () => {
  it('reads a plain or fenced JSON object', () => {
    expect(parseDescriptionsReply('{"sales.a":"A."}', ['sales.a'])).toEqual({ 'sales.a': 'A.' })
    expect(parseDescriptionsReply('Here:\n```json\n{"sales.a":"A."}\n```', ['sales.a'])).toEqual({ 'sales.a': 'A.' })
  })

  it.each([
    ['not JSON', 'Sorry, I cannot.'],
    ['a missing table', '{"sales.a":"A."}'],
    ['an extra table', '{"sales.a":"A.","sales.b":"B.","sales.c":"C."}'],
    ['an empty description', '{"sales.a":"A.","sales.b":"  "}'],
  ])('rejects %s', (_name, reply) => {
    expect(() => parseDescriptionsReply(reply, ['sales.a', 'sales.b'])).toThrow(/kb:describe/)
  })
})

describe('draftMissingDescriptions', () => {
  it('drafts only tables without a description, in batches, saving after each batch', async () => {
    const tables = Array.from({ length: DESCRIBE_BATCH_SIZE + 3 }, (_, i) => table(`t${String(i).padStart(2, '0')}`))
    const existing: TableDescriptions = { 'sales.t00': 'Kept as written by a human.' }
    const provider = createMockChatProvider(describeAll)
    const saves: TableDescriptions[] = []
    const result = await draftMissingDescriptions({ tables }, existing, createLlmClient(provider), (d) => {
      saves.push(d)
      return Promise.resolve()
    })
    expect(provider.requests).toHaveLength(2) // 12 missing → 10 + 2
    expect(saves).toHaveLength(2)
    expect(result.drafted).toBe(12)
    expect(result.remaining).toBe(0)
    expect(result.descriptions['sales.t00']).toBe('Kept as written by a human.')
    expect(result.descriptions['sales.t12']).toBe('Rows of sales.t12.')
    expect(Object.keys(result.descriptions)).toEqual([...Object.keys(result.descriptions)].sort())
    expect(provider.requests.every((r) => r.model === process.env['LLM_MODEL'])).toBe(true)
  })

  it('makes no call when every table is described', async () => {
    const provider = createMockChatProvider(describeAll)
    const result = await draftMissingDescriptions(
      { tables: [table('a')] },
      { 'sales.a': 'Done.' },
      createLlmClient(provider),
      () => Promise.resolve(),
    )
    expect(provider.requests).toHaveLength(0)
    expect(result.drafted).toBe(0)
  })

  it('never sends denied columns and includes comments and foreign keys', async () => {
    const provider = createMockChatProvider(describeAll)
    await draftMissingDescriptions(
      {
        tables: [
          table('creditcard', [
            { name: 'cardnumber', type: 'varchar(25)', nullable: false, fk: null, pii: null, denied: true },
            { name: 'cardtype', type: 'varchar(50)', nullable: false, fk: null, pii: null, denied: false },
            {
              name: 'storeid',
              type: 'int',
              nullable: true,
              fk: { schema: 'sales', table: 'store', column: 'businessentityid' },
              pii: null,
              denied: false,
            },
          ]),
        ],
      },
      {},
      createLlmClient(provider),
      () => Promise.resolve(),
    )
    const sent = provider.requests[0]?.messages[1]?.content ?? ''
    expect(sent).not.toContain('cardnumber')
    expect(sent).toContain('cardtype varchar(50)')
    expect(sent).toContain('storeid int (fk → sales.store.businessentityid)')
    expect(sent).toContain('Comment: Comment for creditcard.')
  })

  it('stops on an invalid reply but keeps earlier batches saved', async () => {
    const tables = Array.from({ length: DESCRIBE_BATCH_SIZE + 1 }, (_, i) => table(`t${String(i).padStart(2, '0')}`))
    let call = 0
    const provider = createMockChatProvider((messages) => {
      call += 1
      return call === 1 ? describeAll(messages) : 'not json'
    })
    const saves: TableDescriptions[] = []
    await expect(
      draftMissingDescriptions({ tables }, {}, createLlmClient(provider), (d) => {
        saves.push(d)
        return Promise.resolve()
      }),
    ).rejects.toThrow(/not JSON/)
    expect(saves).toHaveLength(1)
    expect(Object.keys(saves[0] ?? {})).toHaveLength(DESCRIBE_BATCH_SIZE)
  })

  it('records usage as source app', async () => {
    const provider = createMockChatProvider(describeAll)
    await draftMissingDescriptions({ tables: [table('a')] }, {}, createLlmClient(provider), () => Promise.resolve())
    const rows = await getAppPool().query<{ source: string; llm_requests: number }>(
      'SELECT source, llm_requests FROM daily_usage',
    )
    expect(rows.rows).toEqual([{ source: 'app', llm_requests: 1 }])
  })
})
