import { useQuery_experimental } from 'convex/react';
import { useEffect, useMemo, useState } from 'react';

import { api } from '../../convex/_generated/api';
import { MAX_REGIONS, type Bounds, type CellAggregate, type LngLat } from '@/lib/cells';
import { planWalk, tripArea, type PlanOutcome, type TripArea } from '@/lib/quiet-routes';
import { WALK_TILES, walkTilesReader, type WalkTile } from '@/lib/walk-tiles';

const readWalkTiles = walkTilesReader(WALK_TILES);
/** After the tiles arrive, how long the plan waits for measured blocks before planning on modeled noise alone. */
const MEASURED_GRACE_MS = 2_000;

export type WalkState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  /** A tile read failed. `retry` reads the same trip again. */
  | { kind: 'offline'; retry: () => void }
  | Exclude<TripArea, { kind: 'area' }>
  | PlanOutcome;

type Trip = { key: string; from: LngLat; to: LngLat; bounds: Bounds };
type TileRead = { trip: Trip } & (
  | { kind: 'tiles'; tiles: readonly WalkTile[]; graceOver: boolean }
  | { kind: 'failed' }
);

/**
 * Everything the route card shows for two points. Idle until both exist. The plan is derived from (tiles,
 * measured, from, to), so a measurement that lands mid-view replans. It waits up to MEASURED_GRACE_MS for
 * measured blocks so the first plan is the measured one, and a Convex that never answers, or answers with
 * an error, can't hang it.
 */
export function useWalkPlan(from: LngLat | null, to: LngLat | null): WalkState {
  const area = from && to ? tripArea(from, to) : null;
  const inArea = area?.kind === 'area' ? area : null;
  const regions = inArea && inArea.regions.length <= MAX_REGIONS ? inArea.regions : null;
  const measured = useQuery_experimental({ query: api.measurements.cells, args: regions ? { regions } : 'skip' });

  // A new object only when an end moves, so the tile read and the plan run once per trip whether or not the
  // caller keeps `from` and `to` referentially stable.
  const [trip, setTrip] = useState<Trip | null>(null);
  const next = inArea && from && to ? { key: `${from.join()} ${to.join()}`, from, to, bounds: inArea.bounds } : null;
  const stale = (trip?.key ?? null) !== (next?.key ?? null);
  if (stale) setTrip(next);

  const [read, setRead] = useState<TileRead>();
  // Bumped by `retry`: the same trip reads its tiles again.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!trip) return;
    let current = true;
    let grace: ReturnType<typeof setTimeout> | undefined;
    readWalkTiles(trip.bounds).then(
      (tiles) => {
        if (!current) return;
        setRead({ trip, kind: 'tiles', tiles, graceOver: false });
        grace = setTimeout(() => setRead({ trip, kind: 'tiles', tiles, graceOver: true }), MEASURED_GRACE_MS);
      },
      () => {
        if (current) setRead({ trip, kind: 'failed' });
      },
    );
    return () => {
      current = false;
      clearTimeout(grace);
    };
  }, [trip, attempt]);

  // While `trip` is stale, `measured` already follows the new ends: planning the old trip here would plan it
  // again on modeled noise alone.
  const tiles = !stale && read?.trip === trip && read.kind === 'tiles' ? read : null;
  // Undefined while still worth waiting for. Null plans on modeled noise alone.
  const measuredInput: readonly CellAggregate[] | null | undefined =
    measured.status === 'success'
      ? measured.data
      : measured.status === 'pending' && regions && !tiles?.graceOver
        ? undefined
        : null;
  const tileList = tiles?.tiles;
  const outcome = useMemo(() => {
    if (!trip || !tileList || measuredInput === undefined) return null;
    return timedPlan({ tiles: tileList, measured: measuredInput, from: trip.from, to: trip.to });
  }, [trip, tileList, measuredInput]);

  if (!area) return { kind: 'idle' };
  if (area.kind !== 'area') return area;
  if (read?.trip !== trip) return { kind: 'loading' };
  if (read.kind === 'failed') {
    const retry = () => {
      setRead(undefined);
      setAttempt((count) => count + 1);
    };
    return { kind: 'offline', retry };
  }
  return outcome ?? { kind: 'loading' };
}

/** planWalk, logging its wall time. The result is still pure; the emulator check reads the log line. */
function timedPlan(input: Parameters<typeof planWalk>[0]): PlanOutcome {
  const started = performance.now();
  const planned = planWalk(input);
  console.log(`planWalk ${planned.kind} in ${Math.round(performance.now() - started)} ms (${input.tiles.length} tiles)`);
  return planned;
}
