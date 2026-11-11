import { t } from "../i18n";
import { useRef } from "preact/hooks";
import { actionLost, COLUMNS, KEY_COUNT, PAGE_SLOTS } from "../data";
import type { DropItem } from "../dnd";
import type { KeyConfig, Page, Plugin } from "../types";
import { DeckKey } from "./DeckKey";
import { DeckPlug } from "./DeckPlug";
import { KEY_SIZE, SIDE_WIDTH } from "../deck/layout";
import { drawWidget, type PageInfo } from "../widgets/draw";
import { keyEnv, keyWidget, keyWidgetId } from "../widgets/surface";
import { useLive } from "../plugins/visuals";

type Props = {
  page: Page;
  pageIndex: number;
  profileId: string;
  brightness: number;
  selectedKey: number;
  onSelectKey: (index: number) => void;
  onDropKey: (index: number, item: DropItem, copy: boolean) => void;
  onKeyContextMenu: (index: number, e: MouseEvent) => void;
  pressed: number;
  pageInfo: PageInfo;
  connected: boolean;
  plugins: Plugin[];
  present: (key: KeyConfig, index: number) => KeyConfig;
};

type Transition = { key: string; pageIndex: number; profileId: string; kind: "next" | "prev" | "swap" };

function isEmpty(key: KeyConfig) {
  return !key.action && !key.image && key.title.trim() === "";
}

function Slot({ index, ...props }: Props & { index: number }) {
  const { page, pageIndex, profileId, selectedKey, onSelectKey, onDropKey, onKeyContextMenu, pressed, pageInfo, plugins, present } = props;
  const config = useLive(() => present(page[index], index));
  const side = index >= KEY_COUNT;
  const down = !side && (pressed & (1 << index)) !== 0;
  return (
    <DeckKey
      config={config}
      side={side}
      lost={actionLost(plugins, config.action)}
      style={
        side
          ? `--col: ${COLUMNS}; --row: ${index - KEY_COUNT}`
          : `--col: ${index % COLUMNS}; --row: ${Math.floor(index / COLUMNS)}`
      }
      selected={index === selectedKey}
      pressed={down}
      widgetDraw={
        keyWidget(config)
          ? (ctx) => {
              const env = keyEnv(config, keyWidgetId(profileId, pageIndex, index), pageInfo, down);
              if (env) drawWidget(ctx, side ? SIDE_WIDTH : KEY_SIZE, KEY_SIZE, env);
            }
          : undefined
      }
      onSelect={() => onSelectKey(index)}
      dragIndex={isEmpty(config) ? undefined : index}
      onDropItem={(item, copy) => onDropKey(index, item, copy)}
      onContextMenu={(e) => onKeyContextMenu(index, e)}
    />
  );
}

export function Deck(props: Props) {
  const { pageIndex, profileId, brightness, connected } = props;
  const gridKey = `${profileId}:${pageIndex}`;
  const transition = useRef<Transition>({ key: gridKey, pageIndex, profileId, kind: "swap" });

  if (transition.current.key !== gridKey) {
    const prev = transition.current;
    const kind = prev.profileId !== profileId ? "swap" : pageIndex > prev.pageIndex ? "next" : "prev";
    transition.current = { key: gridKey, pageIndex, profileId, kind };
  }

  const slot = (index: number) => <Slot key={index} index={index} {...props} />;

  return (
    <div class="deck">
      <DeckPlug connected={connected} />
      <div
        key={gridKey}
        class={`deck__body deck__grid--${transition.current.kind}`}
        style={`--brightness: ${0.35 + brightness * 0.0065}`}
      >
        <div class="deck__grid">{Array.from({ length: KEY_COUNT }, (_, i) => slot(i))}</div>
        <div class="side-screen" role="group" aria-label={t("deck.side")}>
          {Array.from({ length: PAGE_SLOTS - KEY_COUNT }, (_, i) => slot(KEY_COUNT + i))}
        </div>
      </div>
    </div>
  );
}
