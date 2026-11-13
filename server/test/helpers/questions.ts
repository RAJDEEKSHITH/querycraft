import { getAppPool } from '../../src/db/app.js'

/** Inserts a conversation with one running question in querycraft_test; returns the question id. */
export async function createTestQuestion(question = 'test question'): Promise<string> {
  const result = await getAppPool().query<{ id: string }>(
    `WITH c AS (INSERT INTO conversations DEFAULT VALUES RETURNING id)
     INSERT INTO questions (conversation_id, question) SELECT id, $1 FROM c RETURNING id`,
    [question],
  )
  const id = result.rows[0]?.id
  if (id === undefined) throw new Error('question not created')
  return id
}
