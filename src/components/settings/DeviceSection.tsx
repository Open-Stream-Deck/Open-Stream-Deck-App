import type { DeckMode } from "../../deck/link";
import { useState } from "preact/hooks";
import type { DeviceSettings } from "../../types";
import { type Key, t } from "../../i18n";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Device, Refresh } from "../ui/icons";
import { Select } from "../ui/Select";
import { Slider } from "../ui/Slider";
import { SettingGroup, SettingRow } from "./SettingRow";

const STATUS_LABEL: Record<DeckMode, Key> = {
  osd: "device.status.osd",
  stock: "device.status.stock",
  loader: "device.status.loader",
  none: "common.notConnected",
};

function deviceMeta(mode: DeckMode, serial: string, firmware: string) {
  const sn = serial ? `S/N ${serial} · ` : "";
  switch (mode) {
    case "osd":
      return sn + t("device.meta.osd", { version: firmware });
    case "stock":
      return sn + t("device.meta.stock");
    case "loader":
      return t("device.meta.loader");
    default:
      return t("common.connectUsb");
  }
}

function sleepOptions() {
  return [0, 1, 5, 15, 30, 60].map((value) => ({
    value,
    label:
      value === 0
        ? t("device.sleep.never")
        : value === 60
          ? t("device.sleep.hour")
          : t("device.sleep.minutes", { n: value }),
  }));
}

type Props = {
  device: DeviceSettings;
  firmware: string;
  connected: boolean;
  name: string;
  serial: string;
  mode: DeckMode;
  onChange: (patch: Partial<DeviceSettings>) => void;
  onResetProfiles: () => void;
};

export function DeviceSection({ device, firmware, connected, name, serial, mode, onChange, onResetProfiles }: Props) {
  const [resetOpen, setResetOpen] = useState(false);

  return (
    <>
      <div class="device-card">
        <div class="device-card__icon">
          <Device size={22} />
        </div>
        <div class="device-card__text">
          <span class="device-card__name">{name || t("common.notConnected")}</span>
          <span class="device-card__meta">{deviceMeta(mode, serial, firmware)}</span>
        </div>
        <span class={connected ? "status" : "status status--busy"}>
          <span class="status__dot" />
          {t(STATUS_LABEL[mode])}
        </span>
      </div>

      <SettingGroup title={t("device.screen")}>
        <SettingRow title={t("device.brightness")} description={t("device.brightness.desc")}>
          <Slider
            value={device.brightness}
            min={0}
            max={100}
            label={t("device.brightness")}
            format={(v) => `${v}%`}
            onChange={(brightness) => onChange({ brightness })}
          />
        </SettingRow>
        <SettingRow title={t("device.sleep")} description={t("device.sleep.desc")}>
          <Select
            value={device.sleepAfter}
            options={sleepOptions()}
            label={t("device.sleep")}
            onChange={(v) => onChange({ sleepAfter: Number(v) })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t("device.look")}>
        <SettingRow title={t("device.keyRadius")} description={t("device.keyRadius.desc")}>
          <Slider
            value={device.keyRadius}
            min={0}
            max={40}
            label={t("device.keyRadius")}
            format={(v) => (v ? `${v} px` : t("common.none"))}
            onChange={(keyRadius) => onChange({ keyRadius })}
          />
        </SettingRow>
        <SettingRow title={t("device.sideRadius")} description={t("device.sideRadius.desc")}>
          <Slider
            value={device.sideRadius}
            min={0}
            max={40}
            label={t("device.sideRadius")}
            format={(v) => (v ? `${v} px` : t("common.none"))}
            onChange={(sideRadius) => onChange({ sideRadius })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t("device.maintenance")}>
        <SettingRow title={t("device.resetProfiles")} description={t("device.resetProfiles.desc")}>
          <button type="button" class="button button--danger" onClick={() => setResetOpen(true)}>
            {t("common.reset")}
          </button>
        </SettingRow>
      </SettingGroup>

      <ConfirmDialog
        open={resetOpen}
        title={t("device.resetProfiles.title")}
        confirmLabel={t("common.reset")}
        icon={Refresh}
        onClose={() => setResetOpen(false)}
        onConfirm={() => {
          onResetProfiles();
          setResetOpen(false);
        }}
      >
        {t("device.resetProfiles.text")}
      </ConfirmDialog>
    </>
  );
}
