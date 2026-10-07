import { useConvex, useConvexAuth } from 'convex/react';
import { Accuracy, getCurrentPositionAsync, requestForegroundPermissionsAsync } from 'expo-location';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState } from 'react';

import { api } from '../../convex/_generated/api';
import { useUpload } from '@/hooks/use-sync';
import { cellAt } from '@/lib/cells';
import type { Measurement } from '@/lib/measurement';
import { enqueue } from '@/lib/outbox';
import type { Venue } from '@/lib/venues';

// Past this the venue question is skipped, so a slow OpenStreetMap never holds up sharing.
const VENUE_SEARCH_TIMEOUT_MS = 6_000;

export type AddToMapState =
  | { status: 'idle' }
  | { status: 'locating' }
  /** Places came back for the block. Sharing waits for `choose`. */
  | { status: 'choosing'; cell: string; venues: Venue[] }
  | { status: 'saving' }
  | { status: 'saved'; cell: string; venue: Venue | null }
  /** Waiting in the outbox for a connection. It reaches the map on its own. */
  | { status: 'queued' }
  | { status: 'denied' }
  | { status: 'failed' };

/**
 * Adds one finished measurement to the shared map, at the H3 cell around the current position.
 * When cafés, libraries or coworking spaces are nearby, it first asks which one the reading was taken in.
 */
export function useAddToMap({ summary, calibration }: Pick<Measurement, 'summary' | 'calibration'>) {
  const db = useSQLiteContext();
  const convex = useConvex();
  const upload = useUpload();
  const { isAuthenticated } = useConvexAuth();
  const [state, setState] = useState<AddToMapState>({ status: 'idle' });
  // When the measurement finished, so time spent answering the venue question doesn't move it to a later hour.
  const [takenAt] = useState(Date.now);
  // Set once a venue is picked, so a second tap before the next render doesn't share the reading twice.
  const chosen = useRef(false);
  const online = () => isAuthenticated && convex.connectionState().isWebSocketConnected;

  async function add() {
    setState({ status: 'locating' });
    chosen.current = false;
    try {
      const { granted } = await requestForegroundPermissionsAsync();
      if (!granted) {
        setState({ status: 'denied' });
        return;
      }
      const { coords } = await getCurrentPositionAsync({ accuracy: Accuracy.High });
      const cell = cellAt(coords.latitude, coords.longitude);
      const venues = online() ? await nearbyVenues(cell) : [];
      if (venues.length > 0) setState({ status: 'choosing', cell, venues });
      else await share(cell, null);
    } catch (error) {
      console.warn('[use-add-to-map]', error);
      setState({ status: 'failed' });
    }
  }

  /** Shares the reading, at `venue` when the person picked one. Only valid while choosing. */
  async function choose(venue: Venue | null) {
    if (state.status !== 'choosing' || chosen.current) return;
    chosen.current = true;
    try {
      await share(state.cell, venue);
    } catch (error) {
      console.warn('[use-add-to-map]', error);
      setState({ status: 'failed' });
    }
  }

  async function share(cell: string, venue: Venue | null) {
    setState({ status: 'saving' });
    // The hour is local, so "quiet at 9 am" means 9 am where the venue is.
    const visit = venue ? { osmId: venue.osmId, hour: new Date(takenAt).getHours() } : undefined;
    const measurement = await enqueue(db, { at: takenAt, cell, summary, calibration, ...(visit && { visit }) });
    // Without a user yet, the sync uploads it after sign-in. Offline, Convex sends it on reconnect.
    if (!online()) {
      if (isAuthenticated) upload(measurement).catch(() => {});
      setState({ status: 'queued' });
      return;
    }
    await upload(measurement);
    setState({ status: 'saved', cell, venue });
  }

  // A failed or slow search means no question, not a failed share.
  async function nearbyVenues(cell: string): Promise<Venue[]> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        convex.action(api.venueSearch.nearby, { cell }),
        new Promise<Venue[]>((resolve) => (timeout = setTimeout(() => resolve([]), VENUE_SEARCH_TIMEOUT_MS))),
      ]);
    } catch (error) {
      console.warn('[use-add-to-map] venue search failed', error);
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  return { state, add, choose };
}
