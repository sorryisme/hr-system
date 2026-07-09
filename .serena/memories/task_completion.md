apps/api changes: run `pnpm --filter api build`, `pnpm --filter api lint`, `pnpm --filter api test` (add `test:e2e` if the change touches request handling) before calling the work done.

apps/web changes: run `pnpm --filter web build` (runs `tsc -b` then `vite build`, so it also catches type errors) and `pnpm --filter web lint` (oxlint).

No ORM/migration tooling is wired up yet (Prisma not started) — DB schema currently lives only as a raw SQL file at `docs/ddl/carehome_tms_ddl_v1.1.sql`. Once Prisma exists, CLAUDE.md bans `prisma db push` / `migrate dev` / `migrate reset` against real environments; DB changes must go through a migration.