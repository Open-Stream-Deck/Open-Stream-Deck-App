import { t } from "../i18n";
import { useEffect, useRef, useState } from "preact/hooks";
import { ScrollArea } from "./ui/ScrollArea";
import { actionLost, findAction } from "../data";
import { useDismiss, usePresence } from "../hooks";
import type { KeyConfig, KeySettings, Plugin, TitleStyle } from "../types";
import { DeckKey } from "./DeckKey";
import { IconSettings, readImage } from "./IconSettings";
import { PluginInspector } from "./PluginInspector";
import { PropertyInspector } from "./PropertyInspector";
import { pluginHost } from "../plugins/host";
import { useLive } from "../plugins/visuals";
import { fieldValue, formSettings } from "../plugins/model";
import { TitleSettings } from "./TitleSettings";
import { Gear, TextStyle } from "./ui/icons";
import { Popover } from "./ui/Popover";

type Props = {
  keyId: string;
  plugins: Plugin[];
  iconRequest: number;
  styleRequest: number;
  config: KeyConfig;
  shown?: () => KeyConfig;
  context?: string | null;
  onTitleChange: (title: string) => void;
  onTitleStyleChange: (patch: Partial<TitleStyle>) => void;
  onImageChange: (image: string | null) => void;
  onSettingsChange: (patch: KeySettings) => void;
  widgetDraw?: (ctx: CanvasRenderingContext2D) => void;
  side?: boolean;
};

export function KeyEditor({
  keyId,
  plugins,
  iconRequest,
  styleRequest,
  config,
  shown,
  context,
  onTitleChange,
  onTitleStyleChange,
  onImageChange,
  onSettingsChange,
  widgetDraw,
  side,
}: Props) {
  const live = useLive(shown ?? (() => config));
  const found = findAction(plugins, config.action);
  const lost = actionLost(plugins, config.action);
  const actionKey = found ? `${found.plugin.id}:${found.action.id}` : "empty";
  const ext = found?.action.ext;
  const pluginDir = found?.plugin.ext?.dir;
  const [styleOpen, setStyleOpen] = useState(false);
  const [iconOpen, setIconOpen] = useState(false);
  const iconMounted = usePresence(!widgetDraw, 180);
  const [dropping, setDropping] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => panelRef.current?.querySelector(".scroll-area")?.scrollTo(0, 0), [keyId]);
  useDismiss(fieldRef, styleOpen, () => setStyleOpen(false));
  useDismiss(iconRef, iconOpen, () => setIconOpen(false));

  useEffect(() => {
    if (!iconRequest || widgetDraw) return;
    setStyleOpen(false);
    setIconOpen(true);
  }, [iconRequest]);

  useEffect(() => {
    if (!styleRequest) return;
    setIconOpen(false);
    setStyleOpen(true);
  }, [styleRequest]);

  return (
    <section class="editor">
      <div class="editor__top">
        <div
          class={dropping ? "editor__preview editor__preview--drop" : "editor__preview"}
          ref={iconRef}
          onDragOver={(e) => {
            if (widgetDraw || !e.dataTransfer?.types.includes("Files")) return;
            e.preventDefault();
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDropping(false);
            const file = e.dataTransfer?.files[0];
            if (file) readImage(file).then(onImageChange, () => setIconOpen(true));
          }}
        >
          <DeckKey key={keyId} config={live} widgetDraw={widgetDraw} side={side} lost={lost} preview />
          {iconMounted && (
            <>
              <button
                key={keyId}
                type="button"
                class={[
                  "editor__icon-btn",
                  iconOpen && "editor__icon-btn--active",
                  widgetDraw && "editor__icon-btn--leaving",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-label={t("key.iconSettings")}
                data-tip={t("key.iconSettings")}
                aria-expanded={iconOpen}
                onClick={() => setIconOpen((o) => !o)}
              >
                <Gear size={14} />
              </button>
              <Popover open={iconOpen && !widgetDraw} class="editor__icon-popover">
                <IconSettings image={config.image} onChange={onImageChange} />
              </Popover>
            </>
          )}
        </div>

        <div class="editor__body">
          <div class="editor__field" ref={fieldRef}>
            <label class="editor__label" for="key-title">
              {t("key.title")}
            </label>
            <div class="editor__input-wrap">
              <input
                id="key-title"
                class="editor__input"
                type="text"
                value={config.title}
                placeholder={ext && !config.title ? live.title : undefined}
                maxLength={24}
                onInput={(e) => onTitleChange(e.currentTarget.value)}
              />
              <button
                type="button"
                class={styleOpen ? "editor__style-btn editor__style-btn--active" : "editor__style-btn"}
                aria-label={t("menu.textSettings")}
                aria-expanded={styleOpen}
                data-tip={t("menu.textSettings")}
                onClick={() => setStyleOpen((o) => !o)}
              >
                <TextStyle size={15} />
              </button>
            </div>
            <Popover open={styleOpen} align="end" class="editor__popover">
              <TitleSettings value={config.titleStyle} onChange={onTitleStyleChange} />
            </Popover>
          </div>

          <div class="editor__panel" ref={panelRef}>
            {ext && pluginDir && ext.inspector && context ? (
              <PropertyInspector key={context} dir={pluginDir} page={ext.inspector} context={context} />
            ) : ext && found && context ? (
              <ScrollArea class="editor__inspector">
                <div key={actionKey} class="editor__content">
                  <PluginInspector
                    action={{ ...found.action, fields: ext.fields }}
                    settings={formSettings(ext, config.ext?.settings ?? {})}
                    onChange={(patch) => {
                      const settings = Object.fromEntries(Object.entries(patch).map(([id, value]) => [id, fieldValue(ext, id, value)]));
                      pluginHost.patchSettings(context, settings);
                    }}
                  />
                </div>
              </ScrollArea>
            ) : (
              <ScrollArea class="editor__inspector">
                {found ? (
                  <div key={actionKey} class="editor__content">
                    <PluginInspector action={found.action} settings={config.settings} onChange={onSettingsChange} />
                  </div>
                ) : (
                  <p key={lost ? "lost" : "empty"} class="editor__empty">
                    {t(lost ? "key.lostHint" : "key.pickAction")}
                  </p>
                )}
              </ScrollArea>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
