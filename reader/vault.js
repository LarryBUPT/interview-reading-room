"use strict";

(() => {
  if (window.READER_CATALOG && window.READER_PROJECT_BOOKS) {
    window.startReader({
      books: [...window.READER_CATALOG.books, ...window.READER_PROJECT_BOOKS.books],
      collections: window.READER_PROJECT_BOOKS.collections,
    });
    return;
  }

  const panel = document.getElementById("unlock");
  const form = document.getElementById("unlock-form");
  const field = document.getElementById("passphrase");
  const status = document.getElementById("unlock-status");
  const button = form.querySelector("button");
  const vaultRoot = new URL("../vault/", document.baseURI);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let opening;

  panel.hidden = false;
  if (!window.crypto?.subtle) {
    button.disabled = true;
    status.textContent = "请通过 HTTPS 访问，或更换支持加密的浏览器。";
    return;
  }

  async function fetchVault(file) {
    const response = await fetch(new URL(file, vaultRoot));
    if (!response.ok) throw new Error("资料暂时无法加载，请检查网络后重试。");
    return response;
  }

  async function readOpeningFiles() {
    const response = await fetchVault("config.json");
    const config = await response.json();
    if (config.version !== 1 || !/^[a-f0-9]{32}$/.test(config.salt) || !/^[a-f0-9]{32}$/.test(config.index)) {
      throw new Error("资料格式有误，请刷新后重试。");
    }
    return {
      salt: Uint8Array.from(config.salt.match(/../g), part => parseInt(part, 16)),
      id: config.index,
      bytes: await (await fetchVault(config.index + ".bin")).arrayBuffer(),
    };
  }

  async function derive(passphrase, salt) {
    const material = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
  }

  function decrypt(key, id, data) {
    const bytes = new Uint8Array(data);
    return crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.subarray(0, 12), additionalData: encoder.encode(id) },
      key,
      bytes.subarray(12),
    );
  }

  function openAssets(key, files) {
    function lookup(path) {
      const url = new URL(path, document.baseURI);
      return url.origin === location.origin ? files.get(url.pathname) : undefined;
    }
    async function read(path) {
      const file = lookup(path);
      if (!file) throw new Error("资料索引中找不到该文件。");
      try {
        const response = await fetchVault(file.id + ".bin");
        return { content: await decrypt(key, file.id, await response.arrayBuffer()), type: file.type };
      } catch {
        throw new Error("资料加载失败，请检查网络或更新离线资料。");
      }
    }
    return {
      has: path => Boolean(lookup(path)),
      json: async path => JSON.parse(decoder.decode((await read(path)).content)),
      blob: async path => {
        const { content, type } = await read(path);
        return new Blob([content], { type });
      },
    };
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    status.textContent = "正在解锁…";
    let passphrase = field.value.trim();
    field.value = "";
    try {
      opening ||= readOpeningFiles().catch(error => {
        opening = undefined;
        throw error;
      });
      const { salt, id, bytes } = await opening;
      const key = await derive(passphrase, salt);
      passphrase = "";
      let index;
      try {
        index = JSON.parse(decoder.decode(await decrypt(key, id, bytes)));
      } catch {
        throw new Error("口令不匹配，请重新输入。");
      }
      const appRoot = new URL("../", document.baseURI);
      const files = new Map(Object.entries(index.files).map(([path, file]) =>
        [new URL(path, appRoot).pathname, file]
      ));
      window.startReader(index.catalog, openAssets(key, files));
      opening = undefined;
      panel.hidden = true;
    } catch (error) {
      status.textContent = error.message;
      field.focus();
    } finally {
      button.disabled = false;
    }
  });
})();
