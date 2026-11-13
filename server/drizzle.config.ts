import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ quiet: true });

// drizzle-kit generates migrations against the app database schema.
// `pnpm db:migrate` (src/db/migrate.ts) applies them to querycraft_app and querycraft_test.
const url = process.env.APP_DATABASE_URL;
if (url === undefined || url === "") {
  throw new Error("APP_DATABASE_URL is not set (see server/.env.example)");
}

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url },
});
