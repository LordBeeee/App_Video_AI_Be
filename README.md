# Video AI backend

NestJS API for authentication, media assets, AI generation, chat, pricing,
wallets and payOS top-ups. PostgreSQL stores application data. OpenRouter,
Kling, BytePlus ModelArk, Cloudinary and payOS are external services.

## Start from a fresh clone

Requirements: Node.js 20.6+, npm, PostgreSQL. Docker is optional for local
PostgreSQL.

```bash
npm ci
cp .env.example .env
docker compose up -d postgres
npm run db:setup
npm run start:dev
```

On PowerShell, use `Copy-Item .env.example .env` instead of `cp` if preferred.
Set the required secrets in `.env` before starting the API. The local Docker
database credentials in `compose.yaml` match `.env.example`; change both if
needed. If PostgreSQL already runs locally, skip Docker and set the `DB_*`
values to your empty database.

To create the first administrator, set `BOOTSTRAP_ADMIN_EMAIL` and
`BOOTSTRAP_ADMIN_PASSWORD` in your local `.env`, then run:

```bash
npm run db:create-admin
```

Remove those two bootstrap variables afterward. Never commit `.env` or real
API keys. `db:setup` is only for an empty database. See [database setup](docs/database.md)
for the legacy upgrade path.

The API listens on `http://localhost:3000` by default. `GET /` is a simple
smoke check. Login uses HTTP-only cookies. The default CORS origin is
`http://localhost:5173`; set `FRONTEND_URL` if your frontend uses another URL.

## Configuration

`.env.example` lists every startup variable. Database, JWT, Cloudinary and
OpenRouter settings are required at startup. Kling and BytePlus ModelArk keys
are needed when calling their respective video models;
payOS credentials are needed for top-ups and webhook verification. The
application reports missing startup variables before connecting to the DB.

## Main API flows

- `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`
- `GET /ai-catalog?modality=image|video|audio|chat`
- `POST /pricing/quotes` then `POST /generations`
- `POST /chat/conversations` and `POST /chat/conversations/:id/messages`
- `GET /assets`, `POST /assets/upload`
- `GET /wallet`, `POST /wallet/topups`

See [AI platform behavior](AI_PLATFORM.md) for provider and pricing details.
See [architecture](docs/architecture.md) for module boundaries and the generation flow.

## Code map

`src/modules/ai-platform/catalog` lists and syncs available models;
`pricing` builds quotes; `generations` creates media and reconciles video
jobs; `chat` streams conversation output; `references` handles Kling reference
assets. `wallet` owns holds and settlement, while `assets` owns library items.
`src/config` validates startup settings. `database/migrations` holds the fresh
schema and `database/seeds` holds required initial data.

## Checks

```bash
npm run build
npm test -- --runInBand
npm run lint
```

The current lint baseline still has existing violations; build and unit tests
are the working gates while those are cleaned up module by module.
