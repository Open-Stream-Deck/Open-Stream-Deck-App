const TEXTS: Record<string, Record<string, string>> = {
  ru: {
    download: "Загрузка обновления",
    install: "Установка обновления",
    error: "Не удалось установить",
    retry: "Повторить",
    quit: "Закрыть",
  },
  en: {
    download: "Downloading update",
    install: "Installing update",
    error: "Installation failed",
    retry: "Retry",
    quit: "Close",
  },
  zh: {
    download: "正在下载",
    install: "正在安装",
    error: "安装失败",
    retry: "重试",
    quit: "关闭",
  },
};

const CLOSE_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 12h12M12 18V6" transform="rotate(45 12 12)"/></svg>';

export function mount(image: string, send: (message: string) => void, lang: string) {
  const t = TEXTS[lang.slice(0, 2)] || TEXTS.en;
  document.body.innerHTML = `
    <main>
      <img id="artwork" src="${image}" alt="Open Stream Deck" width="248" height="300" draggable="false" />
      <div id="update" role="status" aria-live="polite" hidden>
        <button class="icon-button" id="close" aria-label="${t.quit}">${CLOSE_ICON}</button>
        <div id="status"></div>
        <div id="bar"><div id="fill"></div></div>
        <div id="error">
          <p id="detail"></p>
          <div class="actions">
            <button class="button" id="quit">${t.quit}</button>
            <button class="button button--primary" id="retry">${t.retry}</button>
          </div>
        </div>
      </div>
    </main>`;
  const $ = (id: string) => document.getElementById(id)!;

  const state = (name: string, status: string) => {
    document.body.className = name;
    $("update").hidden = !status;
    $("status").textContent = status;
  };
  const close = (message: string) => {
    document.body.classList.add("closing");
    setTimeout(() => send(message), 300);
  };

  Object.assign(window, {
    checking: () => state("", ""),
    progress: (value: number) => {
      state("busy", `${t.download} ${Math.round(value * 100)}%`);
      $("fill").style.width = `${value * 100}%`;
    },
    installing: () => state("busy installing", t.install),
    done: () => {
      state("done", "");
      setTimeout(() => close("done"), 700);
    },
    failed: (error: string) => {
      state("error", t.error);
      $("detail").textContent = error;
    },
  });

  state("", "");
  document.addEventListener("mousedown", (e) => {
    if (e.button === 0 && !(e.target as Element).closest("button")) send("drag");
  });
  $("close").onclick = () => close("close");
  $("quit").onclick = () => close("close");
  $("retry").onclick = () => {
    state("", "");
    send("check");
  };
}
