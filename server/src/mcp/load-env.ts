import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

// Loads server/.env for the MCP server. Claude Desktop starts the process from its
// own folder, so the file is found relative to this module (src/mcp or dist/mcp),
// not the working directory. Existing process variables are never overridden, and
// `quiet` keeps dotenv off stdout, which carries the MCP protocol.
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true })
