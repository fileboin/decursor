/**
 * MCP client that spawns @modelcontextprotocol/server-filesystem as a child
 * process and exposes its tools to the chat endpoint via the MCP SDK.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createRequire } from "module";
import { readFile } from "fs/promises";
import path from "path";

const require = createRequire(import.meta.url);

/** Resolve the filesystem server entry point from node_modules. */
async function resolveServerPath() {
  const pkgJsonPath = require.resolve(
    "@modelcontextprotocol/server-filesystem/package.json"
  );
  const pkgDir = path.dirname(pkgJsonPath);
  const pkg = JSON.parse(await readFile(pkgJsonPath, "utf8"));
  const main = pkg.main || "dist/index.js";
  return path.join(pkgDir, main);
}

class MCPClient {
  constructor() {
    this.client = null;
    this.tools = [];
    this.connected = false;
  }

  /**
   * Spawn the filesystem MCP server for `workspaceDir` and connect to it.
   * Returns the list of available tools.
   */
  async connect(workspaceDir) {
    const serverPath = await resolveServerPath();

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

  /** Return tools formatted as OpenAI-compatible function specs. */
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

  /**
   * Call a tool by name with the given arguments object.
   * Returns the raw MCP CallToolResult.
   */
  async callTool(name, args) {
    if (!this.connected) throw new Error("MCP client not connected");
    return this.client.callTool({ name, arguments: args });
  }

  /**
   * Stringify a CallToolResult to a plain text string suitable for feeding
   * back to the LLM as a tool message.
   */
  static resultToText(result) {
    if (!result) return "";
    if (typeof result === "string") return result;
    if (Array.isArray(result.content)) {
      return result.content
        .map((c) => (c.type === "text" ? c.text : JSON.stringify(c)))
        .join("\n");
    }
    return JSON.stringify(result);
  }
}

export { MCPClient };
export const mcpClient = new MCPClient();
