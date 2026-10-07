import type { SQLiteDatabase } from 'expo-sqlite';
import { isValidCell } from 'h3-js';

import type { NoiseSummary } from './acoustics.ts';
import { UNCALIBRATED_OFFSET_DB } from './calibration.ts';
import type { Measurement } from './measurement.ts';
import { parseVisit } from './venues.ts';

// Readings wait here until the server has them, so one taken offline survives an app restart.
// Rows leave once the server answers, accepted or refused.

/** Passed to SQLiteProvider's onInit. Safe to run on every launch. */
export async function createSchema(db: SQLiteDatabase) {
  await db.execAsync(`
    DROP TABLE IF EXISTS measurements;
    CREATE TABLE IF NOT EXISTS outbox (
      client_id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
      at INTEGER NOT NULL,
      cell TEXT NOT NULL,
      laeq REAL NOT NULL,
      lamax REAL NOT NULL,
      l10 REAL NOT NULL,
      l90 REAL NOT NULL,
      duration_sec REAL NOT NULL
    );
  `);
  const version = (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
  if (version < 1) {
    // Readings queued before calibration were all measured with the placeholder offset, on a model nobody wrote down.
    await db.withTransactionAsync(() =>
      db.execAsync(`
        ALTER TABLE outbox ADD COLUMN model TEXT NOT NULL DEFAULT 'Unknown';
        ALTER TABLE outbox ADD COLUMN offset_db REAL NOT NULL DEFAULT ${UNCALIBRATED_OFFSET_DB};
        ALTER TABLE outbox ADD COLUMN calibration_id TEXT;
        PRAGMA user_version = 1;
      `),
    );
  }
  if (version < 2) {
    // A queued visit is its JSON. Readings queued before venues have none.
    await db.withTransactionAsync(() =>
      db.execAsync(`
        ALTER TABLE outbox ADD COLUMN visit TEXT;
        PRAGMA user_version = 2;
      `),
    );
  }
}

/** Queues a reading and returns it with the clientId the server will deduplicate on. */
export async function enqueue(db: SQLiteDatabase, measurement: Omit<Measurement, 'clientId'>): Promise<Measurement> {
  const { at, cell, summary, calibration, visit } = measurement;
  const row = await db.getFirstAsync<{ client_id: string }>(
    `INSERT INTO outbox (at, cell, laeq, lamax, l10, l90, duration_sec, model, offset_db, calibration_id, visit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING client_id`,
    at,
    cell,
    summary.laeq,
    summary.lamax,
    summary.l10,
    summary.l90,
    summary.durationSec,
    calibration.model,
    calibration.offsetDb,
    calibration.id,
    visit ? JSON.stringify(visit) : null,
  );
  if (!row) throw new Error('outbox insert returned no row');
  return { clientId: row.client_id, ...measurement };
}

export async function listQueued(db: SQLiteDatabase): Promise<Measurement[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM outbox ORDER BY at');
  return rows.flatMap((row) => {
    const measurement = parseRow(row);
    if (!measurement) console.warn('[outbox] skipping unreadable row', row);
    return measurement ? [measurement] : [];
  });
}

export async function dequeue(db: SQLiteDatabase, clientId: string) {
  await db.runAsync('DELETE FROM outbox WHERE client_id = ?', clientId);
}

function parseRow(row: Record<string, unknown>): Measurement | null {
  const { client_id, at, cell, laeq, lamax, l10, l90, duration_sec, model, offset_db, calibration_id, visit } = row;
  if (typeof client_id !== 'string' || typeof cell !== 'string' || !isValidCell(cell)) return null;
  if (
    typeof at !== 'number' ||
    typeof laeq !== 'number' ||
    typeof lamax !== 'number' ||
    typeof l10 !== 'number' ||
    typeof l90 !== 'number' ||
    typeof duration_sec !== 'number' ||
    typeof model !== 'string' ||
    typeof offset_db !== 'number' ||
    (typeof calibration_id !== 'string' && calibration_id !== null)
  ) {
    return null;
  }
  const summary: NoiseSummary = { laeq, lamax, l10, l90, durationSec: duration_sec };
  const calibration = { model, offsetDb: offset_db, id: calibration_id };
  // A visit this version can't read is dropped. The reading still counts for its block.
  const parsedVisit = typeof visit === 'string' ? parseVisit(visit) : null;
  return { clientId: client_id, at, cell, summary, calibration, ...(parsedVisit && { visit: parsedVisit }) };
}
