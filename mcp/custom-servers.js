/**
 * Persistence and builder for user-added custom MCP servers.
 * Configs are stored in data/mcp-custom-servers.json.
 */
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { LazyMCPClient } from "./client.js";

export const CUSTOM_CONFIG_PATH = path.join(
  process.cwd(),
  "data",
  "mcp-custom-servers.json"
);

const IDLE_MS = 5 * 60 * 1000;

// ── Persistence ───────────────────────────────────────────────────────────────

export async function loadCustomServerConfigs() {
  try {
    const raw = await readFile(CUSTOM_CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveCustomServerConfigs(configs) {
  await mkdir(path.dirname(CUSTOM_CONFIG_PATH), { recursive: true });
  await writeFile(
    CUSTOM_CONFIG_PATH,
    JSON.stringify(configs, null, 2),
    "utf8"
  );
}

// ── Command parsing ───────────────────────────────────────────────────────────

/**
 * Parse a shell-style command string into [command, ...args].
 * Handles single and double quoted segments.
 */
export function parseShellCommand(cmd) {
  const parts = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";
  for (const ch of cmd.trim()) {
    if (inQuotes) {
      if (ch === quoteChar) { inQuotes = false; }
      else { current += ch; }
    } else if (ch === '"' || ch === "'") {
      inQuotes = true;
      quoteChar = ch;
    } else if (ch === " ") {
      if (current) { parts.push(current); current = ""; }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts.length ? parts : [cmd.trim()];
}

// ── Client builder ────────────────────────────────────────────────────────────

/**
 * Build a LazyMCPClient from a persisted config object.
 * Works for both stdio (child process) and SSE (remote HTTP) transports.
 */
export function buildClientFromConfig(config) {
  const client = new LazyMCPClient({
    id: config.id,
    name: config.name,
    icon: "🔌",
    description:
      config.transport === "stdio"
        ? config.command.slice(0, 60)
        : config.url,
    enabled: config.enabled !== false,
    idleMs: IDLE_MS,
    spawnConfig: async () => {
      if (config.transport === "sse") {
        return { type: "sse", url: config.url, env: config.env ?? {} };
      }
      const parts = parseShellCommand(config.command);
      return {
        command: parts[0],
        args: parts.slice(1),
        env: config.env ?? {},
      };
    },
  });

  client.type = "custom";
  client._customConfig = config;
  return client;
}
