import type { ComponentType } from "preact";
import type { Permission } from "../../types";
import { Copy, Global, Keyboard, Launch, Layers, Monitor, Shield } from "../ui/icons";

const ICONS: Record<string, ComponentType<{ size?: number }>> = {
  loopback: Monitor,
  network: Global,
  launch: Launch,
  clipboard: Copy,
  keyboard: Keyboard,
  navigation: Layers,
};

export function PermissionList({ items }: { items: Permission[] }) {
  return (
    <ul class="permissions">
      {items.map((p, i) => {
        const Icon = ICONS[p.kind] ?? Shield;
        return (
          <li key={`${p.kind}:${p.detail}`} class="permissions__item" style={`--i: ${i}`}>
            <span class="permissions__icon">
              <Icon size={16} />
            </span>
            <span class="permissions__text">
              <span class="permissions__title">{p.title}</span>
              <span class="permissions__detail">{p.detail}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
