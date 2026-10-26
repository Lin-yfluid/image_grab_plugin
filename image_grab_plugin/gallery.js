/**
 * 图库页：展示提取结果，支持全选/反选与批量 PNG 下载。
 */
(function () {
  "use strict";

  const grid = document.getElementById("grid");
  const empty = document.getElementById("empty");
  const sourceMeta = document.getElementById("sourceMeta");
  const selectedCount = document.getElementById("selectedCount");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayText = document.getElementById("overlayText");
  const progressBar = document.getElementById("progressBar");
  const btnAll = document.getElementById("btnAll");
  const btnInvert = document.getElementById("btnInvert");
  const btnDownload = document.getElementById("btnDownload");

  let images = [];

  function cards() {
    return Array.from(grid.querySelectorAll(".card"));
  }

  function updateCount() {
    const total = images.length;
    const selected = cards().filter((c) => c.querySelector("input").checked).length;
    selectedCount.textContent = "已选 " + selected + " / " + total;
    btnDownload.disabled = selected === 0;
  }

  function render(data) {
    images = (data && data.images) || [];
    const title = (data && data.pageTitle) || "";
    const url = (data && data.pageUrl) || "";
    sourceMeta.textContent = images.length
      ? "共 " + images.length + " 张 · " + (title || url)
      : "暂无提取结果";
    sourceMeta.title = url;

    grid.innerHTML = "";
    empty.hidden = images.length > 0;

    images.forEach((item, index) => {
      const card = document.createElement("label");
      card.className = "card";
      const img = document.createElement("img");
      img.alt = "商品图 " + (index + 1);
      img.loading = "lazy";
      img.src = item.url;
      img.addEventListener("load", () => {
        if (!item.width || !item.height) {
          item.width = img.naturalWidth;
          item.height = img.naturalHeight;
          sizeEl.textContent = item.width + " × " + item.height;
        }
      });
      const row = document.createElement("div");
      row.className = "meta-row";
      const sizeEl = document.createElement("span");
      sizeEl.textContent =
        item.width && item.height ? item.width + " × " + item.height : "尺寸读取中";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = true;
      cb.dataset.url = item.url;
      cb.addEventListener("change", updateCount);
      row.append(sizeEl, cb);
      card.append(img, row);
      grid.appendChild(card);
    });
    updateCount();
  }

  btnAll.addEventListener("click", () => {
    cards().forEach((c) => {
      c.querySelector("input").checked = true;
    });
    updateCount();
  });

  btnInvert.addEventListener("click", () => {
    cards().forEach((c) => {
      const input = c.querySelector("input");
      input.checked = !input.checked;
    });
    updateCount();
  });

  btnDownload.addEventListener("click", async () => {
    const urls = cards()
      .map((c) => c.querySelector("input"))
      .filter((input) => input.checked)
      .map((input) => input.dataset.url);
    if (!urls.length) return;

    overlay.hidden = false;
    overlayTitle.textContent = "正在下载";
    overlayText.textContent = "准备下载 " + urls.length + " 张…";
    progressBar.style.width = "4%";
    btnDownload.disabled = true;

    try {
      const res = await chrome.runtime.sendMessage({
        type: "DOWNLOAD_SELECTED",
        urls
      });
      if (!res || !res.ok) {
        throw new Error((res && res.error) || "下载失败");
      }
    } catch (err) {
      overlayTitle.textContent = "下载失败";
      overlayText.textContent = String(err && err.message ? err.message : err);
      btnDownload.disabled = false;
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message) return;
    if (message.type === "DOWNLOAD_PROGRESS") {
      overlay.hidden = false;
      const pct = message.total ? Math.round((message.current / message.total) * 100) : 0;
      progressBar.style.width = pct + "%";
      overlayText.textContent =
        "进度 " + message.current + " / " + message.total +
        "（成功 " + message.ok + "，失败 " + message.fail + "）";
    }
    if (message.type === "DOWNLOAD_DONE") {
      overlay.hidden = false;
      overlayTitle.textContent = "下载完成";
      progressBar.style.width = "100%";
      overlayText.textContent =
        "成功 " + message.ok + " 张，失败 " + message.fail + " 张。文件已保存到浏览器默认下载目录。";
      btnDownload.disabled = false;
      setTimeout(() => {
        overlay.hidden = true;
      }, 2200);
    }
  });

  chrome.runtime
    .sendMessage({ type: "GET_IMAGES" })
    .then((res) => {
      if (res && res.ok) render(res.data);
      else render({ images: [] });
    })
    .catch(() => render({ images: [] }));
})();
