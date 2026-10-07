import { useConvex, useConvexAuth } from 'convex/react';
import { Accuracy, getCurrentPositionAsync, requestForegroundPermissionsAsync } from 'expo-location';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';

import { useUpload } from '@/hooks/use-sync';
import type { NoiseSummary } from '@/lib/acoustics';
import { cellAt } from '@/lib/cells';
import { enqueue } from '@/lib/outbox';

export type AddToMapState =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'saved'; cell: string }
  /** Waiting in the outbox for a connection. It reaches the map on its own. */
  | { status: 'queued' }
  | { status: 'denied' }
  | { status: 'failed' };

/** Adds one finished measurement to the shared map, at the H3 cell around the current position. */
export function useAddToMap(summary: NoiseSummary) {
  const db = useSQLiteContext();
  const convex = useConvex();
  const upload = useUpload();
  const { isAuthenticated } = useConvexAuth();
  const [state, setState] = useState<AddToMapState>({ status: 'idle' });

  async function add() {
    setState({ status: 'locating' });
    try {
      const { granted } = await requestForegroundPermissionsAsync();
      if (!granted) {
        setState({ status: 'denied' });
        return;
      }
      const { coords } = await getCurrentPositionAsync({ accuracy: Accuracy.High });
      const cell = cellAt(coords.latitude, coords.longitude);
      const measurement = await enqueue(db, { at: Date.now(), cell, summary });
      // Without a user yet, the sync uploads it after sign-in. Offline, Convex sends it on reconnect.
      if (!isAuthenticated || !convex.connectionState().isWebSocketConnected) {
        if (isAuthenticated) upload(measurement).catch(() => {});
        setState({ status: 'queued' });
        return;
      }
      await upload(measurement);
      setState({ status: 'saved', cell });
    } catch (error) {
      console.warn('[use-add-to-map]', error);
      setState({ status: 'failed' });
    }
  }

  return { state, add };
}
