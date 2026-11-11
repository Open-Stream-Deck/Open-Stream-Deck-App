import { useState } from "preact/hooks";
import { t } from "../i18n";
import { installUpdate, useUpdate } from "../updater";
import { Refresh } from "./ui/icons";
import { Modal } from "./ui/Modal";

export function UpdateDialog() {
  const update = useUpdate();
  const [dismissed, setDismissed] = useState("");
  const version = update.kind === "available" || update.kind === "downloading" ? update.version : "";
  const downloading = update.kind === "downloading";
  const close = () => {
    if (!downloading) setDismissed(version);
  };

  return (
    <Modal open={!!version && dismissed !== version} onClose={close} label={t("update.title")} class="confirm">
      <div class="confirm__icon confirm__icon--accent">
        <Refresh size={22} />
      </div>
      <h2 class="confirm__title">{t("update.title")}</h2>
      <p class="confirm__text">{t("update.text", { version })}</p>
      {downloading ? (
        <div class="progress-block update__progress">
          <div class="progress">
            <div class="progress__bar" style={`width: ${Math.max(update.percent, 2)}%`} />
          </div>
          <p class="confirm__text">{t("update.downloading", { percent: update.percent })}</p>
        </div>
      ) : (
        <div class="confirm__actions">
          <button type="button" class="button" onClick={close}>
            {t("update.later")}
          </button>
          <button type="button" class="button button--primary" onClick={() => void installUpdate()}>
            {t("update.install")}
          </button>
        </div>
      )}
    </Modal>
  );
}
