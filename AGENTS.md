# Repository Guidelines

## Project Structure & Module Organization

Application code lives in `src/`. `src/index.ts` loads configuration, creates the agent, and prints events. Agent composition belongs in `src/agent/`: keep model and tool registration in `ops-agent.ts` and behavioral instructions in `system-prompt.ts`. Tool implementations live in `src/tools/`, with one tool per kebab-case file such as `search-sop.ts`. Retrieval contracts belong in `src/rag/`. Generated JavaScript in `dist/` must not be edited or committed. There is no test or asset directory yet; add tests under `src/**/*.test.ts` or introduce `tests/` consistently.

## Build, Test, and Development Commands

- `npm ci`: install the exact dependency versions recorded in `package-lock.json`.
- `npm start -- "GPU 报错 Xid 79"`: run the TypeScript CLI with a prompt.
- `npm run typecheck`: check TypeScript without emitting files.
- `npm test`: run the current validation suite; currently delegates to type checking only.
- `npm run build`: compile `src/` into `dist/`.
- `node dist/index.js "prompt"`: run the compiled application.

Run `npm test` and `npm run build` before submitting changes.

## Coding Style & Naming Conventions

Use TypeScript with strict typing, ES modules, two-space indentation, semicolons, and double quotes. Use `camelCase` for variables/functions, `PascalCase` for types, and `UPPER_SNAKE_CASE` for exported constants. Name files in kebab case. Include `.js` extensions in relative imports because the project uses `NodeNext`. No formatter or linter is configured; match surrounding code.

## Testing Guidelines

No unit-test framework or coverage threshold is configured yet. Every change must pass type checking and build validation. Tool changes should additionally verify the tool name, arguments, call count, `isError` status, returned evidence, and final answer. Never treat plausible model prose as proof that a tool executed. Avoid paid API calls in the default `npm test` command.

## Commit & Pull Request Guidelines

Existing commits use short, imperative summaries such as `Add SOP search tool`. Follow that pattern and keep commits focused. Pull requests should describe behavior changes, list validation commands, link relevant issues, and include representative CLI output for Agent or tool changes.

## Security & Agent Boundaries

Store secrets only in `.env`; commit `.env.example` with placeholders. Never log API keys. Keep inspection tools read-only by default, register only implemented tools, and clearly label mock data. Changes that execute remediation actions require explicit authorization, bounded inputs, and audit-friendly results.
