// ---------- Config ----------
const BACKEND_BASE = ""; // same origin as this page (Render serves both)

// ---------- State ----------
let editor;
let chatHistory = []; // {role, content}
let lastMessageHadContext = false; // tracks whether last user msg included editor code
let currentOpenFilePath = null; // workspace-relative path of the currently open file
const selectedFiles = new Set(); // workspace-relative paths checked for multi-file context

// ---------- Auth ----------
let accessKey = "";
{
  const k = prompt("Decursor pristupni ključ (ostavite prazno ako nije podešen):");
  accessKey = (k !== null) ? k.trim() : "";
}

/**
 * Wrapper around fetch() that automatically injects the x-decursor-key header
 * on every /api/ request.
 */
function apiFetch(url, options) {
  const opts = options ? { ...options } : {};
  opts.headers = { ...(opts.headers || {}) };
  if (accessKey) opts.headers["x-decursor-key"] = accessKey;
  return fetch(url, opts);
}

// ---------- Monaco setup ----------
require.config({ paths: { vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs" } });
require(["vs/editor/editor.main"], function () {
  const savedTheme = document.documentElement.getAttribute("data-theme") || "dark";
  const savedFontSize = Math.max(12, Math.min(22, parseInt(localStorage.getItem("decursor-font-size")) || 14));
  editor = monaco.editor.create(document.getElementById("monaco-container"), {
    value: "// Dobrodošla u Decursor\n// Piši kod ovdje, pitaj AI desno.\n",
    language: "javascript",
    theme: savedTheme === "light" ? "vs" : "vs-dark",
    automaticLayout: true,
    fontSize: savedFontSize,
    minimap: { enabled: false },
  });

  document.getElementById("filename-input").addEventListener("input", updateLanguageFromFilename);

  // Activate Monacopilot inline completions if the toggle was saved as enabled
  if (localStorage.getItem("decursor-monacopilot") !== "0") {
    toggleAICompletion(true);
  }
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
      // Checkbox for multi-file context selection
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "file-checkbox";
      cb.checked = selectedFiles.has(node.path);
      cb.title = "Dodaj u kontekst chata";
      cb.addEventListener("click", (e) => {
        e.stopPropagation();
        if (cb.checked) {
          selectedFiles.add(node.path);
        } else {
          selectedFiles.delete(node.path);
        }
        updateSelectedFilesCount();
      });
      item.appendChild(cb);

      const spacer = document.createElement("span");
      spacer.style.display = "inline-block";
      spacer.style.width = "6px";
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
    const res = await apiFetch(`${BACKEND_BASE}/api/files`);
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

/** Update the selected-files counter shown above the chat input. */
function updateSelectedFilesCount() {
  const el = document.getElementById("selected-files-info");
  if (!el) return;
  if (selectedFiles.size === 0) {
    el.style.display = "none";
    el.textContent = "";
  } else {
    el.style.display = "block";
    el.textContent = `📎 ${selectedFiles.size} fajl${selectedFiles.size === 1 ? "" : "a"} selektovano za kontekst`;
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
    const res = await apiFetch(`${BACKEND_BASE}/api/files/read?path=${encodeURIComponent(filePath)}`);
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
    const res = await apiFetch(`${BACKEND_BASE}/api/files/write`, {
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
const modelFallbackInput = document.getElementById("model-input-fallback");
const modelSearchInput = document.getElementById("model-search");

// In-memory state for last chosen provider and model (not persisted to localStorage)
let selectedProvider = providerSelect.value;
let selectedModel = "";

// Full unfiltered model list loaded from backend — never sliced
let allModels = [];

/** Return current model value from whichever control is visible. */
function getSelectedModel() {
  if (modelFallbackInput.style.display !== "none") {
    return modelFallbackInput.value.trim();
  }
  return modelSelect.value;
}

/**
 * Rebuild the <select> options based on the current search term.
 * Free models (:free in id) always appear first, then the rest sorted by name.
 * No backend filtering — only controls what is visible in the dropdown.
 */
function renderModelOptions(query) {
  const q = (query || "").toLowerCase();
  const filtered = q
    ? allModels.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
    : allModels;

  const prev = modelSelect.value;
  modelSelect.innerHTML = filtered
    .map((m) => `<option value="${m.id}">${m.name}</option>`)
    .join("");

  // Preserve previously selected model if it is still in the filtered list
  if (prev && filtered.some((m) => m.id === prev)) {
    modelSelect.value = prev;
  }
  selectedModel = modelSelect.value;
}

async function populateModels() {
  selectedProvider = providerSelect.value;

  allModels = [];
  modelSelect.innerHTML = '<option value="">Učitavam modele...</option>';
  modelSelect.disabled = true;
  modelSelect.style.display = "";
  modelFallbackInput.style.display = "none";

  if (modelSearchInput) {
    modelSearchInput.value = "";
    modelSearchInput.style.display = selectedProvider === "openrouter" ? "" : "none";
  }

  const ollamaUrl = localStorage.getItem("decursor_ollama_url") || "";
  const params = new URLSearchParams({ provider: selectedProvider });
  if (selectedProvider === "ollama" && ollamaUrl) params.set("ollamaUrl", ollamaUrl);

  try {
    const res = await apiFetch(`${BACKEND_BASE}/api/models?${params}`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }
    const models = await res.json();
    if (!Array.isArray(models) || models.length === 0) throw new Error("Nema dostupnih modela");

    // Sort: free models first, then alphabetically by name — no filtering
    allModels = models.slice().sort((a, b) => {
      const aFree = a.id.includes(":free");
      const bFree = b.id.includes(":free");
      if (aFree !== bFree) return aFree ? -1 : 1;
      return (a.name || a.id).localeCompare(b.name || b.id);
    });

    renderModelOptions("");
    modelSelect.disabled = false;
  } catch (err) {
    console.warn("[populateModels] Failed, showing fallback input:", err.message);
    modelSelect.style.display = "none";
    if (modelSearchInput) modelSearchInput.style.display = "none";
    modelFallbackInput.style.display = "";
    modelFallbackInput.placeholder = "ID modela (lista nedostupna)";
    selectedModel = modelFallbackInput.value.trim();
  }
}

if (modelSearchInput) {
  modelSearchInput.addEventListener("input", () => {
    renderModelOptions(modelSearchInput.value);
  });
}

modelFallbackInput.addEventListener("input", () => {
  selectedModel = modelFallbackInput.value.trim();
});

modelSelect.addEventListener("change", () => {
  selectedModel = modelSelect.value;
});

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

// ---------- Line diff algorithm ----------

/**
 * Compute a line-by-line diff between two strings using LCS.
 * Returns [{type: "added"|"removed"|"unchanged", line: string}].
 * Falls back to a simple add/remove for very large inputs.
 */
function computeLineDiff(oldStr, newStr) {
  const toLines = (s) => {
    if (s === "") return [];
    const parts = s.split("\n");
    if (parts[parts.length - 1] === "") parts.pop();
    return parts;
  };
  const oldLines = toLines(oldStr);
  const newLines = toLines(newStr);
  const m = oldLines.length;
  const n = newLines.length;

  // For very large files skip LCS to avoid freezing the browser
  if (m * n > 600000) {
    const result = [];
    for (const line of oldLines) result.push({ type: "removed", line });
    for (const line of newLines) result.push({ type: "added",   line });
    return result;
  }

  // Build LCS table
  const dp = [];
  for (let i = 0; i <= m; i++) dp.push(new Int32Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to produce diff
  const result = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: "unchanged", line: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: "added",   line: newLines[j - 1] });
      j--;
    } else {
      result.unshift({ type: "removed", line: oldLines[i - 1] });
      i--;
    }
  }
  return result;
}

// ---------- Diff modal ----------

/**
 * Show a diff modal comparing oldCode (current file) with newCode (proposed).
 * Returns a Promise that resolves to true (Accept) or false (Reject).
 */
function showDiffModal(oldCode, newCode) {
  return new Promise((resolve) => {
    const modal    = document.getElementById("diff-modal");
    const diffView = document.getElementById("diff-view");
    const subtitle = document.getElementById("diff-modal-subtitle");

    const isNewFile = oldCode === "";
    subtitle.textContent = isNewFile
      ? `Novi fajl — ${currentOpenFilePath || "nepoznat"} (sav sadržaj je novi)`
      : `Fajl: ${currentOpenFilePath || "nepoznat"}`;

    diffView.innerHTML = "";
    const changes = computeLineDiff(oldCode, newCode);

    if (changes.length === 0) {
      const div = document.createElement("div");
      div.className = "diff-line diff-line-unchanged";
      div.textContent = "  (nema izmjena)";
      diffView.appendChild(div);
    } else {
      for (const { type, line } of changes) {
        const div = document.createElement("div");
        div.className = `diff-line diff-line-${type}`;
        const prefix = type === "added" ? "+" : type === "removed" ? "-" : " ";
        div.textContent = prefix + " " + line;
        diffView.appendChild(div);
      }
    }

    modal.classList.add("open");

    const acceptBtn = document.getElementById("diff-accept-btn");
    const rejectBtn = document.getElementById("diff-reject-btn");

    function cleanup() {
      modal.classList.remove("open");
      acceptBtn.removeEventListener("click", onAccept);
      rejectBtn.removeEventListener("click", onReject);
    }
    function onAccept() { cleanup(); resolve(true);  }
    function onReject() { cleanup(); resolve(false); }

    acceptBtn.addEventListener("click", onAccept);
    rejectBtn.addEventListener("click", onReject);
  });
}

// ---------- Exec confirm modal ----------

/**
 * Show a confirmation modal before executing a shell command.
 * Returns a Promise that resolves to true (run) or false (cancel).
 */
function showExecConfirmModal(command) {
  return new Promise((resolve) => {
    const modal = document.getElementById("exec-confirm-modal");
    document.getElementById("exec-confirm-cmd").textContent = command;
    modal.classList.add("open");

    const acceptBtn = document.getElementById("exec-accept-btn");
    const rejectBtn = document.getElementById("exec-reject-btn");

    function cleanup() {
      modal.classList.remove("open");
      acceptBtn.removeEventListener("click", onAccept);
      rejectBtn.removeEventListener("click", onReject);
    }
    function onAccept() { cleanup(); resolve(true);  }
    function onReject() { cleanup(); resolve(false); }

    acceptBtn.addEventListener("click", onAccept);
    rejectBtn.addEventListener("click", onReject);
  });
}

/**
 * Write `code` to the currently open workspace file via /api/files/write,
 * then refresh the Monaco editor with the new content.
 * Shows a diff preview first; only writes on Accept.
 */
async function applyToFile(code) {
  if (!currentOpenFilePath) {
    showEditorStatus("Nema otvorenog fajla za primjenu.");
    return;
  }

  // Fetch current file content for diff (empty string = new file → show all as added)
  let oldContent = "";
  try {
    const readRes = await apiFetch(
      `${BACKEND_BASE}/api/files/read?path=${encodeURIComponent(currentOpenFilePath)}`
    );
    if (readRes.ok) oldContent = await readRes.text();
  } catch (_) { /* treat as new file */ }

  const accepted = await showDiffModal(oldContent, code);
  if (!accepted) return;

  showEditorStatus("Primjenjujem na fajl...");
  try {
    const res = await apiFetch(`${BACKEND_BASE}/api/files/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: currentOpenFilePath, content: code }),
    });
    const data = await res.json();
    if (!res.ok) {
      showEditorStatus(`Greška: ${data.error || "nepoznata greška"}`);
      return;
    }
    if (editor) {
      editor.pushUndoStop();
      editor.getModel().pushEditOperations(
        [],
        [{ range: editor.getModel().getFullModelRange(), text: code }],
        () => null
      );
      editor.pushUndoStop();
    }
    showEditorStatus(`Sačuvano i primjenjeno ✓  ${currentOpenFilePath}`);
  } catch (err) {
    showEditorStatus(`Greška: ${err.message}`);
  }
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

  // "Run in terminal" button — only for shell-type code blocks
  if (lang === "bash" || lang === "sh" || lang === "shell") {
    const btnRun = document.createElement("button");
    btnRun.className = "btn-code-action btn-run-terminal";
    btnRun.textContent = "▶ Terminal";
    btnRun.title = "Pokreni u terminal panelu (/api/exec) — prikazuje potvrdu";
    btnRun.addEventListener("click", async (e) => {
      e.stopPropagation();
      const confirmed = await showExecConfirmModal(code);
      if (confirmed) await runInTerminal(code);
    });
    btnGroup.appendChild(btnRun);
  }

  // "Apply to file" button — saves code directly to the currently open workspace file
  if (currentOpenFilePath) {
    const btnApply = document.createElement("button");
    btnApply.className = "btn-code-action btn-code-apply-file";
    const fname = currentOpenFilePath.split("/").pop();
    btnApply.textContent = `💾 ${fname}`;
    btnApply.title = `Upiši kod u ${currentOpenFilePath} i osvježi editor`;
    btnApply.addEventListener("click", async (e) => {
      e.stopPropagation();
      await applyToFile(code);
    });
    btnGroup.appendChild(btnApply);
  }

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

  const provider = selectedProvider || providerSelect.value;
  const model = getSelectedModel();
  const ollamaUrl = localStorage.getItem("decursor_ollama_url") || "";

  // Build system messages from selected files
  const selectedFilesList = [...selectedFiles];
  let prefixMessages = [];
  if (selectedFilesList.length > 0) {
    const fileContents = [];
    for (const fp of selectedFilesList) {
      try {
        const fRes = await apiFetch(`${BACKEND_BASE}/api/files/read?path=${encodeURIComponent(fp)}`);
        if (fRes.ok) {
          const content = await fRes.text();
          fileContents.push(`### ${fp}\n\`\`\`\n${content}\n\`\`\``);
        }
      } catch (_) { /* skip unreadable files */ }
    }
    if (fileContents.length > 0) {
      prefixMessages = [{
        role: "system",
        content: `Kontekst selektovanih fajlova:\n\n${fileContents.join("\n\n")}`,
      }];
    }
  }

  let fullText = "";

  try {
    const res = await apiFetch(`${BACKEND_BASE}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, model, messages: [...prefixMessages, ...chatHistory], ollamaUrl }),
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
            if (parsed.tool_call) {
              statusEl.textContent = `🔧 ${parsed.tool_call.name}…`;
            }
            if (parsed.tool_result) {
              statusEl.textContent = "Čekam odgovor…";
            }
            if (parsed.write_confirm) {
              showPgWriteConfirm(parsed.write_confirm);
            }
            if (parsed.exec_confirm) {
              showMcpExecConfirm(parsed.exec_confirm);
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

    // Always show "Send to WordPress as draft" button under AI responses
    if (fullText && fullText !== "(prazan odgovor)") {
      const wpDraftBtn = document.createElement("button");
      wpDraftBtn.className = "btn-wp-draft";
      wpDraftBtn.textContent = "📝 Pošalji na WordPress kao draft";
      const capturedText = fullText;
      wpDraftBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openWpDraftModal(capturedText);
      });
      assistantDiv.appendChild(wpDraftBtn);
    }

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

let ghFileTree = [];

document.getElementById("github-btn").addEventListener("click", () => {
  // restore saved values
  document.getElementById("gh-token").value = localStorage.getItem("decursor_gh_token") || "";
  document.getElementById("gh-repo").value = localStorage.getItem("decursor_gh_repo") || "";
  document.getElementById("gh-branch").value = localStorage.getItem("decursor_gh_branch") || "main";
  document.getElementById("gh-path").value = document.getElementById("filename-input").value || "";
  githubModal.classList.add("open");
  // auto-load file tree if credentials are already saved
  const savedToken = localStorage.getItem("decursor_gh_token");
  const savedRepo = localStorage.getItem("decursor_gh_repo");
  if (savedToken && savedRepo) githubLoadTree();
});
document.getElementById("gh-close-btn").addEventListener("click", () => {
  githubModal.classList.remove("open");
});

function saveGhSettings() {
  localStorage.setItem("decursor_gh_token", document.getElementById("gh-token").value);
  localStorage.setItem("decursor_gh_repo", document.getElementById("gh-repo").value);
  localStorage.setItem("decursor_gh_branch", document.getElementById("gh-branch").value);
}

async function githubLoadTree() {
  const token = document.getElementById("gh-token").value.trim();
  const repo = document.getElementById("gh-repo").value.trim();
  const branch = document.getElementById("gh-branch").value.trim() || "main";

  if (!token || !repo) {
    ghStatus.textContent = "Popuni token i repo za učitavanje liste fajlova.";
    return;
  }

  const parts = repo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    ghStatus.textContent = "Repo mora biti u formatu owner/repo";
    return;
  }
  const [owner, repoName] = parts;

  ghStatus.textContent = "Učitavam strukturu repoa...";
  try {
    const res = await apiFetch(`${BACKEND_BASE}/api/github/tree`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, owner, repo: repoName, branch }),
    });
    const data = await res.json();

    if (!res.ok) {
      ghStatus.textContent = `Greška: ${data.error || "nepoznata greška"}`;
      return;
    }

    ghFileTree = data.files || [];
    document.getElementById("gh-tree-search").value = "";
    renderGhFileTree("");
    document.getElementById("gh-file-tree-wrap").style.display = "flex";
    ghStatus.textContent = data.truncated
      ? `${ghFileTree.length}+ fajlova (lista skraćena)`
      : `${ghFileTree.length} fajlova`;
  } catch (err) {
    ghStatus.textContent = `Greška konekcije: ${err.message}`;
  }
}

function renderGhFileTree(filter) {
  const list = document.getElementById("gh-file-list");
  const query = (filter || "").toLowerCase();
  const filtered = query
    ? ghFileTree.filter((p) => p.toLowerCase().includes(query))
    : ghFileTree;
  list.innerHTML = filtered
    .map((p) => {
      const esc = p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
      return `<div class="gh-file-item" data-path="${esc}" title="${esc}">${esc}</div>`;
    })
    .join("");
}

document.getElementById("gh-tree-search").addEventListener("input", (e) => {
  renderGhFileTree(e.target.value);
});

document.getElementById("gh-file-list").addEventListener("click", (e) => {
  const item = e.target.closest(".gh-file-item");
  if (!item) return;
  document.getElementById("gh-path").value = item.dataset.path;
  githubPull();
});

document.getElementById("gh-load-tree-btn").addEventListener("click", githubLoadTree);

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
    const res = await apiFetch(`${BACKEND_BASE}/api/github/pull`, {
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
    const res = await apiFetch(`${BACKEND_BASE}/api/github/push`, {
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

// ---------- Terminal ----------

const terminalCmdHistory = []; // in-memory command history (arrow-up/down)
let terminalHistoryIdx = -1;   // -1 = not navigating
let terminalDraftCmd = "";     // saved draft when starting history navigation

function toggleTerminal(forceOpen) {
  const pane = document.getElementById("terminal-pane");
  const willOpen = forceOpen !== undefined ? forceOpen : !pane.classList.contains("open");
  pane.classList.toggle("open", willOpen);
  if (willOpen) {
    document.getElementById("terminal-cmd-input").focus();
  }
}

function appendTerminalLine(text, type) {
  const output = document.getElementById("terminal-output");
  if (!output) return;
  const span = document.createElement("span");
  span.className = `term-${type}`;
  span.textContent = text;
  output.appendChild(span);
  output.scrollTop = output.scrollHeight;
}

async function runInTerminal(command) {
  toggleTerminal(true);
  const cmdInput = document.getElementById("terminal-cmd-input");
  if (cmdInput) {
    cmdInput.disabled = true;
    cmdInput.value = "";
  }

  appendTerminalLine(`$ ${command}\n`, "prompt");

  try {
    const res = await apiFetch(`${BACKEND_BASE}/api/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    });
    const data = await res.json();
    if (!res.ok) {
      appendTerminalLine(`Greška: ${data.error || "nepoznata greška"}\n`, "stderr");
    } else {
      if (data.stdout) {
        appendTerminalLine(data.stdout.endsWith("\n") ? data.stdout : data.stdout + "\n", "stdout");
      }
      if (data.stderr) {
        appendTerminalLine(data.stderr.endsWith("\n") ? data.stderr : data.stderr + "\n", "stderr");
      }
      if (data.exitCode !== 0) {
        appendTerminalLine(`[exit ${data.exitCode}]\n`, "info");
      }
    }
  } catch (err) {
    appendTerminalLine(`Greška konekcije: ${err.message}\n`, "stderr");
  } finally {
    if (cmdInput) {
      cmdInput.disabled = false;
      cmdInput.focus();
    }
  }
}

document.getElementById("terminal-toggle-btn").addEventListener("click", () => toggleTerminal());
document.getElementById("terminal-close-btn").addEventListener("click", () => toggleTerminal(false));
document.getElementById("terminal-clear-btn").addEventListener("click", () => {
  const output = document.getElementById("terminal-output");
  if (output) output.innerHTML = "";
});

const termCmdInput = document.getElementById("terminal-cmd-input");
termCmdInput.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    const command = termCmdInput.value.trim();
    if (!command) return;
    // Push to history (avoid duplicates at the front)
    if (terminalCmdHistory[0] !== command) {
      terminalCmdHistory.unshift(command);
    }
    terminalHistoryIdx = -1;
    terminalDraftCmd = "";
    // Always confirm before executing — even when user types directly
    const confirmed = await showExecConfirmModal(command);
    if (confirmed) await runInTerminal(command);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (!terminalCmdHistory.length) return;
    if (terminalHistoryIdx === -1) terminalDraftCmd = termCmdInput.value;
    terminalHistoryIdx = Math.min(terminalHistoryIdx + 1, terminalCmdHistory.length - 1);
    termCmdInput.value = terminalCmdHistory[terminalHistoryIdx];
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    if (terminalHistoryIdx === -1) return;
    terminalHistoryIdx--;
    termCmdInput.value = terminalHistoryIdx === -1 ? terminalDraftCmd : terminalCmdHistory[terminalHistoryIdx];
  }
});

// Load file tree on startup
loadFileTree();

// ---------- WordPress integration ----------

// In-memory credentials — NEVER stored in localStorage
let wpCreds = { siteUrl: "", username: "", appPassword: "" };
let wpCurrentPostId = null;

const wpModal = document.getElementById("wordpress-modal");
const wpStatus = document.getElementById("wp-status");

document.getElementById("wordpress-btn").addEventListener("click", () => {
  document.getElementById("wp-site-url").value = wpCreds.siteUrl;
  document.getElementById("wp-username").value = wpCreds.username;
  if (wpCreds.appPassword) {
    document.getElementById("wp-app-password").value = wpCreds.appPassword;
  }
  wpModal.classList.add("open");
  if (wpCreds.siteUrl && wpCreds.username && wpCreds.appPassword) {
    loadWpPosts();
  }
});

document.getElementById("wp-close-btn").addEventListener("click", () => {
  wpModal.classList.remove("open");
});

document.getElementById("wp-save-creds-btn").addEventListener("click", () => {
  wpCreds.siteUrl = document.getElementById("wp-site-url").value.trim();
  wpCreds.username = document.getElementById("wp-username").value.trim();
  wpCreds.appPassword = document.getElementById("wp-app-password").value.trim();
  wpStatus.textContent = "Kredencijali sačuvani u memoriji sesije.";
  setTimeout(() => { wpStatus.textContent = ""; }, 3000);
  if (wpCreds.siteUrl && wpCreds.username && wpCreds.appPassword) {
    loadWpPosts();
  }
});

document.getElementById("wp-refresh-posts-btn").addEventListener("click", () => {
  wpCreds.siteUrl = document.getElementById("wp-site-url").value.trim();
  wpCreds.username = document.getElementById("wp-username").value.trim();
  wpCreds.appPassword = document.getElementById("wp-app-password").value.trim();
  loadWpPosts();
});

async function loadWpPosts() {
  const postsEl = document.getElementById("wp-posts-list");
  postsEl.innerHTML = '<p style="font-size:12px;opacity:0.4;padding:8px;margin:0;">Učitavam postove...</p>';

  if (!wpCreds.siteUrl || !wpCreds.username || !wpCreds.appPassword) {
    postsEl.innerHTML = '<p style="font-size:12px;opacity:0.4;padding:8px;margin:0;">Popunite Site URL, korisničko ime i Application Password.</p>';
    return;
  }

  try {
    const params = new URLSearchParams({
      siteUrl: wpCreds.siteUrl,
      username: wpCreds.username,
      appPassword: wpCreds.appPassword,
    });
    const res = await apiFetch(`${BACKEND_BASE}/api/wordpress/posts?${params}`);
    const data = await res.json();

    if (!res.ok) {
      postsEl.innerHTML = `<p style="font-size:12px;color:#f48771;padding:8px;margin:0;">Greška: ${data.error || "Nepoznata greška"}</p>`;
      return;
    }

    if (!Array.isArray(data) || !data.length) {
      postsEl.innerHTML = '<p style="font-size:12px;opacity:0.4;padding:8px;margin:0;">Nema postova.</p>';
      return;
    }

    postsEl.innerHTML = "";
    for (const post of data) {
      const item = document.createElement("div");
      item.className = "wp-post-item";
      item.dataset.postId = post.id;

      const titleSpan = document.createElement("span");
      titleSpan.className = "wp-post-title";
      titleSpan.textContent = (post.title && post.title.rendered)
        ? post.title.rendered.replace(/<[^>]+>/g, "")
        : `Post #${post.id}`;
      item.appendChild(titleSpan);

      const statusSpan = document.createElement("span");
      statusSpan.className = "wp-post-status";
      statusSpan.textContent = post.status || "";
      item.appendChild(statusSpan);

      item.addEventListener("click", () => {
        // Deactivate previous selection
        postsEl.querySelectorAll(".wp-post-item.active").forEach((el) => el.classList.remove("active"));
        item.classList.add("active");

        wpCurrentPostId = post.id;
        const editSection = document.getElementById("wp-edit-section");
        editSection.style.display = "block";

        const editArea = document.getElementById("wp-edit-area");
        const existingHtml = (post.content && post.content.rendered) ? post.content.rendered : "";
        editArea.value = existingHtml;

        document.getElementById("wp-edit-status").textContent = `Uredi post #${post.id}. Izmijeni sadržaj i klikni Ažuriraj.`;
      });

      postsEl.appendChild(item);
    }
  } catch (err) {
    postsEl.innerHTML = `<p style="font-size:12px;color:#f48771;padding:8px;margin:0;">Greška konekcije: ${err.message}</p>`;
  }
}

document.getElementById("wp-cancel-edit-btn").addEventListener("click", () => {
  wpCurrentPostId = null;
  document.getElementById("wp-edit-section").style.display = "none";
  document.getElementById("wp-edit-area").value = "";
  document.getElementById("wp-edit-status").textContent = "";
  document.getElementById("wp-posts-list").querySelectorAll(".wp-post-item.active").forEach((el) => el.classList.remove("active"));
});

document.getElementById("wp-update-post-btn").addEventListener("click", async () => {
  if (!wpCurrentPostId) return;
  const editStatus = document.getElementById("wp-edit-status");
  const content = document.getElementById("wp-edit-area").value.trim();

  if (!content) {
    editStatus.textContent = "Sadržaj ne može biti prazan.";
    return;
  }

  editStatus.textContent = "Ažuriram...";
  const btn = document.getElementById("wp-update-post-btn");
  btn.disabled = true;

  try {
    const res = await apiFetch(`${BACKEND_BASE}/api/wordpress/update`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteUrl: wpCreds.siteUrl,
        username: wpCreds.username,
        appPassword: wpCreds.appPassword,
        postId: wpCurrentPostId,
        content,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      editStatus.textContent = `Greška: ${data.error || "Nepoznata greška"}`;
      return;
    }
    editStatus.textContent = `Ažurirano! Post #${data.id} — ${data.link || ""}`;
  } catch (err) {
    editStatus.textContent = `Greška konekcije: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

// ---------- WP draft modal ----------

let wpDraftMarkdown = "";

function mdToHtml(text) {
  try {
    if (typeof marked !== "undefined" && marked.parse) {
      return marked.parse(text);
    }
  } catch (_) { /* fallback below */ }
  // Simple fallback if marked.js didn't load
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

function openWpDraftModal(markdownContent) {
  wpDraftMarkdown = markdownContent;

  // Pre-fill title from first non-empty line, stripping markdown heading markers
  const firstLine = markdownContent.split("\n").find((l) => l.trim()) || "";
  const suggestedTitle = firstLine.replace(/^#+\s*/, "").trim().slice(0, 120);
  document.getElementById("wp-draft-title-input").value = suggestedTitle;

  document.getElementById("wp-html-preview").innerHTML = mdToHtml(markdownContent);

  const linkEl = document.getElementById("wp-draft-link");
  linkEl.style.display = "none";
  linkEl.textContent = "";
  linkEl.href = "#";

  const saveBtn = document.getElementById("wp-draft-save-btn");
  saveBtn.disabled = false;
  saveBtn.textContent = "💾 Sačuvaj kao draft";

  document.getElementById("wp-draft-modal").classList.add("open");
}

document.getElementById("wp-draft-close-btn").addEventListener("click", () => {
  document.getElementById("wp-draft-modal").classList.remove("open");
});

// ---------- Home menu ----------

const homeBtn = document.getElementById("home-btn");
const homeDropdown = document.getElementById("home-dropdown");

/**
 * Position the dropdown using viewport-relative coordinates so that
 * no ancestor overflow:hidden can clip it (it uses position:fixed).
 */
function positionHomeDropdown() {
  const rect = homeBtn.getBoundingClientRect();
  const gap = 6;
  let top = rect.bottom + gap;
  let left = rect.left;

  // Prevent right-edge overflow
  const ddWidth = homeDropdown.offsetWidth || 220;
  if (left + ddWidth > window.innerWidth - 12) {
    left = Math.max(8, window.innerWidth - ddWidth - 12);
  }
  // Prevent bottom-edge overflow (rare but possible on very small screens)
  const ddHeight = homeDropdown.scrollHeight || 160;
  if (top + ddHeight > window.innerHeight - 8) {
    top = Math.max(8, rect.top - ddHeight - gap);
  }

  homeDropdown.style.top  = top  + "px";
  homeDropdown.style.left = left + "px";
}

homeBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const isHidden = homeDropdown.classList.contains("hidden");
  if (isHidden) {
    homeDropdown.classList.remove("hidden");
    positionHomeDropdown();
    syncThemeBtnStates();
  } else {
    homeDropdown.classList.add("hidden");
  }
});

document.addEventListener("click", (e) => {
  if (!homeDropdown.classList.contains("hidden") &&
      !homeBtn.contains(e.target) &&
      !homeDropdown.contains(e.target)) {
    homeDropdown.classList.add("hidden");
  }
});

// Also close on touch-outside (touchstart fires before click on mobile)
document.addEventListener("touchstart", (e) => {
  if (!homeDropdown.classList.contains("hidden") &&
      !homeBtn.contains(e.target) &&
      !homeDropdown.contains(e.target)) {
    homeDropdown.classList.add("hidden");
  }
}, { passive: true });

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") homeDropdown.classList.add("hidden");
});

// Reposition on resize/scroll so the dropdown stays anchored to the button
window.addEventListener("resize", () => {
  if (!homeDropdown.classList.contains("hidden")) positionHomeDropdown();
});
document.addEventListener("scroll", () => {
  if (!homeDropdown.classList.contains("hidden")) positionHomeDropdown();
}, { passive: true, capture: true });

// ---------- Theme toggle (in Home menu) ----------

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("decursor-theme", theme);
  if (editor) monaco.editor.setTheme(theme === "dark" ? "vs-dark" : "vs");
  const metaColor = document.getElementById("meta-theme-color");
  if (metaColor) metaColor.content = theme === "dark" ? "#1e1e1e" : "#f0f0f0";
  syncThemeBtnStates();
}

function syncThemeBtnStates() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const lightBtn = document.getElementById("theme-light-btn");
  const darkBtn = document.getElementById("theme-dark-btn");
  if (lightBtn) lightBtn.classList.toggle("dd-active", current === "light");
  if (darkBtn) darkBtn.classList.toggle("dd-active", current === "dark");
}

document.getElementById("theme-light-btn").addEventListener("click", () => { applyTheme("light"); });
document.getElementById("theme-dark-btn").addEventListener("click", () => { applyTheme("dark"); });

syncThemeBtnStates();

// ---------- Font-size controls (in Home menu) ----------

const FONT_MIN = 12;
const FONT_MAX = 22;

function applyFontSize(size) {
  size = Math.max(FONT_MIN, Math.min(FONT_MAX, size));
  document.documentElement.style.setProperty("--base-font-size", size + "px");
  localStorage.setItem("decursor-font-size", size);
  if (editor) editor.updateOptions({ fontSize: size });
}

function getCurrentFontSize() {
  // Prefer inline style (set by applyFontSize), fall back to computed stylesheet value
  const inline = parseInt(document.documentElement.style.getPropertyValue("--base-font-size"));
  if (!isNaN(inline) && inline >= FONT_MIN && inline <= FONT_MAX) return inline;
  const computed = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--base-font-size"));
  return (!isNaN(computed) && computed >= FONT_MIN && computed <= FONT_MAX) ? computed : 13;
}

document.getElementById("font-decrease-btn").addEventListener("click", () => {
  applyFontSize(getCurrentFontSize() - 1);
});

document.getElementById("font-increase-btn").addEventListener("click", () => {
  applyFontSize(getCurrentFontSize() + 1);
});

// ---------- Pay to Use modal ----------

document.getElementById("pay-to-use-btn").addEventListener("click", () => {
  homeDropdown.classList.add("hidden");
  document.getElementById("pay-modal").classList.add("open");
});

document.getElementById("pay-modal-close-btn").addEventListener("click", () => {
  document.getElementById("pay-modal").classList.remove("open");
});

document.getElementById("pay-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.classList.remove("open");
});

// ---------- Monacopilot / AI inline completion ----------

let monacopilotRegistration = null; // { deregister: () => void } returned by monacopilot.registerCompletion

/**
 * Enable or disable inline AI completion via Monacopilot.
 * Persists state to localStorage; registers or deregisters the Monaco provider.
 * Safe to call before Monaco finishes loading — a guard checks for editor readiness.
 * @param {boolean} enabled
 */
function toggleAICompletion(enabled) {
  localStorage.setItem("decursor-monacopilot", enabled ? "1" : "0");

  if (enabled) {
    if (!editor || typeof monacopilot === "undefined") return; // Monaco not ready yet; called again after load
    if (monacopilotRegistration) return; // already active
    monacopilotRegistration = monacopilot.registerCompletion(monaco, editor, {
      endpoint: `${BACKEND_BASE}/api/complete`,
      trigger: "onTyping",
    });
    console.info("[Monacopilot] AI inline completion ENABLED");
  } else {
    if (monacopilotRegistration) {
      monacopilotRegistration.deregister();
      monacopilotRegistration = null;
    }
    console.info("[Monacopilot] AI inline completion DISABLED");
  }
}

// Sync toggle checkbox with saved state on load
(function initMonacopilotToggle() {
  const enabled = localStorage.getItem("decursor-monacopilot") !== "0";
  const toggle = document.getElementById("monacopilot-toggle");
  if (!toggle) return;
  toggle.checked = enabled;
  toggle.addEventListener("change", () => {
    toggleAICompletion(toggle.checked);
  });
})();

// ---------- MCP ----------

const MCP_MODAL_IDS = ["mcp-manage-modal", "mcp-connect-modal", "mcp-settings-modal"];

MCP_MODAL_IDS.forEach((id) => {
  document.getElementById(id).addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove("open");
  });
});

function openMcpModal(id) {
  homeDropdown.classList.add("hidden");
  document.getElementById(id).classList.add("open");
}

document.getElementById("mcp-manage-btn").addEventListener("click", () => {
  openMcpModal("mcp-manage-modal");
  loadMcpServers();
});
document.getElementById("mcp-connect-btn").addEventListener("click",  () => openMcpAddForm());
document.getElementById("mcp-add-btn").addEventListener("click",      () => openMcpAddForm());
document.getElementById("mcp-settings-btn").addEventListener("click", () => openMcpModal("mcp-settings-modal"));

document.getElementById("mcp-manage-close-btn").addEventListener("click",  () => document.getElementById("mcp-manage-modal").classList.remove("open"));
document.getElementById("mcp-connect-close-btn").addEventListener("click", () => document.getElementById("mcp-connect-modal").classList.remove("open"));
document.getElementById("mcp-settings-close-btn").addEventListener("click",() => document.getElementById("mcp-settings-modal").classList.remove("open"));

document.getElementById("mcp-manage-refresh-btn").addEventListener("click", loadMcpServers);
document.getElementById("mcp-manage-add-btn").addEventListener("click", () => {
  document.getElementById("mcp-manage-modal").classList.remove("open");
  openMcpAddForm();
});
document.getElementById("mcp-connect-cancel-btn").addEventListener("click", () => {
  document.getElementById("mcp-connect-modal").classList.remove("open");
});

async function loadMcpServers() {
  const list = document.getElementById("mcp-server-list");
  list.innerHTML = '<p class="mcp-list-empty">Učitavam…</p>';
  try {
    const res = await apiFetch(`${BACKEND_BASE}/api/mcp/servers`);
    const servers = await res.json();
    if (!servers.length) {
      list.innerHTML = '<p class="mcp-list-empty">Nema registrovanih MCP servera.</p>';
      return;
    }
    list.innerHTML = "";
    servers.forEach((s) => list.appendChild(buildMcpServerItem(s)));
  } catch (err) {
    list.innerHTML = `<p class="mcp-list-empty" style="color:var(--diff-removed-fg)">Greška: ${err.message}</p>`;
  }
}

const MCP_STATUS_LABEL = {
  connected:    "● connected",
  disconnected: "○ disconnected",
  error:        "✕ error",
};

function buildMcpServerItem(server) {
  const item = document.createElement("div");
  item.className = "mcp-server-item";
  item.dataset.serverId = server.id;

  // Build write-mode badge markup for postgres servers
  const writeBadgeHtml = server.type === "postgres"
    ? `<span class="mcp-write-badge ${server.writeMode ? "write-on" : "readonly"}"
         title="Klikni da toggleuješ write mode">
         ${server.writeMode ? "✏️ Write" : "📖 Read-only"}
       </span>`
    : "";

  // Non-toggleable "⚠️ Confirm Required" badge for terminal server
  const confirmBadgeHtml = server.type === "terminal"
    ? `<span class="mcp-confirm-badge" title="Svaka komanda zahtijeva eksplicitnu potvrdu korisnika — ovo se ne može isključiti">⚠️ Confirm Required</span>`
    : "";

  // Remove button for custom (user-added) servers
  const removeBtnHtml = server.removable
    ? `<button class="secondary mcp-remove-server-btn" title="Ukloni server" style="font-size:11px;padding:3px 8px;min-height:unset;color:var(--diff-removed-fg);border-color:#6a2020;background:var(--diff-removed-bg);">🗑</button>`
    : "";

  item.innerHTML = `
    <span class="mcp-server-icon">${server.icon}</span>
    <div class="mcp-server-meta">
      <div class="mcp-server-name">${server.name}</div>
      <div class="mcp-server-desc">${server.description}</div>
    </div>
    ${confirmBadgeHtml}
    ${writeBadgeHtml}
    <span class="mcp-status-badge mcp-status-${server.status}">${MCP_STATUS_LABEL[server.status] ?? server.status}</span>
    <label class="dd-toggle-switch" title="${server.type === "terminal" ? "Terminal server se ne može isključiti" : server.enabled ? "Isključi" : "Uključi"}">
      <input type="checkbox" ${server.enabled ? "checked" : ""} ${server.type === "terminal" ? "disabled" : ""}/>
      <span class="dd-toggle-track"></span>
    </label>
    ${removeBtnHtml}
  `;

  // Enable / disable toggle
  const toggle = item.querySelector("input[type=checkbox]");
  toggle.addEventListener("change", async () => {
    toggle.disabled = true;
    try {
      const r = await apiFetch(`${BACKEND_BASE}/api/mcp/servers/${server.id}/toggle`, { method: "POST" });
      const updated = await r.json();
      const badge = item.querySelector(".mcp-status-badge");
      badge.className = `mcp-status-badge mcp-status-${updated.status}`;
      badge.textContent = MCP_STATUS_LABEL[updated.status] ?? updated.status;
      toggle.checked = updated.enabled;
    } catch (err) {
      toggle.checked = !toggle.checked;
      alert(`Greška: ${err.message}`);
    } finally {
      toggle.disabled = false;
    }
  });

  // Write-mode badge click (postgres only)
  const writeBadge = item.querySelector(".mcp-write-badge");
  if (writeBadge) {
    writeBadge.addEventListener("click", async () => {
      writeBadge.style.opacity = "0.5";
      try {
        const r = await apiFetch(
          `${BACKEND_BASE}/api/mcp/servers/${server.id}/write-mode`,
          { method: "POST" }
        );
        const updated = await r.json();
        writeBadge.className = `mcp-write-badge ${updated.writeMode ? "write-on" : "readonly"}`;
        writeBadge.textContent = updated.writeMode ? "✏️ Write" : "📖 Read-only";
        const statusBadge = item.querySelector(".mcp-status-badge");
        statusBadge.className = `mcp-status-badge mcp-status-${updated.status}`;
        statusBadge.textContent = MCP_STATUS_LABEL[updated.status] ?? updated.status;
        const desc = item.querySelector(".mcp-server-desc");
        if (desc) desc.textContent = item.querySelector(".mcp-server-desc").textContent
          .replace(/(read-only|write)$/, updated.writeMode ? "write" : "read-only");
      } catch (err) {
        alert(`Greška: ${err.message}`);
      } finally {
        writeBadge.style.opacity = "";
      }
    });
  }

  // Remove button (custom servers only)
  const removeBtn = item.querySelector(".mcp-remove-server-btn");
  if (removeBtn) {
    removeBtn.addEventListener("click", async () => {
      if (!confirm(`Ukloniti server "${server.name}"? Ova akcija je trajna.`)) return;
      removeBtn.disabled = true;
      try {
        const r = await apiFetch(
          `${BACKEND_BASE}/api/mcp/custom-servers/${server.id}`,
          { method: "DELETE" }
        );
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || r.statusText);
        }
        item.remove();
        const list = document.getElementById("mcp-server-list");
        if (!list.querySelector(".mcp-server-item")) {
          list.innerHTML = '<p class="mcp-list-empty">Nema registrovanih MCP servera.</p>';
        }
      } catch (err) {
        alert(`Greška pri uklanjanju: ${err.message}`);
        removeBtn.disabled = false;
      }
    });
  }

  return item;
}

// ── Add MCP Server form ──────────────────────────────────────────────────────

function openMcpAddForm() {
  homeDropdown.classList.add("hidden");
  document.getElementById("mcp-add-name").value = "";
  document.getElementById("mcp-add-command").value = "";
  document.getElementById("mcp-add-url").value = "";
  document.getElementById("mcp-add-transport").value = "stdio";
  document.getElementById("mcp-add-env-list").innerHTML = "";
  document.getElementById("mcp-add-status").textContent = "";
  document.getElementById("mcp-add-submit-btn").disabled = false;
  document.getElementById("mcp-add-submit-btn").textContent = "⚡ Poveži i dodaj";
  toggleTransportFields("stdio");
  document.getElementById("mcp-connect-modal").classList.add("open");
  setTimeout(() => document.getElementById("mcp-add-name").focus(), 80);
}

function toggleTransportFields(transport) {
  document.getElementById("mcp-add-stdio-section").style.display =
    transport === "stdio" ? "" : "none";
  document.getElementById("mcp-add-sse-section").style.display =
    transport === "sse" ? "" : "none";
}

document.getElementById("mcp-add-transport").addEventListener("change", (e) => {
  toggleTransportFields(e.target.value);
});

document.getElementById("mcp-add-env-btn").addEventListener("click", () => {
  const row = document.createElement("div");
  row.className = "mcp-env-row";
  row.innerHTML = `
    <input type="text" class="mcp-env-key" placeholder="KEY" spellcheck="false" autocomplete="off" />
    <input type="text" class="mcp-env-value" placeholder="value" spellcheck="false" autocomplete="off" />
    <button class="secondary mcp-env-remove" type="button" style="font-size:11px;padding:3px 7px;min-height:unset;">✕</button>
  `;
  row.querySelector(".mcp-env-remove").addEventListener("click", () => row.remove());
  document.getElementById("mcp-add-env-list").appendChild(row);
  row.querySelector(".mcp-env-key").focus();
});

document.getElementById("mcp-add-submit-btn").addEventListener("click", async () => {
  const name     = document.getElementById("mcp-add-name").value.trim();
  const transport = document.getElementById("mcp-add-transport").value;
  const command  = document.getElementById("mcp-add-command").value.trim();
  const url      = document.getElementById("mcp-add-url").value.trim();
  const statusEl2 = document.getElementById("mcp-add-status");
  const submitBtn = document.getElementById("mcp-add-submit-btn");

  if (!name) { statusEl2.textContent = "Unesite ime servera."; return; }
  if (transport === "stdio" && !command) { statusEl2.textContent = "Unesite komandu."; return; }
  if (transport === "sse"   && !url)     { statusEl2.textContent = "Unesite URL."; return; }

  // Collect env vars
  const env = {};
  for (const row of document.getElementById("mcp-add-env-list").querySelectorAll(".mcp-env-row")) {
    const k = row.querySelector(".mcp-env-key").value.trim();
    const v = row.querySelector(".mcp-env-value").value;
    if (k) env[k] = v;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Povezujem…";
  statusEl2.textContent = "";

  try {
    const res = await apiFetch(`${BACKEND_BASE}/api/mcp/custom-servers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, transport, command, url, env }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Nepoznata greška");

    statusEl2.textContent = `✓ Dodato: ${data.name} — ${data.toolCount} tool(ova)`;
    submitBtn.textContent = "✓ Dodato!";
    setTimeout(() => {
      document.getElementById("mcp-connect-modal").classList.remove("open");
      document.getElementById("mcp-manage-modal").classList.add("open");
      loadMcpServers();
    }, 1200);
  } catch (err) {
    statusEl2.textContent = `Greška: ${err.message}`;
    submitBtn.disabled = false;
    submitBtn.textContent = "⚡ Poveži i dodaj";
  }
});

// ── Postgres write confirmation modal ────────────────────────────────────────

const pgWriteModal   = document.getElementById("pg-write-confirm-modal");
const pgWriteSqlEl   = document.getElementById("pg-write-confirm-sql");
const pgWriteWarning = document.getElementById("pg-write-warning");
let _pgConfirmId = null;

document.getElementById("pg-write-allow-btn").addEventListener("click", () => {
  if (!_pgConfirmId) return;
  sendWriteConfirm(_pgConfirmId, true);
});
document.getElementById("pg-write-deny-btn").addEventListener("click", () => {
  if (!_pgConfirmId) return;
  sendWriteConfirm(_pgConfirmId, false);
});
pgWriteModal.addEventListener("click", (e) => {
  if (e.target === pgWriteModal) sendWriteConfirm(_pgConfirmId, false);
});

async function sendWriteConfirm(id, allowed) {
  _pgConfirmId = null;
  pgWriteModal.classList.remove("open");
  if (!id) return;
  try {
    await apiFetch(`${BACKEND_BASE}/api/mcp/write-confirm/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowed }),
    });
  } catch (_) { /* server handles timeout */ }
}

function showPgWriteConfirm({ id, tool, arguments: args }) {
  _pgConfirmId = id;
  let preview = `Tool: ${tool}\n\n`;
  // Friendly preview: SQL for Postgres, message text for Telegram, JSON for others
  if (args.sql) {
    preview += args.sql;
  } else if (tool === "telegram_send_message") {
    preview += `To: ${args.chat_id}\n\n${args.text}`;
    if (args.parse_mode) preview += `\n\n(parse_mode: ${args.parse_mode})`;
  } else {
    preview += JSON.stringify(args, null, 2);
  }
  pgWriteSqlEl.textContent = preview;

  // Generic title and warning based on tool prefix
  const titleEl = document.getElementById("pg-write-confirm-title");
  if (tool.startsWith("telegram_")) {
    if (titleEl) titleEl.textContent = "✈️ Telegram — potvrda slanja";
    pgWriteWarning.textContent = `⚠️ Model želi da pošalje poruku via Telegram bot. Pregledaj sadržaj i potvrdi.`;
  } else {
    if (titleEl) titleEl.textContent = "⚠️ Postgres write operacija";
    pgWriteWarning.textContent = `⚠️ Model želi da izvrši "${tool}" na Postgres bazi. Pregledaj i potvrdi.`;
  }

  statusEl.textContent = "⚠️ Write potvrda potrebna…";
  pgWriteModal.classList.add("open");
}

// ── MCP exec (terminal) confirmation ─────────────────────────────────────────

let _mcpExecConfirmId = null;

function showMcpExecConfirm({ id, command }) {
  _mcpExecConfirmId = id;
  // Reuse the existing #exec-confirm-modal by temporarily overriding its buttons
  const modal   = document.getElementById("exec-confirm-modal");
  const cmdEl   = document.getElementById("exec-confirm-cmd");
  const allowBtn = document.getElementById("exec-accept-btn");
  const denyBtn  = document.getElementById("exec-reject-btn");

  cmdEl.textContent = command;
  statusEl.textContent = "⚠️ Potvrda AI komande potrebna…";
  modal.classList.add("open");

  function cleanup() {
    modal.classList.remove("open");
    allowBtn.removeEventListener("click", onAllow);
    denyBtn.removeEventListener("click",  onDeny);
    modal.removeEventListener("click",    onBackdrop);
    statusEl.textContent = "";
  }
  async function onAllow() {
    cleanup();
    await sendMcpExecConfirm(_mcpExecConfirmId, true);
    _mcpExecConfirmId = null;
  }
  async function onDeny() {
    cleanup();
    await sendMcpExecConfirm(_mcpExecConfirmId, false);
    _mcpExecConfirmId = null;
  }
  function onBackdrop(e) {
    if (e.target === modal) onDeny();
  }

  allowBtn.addEventListener("click", onAllow);
  denyBtn.addEventListener("click",  onDeny);
  modal.addEventListener("click",    onBackdrop);
}

async function sendMcpExecConfirm(id, allowed) {
  if (!id) return;
  try {
    await apiFetch(`${BACKEND_BASE}/api/mcp/exec-confirm/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowed }),
    });
  } catch (_) { /* server handles timeout */ }
}

document.getElementById("wp-draft-save-btn").addEventListener("click", async () => {
  if (!wpCreds.siteUrl || !wpCreds.username || !wpCreds.appPassword) {
    alert("Unesite WordPress kredencijale u WordPress panel (dugme WordPress u gornjoj traci).");
    return;
  }

  const title = document.getElementById("wp-draft-title-input").value.trim();
  if (!title) {
    document.getElementById("wp-draft-title-input").focus();
    return;
  }

  const htmlContent = mdToHtml(wpDraftMarkdown);

  const saveBtn = document.getElementById("wp-draft-save-btn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Šaljem...";

  try {
    const res = await apiFetch(`${BACKEND_BASE}/api/wordpress/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteUrl: wpCreds.siteUrl,
        username: wpCreds.username,
        appPassword: wpCreds.appPassword,
        title,
        content: htmlContent,
        status: "draft",
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      saveBtn.disabled = false;
      saveBtn.textContent = "💾 Sačuvaj kao draft";
      alert(`Greška: ${data.error || "Nepoznata greška"}`);
      return;
    }

    saveBtn.textContent = "✓ Sačuvano!";

    const linkEl = document.getElementById("wp-draft-link");
    if (data.link) {
      linkEl.href = data.link;
      linkEl.textContent = `↗ Otvori draft u WordPressu`;
      linkEl.style.display = "inline";
    }
  } catch (err) {
    saveBtn.disabled = false;
    saveBtn.textContent = "💾 Sačuvaj kao draft";
    alert(`Greška konekcije: ${err.message}`);
  }
});
