import type { ComponentChildren } from "preact";
import { AUTO_COLOR, DEFAULT_TITLE_STYLE, FONTS, TITLE_COLORS } from "../data";
import { t } from "../i18n";
import type { TitlePosition, TitleStyle } from "../types";
import { AlignBottom, AlignMiddle, AlignTop, TextBold, TextItalic } from "./ui/icons";
import { ColorPicker } from "./ui/ColorPicker";
import { Segmented } from "./ui/Segmented";
import { Select } from "./ui/Select";
import { Slider } from "./ui/Slider";
import { Toggle } from "./ui/Toggle";

type Props = {
  value: TitleStyle;
  onChange: (patch: Partial<TitleStyle>) => void;
};

function positions(): { value: TitlePosition; label: ComponentChildren; title: string }[] {
  return [
    { value: "top", label: <AlignTop size={15} />, title: t("title.top") },
    { value: "middle", label: <AlignMiddle size={15} />, title: t("title.middle") },
    { value: "bottom", label: <AlignBottom size={15} />, title: t("title.bottom") },
  ];
}

export function TitleSettings({ value, onChange }: Props) {
  const custom = !TITLE_COLORS.includes(value.color);

  return (
    <div class="title-settings">
      <div class="field-row">
        <span class="field-row__label">{t("title.show")}</span>
        <Toggle checked={value.visible} onChange={(visible) => onChange({ visible })} label={t("title.showLabel")} />
      </div>

      <div class={value.visible ? "title-settings__body" : "title-settings__body title-settings__body--disabled"}>
        <div class="field-row">
          <span class="field-row__label">{t("title.position")}</span>
          <Segmented value={value.position} options={positions()} onChange={(position) => onChange({ position })} />
        </div>

        <div class="field-row">
          <span class="field-row__label">{t("title.size")}</span>
          <Slider
            value={value.size}
            min={8}
            max={20}
            label={t("title.fontSize")}
            format={(v) => `${v} px`}
            onChange={(size) => onChange({ size })}
          />
        </div>

        <div class="field-row">
          <span class="field-row__label">{t("title.font")}</span>
          <Select
            value={value.font}
            options={FONTS}
            label={t("title.font")}
            onChange={(font) => onChange({ font: String(font) })}
          />
        </div>

        <div class="field-row">
          <span class="field-row__label">{t("title.style")}</span>
          <div class="chip-group">
            <button
              type="button"
              aria-label={t("title.bold")}
              aria-pressed={value.bold}
              class={value.bold ? "chip chip--active" : "chip"}
              onClick={() => onChange({ bold: !value.bold })}
            >
              <TextBold size={15} />
            </button>
            <button
              type="button"
              aria-label={t("title.italic")}
              aria-pressed={value.italic}
              class={value.italic ? "chip chip--active" : "chip"}
              onClick={() => onChange({ italic: !value.italic })}
            >
              <TextItalic size={15} />
            </button>
          </div>
        </div>

        <div class="field-col">
          <span class="field-row__label">{t("title.color")}</span>
          <div class="swatches">
            {TITLE_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={color === AUTO_COLOR ? t("title.auto") : color}
                data-tip={color === AUTO_COLOR ? t("title.autoHint") : undefined}
                class={[
                  "swatch",
                  color === AUTO_COLOR && "swatch--auto",
                  value.color === color && "swatch--active",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={color === AUTO_COLOR ? undefined : `--swatch: ${color}`}
                onClick={() => onChange({ color })}
              />
            ))}
            <ColorPicker
              value={value.color === AUTO_COLOR ? "#ffffff" : value.color}
              custom={custom}
              onChange={(color) => onChange({ color })}
            />
          </div>
        </div>
      </div>

      <button type="button" class="link-button" onClick={() => onChange({ ...DEFAULT_TITLE_STYLE })}>
        {t("title.reset")}
      </button>
    </div>
  );
}
