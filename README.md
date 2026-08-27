# Breev

Breev is an offline-first pharmacy operating system for community and retail pharmacies in Iraq and the Kurdistan region. The Main Pharmacy Computer owns the local API and PostgreSQL database. The Electron app is a client of that local authority.

## What you can test now

The current application implements the first local identity and security slice:

- Main device binding and API health checks
- One-time pharmacy and owner setup
- Login, logout, session expiry, and session revocation
- Eight pharmacy roles with configurable permissions
- User creation, locking, and reactivation behind password step-up
- Optional manual attendance with check-in and check-out
- Arabic RTL and English LTR layouts
- Light and dark themes

Inventory, purchasing, sales, accounting, patients, licensing, and cloud features are still planned. The files under [`docs/`](docs/README.md) define those requirements, but they are not testable screens yet.

## Run Breev

Use Node.js `24.19.0`, pnpm `11.23.0`, and a running PostgreSQL database. From the repository root:

```bash
pnpm install
pnpm env:check
pnpm dev
```

`pnpm dev` validates the three local environment files, builds the workspaces, starts the local API, and opens Electron with the built renderer. Keep that terminal open. Press `Ctrl+C` there to stop both processes.

The built renderer is deliberate. Vite's HMR mode injects inline styles, while Breev's Content Security Policy forbids them. The root command loads the complete stylesheet through `breev://app` and preserves the same origin rules used by the packaged application.

For first-time PostgreSQL and environment setup, follow [`docs/running-locally.md`](docs/running-locally.md).

## Check the code

```bash
pnpm test:unit
pnpm test:integration
pnpm test:browser
pnpm test:smoke
```

Run `pnpm verify` for linting, formatting, type checks, builds, and every test suite. The integration, browser, and smoke suites require Docker.

## Repository map

| Path                 | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `apps/desktop`       | Electron main process, preload bridge, and React renderer      |
| `apps/local-api`     | NestJS local authority and PostgreSQL migrations               |
| `packages/contracts` | Runtime-validated preload and REST contracts                   |
| `docs`               | Product, domain, workflow, architecture, and quality baseline  |
| `tooling`            | Boundary checks, local setup checks, and Windows proof tooling |

Start with [`docs/README.md`](docs/README.md) before changing product behavior.
