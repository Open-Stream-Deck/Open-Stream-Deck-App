import type { ComponentChildren } from "preact";

type Props = {
  title: string;
  description?: string;
  children: ComponentChildren;
};

export function SettingRow({ title, description, children }: Props) {
  return (
    <div class="setting-row">
      <div class="setting-row__text">
        <span class="setting-row__title">{title}</span>
        {description && <span class="setting-row__description">{description}</span>}
      </div>
      <div class="setting-row__control">{children}</div>
    </div>
  );
}

export function SettingGroup({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="setting-group">
      <h3 class="setting-group__title">{title}</h3>
      <div class="setting-group__body">{children}</div>
    </section>
  );
}
