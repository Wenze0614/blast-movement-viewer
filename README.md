# Blast Movement Viewer

A concept prototype exploring blast movement visualisation: the front end and API around a
(stand-in) movement engine. A synthetic gold bench is blasted with a heuristic movement model, and
ore loss and dilution are compared for the original and the movement-adjusted dig lines.

> 🚧 Work in progress: Stage 0 (scaffold and contracts).

## What this is not

- **Not physics.** Movement comes from a deliberately simple heuristic, not a blast simulation.
- **Not calibrated** against any mine, and all data is **synthetic**.
- **Not affiliated** with any company or product.

## Run locally

Requires Node 22+.

```sh
npm install
npm run dev          # http://localhost:3000
npm test             # vitest
npm run lint && npm run typecheck && npm run build
```

Design notes: [docs/02-plan.md](docs/02-plan.md) · [docs/03-engine-architecture.md](docs/03-engine-architecture.md)

---

Wenze Zhang · [GitHub](https://github.com/Wenze0614)
