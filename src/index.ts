#!/usr/bin/env node
/**
 * Norwegian Preparatory Works MCP Server (stdio transport)
 *
 * Provides tools for querying Norwegian Stortinget preparatory works
 * (forarbeider — Proposisjoner and Innstillinger) under NLOD 2.0.
 *
 * Zero-hallucination: never generates citations, only returns verified database entries.
 *
 * Tool definitions are in src/tools/registry.ts — the single source of truth
 * shared between stdio (this file) and HTTP (api/mcp.ts) transports.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import Database from '@ansvar/mcp-sqlite';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { readFileSync, statSync } from 'fs';
import type { AboutContext } from './tools/about.js';
import { registerTools } from './tools/registry.js';

const SERVER_NAME = 'norwegian-preparatory-works-mcp';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_PATH = path.join(__dirname, '..', 'package.json');
const pkgVersion: string = JSON.parse(readFileSync(PKG_PATH, 'utf-8')).version;

const DB_ENV_VAR = 'PREP_WORKS_DB_PATH';
const DEFAULT_DB_PATH = '../data/database.db';

let dbInstance: InstanceType<typeof Database> | null = null;

function getDb(): InstanceType<typeof Database> {
  if (!dbInstance) {
    const dbPath = process.env[DB_ENV_VAR] || getDefaultDbPath();
    console.error(`[${SERVER_NAME}] Opening database: ${dbPath}`);
    dbInstance = new Database(dbPath, { readonly: true });
    dbInstance.pragma('foreign_keys = ON');
    console.error(`[${SERVER_NAME}] Database opened successfully`);
  }
  return dbInstance;
}

function getDefaultDbPath(): string {
  return path.resolve(__dirname, DEFAULT_DB_PATH);
}

function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    console.error(`[${SERVER_NAME}] Database closed`);
  }
}

function computeAboutContext(): AboutContext {
  let fingerprint = 'unknown';
  let dbBuilt = new Date().toISOString();
  try {
    const dbPath = process.env[DB_ENV_VAR] || getDefaultDbPath();
    const dbBuffer = readFileSync(dbPath);
    fingerprint = createHash('sha256').update(dbBuffer).digest('hex').slice(0, 12);
    const dbStat = statSync(dbPath);
    dbBuilt = dbStat.mtime.toISOString();
  } catch {
    // Non-fatal — DB may not exist yet at startup
  }
  return { version: pkgVersion, fingerprint, dbBuilt };
}

const aboutContext = computeAboutContext();

const server = new Server(
  { name: SERVER_NAME, version: pkgVersion },
  { capabilities: { tools: {} } }
);

// Register tools from the shared registry
registerTools(server, getDb(), aboutContext);

async function main(): Promise<void> {
  console.error(`[${SERVER_NAME}] Starting server v${pkgVersion}...`);

  const transport = new StdioServerTransport();

  process.on('SIGINT', () => {
    console.error(`[${SERVER_NAME}] Shutting down...`);
    closeDb();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.error(`[${SERVER_NAME}] Shutting down...`);
    closeDb();
    process.exit(0);
  });

  await server.connect(transport);
  console.error(`[${SERVER_NAME}] Server started successfully`);
}

main().catch((error) => {
  console.error(`[${SERVER_NAME}] Fatal error:`, error);
  closeDb();
  process.exit(1);
});
