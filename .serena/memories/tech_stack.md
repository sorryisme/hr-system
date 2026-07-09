Root: pnpm workspace (`packages: apps/*`), pnpm@11.9.0 pinned via corepack (packageManager field), node >=22.

apps/api: NestJS ^11.0.1 (Express adapter), TypeScript ^5.7.3 (target is eventually 5.9 per architecture doc, but not yet bumped — CLAUDE.md requires human approval for TS major upgrades), Jest ^30, ESLint 9 + prettier. Swagger (`@nestjs/swagger` + `swagger-ui-express`) mounted at `api/docs` (UI) / `api/docs/json` (OpenAPI spec) via `DocumentBuilder` in `main.ts`.

apps/web: Vite ^8.1.1, React ^19.2.7, TypeScript ~5.9.0 — deliberately pinned below the Vite template's default 6.0.2 (architecture doc says wait until 6.0 stabilizes; do not bump without approval per CLAUDE.md). TanStack Router: file-based routing under `src/routes`, `autoCodeSplitting: true` via `@tanstack/router-plugin`, `src/routeTree.gen.ts` is generated — never hand-edit (also stated in CLAUDE.md). Tailwind CSS v4 via `@tailwindcss/vite`. shadcn/ui config (`components.json`): style `base-nova`, baseColor `neutral`, path alias `@/*` → `./src/*`.

Known gaps (from `docs/setup-log.md`, still true as of onboarding):
- shadcn `form` component is not in this CLI's registry version — wiring `react-hook-form` + `zod` for any form needs manual setup.
- Orval (OpenAPI → frontend types) is not configured yet; do this once apps/web needs its first real API client.
- apps/api's package.json name is literally `"api"`, not a scoped name like `@care/api`.