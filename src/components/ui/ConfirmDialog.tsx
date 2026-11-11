import { t } from "../../i18n";
import type { ComponentChildren, ComponentType } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { Trash } from "./icons";
import { Modal } from "./Modal";

type Props = {
  open: boolean;
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  icon?: ComponentType<{ size?: number }>;
  children: ComponentChildren;
};

export function ConfirmDialog({ open, title, confirmLabel, onConfirm, onClose, icon: Icon = Trash, children }: Props) {
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) cancel.current?.focus();
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} label={title} class="confirm">
      <div class="confirm__icon">
        <Icon size={22} />
      </div>
      <h2 class="confirm__title">{title}</h2>
      <p class="confirm__text">{children}</p>
      <div class="confirm__actions">
        <button ref={cancel} type="button" class="button" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button type="button" class="button button--danger-solid" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
