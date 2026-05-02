/**
 * list_sources tool — returns data provenance metadata.
 * Required by Ansvar MCP audit standard (Phase 1.5).
 */

import type Database from '@ansvar/mcp-sqlite';

export interface ListSourcesResult {
  jurisdiction: string;
  sources: Array<{
    name: string;
    authority: string;
    url: string;
    retrieval_method: string;
    update_frequency: string;
    last_ingested: string;
    license: string;
    coverage: string;
    limitations: string;
  }>;
  data_freshness: {
    automated_checks: boolean;
    check_frequency: string;
    last_verified: string;
  };
}

/**
 * Read the database build date from db_metadata if available.
 */
function readBuildDate(db?: InstanceType<typeof Database>): string {
  if (!db) return 'unknown';
  try {
    const hasTable = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='db_metadata'"
    ).get();
    if (!hasTable) return 'unknown';

    const row = db.prepare("SELECT value FROM db_metadata WHERE key = 'built_at'").get() as
      | { value: string }
      | undefined;
    if (row?.value && row.value !== 'unknown') {
      return row.value.slice(0, 10);
    }
  } catch {
    // Non-fatal
  }
  return 'unknown';
}

export function listSources(db?: InstanceType<typeof Database>): ListSourcesResult {
  const buildDate = readBuildDate(db);
  const lastIngested = buildDate !== 'unknown' ? buildDate : 'see about tool';

  return {
    jurisdiction: 'Norway (NO)',
    sources: [
      {
        name: 'Stortinget API (data.stortinget.no)',
        authority: 'Stortinget (Norwegian Parliament)',
        url: 'https://data.stortinget.no/',
        retrieval_method: 'REST API (XML, rate-limited at 100 calls/min)',
        update_frequency: 'monthly',
        last_ingested: lastIngested,
        license: 'NLOD 2.0 (Norwegian Licence for Open Government Data)',
        coverage: 'Proposisjoner (government bills) and Innstillinger (committee recommendations) from sessions 2022-2023 and 2023-2024 (v0.1 sample). Full corpus: 25,301 records across all sessions.',
        limitations: 'v0.1 sample covers two sessions only. Full text of Proposisjoner is hosted on regjeringen.no and not stored here. Innstilling full text is extracted from Stortinget XML where available.',
      },
    ],
    data_freshness: {
      automated_checks: false,
      check_frequency: 'monthly',
      last_verified: lastIngested,
    },
  };
}
