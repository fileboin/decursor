/**
 * Central MCP server registry.
 *
 * Manages all MCP servers:
 *   - filesystem  → eager permanent connection on initRegistry()
 *   - git/github/memory/brave-search → lazy (Faza 2)
 *   - postgres-*  → lazy, one entry per DATABASE_URL / POSTGRES_n_URL (Faza 3)
 *
 * Lifecycle (lazy servers):
 *   - Child process spawns at start of each /api/chat/stream request (parallel)
 *   - Auto-disconnects after IDLE_MS of inactivity
 *   - toggle OFF  → immediate disconnect (child process killed)
 *   - toggle ON   → sets enabled=true; child spawns on next chat request
 *
 * Write-mode (postgres only):
 *   - writeMode=false → spawned with DB_READ_ONLY=true  (default)
 *   - writeMode=true  → spawned with DB_READ_ONLY=false
 *   - toggleWriteMode(id) → disconnect + flip state; server respawns lazily
 */
import path from "path";
import { mkdirSync } from "fs";
import { mcpClient, LazyMCPClient, resolveNpmServer, resultToText } from "./client.js";
import {
  loadCustomServerConfigs,
  saveCustomServerConfigs,
  buildClientFromConfig,
} from "./custom-servers.js";

export { resultToText };

const IDLE_MS = 5 * 60 * 1000; // 5 minutes

// ── Terminal tools — intercepted by server.js BEFORE routeToolCall ───────────

/**
 * Tool names that require explicit user confirmation + audit logging.
 * This is a constant — there is no runtime path that can disable this check.
 */
export const EXEC_TOOLS = new Set(["run_command"]);

// ── Destructive heuristic for custom (user-added) servers ────────────────────

const DESTRUCTIVE_PARTS = new Set([
  "delete", "remove", "drop", "destroy", "truncate",
  "transfer", "send", "write", "execute", "kill",
  "terminate", "purge", "drain", "revoke", "flush",
  "wipe", "overwrite",
]);

/**
 * Returns true when a tool should require confirmation based on its name
 * keywords or the MCP-standard `destructiveHint` annotation.
 * Applied automatically to all user-added (custom) servers.
 */
export function isDestructiveTool(toolName, annotations) {
  if (annotations?.destructiveHint === true) return true;
  const parts = toolName.toLowerCase().split(/[_\-\s]+/);
  return parts.some((p) => DESTRUCTIVE_PARTS.has(p));
}

/** Runtime set of custom-server tool names that need confirmation. */
const customDestructiveToolSet = new Set();

/** Returns true if this tool (from a user-added server) needs confirmation. */
export function isCustomDestructiveTool(name) {
  return customDestructiveToolSet.has(name);
}

/**
 * Tool names handled by the fetch/HTTP virtual client.
 * Intercepted by server.js before routeToolCall().
 */
export const FETCH_TOOLS = new Set(["http_request"]);

/**
 * All Telegram tool names — intercepted by server.js before routeToolCall().
 */
export const TELEGRAM_TOOLS = new Set([
  "telegram_send_message",
  "telegram_get_webhook_info",
  "telegram_get_updates",
]);

/**
 * Telegram tools that require explicit user confirmation (write actions).
 */
export const TELEGRAM_WRITE_TOOLS = new Set(["telegram_send_message"]);

// ── Registry singleton ───────────────────────────────────────────────────────

/** @type {LazyMCPClient[]} */
let lazyServers = [];

/** toolName → LazyMCPClient */
const toolRouter = new Map();

/**
 * Build the per-server spawn configs and, for filesystem, eagerly connect.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} workspaceDir
 */
export async function initRegistry(env, workspaceDir) {
  const ghToken  = env.GITHUB_PERSONAL_ACCESS_TOKEN || "";
  const braveKey = env.BRAVE_API_KEY || "";
  const memFile  = env.MEMORY_FILE_PATH ||
    path.join(workspaceDir, "data", "memory.jsonl");

  // Ensure memory storage directory exists
  try {
    mkdirSync(path.dirname(memFile), { recursive: true });
  } catch {}

  // ── Filesystem — eager via the existing MCPClient ──────────────────────────
  // mcpClient is connected by server.js boot; we wrap it into a LazyMCPClient
  // shaped object for uniform registry access.
  const filesystemProxy = {
    id:          "filesystem",
    name:        "Filesystem",
    icon:        "📁",
    description: "Čita i piše fajlove u workspace-u",
    enabled:     true,
    notConfigured: false,
    get status()    { return mcpClient.connected ? "connected" : "disconnected"; },
    get connected() { return mcpClient.connected; },
    get tools()     { return mcpClient.tools; },
    getOpenAITools() { return mcpClient.getOpenAITools(); },
    async callTool(name, args) { return mcpClient.callTool(name, args); },
    async connect()    { /* managed by server.js boot */ },
    async disconnect() { /* never kill filesystem */ },
  };

  // ── Git — Python mcp-server-git ───────────────────────────────────────────
  const gitServer = new LazyMCPClient({
    id:          "git",
    name:        "Git",
    icon:        "🌿",
    description: `Git operacije u ${path.basename(workspaceDir)}`,
    enabled:     true,
    idleMs:      IDLE_MS,
    spawnConfig: async () => ({
      command: "python3",
      args:    ["-m", "mcp_server_git", "--repository", workspaceDir],
    }),
  });

  // ── GitHub ────────────────────────────────────────────────────────────────
  const githubServer = new LazyMCPClient({
    id:          "github",
    name:        "GitHub",
    icon:        "🐙",
    description: "Repos, issues, pull requests",
    enabled:     !!ghToken,
    notConfigured: !ghToken,
    idleMs:      IDLE_MS,
    spawnConfig: async () => {
      const serverPath = await resolveNpmServer(
        "@modelcontextprotocol/server-github"
      );
      return {
        command: "node",
        args:    [serverPath],
        env:     { GITHUB_PERSONAL_ACCESS_TOKEN: ghToken },
      };
    },
  });

  // ── Memory ────────────────────────────────────────────────────────────────
  const memoryServer = new LazyMCPClient({
    id:          "memory",
    name:        "Memory",
    icon:        "🧠",
    description: "Perzistentno pamćenje između sesija",
    enabled:     true,
    idleMs:      IDLE_MS,
    spawnConfig: async () => {
      const serverPath = await resolveNpmServer(
        "@modelcontextprotocol/server-memory"
      );
      return {
        command: "node",
        args:    [serverPath],
        env:     { MEMORY_FILE_PATH: memFile },
      };
    },
  });

  // ── Brave Search ──────────────────────────────────────────────────────────
  const braveServer = new LazyMCPClient({
    id:          "brave-search",
    name:        "Web Search",
    icon:        "🔍",
    description: "Pretraga weba putem Brave Search",
    enabled:     !!braveKey,
    notConfigured: !braveKey,
    idleMs:      IDLE_MS,
    spawnConfig: async () => {
      const serverPath = await resolveNpmServer(
        "@modelcontextprotocol/server-brave-search"
      );
      return {
        command: "node",
        args:    [serverPath],
        env:     { BRAVE_API_KEY: braveKey },
      };
    },
  });

  // ── Telegram — virtual client, no child process ───────────────────────────
  const telegramServer = new VirtualTelegramClient(env.TELEGRAM_BOT_TOKEN || "");

  // ── Fetch/HTTP — virtual client, no child process ────────────────────────
  const fetchServer = new VirtualFetchClient();

  // ── Terminal — virtual client, no child process ───────────────────────────
  const terminalServer = new VirtualTerminalClient();

  // ── Postgres — one server per DATABASE_URL / POSTGRES_n_URL ─────────────
  const postgresServers = buildPostgresServers(env);

  // ── User-added custom servers ──────────────────────────────────────────────
  _customConfigs = await loadCustomServerConfigs();
  const customClients = _customConfigs.map(buildClientFromConfig);

  lazyServers = [gitServer, githubServer, memoryServer, braveServer, ...postgresServers, telegramServer, fetchServer, terminalServer, ...customClients];

  // Combine all for public access
  _allServers = [filesystemProxy, ...lazyServers];
}

/** All servers (filesystem proxy + lazy servers). Set after initRegistry(). */
let _allServers = [];

/** Persisted configs for user-added servers. */
let _customConfigs = [];

// ── VirtualTelegramClient — Telegram Bot API, no child process ───────────────

/**
 * Provides Telegram tools without spawning any process.
 * Uses native fetch to call https://api.telegram.org/bot{TOKEN}/...
 * Read tools execute directly; write tools are intercepted by server.js
 * and require explicit user confirmation before execution.
 */
class VirtualTelegramClient {
  constructor(botToken) {
    this.id          = "telegram";
    this.name        = "Telegram";
    this.icon        = "✈️";
    this.description = "Telegram Bot API — pošalji poruku, provjeri webhook, čitaj updates";
    this.enabled     = !!botToken;
    this.notConfigured = !botToken;
    this.type        = "telegram";
    this._status     = "disconnected";
    this._idleTimer  = null;

    this.tools = [
      {
        name: "telegram_send_message",
        description:
          "Send a text message to a Telegram chat or channel. " +
          "Requires explicit user confirmation before sending. " +
          "chat_id can be a numeric ID or a @username.",
        inputSchema: {
          type: "object",
          properties: {
            chat_id: { type: "string", description: "Target chat ID or @username" },
            text:    { type: "string", description: "Message text to send" },
            parse_mode: {
              type: "string",
              enum: ["HTML", "Markdown", "MarkdownV2"],
              description: "Optional text formatting mode",
            },
          },
          required: ["chat_id", "text"],
        },
      },
      {
        name: "telegram_get_webhook_info",
        description: "Get current webhook configuration status for the bot.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "telegram_get_updates",
        description:
          "Retrieve the latest incoming updates (messages, callbacks, etc.) via long-polling. " +
          "Returns up to `limit` updates (default 10). " +
          "Pass `offset` = last_update_id + 1 to acknowledge previous updates.",
        inputSchema: {
          type: "object",
          properties: {
            limit:  { type: "number", description: "Max updates to return (1–100, default 10)" },
            offset: { type: "number", description: "Update offset for pagination" },
          },
          required: [],
        },
      },
    ];
  }

  get connected() { return !this.notConfigured; } // always callable if configured
  get status()    { return this.notConfigured ? "not_configured" : this._status; }

  async connect()    { /* no-op */ }
  async disconnect() { this._clearIdleTimer(); this._status = "disconnected"; }

  markActive() {
    this._status = "connected";
    this._clearIdleTimer();
    this._idleTimer = setTimeout(() => {
      this._status = "disconnected";
      this._idleTimer = null;
    }, FETCH_IDLE_MS); // reuse same 5-min constant
    if (this._idleTimer.unref) this._idleTimer.unref();
  }

  _clearIdleTimer() {
    if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null; }
  }

  getOpenAITools() {
    return this.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));
  }

  async callTool() {
    throw new Error("Telegram tool calls must be intercepted by server.js before reaching callTool()");
  }
}

// ── VirtualFetchClient — HTTP client, no child process ──────────────────────

const FETCH_IDLE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Provides the http_request tool without spawning any process.
 * Actual HTTP calls are handled by server.js (domain check, timeout, audit).
 * Status transitions: disconnected → connected (on first call) → disconnected
 * (after FETCH_IDLE_MS idle). The tools are always available to the model
 * regardless of idle state (connected getter always returns true).
 */
class VirtualFetchClient {
  constructor() {
    this.id          = "fetch";
    this.name        = "Fetch/HTTP";
    this.icon        = "🌐";
    this.description = "HTTP pozivi ka eksternim API-jima i web servisima";
    this.enabled     = true;
    this.notConfigured = false;
    this.type        = "fetch";
    this._status     = "disconnected"; // display only
    this._idleTimer  = null;

    this.tools = [
      {
        name: "http_request",
        description:
          "Make an HTTP request to an external URL. " +
          "Supports GET, POST, PUT, DELETE, PATCH. " +
          "Responses are capped at a configurable size limit to protect the context window. " +
          "Requires explicit URL and method; headers and body are optional.",
        inputSchema: {
          type: "object",
          properties: {
            method: {
              type: "string",
              enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
              description: "HTTP method",
            },
            url: {
              type: "string",
              description: "Full URL to request",
            },
            headers: {
              type: "object",
              description: "HTTP headers (key→value). Include Authorization here for bearer tokens.",
              additionalProperties: { type: "string" },
            },
            body: {
              type: "string",
              description: "Request body (for POST/PUT/PATCH). Use JSON string if sending JSON.",
            },
            timeout: {
              type: "number",
              description: "Timeout in milliseconds (default 15000, max 30000)",
            },
          },
          required: ["method", "url"],
        },
      },
    ];
  }

  /** Always true so tools appear in every LLM request. */
  get connected() { return true; }
  get status()    { return this._status; }

  async connect()    { /* no-op */ }

  async disconnect() {
    this._clearIdleTimer();
    this._status = "disconnected";
  }

  /** Called by server.js after each successful HTTP call. */
  markActive() {
    this._status = "connected";
    this._clearIdleTimer();
    this._idleTimer = setTimeout(() => {
      this._status = "disconnected";
      this._idleTimer = null;
    }, FETCH_IDLE_MS);
    if (this._idleTimer.unref) this._idleTimer.unref();
  }

  _clearIdleTimer() {
    if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null; }
  }

  getOpenAITools() {
    return this.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));
  }

  async callTool() {
    throw new Error("Fetch tool calls must be intercepted by server.js before reaching callTool()");
  }
}

// ── VirtualTerminalClient — no child process, always ready ──────────────────

/**
 * Provides the run_command tool definition without spawning any process.
 * Actual execution is handled by server.js AFTER user confirmation.
 * confirmRequired is hardcoded true — it cannot be toggled via any API.
 */
class VirtualTerminalClient {
  constructor() {
    this.id          = "terminal";
    this.name        = "Terminal";
    this.icon        = "⌨️";
    this.description = "Izvršava shell komande u workspace-u";
    this.enabled     = true;
    this.notConfigured = false;
    this.type        = "terminal";
    /** Non-negotiable — never set to false. */
    this.confirmRequired = true;
    this.tools = [
      {
        name: "run_command",
        description:
          "Execute a shell command in the server workspace directory. " +
          "ALWAYS requires explicit user confirmation before execution — " +
          "no command is ever auto-executed.",
        inputSchema: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The shell command to execute",
            },
            timeout: {
              type: "number",
              description: "Timeout in milliseconds (default 30000, max 60000)",
            },
          },
          required: ["command"],
        },
      },
    ];
  }

  get status()    { return "connected"; }
  get connected() { return true; }

  async connect()    { /* no-op — no child process to spawn */ }
  async disconnect() { /* no-op */ }

  getOpenAITools() {
    return this.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  }

  async callTool() {
    // server.js intercepts EXEC_TOOLS before routeToolCall is called.
    // This method should never be reached.
    throw new Error(
      "Terminal tool calls must be intercepted by server.js before reaching callTool()"
    );
  }
}

// ── Postgres helpers ─────────────────────────────────────────────────────────

/**
 * MCP write tools — these require user confirmation before execution.
 * Exposed so server.js can check without importing mcp-postgres internals.
 */
export const POSTGRES_WRITE_TOOLS = new Set([
  "insert_data",
  "update_data",
  "delete_data",
  "execute_raw_query",
  "create_table",
  "alter_table",
]);

/**
 * Build LazyMCPClient instances for each Postgres connection defined in env.
 *
 * Reads:
 *   DATABASE_URL          → id "postgres", name "Postgres"
 *   POSTGRES_2_URL        → id "postgres-2", name from POSTGRES_2_NAME or "Postgres 2"
 *   POSTGRES_3_URL / NAME → id "postgres-3" …  (up to index 9)
 */
function buildPostgresServers(env) {
  const entries = [];

  // Primary connection
  if (env.DATABASE_URL) {
    entries.push({ id: "postgres", name: "Postgres", url: env.DATABASE_URL });
  }

  // Additional connections: POSTGRES_2_URL … POSTGRES_9_URL
  for (let i = 2; i <= 9; i++) {
    const url = env[`POSTGRES_${i}_URL`];
    if (!url) continue;
    const name = env[`POSTGRES_${i}_NAME`] || `Postgres ${i}`;
    entries.push({ id: `postgres-${i}`, name, url });
  }

  return entries.map(({ id, name, url }) => {
    const server = new LazyMCPClient({
      id,
      name,
      icon: "🐘",
      description: `${new URL(url).hostname} · read-only`,
      enabled: true,
      notConfigured: false,
      idleMs: IDLE_MS,
      spawnConfig: async () => {
        const serverPath = await resolveNpmServer("mcp-postgres");
        return {
          command: "node",
          args: [serverPath],
          env: {
            DATABASE_URL: url,
            DB_READ_ONLY: server._writeMode ? "false" : "true",
            DB_STATEMENT_TIMEOUT: "30000",
          },
        };
      },
    });
    // Extra state for Postgres servers
    server._writeMode = false;
    server._pgUrl = url;
    server.type = "postgres";
    return server;
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/** For GET /api/mcp/servers */
export function getAllServersStatus() {
  return _allServers.map((s) => {
    const base = {
      id:          s.id,
      name:        s.name,
      icon:        s.icon,
      description: s.description,
      enabled:     s.enabled,
      status:      s.status,
    };
    if (s.type === "postgres") {
      base.type = "postgres";
      base.writeMode = s._writeMode === true;
      base.description = `${new URL(s._pgUrl).hostname} · ${s._writeMode ? "write" : "read-only"}`;
    }
    if (s.type === "terminal") {
      base.type = "terminal";
      base.confirmRequired = true;
    }
    if (s.type === "fetch") {
      base.type = "fetch";
    }
    if (s.type === "telegram") {
      base.type = "telegram";
    }
    if (s.type === "custom") {
      base.type = "custom";
      base.removable = true;
      base.transport = s._customConfig?.transport ?? "stdio";
    }
    return base;
  });
}

/**
 * Toggle write-mode for a Postgres server.
 * Disconnects immediately so it respawns with the new DB_READ_ONLY value on
 * the next chat request.
 */
export async function toggleWriteMode(id) {
  const s = _allServers.find((s) => s.id === id && s.type === "postgres");
  if (!s) return null;
  s._writeMode = !s._writeMode;
  s.description = `${new URL(s._pgUrl).hostname} · ${s._writeMode ? "write" : "read-only"}`;
  if (s.connected) await s.disconnect(); // respawns lazily with updated DB_READ_ONLY
  return { id: s.id, writeMode: s._writeMode, status: s.status };
}

/**
 * Toggle a server enabled/disabled.
 * Disabling immediately disconnects (kills child process for lazy servers).
 * Returns the new state or null if server not found.
 */
export async function toggleServer(id) {
  const s = _allServers.find((s) => s.id === id);
  if (!s) return null;

  if (s.notConfigured) {
    return { id: s.id, enabled: false, status: "not_configured" };
  }

  if (id === "filesystem" || id === "terminal") {
    // These servers are always on; toggling is a no-op
    return { id: s.id, enabled: true, status: s.status,
             ...(id === "terminal" ? { confirmRequired: true } : {}) };
  }

  s.enabled = !s.enabled;

  if (!s.enabled && s.connected) {
    await s.disconnect();
  }

  return { id: s.id, enabled: s.enabled, status: s.status };
}

/**
 * Connect all enabled lazy servers (in parallel), then aggregate and return
 * all active OpenAI-format tools, building the tool→server routing table.
 *
 * Called at the start of every /api/chat/stream request.
 */
export async function getToolsForChat() {
  // Connect all enabled, non-configured lazy servers that aren't yet running
  await Promise.allSettled(
    lazyServers
      .filter((s) => s.enabled && !s.notConfigured && !s.connected)
      .map((s) =>
        s.connect().catch((err) =>
          console.warn(`MCP [${s.id}]: lazy connect failed — ${err.message}`)
        )
      )
  );

  // Aggregate tools, build routing table and custom destructive set
  toolRouter.clear();
  customDestructiveToolSet.clear();
  const tools = [];

  for (const s of _allServers) {
    if (!s.enabled || s.notConfigured || !s.connected) continue;
    for (const t of s.getOpenAITools()) {
      toolRouter.set(t.function.name, s);
      // Populate destructive set for custom servers using heuristic
      if (s.type === "custom") {
        const raw = s.tools.find((rt) => rt.name === t.function.name);
        if (isDestructiveTool(t.function.name, raw?.annotations)) {
          customDestructiveToolSet.add(t.function.name);
        }
      }
      tools.push(t);
    }
  }

  return tools;
}

/**
 * Add a user-provided MCP server config, connect immediately, and persist.
 * Returns {id, name, status, toolCount} or throws on connection failure.
 * Times out after 30 seconds if the server doesn't respond.
 */
export async function addCustomServer(config) {
  if (!config.id) config.id = `custom-${Date.now()}`;
  config.addedAt = new Date().toISOString();
  config.enabled = true;

  const client = buildClientFromConfig(config);

  // Connect with timeout
  await Promise.race([
    client.connect(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Connection timed out (30s)")), 30_000)
    ),
  ]);

  // Register in runtime structures
  _allServers.push(client);
  lazyServers.push(client);
  _customConfigs.push(config);

  // Persist
  await saveCustomServerConfigs(_customConfigs);

  return {
    id: config.id,
    name: config.name,
    status: client.status,
    toolCount: client.tools.length,
  };
}

/**
 * Disconnect and permanently remove a user-added server.
 * Returns true if found and removed, false if not found.
 */
export async function removeCustomServer(id) {
  const idx = _allServers.findIndex((s) => s.id === id && s.type === "custom");
  if (idx === -1) return false;

  const client = _allServers[idx];

  // Remove from routing and destructive set before disconnect
  for (const tool of client.tools) {
    toolRouter.delete(tool.name);
    customDestructiveToolSet.delete(tool.name);
  }

  try {
    await client.disconnect();
  } catch {}

  _allServers.splice(idx, 1);
  const lazyIdx = lazyServers.indexOf(client);
  if (lazyIdx !== -1) lazyServers.splice(lazyIdx, 1);

  _customConfigs = _customConfigs.filter((c) => c.id !== id);
  await saveCustomServerConfigs(_customConfigs);

  return true;
}

/**
 * Notify the registry that a virtual server (fetch/terminal) was just used.
 * Resets its idle timer and marks status as "connected".
 */
export function notifyServerActivity(id) {
  const s = _allServers.find((srv) => srv.id === id);
  if (s && typeof s.markActive === "function") s.markActive();
}

/**
 * Route a tool call to the correct server.
 * Returns the raw MCP CallToolResult.
 */
export async function routeToolCall(toolName, args) {
  const server = toolRouter.get(toolName);
  if (!server) throw new Error(`Unknown tool: ${toolName}`);
  return server.callTool(toolName, args);
}
