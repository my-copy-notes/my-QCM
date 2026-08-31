// My QCM: classification tab tools

function getSelectedEditableTab() {
  if (state.activeTab === "all" || state.activeTab === "favorites") return null;
  return state.tabs.find(item => item.id === state.activeTab) || null;
}

async function renameSelectedTab() {
  const tab = getSelectedEditableTab();
  if (!tab) {
    alert("名前を変えたい分類タブを先に選んでください。\n「すべて」と「よく使う」は固定タブです。");
    return;
  }

  const name = prompt("分類タブの新しい名前を入力してください。", tab.name);
  if (name === null) return;

  const newName = name.trim();
  if (!newName) {
    alert("タブ名を入力してください。");
    return;
  }

  if (newName === tab.name) return;

  const duplicate = state.tabs.some(item => item.id !== tab.id && item.name.trim() === newName);
  if (duplicate) {
    alert("同じ名前の分類タブがあります。");
    return;
  }

  await put(STORE_TABS, { ...tab, name: newName });
  await refreshData();
  render();
  $("settingsDialog").close();
  showToast("タブ名を変更しました");
}

async function moveSelectedTab(direction) {
  const tab = getSelectedEditableTab();
  if (!tab) {
    alert("移動したい分類タブを先に選んでください。\n「すべて」と「よく使う」は固定タブです。");
    return;
  }

  const ordered = [...state.tabs].sort((a, b) =>
    (Number(a.order) || 0) - (Number(b.order) || 0) || a.name.localeCompare(b.name, "ja")
  );

  const index = ordered.findIndex(item => item.id === tab.id);
  const targetIndex = index + direction;

  if (targetIndex < 0) {
    showToast("これ以上左へ移動できません");
    return;
  }

  if (targetIndex >= ordered.length) {
    showToast("これ以上右へ移動できません");
    return;
  }

  [ordered[index], ordered[targetIndex]] = [ordered[targetIndex], ordered[index]];

  for (let i = 0; i < ordered.length; i += 1) {
    const item = ordered[i];
    const nextOrder = i + 1;
    if (Number(item.order) !== nextOrder) {
      await put(STORE_TABS, { ...item, order: nextOrder });
    }
  }

  await refreshData();
  render();
  showToast(direction < 0 ? "タブを左へ移動しました" : "タブを右へ移動しました");
}

function loadThemeGestureAssets() {
  if (!document.querySelector('link[data-qcm-theme-gesture]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "./theme-gesture.css";
    link.dataset.qcmThemeGesture = "true";
    document.head.appendChild(link);
  }

  const stack = document.querySelector("#settingsDialog .settings-stack");
  if (stack && !document.getElementById("themeToggleBtn")) {
    const button = document.createElement("button");
    button.id = "themeToggleBtn";
    button.className = "secondary-btn full";
    button.type = "button";
    button.textContent = "ダークモード：OFF";
    button.setAttribute("aria-pressed", "false");
    stack.insertBefore(button, stack.firstChild);
  }

  if (!document.querySelector('script[data-qcm-theme-gesture]')) {
    const script = document.createElement("script");
    script.src = "./theme-gesture.js";
    script.dataset.qcmThemeGesture = "true";
    document.body.appendChild(script);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const renameButton = $("renameTabBtn");
  const moveLeftButton = $("moveTabLeftBtn");
  const moveRightButton = $("moveTabRightBtn");

  if (renameButton) renameButton.addEventListener("click", renameSelectedTab);
  if (moveLeftButton) moveLeftButton.addEventListener("click", () => moveSelectedTab(-1));
  if (moveRightButton) moveRightButton.addEventListener("click", () => moveSelectedTab(1));

  loadThemeGestureAssets();
});
