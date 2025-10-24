# Repository Guidelines

## Project Structure & Module Organization
- `src/` hosts the TypeScript modules: `live.ts` handles real-time execution, `backtest.ts` replays CSV candles, `strategy.ts` emits RSI signals, `risk.ts` sizes trades, and `config.ts` maps environment variables.
- `dist/` stores the JavaScript compiled by `pnpm build`; avoid editing it directly.
- Keep CSV fixtures under `data/` (git-ignored) and manage secrets in `.env` copied from `.env.example`.

## Build, Test, and Development Commands
- `pnpm install` (or `npm install`) refreshes dependencies.
- `pnpm dev:backtest ./data/your_file.csv` executes the TypeScript backtest with `ts-node` and `.env` loading.
- `pnpm dev:live` boots the live trader in dry-run or sandbox mode.
- `pnpm build` compiles to `dist/`; pair it with `pnpm start:backtest` or `pnpm start:live` when testing the built output.

## Coding Style & Naming Conventions
- Stick to ES module syntax with named exports and `import type` for annotations.
- Use two-space indentation and lowercase file names that describe their module (`risk.ts`, `exchange.ts`).
- Apply `camelCase` to variables/functions, UPPER_SNAKE_CASE to config-driven constants, and `PascalCase` to types or classes.
- Keep logs brief and tagged (`[GUARD]`, `[SKIP]`, `[COOLDOWN]`) for quick scanning.

## Testing Guidelines
- There is no standalone test harness; treat `pnpm dev:backtest` as the regression smoke test and share representative CSV samples when requesting reviews.
- For new analytics, add pure helpers in `src/strategy.ts` or `src/indicators.ts` and validate them through focused backtest windows.
- Before opening a PR, smoke-test both dev and built entry points if behaviour changes.

## Commit & Pull Request Guidelines
- With no prior history, adopt concise Conventional Commit prefixes (`feat:`, `fix:`, `refactor:`) and an imperative summary.
- Keep each PR scoped, document config expectations, and attach console excerpts from backtest or live dry-run runs.
- Link issues when available, flag trading risks, and double-check that secrets stay out of the diff.

## Security & Configuration Notes
- Never commit `.env` or API keys. Set `USE_SANDBOX=true` while developing, and document any new environment variables in `config.ts` and `.env.example`.
- Validate exchange precision and risk limits after changes by watching the logged brackets in `dev:live` before deploying real funds.
