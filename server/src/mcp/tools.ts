import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { AppError, toAppError } from '../lib/errors.js'
import type { Logger } from '../lib/logger.js'
import { askMcpQuestion, describeMcpTable, listMcpTables, MCP_MAX_ROWS, runMcpQuery } from '../services/mcp.service.js'
import type { QuestionDeps } from '../services/question.service.js'

// MCP tools (IMPLEMENTATION.md 16): thin handlers over services/mcp.service.ts.
// Results are JSON text; blocked, refused and failed calls set `isError`. Error
// text is always the safe AppError message, never a raw database or provider error.

export const MCP_SERVER_NAME = 'querycraft'
export const MCP_SERVER_VERSION = '1.0.0'

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const

function textResult(value: unknown, isError: boolean): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], isError }
}

async function handle(tool: string, logger: Logger | undefined, run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run()
  } catch (err) {
    const appError = toAppError(err)
    if (!(err instanceof AppError)) logger?.error({ err, tool }, 'MCP tool failed')
    return textResult({ status: 'error', code: appError.code, message: appError.message }, true)
  }
}

export function createMcpServer(deps: QuestionDeps, logger?: Logger): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION })

  server.registerTool(
    'list_tables',
    {
      description: 'Lists the tables of the AdventureWorks database that can be queried, with a short description of each.',
      annotations: READ_ONLY,
    },
    () => handle('list_tables', logger, async () => textResult(await listMcpTables(), false)),
  )

  server.registerTool(
    'describe_table',
    {
      description:
        'Columns and types of one table. Columns that may not be read are left out; columns holding personal data (email, phone) are flagged and masked in results.',
      inputSchema: {
        schema: z.string().min(1).describe('Schema name, for example "sales"'),
        table: z.string().min(1).describe('Table name, for example "salesorderheader"'),
      },
      annotations: READ_ONLY,
    },
    ({ schema, table }) => handle('describe_table', logger, async () => textResult(await describeMcpTable(schema, table), false)),
  )

  server.registerTool(
    'run_safe_query',
    {
      description: `Runs one read-only PostgreSQL SELECT through the QueryCraft safety pipeline (policy check, cost check, read-only execution, masking). Expensive or unsafe queries are blocked. Returns at most ${MCP_MAX_ROWS} rows.`,
      inputSchema: { sql: z.string().min(1).describe('One PostgreSQL SELECT statement') },
      annotations: READ_ONLY,
    },
    ({ sql }) =>
      handle('run_safe_query', logger, async () => {
        const result = await runMcpQuery(sql)
        return textResult(result, result.status !== 'executed')
      }),
  )

  server.registerTool(
    'ask_question',
    {
      description: `Answers a plain-English question about the AdventureWorks data: QueryCraft writes the SQL, checks and runs it, and explains the result (at most ${MCP_MAX_ROWS} rows). If the question is ambiguous it returns a clarifying question; ask again with the missing detail.`,
      inputSchema: { question: z.string().min(1).describe('The question in plain English') },
      annotations: READ_ONLY,
    },
    ({ question }) =>
      handle('ask_question', logger, async () => {
        const result = await askMcpQuestion(question, deps)
        const isError = result.status === 'blocked' || result.status === 'approval_required' || result.status === 'failed'
        return textResult(result, isError)
      }),
  )

  return server
}
