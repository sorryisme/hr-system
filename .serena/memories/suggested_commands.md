Root scripts (package.json): `pnpm dev:api` → `apps/api`'s `nest start --watch` (port 3000). `pnpm dev:web` → `apps/web`'s `vite` (port 5173). No root-level build/lint/test script exists — always target a workspace package.

Per-package (run from repo root with `pnpm --filter <name> <script>`, name is `api` or `web`):
- api: `build` (nest build), `start`, `start:dev`, `start:debug`, `start:prod`, `lint` (eslint --fix), `test` (jest), `test:watch`, `test:cov`, `test:e2e` (jest -c test/jest-e2e.json).
- web: `dev`, `build` (`tsc -b && vite build`), `lint` (oxlint), `preview`.

Adding shadcn components: must use the shadcn CLI (`pnpm dlx shadcn@latest add <component>`) from `apps/web` — CLAUDE.md forbids hand-rolled duplicates in `components/ui`.