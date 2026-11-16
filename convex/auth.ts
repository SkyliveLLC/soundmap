import { Anonymous } from '@convex-dev/auth/providers/Anonymous';
import { convexAuth } from '@convex-dev/auth/server';

// An anonymous user can't sign back in to the same id, so its session must outlive the phone. Otherwise, after the
// default 30 days, the phone becomes a new user and "Delete my readings" no longer reaches its older readings.
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60_000;

// Anonymous only: each install gets a hidden user so uploads can be deduplicated, without an account screen.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Anonymous],
  session: { totalDurationMs: TEN_YEARS_MS, inactiveDurationMs: TEN_YEARS_MS },
});
