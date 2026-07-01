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

// Simple healthcheck for Render
app.get("/healthz", (req, res) => res.send("ok"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Decursor server running on port ${PORT}`);
  console.log(`  OPENROUTER_API_KEY: ${OPENROUTER_API_KEY ? "set" : "NOT SET — OpenRouter requests will fail"}`);
  console.log(`  OLLAMA_URL: ${DEFAULT_OLLAMA_URL || "not set (ok if using OpenRouter)"}`);
});
