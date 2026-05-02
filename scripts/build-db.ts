#!/usr/bin/env tsx
/**
 * Database builder for Norwegian Preparatory Works MCP server.
 *
 * Builds the SQLite database from seed JSON files in data/seed/.
 * Usage: npm run build:db
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEED_DIR = path.resolve(__dirname, '../data/seed');
const DB_PATH = path.resolve(__dirname, '../data/database.db');

interface PrepWorkSeed {
  id: string;
  canonical_ref: string;
  title: string;
  doc_type: 'innstilling' | 'proposisjon';
  session: string;
  tilgjengelig_dato: string | null;
  komite: string | null;
  submitted_by: string | null;
  subject_refs: string | null;
  summary: string | null;
  body: string | null;
  source_url: string;
  regjeringen_url: string | null;
}

async function main(): Promise<void> {
  console.log(`Building database at: ${DB_PATH}`);
  console.log(`Reading seeds from: ${SEED_DIR}`);

  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
    console.log('Removed existing database.');
  }

  const db = new Database(DB_PATH);

  db.exec(`
    -- Use DELETE journal mode (not WAL) for compatibility with @ansvar/mcp-sqlite (WASM SQLite).
    -- WASM SQLite cannot open WAL-mode databases reliably on overlay filesystems.
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS preparatory_works (
      id               TEXT PRIMARY KEY,
      canonical_ref    TEXT NOT NULL,
      title            TEXT NOT NULL,
      doc_type         TEXT NOT NULL CHECK(doc_type IN ('innstilling', 'proposisjon')),
      session          TEXT NOT NULL,
      tilgjengelig_dato TEXT,
      komite           TEXT,
      submitted_by     TEXT,
      subject_refs     TEXT,
      summary          TEXT,
      body             TEXT,
      source_url       TEXT NOT NULL,
      regjeringen_url  TEXT,
      created_at       TEXT DEFAULT (datetime('now'))
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS pw_fts USING fts5(
      title,
      summary,
      body,
      canonical_ref,
      komite,
      tokenize = "unicode61 remove_diacritics 1",
      content = preparatory_works,
      content_rowid = rowid
    );

    CREATE TABLE IF NOT EXISTS db_metadata (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  if (!fs.existsSync(SEED_DIR)) {
    fs.mkdirSync(SEED_DIR, { recursive: true });
    console.log('Created seed directory (empty). Run npm run ingest first.');
    db.close();
    return;
  }

  const seedFiles = fs.readdirSync(SEED_DIR).filter(f => f.endsWith('.json'));
  console.log(`Found ${seedFiles.length} seed files.`);

  const insertDoc = db.prepare(`
    INSERT OR IGNORE INTO preparatory_works (
      id, canonical_ref, title, doc_type, session,
      tilgjengelig_dato, komite, submitted_by, subject_refs,
      summary, body, source_url, regjeringen_url
    ) VALUES (
      @id, @canonical_ref, @title, @doc_type, @session,
      @tilgjengelig_dato, @komite, @submitted_by, @subject_refs,
      @summary, @body, @source_url, @regjeringen_url
    )
  `);

  let inserted = 0;
  let skipped = 0;

  const insertMany = db.transaction((seeds: PrepWorkSeed[]) => {
    for (const seed of seeds) {
      const result = insertDoc.run({
        id: seed.id,
        canonical_ref: seed.canonical_ref,
        title: seed.title,
        doc_type: seed.doc_type,
        session: seed.session,
        tilgjengelig_dato: seed.tilgjengelig_dato ?? null,
        komite: seed.komite ?? null,
        submitted_by: seed.submitted_by ?? null,
        subject_refs: seed.subject_refs ?? null,
        summary: seed.summary ?? null,
        body: seed.body ?? null,
        source_url: seed.source_url,
        regjeringen_url: seed.regjeringen_url ?? null,
      });
      if (result.changes > 0) { inserted++; } else { skipped++; }
    }
  });

  const BATCH_SIZE = 500;
  let batch: PrepWorkSeed[] = [];

  for (const file of seedFiles) {
    const filePath = path.join(SEED_DIR, file);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const seed = JSON.parse(raw) as PrepWorkSeed;
      batch.push(seed);
      if (batch.length >= BATCH_SIZE) {
        insertMany(batch);
        batch = [];
      }
    } catch (err) {
      console.error(`  SKIP ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (batch.length > 0) { insertMany(batch); }

  console.log('Rebuilding FTS5 index...');
  db.exec(`INSERT INTO pw_fts(pw_fts) VALUES('rebuild');`);

  const upsertMeta = db.prepare(`
    INSERT INTO db_metadata (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  upsertMeta.run('built_at', new Date().toISOString());
  upsertMeta.run('tier', 'free');
  upsertMeta.run('schema_version', '1');
  upsertMeta.run('builder', 'build-db.ts');

  const countRow = db.prepare('SELECT COUNT(*) as count FROM preparatory_works').get() as { count: number };
  const ftsRow = db.prepare('SELECT COUNT(*) as count FROM pw_fts').get() as { count: number };

  console.log(`\nDatabase build complete:`);
  console.log(`  preparatory_works: ${countRow.count} rows`);
  console.log(`  pw_fts:            ${ftsRow.count} FTS rows`);
  console.log(`  inserted: ${inserted}  skipped (dup): ${skipped}`);

  db.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
