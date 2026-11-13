import { invoke } from "@tauri-apps/api/core";
import type { Permission } from "../types";

export type StorePlugin = {
  id: string;
  name: string;
  author: string;
  verified: boolean;
  version: string;
  installed: string | null;
  update: boolean;
  summary: string;
  description: string;
  features: string[];
  permissions: Permission[];
  components?: { name: string; version: string; platforms: string[] }[];
  changes: string[];
  downloads: number;
  color: string | null;
  icon: string | null;
};

export const storeList = () => invoke<StorePlugin[]>("store_list");

export const hasUpdate = (p: StorePlugin) => p.update;
