/**
 * Tool registry for Norwegian Preparatory Works MCP Server.
 * Shared between stdio (index.ts) and HTTP (api/mcp.ts) entry points.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import Database from '@ansvar/mcp-sqlite';

import { searchPrepWorks, type SearchPrepWorksInput } from './search-preparatory-works.js';
import { getPrepWork, type GetPrepWorkInput } from './get-preparatory-work.js';
import { getAbout, type AboutContext } from './about.js';
import { listSources } from './list-sources.js';

export type { AboutContext } from './about.js';

const LIST_SOURCES_TOOL: Tool = {
  name: 'list_sources',
  description: `List all data sources used by this MCP server with provenance metadata.

Returns jurisdiction, source authorities, URLs, retrieval methods, update frequencies, licenses, coverage scope, and known limitations. Use this to understand where the data comes from and how current it is. For server statistics, use about instead.`,
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

const ABOUT_TOOL: Tool = {
  name: 'about',
  description:
    'Server metadata, dataset statistics, freshness, and provenance. ' +
    'Call this to verify data coverage, currency, and content basis before relying on results.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export const TOOLS: Tool[] = [
  {
    name: 'search_preparatory_works',
    description: `Search Norwegian Stortinget preparatory works (forarbeider) — Proposisjoner and Innstillinger — by keyword. FTS5 with BM25 ranking.

Use this to find which government bills or committee recommendations address a specific legal topic. Returns metadata and _citation triple per result. Does NOT contain statute text — use a Norwegian law MCP for that.

Coverage: sessions 2022-2023 and 2023-2024 (v0.1 sample). Full corpus is 25,301 records. Call 'about' to check actual counts.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          minLength: 1,
          description: 'Search query in Norwegian. Supports FTS5 syntax.',
        },
        doc_type: {
          type: 'string',
          enum: ['innstilling', 'proposisjon'],
          description: 'Filter by document type: innstilling (committee recommendation) or proposisjon (government bill)',
        },
        session: {
          type: 'string',
          description: 'Filter by parliamentary session, e.g. "2022-2023" or "2023-2024"',
        },
        limit: {
          type: 'number',
          default: 10,
          minimum: 1,
          maximum: 50,
          description: 'Maximum results to return',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_preparatory_work',
    description: `Retrieve a single Norwegian preparatory work (forarbeid) by document_id.

Returns full metadata, ingress/summary text, and _citation triple. For Innstillinger, also returns the committee recommendation body text where available. For Proposisjoner, provides the regjeringen.no URL for the full bill text.

Use search_preparatory_works first to find document_ids.`,
    inputSchema: {
      type: 'object',
      properties: {
        document_id: {
          type: 'string',
          description: 'Internal document ID from search results (e.g., "inns-202324-001s" or "sak-99461")',
        },
      },
      required: ['document_id'],
    },
  },
];

export function buildTools(context?: AboutContext): Tool[] {
  return context ? [...TOOLS, LIST_SOURCES_TOOL, ABOUT_TOOL] : [...TOOLS, LIST_SOURCES_TOOL];
}

export function registerTools(
  server: Server,
  db: InstanceType<typeof Database>,
  context?: AboutContext,
): void {
  const allTools = buildTools(context);

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: allTools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: unknown;

      switch (name) {
        case 'search_preparatory_works':
          result = await searchPrepWorks(db, args as unknown as SearchPrepWorksInput);
          break;
        case 'get_preparatory_work':
          result = await getPrepWork(db, args as unknown as GetPrepWorkInput);
          break;
        case 'list_sources':
          result = listSources(db);
          break;
        case 'about':
          if (context) {
            result = getAbout(db, context);
          } else {
            return {
              content: [{ type: 'text', text: 'About tool not configured.' }],
              isError: true,
            };
          }
          break;
        default:
          return {
            content: [{ type: 'text', text: `Error: Unknown tool "${name}".` }],
            isError: true,
          };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error executing ${name}: ${message}` }],
        isError: true,
      };
    }
  });
}
