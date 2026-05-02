/**
 * search_preparatory_works — Full-text search across Norwegian preparatory works.
 *
 * Covers Proposisjoner (government bills) and Innstillinger (committee recommendations)
 * from Stortinget sessions 2022-2023 and 2023-2024 (v0.1 sample).
 */

import type { Database } from '@ansvar/mcp-sqlite';
import { buildFtsQueryVariants } from '../utils/fts-query.js';
import { generateResponseMetadata, type ToolResponse } from '../utils/metadata.js';
import { buildPrepWorkCitation, type CitationMetadata } from '../utils/citation.js';

export interface SearchPrepWorksInput {
  query: string;
  doc_type?: 'innstilling' | 'proposisjon';
  session?: string;
  limit?: number;
}

export interface SearchPrepWorksResult {
  document_id: string;
  canonical_ref: string;
  title: string;
  doc_type: string;
  session: string;
  tilgjengelig_dato: string | null;
  komite: string | null;
  snippet: string;
  relevance: number;
  source_url: string;
  _citation: CitationMetadata;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export async function searchPrepWorks(
  db: Database,
  input: SearchPrepWorksInput,
): Promise<ToolResponse<SearchPrepWorksResult[]>> {
  if (!input.query || input.query.trim().length === 0) {
    return {
      results: [],
      _meta: generateResponseMetadata(db),
    };
  }

  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const queryVariants = buildFtsQueryVariants(input.query);

  const conditions: string[] = ['pw_fts MATCH ?'];
  const params: (string | number)[] = [];

  if (input.doc_type) {
    conditions.push('pw.doc_type = ?');
    params.push(input.doc_type);
  }

  if (input.session) {
    conditions.push('pw.session = ?');
    params.push(input.session);
  }

  const whereClause = conditions.join(' AND ');

  const sql = `
    SELECT
      pw.id AS document_id,
      pw.canonical_ref,
      pw.title,
      pw.doc_type,
      pw.session,
      pw.tilgjengelig_dato,
      pw.komite,
      pw.source_url,
      snippet(pw_fts, 0, '>>>', '<<<', '...', 32) AS snippet,
      bm25(pw_fts) AS relevance
    FROM pw_fts
    JOIN preparatory_works pw ON pw.id = pw_fts.rowid
    WHERE ${whereClause}
    ORDER BY relevance
    LIMIT ?
  `;

  interface SearchRow {
    document_id: string;
    canonical_ref: string;
    title: string;
    doc_type: string;
    session: string;
    tilgjengelig_dato: string | null;
    komite: string | null;
    source_url: string;
    snippet: string;
    relevance: number;
  }

  const runQuery = (ftsQuery: string): SearchPrepWorksResult[] => {
    const bound = [ftsQuery, ...params, limit];
    const rows = db.prepare(sql).all(...bound) as SearchRow[];
    return rows.map(row => ({
      document_id: row.document_id,
      canonical_ref: row.canonical_ref,
      title: row.title,
      doc_type: row.doc_type,
      session: row.session,
      tilgjengelig_dato: row.tilgjengelig_dato,
      komite: row.komite,
      snippet: row.snippet,
      relevance: row.relevance,
      source_url: row.source_url,
      _citation: buildPrepWorkCitation(
        row.document_id,
        row.canonical_ref,
        row.title,
        row.source_url,
      ),
    }));
  };

  const primaryResults = runQuery(queryVariants.primary);
  if (primaryResults.length > 0) {
    return {
      results: primaryResults,
      _meta: generateResponseMetadata(db),
    };
  }

  if (queryVariants.fallback) {
    const fallbackResults = runQuery(queryVariants.fallback);
    if (fallbackResults.length > 0) {
      return {
        results: fallbackResults,
        _meta: {
          ...generateResponseMetadata(db),
          query_strategy: 'broadened',
        },
      };
    }
  }

  return {
    results: [],
    _meta: generateResponseMetadata(db),
  };
}
