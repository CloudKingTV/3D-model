import {
  el, group, segmented, tiles, swatches, slider, toggle, action, ICONS, PALETTE,
} from './controls.js';
import { DECK_SKINS, BACKGROUNDS, preloadImage } from '../lib/textures.js';
import { PRESETS } from '../lib/state.js';
import { TRUCK_FINISH_LIST } from '../lib/fingerboard.js';

const GRIP_PATTERNS = [
  { id: 'classic', name: 'Classic' },
  { id: 'perforated', name: 'Perf' },
  { id: 'logo-cut', name: 'Cut-out' },
  { id: 'clear', name: 'Clear' },
];

const WHEEL_STYLES = [
  { id: 'solid', name: 'Solid' },
  { id: 'duo', name: 'Duo' },
  { id: 'stripe', name: 'Stripe' },
  { id: 'spoke', name: 'Spoke' },
  { id: 'clear', name: 'Clear' },
];

const WOOD_PALETTE = ['#e6d6b8', '#c89a63', '#9c6b3c', '#6d4523', '#3b2a1c', '#d8c9b0'];

/**
 * Builds the tab bar and every tab's content. Each control registers a `sync`
 * callback so a preset or a share link can refresh the whole panel at once.
 */
export function createPanel({ store, viewer, toast }) {
  const tabsHost = document.getElementById('tabs');
  const bodyHost = document.getElementById('panel-body');
  const syncers = [];

  const cfg = () => store.config;
  const set = (patch) => store.patch(patch);

  /** Register a control that knows how to refresh itself. */
  const track = (node) => {
    if (node?.__sync) syncers.push(node.__sync);
    return node;
  };

  /* ------------------------------------------------------------- tab: looks */

  function looksTab() {
    const presetTiles = track(tiles(
      PRESETS.map((preset) => ({ id: preset.id, name: preset.name, colors: preset.swatch })),
      () => matchedPreset(),
      (id) => {
        const preset = PRESETS.find((entry) => entry.id === id);
        if (preset) {
          set(preset.config);
          toast(`${preset.name} loaded`);
        }
      },
    ));

    const randomise = action('Surprise me', ICONS.spin, () => {
      const pick = (list) => list[Math.floor(Math.random() * list.length)];
      const skins = DECK_SKINS.filter((skin) => skin.id !== 'custom');
      set({
        deck: {
          skin: pick(skins).id,
          base: pick(PALETTE),
          ink: pick(PALETTE),
          accent: pick(PALETTE),
        },
        grip: { color: pick(['#15151a', '#101018', '#2b2b2e', '#1d1d1d']) },
        trucks: { finish: pick(TRUCK_FINISH_LIST).id, color: pick(TRUCK_FINISH_LIST).color, bushings: pick(PALETTE) },
        wheels: { color: pick(PALETTE), style: pick(WHEEL_STYLES).id, accent: pick(PALETTE) },
      });
      toast('Rolled a new board');
    }, 'action--primary');

    return el('div', {}, [
      group('Presets', presetTiles),
      group('Shuffle', el('div', { class: 'stack' }, [
        randomise,
        el('p', { class: 'note', text: 'Every colour below is independent — presets are just starting points.' }),
      ])),
    ]);
  }

  /** The preset whose settings the current config still matches, if any. */
  function matchedPreset() {
    const current = cfg();
    for (const preset of PRESETS) {
      let same = true;
      for (const [section, values] of Object.entries(preset.config)) {
        for (const [key, value] of Object.entries(values)) {
          if (current[section]?.[key] !== value) {
            same = false;
            break;
          }
        }
        if (!same) break;
      }
      if (same) return preset.id;
    }
    return null;
  }

  /* -------------------------------------------------------------- tab: deck */

  function deckTab() {
    const fileInput = el('input', {
      type: 'file',
      accept: 'image/*',
      style: 'display:none',
      onchange: async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            await preloadImage(reader.result);
            set({ deck: { customImage: reader.result, skin: 'custom' } });
            toast('Graphic applied');
          } catch {
            toast('Could not read that image');
          }
        };
        reader.readAsDataURL(file);
        event.target.value = '';
      },
    });

    const skinTiles = track(tiles(
      DECK_SKINS.map((skin) => ({
        id: skin.id,
        name: skin.name,
        colors: skin.id === 'custom'
          ? ['#3a3f46', '#5a6068']
          : [cfg().deck.base, cfg().deck.ink, cfg().deck.accent],
      })),
      () => cfg().deck.skin,
      (id) => {
        if (id === 'custom') {
          if (cfg().deck.customImage) set({ deck: { skin: 'custom' } });
          else fileInput.click();
          return;
        }
        set({ deck: { skin: id } });
      },
    ));

    // Keep the tile previews in step with the palette.
    syncers.push(() => {
      const chips = skinTiles.querySelectorAll('.tile__chip');
      const palette = [cfg().deck.base, cfg().deck.ink, cfg().deck.accent];
      chips.forEach((chip, index) => {
        if (DECK_SKINS[index]?.id === 'custom') return;
        chip.querySelectorAll('span').forEach((span, spanIndex) => {
          span.style.background = palette[spanIndex] ?? palette[0];
        });
      });
    });

    const glossValue = track(slider({
      min: 0, max: 1, step: 0.05,
      getValue: () => cfg().deck.gloss,
      onInput: (value) => set({ deck: { gloss: value } }),
      format: (value) => `${Math.round(value * 100)}%`,
    }));

    return el('div', {}, [
      fileInput,
      group('Graphic', skinTiles),
      group('Background', track(swatches(() => cfg().deck.base, (color) => set({ deck: { base: color } })))),
      group('Ink', track(swatches(() => cfg().deck.ink, (color) => set({ deck: { ink: color } })))),
      group('Accent', track(swatches(() => cfg().deck.accent, (color) => set({ deck: { accent: color } })))),
      group('Veneer', track(swatches(() => cfg().deck.wood, (color) => set({ deck: { wood: color } }), WOOD_PALETTE))),
      group('Lacquer', glossValue, glossValue.__readout),
      group('Custom art', el('div', { class: 'stack' }, [
        action('Upload your own graphic', ICONS.upload, () => fileInput.click()),
        el('p', { class: 'note', text: 'Wide images work best — it is stretched across the underside of the deck. Uploads stay on your device and are not saved between visits.' }),
      ])),
    ]);
  }

  /* -------------------------------------------------------------- tab: grip */

  function gripTab() {
    return el('div', {}, [
      group('Tape', el('div', { class: 'stack' }, [
        track(toggle('Grip tape on', () => cfg().grip.enabled, (value) => set({ grip: { enabled: value } }))),
      ])),
      group('Pattern', track(segmented(GRIP_PATTERNS, () => cfg().grip.pattern, (id) => set({ grip: { pattern: id } })))),
      group('Colour', track(swatches(() => cfg().grip.color, (color) => set({ grip: { color } })))),
      el('p', { class: 'note', text: 'Turn the tape off or set it to Clear to show the veneer and the concave underneath.' }),
    ]);
  }

  /* ------------------------------------------------------------ tab: trucks */

  function trucksTab() {
    return el('div', {}, [
      group('Finish', track(segmented(
        TRUCK_FINISH_LIST,
        () => cfg().trucks.finish,
        (id) => {
          const finish = TRUCK_FINISH_LIST.find((entry) => entry.id === id);
          set({ trucks: { finish: id, color: finish.color } });
        },
      ))),
      group('Metal tint', track(swatches(() => cfg().trucks.color, (color) => set({ trucks: { color } })))),
      group('Bushings', track(swatches(() => cfg().trucks.bushings, (color) => set({ trucks: { bushings: color } })))),
      group('Hardware', track(swatches(() => cfg().hardware.color, (color) => set({ hardware: { color } })))),
    ]);
  }

  /* ------------------------------------------------------------ tab: wheels */

  function wheelsTab() {
    return el('div', {}, [
      group('Style', track(segmented(WHEEL_STYLES, () => cfg().wheels.style, (id) => set({ wheels: { style: id } })))),
      group('Urethane', track(swatches(() => cfg().wheels.color, (color) => set({ wheels: { color } })))),
      group('Accent', track(swatches(() => cfg().wheels.accent, (color) => set({ wheels: { accent: color } })))),
      group('Bearings', track(swatches(() => cfg().wheels.bearings, (color) => set({ wheels: { bearings: color } })))),
    ]);
  }

  /* ------------------------------------------------------------- tab: scene */

  function sceneTab() {
    const speed = track(slider({
      min: 0.2, max: 3, step: 0.1,
      getValue: () => cfg().scene.rotateSpeed,
      onInput: (value) => set({ scene: { rotateSpeed: value } }),
      format: (value) => `${value.toFixed(1)}x`,
    }));

    return el('div', {}, [
      group('Environment', track(tiles(
        Object.entries(BACKGROUNDS).map(([id, preset]) => ({
          id,
          name: preset.name,
          colors: [preset.top, preset.bottom],
        })),
        () => cfg().scene.background,
        (id) => set({ scene: { background: id } }),
      ))),
      group('Stage', el('div', { class: 'stack' }, [
        track(toggle('Floor', () => cfg().scene.floor, (value) => set({ scene: { floor: value } }))),
        track(toggle('Shadows', () => cfg().scene.shadows, (value) => set({ scene: { shadows: value } }))),
        track(toggle('Auto-spin', () => cfg().scene.autoRotate, (value) => set({ scene: { autoRotate: value } }))),
      ])),
      group('Spin speed', speed, speed.__readout),
      group('Board', el('div', { class: 'stack' }, [
        action('Reset everything', ICONS.reset, () => {
          store.reset();
          viewer.setView('hero');
          toast('Back to the default board');
        }),
      ])),
    ]);
  }

  /* --------------------------------------------------------------- assembly */

  const TABS = [
    { id: 'looks', name: 'Looks', build: looksTab },
    { id: 'deck', name: 'Deck', build: deckTab },
    { id: 'grip', name: 'Grip', build: gripTab },
    { id: 'trucks', name: 'Trucks', build: trucksTab },
    { id: 'wheels', name: 'Wheels', build: wheelsTab },
    { id: 'scene', name: 'Scene', build: sceneTab },
  ];

  const panes = new Map();
  const tabButtons = new Map();

  for (const tab of TABS) {
    const pane = tab.build();
    pane.hidden = true;
    pane.id = `pane-${tab.id}`;
    pane.setAttribute('role', 'tabpanel');
    panes.set(tab.id, pane);
    bodyHost.append(pane);

    const button = el('button', {
      type: 'button',
      role: 'tab',
      text: tab.name,
      'aria-controls': `pane-${tab.id}`,
      onclick: () => selectTab(tab.id),
    });
    tabButtons.set(tab.id, button);
    tabsHost.append(button);
  }

  function selectTab(id) {
    for (const [key, pane] of panes) pane.hidden = key !== id;
    for (const [key, button] of tabButtons) {
      button.setAttribute('aria-selected', String(key === id));
    }
    bodyHost.scrollTop = 0;
  }

  selectTab('looks');

  function sync() {
    for (const syncer of syncers) syncer();
  }

  return { sync, selectTab };
}
