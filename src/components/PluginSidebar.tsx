import { t } from "../i18n";
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ActionRef, Plugin } from "../types";
import { ACTION_MIME } from "./DeckKey";
import { Marquee } from "./Marquee";
import { type MenuItem, openContextMenu } from "./ui/ContextMenu";
import { ArrowLeft, ArrowRight, FolderOpen, Import, Search, Trash } from "./ui/icons";
import { PluginIcon } from "./ui/pluginIcons";
import { ScrollArea } from "./ui/ScrollArea";

const HINT_DELAY = 550;
const LEAVE_DURATION = 220;

type Direction = "forward" | "back";

type View = {
  id: string | null;
  key: number;
  dir: Direction;
  query: string;
};

type HintKind = "version" | "description";

type Hint = {
  kind: HintKind;
  text: string;
  rect: DOMRect;
};

type Props = {
  plugins: Plugin[];
  active: ActionRef | null;
  onPick: (ref: ActionRef) => void;
  onOpenFolder: (pluginId: string) => void;
  onDeletePlugin: (pluginId: string) => void;
};

export function PluginSidebar({ plugins, active, onPick, onOpenFolder, onDeletePlugin }: Props) {
  const [view, setView] = useState<View>({ id: null, key: 0, dir: "forward", query: "" });
  const [leaving, setLeaving] = useState<View | null>(null);
  const [hint, setHint] = useState<Hint | null>(null);
  const [hintVisible, setHintVisible] = useState(false);
  const hintTimer = useRef<number>();
  const leaveTimer = useRef<number>();

  useEffect(
    () => () => {
      clearTimeout(hintTimer.current);
      clearTimeout(leaveTimer.current);
    },
    [],
  );

  function scheduleHint(kind: HintKind, text: string, el: HTMLElement) {
    clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => {
      setHint({ kind, text, rect: el.getBoundingClientRect() });
      setHintVisible(true);
    }, HINT_DELAY);
  }

  function hideHint() {
    clearTimeout(hintTimer.current);
    setHintVisible(false);
  }

  function open(id: string | null) {
    const dir: Direction = id ? "forward" : "back";
    hideHint();
    setLeaving({ ...view, dir });
    setView({ id, key: view.key + 1, dir, query: "" });
    clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setLeaving(null), LEAVE_DURATION);
  }

  function setQuery(query: string) {
    setView((v) => ({ ...v, query }));
  }

  function renderView(v: View, isLeaving: boolean) {
    const plugin = plugins.find((p) => p.id === v.id);
    const normalized = v.query.trim().toLowerCase();
    const matches = (name: string) => !normalized || name.toLowerCase().includes(normalized);
    const className = ["view", `view--${v.dir}`, isLeaving && "view--leaving"].filter(Boolean).join(" ");

    return (
      <div key={v.key} class={className} aria-hidden={isLeaving}>
        {plugin ? (
          <>
            <div class="sidebar__head">
              <button
                type="button"
                class="back"
                aria-label={t("sidebar.back")}
                tabIndex={isLeaving ? -1 : 0}
                onClick={() => open(null)}
              >
                <ArrowLeft size={18} />
              </button>
              <div class="sidebar__title">
                <Marquee text={plugin.name} />
              </div>
            </div>
            <List
              items={plugin.actions.filter((a) => matches(a.name))}
              isActive={(id) => active?.pluginId === plugin.id && active.actionId === id}
              hintOf={(item) => ["description", item.description] as const}
              iconOf={(id) => (
                <PluginIcon pluginId={plugin.id} actionId={id} src={plugin.actions.find((a) => a.id === id)?.ext?.icon} />
              )}
              onClick={(id) => onPick({ pluginId: plugin.id, actionId: id })}
              menuOf={(id) => [
                {
                  label: t("sidebar.assign"),
                  icon: Import,
                  onSelect: () => onPick({ pluginId: plugin.id, actionId: id }),
                },
              ]}
              dragData={(id) => JSON.stringify({ pluginId: plugin.id, actionId: id })}
              onHintEnter={scheduleHint}
              onHintLeave={hideHint}
            />
          </>
        ) : (
          <List
            items={plugins.filter((p) => matches(p.name))}
            isActive={(id) => active?.pluginId === id}
            hintOf={(item) => ["version", `v${item.version}`] as const}
            iconOf={(id) => <PluginIcon pluginId={id} src={plugins.find((p) => p.id === id)?.ext?.icon} />}
            onClick={open}
            menuOf={(id) => {
              const openItem: MenuItem = { label: t("common.open"), icon: ArrowRight, onSelect: () => open(id) };
              if (plugins.find((p) => p.id === id)?.builtin) return [openItem];
              return [
                openItem,
                { label: t("common.openFolder"), icon: FolderOpen, onSelect: () => onOpenFolder(id) },
                "separator",
                { label: t("common.delete"), icon: Trash, danger: true, onSelect: () => onDeletePlugin(id) },
              ];
            }}
            onHintEnter={scheduleHint}
            onHintLeave={hideHint}
          />
        )}
      </div>
    );
  }

  return (
    <aside class="sidebar">
      <label class="search">
        <Search class="search__icon" size={16} stroke-width="2.25" />
        <input
          class="search__input"
          type="search"
          placeholder={t("sidebar.search")}
          value={view.query}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}
        />
      </label>

      <div class="views">
        {leaving && renderView(leaving, true)}
        {renderView(view, false)}
      </div>

      {hint && <HintBubble hint={hint} visible={hintVisible} />}
    </aside>
  );
}

type Item = { id: string; name: string };

type ListProps<T extends Item> = {
  items: T[];
  isActive: (id: string) => boolean;
  hintOf: (item: T) => readonly [HintKind, string];
  iconOf: (id: string) => JSX.Element;
  onClick: (id: string) => void;
  onHintEnter: (kind: HintKind, text: string, el: HTMLElement) => void;
  onHintLeave: () => void;
  menuOf: (id: string) => MenuItem[];
  dragData?: (id: string) => string;
};

function List<T extends Item>({
  items,
  isActive,
  hintOf,
  iconOf,
  onClick,
  onHintEnter,
  onHintLeave,
  menuOf,
  dragData,
}: ListProps<T>) {
  return (
    <ScrollArea class="sidebar__list" onScroll={onHintLeave}>
      <ul class="list">
        {items.map((item, i) => (
          <li key={item.id} style={`--i: ${i}`}>
            <button
              type="button"
              draggable={!!dragData}
              class={isActive(item.id) ? "list-item list-item--active" : "list-item"}
              onClick={() => onClick(item.id)}
              onMouseEnter={(e) => onHintEnter(...hintOf(item), e.currentTarget)}
              onMouseLeave={onHintLeave}
              onMouseDown={onHintLeave}
              onContextMenu={(e) => {
                onHintLeave();
                openContextMenu(e, menuOf(item.id));
              }}
              onDragStart={(e) => {
                onHintLeave();
                if (!dragData || !e.dataTransfer) return;
                e.dataTransfer.setData(ACTION_MIME, dragData(item.id));
                e.dataTransfer.effectAllowed = "copy";
              }}
            >
              {iconOf(item.id)}
              <span class="list-item__name">{item.name}</span>
            </button>
          </li>
        ))}
        {items.length === 0 && <li class="list__empty">{t("sidebar.empty")}</li>}
      </ul>
    </ScrollArea>
  );
}

function HintBubble({ hint, visible }: { hint: Hint; visible: boolean }) {
  const { rect, kind, text } = hint;
  const className = ["hint", `hint--${kind}`, visible && "hint--visible"].filter(Boolean).join(" ");

  if (kind === "version") {
    const style = `top: ${rect.top + rect.height / 2}px; right: ${window.innerWidth - rect.right + 6}px`;
    return (
      <div class={className} style={style} role="tooltip">
        {text}
      </div>
    );
  }

  const below = rect.bottom + 90 < window.innerHeight;
  const vertical = below ? `top: ${rect.bottom + 6}px` : `bottom: ${window.innerHeight - rect.top + 6}px`;
  const style = `${vertical}; left: ${rect.left + 6}px; max-width: ${rect.width - 12}px`;
  return (
    <div class={`${className} ${below ? "hint--below" : "hint--above"}`} style={style} role="tooltip">
      {text}
    </div>
  );
}
