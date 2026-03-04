# Railway OAuth Monorepo (Bun)

This repository is a Bun workspace monorepo with:

- `apps/web`: SolidJS + TanStack Router + TanStack Query + Hono client + Tailwind CSS v4 + Vite
- `apps/api`: Hono + OpenID Client + Drizzle ORM + SQLite (Bun) + Railway OAuth

The API serves the built web assets in production mode and supports SPA fallback.

## Prerequisites

- Bun 1.1+
- A Railway OAuth application

## Environment

1. Copy `.env.example` to `.env`
2. Fill in your Railway OAuth values:
   - `RAILWAY_CLIENT_ID`
   - `RAILWAY_CLIENT_SECRET`
3. Keep callback URL configured in Railway as:
   - `http://localhost:8787/api/auth/callback/railway`

## Routes

- `/` is public and shows login when logged out.
- `/dash` is protected and redirects to `/` unless authenticated.

The Railway provider uses these scopes:

- `openid`
- `email`
- `profile`
- `workspace:viewer`
- `project:viewer`

## Install

```bash
bun install
```

## Run locally

```bash
bun run dev
```

- Web: `http://localhost:3000`
- API: `http://localhost:8787`
- Health check: `http://localhost:8787/_health`

## Build and serve from API

```bash
bun run build
bun run start
```

In `start`, API serves static files from `apps/web/dist` with SPA fallback.
