/**
 * Central MCP server registry.
 *
 * Manages all MCP servers (filesystem + 4 lightweight servers added in Faza 2).
 *
 * Lifecycle:
 *   - filesystem  → eager permanent connection on initRegistry()
 *   - git/github/memory/brave-search → lazy: child process spawns at the
 *     start of each /api/chat/stream request (parallel), auto-disconnects
 *     after DEFAULT_IDLE_MS of inactivity.
 *   - toggle OFF  → immediate disconnect (child process killed)
 *   - toggle ON   → sets enabled=true; child spawns on next chat request
 */
import path from "path";
import { mkdirSync } from "fs";
import { mcpClient, LazyMCPClient, resolveNpmServer, resultToText } from "./client.js";

export { resultToText };

const IDLE_MS = 5 * 60 * 1000; // 5 minutes

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

  lazyServers = [gitServer, githubServer, memoryServer, braveServer];

  // Combine all for public access
  _allServers = [filesystemProxy, ...lazyServers];
}

/** All servers (filesystem proxy + lazy servers). Set after initRegistry(). */
let _allServers = [];

// ── Public API ───────────────────────────────────────────────────────────────

/** For GET /api/mcp/servers */
export function getAllServersStatus() {
  return _allServers.map((s) => ({
    id:          s.id,
    name:        s.name,
    icon:        s.icon,
    description: s.description,
    enabled:     s.enabled,
    status:      s.status,
  }));
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

  if (id === "filesystem") {
    // Filesystem is always on; toggling is a no-op
    return { id: "filesystem", enabled: true, status: s.status };
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

  // Aggregate tools, build routing table
  toolRouter.clear();
  const tools = [];

  for (const s of _allServers) {
    if (!s.enabled || s.notConfigured || !s.connected) continue;
    for (const t of s.getOpenAITools()) {
      toolRouter.set(t.function.name, s);
      tools.push(t);
    }
  }

  return tools;
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
