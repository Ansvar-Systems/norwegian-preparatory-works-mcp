/**
 * Smoke test for norwegian-preparatory-works-mcp.
 *
 * Verifies that:
 * - the preparatory_works table exists and can be queried
 * - search_preparatory_works returns results for a Norwegian query
 * - results carry Gate 13-compliant _citation triples
 *   (publisher: stortinget.no, license: NLOD-2.0)
 *
 * Uses an in-memory better-sqlite3 DB seeded with three minimal Norwegian
 * rows so CI does not require seed files or network access.
 *
 * v0.1 smoke test replacing the inherited swedish-law-mcp test suite.
 * Full Norwegian test migration tracked as Tier 2 follow-up.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { Database as BetterDatabase } from 'better-sqlite3';
import { searchPrepWorks } from '../src/tools/search-preparatory-works.js';

// ── In-memory DB factory ────────────────────────────────────────────────────

/**
 * Build a minimal in-memory database matching the production schema.
 *
 * Three rows: two innstillinger + one proposisjon.
 * FTS index rebuilt after insert so MATCH queries work.
 */
function buildTestDb(): BetterDatabase {
  const db = new BetterSqlite3(':memory:');
  db.pragma('journal_mode = DELETE');

  db.exec(`
    CREATE TABLE preparatory_works (
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

    CREATE VIRTUAL TABLE pw_fts USING fts5(
      title,
      summary,
      body,
      canonical_ref,
      komite,
      tokenize = "unicode61 remove_diacritics 1",
      content = preparatory_works,
      content_rowid = rowid
    );

    CREATE TABLE db_metadata (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const insert = db.prepare(`
    INSERT INTO preparatory_works
      (id, canonical_ref, title, doc_type, session, tilgjengelig_dato, komite, source_url, summary)
    VALUES
      (@id, @canonical_ref, @title, @doc_type, @session, @tilgjengelig_dato, @komite, @source_url, @summary)
  `);

  db.transaction(() => {
    insert.run({
      id: 'inns-202324-042l',
      canonical_ref: 'Innst. 42 L (2023-2024)',
      title: 'Innstilling om endringer i personopplysningsloven',
      doc_type: 'innstilling',
      session: '2023-2024',
      tilgjengelig_dato: '2023-11-10',
      komite: 'justiskomiteen',
      source_url:
        'https://www.stortinget.no/no/Saker-og-publikasjoner/Publikasjoner/Innstillinger/Stortinget/2023-2024/inns-202324-042l/',
      summary:
        'Komiteen behandler forslag om styrking av personvernet gjennom endringer i personopplysningsloven.',
    });

    insert.run({
      id: 'sak-93001',
      canonical_ref: 'Prop. 93 L (2023-2024)',
      title: 'Endringer i personopplysningsloven og personvernforordningen',
      doc_type: 'proposisjon',
      session: '2023-2024',
      tilgjengelig_dato: '2023-10-15',
      komite: null,
      source_url: 'https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=93001',
      summary:
        'Proposisjonen foreslaar endringer for aa gjennomfore personvernforordningen (GDPR) mer presist i norsk rett.',
    });

    insert.run({
      id: 'inns-202223-101s',
      canonical_ref: 'Innst. 101 S (2022-2023)',
      title: 'Innstilling om statsbudsjettet for 2023',
      doc_type: 'innstilling',
      session: '2022-2023',
      tilgjengelig_dato: '2022-11-20',
      komite: 'finanskomiteen',
      source_url:
        'https://www.stortinget.no/no/Saker-og-publikasjoner/Publikasjoner/Innstillinger/Stortinget/2022-2023/inns-202223-101s/',
      summary: 'Finanskomiteens innstilling om statsbudsjettet med prioriteringer for 2023.',
    });
  })();

  // Rebuild FTS index after content insert (external content table pattern).
  db.exec(`INSERT INTO pw_fts(pw_fts) VALUES('rebuild');`);

  db.exec(`
    INSERT INTO db_metadata VALUES ('tier', 'free');
    INSERT INTO db_metadata VALUES ('schema_version', '1');
    INSERT INTO db_metadata VALUES ('built_at', '2026-05-02T00:00:00Z');
    INSERT INTO db_metadata VALUES ('builder', 'smoke-test');
  `);

  return db;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('norwegian-preparatory-works-mcp smoke', () => {
  let db: BetterDatabase;

  beforeAll(() => {
    db = buildTestDb();
  });

  afterAll(() => {
    db?.close();
  });

  it('preparatory_works table has Norwegian Stortinget records', () => {
    const row = db
      .prepare('SELECT count(*) AS n FROM preparatory_works')
      .get() as { n: number };
    expect(row.n).toBeGreaterThan(0);
  });

  it('both doc_types (innstilling + proposisjon) are present', () => {
    const rows = db
      .prepare('SELECT DISTINCT doc_type FROM preparatory_works ORDER BY doc_type')
      .all() as { doc_type: string }[];
    const types = rows.map(r => r.doc_type);
    expect(types).toContain('innstilling');
    expect(types).toContain('proposisjon');
  });

  it('search_preparatory_works returns results for a Norwegian query', async () => {
    // "personopplysningsloven" appears in titles and summaries of the seed rows.
    // The FTS5 unicode61 tokenizer does not stem — use the full word form present
    // in the test data rather than a truncated variant.
    const response = await searchPrepWorks(
      db as unknown as Parameters<typeof searchPrepWorks>[0],
      { query: 'personopplysningsloven', limit: 5 },
    );

    expect(Array.isArray(response.results)).toBe(true);
    expect(response.results.length).toBeGreaterThan(0);
  });

  it('search results carry a valid Gate 13 _citation triple', async () => {
    const response = await searchPrepWorks(
      db as unknown as Parameters<typeof searchPrepWorks>[0],
      { query: 'personopplysningsloven', limit: 1 },
    );

    if (response.results.length === 0) {
      console.warn('No results for smoke query; _citation check skipped');
      return;
    }

    const item = response.results[0];
    expect(item._citation).toBeDefined();
    expect(item._citation.publisher).toBe('stortinget.no');
    expect(item._citation.license).toBe('NLOD-2.0');
    expect(item._citation.source_url).toMatch(/^https:\/\/(www\.)?stortinget\.no\//);
  });

  it('_citation.lookup references the get_preparatory_work tool', async () => {
    const response = await searchPrepWorks(
      db as unknown as Parameters<typeof searchPrepWorks>[0],
      { query: 'personopplysningsloven', limit: 1 },
    );

    if (response.results.length === 0) {
      console.warn('No results for smoke query; lookup check skipped');
      return;
    }

    const item = response.results[0];
    expect(item._citation.lookup.tool).toBe('get_preparatory_work');
    expect(typeof item._citation.lookup.args['document_id']).toBe('string');
    expect((item._citation.lookup.args['document_id'] as string).length).toBeGreaterThan(0);
  });
});
