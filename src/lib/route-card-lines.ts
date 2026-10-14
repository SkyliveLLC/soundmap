import type { WalkState } from '../hooks/use-walk-plan.ts';
import { MAX_TRIP_METERS, WALK_METERS_PER_MINUTE, type QuietPreset, type Route } from './quiet-routes.ts';
import { STREET_NOISE_RELEASE } from './street-noise.ts';

export type RouteCardLines = {
  headline: string;
  badge: string | null;
  detail: string | null;
  loud: string | null;
  note: string | null;
};

const SOURCE = `US DOT ${STREET_NOISE_RELEASE} modeled noise`;

/** Every line the route card shows, as text. Exhaustive over WalkState, so tests pin the copy. */
export function routeCardLines(state: WalkState, preset: QuietPreset): RouteCardLines {
  const only = (headline: string, detail: string | null = null): RouteCardLines => ({
    headline,
    badge: null,
    detail,
    loud: null,
    note: null,
  });
  switch (state.kind) {
    case 'idle':
      return { ...only('Walk here'), note: 'or long-press where to start' };
    case 'loading':
      return only('Finding a quieter way…');
    case 'offline':
      return only("Can't load the walking map. Check your connection.");
    case 'too-far':
      return only(
        `Quiet routes are for walks up to ${MAX_TRIP_METERS / 1000} km.`,
        `These points are ${kilometers(state.meters)} apart.`,
      );
    case 'too-close':
      return only('Pick an end farther from the start.');
    case 'no-walking-data':
      return only('No walking map here yet.');
    case 'off-path':
      return only(`Pick ${state.end === 'from' ? 'a start' : 'an end'} closer to a street or path.`);
    case 'no-path':
      return only('No walking route joins these points.');
    case 'planned': {
      const { shortest, choices, measured } = state.plan;
      const choice = choices.find((candidate) => candidate.preset === preset) ?? choices[0];
      if (!choice) {
        return {
          ...only(
            'The shortest way is already the quiet one',
            `${trip(shortest)} · ${Math.round(shortest.laeq)} dBA along the way`,
          ),
          note: sourceNote(shortest, measured),
        };
      }
      const loudMinutes = Math.round(choice.loudMetersAvoided / WALK_METERS_PER_MINUTE);
      return {
        headline: `${choice.quieterDb} dB quieter`,
        badge: choice.noticeable ? 'Noticeably quieter' : null,
        detail: `${extra(choice.extraMeters)} · ${trip(choice.route)}`,
        loud: loudMinutes >= 1 ? `${loudMinutes} min less on loud blocks` : null,
        note: sourceNote(choice.route, measured),
      };
    }
  }
}

function sourceNote(route: Route, measured: 'included' | 'unavailable'): string {
  if (measured === 'unavailable') return `${SOURCE} · modeled only`;
  const blocks = new Set(route.pieces.flatMap(({ cell, level }) => (level.kind === 'measured' ? [cell] : []))).size;
  if (blocks === 0) return SOURCE;
  return `${SOURCE} · measured on ${blocks} ${blocks === 1 ? 'block' : 'blocks'}`;
}

function trip({ meters }: Route): string {
  return `${kilometers(meters)}, ${minutes(meters)} min`;
}

// Steps cost extra, so a quiet route can be shorter in meters than the "shortest" one.
function extra(meters: number): string {
  const rounded = Math.round(meters / 10) * 10;
  if (rounded === 0) return 'Same distance';
  if (rounded < 0) return `${-rounded} m shorter`;
  const longer = Math.round(meters / WALK_METERS_PER_MINUTE);
  return longer >= 1 ? `+${rounded} m, about ${longer} min longer` : `+${rounded} m`;
}

function kilometers(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

function minutes(meters: number): number {
  return Math.max(1, Math.round(meters / WALK_METERS_PER_MINUTE));
}
