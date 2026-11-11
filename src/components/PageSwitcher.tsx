import { t } from "../i18n";
import { Plus } from "./ui/icons";

type Props = {
  count: number;
  active: number;
  canAdd: boolean;
  onChange: (page: number) => void;
  onAdd: () => void;
  onContextMenu: (page: number, e: MouseEvent) => void;
};

export function PageSwitcher({ count, active, canAdd, onChange, onAdd, onContextMenu }: Props) {
  return (
    <div class="pages" role="tablist" aria-label={t("pages.label")} style={`--index: ${active}`}>
      <span class="pages__thumb" />
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          role="tab"
          aria-selected={i === active}
          class={i === active ? "pages__item pages__item--active" : "pages__item"}
          onClick={() => onChange(i)}
          onContextMenu={(e) => onContextMenu(i, e)}
        >
          {i + 1}
        </button>
      ))}
      <button
        type="button"
        class="pages__add"
        aria-label={t("pages.add")}
        data-tip={canAdd ? t("pages.add") : t("pages.limit")}
        disabled={!canAdd}
        onClick={onAdd}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
