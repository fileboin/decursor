/**
 * MCP client utilities.
 *
 * MCPClient      — eager, permanent connection (used for filesystem).
 * LazyMCPClient  — spawns child process only on first callTool() / connect()
 *                  and auto-disconnects after IDLE_MS of inactivity.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createRequire } from "module";
import { readFile } from "fs/promises";
import path from "path";

const require = createRequire(import.meta.url);

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Resolve the entry-point JS file for an installed npm package. */
export async function resolveNpmServer(packageName) {
  const pkgJsonPath = require.resolve(`${packageName}/package.json`);
  const pkgDir = path.dirname(pkgJsonPath);
  const pkg = JSON.parse(await readFile(pkgJsonPath, "utf8"));
  return path.join(pkgDir, pkg.main || "dist/index.js");
}

/** Convert a CallToolResult to a plain string for the LLM tool message. */
export function resultToText(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (Array.isArray(result.content)) {
    return result.content
      .map((c) => (c.type === "text" ? c.text : JSON.stringify(c)))
      .join("\n");
  }
  return JSON.stringify(result);
}

// ── MCPClient — eager, permanent (filesystem) ───────────────────────────────

class MCPClient {
  constructor() {
    this.client = null;
    this.tools = [];
    this.connected = false;
  }

  async connect(workspaceDir) {
    const serverPath = await resolveNpmServer(
      "@modelcontextprotocol/server-filesystem"
    );
    const transport = new StdioClientTransport({
      command: "node",
      args: [serverPath, workspaceDir],
    });
    this.client = new Client(
      { name: "decursor", version: "1.0.0" },
      { capabilities: {} }
    );
    await this.client.connect(transport);
    const { tools } = await this.client.listTools();
    this.tools = tools ?? [];
    this.connected = true;
    return this.tools;
  }

  getOpenAITools() {
    return this.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema ?? { type: "object", properties: {} },
      },
    }));
  }

  async callTool(name, args) {
    if (!this.connected) throw new Error("MCP client not connected");
    return this.client.callTool({ name, arguments: args });
  }

  static resultToText = resultToText;
}

export { MCPClient };
export const mcpClient = new MCPClient();

// ── LazyMCPClient — spawns on-demand, auto-kills after idle ─────────────────

const DEFAULT_IDLE_MS = 5 * 60 * 1000; // 5 minutes

export class LazyMCPClient {
  /**
   * @param {object} opts
   * @param {string}   opts.id
   * @param {string}   opts.name
   * @param {string}   opts.icon
   * @param {string}   opts.description
   * @param {boolean}  [opts.enabled=true]
   * @param {boolean}  [opts.notConfigured=false]  — missing required env var
   * @param {number}   [opts.idleMs]               — auto-disconnect timeout
   * @param {() => Promise<{command:string, args:string[], env?:object}>} opts.spawnConfig
   */
  constructor(opts) {
    this.id = opts.id;
    this.name = opts.name;
    this.icon = opts.icon;
    this.description = opts.description;
    this.enabled = opts.enabled !== false;
    this.notConfigured = opts.notConfigured === true;
    this._idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
    this._spawnConfig = opts.spawnConfig;

    this._client = null;
    this._transport = null;
    this.tools = [];
    this._status = "disconnected"; // 'disconnected'|'connecting'|'connected'|'error'
    this._errorMsg = null;
    this._idleTimer = null;
    this._connectPromise = null;
  }

  get status() {
    if (this.notConfigured) return "not_configured";
    return this._status;
  }

  get connected() {
    return this._status === "connected";
  }

  /** Connect (idempotent — safe to call when already connected). */
  async connect() {
    if (this._status === "connected") return;
    if (this._connectPromise) return this._connectPromise;
    this._connectPromise = this._doConnect().finally(
      () => (this._connectPromise = null)
    );
    return this._connectPromise;
  }

  async _doConnect() {
    this._status = "connecting";
    this._errorMsg = null;
    try {
      const cfg = await this._spawnConfig();

      // Support both stdio (child process) and SSE (remote HTTP) transports
      if (cfg.type === "sse") {
        const { SSEClientTransport } = await import(
          "@modelcontextprotocol/sdk/client/sse.js"
        );
        this._transport = new SSEClientTransport(new URL(cfg.url));
      } else {
        this._transport = new StdioClientTransport({
          command: cfg.command,
          args: cfg.args ?? [],
          env: { ...process.env, ...(cfg.env ?? {}) },
        });
      }

      this._client = new Client(
        { name: "decursor", version: "1.0.0" },
        { capabilities: {} }
      );
      await this._client.connect(this._transport);
      const { tools } = await this._client.listTools();
      this.tools = tools ?? [];
      this._status = "connected";
      this._resetIdleTimer();
    } catch (err) {
      this._status = "error";
      this._errorMsg = err.message;
      this._client = null;
      this._transport = null;
      throw err;
    }
  }

  /** Disconnect and kill child process. */
  async disconnect() {
    this._clearIdleTimer();
    if (this._client) {
      try {
        await this._client.close();
      } catch {}
      this._client = null;
    }
    if (this._transport) {
      try {
        await this._transport.close();
      } catch {}
      this._transport = null;
    }
    this.tools = [];
    this._status = "disconnected";
  }

  /** Call a tool — connects lazily if needed and resets idle timer. */
  async callTool(name, args) {
    if (!this.enabled) throw new Error(`Server ${this.id} is disabled`);
    if (this.notConfigured)
      throw new Error(`Server ${this.id} is not configured`);
    await this.connect();
    this._resetIdleTimer();
    return this._client.callTool({ name, arguments: args });
  }

  /** Returns OpenAI-format tool specs (empty array if not yet connected). */
  getOpenAITools() {
    return this.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema ?? { type: "object", properties: {} },
      },
    }));
  }

  _resetIdleTimer() {
    this._clearIdleTimer();
    this._idleTimer = setTimeout(() => {
      console.log(`MCP [${this.id}]: idle ${this._idleMs / 1000}s — disconnecting`);
      this.disconnect();
    }, this._idleMs);
    // Don't block Node.js exit
    if (this._idleTimer.unref) this._idleTimer.unref();
  }

  _clearIdleTimer() {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }
}
