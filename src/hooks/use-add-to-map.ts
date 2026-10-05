import { Accuracy, getCurrentPositionAsync, requestForegroundPermissionsAsync } from 'expo-location';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';

import type { NoiseSummary } from '@/lib/acoustics';
import { cellAt } from '@/lib/cells';
import { insertMeasurement } from '@/lib/measurement-store';

export type AddToMapState =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'saved'; cell: string }
  | { status: 'denied' }
  | { status: 'failed' };

/** Saves one finished measurement to the map, at the H3 cell around the current position. */
export function useAddToMap(summary: NoiseSummary) {
  const db = useSQLiteContext();
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
      await insertMeasurement(db, { at: Date.now(), cell, summary });
      setState({ status: 'saved', cell });
    } catch (error) {
      console.warn('[use-add-to-map]', error);
      setState({ status: 'failed' });
    }
  }

  return { state, add };
}
