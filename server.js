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
        return res.status(response.status).json({ error: data.error?.message || "OpenRouter error", raw: data });
      }

      const text = data.choices?.[0]?.message?.content || "";
      return res.json({ text, raw: data });
    }

    if (provider === "ollama") {
      const base = (ollamaUrl || DEFAULT_OLLAMA_URL || "").replace(/\/$/, "");
      if (!base) {
        return res.status(400).json({ error: "No Ollama URL configured" });
      }

      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, stream: false }),
      });

      const data = await response.json();
      if (!response.ok) {
        return res.status(response.status).json({ error: data.error || "Ollama error", raw: data });
      }

      const text = data.message?.content || "";
      return res.json({ text, raw: data });
    }

    return res.status(400).json({ error: `Unknown provider: ${provider}` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
});

// Simple healthcheck for Render
app.get("/healthz", (req, res) => res.send("ok"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Decursor server running on port ${PORT}`));
