# Layered Architecture Overview

This project follows a four-layer structure that cleanly separates concerns and keeps trading logic portable across delivery mechanisms.

## Domain Layer (`packages/domain`)
- Owns pure business logic: indicators, signal generation, and risk utilities.
- Operates on plain data structures defined in `types.ts`.
- Exposes composable helpers (`rsiReversionSignals`, `sizeByRisk`, `computeBracket`, etc.) that take their configuration explicitly so no global config leaks into the core rules.
- Contains no side effects, I/O, or environment lookups; this makes it safe to reuse in the bot, web UI, or future services.

## Application Layer (`apps/bot/src/application`)
- Coordinates use cases such as the live trading loop and backtests.
- Consumes the domain helpers plus injected configuration/runtime overrides.
- Handles sequencing, telemetry, and command processing while delegating technical concerns to infrastructure adapters.

## Infrastructure Layer (`apps/bot/src/infrastructure`)
- Provides adapters for exchanges, storage, telemetry, and configuration.
- Should stay free of business decisions, focusing on interacting with external systems.

- Presents functionality to users (Next.js APIs/pages and CLI scripts such as `apps/bot/src/interface/live.ts`).
- Presents functionality to users (Next.js APIs/pages and CLI scripts).
- Maps user requests onto application services and renders data for clients.

## Next Steps
- Continue migrating remaining bot modules into explicit `application` and `infrastructure` folders.
- Adopt dependency rules (e.g. ESLint `import/no-restricted-paths`) so domain never imports infrastructure code.
- Share domain types with the web app when exposing analytics to keep DTOs aligned.
