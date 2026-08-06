# 01 — Foundation runtime seam

**What to build:** A secure, reproducible Breev foundation that starts the desktop application and local API, exposes a usable health/readiness path, supports Arabic/English direction and offline/disabled states, and provides the shared configuration, logging, validation, audit, and test seams needed by later vertical slices.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A clean installation can start the Electron shell and local API without internet access.
- [ ] The renderer uses a narrow typed desktop bridge and local HTTP application contract; it has no direct database, filesystem, or Node.js access.
- [ ] Health, readiness, configuration validation, redacted logging, correlation, and normalized error behavior are observable.
- [ ] The shell supports Arabic/English, RTL/LTR, light/dark, keyboard focus, and accessible offline/disabled/error states.
- [ ] The verification harness proves the foundation gates and records no domain schema or business behavior.
