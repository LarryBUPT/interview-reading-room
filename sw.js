const CACHE_VERSION = "c4fa270078ad138d81e9";
const APP_ROOT = new URL("./", self.location.href);
const CACHE_PREFIX = "java-ai-reader:" + APP_ROOT.pathname + ":";
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
const COMPLETE_URL = new URL(".offline-complete", APP_ROOT).href;
const MANIFEST_URL = new URL("offline-manifest.json", APP_ROOT).href;
const SHELL_PATHS = ["./", "reader/", "reader/index.html", "reader/reader.js", "reader/vault.js", "reader/offline.js", "offline-manifest.json"];
let downloadJob = null;
let progress = { completed: 0, total: 0 };
const downloadPorts = new Set();

async function checkedFetch(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let response;
  try {
    response = await fetch(url, { cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error("下载失败，请在能正常打开网站的网络下重试。");
  const type = response.headers.get("content-type") || "";
  const pathname = new URL(url).pathname;
  if (/\.js$/.test(pathname) && !/javascript/.test(type)) throw new Error("章节下载受到网络限制。");
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(pathname) && !type.startsWith("image/")) throw new Error("图片下载受到网络限制。");
  if (/\/reader\/(index\.html)?$/.test(pathname)) {
    if (!(await response.clone().text()).includes("java-ai-reader-theme")) throw new Error("阅读页下载受到网络限制。");
  }
  return response;
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(SHELL_PATHS.map(async path => {
      const url = new URL(path, APP_ROOT).href;
      await cache.put(url, await checkedFetch(url));
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const expired = (await caches.keys()).filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME);
    await Promise.all(expired.map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== APP_ROOT.origin || !url.pathname.startsWith(APP_ROOT.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const saved = await cache.match(event.request, { ignoreSearch: true });
    if (saved) return saved;
    try {
      return await fetch(event.request);
    } catch {
      return new Response("此内容尚未下载。请连接能正常访问网站的网络后保存离线资料。", {
        status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  })());
});

function report(message) {
  for (const port of downloadPorts) port.postMessage(message);
}

async function downloadAll() {
  const response = await checkedFetch(MANIFEST_URL);
  const manifest = await response.clone().json();
  if (manifest.version !== CACHE_VERSION) throw new Error("资料已更新，请刷新页面后重新下载。");
  const cache = await caches.open(CACHE_NAME);
  await cache.put(MANIFEST_URL, response);
  progress = { completed: 0, total: manifest.files.length };
  let nextIndex = 0;
  async function downloadNext() {
    while (nextIndex < manifest.files.length) {
      const file = manifest.files[nextIndex++];
      const url = new URL(file.path, APP_ROOT);
      if (url.origin !== APP_ROOT.origin || !url.pathname.startsWith(APP_ROOT.pathname)) throw new Error("离线资料路径无效。");
      if (!(await cache.match(url.href))) await cache.put(url.href, await checkedFetch(url.href));
      progress.completed++;
      report({ type: "progress", ...progress });
    }
  }
  const results = await Promise.allSettled(Array.from({ length: 4 }, downloadNext));
  const failed = results.find(result => result.status === "rejected");
  if (failed) throw failed.reason;
  for (const path of ["./", "reader/"]) {
    const url = new URL(path, APP_ROOT).href;
    await cache.put(url, await checkedFetch(url));
  }
  await cache.put(COMPLETE_URL, new Response(CACHE_VERSION));
}

self.addEventListener("message", event => {
  const port = event.ports[0];
  if (!port) return;
  if (event.data?.type === "status") {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_NAME);
      port.postMessage({ type: "status", complete: !!(await cache.match(COMPLETE_URL)), current: true });
    })());
  }
  if (event.data?.type === "download") {
    downloadPorts.add(port);
    port.postMessage({ type: "progress", ...progress });
    if (!downloadJob) {
      downloadJob = downloadAll()
        .then(() => report({ type: "complete" }))
        .catch(error => report({ type: "error", message: error.message }))
        .finally(() => { downloadJob = null; downloadPorts.clear(); });
    }
    event.waitUntil(downloadJob);
  }
});
