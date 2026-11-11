import { useEffect, useState } from "preact/hooks";
import { APP_VERSION } from "../../data";
import { isTauri } from "../../deck/link";
import { t } from "../../i18n";
import logo from "../../../src-tauri/icons/128x128@2x.png";
import { Copy, GitHub, Heart, TickCircle } from "../ui/icons";
import { showToast } from "../ui/Toast";

const REPOSITORY = "https://github.com/Open-Stream-Deck/Open-Stream-Deck-App";
const DONATE = "https://donate.opensd.dev";
const EMAIL = "ceo@lisik.dev";
const COPIED_MS = 1600;

async function openLink(url: string) {
  if (!isTauri()) {
    window.open(url, "_blank");
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("plugin_open_url", { url });
}

export function AboutSection() {
  const [copied, setCopied] = useState(0);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(0), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyEmail = () =>
    navigator.clipboard
      .writeText(EMAIL)
      .then(() => setCopied(Date.now()))
      .catch((e) => showToast(String(e)));

  return (
    <div class="about">
      <img class="about__logo" src={logo} alt="Open Stream Deck" width={88} height={88} />
      <div class="about__name">Open Stream Deck</div>
      <div class="about__version">{t("about.version", { version: APP_VERSION })}</div>
      <p class="about__text">{t("about.text")}</p>
      <div class="about__actions">
        <button type="button" class="button" onClick={() => void openLink(REPOSITORY)}>
          <GitHub size={16} />
          GitHub
        </button>
        <button type="button" class="button about__donate" onClick={() => void openLink(DONATE)}>
          <Heart size={16} />
          {t("about.donate")}
        </button>
      </div>
      <button
        type="button"
        class={copied ? "about__email about__email--copied" : "about__email"}
        data-tip={t("about.copyEmail")}
        onClick={copyEmail}
      >
        <span key={copied ? "copied" : "email"} class="about__email-label">
          {copied ? t("about.emailCopied") : EMAIL}
        </span>
        <span key={copied || "icon"} class="about__email-icon">
          {copied ? <TickCircle size={13} /> : <Copy size={13} />}
        </span>
      </button>
    </div>
  );
}
