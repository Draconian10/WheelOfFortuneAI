# Fortune Live

Fortune Live is a Vercel-ready, colorful multiplayer word puzzle show. One host controls the show from a laptop, between one and five contestants participate from their phones, and a read-only audience display works on a projector.

It is a separate project built from the architectural patterns of the JeopardyAI application. No Jeopardy repository files were changed.

## Features

- Host registration, saved game library, game PIN, archived games and persistent sessions
- Editable six-round puzzles, puzzle preview, JSON import/export, three Bonus Round categories and customizable prize envelopes
- Six-digit join codes, QR sharing, anonymous player identities and host-approved recovery
- Live buzzers, host adjudication, server-chosen wheel spins, letter validation and automatic winnings
- Regular, Mystery, Prize, Triple Toss-Up, Final Spin, tie-breaker and Bonus Round gameplay
- Cash separated into unbanked round earnings, secured money and prize value
- Animated standings, host pause/resume, read-only audience links, and results CSV

## Run locally

1. Install Node.js 22 or newer and run npm ci.
2. Create a new Supabase project, enable email/password host authentication and anonymous guest sign-in.
3. In the Supabase SQL Editor, run supabase/migrations/001_initial.sql then supabase/migrations/002_recovery_display.sql, in order.
4. Copy .env.example to .env.local and set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, and RATE_LIMIT_SECRET (minimum 32 random characters).
5. Run npm run dev, open http://localhost:3000 and create a host account.
6. Create a game, set the six-digit PIN, start a room and share the displayed join code.

## Deploy on Vercel

Import THIS repository as a Next.js project. Add the same environment variables to Vercel. Supabase persists all gameplay and authoring data. No Vercel cron or custom WebSocket server is required.

NEVER expose the SUPABASE_SERVICE_ROLE_KEY to a browser. All client requests use short-lived Supabase JWTs, validated by the server. Broadcasts contain only version notifications, and the role-specific snapshot API omits unrevealed solutions.

## Test

- npm run typecheck
- npm test
- npm run build
- npm run test:e2e

The lobby supports 1–5 active contestants (not including the host or audience). A host can start immediately after the first contestant joins; additional players can join until the game starts or five seats are occupied. Solo play rotates back to the same contestant and multiplayer turn order follows the joined seats. Rehearse with the real laptops, phones and projector before a live event, especially simultaneous buzzes, Wi-Fi disconnections, prize scoring and host takeover.

## Wheel art

The wheel is a scalable vector recreation of the uploaded 24-segment reference, preserving the bright palette and black/green/white hub and supporting round-specific special wedges. It is not a pixel-for-pixel raster copy of licensed television assets.

This is an independent fan-made game, not endorsed by or affiliated with the television program.
