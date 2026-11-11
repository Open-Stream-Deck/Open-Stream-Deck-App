import { type ComponentChildren, render } from "preact";
import { PET_PLUGIN_ID, TIMER_PLUGIN_ID, WEATHER_PLUGIN_ID, WIDGET_PLUGIN_ID } from "../../widgets/catalog";
import cloudy from "../../widgets/weather/dark/bkn_d.svg?url";
import sunny from "../../widgets/weather/dark/skc_d.svg?url";
import rainy from "../../widgets/weather/dark/bkn_-ra_d.svg?url";
import windy from "../../widgets/weather/dark/strm.svg?url";
import { petPortrait } from "../../widgets/pets";

function Glyph({ children }: { children: ComponentChildren }) {
  return (
    <svg
      class="item-icon__glyph"
      viewBox="0 0 100 100"
      fill="none"
      stroke="currentColor"
      stroke-width="5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const WIDGETS_SECTION = (
  <Glyph>
    <rect x="18" y="18" width="27" height="27" rx="8" />
    <rect x="55" y="18" width="27" height="27" rx="8" />
    <rect x="18" y="55" width="27" height="27" rx="8" />
    <circle cx="68.5" cy="68.5" r="13.5" />
  </Glyph>
);

const PETS = ["fox", "cat", "dog", "bunny"];
const portrait = (kinds: string[]) => <img class="item-icon__glyph item-icon__pixel" src={petPortrait(kinds)} alt="" draggable={false} />;

const weatherGlyph = (src: string) => <img class="item-icon__glyph" src={src} alt="" draggable={false} />;

const WIDGET_GLYPHS: Record<string, ComponentChildren> = {
  clock: (
    <Glyph>
      <circle cx="50" cy="50" r="33.33" />
      <path d="M62.37 60.6L52.03 54.43C50.23 53.37 48.8 50.87 48.8 48.77V35.03" />
    </Glyph>
  ),
  date: (
    <Glyph>
      <path d="M20 70V36.67C20 29.33 26 23.33 33.33 23.33H66.67C74 23.33 80 29.33 80 36.67V70C80 77.33 74 83.33 66.67 83.33H33.33C26 83.33 20 77.33 20 70Z" />
      <path d="M61.67 30V16.67" />
      <path d="M38.33 30V16.67" />
      <path d="M39.33 56.67C43 56.67 46 53.67 46 50C46 46.33 43 43.33 39.33 43.33C35.67 43.33 32.67 46.33 32.67 50" />
      <path d="M32.67 63.33C32.67 67 35.67 70 39.33 70C43 70 46 67 46 63.33C46 59.67 43 56.67 39.33 56.67" />
      <path d="M67.33 70V43.33L56 54.67" />
    </Glyph>
  ),
  cpu: (
    <Glyph>
      <path d="M42 76.67H58C71.33 76.67 76.67 71.33 76.67 58V42C76.67 28.67 71.33 23.33 58 23.33H42C28.67 23.33 23.33 28.67 23.33 42V58C23.33 71.33 28.67 76.67 42 76.67Z" />
      <path d="M45 66.67H55C63.33 66.67 66.67 63.33 66.67 55V45C66.67 36.67 63.33 33.33 55 33.33H45C36.67 33.33 33.33 36.67 33.33 45V55C33.33 63.33 36.67 66.67 45 66.67Z" />
      <path d="M36.7 23.33V16.67M50 23.33V16.67M63.33 23.33V16.67" />
      <path d="M76.67 36.67H83.33M76.67 50H83.33M76.67 63.33H83.33" />
      <path d="M63.33 76.67V83.33M50 76.67V83.33M36.7 76.67V83.33" />
      <path d="M16.67 36.67H23.33M16.67 50H23.33M16.67 63.33H23.33" />
    </Glyph>
  ),
  ram: (
    <Glyph>
      <path d="M16.67 16.67V73.33C16.67 78.83 21.17 83.33 26.67 83.33H83.33" />
      <path d="M26.67 66.67L41.97 48.8C45.5 44.7 51.7 44.43 55.5 48.23L58.67 51.4C62.47 55.2 68.67 54.93 72.2 50.83L83.33 37.83" />
    </Glyph>
  ),
  disk: (
    <Glyph>
      <circle cx="50" cy="50" r="33.33" />
      <circle cx="50" cy="50" r="6.67" />
    </Glyph>
  ),
  gpu: (
    <Glyph>
      <path d="M41.9 51.53l-10.17 10.17M31.83 51.63l10.17 10.17" />
      <path d="M55.1 56.67h0.03M68.23 56.67h0.03M61.67 63.27v-0.07M61.67 50.13v-0.07" />
      <path d="M40 83.33h20c16.67 0 23.33-6.67 23.33-23.33v-6.67c0-16.67-6.67-23.33-23.33-23.33H40c-16.67 0-23.33 6.67-23.33 23.33v6.67c0 16.67 6.67 23.33 23.33 23.33ZM53.37 16.67 53.33 20.03A3.33 3.33 0 0 1 50 23.33h-0.1c-1.83 0-3.3 1.5-3.3 3.33s1.5 3.33 3.33 3.33h3.33" />
    </Glyph>
  ),
  page: (
    <Glyph>
      <path d="M53.37 19.73l19.67 8.73c5.67 2.5 5.67 6.63 0 9.13l-19.67 8.73c-2.23 1-5.9 1-8.13 0l-19.67-8.73c-5.67-2.5-5.67-6.63 0-9.13l19.67-8.73c2.23-1 5.9-1 8.13 0z" />
      <path d="M20 46.67c0 2.8 2.1 6.03 4.67 7.17l22.63 10.07c1.73 0.77 3.7 0.77 5.4 0l22.63-10.07c2.57-1.13 4.67-4.37 4.67-7.17" />
      <path d="M20 63.33c0 3.1 1.83 5.9 4.67 7.17l22.63 10.07c1.73 0.77 3.7 0.77 5.4 0l22.63-10.07c2.83-1.27 4.67-4.07 4.67-7.17" />
    </Glyph>
  ),
  network: (
    <Glyph>
      <path d="M43.57 19.4L20.47 37.9C17.87 39.97 16.2 44.33 16.77 47.6L21.2 74.13C22 78.87 26.53 82.7 31.33 82.7H68.67C73.43 82.7 78 78.83 78.8 74.13L83.23 47.6C83.77 44.33 82.1 39.97 79.53 37.9L56.43 19.43C52.87 16.57 47.1 16.57 43.57 19.4Z" />
      <path d="M42.93 57.93C47.17 53.9 52.83 53.9 57.07 57.93" />
      <path d="M64.13 50.86C62.33 49.1 60.33 47.73 58.27 46.73C52.97 44.2 47.03 44.2 41.7 46.73C39.63 47.73 37.67 49.1 35.83 50.86" />
      <path d="M49.99 66.67H50.02" />
    </Glyph>
  ),
};

const GLYPHS: Record<string, { plugin: ComponentChildren; actions: Record<string, ComponentChildren> }> = {
  [WIDGET_PLUGIN_ID]: { plugin: WIDGETS_SECTION, actions: WIDGET_GLYPHS },
  [TIMER_PLUGIN_ID]: {
    plugin: (
      <Glyph>
        <path d="M79.17 54.17c0 16.1-13.07 29.17-29.17 29.17s-29.17-13.07-29.17-29.17S33.9 25 50 25s29.17 13.07 29.17 29.17ZM50 36.67v16.67" />
        <path d="M40 16.67h20" />
      </Glyph>
    ),
    actions: {
      timer: (
        <Glyph>
          <path d="M50 36.67v16.67M50 83.33c-16.1 0-29.17-13.07-29.17-29.17S33.9 25 50 25s29.17 13.07 29.17 29.17" />
          <path d="M40 16.67h20M59.67 71.67v-3.87c0-4.77 3.4-6.73 7.53-4.33l3.33 1.93 3.33 1.93c4.13 2.4 4.13 6.3 0 8.7l-3.33 1.93-3.33 1.93c-4.13 2.4-7.53 0.43-7.53-4.33V71.67Z" />
        </Glyph>
      ),
      countdown: (
        <Glyph>
          <path d="M36.67 16.67v10M63.33 16.67v10M21.67 40.3h56.67M83.33 73.33c0 2.5-0.7 4.87-1.93 6.87A13.23 13.23 0 0 1 70 86.67c-3.37 0-6.43-1.23-8.77-3.33-1.03-0.87-1.93-1.93-2.63-3.13A13.07 13.07 0 0 1 56.67 73.33c0-7.37 5.97-13.33 13.33-13.33 4 0 7.57 1.77 10 4.53A13.33 13.33 0 0 1 83.33 73.33Z" />
          <path d="M64.8 73.33l3.3 3.3 7.1-6.57" />
          <path d="M80 38.33v26.2c-2.43-2.77-6-4.53-10-4.53-7.37 0-13.33 5.97-13.33 13.33 0 2.5 0.7 4.87 1.93 6.87 0.7 1.2 1.6 2.27 2.63 3.13H36.67c-11.67 0-16.67-6.67-16.67-16.67V38.33c0-10 5-16.67 16.67-16.67h26.67c11.67 0 16.67 6.67 16.67 16.67Z" />
          <path d="M49.98 55.67h0.03M37.65 55.67h0.03M37.65 65.67h0.03" />
        </Glyph>
      ),
    },
  },
  [WEATHER_PLUGIN_ID]: {
    plugin: weatherGlyph(cloudy),
    actions: { weather: weatherGlyph(sunny), forecast: weatherGlyph(rainy), meteo: weatherGlyph(windy) },
  },
  [PET_PLUGIN_ID]: {
    plugin: portrait(PETS),
    actions: Object.fromEntries(PETS.map((kind) => [kind, portrait([kind])])),
  },
  system: {
    plugin: (
      <Glyph>
        <path d="M31.47 16.67h37.03C80.37 16.67 83.33 19.63 83.33 31.47v21.1c0 11.87-2.97 14.8-14.8 14.8H31.47C19.63 67.4 16.67 64.43 16.67 52.6V31.47C16.67 19.63 19.63 16.67 31.47 16.67ZM50 67.4V83.33M16.67 53.33h66.67M35 83.33h30" />
      </Glyph>
    ),
    actions: {
      "open-app": (
        <Glyph>
          <path d="M53.33 46.67l27.33-27.33M83.33 32.67V16.67h-16M46.67 16.67H40C23.33 16.67 16.67 23.33 16.67 40v20c0 16.67 6.67 23.33 23.33 23.33h20c16.67 0 23.33-6.67 23.33-23.33v-6.67" />
        </Glyph>
      ),
      "open-url": (
        <Glyph>
          <path d="M50 83.33c18.41 0 33.33-14.92 33.33-33.33S68.41 16.67 50 16.67 16.67 31.59 16.67 50s14.92 33.33 33.33 33.33Z" />
          <path d="M36.67 20h3.33a94.75 94.75 0 0 0 0 60H36.67M60 20a94.75 94.75 0 0 1 0 60" />
          <path d="M20 63.33v-3.33a94.75 94.75 0 0 0 60 0v3.33M20 40a94.75 94.75 0 0 1 60 0" />
        </Glyph>
      ),
      hotkey: (
        <Glyph>
          <path d="M35 23.33h30c2.07 0 3.9 0.07 5.53 0.3 8.77 0.97 11.13 5.1 11.13 16.37v20c0 11.27-2.37 15.4-11.13 16.37-1.63 0.23-3.47 0.3-5.53 0.3h-30c-2.07 0-3.9-0.07-5.53-0.3C20.7 75.4 18.33 71.27 18.33 60V40c0-11.27 2.37-15.4 11.13-16.37C31.1 23.4 32.93 23.33 35 23.33ZM55 43.33H66.67M33.33 61.67h33.33" />
          <path d="M43.65 43.33h0.03M33.65 43.33h0.03" />
        </Glyph>
      ),
      text: (
        <Glyph>
          <path d="M18.9 33.9V27.83c0-3.83 3.1-6.9 6.9-6.9h48.4c3.83 0 6.9 3.1 6.9 6.9v6.07M50 79.07V23.7M36.87 79.07h26.27" />
        </Glyph>
      ),
      lock: (
        <Glyph>
          <path d="M30 43.33V36.67c0-11.03 3.33-20 20-20s20 8.97 20 20v6.67M66.67 83.33H33.33c-13.33 0-16.67-3.33-16.67-16.67v-6.67c0-13.33 3.33-16.67 16.67-16.67h33.33c13.33 0 16.67 3.33 16.67 16.67v6.67c0 13.33-3.33 16.67-16.67 16.67Z" />
          <path d="M63.32 63.33h0.03M49.98 63.33h0.03M36.65 63.33h0.03" />
        </Glyph>
      ),
    },
  },
  media: {
    plugin: (
      <Glyph>
        <path d="M30.93 83.33a10.4 10.4 0 1 0 0-20.8 10.4 10.4 0 0 0 0 20.8Z" />
        <path d="M79.47 66V25.33c0-8.67-5.43-9.87-10.93-8.37l-20.8 5.67C43.93 23.67 41.33 26.67 41.33 31v41.9" />
        <path d="M69.07 76.4a10.4 10.4 0 1 0 0-20.8 10.4 10.4 0 0 0 0 20.8ZM41.33 41.73 79.47 31.33" />
      </Glyph>
    ),
    actions: {
      "play-pause": (
        <Glyph>
          <path d="M23.33 50V38.13c0-14.73 10.43-20.77 23.2-13.4l10.3 5.93 10.3 5.93c12.77 7.37 12.77 19.43 0 26.8l-10.3 5.93-10.3 5.93C33.77 82.63 23.33 76.6 23.33 61.87V50Z" />
        </Glyph>
      ),
      "play-pause:1": (
        <Glyph>
          <path d="M45.5 73.7V26.3c0-4.5-1.9-6.3-6.7-6.3H26.7C21.9 20 20 21.8 20 26.3v47.4C20 78.2 21.9 80 26.7 80h12.1c4.8 0 6.7-1.8 6.7-6.3ZM80 73.7V26.3C80 21.8 78.1 20 73.3 20h-12.1c-4.77 0-6.7 1.8-6.7 6.3v47.4c0 4.5 1.9 6.3 6.7 6.3h12.1c4.8 0 6.7-1.8 6.7-6.3Z" />
        </Glyph>
      ),
      next: (
        <Glyph>
          <path d="M22.53 34.07v31.9c0 6.53 7.1 10.63 12.77 7.37l13.83-7.97 13.83-8c5.67-3.27 5.67-11.43 0-14.7l-13.83-8-13.83-7.97c-5.67-3.27-12.77 0.8-12.77 7.37ZM77.47 70.6V29.4" />
        </Glyph>
      ),
      prev: (
        <Glyph>
          <path d="M77.47 34.07v31.9c0 6.53-7.1 10.63-12.77 7.37l-13.83-7.97-13.83-8c-5.67-3.27-5.67-11.43 0-14.7l13.83-8 13.83-7.97c5.67-3.27 12.77 0.8 12.77 7.37ZM22.53 70.6V29.4" />
        </Glyph>
      ),
      "volume-up": (
        <Glyph>
          <path d="M16.67 43.2v13.6c0 6.8 3.4 10.2 10.2 10.2h4.87c1.27 0 2.53 0.37 3.6 1.03l9.93 6.2c8.6 5.37 15.6 1.47 15.6-8.67V34.4c0-10.13-7.03-14.03-15.6-8.67L35.33 31.97c-1.1 0.67-2.33 1.03-3.6 1.03H26.87C20.07 33 16.67 36.4 16.67 43.2Z" />
          <path d="M70 50h13.33M76.67 56.67v-13.33" />
        </Glyph>
      ),
      "volume-down": (
        <Glyph>
          <path d="M16.67 43.2v13.6c0 6.8 3.4 10.2 10.2 10.2h4.87c1.27 0 2.53 0.37 3.6 1.03l9.93 6.2c8.6 5.37 15.6 1.47 15.6-8.67V34.4c0-10.13-7.03-14.03-15.6-8.67L35.33 31.97c-1.1 0.67-2.33 1.03-3.6 1.03H26.87C20.07 33 16.67 36.4 16.67 43.2Z" />
          <path d="M70 50h13.33" />
        </Glyph>
      ),
      mute: (
        <Glyph>
          <path d="M16.67 43.33v13.33c0 6.67 3.33 10 10 10h4.77c1.23 0 2.47 0.37 3.53 1l9.73 6.1c8.4 5.27 15.3 1.43 15.3-8.47V34.7c0-9.93-6.9-13.73-15.3-8.47L34.97 32.33c-1.07 0.63-2.3 1-3.53 1H26.67c-6.67 0-10 3.33-10 10Z" />
          <path d="M70 36.67a22.2 22.2 0 0 1 0 26.67M76.1 28.33a36.1 36.1 0 0 1 0 43.33" />
        </Glyph>
      ),
      "mute:1": (
        <Glyph>
          <path d="M60 37.9v-3.2c0-9.93-6.9-13.73-15.3-8.47L34.97 32.33c-1.07 0.63-2.3 1-3.53 1H26.67c-6.67 0-10 3.33-10 10v13.33c0 6.67 3.33 10 10 10h6.67M44.7 73.77c8.4 5.27 15.3 1.43 15.3-8.47v-12.13M72.7 41.4c3 7.17 2.1 15.53-2.7 21.93M80.5 36a36.07 36.07 0 0 1-4.4 35.67M83.33 16.67 16.67 83.33" />
        </Glyph>
      ),
    },
  },
  navigation: {
    plugin: (
      <Glyph>
        <path d="M28.23 40a11.67 11.67 0 1 0 0-23.33 11.67 11.67 0 0 0 0 23.33ZM66.57 60h10c3.67 0 6.67 3 6.67 6.67v10c0 3.67-3 6.67-6.67 6.67h-10c-3.67 0-6.67-3-6.67-6.67v-10c0-3.67 3-6.67 6.67-6.67Z" />
        <path d="M50 26.67h8.93c6.17 0 9.03 7.63 4.4 11.7L36.7 61.67C32.07 65.7 34.93 73.33 41.07 73.33H50" />
        <path d="M28.29 28.33h0.04M71.62 71.67h0.04" />
      </Glyph>
    ),
    actions: {
      "next-page": (
        <Glyph>
          <path d="M58.1 29.77L78.33 50l-20.23 20.23M21.67 50h56.1" />
        </Glyph>
      ),
      "prev-page": (
        <Glyph>
          <path d="M41.9 29.77L21.67 50l20.23 20.23M78.33 50H22.23" />
        </Glyph>
      ),
      profile: (
        <Glyph>
          <path d="M50.4 52.6a3.21 3.21 0 0 0-0.8 0 10.9 10.9 0 0 1-10.53-10.9c0-6.03 4.87-10.93 10.93-10.93a10.92 10.92 0 0 1 0.4 21.83ZM72.47 74.6A33.11 33.11 0 0 1 50 83.33c-8.67 0-16.53-3.3-22.47-8.73 0.33-3.13 2.33-6.2 5.9-8.6 9.13-6.07 24.07-6.07 33.13 0 3.57 2.4 5.57 5.47 5.9 8.6Z" />
          <path d="M50 83.33c18.41 0 33.33-14.92 33.33-33.33S68.41 16.67 50 16.67 16.67 31.59 16.67 50s14.92 33.33 33.33 33.33Z" />
        </Glyph>
      ),
    },
  },
};

function glyphOf(pluginId: string, actionId?: string): ComponentChildren {
  const glyphs = GLYPHS[pluginId];
  if (!glyphs) return null;
  return actionId ? glyphs.actions[actionId] ?? null : glyphs.plugin;
}

export function actionGlyph(pluginId: string, actionId: string, state = 0): ComponentChildren {
  const actions = GLYPHS[pluginId]?.actions;
  return actions?.[`${actionId}:${state}`] ?? actions?.[actionId] ?? null;
}

const glyphUrls = new Map<string, string | null>();

export function actionGlyphUrl(pluginId: string, actionId: string, state = 0) {
  const id = `${pluginId}:${actionId}:${state}`;
  if (glyphUrls.has(id)) return glyphUrls.get(id)!;
  const glyph = actionGlyph(pluginId, actionId, state);
  let url: string | null = null;
  if (glyph) {
    const host = document.createElement("div");
    render(glyph, host);
    const svg = host.innerHTML
      .replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"')
      .replace('stroke="currentColor"', 'stroke="#fff"');
    url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
  glyphUrls.set(id, url);
  return url;
}

export function PluginIcon({ pluginId, actionId, src }: { pluginId: string; actionId?: string; src?: string }) {
  if (src) {
    return (
      <span class="item-icon item-icon--image">
        <img src={src} alt="" draggable={false} />
      </span>
    );
  }
  const glyph = glyphOf(pluginId, actionId);
  return <span class={glyph ? "item-icon item-icon--glyph" : "item-icon"}>{glyph}</span>;
}
