// My QCM: classification tab tools

async function renameSelectedTab() {
  if (state.activeTab === "all" || state.activeTab === "favorites") {
    alert("名前を変えたい分類タブを先に選んでください。\n「すべて」と「よく使う」は固定タブです。");
    return;
  }

  const tab = state.tabs.find(item => item.id === state.activeTab);
  if (!tab) {
    alert("選択中の分類タブが見つかりませんでした。");
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

document.addEventListener("DOMContentLoaded", () => {
  const button = $("renameTabBtn");
  if (button) button.addEventListener("click", renameSelectedTab);
});
