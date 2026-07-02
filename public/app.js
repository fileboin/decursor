// ---------- Config ----------
const BACKEND_BASE = ""; // same origin as this page (Render serves both)

// Grouped OpenRouter model list.
// IDs and prices fetched live on 2026-07-01 from GET https://openrouter.ai/api/v1/models.
// Price format: "$<prompt>/$<completion> per M tokens".
const OPENROUTER_MODELS = [
  {
    // pricing.prompt === "0" in the API response
    group: "Besplatni",
    models: [
      { id: "google/gemma-4-31b-it:free",                    label: "Gemma 4 31B (besplatno)" },
      { id: "openai/gpt-oss-120b:free",                      label: "GPT OSS 120B (besplatno)" },
      { id: "qwen/qwen3-next-80b-a3b-instruct:free",         label: "Qwen3 Next 80B (besplatno)" },
      { id: "nvidia/nemotron-3-ultra-550b-a55b:free",        label: "Nemotron 3 Ultra 550B (besplatno)" },
      { id: "nvidia/nemotron-3-super-120b-a12b:free",        label: "Nemotron 3 Super 120B (besplatno)" },
      { id: "cohere/north-mini-code:free",                   label: "Cohere North Mini Code (besplatno)" },
    ],
  },
  {
    // Prices from API: claude-sonnet-5 prompt=0.000002, completion=0.00001 (per token)
    group: "Claude (Anthropic)",
    models: [
      { id: "anthropic/claude-sonnet-5",   label: "Claude Sonnet 5 ($2/$10 per M)" },
      { id: "anthropic/claude-opus-4.8",   label: "Claude Opus 4.8 ($5/$25 per M)" },
      { id: "anthropic/claude-haiku-4.5",  label: "Claude Haiku 4.5 ($1/$5 per M)" },
    ],
  },
  {
    // Prices from API: live call 2026-07-01 GET https://openrouter.ai/api/v1/models
    group: "Gemini (Google)",
    models: [
      { id: "google/gemini-2.5-flash-lite",                  label: "Gemini 2.5 Flash Lite ($0.10/$0.40 per M)" },
      { id: "google/gemini-2.5-flash",                       label: "Gemini 2.5 Flash ($0.30/$2.50 per M)" },
      { id: "google/gemini-2.5-pro",                         label: "Gemini 2.5 Pro ($1.25/$10 per M)" },
      { id: "google/gemini-2.5-pro-preview",                 label: "Gemini 2.5 Pro Preview 06-05 ($1.25/$10 per M)" },
      { id: "google/gemini-2.5-pro-preview-05-06",           label: "Gemini 2.5 Pro Preview 05-06 ($1.25/$10 per M)" },
      { id: "google/gemini-2.5-flash-lite-preview-09-2025",  label: "Gemini 2.5 Flash Lite Preview 09-2025 ($0.10/$0.40 per M)" },
      { id: "google/gemini-2.5-flash-image",                 label: "Nano Banana (Gemini 2.5 Flash Image) ($0.30/$2.50 per M)" },
      { id: "google/gemini-3.5-flash",                       label: "Gemini 3.5 Flash ($1.50/$9 per M)" },
      { id: "google/gemini-3.1-flash-lite",                  label: "Gemini 3.1 Flash Lite ($0.25/$1.50 per M)" },
      { id: "google/gemini-3.1-flash-lite-preview",          label: "Gemini 3.1 Flash Lite Preview ($0.25/$1.50 per M)" },
      { id: "google/gemini-3.1-flash-image",                 label: "Nano Banana 2 (Gemini 3.1 Flash Image) ($0.50/$3 per M)" },
      { id: "google/gemini-3.1-flash-image-preview",         label: "Nano Banana 2 (Gemini 3.1 Flash Image Preview) ($0.50/$3 per M)" },
      { id: "google/gemini-3.1-flash-lite-image",            label: "Nano Banana 2 Lite (Gemini 3.1 Flash Lite Image) ($0.25/$1.50 per M)" },
      { id: "google/gemini-3.1-pro-preview",                 label: "Gemini 3.1 Pro Preview ($2/$12 per M)" },
      { id: "google/gemini-3.1-pro-preview-customtools",     label: "Gemini 3.1 Pro Preview Custom Tools ($2/$12 per M)" },
      { id: "google/gemini-3-flash-preview",                 label: "Gemini 3 Flash Preview ($0.50/$3 per M)" },
      { id: "google/gemini-3-pro-image",                     label: "Nano Banana Pro (Gemini 3 Pro Image) ($2/$12 per M)" },
      { id: "google/gemini-3-pro-image-preview",             label: "Nano Banana Pro (Gemini 3 Pro Image Preview) ($2/$12 per M)" },
      { id: "google/gemma-4-31b-it",                         label: "Gemma 4 31B ($0.12/$0.35 per M)" },
      { id: "google/gemma-4-31b-it:free",                    label: "Gemma 4 31B (besplatno)" },
      { id: "google/gemma-4-26b-a4b-it",                     label: "Gemma 4 26B A4B ($0.06/$0.33 per M)" },
      { id: "google/gemma-4-26b-a4b-it:free",                label: "Gemma 4 26B A4B (besplatno)" },
      { id: "google/gemma-3n-e4b-it",                        label: "Gemma 3n 4B ($0.06/$0.12 per M)" },
      { id: "google/gemma-3-27b-it",                         label: "Gemma 3 27B ($0.08/$0.16 per M)" },
      { id: "google/gemma-3-12b-it",                         label: "Gemma 3 12B ($0.05/$0.15 per M)" },
      { id: "google/gemma-3-4b-it",                          label: "Gemma 3 4B ($0.05/$0.10 per M)" },
      { id: "google/gemma-2-27b-it",                         label: "Gemma 2 27B ($0.65/$0.65 per M)" },
      { id: "google/lyria-3-pro-preview",                    label: "Lyria 3 Pro Preview ($0/$0 per M)" },
      { id: "google/lyria-3-clip-preview",                   label: "Lyria 3 Clip Preview ($0/$0 per M)" },
    ],
  },
  {
    // Prices from API: deepseek-v4-pro prompt=0.000000435, completion=0.00000087 (per token)
    group: "DeepSeek / Coding",
    models: [
      { id: "deepseek/deepseek-v4-flash",  label: "DeepSeek V4 Flash ($0.09/$0.18 per M)" },
      { id: "deepseek/deepseek-v4-pro",    label: "DeepSeek V4 Pro ($0.44/$0.87 per M)" },
      { id: "deepseek/deepseek-v3.2",      label: "DeepSeek V3.2 ($0.23/$0.34 per M)" },
      { id: "deepseek/deepseek-r1-0528",   label: "DeepSeek R1 0528 ($0.50/$2.15 per M)" },
    ],
  },
  {
    // Prices from API: glm-5.2 prompt=0.00000093, completion=0.000003 (per token)
    group: "Ostali jaki modeli",
    models: [
      { id: "z-ai/glm-5.2",          label: "GLM 5.2 ($0.93/$3 per M)" },
      { id: "minimax/minimax-m3",    label: "MiniMax M3 ($0.30/$1.20 per M)" },
    ],
  },
  {
    // Prices from API: live call 2026-07-01 GET https://openrouter.ai/api/v1/models
    group: "GPT (OpenAI)",
    models: [
      { id: "openai/gpt-5.5",                    label: "GPT-5.5 ($5/$30 per M)" },
      { id: "openai/gpt-5.5-pro",                label: "GPT-5.5 Pro ($30/$180 per M)" },
      { id: "openai/gpt-5.4",                    label: "GPT-5.4 ($2.50/$15 per M)" },
      { id: "openai/gpt-5.4-pro",                label: "GPT-5.4 Pro ($30/$180 per M)" },
      { id: "openai/gpt-5.4-mini",               label: "GPT-5.4 Mini ($0.75/$4.50 per M)" },
      { id: "openai/gpt-5.4-nano",               label: "GPT-5.4 Nano ($0.20/$1.25 per M)" },
      { id: "openai/gpt-5.4-image-2",            label: "GPT-5.4 Image 2 ($8/$15 per M)" },
      { id: "openai/gpt-5.3-chat",               label: "GPT-5.3 Chat ($1.75/$14 per M)" },
      { id: "openai/gpt-5.3-codex",              label: "GPT-5.3-Codex ($1.75/$14 per M)" },
      { id: "openai/gpt-5.2",                    label: "GPT-5.2 ($1.75/$14 per M)" },
      { id: "openai/gpt-5.2-pro",                label: "GPT-5.2 Pro ($21/$168 per M)" },
      { id: "openai/gpt-5.2-chat",               label: "GPT-5.2 Chat ($1.75/$14 per M)" },
      { id: "openai/gpt-5.2-codex",              label: "GPT-5.2-Codex ($1.75/$14 per M)" },
      { id: "openai/gpt-5.1",                    label: "GPT-5.1 ($1.25/$10 per M)" },
      { id: "openai/gpt-5.1-chat",               label: "GPT-5.1 Chat ($1.25/$10 per M)" },
      { id: "openai/gpt-5.1-codex",              label: "GPT-5.1-Codex ($1.25/$10 per M)" },
      { id: "openai/gpt-5.1-codex-max",          label: "GPT-5.1-Codex-Max ($1.25/$10 per M)" },
      { id: "openai/gpt-5.1-codex-mini",         label: "GPT-5.1-Codex-Mini ($0.25/$2 per M)" },
      { id: "openai/gpt-5",                      label: "GPT-5 ($1.25/$10 per M)" },
      { id: "openai/gpt-5-pro",                  label: "GPT-5 Pro ($15/$120 per M)" },
      { id: "openai/gpt-5-chat",                 label: "GPT-5 Chat ($1.25/$10 per M)" },
      { id: "openai/gpt-5-codex",                label: "GPT-5 Codex ($1.25/$10 per M)" },
      { id: "openai/gpt-5-mini",                 label: "GPT-5 Mini ($0.25/$2 per M)" },
      { id: "openai/gpt-5-nano",                 label: "GPT-5 Nano ($0.05/$0.40 per M)" },
      { id: "openai/gpt-5-image",                label: "GPT-5 Image ($10/$10 per M)" },
      { id: "openai/gpt-5-image-mini",           label: "GPT-5 Image Mini ($2.50/$2 per M)" },
      { id: "openai/gpt-chat-latest",            label: "GPT Chat Latest ($5/$30 per M)" },
      { id: "openai/gpt-audio",                  label: "GPT Audio ($2.50/$10 per M)" },
      { id: "openai/gpt-audio-mini",             label: "GPT Audio Mini ($0.60/$2.40 per M)" },
      { id: "openai/o4-mini",                    label: "o4 Mini ($1.10/$4.40 per M)" },
      { id: "openai/o4-mini-high",               label: "o4 Mini High ($1.10/$4.40 per M)" },
      { id: "openai/o4-mini-deep-research",      label: "o4 Mini Deep Research ($2/$8 per M)" },
      { id: "openai/o3",                         label: "o3 ($2/$8 per M)" },
      { id: "openai/o3-pro",                     label: "o3 Pro ($20/$80 per M)" },
      { id: "openai/o3-deep-research",           label: "o3 Deep Research ($10/$40 per M)" },
      { id: "openai/o3-mini",                    label: "o3 Mini ($1.10/$4.40 per M)" },
      { id: "openai/o3-mini-high",               label: "o3 Mini High ($1.10/$4.40 per M)" },
      { id: "openai/o1",                         label: "o1 ($15/$60 per M)" },
      { id: "openai/o1-pro",                     label: "o1-pro ($150/$600 per M)" },
      { id: "openai/gpt-4.1",                    label: "GPT-4.1 ($2/$8 per M)" },
      { id: "openai/gpt-4.1-mini",               label: "GPT-4.1 Mini ($0.40/$1.60 per M)" },
      { id: "openai/gpt-4.1-nano",               label: "GPT-4.1 Nano ($0.10/$0.40 per M)" },
      { id: "openai/gpt-4o",                     label: "GPT-4o ($2.50/$10 per M)" },
      { id: "openai/gpt-4o-2024-11-20",          label: "GPT-4o (2024-11-20) ($2.50/$10 per M)" },
      { id: "openai/gpt-4o-2024-08-06",          label: "GPT-4o (2024-08-06) ($2.50/$10 per M)" },
      { id: "openai/gpt-4o-2024-05-13",          label: "GPT-4o (2024-05-13) ($5/$15 per M)" },
      { id: "openai/gpt-4o-search-preview",      label: "GPT-4o Search Preview ($2.50/$10 per M)" },
      { id: "openai/gpt-4o-mini",                label: "GPT-4o-mini ($0.15/$0.60 per M)" },
      { id: "openai/gpt-4o-mini-2024-07-18",     label: "GPT-4o-mini (2024-07-18) ($0.15/$0.60 per M)" },
      { id: "openai/gpt-4o-mini-search-preview", label: "GPT-4o-mini Search Preview ($0.15/$0.60 per M)" },
      { id: "openai/gpt-4",                      label: "GPT-4 ($30/$60 per M)" },
      { id: "openai/gpt-4-turbo",                label: "GPT-4 Turbo ($10/$30 per M)" },
      { id: "openai/gpt-4-turbo-preview",        label: "GPT-4 Turbo Preview ($10/$30 per M)" },
      { id: "openai/gpt-3.5-turbo",              label: "GPT-3.5 Turbo ($0.50/$1.50 per M)" },
      { id: "openai/gpt-3.5-turbo-16k",          label: "GPT-3.5 Turbo 16k ($3/$4 per M)" },
      { id: "openai/gpt-3.5-turbo-instruct",     label: "GPT-3.5 Turbo Instruct ($1.50/$2 per M)" },
      { id: "openai/gpt-3.5-turbo-0613",         label: "GPT-3.5 Turbo (older v0613) ($1/$2 per M)" },
      { id: "openai/gpt-oss-120b",               label: "gpt-oss-120b ($0.03/$0.15 per M)" },
      { id: "openai/gpt-oss-120b:free",          label: "gpt-oss-120b (besplatno)" },
      { id: "openai/gpt-oss-20b",                label: "gpt-oss-20b ($0.03/$0.14 per M)" },
      { id: "openai/gpt-oss-20b:free",           label: "gpt-oss-20b (besplatno)" },
      { id: "openai/gpt-oss-safeguard-20b",      label: "gpt-oss-safeguard-20b ($0.07/$0.30 per M)" },
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
let currentOpenFilePath = null; // workspace-relative path of the currently open file

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
    c: "c", cpp: "cpp", cs: "csharp", rs: "rust", swift: "swift", kt: "kotlin",
  };
  const lang = langMap[ext] || "plaintext";
  if (editor) monaco.editor.setModelLanguage(editor.getModel(), lang);
}

// ---------- File tree ----------

/** Convert the flat [{path, type}] array from /api/files into a nested tree. */
function flatToTree(entries) {
  const root = { children: {} };
  for (const entry of entries) {
    const parts = entry.path.replace(/\\/g, "/").split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!node.children[part]) {
        node.children[part] = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          type: i === parts.length - 1 ? entry.type : "dir",
          children: {},
        };
      }
      node = node.children[part];
    }
  }
  return root.children;
}

/** Recursively build a <ul> DOM element for the given children map. */
function renderTreeNodes(childrenMap, depth) {
  const ul = document.createElement("ul");

  // Sort: dirs first, then files, both alphabetically
  const nodes = Object.values(childrenMap).sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const node of nodes) {
    const li = document.createElement("li");

    const item = document.createElement("div");
    item.className = `tree-item tree-${node.type}`;
    item.style.paddingLeft = `${6 + depth * 14}px`;
    item.dataset.path = node.path;

    if (node.type === "dir") {
      const arrow = document.createElement("span");
      arrow.className = "tree-arrow";
      arrow.textContent = "▶";
      item.appendChild(arrow);

      const icon = document.createElement("span");
      icon.textContent = "📁 ";
      item.appendChild(icon);

      const name = document.createElement("span");
      name.textContent = node.name;
      item.appendChild(name);

      const childrenContainer = document.createElement("div");
      childrenContainer.className = "tree-children";

      if (node.children && Object.keys(node.children).length > 0) {
        childrenContainer.appendChild(renderTreeNodes(node.children, depth + 1));
      }

      item.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = childrenContainer.classList.contains("open");
        childrenContainer.classList.toggle("open", !isOpen);
        arrow.classList.toggle("open", !isOpen);
        icon.textContent = isOpen ? "📁 " : "📂 ";
      });

      li.appendChild(item);
      li.appendChild(childrenContainer);
    } else {
      const spacer = document.createElement("span");
      spacer.style.display = "inline-block";
      spacer.style.width = "14px";
      item.appendChild(spacer);

      const icon = document.createElement("span");
      icon.textContent = "📄 ";
      item.appendChild(icon);

      const name = document.createElement("span");
      name.textContent = node.name;
      item.appendChild(name);

      item.addEventListener("click", (e) => {
        e.stopPropagation();
        openFile(node.path, item);
      });

      li.appendChild(item);
    }

    ul.appendChild(li);
  }

  return ul;
}

async function loadFileTree() {
  const treeEl = document.getElementById("file-tree");
  treeEl.innerHTML = '<p class="tree-empty">Učitavam...</p>';
  try {
    const res = await fetch(`${BACKEND_BASE}/api/files`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const entries = await res.json();
    treeEl.innerHTML = "";
    if (!entries.length) {
      treeEl.innerHTML = '<p class="tree-empty">Workspace je prazan.</p>';
      return;
    }
    const tree = flatToTree(entries);
    treeEl.appendChild(renderTreeNodes(tree, 0));
  } catch (err) {
    treeEl.innerHTML = `<p class="tree-empty">Greška: ${err.message}</p>`;
  }
}

let activeTreeItem = null;

async function openFile(filePath, itemEl) {
  if (!editor) {
    showEditorStatus("Editor se još učitava...");
    return;
  }
  showEditorStatus("Učitavam...");
  try {
    const res = await fetch(`${BACKEND_BASE}/api/files/read?path=${encodeURIComponent(filePath)}`);
    if (!res.ok) {
      const msg = await res.text();
      showEditorStatus(`Greška: ${msg}`);
      return;
    }
    const content = await res.text();
    editor.setValue(content);

    const filename = filePath.split("/").pop();
    document.getElementById("filename-input").value = filename;
    updateLanguageFromFilename();

    currentOpenFilePath = filePath;
    showEditorStatus(`Otvoren: ${filePath}`);

    // Update active highlight in tree
    if (activeTreeItem) activeTreeItem.classList.remove("active");
    if (itemEl) { itemEl.classList.add("active"); activeTreeItem = itemEl; }
  } catch (err) {
    showEditorStatus(`Greška: ${err.message}`);
  }
}

async function saveFile() {
  if (!editor) return;
  const filePath = currentOpenFilePath || document.getElementById("filename-input").value.trim();
  if (!filePath) {
    showEditorStatus("Unesite naziv fajla u toolbar.");
    return;
  }
  const content = editor.getValue();
  showEditorStatus("Snimam...");
  try {
    const res = await fetch(`${BACKEND_BASE}/api/files/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath, content }),
    });
    const data = await res.json();
    if (!res.ok) {
      showEditorStatus(`Greška: ${data.error || "nepoznata greška"}`);
      return;
    }
    if (!currentOpenFilePath) {
      currentOpenFilePath = filePath;
      loadFileTree(); // refresh tree to show newly created file
    }
    showEditorStatus(`Sačuvano ✓  ${filePath}`);
  } catch (err) {
    showEditorStatus(`Greška: ${err.message}`);
  }
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
  const hasContext = includeContext.checked && !!editor;
  if (hasContext) {
    const code = editor.getValue();
    const filename = document.getElementById("filename-input").value || "untitled";
    finalUserContent = `Fajl: ${filename}\n\`\`\`\n${code}\n\`\`\`\n\nPitanje: ${userText}`;
  }

  lastMessageHadContext = hasContext;
  appendMessage("user", userText);
  chatHistory.push({ role: "user", content: finalUserContent });
  chatInput.value = "";
  sendBtn.disabled = true;
  statusEl.textContent = "Čekam odgovor...";

  // Create the assistant message container immediately so text can stream into it
  const assistantDiv = document.createElement("div");
  assistantDiv.className = "msg assistant";
  const roleLabel = document.createElement("div");
  roleLabel.className = "role-label";
  roleLabel.textContent = "AI";
  assistantDiv.appendChild(roleLabel);
  const streamSpan = document.createElement("span");
  streamSpan.className = "msg-text";
  streamSpan.textContent = "▌";
  assistantDiv.appendChild(streamSpan);
  chatLog.appendChild(assistantDiv);
  chatLog.scrollTop = chatLog.scrollHeight;

  const provider = providerSelect.value;
  const model = modelSelect.value;
  const ollamaUrl = localStorage.getItem("decursor_ollama_url") || "";

  let fullText = "";

  try {
    const res = await fetch(`${BACKEND_BASE}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, model, messages: chatHistory, ollamaUrl }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: res.statusText }));
      fullText = `Greška: ${errData.error || "nepoznata greška"}`;
    } else {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamDone = false;

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Split on newlines; keep any incomplete trailing line in buffer
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const raw = trimmed.slice(5).trim();
          if (raw === "[DONE]") { streamDone = true; break outer; }
          try {
            const parsed = JSON.parse(raw);
            if (parsed.delta != null) {
              fullText += parsed.delta;
              streamSpan.textContent = fullText + "▌";
              chatLog.scrollTop = chatLog.scrollHeight;
            }
            if (parsed.error) {
              fullText = fullText
                ? fullText + `\n\n[Greška: ${parsed.error}]`
                : `Greška: ${parsed.error}`;
              streamDone = true;
              break outer;
            }
          } catch (_) { /* skip malformed SSE lines */ }
        }
      }
    }
  } catch (err) {
    fullText = `Greška u konekciji: ${err.message}`;
  } finally {
    // Replace streaming span with properly rendered content
    streamSpan.remove();
    const rendered = renderAssistantMessage(fullText || "(prazan odgovor)", lastMessageHadContext);
    assistantDiv.appendChild(rendered);
    chatLog.scrollTop = chatLog.scrollHeight;

    if (fullText) chatHistory.push({ role: "assistant", content: fullText });

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

// ---------- File tree & Save wiring ----------
document.getElementById("save-btn").addEventListener("click", saveFile);
document.getElementById("refresh-tree-btn").addEventListener("click", loadFileTree);

// Ctrl+S / Cmd+S shortcut to save
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    saveFile();
  }
});

// Load file tree on startup
loadFileTree();
