/**
 * about — Server metadata, dataset statistics, and provenance.
 */

import type Database from '@ansvar/mcp-sqlite';

export interface AboutContext {
  version: string;
  fingerprint: string;
  dbBuilt: string;
}

function safeCount(db: InstanceType<typeof Database>, sql: string): number {
  try {
    const row = db.prepare(sql).get() as { count: number } | undefined;
    return row ? Number(row.count) : 0;
  } catch {
    return 0;
  }
}

export function getAbout(db: InstanceType<typeof Database>, context: AboutContext) {
  const totalDocs = safeCount(db, 'SELECT COUNT(*) as count FROM preparatory_works');
  const proposisjoner = safeCount(db, "SELECT COUNT(*) as count FROM preparatory_works WHERE doc_type = 'proposisjon'");
  const innstillinger = safeCount(db, "SELECT COUNT(*) as count FROM preparatory_works WHERE doc_type = 'innstilling'");

  const sessions = (db.prepare(`
    SELECT DISTINCT session FROM preparatory_works WHERE session GLOB '[0-9]*' ORDER BY session
  `).all() as { session: string }[]).map(r => r.session);

  return {
    name: 'Norwegian Preparatory Works MCP',
    version: context.version,
    jurisdiction: 'NO',
    description: 'MCP server for Norwegian Stortinget preparatory works (forarbeider — Proposisjoner and Innstillinger) under NLOD 2.0',
    stats: {
      total_documents: totalDocs,
      proposisjoner,
      innstillinger,
      sessions,
    },
    data_sources: [
      {
        name: 'Stortinget API (data.stortinget.no)',
        url: 'https://data.stortinget.no/',
        authority: 'Stortinget (Norwegian Parliament)',
        license: 'NLOD 2.0',
        api_docs: 'https://data.stortinget.no/dokumentasjon-og-hjelp/teknisk-dokumentasjon/',
      },
    ],
    freshness: {
      database_built: context.dbBuilt,
      database_fingerprint: context.fingerprint,
      corpus_note: 'v0.1 sample (sessions 2022-2023 and 2023-2024). Full corpus (25,301 records) requires ~5h ingestion at 90 calls/min.',
    },
    disclaimer:
      'This is a research tool, not legal advice. Verify critical citations against official sources at stortinget.no.',
    network: {
      name: 'Ansvar MCP Network',
      open_law: 'https://ansvar.eu/open-law',
      directory: 'https://ansvar.ai/mcp',
    },
  };
}
