/**
 * get_preparatory_work — Retrieve a single preparatory work by document_id.
 *
 * Returns full metadata, the summary/ingress text, and a _citation triple.
 * If the document is not found, returns a data-source-unavailable error
 * (per the no-silent-fallback rule — never fabricate).
 */

import type { Database } from '@ansvar/mcp-sqlite';
import { generateResponseMetadata, type ToolResponse } from '../utils/metadata.js';
import { buildPrepWorkCitation, type CitationMetadata } from '../utils/citation.js';

export interface GetPrepWorkInput {
  document_id: string;
}

export interface PrepWorkDetail {
  document_id: string;
  canonical_ref: string;
  title: string;
  doc_type: string;
  session: string;
  tilgjengelig_dato: string | null;
  komite: string | null;
  submitted_by: string | null;
  subject_refs: string | null;
  summary: string | null;
  body: string | null;
  source_url: string;
  regjeringen_url: string | null;
  _citation: CitationMetadata;
}

export async function getPrepWork(
  db: Database,
  input: GetPrepWorkInput,
): Promise<ToolResponse<PrepWorkDetail | null>> {
  if (!input.document_id || input.document_id.trim().length === 0) {
    return {
      results: null,
      _meta: {
        ...generateResponseMetadata(db),
        note: 'document_id is required',
      },
    };
  }

  const row = db.prepare(`
    SELECT
      id,
      canonical_ref,
      title,
      doc_type,
      session,
      tilgjengelig_dato,
      komite,
      submitted_by,
      subject_refs,
      summary,
      body,
      source_url,
      regjeringen_url
    FROM preparatory_works
    WHERE id = ?
  `).get(input.document_id) as {
    id: string;
    canonical_ref: string;
    title: string;
    doc_type: string;
    session: string;
    tilgjengelig_dato: string | null;
    komite: string | null;
    submitted_by: string | null;
    subject_refs: string | null;
    summary: string | null;
    body: string | null;
    source_url: string;
    regjeringen_url: string | null;
  } | undefined;

  if (!row) {
    return {
      results: null,
      _meta: {
        ...generateResponseMetadata(db),
        note: `Document not found: "${input.document_id}". Use search_preparatory_works to find documents.`,
      },
    };
  }

  return {
    results: {
      document_id: row.id,
      canonical_ref: row.canonical_ref,
      title: row.title,
      doc_type: row.doc_type,
      session: row.session,
      tilgjengelig_dato: row.tilgjengelig_dato,
      komite: row.komite,
      submitted_by: row.submitted_by,
      subject_refs: row.subject_refs,
      summary: row.summary,
      body: row.body,
      source_url: row.source_url,
      regjeringen_url: row.regjeringen_url,
      _citation: buildPrepWorkCitation(
        row.id,
        row.canonical_ref,
        row.title,
        row.source_url,
      ),
    },
    _meta: generateResponseMetadata(db),
  };
}
