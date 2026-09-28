/** Small DOM builders shared by every panel section. */

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

export const icon = (paths) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  spin: icon('<path d="M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6"/><path d="M17 3v4h-4M7 21v-4h4"/>'),
  camera: icon('<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.4"/>'),
  share: icon('<path d="M12 15V4"/><path d="M8 7.5 12 3.5l4 4"/><path d="M5 13v6.5h14V13"/>'),
  reset: icon('<path d="M4 9a8 8 0 1 1-.6 5"/><path d="M3.2 4.5V9h4.5"/>'),
  upload: icon('<path d="M12 16V5"/><path d="M8 8.5 12 4.5l4 4"/><path d="M5 14v5.5h14V14"/>'),
  pencil: icon('<path d="M4 20h4L20 8l-4-4L4 16z"/>'),
  play: icon('<path d="M7 4.8 19 12 7 19.2z"/>'),
};

export function group(label, content, valueNode = null) {
  return el('div', { class: 'group' }, [
    el('p', { class: 'group__label' }, [
      el('span', { text: label }),
      valueNode,
    ]),
    content,
  ]);
}

/** A row of equal-width option buttons. */
export function segmented(options, getValue, onPick) {
  const wrap = el('div', { class: 'segmented' });
  const buttons = options.map((option) => {
    const button = el('button', {
      type: 'button',
      text: option.name,
      onclick: () => onPick(option.id),
    });
    wrap.append(button);
    return button;
  });
  const sync = () => {
    const current = getValue();
    buttons.forEach((button, index) => {
      button.setAttribute('aria-pressed', String(options[index].id === current));
    });
  };
  sync();
  wrap.__sync = sync;
  return wrap;
}

/** A grid of preview tiles (skins, presets, backgrounds). */
export function tiles(items, getValue, onPick) {
  const wrap = el('div', { class: 'tiles' });
  const buttons = items.map((item) => {
    const chip = el('div', { class: 'tile__chip' });
    for (const color of item.colors ?? ['#2a2d33']) {
      chip.append(el('span', { style: `background:${color}` }));
    }
    if (item.chipHtml) chip.innerHTML = item.chipHtml;
    const button = el('button', {
      type: 'button',
      class: 'tile',
      onclick: () => onPick(item.id),
    }, [chip, el('div', { class: 'tile__name', text: item.name })]);
    wrap.append(button);
    return button;
  });
  const sync = () => {
    const current = getValue();
    buttons.forEach((button, index) => {
      button.setAttribute('aria-pressed', String(items[index].id === current));
    });
  };
  sync();
  wrap.__sync = sync;
  return wrap;
}

export const PALETTE = [
  '#ffffff', '#e6e8ec', '#9aa3b2', '#4b5563', '#16181d', '#000000',
  '#ff5722', '#ff3c78', '#e63946', '#f2c200', '#ffd54a', '#12f7d6',
  '#00d4ff', '#2b7fff', '#7b5cff', '#5a6b45', '#d3c89b', '#c89a63',
];

/** Palette swatches plus a native colour picker for anything else. */
export function swatches(getValue, onPick, palette = PALETTE) {
  const wrap = el('div', { class: 'swatches' });
  const buttons = palette.map((color) => {
    const button = el('button', {
      type: 'button',
      class: 'swatch',
      style: `background:${color}`,
      'aria-label': color,
      onclick: () => onPick(color),
    });
    wrap.append(button);
    return button;
  });

  const input = el('input', {
    type: 'color',
    'aria-label': 'Custom colour',
    oninput: (event) => onPick(event.target.value),
  });
  wrap.append(el('div', { class: 'swatch swatch--custom' }, [input, el('span', { html: ICONS.pencil })]));

  const sync = () => {
    const current = (getValue() || '').toLowerCase();
    buttons.forEach((button, index) => {
      button.setAttribute('aria-pressed', String(palette[index].toLowerCase() === current));
    });
    input.value = /^#[0-9a-f]{6}$/i.test(current) ? current : '#ffffff';
  };
  sync();
  wrap.__sync = sync;
  return wrap;
}

export function slider({ min, max, step, getValue, onInput, onCommit, format }) {
  const readout = el('span', { class: 'group__value' });
  const input = el('input', {
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
    // `input` fires throughout a drag, `change` once the handle is released.
    oninput: (event) => onInput(Number(event.target.value)),
    onchange: (event) => (onCommit ?? onInput)(Number(event.target.value)),
  });
  const sync = () => {
    input.value = String(getValue());
    readout.textContent = format ? format(getValue()) : String(getValue());
  };
  sync();
  const wrap = el('div', { class: 'slider' }, [input]);
  wrap.__sync = sync;
  wrap.__readout = readout;
  return wrap;
}

export function toggle(label, getValue, onToggle) {
  const button = el('button', {
    type: 'button',
    class: 'switch',
    onclick: () => onToggle(!getValue()),
  }, [
    el('span', { text: label }),
    el('span', { class: 'switch__track' }, [el('span', { class: 'switch__knob' })]),
  ]);
  const sync = () => button.setAttribute('aria-pressed', String(Boolean(getValue())));
  sync();
  button.__sync = sync;
  return button;
}

export function action(label, iconHtml, onClick, variant = '') {
  return el('button', {
    type: 'button',
    class: `action ${variant}`.trim(),
    onclick: onClick,
  }, [el('span', { html: iconHtml }), el('span', { text: label })]);
}
