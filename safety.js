// My QCM safety layer
// IndexedDB remains the primary store. This file keeps a second local,
// device-only snapshot in localStorage so a fresh app start can recover
// from an unexpectedly empty IndexedDB database.

const SAFETY_KEY = "my-qcm-safety-snapshot-v1";
let safetyFirstRefresh = true;

function readSafetySnapshot() {
  try {
    const raw = localStorage.getItem(SAFETY_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.tabs) || !Array.isArray(data.folders) || !Array.isArray(data.notes)) {
      return null;
    }
    return data;
  } catch (error) {
    console.warn("Safety snapshot read failed:", error);
    return null;
  }
}

function writeSafetySnapshot(snapshot) {
  try {
    localStorage.setItem(SAFETY_KEY, JSON.stringify({
      tabs: snapshot.tabs || [],
      folders: snapshot.folders || [],
      notes: snapshot.notes || [],
      savedAt: new Date().toISOString()
    }));
    return true;
  } catch (error) {
    console.warn("Safety snapshot write failed:", error);
    return false;
  }
}

function snapshotFromState() {
  return {
    tabs: state.tabs.map(item => ({ ...item })),
    folders: state.folders.map(item => ({ ...item })),
    notes: state.notes.map(item => ({ ...item }))
  };
}

function updateSafetyItem(storeName, value) {
  const snapshot = readSafetySnapshot() || snapshotFromState();
  const key = storeName === STORE_TABS
    ? "tabs"
    : storeName === STORE_FOLDERS
      ? "folders"
      : storeName === STORE_NOTES
        ? "notes"
        : null;

  if (!key) return;
  const list = snapshot[key] || [];
  const index = list.findIndex(item => item.id === value.id);
  if (index >= 0) list[index] = { ...value };
  else list.push({ ...value });
  snapshot[key] = list;
  writeSafetySnapshot(snapshot);
}

function removeSafetyItem(storeName, id) {
  const snapshot = readSafetySnapshot();
  if (!snapshot) return;
  const key = storeName === STORE_TABS
    ? "tabs"
    : storeName === STORE_FOLDERS
      ? "folders"
      : storeName === STORE_NOTES
        ? "notes"
        : null;

  if (!key) return;
  snapshot[key] = (snapshot[key] || []).filter(item => item.id !== id);
  writeSafetySnapshot(snapshot);
}

const qcmOriginalPut = put;
put = async function safePut(storeName, value) {
  await qcmOriginalPut(storeName, value);
  updateSafetyItem(storeName, value);
};

const qcmOriginalRemove = remove;
remove = async function safeRemove(storeName, id) {
  await qcmOriginalRemove(storeName, id);
  removeSafetyItem(storeName, id);
};

const qcmOriginalRefreshData = refreshData;
refreshData = async function safeRefreshData() {
  await qcmOriginalRefreshData();

  if (safetyFirstRefresh) {
    safetyFirstRefresh = false;
    const snapshot = readSafetySnapshot();
    const currentHasUserData = state.notes.length > 0 || state.folders.length > 0;
    const backupHasUserData = Boolean(snapshot && (snapshot.notes.length > 0 || snapshot.folders.length > 0));

    if (!currentHasUserData && backupHasUserData) {
      try {
        for (const item of snapshot.tabs) await qcmOriginalPut(STORE_TABS, item);
        for (const item of snapshot.folders) await qcmOriginalPut(STORE_FOLDERS, item);
        for (const item of snapshot.notes) await qcmOriginalPut(STORE_NOTES, item);
        await qcmOriginalRefreshData();
        setTimeout(() => showToast("端末内の控えから復元しました"), 100);
      } catch (error) {
        console.warn("Safety recovery failed:", error);
      }
    }
  }

  writeSafetySnapshot(snapshotFromState());
};

function saveSafetyNow() {
  try {
    if (state?.tabs && state?.folders && state?.notes) {
      writeSafetySnapshot(snapshotFromState());
    }
  } catch (error) {
    console.warn("Safety page snapshot failed:", error);
  }
}

window.addEventListener("pagehide", saveSafetyNow);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveSafetyNow();
});

if (navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {});
}
