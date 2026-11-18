# Fortune Live

Fortune Live is a Vercel-ready, colorful multiplayer word puzzle show. One host controls the show from a laptop, between one and five contestants participate from their phones, and a read-only audience display works on a projector.

It is a separate project built from the architectural patterns of the JeopardyAI application. No Jeopardy repository files were changed.

## Features

- Host registration, saved game library, game PIN, archived games and persistent sessions
- Editable six-round puzzles, puzzle preview, JSON import/export, three Bonus Round categories and customizable prize envelopes
- TV-style round starters: last opening Toss-Up/Frenzy winner starts Round 1, then contestants rotate through seat order for Rounds 2 and 3, and the final Triple Toss-Up winner starts Round 4
- Exactly one puzzle per wheel-spinning round and exactly three Triple Toss-Ups; opening Toss-Ups/Frenzy may contain multiple puzzles (up to 12). Imports and game saves enforce these limits.
- Six-digit join codes, QR sharing, anonymous player identities and host-approved recovery
- Live buzzers, host adjudication, server-chosen wheel spins, letter validation and automatic winnings
- Regular, Mystery, Prize, Triple Toss-Up, Final Spin, tie-breaker and Bonus Round gameplay
- Cash separated into unbanked round earnings, secured money and prize value
- Animated standings, host pause/resume, read-only audience links, and results CSV
- Server-timed Final Spin animation that selects a real wheel cash wedge, then announces the cash amount plus $1,000 and starts Speed-Up only after the wheel stops
- Television-style full-width audience display with puzzle transitions, a large synchronized wheel, and animated score counters
- Host-only score corrections for secured or current-round money, with mandatory reasons, private history and score ledger entries; a separate Undo Last Letter action reverses only the most recent letter call without restarting the puzzle

## Run locally

1. Install Node.js 22 or newer and run npm ci.
2. Create a new Supabase project, enable email/password host authentication and anonymous guest sign-in.
3. In the Supabase SQL Editor, run supabase/migrations/001_initial.sql then supabase/migrations/002_recovery_display.sql, in order.
4. Copy .env.example to .env.local and set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, and RATE_LIMIT_SECRET (minimum 32 random characters).
5. Run npm run dev, open http://localhost:3000 and create a host account.
6. Create a game, set the six-digit PIN, start a room and share the displayed join code.

## Deploy on Vercel

Import THIS repository as a Next.js project. Add the same environment variables to Vercel. Supabase persists all gameplay and authoring data. No Vercel cron or custom WebSocket server is required.

### Email confirmation and password recovery (public URL)

Host sign-up uses the same Supabase email-confirmation and password-reset flow as JeopardyAI. **Confirmation links must return to a public production URL, not a protected Vercel preview.**

1. In Vercel, make sure the production domain is available to guests. Under **Project → Settings → Deployment Protection**, use **Standard Protection** (protects previews, not production domains) or your preferred setting that allows public access to the production domain. If **All Deployments** are protected, recipients will still see Vercel's request-access screen.
2. Set `NEXT_PUBLIC_SITE_URL=https://YOUR_PUBLIC_GAME_DOMAIN` in Vercel's environment settings. Alternatively, enable **System Environment Variables** so the server can use `VERCEL_PROJECT_PRODUCTION_URL`; on Vercel this canonical production hostname takes priority over preview URLs. Redeploy after changing settings.
3. In **Supabase → Authentication → URL Configuration**, set **Site URL** to `https://YOUR_PUBLIC_GAME_DOMAIN` and allow the corresponding `/host?confirmed=1` and `/host?reset=1` return URLs. Keep `http://localhost:3000/host**` for local testing if desired.
4. If your Supabase email templates were customized, check that signup and password reset links use `{{ .ConfirmationURL }}` (not `{{ .SiteURL }}`) so Supabase can honor the requested redirect URL.
5. Test with a **freshly sent** confirmation email. Links already sent before the correction can still point to an inaccessible preview; use **Resend confirmation email**.

The app's `/api/auth/redirects` endpoint returns only public redirect URLs, with cache disabled. It refuses to generate Vercel-hosted email links if no public domain can be determined. Local development continues to use its localhost origin.

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
