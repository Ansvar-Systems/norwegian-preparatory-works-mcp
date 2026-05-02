/**
 * Citation metadata for the deterministic citation pipeline.
 *
 * Provides structured identifiers (canonical_ref, display_text, source_url)
 * that the platform's entity linker uses to match references in agent
 * responses to MCP tool results — without relying on LLM formatting.
 *
 * Source URL pattern:
 *   source_url points to the human-readable stortinget.no page for the document.
 *   publisher is always "stortinget.no" for Proposisjoner/Innstillinger.
 *   license is always "NLOD-2.0".
 *
 * See: docs/guides/law-mcp-golden-standard.md Section 4.9c
 */

export interface CitationMetadata {
  source_url: string;
  publisher: string;
  license: string;
  canonical_ref: string;
  display_text: string;
  attribution_text: string;
  lookup: {
    tool: string;
    args: Record<string, string>;
  };
}

/**
 * Build citation metadata for a preparatory work document.
 *
 * @param documentId   Internal DB identifier (e.g., "prop-56-l-2017-2018")
 * @param canonicalRef Human-readable reference (e.g., "Prop. 56 L (2017–2018)")
 * @param title        Full document title
 * @param sourceUrl    URL to the stortinget.no publication page
 */
export function buildPrepWorkCitation(
  documentId: string,
  canonicalRef: string,
  _title: string,
  sourceUrl: string,
): CitationMetadata {
  return {
    source_url: sourceUrl,
    publisher: 'stortinget.no',
    license: 'NLOD-2.0',
    canonical_ref: canonicalRef,
    display_text: canonicalRef,
    attribution_text: `${canonicalRef} — Stortinget (NLOD-2.0)`,
    lookup: {
      tool: 'get_preparatory_work',
      args: { document_id: documentId },
    },
  };
}

/**
 * Construct a stortinget.no URL for a preparatory work based on the type and session.
 *
 * Format examples:
 *   Innst. 1 S (2023-2024) → https://www.stortinget.no/no/Saker-og-publikasjoner/Publikasjoner/Innstillinger/Stortinget/2023-2024/inns-202324-001s/
 *   Sak (proposisjon) → https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=<sakId>
 */
export function buildStortingetUrl(pubIdOrSakId: string, docType: 'innstilling' | 'proposisjon', session: string): string {
  if (docType === 'innstilling') {
    return `https://www.stortinget.no/no/Saker-og-publikasjoner/Publikasjoner/Innstillinger/Stortinget/${session}/${pubIdOrSakId}/`;
  }
  // For proposisjoner we use the stortinget.no saker page keyed on sakId.
  return `https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=${pubIdOrSakId}`;
}
