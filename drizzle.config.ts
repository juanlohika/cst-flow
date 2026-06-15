import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Next.js convention: secrets live in .env.local (gitignored). drizzle-kit
// runs outside the Next.js env loader, so we wire dotenv to the same file
// here. Falls back to .env for anyone who put creds in the default file.
loadEnv({ path: '.env.local' });
loadEnv(); // also load .env if present (lower priority — does not override)

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'turso',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  },
});
