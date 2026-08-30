const DB_NAME = "my-qcm-db";
const DB_VERSION = 1;
const STORE_TABS = "tabs";
const STORE_FOLDERS = "folders";
const STORE_NOTES = "notes";

const DEFAULT_TABS = [
  { id: "tab-templates", name: "定型文", order: 1 },
  { id: "tab-creative", name: "創作", order: 2 },
  { id: "tab-work", name: "仕事", order: 3 },
  { id: "tab-other", name: "その他", order: 4 }
];

const state = {
  db: null,
  tabs: [],
  folders: [],
  notes: [],
  activeTab: "all",
  currentFolderId: null,
  search: "",
  sort: "updated-desc"
};

const $ = (id) => document.getElementById(id);

function uid(prefix = "id") {
  if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
  });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE_TABS)) {
        db.createObjectStore(STORE_TABS, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(STORE_FOLDERS)) {
        const folders = db.createObjectStore(STORE_FOLDERS, { keyPath: "id" });
        folders.createIndex("tabId", "tabId", { unique: false });
        folders.createIndex("parentId", "parentId", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_NOTES)) {
        const notes = db.createObjectStore(STORE_NOTES, { keyPath: "id" });
        notes.createIndex("tabId", "tabId", { unique: false });
        notes.createIndex("folderId", "folderId", { unique: false });
        notes.createIndex("favorite", "favorite", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAll(storeName) {
  const tx = state.db.transaction(storeName, "readonly");
  const result = await requestToPromise(tx.objectStore(storeName).getAll());
  await txDone(tx);
  return result;
}

async function put(storeName, value) {
  const tx = state.db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).put(value);
  await txDone(tx);
}

async function remove(storeName, id) {
  const tx = state.db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).delete(id);
  await txDone(tx);
}

async function seedTabsIfNeeded() {
  const tabs = await getAll(STORE_TABS);
  if (tabs.length) return;

  const tx = state.db.transaction(STORE_TABS, "readwrite");
  const store = tx.objectStore(STORE_TABS);
  DEFAULT_TABS.forEach(tab => store.put(tab));
  await txDone(tx);
}

async function refreshData() {
  [state.tabs, state.folders, state.notes] = await Promise.all([
    getAll(STORE_TABS),
    getAll(STORE_FOLDERS),
    getAll(STORE_NOTES)
  ]);

  state.tabs.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, "ja"));
  state.folders.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, "ja"));
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 1800);
}

function getTabName(tabId) {
  return state.tabs.find(tab => tab.id === tabId)?.name || "未分類";
}

function getFolder(folderId) {
  return state.folders.find(folder => folder.id === folderId) || null;
}

function getFolderPath(folderId) {
  const path = [];
  let cursor = getFolder(folderId);
  const seen = new Set();

  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    path.unshift(cursor);
    cursor = cursor.parentId ? getFolder(cursor.parentId) : null;
  }

  return path;
}

function getFolderLabel(folderId) {
  if (!folderId) return "フォルダなし";
  const path = getFolderPath(folderId);
  return path.length ? path.map(item => item.name).join(" / ") : "フォルダなし";
}

function descendantsOf(folderId) {
  const ids = new Set();
  const visit = (parentId) => {
    state.folders
      .filter(folder => folder.parentId === parentId)
      .forEach(folder => {
        ids.add(folder.id);
        visit(folder.id);
      });
  };
  visit(folderId);
  return ids;
}

function renderTabs() {
  const tabsEl = $("tabs");
  const virtual = [
    { id: "all", name: "すべて" },
    { id: "favorites", name: "よく使う" }
  ];
  const allTabs = [...virtual, ...state.tabs];

  tabsEl.innerHTML = allTabs.map(tab => `
    <button
      type="button"
      class="tab-btn ${state.activeTab === tab.id ? "active" : ""}"
      data-tab-id="${escapeHtml(tab.id)}"
    >${escapeHtml(tab.name)}</button>
  `).join("");

  tabsEl.querySelectorAll("[data-tab-id]").forEach(button => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tabId;
      state.currentFolderId = null;
      render();
    });
  });
}

function renderBreadcrumbs() {
  const el = $("breadcrumbs");

  if (state.activeTab === "all") {
    el.innerHTML = "<span>すべてのメモ</span>";
    return;
  }

  if (state.activeTab === "favorites") {
    el.innerHTML = "<span>よく使うメモ</span>";
    return;
  }

  const tab = state.tabs.find(item => item.id === state.activeTab);
  if (!tab) {
    el.innerHTML = "<span>分類なし</span>";
    return;
  }

  const path = getFolderPath(state.currentFolderId);
  const pieces = [
    `<button type="button" class="crumb-btn" data-folder-id="">${escapeHtml(tab.name)}</button>`
  ];

  path.forEach(folder => {
    pieces.push("<span>›</span>");
    pieces.push(
      `<button type="button" class="crumb-btn" data-folder-id="${escapeHtml(folder.id)}">${escapeHtml(folder.name)}</button>`
    );
  });

  el.innerHTML = pieces.join("");

  el.querySelectorAll("[data-folder-id]").forEach(button => {
    button.addEventListener("click", () => {
      state.currentFolderId = button.dataset.folderId || null;
      render();
    });
  });
}

function visibleFolders() {
  if (state.activeTab === "all" || state.activeTab === "favorites") return [];
  return state.folders.filter(folder =>
    folder.tabId === state.activeTab &&
    (folder.parentId || null) === (state.currentFolderId || null)
  );
}

function renderFolders() {
  const section = $("folderSection");
  const list = $("folderList");
  const folders = visibleFolders();

  section.hidden = state.activeTab === "all" || state.activeTab === "favorites";

  if (section.hidden) return;

  if (!folders.length) {
    list.innerHTML = `<div class="empty">この場所にはフォルダがありません。</div>`;
    return;
  }

  list.innerHTML = folders.map(folder => `
    <div class="folder-row">
      <button class="folder-open" type="button" data-open-folder="${escapeHtml(folder.id)}">
        <span aria-hidden="true">📁</span>
        <span class="folder-name">${escapeHtml(folder.name)}</span>
      </button>
      <div class="folder-menu">
        <button class="mini-btn" type="button" data-rename-folder="${escapeHtml(folder.id)}" aria-label="フォルダ名を変更">✎</button>
        <button class="mini-btn" type="button" data-delete-folder="${escapeHtml(folder.id)}" aria-label="フォルダを削除">×</button>
      </div>
    </div>
  `).join("");

  list.querySelectorAll("[data-open-folder]").forEach(button => {
    button.addEventListener("click", () => {
      state.currentFolderId = button.dataset.openFolder;
      render();
    });
  });

  list.querySelectorAll("[data-rename-folder]").forEach(button => {
    button.addEventListener("click", () => renameFolder(button.dataset.renameFolder));
  });

  list.querySelectorAll("[data-delete-folder]").forEach(button => {
    button.addEventListener("click", () => deleteFolder(button.dataset.deleteFolder));
  });
}

function filterNotes() {
  const query = state.search.trim().toLocaleLowerCase("ja");
  let notes = [...state.notes];

  if (state.activeTab === "favorites") {
    notes = notes.filter(note => note.favorite);
  } else if (state.activeTab !== "all") {
    notes = notes.filter(note => note.tabId === state.activeTab);
  }

  if (query) {
    notes = notes.filter(note => {
      const haystack = `${note.title || ""}\n${note.body || ""}`.toLocaleLowerCase("ja");
      return haystack.includes(query);
    });
  } else if (state.activeTab !== "all" && state.activeTab !== "favorites") {
    notes = notes.filter(note => (note.folderId || null) === (state.currentFolderId || null));
  }

  if (state.sort === "title-asc") {
    notes.sort((a, b) => (a.title || "").localeCompare(b.title || "", "ja"));
  } else {
    notes.sort((a, b) => {
      if (Boolean(a.favorite) !== Boolean(b.favorite)) return a.favorite ? -1 : 1;
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });
  }

  return notes;
}

function renderNotes() {
  const list = $("noteList");
  const notes = filterNotes();
  $("noteCount").textContent = `${notes.length}件`;

  if (!notes.length) {
    list.innerHTML = `<div class="empty">${state.search ? "該当するメモがありません。" : "まだメモがありません。"}</div>`;
    return;
  }

  list.innerHTML = notes.map(note => {
    const location = `${getTabName(note.tabId)}${note.folderId ? ` / ${getFolderLabel(note.folderId)}` : ""}`;
    return `
      <article class="note-card">
        <div class="note-top">
          <h3 class="note-title">${escapeHtml(note.title || "無題")}</h3>
          <button class="star-btn" type="button" data-favorite="${escapeHtml(note.id)}" aria-label="お気に入り切替">
            ${note.favorite ? "★" : "☆"}
          </button>
        </div>
        <div class="note-preview">${escapeHtml(note.body || "")}</div>
        <div class="note-meta">${escapeHtml(location)}</div>
        <div class="note-actions">
          <button class="copy-btn" type="button" data-copy="${escapeHtml(note.id)}">コピー</button>
          <button class="secondary-btn" type="button" data-edit="${escapeHtml(note.id)}">編集</button>
          <button class="danger-btn" type="button" data-delete-note="${escapeHtml(note.id)}">削除</button>
        </div>
      </article>
    `;
  }).join("");

  list.querySelectorAll("[data-copy]").forEach(button => {
    button.addEventListener("click", () => copyNote(button.dataset.copy));
  });

  list.querySelectorAll("[data-edit]").forEach(button => {
    button.addEventListener("click", () => openNoteDialog(button.dataset.edit));
  });

  list.querySelectorAll("[data-delete-note]").forEach(button => {
    button.addEventListener("click", () => deleteNote(button.dataset.deleteNote));
  });

  list.querySelectorAll("[data-favorite]").forEach(button => {
    button.addEventListener("click", () => toggleFavorite(button.dataset.favorite));
  });
}

function render() {
  renderTabs();
  renderBreadcrumbs();
  renderFolders();
  renderNotes();

  const folderAllowed = state.activeTab !== "all" && state.activeTab !== "favorites";
  $("addFolderBtn").disabled = !folderAllowed;
  $("addFolderBtn").title = folderAllowed ? "" : "分類タブを選んでからフォルダを作成してください";
}

function buildFolderOptions(tabId, selectedId = "") {
  const candidates = state.folders.filter(folder => folder.tabId === tabId);
  const byParent = new Map();

  candidates.forEach(folder => {
    const parent = folder.parentId || "";
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(folder);
  });

  const options = [`<option value="">フォルダなし</option>`];

  function walk(parentId = "", depth = 0) {
    const children = (byParent.get(parentId) || []).sort((a, b) => a.name.localeCompare(b.name, "ja"));
    children.forEach(folder => {
      const prefix = depth ? `${"—".repeat(depth)} ` : "";
      options.push(
        `<option value="${escapeHtml(folder.id)}" ${folder.id === selectedId ? "selected" : ""}>${prefix}${escapeHtml(folder.name)}</option>`
      );
      walk(folder.id, depth + 1);
    });
  }

  walk();
  return options.join("");
}

function fillNoteSelectors(tabId, folderId = "") {
  $("noteTab").innerHTML = state.tabs.map(tab => `
    <option value="${escapeHtml(tab.id)}" ${tab.id === tabId ? "selected" : ""}>${escapeHtml(tab.name)}</option>
  `).join("");

  $("noteFolder").innerHTML = buildFolderOptions(tabId, folderId);
}

function openNoteDialog(noteId = null) {
  const note = noteId ? state.notes.find(item => item.id === noteId) : null;
  const preferredTab =
    note?.tabId ||
    (state.activeTab !== "all" && state.activeTab !== "favorites" ? state.activeTab : state.tabs[0]?.id);

  if (!preferredTab) {
    alert("先に分類タブを作成してください。");
    return;
  }

  $("noteDialogTitle").textContent = note ? "メモを編集" : "メモを追加";
  $("noteId").value = note?.id || "";
  $("noteTitle").value = note?.title || "";
  $("noteBody").value = note?.body || "";
  $("noteFavorite").checked = Boolean(note?.favorite);

  const preferredFolder =
    note?.folderId ||
    (
      state.activeTab === preferredTab
        ? state.currentFolderId
        : null
    ) ||
    "";

  fillNoteSelectors(preferredTab, preferredFolder);
  $("noteDialog").showModal();
}

async function saveNote() {
  const title = $("noteTitle").value.trim();
  const body = $("noteBody").value;
  const tabId = $("noteTab").value;
  const folderId = $("noteFolder").value || null;
  const favorite = $("noteFavorite").checked;

  if (!title) {
    alert("タイトルを入力してください。");
    $("noteTitle").focus();
    return;
  }

  if (!body.trim()) {
    alert("本文を入力してください。");
    $("noteBody").focus();
    return;
  }

  const folder = folderId ? getFolder(folderId) : null;
  if (folder && folder.tabId !== tabId) {
    alert("フォルダと分類の組み合わせが正しくありません。");
    return;
  }

  const id = $("noteId").value || uid("note");
  const existing = state.notes.find(note => note.id === id);
  const timestamp = nowIso();

  const note = {
    id,
    title,
    body,
    tabId,
    folderId,
    favorite,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    order: existing?.order ?? Date.now()
  };

  await put(STORE_NOTES, note);
  await refreshData();
  $("noteDialog").close();
  render();
  showToast(existing ? "更新しました" : "保存しました");
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function copyNote(noteId) {
  const note = state.notes.find(item => item.id === noteId);
  if (!note) return;

  try {
    await copyText(note.body || "");
    showToast("コピーしました ✓");
  } catch (error) {
    console.error(error);
    alert("コピーできませんでした。Safariでページを開いて、もう一度お試しください。");
  }
}

async function toggleFavorite(noteId) {
  const note = state.notes.find(item => item.id === noteId);
  if (!note) return;

  await put(STORE_NOTES, {
    ...note,
    favorite: !note.favorite,
    updatedAt: nowIso()
  });

  await refreshData();
  render();
}

async function deleteNote(noteId) {
  const note = state.notes.find(item => item.id === noteId);
  if (!note) return;

  if (!confirm(`「${note.title || "無題"}」を削除しますか？`)) return;

  await remove(STORE_NOTES, noteId);
  await refreshData();
  render();
  showToast("削除しました");
}

async function addFolder() {
  if (state.activeTab === "all" || state.activeTab === "favorites") {
    alert("分類タブを選んでからフォルダを作成してください。");
    return;
  }

  const name = prompt("新しいフォルダ名を入力してください。");
  if (!name?.trim()) return;

  const folder = {
    id: uid("folder"),
    name: name.trim(),
    tabId: state.activeTab,
    parentId: state.currentFolderId || null,
    order: Date.now(),
    createdAt: nowIso()
  };

  await put(STORE_FOLDERS, folder);
  await refreshData();
  render();
  showToast("フォルダを作成しました");
}

async function renameFolder(folderId) {
  const folder = getFolder(folderId);
  if (!folder) return;

  const name = prompt("フォルダ名を変更", folder.name);
  if (!name?.trim() || name.trim() === folder.name) return;

  await put(STORE_FOLDERS, { ...folder, name: name.trim() });
  await refreshData();
  render();
  showToast("フォルダ名を変更しました");
}

async function deleteFolder(folderId) {
  const folder = getFolder(folderId);
  if (!folder) return;

  const descendantIds = descendantsOf(folderId);
  descendantIds.add(folderId);

  const affectedNotes = state.notes.filter(note => note.folderId && descendantIds.has(note.folderId));
  const childCount = descendantIds.size - 1;

  const detail = [
    childCount ? `サブフォルダ ${childCount}個` : "",
    affectedNotes.length ? `メモ ${affectedNotes.length}件` : ""
  ].filter(Boolean).join("・");

  const message = detail
    ? `「${folder.name}」を削除しますか？\n${detail}も一緒に削除されます。`
    : `「${folder.name}」を削除しますか？`;

  if (!confirm(message)) return;

  const tx = state.db.transaction([STORE_FOLDERS, STORE_NOTES], "readwrite");
  const folderStore = tx.objectStore(STORE_FOLDERS);
  const noteStore = tx.objectStore(STORE_NOTES);

  descendantIds.forEach(id => folderStore.delete(id));
  affectedNotes.forEach(note => noteStore.delete(note.id));

  await txDone(tx);

  if (state.currentFolderId && descendantIds.has(state.currentFolderId)) {
    state.currentFolderId = folder.parentId || null;
  }

  await refreshData();
  render();
  showToast("フォルダを削除しました");
}

async function addTab() {
  const name = prompt("追加する分類タブの名前を入力してください。\n例：SNS、連絡文、AI");
  if (!name?.trim()) return;

  const duplicate = state.tabs.some(tab => tab.name.trim() === name.trim());
  if (duplicate) {
    alert("同じ名前の分類タブがあります。");
    return;
  }

  const maxOrder = Math.max(0, ...state.tabs.map(tab => Number(tab.order) || 0));
  const tab = {
    id: uid("tab"),
    name: name.trim(),
    order: maxOrder + 1
  };

  await put(STORE_TABS, tab);
  await refreshData();
  state.activeTab = tab.id;
  state.currentFolderId = null;
  $("settingsDialog").close();
  render();
  showToast("分類タブを追加しました");
}

function makeBackupPayload() {
  return {
    app: "My QCM",
    version: 1,
    exportedAt: nowIso(),
    data: {
      tabs: state.tabs,
      folders: state.folders,
      notes: state.notes
    }
  };
}

async function exportBackup() {
  const payload = makeBackupPayload();
  const text = JSON.stringify(payload, null, 2);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  const link = document.createElement("a");

  link.href = url;
  link.download = `my-qcm-backup-${date}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("バックアップを書き出しました");
}

function validateBackup(payload) {
  return Boolean(
    payload &&
    payload.app === "My QCM" &&
    payload.data &&
    Array.isArray(payload.data.tabs) &&
    Array.isArray(payload.data.folders) &&
    Array.isArray(payload.data.notes)
  );
}

async function restoreBackup(file) {
  let payload;

  try {
    payload = JSON.parse(await file.text());
  } catch {
    alert("バックアップファイルを読み込めませんでした。");
    return;
  }

  if (!validateBackup(payload)) {
    alert("My QCMのバックアップファイルではないようです。");
    return;
  }

  const summary = `分類 ${payload.data.tabs.length}件・フォルダ ${payload.data.folders.length}件・メモ ${payload.data.notes.length}件`;

  if (!confirm(`バックアップから復元しますか？\n${summary}\n\n現在のデータは置き換えられます。`)) {
    return;
  }

  const tx = state.db.transaction([STORE_TABS, STORE_FOLDERS, STORE_NOTES], "readwrite");
  const tabStore = tx.objectStore(STORE_TABS);
  const folderStore = tx.objectStore(STORE_FOLDERS);
  const noteStore = tx.objectStore(STORE_NOTES);

  tabStore.clear();
  folderStore.clear();
  noteStore.clear();

  payload.data.tabs.forEach(item => tabStore.put(item));
  payload.data.folders.forEach(item => folderStore.put(item));
  payload.data.notes.forEach(item => noteStore.put(item));

  await txDone(tx);
  await seedTabsIfNeeded();
  await refreshData();

  state.activeTab = "all";
  state.currentFolderId = null;
  state.search = "";
  $("searchInput").value = "";
  $("settingsDialog").close();
  render();
  showToast("復元しました");
}

function bindEvents() {
  $("searchInput").addEventListener("input", event => {
    state.search = event.target.value;
    renderNotes();
  });

  $("sortSelect").addEventListener("change", event => {
    state.sort = event.target.value;
    renderNotes();
  });

  $("addFolderBtn").addEventListener("click", addFolder);
  $("addNoteBtn").addEventListener("click", () => openNoteDialog());
  $("noteForm").addEventListener("submit", event => {
    event.preventDefault();
    saveNote();
  });
  $("cancelNoteBtn").addEventListener("click", () => $("noteDialog").close());
  $("closeNoteDialogBtn").addEventListener("click", () => $("noteDialog").close());

  $("noteTab").addEventListener("change", event => {
    $("noteFolder").innerHTML = buildFolderOptions(event.target.value, "");
  });

  $("settingsBtn").addEventListener("click", () => $("settingsDialog").showModal());
  $("closeSettingsDialogBtn").addEventListener("click", () => $("settingsDialog").close());
  $("addTabBtn").addEventListener("click", addTab);
  $("backupBtn").addEventListener("click", exportBackup);
  $("restoreBtn").addEventListener("click", () => $("restoreInput").click());

  $("restoreInput").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (file) await restoreBackup(file);
    event.target.value = "";
  });

  $("noteDialog").addEventListener("click", event => {
    if (event.target === $("noteDialog")) $("noteDialog").close();
  });

  $("settingsDialog").addEventListener("click", event => {
    if (event.target === $("settingsDialog")) $("settingsDialog").close();
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (error) {
    console.warn("Service Worker registration failed:", error);
  }
}

async function start() {
  if (!("indexedDB" in window)) {
    document.body.innerHTML = `
      <main class="app-main">
        <div class="empty">このブラウザではIndexedDBを利用できません。iPhoneではSafariで開いてください。</div>
      </main>
    `;
    return;
  }

  try {
    state.db = await openDb();
    await seedTabsIfNeeded();
    await refreshData();
    bindEvents();
    render();
    registerServiceWorker();
  } catch (error) {
    console.error(error);
    alert("アプリの初期化に失敗しました。ページを再読み込みしてください。");
  }
}

document.addEventListener("DOMContentLoaded", start);
