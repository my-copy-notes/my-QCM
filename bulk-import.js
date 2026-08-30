// My QCM: bulk import
// Rules:
// - If the pasted text contains "◆" headings, each heading becomes a child folder
//   under the currently open folder. Lines before the first heading are ignored.
// - Each non-empty line after a heading becomes one note. 【...】 is used as the
//   note body, and the title is the same text without the outer brackets.
// - If there are no ◆ headings, every non-empty line becomes one note in the
//   current location.
// - Separator-only lines are ignored.
// - Exact duplicate note bodies in the same folder are skipped.

function isBulkSeparator(line) {
  const value = line.trim();
  return !value || /^[\-—–―⸻━─_=＝ー]+$/.test(value);
}

function bulkTitleFromLine(line) {
  const value = line.trim();
  const match = value.match(/^【([\s\S]+)】$/);
  return (match ? match[1] : value).trim().slice(0, 120) || "無題";
}

function parseBulkText(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const hasHeadings = lines.some(line => /^\s*◆\s*/.test(line));
  const groups = [];

  if (!hasHeadings) {
    const notes = lines
      .map(line => line.trim())
      .filter(line => !isBulkSeparator(line));
    return [{ folderName: null, notes }];
  }

  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (isBulkSeparator(line)) continue;

    const heading = line.match(/^◆\s*(.+)$/);
    if (heading) {
      current = {
        folderName: heading[1].trim(),
        notes: []
      };
      if (current.folderName) groups.push(current);
      continue;
    }

    // In heading mode, text before the first ◆ is treated as a title/comment.
    if (!current) continue;
    current.notes.push(line);
  }

  return groups.filter(group => group.folderName || group.notes.length);
}

function currentBulkTargetLabel() {
  if (state.activeTab === "all" || state.activeTab === "favorites") {
    return "分類タブを選択してください";
  }

  const tabName = getTabName(state.activeTab);
  if (!state.currentFolderId) return tabName;
  return `${tabName} / ${getFolderLabel(state.currentFolderId)}`;
}

function openBulkDialog() {
  if (state.activeTab === "all" || state.activeTab === "favorites") {
    alert("一括登録する分類タブを先に選んでください。\nフォルダ内へ登録したい場合は、そのフォルダも開いてください。");
    return;
  }

  $("bulkTarget").textContent = currentBulkTargetLabel();
  $("bulkText").value = "";
  $("bulkDialog").showModal();
  setTimeout(() => $("bulkText").focus(), 50);
}

function findExistingBulkFolder(name, tabId, parentId) {
  return state.folders.find(folder =>
    folder.tabId === tabId &&
    (folder.parentId || null) === (parentId || null) &&
    folder.name.trim() === name.trim()
  ) || null;
}

async function importBulkText() {
  const text = $("bulkText").value;
  const groups = parseBulkText(text);
  const noteCount = groups.reduce((sum, group) => sum + group.notes.length, 0);
  const headingCount = groups.filter(group => group.folderName).length;

  if (!noteCount) {
    alert("登録できる行が見つかりませんでした。\n1行ずつ文章を並べるか、「◆ フォルダ名」の下に文章を並べてください。");
    return;
  }

  const target = currentBulkTargetLabel();
  const summary = headingCount
    ? `${headingCount}個の見出しと ${noteCount}件のメモを読み取りました。\n\n登録先：${target}\n◆ 見出しは子フォルダになります。\n\n一括登録しますか？`
    : `${noteCount}件のメモを読み取りました。\n\n登録先：${target}\n\n一括登録しますか？`;

  if (!confirm(summary)) return;

  const tabId = state.activeTab;
  const parentId = state.currentFolderId || null;
  let createdFolders = 0;
  let reusedFolders = 0;
  let createdNotes = 0;
  let skippedNotes = 0;

  // Local working copies prevent duplicate creation during the same import.
  const workingFolders = state.folders.map(item => ({ ...item }));
  const workingNotes = state.notes.map(item => ({ ...item }));

  for (const group of groups) {
    let folderId = parentId;

    if (group.folderName) {
      let folder = workingFolders.find(item =>
        item.tabId === tabId &&
        (item.parentId || null) === parentId &&
        item.name.trim() === group.folderName.trim()
      );

      if (!folder) {
        folder = {
          id: uid("folder"),
          name: group.folderName.trim(),
          tabId,
          parentId,
          order: Date.now() + createdFolders,
          createdAt: nowIso()
        };
        await put(STORE_FOLDERS, folder);
        workingFolders.push(folder);
        createdFolders += 1;
      } else {
        reusedFolders += 1;
      }

      folderId = folder.id;
    }

    for (const rawBody of group.notes) {
      const body = rawBody.trim();
      if (!body) continue;

      const duplicate = workingNotes.some(note =>
        note.tabId === tabId &&
        (note.folderId || null) === (folderId || null) &&
        String(note.body || "").trim() === body
      );

      if (duplicate) {
        skippedNotes += 1;
        continue;
      }

      const timestamp = nowIso();
      const note = {
        id: uid("note"),
        title: bulkTitleFromLine(body),
        body,
        tabId,
        folderId: folderId || null,
        favorite: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        order: Date.now() + createdNotes
      };

      await put(STORE_NOTES, note);
      workingNotes.push(note);
      createdNotes += 1;
    }
  }

  await refreshData();
  render();
  $("bulkDialog").close();

  const parts = [`メモ ${createdNotes}件を登録`];
  if (createdFolders) parts.push(`フォルダ ${createdFolders}個を作成`);
  if (reusedFolders) parts.push(`既存フォルダ ${reusedFolders}個を使用`);
  if (skippedNotes) parts.push(`重複 ${skippedNotes}件をスキップ`);

  alert(`一括登録が完了しました。\n\n${parts.join("\n")}`);
}

document.addEventListener("DOMContentLoaded", () => {
  $("bulkImportBtn")?.addEventListener("click", openBulkDialog);
  $("cancelBulkBtn")?.addEventListener("click", () => $("bulkDialog").close());
  $("closeBulkDialogBtn")?.addEventListener("click", () => $("bulkDialog").close());

  $("bulkForm")?.addEventListener("submit", event => {
    event.preventDefault();
    importBulkText().catch(error => {
      console.error(error);
      alert("一括登録中にエラーが発生しました。\n登録済みのデータは消さず、そのまま残しています。もう一度お試しください。");
    });
  });

  $("bulkDialog")?.addEventListener("click", event => {
    if (event.target === $("bulkDialog")) $("bulkDialog").close();
  });
});
