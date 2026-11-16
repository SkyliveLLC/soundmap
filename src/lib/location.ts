import { Accuracy, getCurrentPositionAsync, getLastKnownPositionAsync, type LocationObject } from 'expo-location';

// Indoors, where most measurements happen, a fresh fix can take long or never come.
const FIX_TIMEOUT_MS = 15_000;
// A fallback fix must be recent and close enough to still be the block you're on.
const RECENT_FIX = { maxAge: 2 * 60_000, requiredAccuracy: 150 };

/**
 * Where the phone is now: a fresh fix, or a recent one when no fresh fix comes within FIX_TIMEOUT_MS.
 * Null when neither exists. Needs foreground location permission.
 */
export async function currentPosition(accuracy: Accuracy = Accuracy.High): Promise<LocationObject | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const fresh = await Promise.race([
    getCurrentPositionAsync({ accuracy }).catch(() => null),
    new Promise<null>((resolve) => (timeout = setTimeout(() => resolve(null), FIX_TIMEOUT_MS))),
  ]);
  clearTimeout(timeout);
  return fresh ?? (await getLastKnownPositionAsync(RECENT_FIX).catch(() => null));
}
