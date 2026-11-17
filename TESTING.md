# Testing Fortune Live

The CI workflow mirrors the layering in **JeopardyAI**. Every pull request and push
to `main` runs the following gates, in order:

| Gate | Purpose | Environment |
|---|---|---|
| `npm run typecheck` | Compile all TypeScript | No credentials |
| `npm test` | Rules, SQL permissions, recovery, UI contracts | Isolated local tests |
| `npm run test:stress` | Full 5-contestant show (opening, six rounds, bonus), concurrent buzzer claims, 1–5-seat edge matrix | Real engine + both actual migrations in PGlite |
| `npm run build` | Production Next.js compilation | CI |
| `npm run test:e2e` | Responsive host/player/audience pages on desktop + mobile, no horizontal overflow | Local Next.js with no production accounts |
| `npm run test:live:fixture` | Full browser journey, 1 host + 5 independent mobile profiles, native audience tab, join, buzzing, judging, pause/reconnect, six rounds, bonus and results | Local Next.js + emulated Supabase Auth/API/Realtime; real game engine |

## Reproduce locally

```sh
npm ci
npm run typecheck
npm test
npm run test:stress
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:live:fixture
```

The stress suite writes `ci-artifacts/stress/progress.json` as it runs and
`ci-artifacts/stress/results.json` at completion. CI uploads the report even when another
check fails. Browser failures attach Playwright screenshots/traces to GitHub Actions.

## What is, and is not, load-tested

Stress exercises actual game rules, atomic SQL buzz claiming, version conflicts and all
six rounds in a real PostgreSQL-compatible local PGlite instance. Auth identities,
Supabase API transport, WebSockets and Vercel infrastructure are **not** stressed:
these tests are deterministic CI regression/capacity simulations, *not* a claim that
production Supabase supports any throughput or a real-world 5-player network SLA.

The offline browser scenario exercises separate browser storage and full UI actions,
but network requests are intercepted into a local fixture using the real engine.
Never supply production credentials to this fixture or point it at the production app.

Some high-risk items (external recovery email, actual OAuth, CDN/Vercel outages,
browser-specific mobile Safari behavior) require additional staged/manual validation.
No automated suite can guarantee every possible state or edge case. New regressions
should always gain a targeted engine/SQL and, where appropriate, UI test.
