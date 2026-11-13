import { describe, expect, it } from 'vitest'
import type { KbColumn } from '../../src/db/schema.js'
import { compactColumns, tableEmbeddingText } from '../../src/retrieval/table-text.js'

const columns: KbColumn[] = [
  { name: 'creditcardid', type: 'int', nullable: false, fk: null, pii: null, denied: false },
  { name: 'cardnumber', type: 'varchar(25)', nullable: false, fk: null, pii: null, denied: true },
  {
    name: 'currencyrateid',
    type: 'int',
    nullable: true,
    fk: { schema: 'sales', table: 'currencyrate', column: 'currencyrateid' },
    pii: null,
    denied: false,
  },
]

describe('table text', () => {
  it('lists allowed columns with abbreviated types and foreign keys, never denied ones', () => {
    expect(compactColumns(columns)).toBe(
      'creditcardid int, currencyrateid int (fk → sales.currencyrate.currencyrateid)',
    )
  })

  it('builds the embedded text from name, description and columns', () => {
    expect(tableEmbeddingText({ schema: 'sales', table: 'creditcard', columns }, 'Customer credit cards.')).toBe(
      'sales.creditcard: Customer credit cards. Columns: creditcardid int, currencyrateid int (fk → sales.currencyrate.currencyrateid)',
    )
  })

  it('does not double the full stop', () => {
    expect(tableEmbeddingText({ schema: 's', table: 't', columns: [] }, '  No dot  ')).toBe('s.t: No dot. Columns: ')
  })
})
