/**
 * 内容脚本：仅在商品详情 / 商家商品页注入「获取图片」按钮，
 * 扫描页面商品图并发送给 Service Worker。
 */
(function () {
  "use strict";

  const MIN_SIZE = 100;
  const BUTTON_ID = "igp-grab-btn";
  const TOAST_ID = "igp-grab-toast";

  const LAZY_ATTRS = [
    "src",
    "data-src",
    "data-lazy-src",
    "data-original",
    "data-ks-lazyload",
    "data-lazyload-src",
    "data-lazy-img",
    "data-img",
    "data-url",
    "data-image",
    "data-origin",
    "data-init-src"
  ];

  const SKIP_URL_RE =
    /icon|logo|sprite|avatar|blank|placeholder|pixel|loading|spinner|favicon|qrcode|qr_code|emoji/i;
  const SKIP_EXT_RE = /\.(svg|ico)(\?|$)/i;

  function host() {
    return location.hostname.toLowerCase();
  }

  function path() {
    return (location.pathname || "").toLowerCase();
  }

  function search() {
    return (location.search || "").toLowerCase();
  }

  function isLocalFixture() {
    return host() === "127.0.0.1" || host() === "localhost";
  }

  function isEcommerceHost() {
    const h = host();
    return (
      h.endsWith("taobao.com") ||
      h.endsWith("tmall.com") ||
      h.endsWith("jd.com") ||
      h.endsWith("pinduoduo.com") ||
      h.endsWith("yangkeduo.com") ||
      isLocalFixture()
    );
  }

  /**
   * URL 白名单：消费端详情 + 商家后台商品相关路径。
   */
  function isProductUrl() {
    const h = host();
    const p = path();
    const q = search();

    if (isLocalFixture()) {
      return /product|item|goods|detail|fixture/i.test(p + q) || p.endsWith(".html");
    }

    // 淘宝 / 天猫消费端
    if (
      h.includes("item.taobao.com") ||
      h.includes("detail.tmall.com") ||
      h.includes("chaoshi.detail.tmall.com") ||
      h.includes("detail.taobao.com")
    ) {
      return true;
    }
    if ((h.endsWith("taobao.com") || h.endsWith("tmall.com")) && /item\.htm|\/item\b/.test(p)) {
      return true;
    }

    // 淘宝商家
    if (
      h.includes("sell.taobao.com") ||
      h.includes("myseller.taobao.com") ||
      h.includes("item.upload.taobao.com") ||
      h.includes("upload.taobao.com")
    ) {
      return /item|goods|product|publish|edit|detail|auction/i.test(p + q) || true;
    }

    // 京东消费端
    if (h.includes("item.jd.com") || /\/item\.html|\/\d+\.html/.test(p)) {
      if (h.endsWith("jd.com")) return true;
    }

    // 京东商家
    if (
      h.includes("shop.jd.com") ||
      h.includes("goods.shop.jd.com") ||
      h.includes("vender.jd.com") ||
      h.includes("vendor.jd.com")
    ) {
      return /item|goods|ware|product|sku|detail|edit/i.test(p + q) || p.length > 1;
    }

    // 拼多多消费端
    if (h.endsWith("yangkeduo.com") || h.endsWith("pinduoduo.com")) {
      if (/goods\.html|\/goods|\/item|\/product/.test(p) || /[?&]goods_id=/.test(q)) {
        return true;
      }
    }

    // 拼多多商家
    if (h.includes("mms.pinduoduo.com") || h.includes("suc.pinduoduo.com")) {
      return /goods|product|item|detail|edit|publish/i.test(p + q) || true;
    }

    return false;
  }

  /**
   * DOM 兜底：商家 SPA 路径不稳定时，若页面已有足够商品大图则视为商品页。
   */
  function isProductDom() {
    if (!isEcommerceHost() && !isLocalFixture()) return false;
    const selectors = [
      "#J_UlThumb",
      ".tb-gallery",
      ".preview-wrap",
      "#spec-img",
      ".spec-items",
      ".sku-name",
      ".goods-detail",
      "[class*='mainPic']",
      "[class*='main-pic']",
      "[class*='product-img']"
    ];
    if (selectors.some((s) => document.querySelector(s))) return true;

    const imgs = document.querySelectorAll("img");
    let large = 0;
    imgs.forEach((img) => {
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      if (w >= MIN_SIZE && h >= MIN_SIZE) large += 1;
    });
    return large >= 3;
  }

  function isProductPage() {
    return isProductUrl() || isProductDom();
  }

  function showToast(text) {
    let el = document.getElementById(TOAST_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = TOAST_ID;
      document.documentElement.appendChild(el);
    }
    el.textContent = text;
    el.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      el.hidden = true;
    }, 2600);
  }

  function injectButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.type = "button";
    btn.textContent = "获取图片";
    btn.addEventListener("click", onGrabClick);
    (document.body || document.documentElement).appendChild(btn);
  }

  function collectFromSrcset(value) {
    if (!value) return [];
    return value
      .split(",")
      .map((part) => {
        const bits = part.trim().split(/\s+/);
        const url = bits[0];
        const w = bits[1] && bits[1].endsWith("w") ? parseInt(bits[1], 10) : 0;
        return { url, w: Number.isFinite(w) ? w : 0 };
      })
      .filter((x) => x.url)
      .sort((a, b) => b.w - a.w)
      .map((x) => x.url);
  }

  function collectUrlsFromElement(el) {
    const urls = [];
    for (const attr of LAZY_ATTRS) {
      const v = el.getAttribute(attr);
      if (v) urls.push(v);
    }
    collectFromSrcset(el.getAttribute("srcset")).forEach((u) => urls.push(u));
    collectFromSrcset(el.getAttribute("data-srcset")).forEach((u) => urls.push(u));
    return urls;
  }

  function collectBackgroundUrls(el) {
    const urls = [];
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || bg === "none") return urls;
    const re = /url\((['"]?)(.*?)\1\)/g;
    let m;
    while ((m = re.exec(bg))) {
      urls.push(m[2]);
    }
    return urls;
  }

  function absoluteUrl(raw) {
    if (!raw) return "";
    let u = String(raw).trim();
    if (!u || u === "none") return "";
    u = u.replace(/^url\((['"]?)(.*)\1\)$/i, "$2");
    if (u.startsWith("data:")) return "";
    if (u.startsWith("blob:")) return "";
    try {
      return new URL(u, location.href).href;
    } catch {
      return "";
    }
  }

  /**
   * 淘宝/天猫缩略图后缀：_400x400q90.jpg_.webp 等，尽量升为原图。
   */
  function upgradeTaobaoUrl(url) {
    try {
      const u = new URL(url);
      if (!/alicdn|taobao|tbcdn|taobaocdn/i.test(u.hostname)) return url;
      u.pathname = u.pathname
        .replace(/_\d+x\d+(q\d+)?(\.\w+)?(_\.webp)?$/i, "")
        .replace(/_\.webp$/i, "");
      return u.href;
    } catch {
      return url;
    }
  }

  /**
   * 京东缩略图：s54x54_jfs / n5/s54x54_ 等尽量升档。
   */
  function upgradeJdUrl(url) {
    try {
      const u = new URL(url);
      if (!/360buyimg|jdcdn|jd\.com/i.test(u.hostname)) return url;
      u.pathname = u.pathname
        .replace(/\/s\d+x\d+_jfs\//i, "/jfs/")
        .replace(/\/n\d+\//i, "/n0/")
        .replace(/\/s\d+x\d+_/g, "/");
      return u.href;
    } catch {
      return url;
    }
  }

  function upgradeUrl(url) {
    return upgradeJdUrl(upgradeTaobaoUrl(url));
  }

  function shouldSkipUrl(url) {
    if (!url || !/^https?:/i.test(url)) return true;
    if (SKIP_EXT_RE.test(url)) return true;
    if (SKIP_URL_RE.test(url)) return true;
    return false;
  }

  function readDeclaredSize(el) {
    const w = parseInt(el.getAttribute("width") || el.getAttribute("data-width") || "0", 10);
    const h = parseInt(el.getAttribute("height") || el.getAttribute("data-height") || "0", 10);
    return {
      width: Number.isFinite(w) ? w : 0,
      height: Number.isFinite(h) ? h : 0
    };
  }

  function isTiny(el) {
    const nw = el.naturalWidth || 0;
    const nh = el.naturalHeight || 0;
    if (nw === 1 && nh === 1) return true;
    if (nw && nh && (nw < MIN_SIZE || nh < MIN_SIZE)) return true;
    const dw = el.width || 0;
    const dh = el.height || 0;
    if (dw && dh && dw < MIN_SIZE && dh < MIN_SIZE && !el.getAttribute("data-src")) {
      const declared = readDeclaredSize(el);
      if (!declared.width && !declared.height) return true;
    }
    return false;
  }

  function gatherCandidates() {
    const map = new Map();

    function add(raw, el) {
      const abs = absoluteUrl(raw);
      if (shouldSkipUrl(abs)) return;
      const url = upgradeUrl(abs);
      if (shouldSkipUrl(url)) return;
      const size = el ? readDeclaredSize(el) : { width: 0, height: 0 };
      if (el && el.tagName === "IMG") {
        size.width = size.width || el.naturalWidth || 0;
        size.height = size.height || el.naturalHeight || 0;
        if (isTiny(el) && size.width && size.height && (size.width < MIN_SIZE || size.height < MIN_SIZE)) {
          return;
        }
      }
      if (!map.has(url)) {
        map.set(url, { url, width: size.width, height: size.height });
      }
    }

    document.querySelectorAll("img").forEach((img) => {
      collectUrlsFromElement(img).forEach((u) => add(u, img));
    });

    document.querySelectorAll("source").forEach((src) => {
      collectUrlsFromElement(src).forEach((u) => add(u, src));
    });

    // 只扫描带背景图的节点，避免对整页 getComputedStyle
    document.querySelectorAll("[style*='background']").forEach((el) => {
      collectBackgroundUrls(el).forEach((u) => add(u, el));
    });
    document.querySelectorAll("[data-src], [data-lazy-src], [data-original]").forEach((el) => {
      if (el.tagName === "IMG" || el.tagName === "SOURCE") return;
      collectUrlsFromElement(el).forEach((u) => add(u, el));
    });

    return Array.from(map.values());
  }

  async function onGrabClick(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    const btn = ev.currentTarget;
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = "提取中…";

    try {
      const images = gatherCandidates().filter((item) => {
        if (item.width && item.height && (item.width < MIN_SIZE || item.height < MIN_SIZE)) {
          return false;
        }
        return true;
      });

      if (!images.length) {
        showToast("未找到符合尺寸的商品图片");
        return;
      }

      const payload = {
        type: "IMAGES_EXTRACTED",
        pageTitle: document.title || "商品图",
        pageUrl: location.href,
        images
      };

      await chrome.runtime.sendMessage(payload);
      showToast("已提取 " + images.length + " 张图片");
    } catch (err) {
      console.error("[igp]", err);
      showToast("提取失败，请刷新后重试");
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  function boot() {
    if (!isProductPage()) return;
    injectButton();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // 商家后台多为 SPA，路由变化后再判定一次
  let moTimer = 0;
  const mo = new MutationObserver(() => {
    clearTimeout(moTimer);
    moTimer = setTimeout(() => {
      if (!document.getElementById(BUTTON_ID) && isProductPage()) injectButton();
    }, 400);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
