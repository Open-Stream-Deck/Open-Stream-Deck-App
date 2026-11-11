import { useEffect, useRef } from "preact/hooks";
import { t } from "../../i18n";
import type { Permission } from "../../types";
import { Shield } from "../ui/icons";
import { Modal } from "../ui/Modal";
import { PluginIcon } from "../ui/pluginIcons";
import { PermissionList } from "./PermissionList";

export type Grant = { id: string; name: string; digest: string; items: Permission[] };

type Props = {
  grant: Grant | null;
  open: boolean;
  icon?: string;
  onClose: () => void;
  onAllow: () => void;
};

export function GrantDialog({ grant, open, icon, onClose, onAllow }: Props) {
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) cancel.current?.focus();
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} label={t("plugins.permissionsTitle")} class="grant">
      {grant && (
        <>
          <div class="grant__head">
            <span class="grant__plugin">
              <PluginIcon pluginId={grant.id} src={icon} />
              <span class="grant__badge">
                <Shield size={13} />
              </span>
            </span>
            <h2 class="confirm__title">{t("plugins.permissionsAsk", { name: grant.name })}</h2>
            <p class="grant__text">{t("plugins.permissionsSandbox")}</p>
          </div>
          <PermissionList items={grant.items} />
          <p class="grant__note">{t("plugins.permissionsNote")}</p>
          <div class="confirm__actions">
            <button ref={cancel} type="button" class="button" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button type="button" class="button button--primary" onClick={onAllow}>
              {t("plugins.allowPermissions")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
