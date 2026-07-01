// ---------- Config ----------
const BACKEND_BASE = ""; // same origin as this page (Render serves both)

const OPENROUTER_MODELS = [
  // A small curated starter list - free + paid mix. Add more anytime.
  { id: "meta-llama/llama-3.1-8b-instruct:free", label: "Llama 3.1 8B (free)" },
  { id: "google/gemini-flash-1.5:free", label: "Gemini Flash 1.5 (free)" },
  { id: "deepseek/deepseek-chat", label: "DeepSeek Chat (paid, cheap)" },
  { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet (paid)" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o mini (paid)" },
  { id: "qwen/qwen-2.5-coder-32b-instruct", label: "Qwen 2.5 Coder 32B (paid, coding)" },
];

const OLLAMA_MODELS = [
  // Edit to match whatever you've pulled on your VPS
  { id: "qwen2.5-coder:7b", label: "Qwen 2.5 Coder 7B (self-hosted)" },
  { id: "deepseek-coder-v2", label: "DeepSeek Coder v2 (self-hosted)" },
  { id: "llama3.1:8b", label: "Llama 3.1 8B (self-hosted)" },
];

// ---------- State ----------
let editor;
let chatHistory = []; // {role, content}

// ---------- Monaco setup ----------
require.config({ paths: { vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs" } });
require(["vs/editor/editor.main"], function () {
  editor = monaco.editor.create(document.getElementById("monaco-container"), {
    value: "// Dobrodošla u Decursor\n// Piši kod ovdje, pitaj AI desno.\n",
    language: "javascript",
    theme: "vs-dark",
    automaticLayout: true,
    fontSize: 14,
    minimap: { enabled: false },
  });

  document.getElementById("filename-input").addEventListener("input", updateLanguageFromFilename);
});

function updateLanguageFromFilename() {
  const name = document.getElementById("filename-input").value || "";
  const ext = name.split(".").pop();
  const langMap = {
    js: "javascript", ts: "typescript", py: "python", html: "html",
    css: "css", json: "json", md: "markdown", java: "java",
    rb: "ruby", go: "go", php: "php", sh: "shell", yml: "yaml", yaml: "yaml",
  };
  const lang = langMap[ext] || "plaintext";
  if (editor) monaco.editor.setModelLanguage(editor.getModel(), lang);
}

// ---------- Provider / model dropdowns ----------
const providerSelect = document.getElementById("provider-select");
const modelSelect = document.getElementById("model-select");

function populateModels() {
  const list = providerSelect.value === "openrouter" ? OPENROUTER_MODELS : OLLAMA_MODELS;
  modelSelect.innerHTML = list.map(m => `<option value="${m.id}">${m.label}</option>`).join("");
}
providerSelect.addEventListener("change", populateModels);
populateModels();

// ---------- Chat ----------
const chatLog = document.getElementById("chat-log");
const chatInput = document.getElementById("chat-input");
const sendBtn = document.getElementById("send-btn");
const includeContext = document.getElementById("include-context");
const statusEl = document.getElementById("status");

function appendMessage(role, content) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.innerHTML = `<div class="role-label">${role === "user" ? "Ti" : "AI"}</div>${escapeHtml(content)}`;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function sendChat() {
  const userText = chatInput.value.trim();
  if (!userText) return;

  let finalUserContent = userText;
  if (includeContext.checked && editor) {
    const code = editor.getValue();
    const filename = document.getElementById("filename-input").value || "untitled";
    finalUserContent = `Fajl: ${filename}\n\`\`\`\n${code}\n\`\`\`\n\nPitanje: ${userText}`;
  }

  appendMessage("user", userText);
  chatHistory.push({ role: "user", content: finalUserContent });
  chatInput.value = "";
  sendBtn.disabled = true;
  statusEl.textContent = "Čekam odgovor...";

  const provider = providerSelect.value;
  const model = modelSelect.value;
  const ollamaUrl = localStorage.getItem("decursor_ollama_url") || "";

  try {
    const res = await fetch(`${BACKEND_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, model, messages: chatHistory, ollamaUrl }),
    });
    const data = await res.json();

    if (!res.ok) {
      appendMessage("assistant", `Greška: ${data.error || "nepoznata greška"}`);
    } else {
      appendMessage("assistant", data.text || "(prazan odgovor)");
      chatHistory.push({ role: "assistant", content: data.text || "" });
    }
  } catch (err) {
    appendMessage("assistant", `Greška u konekciji: ${err.message}`);
  } finally {
    sendBtn.disabled = false;
    statusEl.textContent = "";
  }
}

sendBtn.addEventListener("click", sendChat);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendChat();
});

// ---------- New file ----------
document.getElementById("new-file-btn").addEventListener("click", () => {
  if (!editor) return;
  if (!confirm("Obrisati trenutni sadržaj editora?")) return;
  editor.setValue("");
});

// ---------- GitHub integration ----------
const githubModal = document.getElementById("github-modal");
const ghStatus = document.getElementById("gh-status");

document.getElementById("github-btn").addEventListener("click", () => {
  // restore saved values
  document.getElementById("gh-token").value = localStorage.getItem("decursor_gh_token") || "";
  document.getElementById("gh-repo").value = localStorage.getItem("decursor_gh_repo") || "";
  document.getElementById("gh-branch").value = localStorage.getItem("decursor_gh_branch") || "main";
  document.getElementById("gh-path").value = document.getElementById("filename-input").value || "";
  githubModal.classList.add("open");
});
document.getElementById("gh-close-btn").addEventListener("click", () => {
  githubModal.classList.remove("open");
});

function saveGhSettings() {
  localStorage.setItem("decursor_gh_token", document.getElementById("gh-token").value);
  localStorage.setItem("decursor_gh_repo", document.getElementById("gh-repo").value);
  localStorage.setItem("decursor_gh_branch", document.getElementById("gh-branch").value);
}

async function githubPull() {
  saveGhSettings();
  const token = document.getElementById("gh-token").value.trim();
  const repo = document.getElementById("gh-repo").value.trim();
  const branch = document.getElementById("gh-branch").value.trim() || "main";
  const path = document.getElementById("gh-path").value.trim();

  if (!token || !repo || !path) {
    ghStatus.textContent = "Popuni token, repo i putanju fajla.";
    return;
  }

  const parts = repo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    ghStatus.textContent = "Repo mora biti u formatu owner/repo";
    return;
  }
  const [owner, repoName] = parts;

  ghStatus.textContent = "Učitavam...";
  try {
    const res = await fetch(`${BACKEND_BASE}/api/github/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, owner, repo: repoName, branch, path }),
    });
    const data = await res.json();

    if (!res.ok) {
      ghStatus.textContent = `Greška: ${data.error || "nepoznata greška"}`;
      return;
    }

    if (editor) editor.setValue(data.content || "");
    document.getElementById("filename-input").value = path.split("/").pop();
    updateLanguageFromFilename();
    ghStatus.textContent = `Učitano: ${path} (${branch})`;
  } catch (err) {
    ghStatus.textContent = `Greška konekcije: ${err.message}`;
  }
}

async function githubPush() {
  saveGhSettings();
  const token = document.getElementById("gh-token").value.trim();
  const repo = document.getElementById("gh-repo").value.trim();
  const branch = document.getElementById("gh-branch").value.trim() || "main";
  const path = document.getElementById("gh-path").value.trim();

  if (!token || !repo || !path) {
    ghStatus.textContent = "Popuni token, repo i putanju fajla.";
    return;
  }

  const parts = repo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    ghStatus.textContent = "Repo mora biti u formatu owner/repo";
    return;
  }
  const [owner, repoName] = parts;

  if (!editor) {
    ghStatus.textContent = "Editor nije spreman.";
    return;
  }

  const content = editor.getValue();
  const filename = document.getElementById("filename-input").value || path.split("/").pop();
  const message = `Update ${filename} via Decursor`;

  ghStatus.textContent = "Saljem...";
  try {
    const res = await fetch(`${BACKEND_BASE}/api/github/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, owner, repo: repoName, branch, path, content, message }),
    });
    const data = await res.json();

    if (!res.ok) {
      ghStatus.textContent = `Greška: ${data.error || "nepoznata greška"}`;
      return;
    }

    ghStatus.textContent = `Sačuvano! Commit: ${data.commit || "ok"}`;
  } catch (err) {
    ghStatus.textContent = `Greška konekcije: ${err.message}`;
  }
}

document.getElementById("gh-pull-btn").addEventListener("click", githubPull);
document.getElementById("gh-push-btn").addEventListener("click", githubPush);
