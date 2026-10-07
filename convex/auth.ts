import { Anonymous } from '@convex-dev/auth/providers/Anonymous';
import { convexAuth } from '@convex-dev/auth/server';

// Anonymous only: each install gets a hidden user so uploads can be deduplicated, without an account screen.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({ providers: [Anonymous] });
