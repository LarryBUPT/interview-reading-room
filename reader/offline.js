(() => {
  const button = document.getElementById("download-offline");
  const status = document.getElementById("offline-status");
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    button.disabled = true;
    status.textContent = "此浏览器环境暂不支持离线保存。";
    return;
  }
  const appRoot = new URL("../", document.baseURI);
  let registration;

  function messageWorker(type, onMessage) {
    const channel = new MessageChannel();
    let timer;
    function stop() {
      clearTimeout(timer);
      channel.port1.close();
    }
    function resetTimer() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        stop();
        button.disabled = false;
        status.textContent = "下载暂时中断，请检查网络后重试。";
      }, 60000);
    }
    channel.port1.onmessage = event => {
      resetTimer();
      onMessage(event.data);
      if (event.data.type !== "progress") stop();
    };
    resetTimer();
    registration.active.postMessage({ type }, [channel.port2]);
  }

  button.addEventListener("click", () => {
    button.disabled = true;
    status.textContent = "正在保存离线资料…";
    messageWorker("download", message => {
      if (message.type === "progress") {
        status.textContent = message.total
          ? "正在保存 " + message.completed + " / " + message.total
          : "正在准备下载…";
      } else if (message.type === "complete") {
        button.disabled = false;
        button.textContent = "更新离线资料";
        status.textContent = "全部章节和图片已保存，可离线阅读。";
      } else if (message.type === "error") {
        button.disabled = false;
        status.textContent = message.message;
      }
    });
  });

  navigator.serviceWorker.register(new URL("sw.js", appRoot), { scope: appRoot.pathname })
    .then(candidate => {
      const worker = candidate.installing || candidate.waiting || candidate.active;
      return new Promise((resolve, reject) => {
        function checkState() {
          if (worker.state === "activated") {
            worker.removeEventListener("statechange", checkState);
            resolve(candidate);
          } else if (worker.state === "redundant") {
            worker.removeEventListener("statechange", checkState);
            reject(new Error("离线功能安装失败。"));
          }
        }
        worker.addEventListener("statechange", checkState);
        checkState();
      });
    })
    .then(ready => {
      registration = ready;
      button.disabled = false;
      messageWorker("status", async message => {
        if (message.complete) {
          button.textContent = "更新离线资料";
          status.textContent = message.current
            ? "全部章节和图片已保存，可离线阅读。"
            : "已有离线资料，可下载最新版本。";
        } else {
          status.textContent = "下载完成后可离线阅读。";
          try {
            const response = await fetch(new URL("offline-manifest.json", appRoot));
            const manifest = await response.json();
            const megabytes = Math.ceil(manifest.bytes / (1024 * 1024));
            if (Number.isFinite(megabytes) && !button.disabled) {
              status.textContent = "首次下载约 " + megabytes + " MB，完成后可离线阅读。";
            }
          } catch {}
        }
      });
    })
    .catch(() => {
      button.disabled = true;
      status.textContent = "离线功能未能启动，请在可访问的网络下刷新重试。";
    });
})();
