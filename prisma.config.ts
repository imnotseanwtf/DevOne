import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Migrations take a session-level advisory lock, which a pooled (PgBouncer)
    // connection can't hold reliably, so prefer the direct one when it's set.
    // Neon's Vercel integration provides DATABASE_URL_UNPOOLED. The app itself
    // keeps using the pooled DATABASE_URL (see src/lib/db/prisma.ts).
    url:
      process.env.DATABASE_URL_UNPOOLED ??
      process.env.DIRECT_URL ??
      process.env.DATABASE_URL ??
      'postgresql://devone:devone@localhost:5432/devone'
  }
});
