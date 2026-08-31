// My QCM: dark mode + edge swipe back

const QCM_THEME_KEY = "my-qcm-theme-v1";

function getSavedTheme() {
  try {
    return localStorage.getItem(QCM_THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function updateThemeMeta(theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#1c1d21" : "#f7f7fb");
}

function updateThemeButton(theme) {
  const button = document.getElementById("themeToggleBtn");
  if (!button) return;
  button.textContent = theme === "dark" ? "ダークモード：ON" : "ダークモード：OFF";
  button.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
}

function applyQcmTheme(theme, save = false) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  updateThemeMeta(next);
  updateThemeButton(next);

  if (save) {
    try {
      localStorage.setItem(QCM_THEME_KEY, next);
    } catch (error) {
      console.warn("Theme save failed:", error);
    }
  }
}

applyQcmTheme(getSavedTheme());

function toggleQcmTheme() {
  const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const next = current === "dark" ? "light" : "dark";
  applyQcmTheme(next, true);
  if (typeof showToast === "function") {
    showToast(next === "dark" ? "ダークモードにしました" : "ライトモードにしました");
  }
}

function anyDialogOpen() {
  return Boolean(document.querySelector("dialog[open]"));
}

function goToParentFolderBySwipe() {
  if (typeof state === "undefined" || !state.currentFolderId) return false;

  const current = typeof getFolder === "function" ? getFolder(state.currentFolderId) : null;
  state.currentFolderId = current?.parentId || null;

  if (typeof render === "function") render();
  if (typeof showToast === "function") showToast("ひとつ上へ戻りました");
  return true;
}

function bindEdgeSwipeBack() {
  let tracking = false;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;

  const EDGE_PX = 32;
  const MIN_DISTANCE = 72;
  const MAX_VERTICAL = 70;

  document.addEventListener("touchstart", event => {
    if (event.touches.length !== 1 || anyDialogOpen()) {
      tracking = false;
      return;
    }

    const touch = event.touches[0];
    tracking = touch.clientX <= EDGE_PX && Boolean(state.currentFolderId);
    if (!tracking) return;

    startX = lastX = touch.clientX;
    startY = lastY = touch.clientY;
  }, { passive: true });

  document.addEventListener("touchmove", event => {
    if (!tracking || event.touches.length !== 1) return;
    const touch = event.touches[0];
    lastX = touch.clientX;
    lastY = touch.clientY;
  }, { passive: true });

  document.addEventListener("touchend", () => {
    if (!tracking) return;
    tracking = false;

    const dx = lastX - startX;
    const dy = Math.abs(lastY - startY);

    if (dx >= MIN_DISTANCE && dy <= MAX_VERTICAL) {
      goToParentFolderBySwipe();
    }
  }, { passive: true });

  document.addEventListener("touchcancel", () => {
    tracking = false;
  }, { passive: true });
}

function initThemeAndGesture() {
  updateThemeButton(document.documentElement.dataset.theme || getSavedTheme());
  document.getElementById("themeToggleBtn")?.addEventListener("click", toggleQcmTheme);
  bindEdgeSwipeBack();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initThemeAndGesture, { once: true });
} else {
  initThemeAndGesture();
}
