import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import { getAppPool } from '../db/app.js'

// LangGraph Postgres checkpointer in the app database (IMPLEMENTATION.md 12.6).
// Its tables are created by `setup()` (idempotent), not by Drizzle (10.3). Under
// test the app pool points at querycraft_test, so tests never touch querycraft_app.

let saver: Promise<PostgresSaver> | undefined

export function getCheckpointer(): Promise<PostgresSaver> {
  saver ??= (async () => {
    const checkpointer = new PostgresSaver(getAppPool())
    await checkpointer.setup()
    return checkpointer
  })()
  return saver
}
