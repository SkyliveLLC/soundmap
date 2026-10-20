import { useAuthActions } from '@convex-dev/auth/react';
import { useConvexAuth, useMutation } from 'convex/react';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';

import { api } from '../../convex/_generated/api';
import { asRateLimited, type Measurement, type RateLimited } from '@/lib/measurement';
import { dequeue, listQueued } from '@/lib/outbox';

const SIGN_IN_RETRY_MS = 10_000;
// The server's wait frees a single slot. Waiting at least this long lets a backlog through in a few rounds
// instead of one round per freed slot.
const MIN_RATE_LIMIT_RETRY_MS = 60_000;

/** Keeps this install signed in to its anonymous user and uploads readings left in the outbox. Mount once. */
export function useSync() {
  const db = useSQLiteContext();
  const upload = useUpload();
  const { signIn } = useAuthActions();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const [signInAttempt, setSignInAttempt] = useState(0);
  const [uploadAttempt, setUploadAttempt] = useState(0);

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

  // Readings queued in an earlier run, before the sign-in finished, or held back by the rate limit.
  useEffect(() => {
    if (!isAuthenticated) return;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    listQueued(db)
      .then((queued) => Promise.all(queued.map((measurement) => upload(measurement).catch(() => null))))
      .then((answers) => {
        const waits = answers.flatMap((limited) => (limited ? [limited.retryAfterMs] : []));
        if (stopped || waits.length === 0) return;
        retry = setTimeout(() => setUploadAttempt((attempt) => attempt + 1), Math.max(MIN_RATE_LIMIT_RETRY_MS, ...waits));
      });
    return () => {
      stopped = true;
      clearTimeout(retry);
    };
  }, [isAuthenticated, db, upload, uploadAttempt]);
}

/**
 * Sends one queued reading. Convex holds the call while offline and sends it on reconnect, so it settles
 * only once the server answered. Any answer takes the reading out of the outbox except the rate limit:
 * then the reading stays queued and this resolves to the refusal, for the sync to retry. Needs a signed-in user.
 */
export function useUpload() {
  const db = useSQLiteContext();
  const add = useMutation(api.measurements.add);
  return useCallback(
    async (measurement: Measurement): Promise<RateLimited | null> => {
      try {
        await add(measurement);
      } catch (error) {
        const limited = asRateLimited(error);
        if (limited) return limited;
        console.warn('[sync] server refused a measurement', error);
        await dequeue(db, measurement.clientId);
        throw error;
      }
      await dequeue(db, measurement.clientId);
      return null;
    },
    [db, add],
  );
}
