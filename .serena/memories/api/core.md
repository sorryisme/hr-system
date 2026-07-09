apps/api/src currently has only the default Nest scaffold: `app.module.ts`, `app.controller.ts`, `app.service.ts`, `app.controller.spec.ts`, `main.ts`. No domain modules, no DB layer, no auth implemented yet.

`main.ts` bootstraps Swagger via `DocumentBuilder().addBearerAuth()`, mounted at `api/docs` (UI) and `api/docs/json` (spec) — keep this convention intact when adding modules so the future Orval pipeline (see `mem:tech_stack`) can consume the same OpenAPI spec.

Auth is not implemented yet, but CLAUDE.md already mandates the target shape: every endpoint must go through JWT verification + `@RequirePermissions`, with the permission source being MySQL RBAC (not Cognito groups) — build toward this from the start rather than adding it later.

DB layer: no Prisma yet. Target schema and business rules to implement against live in `docs/ddl/carehome_tms_ddl_v1.1.sql` and `mem:domain`.