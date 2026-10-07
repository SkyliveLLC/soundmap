import type { SQLiteDatabase } from 'expo-sqlite';
import { isValidCell } from 'h3-js';

import type { Measurement } from './cells.ts';

/** Passed to SQLiteProvider's onInit. Safe to run on every launch. */
export async function createSchema(db: SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS measurements (
      id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
      at INTEGER NOT NULL,
      cell TEXT NOT NULL,
      laeq REAL NOT NULL,
      lamax REAL NOT NULL,
      l10 REAL NOT NULL,
      l90 REAL NOT NULL,
      duration_sec REAL NOT NULL
    );
  `);
}

export async function insertMeasurement(db: SQLiteDatabase, { at, cell, summary }: Omit<Measurement, 'id'>) {
  await db.runAsync(
    'INSERT INTO measurements (at, cell, laeq, lamax, l10, l90, duration_sec) VALUES (?, ?, ?, ?, ?, ?, ?)',
    at,
    cell,
    summary.laeq,
    summary.lamax,
    summary.l10,
    summary.l90,
    summary.durationSec,
  );
}

export async function listMeasurements(db: SQLiteDatabase): Promise<Measurement[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM measurements ORDER BY at');
  return rows.flatMap((row) => {
    const measurement = parseRow(row);
    if (!measurement) console.warn('[measurement-store] skipping unreadable row', row);
    return measurement ? [measurement] : [];
  });
}

function parseRow({ id, at, cell, laeq, lamax, l10, l90, duration_sec }: Record<string, unknown>): Measurement | null {
  if (typeof id !== 'string' || typeof cell !== 'string' || !isValidCell(cell)) return null;
  if (
    typeof at !== 'number' ||
    typeof laeq !== 'number' ||
    typeof lamax !== 'number' ||
    typeof l10 !== 'number' ||
    typeof l90 !== 'number' ||
    typeof duration_sec !== 'number'
  ) {
    return null;
  }
  return { id, at, cell, summary: { laeq, lamax, l10, l90, durationSec: duration_sec } };
}
