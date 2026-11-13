import { config } from 'dotenv'

// Loads server/.env into process.env (the scaffold uses dotenv; IMPLEMENTATION.md 7.1).
// Existing process variables are never overridden. Import this first in entry points.
config({ quiet: true })
