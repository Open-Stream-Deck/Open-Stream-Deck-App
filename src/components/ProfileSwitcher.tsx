import { t } from "../i18n";
import { useEffect, useRef, useState } from "preact/hooks";
import { useDismiss } from "../hooks";
import type { Profile } from "../types";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { openContextMenu } from "./ui/ContextMenu";
import { ChevronDown, Copy, Pencil, Plus, Trash } from "./ui/icons";
import { Popover } from "./ui/Popover";

type Props = {
  profiles: Profile[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => Profile;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
};

export function ProfileSwitcher({ profiles, activeId, onSelect, onCreate, onRename, onDuplicate, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const active = profiles.find((p) => p.id === activeId) ?? profiles[0];

  useDismiss(root, open, () => {
    if (editingId) setEditingId(null);
    else close();
  });

  useEffect(() => {
    if (editingId) input.current?.select();
  }, [editingId]);

  function close() {
    setOpen(false);
    setEditingId(null);
  }

  function requestDelete(profile: Profile) {
    close();
    setDeleteTarget(profile);
    setDeleteOpen(true);
  }

  function startRename(profile: Profile) {
    setDraft(profile.name);
    setEditingId(profile.id);
  }

  function commitRename() {
    if (!editingId) return;
    const name = draft.trim();
    if (name) onRename(editingId, name);
    setEditingId(null);
  }

  return (
    <div class="profile-switcher" ref={root}>
      <button
        type="button"
        class={open ? "profile-switcher__trigger profile-switcher__trigger--open" : "profile-switcher__trigger"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span key={active.id} class="profile-switcher__name">
          {active.name}
        </span>
        <ChevronDown class="profile-switcher__chevron" size={14} />
      </button>

      <Popover open={open} class="profile-menu">
        <div class="profile-menu__caption">{t("profiles.caption")}</div>
        <ul class="profile-menu__list">
          {profiles.map((profile) => {
            const isActive = profile.id === activeId;
            const isEditing = profile.id === editingId;
            return (
              <li
                key={profile.id}
                class={isActive ? "profile-item profile-item--active" : "profile-item"}
                onContextMenu={(e) =>
                  openContextMenu(e, [
                    { label: t("common.rename"), icon: Pencil, onSelect: () => startRename(profile) },
                    { label: t("common.duplicate"), icon: Copy, onSelect: () => onDuplicate(profile.id) },
                    "separator",
                    {
                      label: t("common.delete"),
                      icon: Trash,
                      danger: true,
                      disabled: profiles.length === 1,
                      onSelect: () => requestDelete(profile),
                    },
                  ])
                }
              >
                {isEditing ? (
                  <input
                    ref={input}
                    class="profile-item__input"
                    value={draft}
                    maxLength={32}
                    placeholder={t("profiles.namePlaceholder")}
                    onInput={(e) => setDraft(e.currentTarget.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => e.key === "Enter" && commitRename()}
                  />
                ) : (
                  <button
                    type="button"
                    class="profile-item__main"
                    onClick={() => {
                      onSelect(profile.id);
                      close();
                    }}
                    onDblClick={() => startRename(profile)}
                  >
                    <span class="profile-item__name">{profile.name}</span>
                  </button>
                )}
                {!isEditing && (
                  <div class="profile-item__actions">
                    <button
                      type="button"
                      class="icon-button"
                      data-tip={t("common.rename")}
                      aria-label={t("common.rename")}
                      onClick={() => startRename(profile)}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      class="icon-button"
                      data-tip={t("common.duplicate")}
                      aria-label={t("common.duplicate")}
                      onClick={() => onDuplicate(profile.id)}
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      type="button"
                      class="icon-button icon-button--danger"
                      data-tip={t("common.delete")}
                      aria-label={t("common.delete")}
                      disabled={profiles.length === 1}
                      onClick={() => requestDelete(profile)}
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          class="profile-menu__create"
          onClick={() => {
            startRename(onCreate());
          }}
        >
          <Plus size={14} />
          {t("profiles.new")}
        </button>
      </Popover>

      <ConfirmDialog
        open={deleteOpen}
        title={t("profiles.delete.title")}
        confirmLabel={t("common.delete")}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          if (deleteTarget) onDelete(deleteTarget.id);
          setDeleteOpen(false);
        }}
      >
        {t("profiles.delete.text", { name: deleteTarget?.name ?? "" })}
      </ConfirmDialog>
    </div>
  );
}
