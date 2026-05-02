#!/usr/bin/env tsx
/**
 * Ingestion script for Norwegian Stortinget preparatory works.
 *
 * Fetches Proposisjoner (via saker endpoint) and Innstillinger (via publikasjoner endpoint)
 * from data.stortinget.no API and writes seed JSON files to data/seed/.
 *
 * Rate limit: ≤90 API calls/min (API enforces 100/min; we leave 10/min headroom).
 * v0.1 sample: sessions 2022-2023 and 2023-2024 only (~500–900 records).
 * Full corpus path: set FULL_CORPUS=1 to run all sessions (~25,301 records, ~5h wall-clock).
 *
 * Usage:
 *   npm run ingest                      # v0.1 sample (2 sessions)
 *   FULL_CORPUS=1 npm run ingest        # full corpus (all sessions, ~5h)
 *   DRY_RUN=1 npm run ingest            # dry-run: fetch lists only, no individual docs
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { XMLParser } from 'fast-xml-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEED_DIR = path.resolve(__dirname, '../data/seed');
const API_BASE = 'https://data.stortinget.no';
const MIN_DELAY_MS = 670; // ~89.5 calls/min — stays under 90/min floor
const DRY_RUN = process.env['DRY_RUN'] === '1';
const FULL_CORPUS = process.env['FULL_CORPUS'] === '1';
// Set SKIP_BODY=1 to skip per-document body fetches (faster; metadata only).
// Recommended for v0.1 sample ingestion — saves ~10 min at 670ms/doc.
const SKIP_BODY = process.env['SKIP_BODY'] === '1';

// Sessions to ingest for v0.1 sample
const SAMPLE_SESSIONS = ['2022-2023', '2023-2024'];

// Full session list (all available from Stortinget API)
const ALL_SESSIONS = [
  '1945-1949', '1949-1953', '1953-1957', '1957-1961', '1961-1965', '1965-1969',
  '1969-1973', '1973-1977', '1977-1981', '1981-1985', '1985-1989', '1989-1993',
  '1993-1997', '1997-2001', '2001-2005', '2005-2009', '2009-2013', '2013-2017',
  '2017-2018', '2018-2019', '2019-2020', '2020-2021', '2021-2022',
  '2022-2023', '2023-2024', '2024-2025',
];

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (_name, jpath) => jpath.endsWith('.sak') || jpath.endsWith('.publikasjon'),
});

// ── Rate limiter ──────────────────────────────────────────────────────────────
let lastCallTime = 0;

async function rateLimited<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const wait = Math.max(0, MIN_DELAY_MS - (now - lastCallTime));
  if (wait > 0) {
    await new Promise<void>(r => setTimeout(r, wait));
  }
  lastCallTime = Date.now();
  return fn();
}

// ── HTTP fetch helper ─────────────────────────────────────────────────────────
async function fetchXml(url: string): Promise<string> {
  const resp = await rateLimited(() =>
    fetch(url, {
      headers: { 'Accept': 'text/xml, application/xml', 'User-Agent': 'ansvar-mcp-ingest/0.1' },
      signal: AbortSignal.timeout(30_000),
    })
  );

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} for ${url}`);
  }
  return resp.text();
}

// ── Saker fetch (Proposisjoner) ───────────────────────────────────────────────
interface SakItem {
  id: string;
  behandlet_sesjon_id?: string;
  dokumentgruppe?: string;
  tittel?: string;
  korttittel?: string;
  status?: string;
  sist_oppdatert_dato?: string;
  innstilling_id?: string;
  komite?: { id?: string; navn?: string };
  publikasjon_referanse_liste?: unknown;
  publikasjoner?: unknown;
}

async function fetchSakerForSession(session: string): Promise<SakItem[]> {
  const url = `${API_BASE}/eksport/saker?sesjonid=${encodeURIComponent(session)}&saktype=proposisjon`;
  console.log(`  Fetching saker (proposisjoner): ${url}`);
  const xml = await fetchXml(url);
  const parsed = xmlParser.parse(xml);
  const root = parsed['saker_oversikt'];
  if (!root) return [];
  const saker = root['saker_liste']?.['sak'] ?? [];
  return Array.isArray(saker) ? saker : [saker];
}

// ── Publikasjoner fetch (Innstillinger) ───────────────────────────────────────
interface PubItem {
  id: string;
  tittel?: string;
  type?: string;
  tilgjengelig_dato?: string;
  dato?: string;
  publikasjonsPdfer?: { 'string'?: string | string[] };
  publikasjonformat_liste?: unknown;
}

async function fetchInnstillingerForSession(session: string): Promise<PubItem[]> {
  const url = `${API_BASE}/eksport/publikasjoner?publikasjontype=innstilling&sesjonid=${encodeURIComponent(session)}`;
  console.log(`  Fetching innstillinger: ${url}`);
  const xml = await fetchXml(url);
  const parsed = xmlParser.parse(xml);
  const root = parsed['publikasjoner_oversikt'];
  if (!root) return [];
  const pubs = root['publikasjoner_liste']?.['publikasjon'] ?? [];
  return Array.isArray(pubs) ? pubs : [pubs];
}

// ── Single innstilling full text fetch ───────────────────────────────────────
async function fetchInnstillingBody(pubId: string): Promise<string | null> {
  const url = `${API_BASE}/eksport/publikasjon?publikasjonid=${encodeURIComponent(pubId)}`;
  try {
    const xml = await fetchXml(url);
    // Extract all <A> (paragraph) text from the XML body
    const textMatches = xml.match(/<A[^>]*>([^<]{10,})<\/A>/g);
    if (textMatches && textMatches.length > 0) {
      const texts = textMatches
        .map(m => m.replace(/<[^>]+>/g, '').trim())
        .filter(t => t.length > 20)
        .slice(0, 50); // cap at 50 paragraphs for the seed
      return texts.join('\n\n').slice(0, 8000);
    }
    return null;
  } catch (err) {
    console.warn(`    Could not fetch body for ${pubId}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ── Build source URL for an innstilling ──────────────────────────────────────
function innstillingSourceUrl(pubId: string, session: string): string {
  return `https://www.stortinget.no/no/Saker-og-publikasjoner/Publikasjoner/Innstillinger/Stortinget/${session}/${pubId}/`;
}

// ── Build source URL for a proposisjon sak ───────────────────────────────────
function proposisjonSourceUrl(sakId: string): string {
  return `https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=${sakId}`;
}

// ── Extract regjeringen.no URL from sak if available ────────────────────────
function extractRegjeringenUrl(pubRefList: unknown): string | null {
  if (!pubRefList) return null;
  try {
    // The XML parser nests this as publikasjon_referanse_liste.publikasjon_referanse
    const refs = (pubRefList as Record<string, unknown>)['publikasjon_referanse'];
    const refArr = Array.isArray(refs) ? refs : [refs];
    for (const ref of refArr) {
      if (!ref) continue;
      const url = (ref as Record<string, string>)['lenke_url'] ?? '';
      if (url.includes('regjeringen.no')) {
        return url.startsWith('http') ? url : `https:${url}`;
      }
    }
  } catch {
    // Non-fatal
  }
  return null;
}

// ── Write seed JSON ───────────────────────────────────────────────────────────
function writeSeed(data: Record<string, unknown>, seedId: string): void {
  const filePath = path.join(SEED_DIR, `${seedId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ── Main ingestion ────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  fs.mkdirSync(SEED_DIR, { recursive: true });

  const sessions = FULL_CORPUS ? ALL_SESSIONS : SAMPLE_SESSIONS;
  console.log(`Mode: ${FULL_CORPUS ? 'FULL_CORPUS' : 'SAMPLE (2 sessions)'}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log(`Skip body fetch: ${SKIP_BODY} (set SKIP_BODY=1 for fast metadata-only run)`);
  console.log(`Sessions: ${sessions.join(', ')}`);
  console.log(`Seed dir: ${SEED_DIR}`);
  console.log('');

  let totalIngested = 0;
  let totalSkipped = 0;

  for (const session of sessions) {
    console.log(`\n=== Session ${session} ===`);

    // ── 1. Proposisjoner (via saker endpoint) ────────────────────────────
    try {
      const saker = await fetchSakerForSession(session);
      const proposisjoner = saker.filter(s => s.dokumentgruppe === 'proposisjon');
      console.log(`  Found ${proposisjoner.length} proposisjoner in saker`);

      for (const sak of proposisjoner) {
        const sakId = String(sak.id ?? '').trim();
        if (!sakId) continue;

        const seedId = `sak-${sakId}`;
        const seedPath = path.join(SEED_DIR, `${seedId}.json`);

        if (fs.existsSync(seedPath)) {
          totalSkipped++;
          continue;
        }

        if (DRY_RUN) {
          totalIngested++;
          continue;
        }

        // behandlet_sesjon_id may be a string or a complex XML node — always extract text
        const rawSession = sak.behandlet_sesjon_id;
        const sessionStr = (typeof rawSession === 'string' && /^\d{4}-\d{4}$/.test(rawSession))
          ? rawSession
          : session;
        const title = String(sak.tittel ?? sak.korttittel ?? '').trim();
        const komiteNavn = typeof sak.komite === 'object' && sak.komite
          ? String((sak.komite as Record<string, unknown>)['navn'] ?? '')
          : null;

        const regjeringenUrl = extractRegjeringenUrl(sak.publikasjon_referanse_liste);

        // Extract canonical ref from the tittel (e.g. "Prop. 56 L (2023-2024)")
        // The saker endpoint gives us the main tittel but not the "Prop. X L" ref directly.
        // We derive it from the kort reference in the session.
        const canonical_ref = title || `Proposisjon ${sakId} (${sessionStr})`;

        const seed = {
          id: seedId,
          canonical_ref,
          title,
          doc_type: 'proposisjon',
          session: sessionStr,
          tilgjengelig_dato: sak.sist_oppdatert_dato
            ? String(sak.sist_oppdatert_dato).slice(0, 10)
            : null,
          komite: komiteNavn || null,
          submitted_by: null,
          subject_refs: null,
          summary: null,
          body: null,
          source_url: proposisjonSourceUrl(sakId),
          regjeringen_url: regjeringenUrl,
          _citation: {
            source_url: proposisjonSourceUrl(sakId),
            publisher: 'stortinget.no',
            license: 'NLOD-2.0',
            canonical_ref,
            attribution_text: `${canonical_ref} — Stortinget (NLOD-2.0)`,
          },
        };

        writeSeed(seed, seedId);
        totalIngested++;
      }
    } catch (err) {
      console.error(`  ERROR fetching saker for ${session}: ${err instanceof Error ? err.message : String(err)}`);
    }

    // ── 2. Innstillinger (via publikasjoner endpoint) ────────────────────
    try {
      const pubs = await fetchInnstillingerForSession(session);
      console.log(`  Found ${pubs.length} innstillinger`);

      for (const pub of pubs) {
        const pubId = String(pub.id ?? '').trim();
        if (!pubId) continue;

        const seedId = pubId;
        const seedPath = path.join(SEED_DIR, `${seedId}.json`);

        if (fs.existsSync(seedPath)) {
          totalSkipped++;
          continue;
        }

        if (DRY_RUN) {
          totalIngested++;
          continue;
        }

        const title = String(pub.tittel ?? '').trim();
        const tilgjengelig = pub.tilgjengelig_dato
          ? String(pub.tilgjengelig_dato).slice(0, 10)
          : null;

        // Fetch full innstilling body text (one extra API call per document).
        // Skip with SKIP_BODY=1 for fast metadata-only ingestion.
        const body = SKIP_BODY ? null : await fetchInnstillingBody(pubId);

        const seed = {
          id: seedId,
          canonical_ref: title || pubId,
          title,
          doc_type: 'innstilling',
          session,
          tilgjengelig_dato: tilgjengelig,
          komite: null,
          submitted_by: null,
          subject_refs: null,
          summary: null,
          body,
          source_url: innstillingSourceUrl(pubId, session),
          regjeringen_url: null,
          _citation: {
            source_url: innstillingSourceUrl(pubId, session),
            publisher: 'stortinget.no',
            license: 'NLOD-2.0',
            canonical_ref: title || pubId,
            attribution_text: `${title || pubId} — Stortinget (NLOD-2.0)`,
          },
        };

        writeSeed(seed, seedId);
        totalIngested++;
      }
    } catch (err) {
      console.error(`  ERROR fetching innstillinger for ${session}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n=== Ingestion complete ===`);
  console.log(`  Ingested: ${totalIngested}`);
  console.log(`  Skipped (already exist): ${totalSkipped}`);
  console.log(`  Total seed files: ${fs.readdirSync(SEED_DIR).filter(f => f.endsWith('.json')).length}`);
  console.log('');
  console.log('Next step: npm run build:db');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
