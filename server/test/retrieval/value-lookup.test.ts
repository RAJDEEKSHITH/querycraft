import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeAppPool, getAppPool } from '../../src/db/app.js'
import { closeReaderPool, getReaderPool } from '../../src/db/reader.js'
import { readSeedFile, schemaFileSchema, seedPath, valueColumnsFileSchema } from '../../src/kb/seed-files.js'
import { loadColumnValues } from '../../src/kb/values.js'
import { lookupValues, questionPhrases } from '../../src/retrieval/value-lookup.js'

// Trigram value lookup over the real configured column values (loaded from
// adventureworks into querycraft_test).

beforeAll(async () => {
  await getAppPool().query('TRUNCATE column_values')
  const schema = await readSeedFile(seedPath.schema, schemaFileSchema)
  await loadColumnValues(getReaderPool(), await readSeedFile(seedPath.valueColumns, valueColumnsFileSchema), schema)
})

afterAll(async () => {
  await closeReaderPool()
  await closeAppPool()
})

async function matched(question: string): Promise<string[]> {
  return (await lookupValues(question)).map((m) => `${m.schema}.${m.table}.${m.column}=${m.value}`)
}

describe('questionPhrases', () => {
  it('builds 1-3 word phrases that start and end with content words', () => {
    expect(questionPhrases('How many orders were shipped to New South Wales?')).toEqual([
      'orders',
      'orders were shipped',
      'shipped',
      'shipped to new',
      'new',
      'new south',
      'new south wales',
      'south',
      'south wales',
      'wales',
    ])
  })

  it('returns nothing for stopwords and short words only', () => {
    expect(questionPhrases('How many are there in it?')).toEqual([])
  })
})

describe('lookupValues', () => {
  it.each([
    ['How many orders were shipped to Bothel?', 'person.address.city=Bothell'],
    ['Revenue from customers in Germny', 'person.countryregion.name=Germany'],
    ['Revenue from customers in Germny', 'sales.salesterritory.name=Germany'],
    ['Which products are colored silvr?', 'production.product.color=Silver'],
    ['Total sales of mountain bikes in the Nortwest territory', 'sales.salesterritory.name=Northwest'],
    ['Total sales of mountain bikes in the Nortwest territory', 'production.productsubcategory.name=Mountain Bikes'],
    ['Orders shipped by overnight fast', 'purchasing.shipmethod.name=OVERNIGHT J-FAST'],
    ['sales in new south wales', 'person.stateprovince.name=New South Wales'],
    ['employees in the enginering department', 'humanresources.department.name=Engineering'],
  ])('maps "%s" to %s', async (question, expected) => {
    expect(await matched(question)).toContain(expected)
  })

  it('returns at most 10 matches at or above 0.30, best first', async () => {
    const matches = await lookupValues('Total sales of mountain bikes in the Nortwest territory')
    expect(matches.length).toBeLessThanOrEqual(10)
    expect(matches.every((m) => m.similarity >= 0.3)).toBe(true)
    const similarities = matches.map((m) => m.similarity)
    expect(similarities).toEqual([...similarities].sort((a, b) => b - a))
  })

  it('keeps at most 3 values per question phrase', async () => {
    const matches = await lookupValues('mountain')
    expect(matches).toHaveLength(3)
  })

  it('honours a stricter threshold', async () => {
    expect(await lookupValues('customers in Germny', { threshold: 0.6 })).toEqual([])
  })

  it('returns nothing when the question has no content words', async () => {
    expect(await lookupValues('How many are there?')).toEqual([])
  })
})
