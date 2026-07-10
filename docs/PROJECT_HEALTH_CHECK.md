# Project Health Check

Every future development task must finish with:

- `npm run build` passes
- `npm run dev` starts successfully
- `localhost:3000/login` works
- `localhost:3000/dashboard` works
- CSS returns 200
- App Router chunks return 200
- PostgreSQL connection OK
- WhatsApp Connector OK
- No duplicate dev servers
- No hidden detached Next.js processes

## Required Runtime Checks

- Next.js Dev Server: one process only, serving `localhost:3000`
- PostgreSQL: available on `localhost:5432`
- WhatsApp Connector: available on `127.0.0.1:8787`
- Queue Worker: run only when queue processing is being tested

## Build Safety

Do not run `npm run build` while `npm run dev` is running. Production build output replaces `.next` and can break a running development server's CSS and App Router chunks.
