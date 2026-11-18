/** The email confirmation must return to a publicly accessible host page. */
export function hostConfirmationRedirect(origin: string, publicSiteUrl?: string): string {
  const redirect = new URL('/host', publicSiteUrl?.trim() || origin);
  redirect.searchParams.set('confirmed', '1');
  return redirect.toString();
}

/** A signed-in host cannot also occupy a player seat in their own game. */
export function isHostPlayerConflict(error: unknown): boolean {
  return (
    error instanceof Error && error.message === 'Use a separate device or browser profile to play.'
  );
}

export function hostPasswordRecoveryRedirect(origin: string, publicSiteUrl?: string): string {
  return new URL('/host?reset=1', publicSiteUrl?.trim() || origin).toString();
}

/**
 * Choose a public return origin for email confirmation and password recovery.
 * Vercel's canonical production domain wins over preview URLs (including a
 * stale NEXT_PUBLIC_SITE_URL). In local development, use the current origin.
 */
export function publicHostRedirectOrigin(
  requestOrigin: string,
  options: {siteUrl?: string; vercelProductionUrl?: string; isVercel?: boolean} = {},
): string {
  const production = options.vercelProductionUrl?.trim();
  const candidate = production
    ? 'https://' + production
    : options.siteUrl?.trim() || (options.isVercel ? '' : requestOrigin);
  if (!candidate) throw new Error('Configure a public production URL for email redirects.');
  let url: URL;
  try { url = new URL(candidate); }
  catch { throw new Error('Email redirect URL is invalid.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== 'https:' && !(local && url.protocol === 'http:')))
    throw new Error('Email redirects require HTTPS or local development.');
  return url.origin;
}
