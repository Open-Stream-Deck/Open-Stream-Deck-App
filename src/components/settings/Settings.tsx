import type { DeckMode } from "../../deck/link";
import type { ComponentType } from "preact";
import { useState } from "preact/hooks";
import type { AppSettings, AppState, DeviceSettings, Plugin } from "../../types";
import { Box, Chip, Close, Device, Info, Sliders } from "../ui/icons";
import { type Key, t } from "../../i18n";
import { Modal } from "../ui/Modal";
import { AboutSection } from "./AboutSection";
import { AppSection } from "./AppSection";
import { DeviceSection } from "./DeviceSection";
import { FirmwareSection } from "./FirmwareSection";
import { PluginsSection } from "./PluginsSection";

type SectionId = "device" | "firmware" | "plugins" | "app" | "about";

const SECTIONS: { id: SectionId; label: Key; icon: ComponentType<{ size?: number }> }[] = [
  { id: "device", label: "settings.device", icon: Device },
  { id: "firmware", label: "settings.firmware", icon: Chip },
  { id: "plugins", label: "settings.plugins", icon: Box },
  { id: "app", label: "settings.app", icon: Sliders },
  { id: "about", label: "settings.about", icon: Info },
];

type Props = {
  open: boolean;
  onClose: () => void;
  device: DeviceSettings;
  app: AppSettings;
  firmware: string;
  connected: boolean;
  deviceName: string;
  serial: string;
  mode: DeckMode;
  onDeviceChange: (patch: Partial<DeviceSettings>) => void;
  onAppChange: (patch: Partial<AppSettings>) => void;
  onResetProfiles: () => void;
  onResetAll: () => void;
  getState: () => AppState;
  installedPlugins: Plugin[];
  availablePlugins: Plugin[];
  onInstallPlugin: (id: string) => void;
  onDeletePlugin: (id: string) => void;
  onOpenPluginFolder: (id?: string) => void;
};

export function Settings(props: Props) {
  const { open, onClose } = props;
  const [section, setSection] = useState<SectionId>("device");
  const current = SECTIONS.find((s) => s.id === section)!;
  const index = SECTIONS.indexOf(current);

  return (
    <Modal open={open} onClose={onClose} label={t("common.settings")} class="settings">
      <nav class="settings__nav" style={`--index: ${index}`}>
        <div class="settings__title">{t("common.settings")}</div>
        <div class="settings__nav-list">
          <span class="settings__nav-thumb" />
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              class={id === section ? "settings__nav-item settings__nav-item--active" : "settings__nav-item"}
              aria-current={id === section ? "page" : undefined}
              onClick={() => setSection(id)}
            >
              <Icon size={16} />
              {t(label)}
            </button>
          ))}
        </div>
      </nav>

      <div class="settings__main">
        <header class="settings__header">
          <h2 key={section} class="settings__heading">
            {t(current.label)}
          </h2>
          <button type="button" class="icon-button settings__close" aria-label={t("common.close")} onClick={onClose}>
            <Close size={16} />
          </button>
        </header>
        <div key={section} class="settings__content">
          {section === "device" && (
            <DeviceSection
              device={props.device}
              firmware={props.firmware}
              connected={props.connected}
              name={props.deviceName}
              serial={props.serial}
              mode={props.mode}
              onChange={props.onDeviceChange}
              onResetProfiles={props.onResetProfiles}
            />
          )}
          {section === "firmware" && (
            <FirmwareSection mode={props.mode} firmware={props.firmware} />
          )}
          {section === "plugins" && (
            <PluginsSection
              installed={props.installedPlugins}
              available={props.availablePlugins}
              onInstall={props.onInstallPlugin}
              onDelete={props.onDeletePlugin}
              onOpenFolder={props.onOpenPluginFolder}
            />
          )}
          {section === "app" && (
            <AppSection app={props.app} onChange={props.onAppChange} onResetAll={props.onResetAll} getState={props.getState} />
          )}
          {section === "about" && <AboutSection />}
        </div>
      </div>
    </Modal>
  );
}
