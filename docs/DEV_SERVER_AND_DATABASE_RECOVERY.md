# Dev Server and Database Recovery

## Next.js Rules

- Never execute `npm run build` while `npm run dev` is running.
- If build verification is required:
  - Stop dev server first.
  - Run build.
  - Delete `.next`.
  - Restart `npm run dev`.

## Database Rules

- Local PostgreSQL must always use UTF8.
- Never create a WIN1252 database.
- Verify:

```sql
SHOW server_encoding;
SHOW client_encoding;
```

## Session Rules

If database is recreated:

- invalidate old session
- redirect to login
- never allow dashboard runtime crash

## Runtime Rules

Never use:

```ts
findUniqueOrThrow()
```

for user session validation.

Use:

```ts
findUnique()
```

and redirect gracefully.

## Recovery Steps

1. Stop the current Next.js dev server.
2. Delete `.next`.
3. Start `npm run dev`.
4. Verify `/login` and `/dashboard`.
5. Verify App Router CSS and chunks return HTTP 200.
