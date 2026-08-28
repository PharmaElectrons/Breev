# Run Breev locally

This guide sets up the current Breev desktop, local API, and PostgreSQL database for development and feature testing.

## Prerequisites

Install:

- Node.js `24.19.0`
- pnpm `11.23.0`
- Docker, or PostgreSQL 16 or newer
- Git

The repository pins Node and pnpm in [`.node-version`](../.node-version) and [`package.json`](../package.json). Run these commands to confirm the versions pnpm uses:

```bash
pnpm exec node --version
pnpm --version
```

## Install packages

From the repository root:

```bash
pnpm install
```

## Set up PostgreSQL

Breev uses two database roles. `breev_schema_owner` runs migrations. `breev_app` runs the API without schema creation or superuser privileges.

### Start a new Docker database

Run this once if the `breev-postgres` container does not exist:

```bash
docker run -d \
  --name breev-postgres \
  -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres \
  postgres:18-bookworm
```

On later runs, start the existing container:

```bash
docker start breev-postgres
```

Check it before continuing:

```bash
docker ps --filter name=breev-postgres
```

### Create the local database and roles

Connect with `psql` or a PostgreSQL administration client. Run this SQL once:

```sql
CREATE DATABASE breev_local;

\connect breev_local

REVOKE CREATE ON SCHEMA public FROM public;

CREATE ROLE breev_schema_owner WITH LOGIN PASSWORD 'migrator_secret_password';
CREATE ROLE breev_app WITH LOGIN PASSWORD 'app_secret_password';

GRANT CREATE ON DATABASE breev_local TO breev_schema_owner;
GRANT USAGE, CREATE ON SCHEMA public TO breev_schema_owner;
GRANT USAGE ON SCHEMA public TO breev_app;
```

The passwords are local development values. If you change them, change both database URLs in every `.env` file too.

The API applies migrations on startup. It then provisions the configured Main device and starts pg-boss in PostgreSQL.

## Configure the environment

Breev keeps one common file and one file beside each app:

| File | Used by |
| --- | --- |
| `.env` | Common local configuration and root commands |
| `apps/local-api/.env` | Direct local API commands |
| `apps/desktop/.env` | Direct desktop commands |

Copy the templates on a new clone:

```bash
cp .env.example .env
cp apps/local-api/.env.example apps/local-api/.env
cp apps/desktop/.env.example apps/desktop/.env
```

The files are ignored by Git. The launcher reads the root file and then the app file. Shared values must match, so there is no silent app-specific override.

### Generate the Main device values

Run this command once:

```bash
node -e "
const crypto = require('node:crypto');
const bytes = crypto.randomBytes(16);
bytes.writeUIntBE(Date.now(), 0, 6);
bytes[6] = (bytes[6] & 0x0f) | 0x70;
bytes[8] = (bytes[8] & 0x3f) | 0x80;
const hex = bytes.toString('hex');
const id = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
console.log('BREEV_MAIN_DEVICE_ID=' + id);
console.log('BREEV_MAIN_DEVICE_SECRET=' + crypto.randomBytes(32).toString('base64url'));
console.log('BREEV_MAIN_DEVICE_SESSION=' + crypto.randomBytes(32).toString('base64url'));
"
```

Copy the same three generated values into all three `.env` files. Do not regenerate them after the API has initialized the database. The database binds the device ID to its first secret.

The root file should contain:

```dotenv
API_HOST=127.0.0.1
API_PORT=31310
DATABASE_URL=postgresql://breev_app:app_secret_password@127.0.0.1:5432/breev_local
DATABASE_MIGRATION_URL=postgresql://breev_schema_owner:migrator_secret_password@127.0.0.1:5432/breev_local
BREEV_MAIN_DEVICE_ID=<generated UUIDv7>
BREEV_MAIN_DEVICE_SECRET=<generated 32-byte base64url secret>
BREEV_MAIN_DEVICE_SESSION=<generated 32-byte base64url session>
BREEV_LOCAL_API_URL=http://127.0.0.1:31310
```

Use the matching subset from each `.env.example` for the app files.

### Validate the files

Run:

```bash
pnpm env:check
```

The check validates required keys, loopback URLs, database roles, UUIDv7 format, 32-byte secrets, and agreement between files. It never prints secret values.

## Start the application

From the repository root:

```bash
pnpm dev
```

`pnpm dev` runs `pnpm start:local`. It builds contracts, the API, and the desktop app, then starts both app processes through Turborepo. Electron retries the health check when it opens before PostgreSQL finishes its first startup.

A working window shows:

- The full Breev stylesheet, not plain browser HTML
- `Ready` in the connection card
- Local API version `3`
- Schema version `2`
- The pharmacy setup form on a new database, or the login form after setup

Keep the terminal open. Press `Ctrl+C` to stop the API and Electron together.

### Why the package-level Vite command looks broken

Do not use this command for feature testing:

```bash
pnpm --filter @breev/desktop dev
```

Vite HMR injects CSS through inline `<style>` elements. Breev's strict Content Security Policy blocks inline styles. The Vite page also runs at `http://localhost:5173`, while the API accepts the packaged renderer origin `breev://app`. The root `pnpm dev` command uses the built renderer and keeps both security rules intact.

## Test the current features by hand

The current user-facing slice covers identity, access, and the licence status and capability surface. Inventory, purchasing, sales, accounting, patients, and cloud screens are not implemented yet.

On a new database:

1. Confirm the connection card says `Ready`.
2. Click `Verify Main device` and confirm its counter increases.
3. Switch between Arabic and English. Check that direction changes between RTL and LTR.
4. Switch between light and dark themes.
5. Create the pharmacy and owner. Usernames need 3 to 64 characters. Passwords need 15 to 128 characters. There are no default credentials.
6. Log out, try a wrong password, then log in with the owner account.
7. Enable attendance in settings. Check in, check out, and confirm the displayed status changes after each action.
8. Add a user. The app must ask for the current owner's password before it opens the form.
9. Lock and reactivate that user. Each change must require a new step-up check.
10. Change a role's permissions. Log in as a user with that role and confirm hidden administration sections and permission denials match the grants.
11. Confirm the licence status card reads `Free Core` and that `Available functions` lists only Free Core functions. Paid functions must be absent, never shown as disabled buttons. Signed test licences live in the licensing tests; there is no issuer yet, so pasting an unsigned document must be refused as an invalid licence without disturbing any Free Core screen or data.

Use disposable local data for destructive checks. The one-time setup and user actions persist in PostgreSQL across app restarts.

## Run automated checks

```bash
pnpm test:unit
pnpm test:integration
pnpm test:browser
pnpm test:smoke
```

- Unit tests cover domain helpers, security policies, contracts, and static module boundaries.
- Integration tests start PostgreSQL with Testcontainers and exercise migrations, database role separation, security, jobs, PKI, identity, and licensing flows.
- Browser tests cover the Arabic and English UI, themes, accessibility, startup states, identity administration, attendance, and entitlement feature hiding.
- `pnpm check:licence-artifact` inspects the built artifacts and fails if any private or shared licence-signing material reaches them. `pnpm verify` runs it after the build.
- Smoke tests package Electron and exercise the real protocol, preload boundary, CSP, navigation blocks, device proof, API, and PostgreSQL.

Run the complete repository gate with:

```bash
pnpm verify
```

Docker must be running for integration, browser, and smoke tests.

## Troubleshooting

### Port 31310 is already in use

Only one local API should use the configured port. Return to the terminal running Breev and press `Ctrl+C`, then run `pnpm dev` again.

On Linux, inspect the listener with:

```bash
ss -ltnp '( sport = :31310 )'
```

### The window says Main unavailable

Run these checks:

```bash
pnpm env:check
curl -i http://127.0.0.1:31310/health
```

If health works but the package-level Vite window still says `Main unavailable`, close it and use the root `pnpm dev` command. If health fails, read the API error in the terminal that launched Breev.

### The window has no styling

You launched Vite HMR directly. Close that window and run `pnpm dev` from the repository root.

### PostgreSQL cannot start

Check the container and its logs:

```bash
docker ps -a --filter name=breev-postgres
docker logs breev-postgres
```

### Database role separation fails

`DATABASE_URL` must use `breev_app`. `DATABASE_MIGRATION_URL` must use `breev_schema_owner`. The application role cannot be a superuser and cannot have `CREATE` on the `public` schema.

### Testcontainers cannot connect

Confirm Docker is running and available without `sudo`:

```bash
docker ps
```
