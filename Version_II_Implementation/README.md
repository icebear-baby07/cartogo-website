# carTOGO Version II

This is the isolated, incremental replacement workspace. The official
`Cartogo` directory is not modified or replaced by this project.

## Section 1 — Foundation (current)

- React + TypeScript frontend: `http://127.0.0.1:5173`
- Express + TypeScript API: `http://127.0.0.1:3001`
- `/api/health` is proxied through Vite so the starter UI can verify the API.
- Custom CSS is used; Tailwind is intentionally not included.
- Node 22 or newer is recommended.

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
2. **MongoDB connection** — server-only configuration and connection lifecycle.
3. **Shared API contracts** — typed DTOs and validation for browser/API boundaries.
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
