import { defineConfig } from 'drizzle-kit'

// `npm run db:generate` writes SQL migrations to ./drizzle. Commit them; the app applies
// them at startup.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true
})
