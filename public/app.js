// ---------- Config ----------
const BACKEND_BASE = ""; // same origin as this page (Render serves both)

// Grouped OpenRouter model list. Model IDs verified via GET https://openrouter.ai/api/v1/models.
const OPENROUTER_MODELS = [
  {
    group: "Besplatni",
    models: [
      { id: "meta-llama/llama-3.1-8b-instruct:free",          label: "Llama 3.1 8B" },
      { id: "meta-llama/llama-3.2-3b-instruct:free",          label: "Llama 3.2 3B" },
      { id: "meta-llama/llama-3.3-70b-instruct:free",         label: "Llama 3.3 70B" },
      { id: "google/gemini-flash-1.5:free",                   label: "Gemini Flash 1.5" },
      { id: "google/gemma-4-31b-it:free",                     label: "Gemma 4 31B" },
      { id: "qwen/qwen3-coder:free",                          label: "Qwen3 Coder 480B" },
      { id: "qwen/qwen3-next-80b-a3b-instruct:free",          label: "Qwen3 Next 80B" },
      { id: "nousresearch/hermes-3-llama-3.1-405b:free",      label: "Hermes 3 405B" },
      { id: "nvidia/nemotron-3-super-120b-a12b:free",         label: "Nemotron 3 Super 120B" },
      { id: "openai/gpt-oss-20b:free",                        label: "GPT OSS 20B" },
      { id: "cohere/north-mini-code:free",                    label: "Cohere North Mini Code" },
    ],
  },
  {
    group: "Plaćeni — opšti",
    models: [
      { id: "openai/gpt-4o-mini",                             label: "GPT-4o mini" },
      { id: "openai/gpt-4o",                                  label: "GPT-4o" },
      { id: "openai/gpt-4.1-mini",                            label: "GPT-4.1 Mini" },
      { id: "openai/gpt-4.1",                                 label: "GPT-4.1" },
      { id: "anthropic/claude-3.5-sonnet",                    label: "Claude 3.5 Sonnet" },
      { id: "anthropic/claude-haiku-4.5",                     label: "Claude Haiku 4.5" },
      { id: "anthropic/claude-sonnet-4",                      label: "Claude Sonnet 4" },
      { id: "anthropic/claude-opus-4",                        label: "Claude Opus 4" },
      { id: "google/gemini-2.5-flash",                        label: "Gemini 2.5 Flash" },
      { id: "google/gemini-2.5-pro",                          label: "Gemini 2.5 Pro" },
      { id: "deepseek/deepseek-chat",                         label: "DeepSeek V3 (cheap)" },
      { id: "deepseek/deepseek-chat-v3-0324",                 label: "DeepSeek V3 0324" },
      { id: "meta-llama/llama-4-scout",                       label: "Llama 4 Scout" },
      { id: "meta-llama/llama-4-maverick",                    label: "Llama 4 Maverick" },
      { id: "mistralai/mistral-small-3.2-24b-instruct",       label: "Mistral Small 3.2 24B" },
      { id: "mistralai/mistral-large-2512",                   label: "Mistral Large 3" },
      { id: "x-ai/grok-4.20",                                 label: "Grok 4.20" },
      { id: "x-ai/grok-4.3",                                  label: "Grok 4.3" },
    ],
  },
  {
    group: "Plaćeni — coding / reasoning",
    models: [
      { id: "qwen/qwen-2.5-coder-32b-instruct",              label: "Qwen 2.5 Coder 32B" },
      { id: "qwen/qwen3-coder",                               label: "Qwen3 Coder 480B" },
      { id: "mistralai/codestral-2508",                       label: "Codestral 2508" },
      { id: "mistralai/devstral-2512",                        label: "Devstral 2512" },
      { id: "deepseek/deepseek-r1",                           label: "DeepSeek R1" },
      { id: "deepseek/deepseek-r1-0528",                      label: "DeepSeek R1 0528" },
      { id: "openai/o3-mini",                                 label: "o3 Mini" },
      { id: "openai/o4-mini",                                 label: "o4 Mini" },
      { id: "moonshotai/kimi-k2.7-code",                      label: "Kimi K2.7 Code" },
      { id: "arcee-ai/coder-large",                           label: "Arcee Coder Large" },
    ],
  },
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
let lastMessageHadContext = false; // tracks whether last user msg included editor code

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
  if (providerSelect.value === "openrouter") {
    modelSelect.innerHTML = OPENROUTER_MODELS.map(({ group, models }) =>
      `<optgroup label="${group}">${models.map(m => `<option value="${m.id}">${m.label}</option>`).join("")}</optgroup>`
    ).join("");
  } else {
    modelSelect.innerHTML = OLLAMA_MODELS.map(m => `<option value="${m.id}">${m.label}</option>`).join("");
  }
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

  const label = document.createElement("div");
  label.className = "role-label";
  label.textContent = role === "user" ? "Ti" : "AI";
  div.appendChild(label);

  if (role === "assistant") {
    div.appendChild(renderAssistantMessage(content, lastMessageHadContext));
  } else {
    // User messages: plain text, safe by using textContent
    const span = document.createElement("span");
    span.textContent = content;
    div.appendChild(span);
  }

  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

// ---------- Apply-to-editor helpers ----------

/**
 * Extract all fenced code blocks from a markdown-like AI response.
 * Returns [{lang, code}] for each ```lang\n...\n``` block found.
 */
function extractCodeBlocks(text) {
  const blocks = [];
  const re = /```([^\n]*)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const code = m[2].replace(/\n$/, ""); // trim single trailing newline
    if (code) blocks.push({ lang: m[1].trim(), code });
  }
  return blocks;
}

/**
 * Apply code to the Monaco editor.
 * mode "cursor" → insert/replace current selection, preserving undo history.
 * mode "replace" → replace entire file content, preserving undo history.
 */
function applyToEditor(code, mode) {
  if (!editor) return;
  const model = editor.getModel();
  const range = mode === "replace"
    ? model.getFullModelRange()
    : editor.getSelection();
  editor.pushUndoStop();
  editor.executeEdits("chat-apply", [{ range, text: code, forceMoveMarkers: true }]);
  editor.pushUndoStop();
  editor.focus();
  showEditorStatus("Primijenjeno ✓  (Ctrl+Z za poništavanje)");
}

function showEditorStatus(msg) {
  const el = document.getElementById("editor-status");
  if (!el) return;
  el.textContent = msg;
  clearTimeout(el._statusTimer);
  el._statusTimer = setTimeout(() => { el.textContent = ""; }, 4000);
}

/** Build a styled code block element with "insert at cursor" and "replace editor" buttons. */
function createCodeBlockEl(code, lang, hadContext, isSoleBlock) {
  const wrapper = document.createElement("div");
  wrapper.className = "code-block-wrapper";

  // Header: language label + action buttons
  const header = document.createElement("div");
  header.className = "code-block-header";

  const langLabel = document.createElement("span");
  langLabel.className = "code-lang";
  langLabel.textContent = lang || "code";
  header.appendChild(langLabel);

  const btnGroup = document.createElement("div");
  btnGroup.className = "code-block-btns";

  // "Insert at cursor" button
  const btnInsert = document.createElement("button");
  btnInsert.className = "btn-code-action";
  btnInsert.title = "Ubaci na poziciju kursora u editoru";
  btnInsert.textContent = "↳ Na kursor";
  btnInsert.addEventListener("click", (e) => { e.stopPropagation(); applyToEditor(code, "cursor"); });
  btnGroup.appendChild(btnInsert);

  // "Replace editor" button — highlighted when AI likely returned a full file
  const btnReplace = document.createElement("button");
  if (hadContext && isSoleBlock) {
    // Context was sent → AI probably modified the whole file
    btnReplace.className = "btn-code-action btn-code-replace btn-code-replace-highlight";
    btnReplace.title = "Zamijeni cijeli sadržaj editora ovom verzijom fajla (Ctrl+Z za poništavanje)";
    btnReplace.textContent = "⟳ Zamijeni fajl";
  } else {
    btnReplace.className = "btn-code-action btn-code-replace";
    btnReplace.title = "Zamijeni cijeli sadržaj editora ovim kodom (Ctrl+Z za poništavanje)";
    btnReplace.textContent = "⟳ Zamijeni editor";
  }
  btnReplace.addEventListener("click", (e) => { e.stopPropagation(); applyToEditor(code, "replace"); });
  btnGroup.appendChild(btnReplace);

  header.appendChild(btnGroup);
  wrapper.appendChild(header);

  // Code body
  const pre = document.createElement("pre");
  pre.className = "code-block-body";
  pre.textContent = code;
  wrapper.appendChild(pre);

  return wrapper;
}

/**
 * Render an assistant message, splitting plain text and fenced code blocks.
 * Code blocks get inline "apply to editor" buttons.
 */
function renderAssistantMessage(content, hadContext) {
  const frag = document.createDocumentFragment();
  const re = /```([^\n]*)\n([\s\S]*?)```/g;
  let lastIdx = 0;
  let match;

  const allBlocks = extractCodeBlocks(content);
  const isSoleBlock = allBlocks.length === 1;

  while ((match = re.exec(content)) !== null) {
    // Text before this code block
    if (match.index > lastIdx) {
      const span = document.createElement("span");
      span.className = "msg-text";
      span.textContent = content.slice(lastIdx, match.index);
      frag.appendChild(span);
    }

    const lang = match[1].trim();
    const code = match[2].replace(/\n$/, "");
    if (code) {
      frag.appendChild(createCodeBlockEl(code, lang, hadContext, isSoleBlock));
    }
    lastIdx = re.lastIndex;
  }

  // Remaining text after the last code block (or the full content if no blocks)
  if (lastIdx < content.length) {
    const span = document.createElement("span");
    span.className = "msg-text";
    span.textContent = content.slice(lastIdx);
    frag.appendChild(span);
  }

  return frag;
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

  lastMessageHadContext = includeContext.checked;
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
