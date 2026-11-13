// Loads server/.env for database-backed tests. NODE_ENV=test is set by
// vitest.config.ts and is not overridden (dotenv never overrides existing values).
import '../src/config/load-dotenv.js'
