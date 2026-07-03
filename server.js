import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { readdir, readFile, writeFile, appendFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { mcpClient } from "./mcp/client.js";
import {
  initRegistry,
  getAllServersStatus,
  toggleServer,
  toggleWriteMode,
  getToolsForChat,
  routeToolCall,
  resultToText,
  notifyServerActivity,
  isCustomDestructiveTool,
  addCustomServer,
  removeCustomServer,
  POSTGRES_WRITE_TOOLS,
  EXEC_TOOLS,
  FETCH_TOOLS,
  TELEGRAM_TOOLS,
  TELEGRAM_WRITE_TOOLS,
} from "./mcp/registry.js";

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;
const ACCESS_KEY = process.env.DECURSOR_ACCESS_KEY || "";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || "";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const PUBLIC_URL = process.env.PUBLIC_URL || "http://localhost:3000";
const WORKSPACE_DIR = path.resolve(
  process.env.MCP_WORKSPACE_DIR || process.cwd()
);


// ── Telegram config ──────────────────────────────────────────────────────────
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// ── HTTP fetch config ────────────────────────────────────────────────────────

/** Comma-separated list of allowed hostnames. Empty string = allow all. */
const HTTP_ALLOWED_DOMAINS = (process.env.HTTP_ALLOWED_DOMAINS ?? "")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

const HTTP_MAX_BYTES = (parseInt(process.env.HTTP_MAX_RESPONSE_KB) || 50) * 1024;
const HTTP_TIMEOUT_MS = 15_000;

function isHttpDomainAllowed(url) {
  if (HTTP_ALLOWED_DOMAINS.length === 0) return true;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return HTTP_ALLOWED_DOMAINS.some(
      (d) => hostname === d || hostname.endsWith("." + d)
    );
  } catch {
    return false;
  }
}

// ── Audit log ────────────────────────────────────────────────────────────────
const AUDIT_LOG_PATH = path.join(
  process.env.EXEC_AUDIT_LOG
    ? path.dirname(process.env.EXEC_AUDIT_LOG)
    : path.join(process.cwd(), "logs"),
  process.env.EXEC_AUDIT_LOG
    ? path.basename(process.env.EXEC_AUDIT_LOG)
    : "exec-audit.log"
);

async function writeAuditLog(tag, detail) {
  const line = `[${new Date().toISOString()}] ${tag.padEnd(10)} ${detail}\n`;
  await appendFile(AUDIT_LOG_PATH, line).catch(() => {}); // best-effort
}

// ── Postgres write-confirmation state ───────────────────────────────────────
// Map of confirmId → {resolve, reject} — populated during SSE streams
const pendingWriteConfirms = new Map();

function waitForWriteConfirm(id, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingWriteConfirms.delete(id);
      reject(new Error("Write confirmation timed out"));
    }, timeoutMs);
    pendingWriteConfirms.set(id, {
      allow: () => { clearTimeout(timer); resolve(); },
      deny:  () => { clearTimeout(timer); reject(new Error("User denied")); },
    });
  });
}

// ── Exec confirmation state ──────────────────────────────────────────────────
const pendingExecConfirms = new Map();

function waitForExecConfirm(id, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingExecConfirms.delete(id);
      reject(new Error("Confirmation timed out (2 min)"));
    }, timeoutMs);
    pendingExecConfirms.set(id, {
      allow: () => { clearTimeout(timer); resolve(); },
      deny:  () => { clearTimeout(timer); reject(new Error("User denied")); },
    });
  });
}

// ── Middleware ──────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  "/api/",
  rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false })
);

function requireAuth(req, res, next) {
  if (!ACCESS_KEY) return next();
  if (req.headers["x-decursor-key"] !== ACCESS_KEY)
    return res.status(401).json({ error: "Unauthorized" });
  next();
}
app.use("/api/", requireAuth);

// ── SSE helper ──────────────────────────────────────────────────────────────

function sseInit(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
}

function sseWrite(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ── File endpoints ──────────────────────────────────────────────────────────

app.get("/api/files", async (req, res) => {
  try {
    const entries = await readdir(WORKSPACE_DIR, { recursive: true });
    res.json(
      entries.filter(
        (e) => !e.startsWith("node_modules") && !e.startsWith(".")
      )
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/files/read", async (req, res) => {
  const filePath = path.resolve(WORKSPACE_DIR, req.query.path ?? "");
  if (!filePath.startsWith(WORKSPACE_DIR))
    return res.status(400).json({ error: "Invalid path" });
  try {
    const content = await readFile(filePath, "utf8");
    res.type("text/plain").send(content);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.post("/api/files/write", async (req, res) => {
  const { path: p, content } = req.body;
  const filePath = path.resolve(WORKSPACE_DIR, p ?? "");
  if (!filePath.startsWith(WORKSPACE_DIR))
    return res.status(400).json({ error: "Invalid path" });
  try {
    await writeFile(filePath, content ?? "", "utf8");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Models ──────────────────────────────────────────────────────────────────

app.get("/api/models", async (req, res) => {
  const { provider, ollamaUrl } = req.query;
  try {
    if (provider === "openrouter") {
      const r = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: `Bearer ${OPENROUTER_KEY}` },
      });
      const data = await r.json();
      return res.json((data.data ?? []).map((m) => m.id));
    }
    if (provider === "ollama") {
      const base = ollamaUrl || OLLAMA_URL;
      const r = await fetch(`${base}/api/tags`);
      const data = await r.json();
      return res.json((data.models ?? []).map((m) => m.name));
    }
    res.status(400).json({ error: "Unknown provider" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Chat streaming ──────────────────────────────────────────────────────────

/**
 * Stream one turn from OpenRouter (OpenAI-compatible).
 * Writes `delta` SSE events and returns accumulated tool-call data.
 */
async function streamOpenRouter(messages, model, tools, res) {
  const body = { model, messages, stream: true };
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": PUBLIC_URL,
      "X-Title": "Decursor",
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    throw new Error(`OpenRouter ${r.status}: ${await r.text()}`);
  }

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let finishReason = null;
  // { [index]: { id, name, args_str } }
  const tcAcc = {};

  outer: while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const raw = trimmed.slice(5).trim();
      if (raw === "[DONE]") break outer;
      let chunk;
      try {
        chunk = JSON.parse(raw);
      } catch {
        continue;
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};

      if (delta.content) sseWrite(res, { delta: delta.content });

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!tcAcc[idx]) tcAcc[idx] = { id: "", name: "", args_str: "" };
          if (tc.id) tcAcc[idx].id = tc.id;
          if (tc.function?.name) tcAcc[idx].name += tc.function.name;
          if (tc.function?.arguments) tcAcc[idx].args_str += tc.function.arguments;
        }
      }

      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
        break outer;
      }
    }
  }

  return { finishReason, tcAcc };
}

/**
 * Stream one turn from Ollama (NDJSON format).
 */
async function streamOllama(messages, model, ollamaUrl, tools, res) {
  const base = ollamaUrl || OLLAMA_URL;
  const body = { model, messages, stream: true };
  if (tools.length > 0) body.tools = tools;

  const r = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    throw new Error(`Ollama ${r.status}: ${await r.text()}`);
  }

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let finishReason = null;
  const tcAcc = {};
  let tcIdx = 0;

  outer: while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let chunk;
      try {
        chunk = JSON.parse(line);
      } catch {
        continue;
      }
      const msg = chunk.message ?? {};

      if (msg.content) sseWrite(res, { delta: msg.content });

      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          tcAcc[tcIdx++] = {
            id: `call_${Date.now()}_${tcIdx}`,
            name: tc.function?.name ?? "",
            args_str: JSON.stringify(tc.function?.arguments ?? {}),
          };
        }
      }

      if (chunk.done) {
        finishReason = msg.tool_calls?.length ? "tool_calls" : "stop";
        break outer;
      }
    }
  }

  return { finishReason, tcAcc };
}

app.post("/api/chat/stream", async (req, res) => {
  sseInit(res);

  const {
    provider,
    model,
    messages: initMessages,
    ollamaUrl,
  } = req.body;

  const messages = [...(initMessages ?? [])];
  const tools = await getToolsForChat();
  const MAX_ROUNDS = 8;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const { finishReason, tcAcc } =
        provider === "ollama"
          ? await streamOllama(messages, model, ollamaUrl, tools, res)
          : await streamOpenRouter(messages, model, tools, res);

      const pendingCalls = Object.values(tcAcc);
      if (finishReason !== "tool_calls" || pendingCalls.length === 0) break;

      // Build OpenAI-format tool_calls array for the assistant message
      const toolCalls = pendingCalls.map((tc) => ({
        id: tc.id || `call_${Date.now()}`,
        type: "function",
        function: { name: tc.name, arguments: tc.args_str },
      }));

      messages.push({ role: "assistant", content: null, tool_calls: toolCalls });

      for (const tc of toolCalls) {
        let args;
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          args = {};
        }

        // Notify the frontend that a tool is being invoked
        sseWrite(res, {
          tool_call: { id: tc.id, name: tc.function.name, arguments: args },
        });

        // ── EXEC TOOLS: confirm → execute → audit (bypass routeToolCall) ──
        if (EXEC_TOOLS.has(tc.function.name)) {
          const { command, timeout: cmdTimeout = 30_000 } = args;
          const confirmId = randomUUID();
          await writeAuditLog("PROPOSED", `${tc.function.name} via MCP : ${command}`);
          sseWrite(res, { exec_confirm: { id: confirmId, command } });

          let execResult;
          try {
            await waitForExecConfirm(confirmId);
            await writeAuditLog("ALLOWED", `${tc.function.name} via MCP : ${command}`);
            const { stdout, stderr } = await execAsync(command, {
              cwd: WORKSPACE_DIR,
              timeout: Math.min(Number(cmdTimeout) || 30_000, 60_000),
            });
            await writeAuditLog("OUTPUT", `stdout:${stdout.slice(0, 300)}, stderr:${stderr.slice(0, 300)}`);
            execResult = {
              content: [{ type: "text", text: `STDOUT:\n${stdout}\nSTDERR:\n${stderr}` }],
            };
          } catch (err) {
            const tag = err.message.includes("denied")
              ? "DENIED"
              : err.message.includes("timed out")
              ? "TIMEOUT"
              : "EXEC_ERR";
            await writeAuditLog(tag, `${tc.function.name} via MCP : ${command} — ${err.message}`);
            execResult = { isError: true, content: [{ type: "text", text: err.message }] };
          }

          sseWrite(res, { tool_result: { tool_call_id: tc.id, name: tc.function.name, result: execResult } });
          messages.push({ role: "tool", tool_call_id: tc.id, content: resultToText(execResult) });
          continue; // ← skip routeToolCall below
        }

        // ── FETCH TOOLS: domain check → fetch → truncate → audit → continue ──
        if (FETCH_TOOLS.has(tc.function.name)) {
          const {
            method = "GET",
            url,
            headers: reqHeaders = {},
            body: reqBody,
            timeout: reqTimeout,
          } = args;

          const t0 = Date.now();
          let fetchResult;

          if (!isHttpDomainAllowed(url)) {
            const msg = `Domain not allowed: ${new URL(url).hostname}. Allowed: ${HTTP_ALLOWED_DOMAINS.join(", ")}`;
            await writeAuditLog("HTTP_DENY", `${method} ${url} — ${msg}`);
            fetchResult = { isError: true, content: [{ type: "text", text: msg }] };
          } else {
            const controller = new AbortController();
            const timer = setTimeout(
              () => controller.abort(),
              Math.min(Number(reqTimeout) || HTTP_TIMEOUT_MS, 30_000)
            );
            try {
              const fetchOpts = {
                method,
                headers: reqHeaders,
                signal: controller.signal,
              };
              if (reqBody && ["POST", "PUT", "PATCH"].includes(method)) {
                fetchOpts.body = reqBody;
              }

              const resp = await fetch(url, fetchOpts);
              clearTimeout(timer);

              const elapsed = Date.now() - t0;
              const raw = await resp.text();
              const bytes = Buffer.byteLength(raw, "utf8");
              let body = raw;
              let truncated = "";
              if (bytes > HTTP_MAX_BYTES) {
                body = raw.slice(0, HTTP_MAX_BYTES);
                truncated = `\n\n[Response truncated: ${Math.round(bytes / 1024)}KB received, limit is ${Math.round(HTTP_MAX_BYTES / 1024)}KB]`;
              }

              await writeAuditLog(
                "HTTP_REQ",
                `${method} ${url} → ${resp.status} (${elapsed}ms, ${Math.round(bytes / 1024)}KB)`
              );

              const text = `HTTP ${resp.status} ${resp.statusText}\n\n${body}${truncated}`;
              fetchResult = { content: [{ type: "text", text }] };
              notifyServerActivity("fetch");
            } catch (err) {
              clearTimeout(timer);
              const msg = err.name === "AbortError" ? `Request timed out (${HTTP_TIMEOUT_MS / 1000}s)` : err.message;
              await writeAuditLog("HTTP_ERR", `${method} ${url} — ${msg}`);
              fetchResult = { isError: true, content: [{ type: "text", text: msg }] };
            }
          }

          sseWrite(res, { tool_result: { tool_call_id: tc.id, name: tc.function.name, result: fetchResult } });
          messages.push({ role: "tool", tool_call_id: tc.id, content: resultToText(fetchResult) });
          continue; // skip routeToolCall
        }

        // ── TELEGRAM TOOLS: optional confirm (write) → Bot API → audit ────────
        if (TELEGRAM_TOOLS.has(tc.function.name)) {
          // send_message requires confirmation; read tools execute directly
          if (TELEGRAM_WRITE_TOOLS.has(tc.function.name)) {
            const confirmId = randomUUID();
            sseWrite(res, { write_confirm: { id: confirmId, tool: tc.function.name, arguments: args } });
            try {
              await waitForWriteConfirm(confirmId);
            } catch (err) {
              await writeAuditLog("TG_DENY", `${tc.function.name} — ${err.message}`);
              const denied = { isError: true, content: [{ type: "text", text: err.message }] };
              sseWrite(res, { tool_result: { tool_call_id: tc.id, name: tc.function.name, result: denied } });
              messages.push({ role: "tool", tool_call_id: tc.id, content: resultToText(denied) });
              continue;
            }
          }

          let tgResult;
          try {
            const name = tc.function.name;
            let resp, data;

            if (name === "telegram_send_message") {
              const { chat_id, text, parse_mode } = args;
              const body = { chat_id, text };
              if (parse_mode) body.parse_mode = parse_mode;
              resp = await fetch(`${TELEGRAM_API}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(15_000),
              });
              data = await resp.json();
              if (!data.ok) throw new Error(`Telegram: ${data.description}`);
              await writeAuditLog("TG_CALL", `sendMessage → chat_id:${chat_id}`);
              tgResult = { content: [{ type: "text", text: `Sent. message_id: ${data.result.message_id}` }] };

            } else if (name === "telegram_get_webhook_info") {
              resp = await fetch(`${TELEGRAM_API}/getWebhookInfo`, { signal: AbortSignal.timeout(15_000) });
              data = await resp.json();
              if (!data.ok) throw new Error(`Telegram: ${data.description}`);
              await writeAuditLog("TG_CALL", `getWebhookInfo`);
              tgResult = { content: [{ type: "text", text: JSON.stringify(data.result, null, 2) }] };

            } else if (name === "telegram_get_updates") {
              const { limit = 10, offset } = args;
              const params = new URLSearchParams({ limit: String(Math.min(Number(limit) || 10, 100)) });
              if (offset !== undefined) params.set("offset", String(offset));
              resp = await fetch(`${TELEGRAM_API}/getUpdates?${params}`, { signal: AbortSignal.timeout(15_000) });
              data = await resp.json();
              if (!data.ok) throw new Error(`Telegram: ${data.description}`);
              await writeAuditLog("TG_CALL", `getUpdates (${data.result?.length ?? 0} updates)`);
              tgResult = { content: [{ type: "text", text: JSON.stringify(data.result, null, 2) }] };
            }

            notifyServerActivity("telegram");
          } catch (err) {
            await writeAuditLog("TG_ERR", `${tc.function.name} — ${err.message}`);
            tgResult = { isError: true, content: [{ type: "text", text: err.message }] };
          }

          sseWrite(res, { tool_result: { tool_call_id: tc.id, name: tc.function.name, result: tgResult } });
          messages.push({ role: "tool", tool_call_id: tc.id, content: resultToText(tgResult) });
          continue; // skip routeToolCall
        }

        // ── Custom server destructive heuristic: confirm before executing ────
        if (isCustomDestructiveTool(tc.function.name)) {
          const confirmId = randomUUID();
          sseWrite(res, {
            write_confirm: { id: confirmId, tool: tc.function.name, arguments: args },
          });
          try {
            await waitForWriteConfirm(confirmId);
          } catch (err) {
            const denied = { isError: true, content: [{ type: "text", text: err.message }] };
            sseWrite(res, { tool_result: { tool_call_id: tc.id, name: tc.function.name, result: denied } });
            messages.push({ role: "tool", tool_call_id: tc.id, content: resultToText(denied) });
            continue;
          }
        }

        // ── For Postgres write tools: ask user confirmation before executing ──
        if (POSTGRES_WRITE_TOOLS.has(tc.function.name)) {
          const confirmId = randomUUID();
          sseWrite(res, {
            write_confirm: {
              id: confirmId,
              tool: tc.function.name,
              arguments: args,
            },
          });
          try {
            await waitForWriteConfirm(confirmId);
          } catch (err) {
            sseWrite(res, {
              tool_result: {
                tool_call_id: tc.id,
                name: tc.function.name,
                result: { isError: true, content: [{ type: "text", text: err.message }] },
              },
            });
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: `Execution cancelled: ${err.message}`,
            });
            continue;
          }
        }

        let result;
        try {
          result = await routeToolCall(tc.function.name, args);
        } catch (err) {
          result = {
            isError: true,
            content: [{ type: "text", text: err.message }],
          };
        }

        // Notify the frontend with the tool result
        sseWrite(res, {
          tool_result: {
            tool_call_id: tc.id,
            name: tc.function.name,
            result,
          },
        });

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: resultToText(result),
        });
      }
    }
  } catch (err) {
    sseWrite(res, { error: err.message });
  }

  res.write("data: [DONE]\n\n");
  res.end();
});

// ── Exec ────────────────────────────────────────────────────────────────────

app.post("/api/exec", async (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: "No command provided" });
  // Confirmation happens in the frontend before this endpoint is called.
  // We audit-log every execution for traceability.
  await writeAuditLog("ALLOWED", `/api/exec via terminal : ${command}`);
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: WORKSPACE_DIR,
      timeout: 30_000,
    });
    await writeAuditLog("OUTPUT", `stdout:${stdout.slice(0, 300)}, stderr:${stderr.slice(0, 300)}`);
    res.json({ stdout, stderr });
  } catch (err) {
    await writeAuditLog("EXEC_ERR", `/api/exec : ${command} — ${err.message}`);
    res.json({ stdout: "", stderr: err.message, code: err.code });
  }
});

// ── GitHub ──────────────────────────────────────────────────────────────────

app.post("/api/github/pull", async (req, res) => {
  const { token, repo, branch, path: filePath } = req.body;
  try {
    const url = `https://api.github.com/repos/${repo}/contents/${filePath}${
      branch ? `?ref=${branch}` : ""
    }`;
    const r = await fetch(url, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message ?? "GitHub error");
    const content = Buffer.from(data.content, "base64").toString("utf8");
    res.json({ content, sha: data.sha });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/github/push", async (req, res) => {
  const { token, repo, branch, path: filePath, content, message, sha } =
    req.body;
  try {
    const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;
    const body = {
      message: message || "Update via Decursor",
      content: Buffer.from(content).toString("base64"),
      branch: branch || "main",
    };
    if (sha) body.sha = sha;
    const r = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message ?? "GitHub error");
    res.json({ ok: true, sha: data.content?.sha });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── WordPress ───────────────────────────────────────────────────────────────

function wpHeaders(username, appPassword) {
  return {
    Authorization: `Basic ${Buffer.from(`${username}:${appPassword}`).toString(
      "base64"
    )}`,
    "Content-Type": "application/json",
  };
}

function wpUrl(siteUrl, endpoint) {
  return `${siteUrl.replace(/\/$/, "")}/wp-json/wp/v2${endpoint}`;
}

app.get("/api/wordpress/posts", async (req, res) => {
  const { siteUrl, username, appPassword } = req.query;
  try {
    const r = await fetch(wpUrl(siteUrl, "/posts?per_page=20&status=any"), {
      headers: wpHeaders(username, appPassword),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message ?? "WP error");
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/wordpress/update", async (req, res) => {
  const { siteUrl, username, appPassword, id, content, title } = req.body;
  try {
    const r = await fetch(wpUrl(siteUrl, `/posts/${id}`), {
      method: "POST",
      headers: wpHeaders(username, appPassword),
      body: JSON.stringify({ content, title }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message ?? "WP error");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/wordpress/publish", async (req, res) => {
  const { siteUrl, username, appPassword, title, content, status = "draft" } =
    req.body;
  try {
    const r = await fetch(wpUrl(siteUrl, "/posts"), {
      method: "POST",
      headers: wpHeaders(username, appPassword),
      body: JSON.stringify({ title, content, status }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message ?? "WP error");
    res.json({ ok: true, id: data.id, link: data.link ?? data.guid?.rendered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MCP registry API ────────────────────────────────────────────────────────

app.get("/api/mcp/servers", (req, res) => {
  res.json(getAllServersStatus());
});

app.post("/api/mcp/servers/:id/toggle", async (req, res) => {
  const result = await toggleServer(req.params.id);
  if (!result) return res.status(404).json({ error: "Server not found" });
  res.json(result);
});

// Resolve or deny a pending exec (terminal MCP) confirmation
app.post("/api/mcp/exec-confirm/:id", (req, res) => {
  const pending = pendingExecConfirms.get(req.params.id);
  if (!pending) return res.status(404).json({ error: "Confirmation not found or expired" });
  pendingExecConfirms.delete(req.params.id);
  req.body.allowed ? pending.allow() : pending.deny();
  res.json({ ok: true });
});

// Resolve or deny a pending Postgres write confirmation
app.post("/api/mcp/write-confirm/:id", (req, res) => {
  const pending = pendingWriteConfirms.get(req.params.id);
  if (!pending) return res.status(404).json({ error: "Confirmation not found or expired" });
  pendingWriteConfirms.delete(req.params.id);
  req.body.allowed ? pending.allow() : pending.deny();
  res.json({ ok: true });
});

// Toggle write-mode for a Postgres MCP server
app.post("/api/mcp/servers/:id/write-mode", async (req, res) => {
  const result = await toggleWriteMode(req.params.id);
  if (!result) return res.status(404).json({ error: "Postgres server not found" });
  res.json(result);
});

// ── Custom MCP server management ────────────────────────────────────────────

app.post("/api/mcp/custom-servers", async (req, res) => {
  const { name, transport = "stdio", command, url, env = {} } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "name is required" });
  if (transport === "stdio" && !command?.trim())
    return res.status(400).json({ error: "command is required for stdio transport" });
  if (transport === "sse" && !url?.trim())
    return res.status(400).json({ error: "url is required for sse transport" });
  try {
    const result = await addCustomServer({ name: name.trim(), transport, command, url, env });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/mcp/custom-servers/:id", async (req, res) => {
  const ok = await removeCustomServer(req.params.id);
  if (!ok) return res.status(404).json({ error: "Custom server not found" });
  res.json({ ok: true });
});

// ── Boot ────────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log(`Decursor listening on port ${PORT}`);
  console.log(`Workspace: ${WORKSPACE_DIR}`);

  // Ensure logs/ directory exists for audit log
  await mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true }).catch(() => {});
  console.log(`Exec audit log: ${AUDIT_LOG_PATH}`);

  // 1. Connect filesystem MCP server (eager, permanent)
  try {
    const tools = await mcpClient.connect(WORKSPACE_DIR);
    console.log(`MCP [filesystem]: connected — ${tools.length} tool(s)`);
  } catch (err) {
    console.warn(`MCP [filesystem]: unavailable — ${err.message}`);
  }

  // 2. Initialize registry (lazy servers registered, not yet spawned)
  await initRegistry(process.env, WORKSPACE_DIR);

  const servers = getAllServersStatus();
  console.log(`MCP registry: ${servers.length} server(s) registered`);
  servers.forEach((s) =>
    console.log(`  • [${s.id}] ${s.name} — ${s.status}`)
  );
});
