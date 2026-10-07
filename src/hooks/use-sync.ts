import { useAuthActions } from '@convex-dev/auth/react';
import { useConvexAuth, useMutation } from 'convex/react';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';

import { api } from '../../convex/_generated/api';
import type { Measurement } from '@/lib/measurement';
import { dequeue, listQueued } from '@/lib/outbox';

const SIGN_IN_RETRY_MS = 10_000;

/** Keeps this install signed in to its anonymous user and uploads readings left in the outbox. Mount once. */
export function useSync() {
  const db = useSQLiteContext();
  const upload = useUpload();
  const { signIn } = useAuthActions();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const [signInAttempt, setSignInAttempt] = useState(0);

  // The first launch needs a network to create the anonymous user. Until then readings just queue.
  useEffect(() => {
    if (isLoading || isAuthenticated) return;
    let retry: ReturnType<typeof setTimeout> | undefined;
    signIn('anonymous').catch((error: unknown) => {
      console.warn('[sync] anonymous sign-in failed', error);
      retry = setTimeout(() => setSignInAttempt((attempt) => attempt + 1), SIGN_IN_RETRY_MS);
    });
    return () => clearTimeout(retry);
  }, [isLoading, isAuthenticated, signIn, signInAttempt]);

  // Readings queued in an earlier run, or before the sign-in finished.
  useEffect(() => {
    if (!isAuthenticated) return;
    listQueued(db).then((queued) => queued.forEach((measurement) => upload(measurement).catch(() => {})));
  }, [isAuthenticated, db, upload]);
}

/**
 * Sends one queued reading. Convex holds the call while offline and sends it on reconnect, so it settles
 * only once the server answered, and either answer takes the reading out of the outbox. Needs a signed-in user.
 */
export function useUpload() {
  const db = useSQLiteContext();
  const add = useMutation(api.measurements.add);
  return async (measurement: Measurement) => {
    try {
      await add(measurement);
    } catch (error) {
      console.warn('[sync] server refused a measurement', error);
      throw error;
    } finally {
      await dequeue(db, measurement.clientId);
    }
  };
}
