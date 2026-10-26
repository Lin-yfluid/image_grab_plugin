/**
 * Service Worker：暂存提取结果、打开图库/官网、跨域拉取并转 PNG 后下载。
 */

const STORAGE_KEY = "igpLastExtract";
const DOWNLOAD_CONCURRENCY = 2;

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("home.html") });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === "IMAGES_EXTRACTED") {
    handleExtracted(message)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (message.type === "GET_IMAGES") {
    readStore()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (message.type === "DOWNLOAD_SELECTED") {
    handleDownload(message)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
});

async function handleExtracted(message) {
  const record = {
    pageTitle: message.pageTitle || "",
    pageUrl: message.pageUrl || "",
    images: Array.isArray(message.images) ? message.images : [],
    savedAt: Date.now()
  };
  await writeStore(record);
  await chrome.tabs.create({ url: chrome.runtime.getURL("gallery.html") });
}

function storageArea() {
  return chrome.storage.session || chrome.storage.local;
}

function writeStore(record) {
  return storageArea().set({ [STORAGE_KEY]: record });
}

async function readStore() {
  const bag = await storageArea().get(STORAGE_KEY);
  return bag[STORAGE_KEY] || { images: [], pageTitle: "", pageUrl: "" };
}

function broadcast(payload) {
  chrome.runtime.sendMessage(payload).catch(() => {});
}

async function handleDownload(message) {
  const urls = Array.isArray(message.urls) ? message.urls.filter(Boolean) : [];
  const total = urls.length;
  let ok = 0;
  let fail = 0;
  const queue = urls.map((url, i) => ({ url, index: i }));

  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      const seq = String(item.index + 1).padStart(3, "0");
      const filename = `商品图_${seq}.png`;
      try {
        await downloadOneAsPng(item.url, filename);
        ok += 1;
        broadcast({
          type: "DOWNLOAD_PROGRESS",
          current: ok + fail,
          total,
          ok,
          fail,
          filename
        });
      } catch (err) {
        fail += 1;
        broadcast({
          type: "DOWNLOAD_PROGRESS",
          current: ok + fail,
          total,
          ok,
          fail,
          error: String(err && err.message ? err.message : err),
          url: item.url
        });
      }
    }
  }

  const n = Math.min(DOWNLOAD_CONCURRENCY, Math.max(total, 0));
  await Promise.all(Array.from({ length: n }, () => worker()));

  const result = { total, ok, fail };
  broadcast({ type: "DOWNLOAD_DONE", ...result });
  return result;
}

async function downloadOneAsPng(url, filename) {
  const res = await fetch(url, { credentials: "omit", cache: "no-cache" });
  if (!res.ok) {
    throw new Error("HTTP " + res.status);
  }
  const buf = await res.arrayBuffer();
  const blob = new Blob([buf]);
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pngBlob = await canvas.convertToBlob({ type: "image/png" });
  const dataUrl = await blobToDataUrl(pngBlob);
  await chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: false,
    conflictAction: "uniquify"
  });
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return "data:image/png;base64," + btoa(binary);
}
