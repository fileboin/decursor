require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.static("public"));

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Default Ollama endpoint can be overridden per-request from the UI,
// but a server-side default can also be set via env var.
const DEFAULT_OLLAMA_URL = process.env.OLLAMA_URL || "";

// ─── NEW: rate limiter, path helpers, workspace ───────────────────────────────
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");
const { exec: childExec } = require("child_process");

const WORKSPACE_ROOT = path.resolve(__dirname, "workspace");
if (!fs.existsSync(WORKSPACE_ROOT)) {
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
}

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again after a minute." },
});

app.use("/api/", apiLimiter);

// ─── Auth middleware ──────────────────────────────────────────────────────────
const DECURSOR_ACCESS_KEY = process.env.DECURSOR_ACCESS_KEY || "";
app.use("/api/", (req, res, next) => {
  if (!DECURSOR_ACCESS_KEY) return next();
  const provided = req.headers["x-decursor-key"];
  if (!provided || provided !== DECURSOR_ACCESS_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

// ─── NEW: POST /api/chat/stream ───────────────────────────────────────────────
/**
 * POST /api/chat/stream
 * Same body as /api/chat; streams the response via Server-Sent Events.
 * body: { provider, model, messages, ollamaUrl? }
 */
app.post("/api/chat/stream", async (req, res) => {
  const { provider, model, messages, ollamaUrl } = req.body || {};

  if (!provider || !model || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Missing provider, model, or messages" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    if (provider === "openrouter") {
      if (!OPENROUTER_API_KEY) {
        send({ error: "Server missing OPENROUTER_API_KEY env var" });
        return res.end();
      }

      const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": process.env.PUBLIC_URL || "https://decursor.onrender.com",
          "X-Title": "Decursor",
        },
        body: JSON.stringify({ model, messages, stream: true }),
      });

      if (!response.ok) {
        const errData = await response.json();
        send({ error: errData.error?.message || "OpenRouter error" });
        return res.end();
      }

      for await (const chunk of response.body) {
        const lines = chunk.toString("utf8").split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;
          const raw = trimmed.slice(5).trim();
          if (raw === "[DONE]") {
            res.write("data: [DONE]\n\n");
            continue;
          }
          try {
            const parsed = JSON.parse(raw);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta != null) send({ delta });
          } catch (_) { /* skip malformed SSE lines */ }
        }
      }

      return res.end();
    }

    if (provider === "ollama") {
      const base = (ollamaUrl || DEFAULT_OLLAMA_URL || "").replace(/\/$/, "");
      if (!base) {
        send({ error: "No Ollama URL configured. Set OLLAMA_URL env var or provide ollamaUrl in the request." });
        return res.end();
      }

      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, stream: true }),
      });

      if (!response.ok) {
        const errData = await response.json();
        send({ error: errData.error || "Ollama error" });
        return res.end();
      }

      for await (const chunk of response.body) {
        const lines = chunk.toString("utf8").split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            const delta = parsed.message?.content;
            if (delta != null) send({ delta });
            if (parsed.done) res.write("data: [DONE]\n\n");
          } catch (_) { /* skip malformed lines */ }
        }
      }

      return res.end();
    }

    send({ error: `Unknown provider: ${provider}` });
    return res.end();
  } catch (err) {
    console.error("[chat/stream] Unexpected error:", err);
    send({ error: err.message || "Server error" });
    return res.end();
  }
});

// ─── NEW: File system API ─────────────────────────────────────────────────────

function safeResolvePath(requestedPath) {
  const resolved = path.resolve(WORKSPACE_ROOT, requestedPath.replace(/^\/+/, ""));
  const prefix = WORKSPACE_ROOT + path.sep;
  if (!resolved.startsWith(prefix) && resolved !== WORKSPACE_ROOT) return null;
  return resolved;
}

function buildFileTree(dirPath, rootPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relPath = path.relative(rootPath, fullPath);
    if (entry.isDirectory()) {
      result.push({ path: relPath, type: "dir" });
      result.push(...buildFileTree(fullPath, rootPath));
    } else {
      result.push({ path: relPath, type: "file" });
    }
  }
  return result;
}

/**
 * GET /api/files
 * Returns a recursive file tree of ./workspace as JSON:
 * [{path: string, type: "file"|"dir"}]
 */
app.get("/api/files", (req, res) => {
  try {
    const tree = buildFileTree(WORKSPACE_ROOT, WORKSPACE_ROOT);
    return res.json(tree);
  } catch (err) {
    console.error("[files] list error:", err);
    return res.status(500).json({ error: err.message || "Failed to list files" });
  }
});

/**
 * GET /api/files/read?path=...
 * Returns the text content of a file inside ./workspace.
 */
app.get("/api/files/read", (req, res) => {
  const requestedPath = req.query.path;
  if (!requestedPath) {
    return res.status(400).json({ error: "Missing query param: path" });
  }
  const resolved = safeResolvePath(requestedPath);
  if (!resolved) {
    return res.status(403).json({ error: "Path traversal detected" });
  }
  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: "File not found" });
  }
  try {
    const content = fs.readFileSync(resolved, "utf8");
    return res.type("text/plain").send(content);
  } catch (err) {
    console.error("[files/read] error:", err);
    return res.status(500).json({ error: err.message || "Failed to read file" });
  }
});

/**
 * POST /api/files/write
 * body: { path, content }
 * Writes (creates or overwrites) a file inside ./workspace.
 */
app.post("/api/files/write", (req, res) => {
  const { path: requestedPath, content } = req.body || {};
  if (!requestedPath || content === undefined) {
    return res.status(400).json({ error: "Missing body fields: path, content" });
  }
  const resolved = safeResolvePath(requestedPath);
  if (!resolved) {
    return res.status(403).json({ error: "Path traversal detected" });
  }
  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, "utf8");
    return res.json({ ok: true, path: requestedPath });
  } catch (err) {
    console.error("[files/write] error:", err);
    return res.status(500).json({ error: err.message || "Failed to write file" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/chat
 * body: {
 *   provider: "openrouter" | "ollama",
 *   model: string,
 *   messages: [{role, content}],
 *   ollamaUrl?: string  // only used when provider === "ollama"
 * }
 */
app.post("/api/chat", async (req, res) => {
  const { provider, model, messages, ollamaUrl } = req.body || {};

  if (!provider || !model || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Missing provider, model, or messages" });
  }

  try {
    if (provider === "openrouter") {
      if (!OPENROUTER_API_KEY) {
        return res.status(500).json({ error: "Server missing OPENROUTER_API_KEY env var" });
      }

      const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          // Optional but recommended by OpenRouter:
          "HTTP-Referer": process.env.PUBLIC_URL || "https://decursor.onrender.com",
          "X-Title": "Decursor",
        },
        body: JSON.stringify({ model, messages, stream: false }),
      });

      const data = await response.json();
      if (!response.ok) {
        console.error(`[chat/openrouter] API error ${response.status}:`, data.error?.message || data);
        return res.status(response.status).json({ error: data.error?.message || "OpenRouter error", raw: data });
      }

      const text = data.choices?.[0]?.message?.content || "";
      return res.json({ text, raw: data });
    }

    if (provider === "ollama") {
      const base = (ollamaUrl || DEFAULT_OLLAMA_URL || "").replace(/\/$/, "");
      if (!base) {
        return res.status(400).json({ error: "No Ollama URL configured. Set OLLAMA_URL env var or provide ollamaUrl in the request." });
      }

      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, stream: false }),
      });

      const data = await response.json();
      if (!response.ok) {
        console.error(`[chat/ollama] API error ${response.status}:`, data.error || data);
        return res.status(response.status).json({ error: data.error || "Ollama error", raw: data });
      }

      const text = data.message?.content || "";
      return res.json({ text, raw: data });
    }

    return res.status(400).json({ error: `Unknown provider: ${provider}` });
  } catch (err) {
    console.error("[chat] Unexpected error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
});

/**
 * POST /api/github/pull
 * body: { token, owner, repo, branch, path }
 * Returns: { content: string } — decoded file content
 */
app.post("/api/github/pull", async (req, res) => {
  const { token, owner, repo, branch, path } = req.body || {};

  if (!token || !owner || !repo || !path) {
    return res.status(400).json({ error: "Missing required fields: token, owner, repo, path" });
  }

  const ref = branch || "main";
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`;

  try {
    const ghRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Decursor",
      },
    });

    const data = await ghRes.json();

    if (!ghRes.ok) {
      console.error(`[github/pull] GitHub API error ${ghRes.status}:`, data.message || data);
      return res.status(ghRes.status).json({ error: data.message || "GitHub API error" });
    }

    if (data.encoding !== "base64" || !data.content) {
      console.error("[github/pull] Unexpected response format:", data);
      return res.status(500).json({ error: "Unexpected response format from GitHub" });
    }

    const content = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
    return res.json({ content, sha: data.sha, path: data.path });
  } catch (err) {
    console.error("[github/pull] Unexpected error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
});

/**
 * POST /api/github/push
 * body: { token, owner, repo, branch, path, content, message }
 * Returns: { commit: string } — commit SHA
 */
app.post("/api/github/push", async (req, res) => {
  const { token, owner, repo, branch, path, content, message } = req.body || {};

  if (!token || !owner || !repo || !path || content === undefined) {
    return res.status(400).json({ error: "Missing required fields: token, owner, repo, path, content" });
  }

  const ref = branch || "main";
  const contentsUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;

  try {
    // Step 1: fetch current file SHA (required for PUT)
    const getRes = await fetch(`${contentsUrl}?ref=${encodeURIComponent(ref)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Decursor",
      },
    });

    let sha;
    if (getRes.status === 404) {
      // File does not exist yet — creating a new file (no sha needed)
      sha = undefined;
    } else if (!getRes.ok) {
      const errData = await getRes.json();
      console.error(`[github/push] GET sha error ${getRes.status}:`, errData.message || errData);
      return res.status(getRes.status).json({ error: errData.message || "Failed to fetch file SHA from GitHub" });
    } else {
      const getData = await getRes.json();
      sha = getData.sha;
    }

    // Step 2: PUT (create or update) the file
    const encodedContent = Buffer.from(content, "utf8").toString("base64");
    const putBody = {
      message: message || `Update ${path} via Decursor`,
      content: encodedContent,
      branch: ref,
    };
    if (sha) putBody.sha = sha;

    const putRes = await fetch(contentsUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "Decursor",
      },
      body: JSON.stringify(putBody),
    });

    const putData = await putRes.json();

    if (!putRes.ok) {
      console.error(`[github/push] PUT error ${putRes.status}:`, putData.message || putData);
      return res.status(putRes.status).json({ error: putData.message || "GitHub API error on push" });
    }

    const commitSha = putData.commit?.sha || "ok";
    return res.json({ commit: commitSha });
  } catch (err) {
    console.error("[github/push] Unexpected error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
});

// ─── POST /api/exec ──────────────────────────────────────────────────────────
//
// WARNING: This endpoint executes arbitrary shell commands on the server.
// It is intentionally powerful and is protected by the DECURSOR_ACCESS_KEY
// auth middleware applied to all /api/ routes.
// NEVER expose this endpoint without authentication – remove or gate it
// behind a strong secret if deploying in any shared or public environment.
//
const EXEC_MAX_OUTPUT_BYTES = 100 * 1024; // 100 KB per stream
const EXEC_TIMEOUT_MS = 30_000;           // 30 seconds

/**
 * POST /api/exec
 * body: { command: string }
 * Returns: { stdout, stderr, exitCode }
 */
app.post("/api/exec", (req, res) => {
  const { command } = req.body || {};
  if (!command || typeof command !== "string") {
    return res.status(400).json({ error: "Missing body field: command (string)" });
  }

  const truncate = (str) => {
    if (Buffer.byteLength(str, "utf8") > EXEC_MAX_OUTPUT_BYTES) {
      return Buffer.from(str, "utf8").slice(0, EXEC_MAX_OUTPUT_BYTES).toString("utf8") + "\n...output truncated";
    }
    return str;
  };

  childExec(
    command,
    {
      cwd: WORKSPACE_ROOT,
      timeout: EXEC_TIMEOUT_MS,
      // Allow a bit more than our limit so we can detect overflow and truncate ourselves
      maxBuffer: EXEC_MAX_OUTPUT_BYTES + 4096,
    },
    (err, stdout, stderr) => {
      let exitCode = 0;
      if (err) {
        exitCode = typeof err.code === "number" ? err.code : 1;
        if (err.killed || err.signal) {
          stderr = (stderr || "") + `\n[Process killed: timeout or signal ${err.signal || "unknown"}]`;
        }
      }
      return res.json({
        stdout: truncate(stdout || ""),
        stderr: truncate(stderr || ""),
        exitCode,
      });
    }
  );
});

// ─── GET /api/models ──────────────────────────────────────────────────────────
/**
 * GET /api/models?provider=openrouter|ollama[&ollamaUrl=...]
 * Returns [{id, name}] for the requested provider.
 * OpenRouter endpoint is public (no auth header needed).
 * Ollama uses the configured OLLAMA_URL or the ollamaUrl query param.
 */
app.get("/api/models", async (req, res) => {
  const { provider, ollamaUrl: queryOllamaUrl } = req.query;

  if (!provider) {
    return res.status(400).json({ error: "Missing query param: provider" });
  }

  if (provider === "openrouter") {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models");
      if (!response.ok) {
        return res.status(response.status).json({ error: "Failed to fetch OpenRouter models" });
      }
      const data = await response.json();
      const models = (data.data || [])
        .slice(0, 30)
        .map((m) => ({ id: m.id, name: m.name || m.id }));
      return res.json(models);
    } catch (err) {
      console.error("[models/openrouter] error:", err);
      return res.status(500).json({ error: err.message || "Failed to fetch OpenRouter models" });
    }
  }

  if (provider === "ollama") {
    const base = (queryOllamaUrl || DEFAULT_OLLAMA_URL || "").replace(/\/$/, "");
    if (!base) {
      return res.status(400).json({
        error: "No Ollama URL configured. Set OLLAMA_URL env var or provide ollamaUrl query param.",
      });
    }
    try {
      const response = await fetch(`${base}/api/tags`);
      if (!response.ok) {
        return res.status(response.status).json({ error: "Failed to fetch Ollama models" });
      }
      const data = await response.json();
      const models = (data.models || []).map((m) => ({ id: m.name, name: m.name }));
      return res.json(models);
    } catch (err) {
      console.error("[models/ollama] error:", err);
      return res.status(500).json({ error: err.message || "Failed to fetch Ollama models" });
    }
  }

  return res.status(400).json({ error: `Unknown provider: ${provider}` });
});

// Simple healthcheck for Render
app.get("/healthz", (req, res) => res.send("ok"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Decursor server running on port ${PORT}`);
  console.log(`  OPENROUTER_API_KEY: ${OPENROUTER_API_KEY ? "set" : "NOT SET — OpenRouter requests will fail"}`);
  console.log(`  OLLAMA_URL: ${DEFAULT_OLLAMA_URL || "not set (ok if using OpenRouter)"}`);
});
