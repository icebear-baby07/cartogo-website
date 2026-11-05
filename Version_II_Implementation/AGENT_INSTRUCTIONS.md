# carTOGO Version II

This is the isolated, incremental replacement workspace. The official
`Cartogo` directory is not modified or replaced by this project.

## Section 1 — Foundation

- React + TypeScript frontend: `http://127.0.0.1:5173`
- Express + TypeScript API: `http://127.0.0.1:3001`
- `/api/health` reports API liveness.
- Custom CSS is used; Tailwind is intentionally not included.
- Node 22 or newer is recommended.

## Section 2 — MongoDB connection

- The API loads `apps/api/.env` and requires the server-only `MONGODB_URI`.
- `MONGODB_DATABASE` defaults to `cartogo`; `MONGODB_SITE_DATABASE` defaults
  to `Site`, matching the existing application's database split.
- `/api/health/ready` pings MongoDB and reports readiness without exposing
  connection details. The starter UI shows MongoDB connection status.
- The API remains available for liveness checks when MongoDB is not configured
  or temporarily unreachable; readiness returns HTTP 503 and logs the error.
- The MongoDB client is reused and closed during graceful shutdown.
- A live database handshake still needs verification with a non-production
  development URI in `apps/api/.env`.

## Section 3 — Shared API contracts (current)

- `packages/contracts` publishes Zod schemas and inferred TypeScript types for
  health/readiness responses, API errors, vehicle records, site assets, and
  public site content.
- API and React code both use the same health/readiness schemas; browser
  responses are runtime-validated rather than trusted via type assertions.
- The database-facing DTO schemas preserve additional document fields so a
  public read API can migrate without dropping existing Mongo data.
- Contract tests cover valid and invalid payloads. Future endpoint migrations
  should validate requests and responses with these schemas as they are added.

Copy `apps/api/.env.example` to `apps/api/.env`, then set `MONGODB_URI` to the
MongoDB URI used for a development/test database. Do not copy production
credentials into the repository. Never point Version II testing at production
until its data access and writes have been deliberately configured.

From this directory:

```powershell
npm.cmd install
npm.cmd run dev
```

In another terminal, build both workspaces with `npm.cmd run build`. The
frontend build checks TypeScript before bundling, and the API build runs `tsc`.

## Integration sections

Each section is to be implemented and verified independently in Version II.
Do not delete or replace the official application until explicitly authorized.

1. **Foundation** — workspace, TypeScript, React/Express starter, separate ports.
2. **MongoDB connection** — implemented: server-only configuration and
   connection lifecycle. Collection access is part of the later API sections.
3. **Shared API contracts** — implemented: typed schemas, inferred DTO types,
   runtime validation, and contract tests.
4. **Public read APIs** — site content, fleet, and site assets.
5. **Public website UI** — migrate customer-facing screens to React and existing CSS.
6. **Supabase authentication** — preserve Google sign-in and secure admin token checks.
7. **Admin APIs** — migrate inquiries, roles, owner approval, assets, and content.
8. **Admin UI** — migrate the administration screens and workflows.
9. **Email and geocoding integrations** — migrate SMTP and location services.
10. **Chatbot UI integration** — migrate the browser widget while retaining the
    Python/Boto3 chatbot service initially.
11. **End-to-end verification and cutover** — compare behavior, test deployments,
    and wait for an explicit go signal before changing the official application.

MongoDB schemas and existing data should remain unchanged during the initial
application migration. Keep credentials in local environment files; never
bundle database or service-role credentials into the browser application.
