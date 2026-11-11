import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExternalAction, KeyConfig } from "../src/types.ts";
import { present, setImage } from "../src/plugins/visuals.ts";

globalThis.window = globalThis as unknown as Window & typeof globalThis;

const key: KeyConfig = {
  action: { pluginId: "example", actionId: "example.dynamic" },
  image: null,
  title: "",
  titleStyle: { visible: true, position: "bottom", size: 14, color: "#ffffff", font: "", bold: false, italic: false },
  settings: {},
  ext: { settings: {}, state: 0 },
};

const action: ExternalAction = {
  uuid: "example.dynamic",
  icon: "sidebar-icon.svg",
  states: [{}],
  controllers: ["key"],
  fields: [],
  defaults: {},
};

test("a newly assigned action stays blank until its first frame", () => {
  assert.equal(present(key, action, "new-action").image, null);
  setImage("new-action", "first-frame.png");
  assert.equal(present(key, action, "new-action").image, "first-frame.png");
  assert.equal(present(key, action, "other-key").image, null);
});

test("clearing a plugin frame restores its state image or a blank key", () => {
  const stateAction = { ...action, states: [{ image: "state.png" }] };
  setImage("cleared", "frame.png");
  assert.equal(present(key, stateAction, "cleared").image, "frame.png");
  setImage("cleared", null);
  assert.equal(present(key, stateAction, "cleared").image, "state.png");
  assert.equal(present(key, action, "cleared").image, null);
});

test("a user image takes precedence over the selected state image", () => {
  const stateAction = { ...action, states: [{ image: "off.png" }, { image: "on.png" }] };
  const activeKey = { ...key, ext: { settings: {}, state: 1 } };
  assert.equal(present(activeKey, stateAction, "state").image, "on.png");
  assert.equal(present({ ...activeKey, image: "user.png" }, stateAction, "state").image, "user.png");
});
