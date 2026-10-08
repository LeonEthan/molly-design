import type {
  DesignCanvasCommand,
  DesignToolbarRequest,
} from '@molly/shared/design-selection-commands';
import {
  circleIcon,
  imageIcon,
  layersIcon,
  lineIcon,
  renderUiIconSvg,
  squareIcon,
  table2Icon,
  typeIcon,
  xIcon,
  type UiIconNode,
} from '@molly/shared/ui-icons';

/** The canonical fields the panel reads; array order is the stacking order, bottom first. */
export type LayerElement = {
  id: string;
  kind: string;
  bounds: readonly number[];
  rotation?: number;
  opacity?: number;
  text?: {
    paragraphs?: ReadonlyArray<{ runs?: ReadonlyArray<{ text?: string }> }>;
    lineHeight?: number;
    letterSpacing?: number;
  };
};

const KIND_ICONS: Record<string, readonly UiIconNode[]> = {
  text: typeIcon,
  shape: squareIcon,
  line: lineIcon,
  image: imageIcon,
  icon: circleIcon,
  table: table2Icon,
  chart: table2Icon,
};

const STYLE = `
.molly-layers{position:fixed;top:14px;right:14px;bottom:76px;z-index:2147482990;display:none;flex-direction:column;width:244px;max-width:calc(100vw - 28px);box-sizing:border-box;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:14px;box-shadow:0 18px 40px -20px rgb(0 0 0 / .35);font:12.5px/1.35 system-ui;overflow:hidden}
.molly-layers.open{display:flex}
.molly-layers header{display:flex;align-items:center;justify-content:space-between;padding:10px 8px 6px 14px;font-weight:600}
.molly-layers header button{width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:7px;background:transparent;color:var(--muted);cursor:pointer}
.molly-layers header button:hover{background:var(--chrome-2);color:var(--ink)}
.molly-layers svg{width:15px;height:15px;flex:none;stroke:currentColor;stroke-width:1.5;fill:none;stroke-linecap:round;stroke-linejoin:round}
.molly-layers .props{display:grid;grid-template-columns:1fr 1fr;gap:6px 8px;padding:4px 14px 12px;border-bottom:1px solid var(--line)}
.molly-layers .props[hidden]{display:none}
.molly-layers label{display:flex;flex-direction:column;gap:3px;min-width:0;color:var(--muted);font-size:11px}
.molly-layers input{width:100%;box-sizing:border-box;height:26px;padding:0 7px;border:1px solid var(--line);border-radius:7px;background:transparent;color:var(--ink);font:12px ui-monospace,SFMono-Regular,Menlo,monospace}
.molly-layers input:focus{outline:none;border-color:var(--ink)}
.molly-layers .arrange{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:4px}
.molly-layers .arrange button{height:26px;border:1px solid var(--line);border-radius:7px;background:transparent;color:var(--ink);font:11.5px system-ui;cursor:pointer}
.molly-layers .arrange button:hover{background:var(--chrome-2)}
.molly-layers .error{grid-column:1/-1;color:#d33b1f;font-size:11px}
.molly-layers .error:empty{display:none}
.molly-layers ol{list-style:none;margin:0;padding:6px;overflow:auto;flex:1}
.molly-layers li button{display:flex;align-items:center;justify-content:flex-start;gap:8px;width:100%;height:auto;min-height:30px;padding:6px 8px;border:none;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.molly-layers li button:hover{background:var(--chrome-2)}
.molly-layers li button[aria-pressed="true"]{background:var(--ink);color:var(--surface)}
.molly-layers li span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.molly-layers .empty{padding:10px 8px;color:var(--muted)}
.molly-layers input:disabled,.molly-layers .arrange button:disabled{opacity:.4;cursor:default}
`;

function preview(element: LayerElement) {
  return (element.text?.paragraphs ?? [])
    .map((paragraph) => (paragraph.runs ?? []).map((run) => run.text ?? '').join(''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/** Native layer list and numeric properties; edits use the host-bound toolbar endpoint. */
export function createLayersPanel(options: {
  request(input: DesignToolbarRequest): Promise<{ ok?: boolean; error?: string }>;
  elements(): readonly LayerElement[];
  select(ids: string[]): void;
  onToggle(open: boolean): void;
}) {
  let labels: Readonly<Record<string, string>> = {};
  const label = (key: string, fallback: string) => labels[key] ?? fallback;
  let selectedIds: string[] = [];
  let epoch = 0;
  let readonly = true;
  const style = document.createElement('style');
  style.textContent = STYLE;
  const root = document.createElement('aside');
  root.className = 'molly-layers';
  root.dataset.mollyToolbar = 'layers';
  const header = document.createElement('header');
  const title = document.createElement('span');
  const close = document.createElement('button');
  close.innerHTML = renderUiIconSvg(xIcon);
  header.append(title, close);
  const props = document.createElement('div');
  props.className = 'props';
  const list = document.createElement('ol');
  root.append(header, props, list);
  document.head.append(style);
  document.body.append(root);

  let queue: Promise<void> = Promise.resolve();
  const send = (build: () => DesignCanvasCommand | undefined, error: HTMLElement) => {
    const selectionEpoch = epoch;
    queue = queue.then(async () => {
      const command = build();
      if (!command) return;
      error.textContent = '';
      try {
        const result = await options.request({ type: 'command', selectionEpoch, command });
        if (!result.ok) error.textContent = result.error ?? 'Canvas command failed';
      } catch (cause) {
        error.textContent = cause instanceof Error ? cause.message : String(cause);
      }
    });
    return queue;
  };

  const renderProps = (selected: LayerElement[]) => {
    props.replaceChildren();
    props.hidden = selected.length === 0;
    const [first] = selected;
    if (!first) return;
    const error = document.createElement('div');
    error.className = 'error';
    error.setAttribute('role', 'alert');
    const field = (
      key: string,
      fallback: string,
      value: number | undefined,
      commit: (next: number) => DesignCanvasCommand | undefined
    ) => {
      const wrap = document.createElement('label');
      wrap.textContent = label(key, fallback);
      const input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.disabled = readonly;
      input.value = value === undefined ? '' : String(Math.round(value * 100) / 100);
      input.onchange = () => {
        const next = Number(input.value);
        if (input.value.trim() === '' || !Number.isFinite(next)) return;
        void send(() => commit(next), error);
      };
      wrap.append(input);
      props.append(wrap);
    };
    const liveBounds = () =>
      options.elements().find((element) => element.id === first.id)?.bounds ?? first.bounds;
    const [x, y, width, height] = first.bounds;
    if (selected.length === 1) {
      field('positionX', 'X', x, (next) => ({
        verb: 'position',
        x: next,
        y: liveBounds()[1] ?? 0,
      }));
      field('positionY', 'Y', y, (next) => ({
        verb: 'position',
        x: liveBounds()[0] ?? 0,
        y: next,
      }));
      field('elementWidth', 'Width', width, (next) =>
        next > 0 ? { verb: 'size', width: next, height: liveBounds()[3] ?? next } : undefined
      );
      field('elementHeight', 'Height', height, (next) =>
        next > 0 ? { verb: 'size', width: liveBounds()[2] ?? next, height: next } : undefined
      );
    }
    if (selected.every((element) => element.kind !== 'table' && element.kind !== 'chart'))
      field('rotation', 'Rotation °', first.rotation ?? 0, (next) =>
        Math.abs(next) <= 360 ? { verb: 'transform', rotation: next } : undefined
      );
    field('opacity', 'Opacity %', (first.opacity ?? 1) * 100, (next) =>
      next >= 0 && next <= 100 ? { verb: 'transform', opacity: next / 100 } : undefined
    );
    if (selected.every((element) => element.kind === 'text')) {
      field('lineHeight', 'Line height', first.text?.lineHeight ?? 1, (next) =>
        next >= 0.5 && next <= 10 ? { verb: 'text-style', lineHeight: next } : undefined
      );
      field('letterSpacing', 'Letter spacing', first.text?.letterSpacing ?? 0, (next) =>
        Math.abs(next) <= 1000 ? { verb: 'text-style', letterSpacing: next } : undefined
      );
    }
    const arrange = document.createElement('div');
    arrange.className = 'arrange';
    for (const [to, key, fallback] of [
      ['front', 'bringToFront', 'Bring to front'],
      ['back', 'sendToBack', 'Send to back'],
      ['forward', 'bringForward', 'Bring forward'],
      ['backward', 'sendBackward', 'Send backward'],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label(key, fallback);
      button.disabled = readonly;
      button.onclick = () => void send(() => ({ verb: 'arrange', to }), error);
      arrange.append(button);
    }
    props.append(arrange, error);
  };

  const kindName = (kind: string) =>
    label(`layer${kind[0]?.toUpperCase()}${kind.slice(1)}`, kind[0]?.toUpperCase() + kind.slice(1));

  const renderList = (elements: readonly LayerElement[]) => {
    list.replaceChildren();
    if (elements.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = label('layersEmpty', 'Nothing on the canvas yet');
      list.append(empty);
      return;
    }
    for (const element of [...elements].reverse()) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(selectedIds.includes(element.id)));
      const name = document.createElement('span');
      name.textContent = preview(element) || kindName(element.kind);
      button.title = `${kindName(element.kind)} · ${element.id}`;
      button.innerHTML = renderUiIconSvg(KIND_ICONS[element.kind] ?? squareIcon);
      button.append(name);
      button.onclick = (event) => {
        const additive = event.shiftKey || event.metaKey || event.ctrlKey;
        options.select(
          !additive
            ? [element.id]
            : selectedIds.includes(element.id)
              ? selectedIds.filter((id) => id !== element.id)
              : [...selectedIds, element.id]
        );
      };
      item.append(button);
      list.append(item);
    }
  };

  const refresh = () => {
    if (!root.classList.contains('open')) return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && props.contains(active)) return;
    const elements = options.elements();
    const byId = new Map(elements.map((element) => [element.id, element]));
    renderProps(selectedIds.flatMap((id) => byId.get(id) ?? []));
    renderList(elements);
  };

  const setOpen = (open: boolean) => {
    root.classList.toggle('open', open);
    options.onToggle(open);
    refresh();
  };
  close.onclick = () => setOpen(false);

  const relabel = () => {
    title.textContent = label('layers', 'Layers');
    close.title = label('closeLayers', 'Close layers');
    close.setAttribute('aria-label', close.title);
    root.setAttribute('aria-label', title.textContent);
  };
  relabel();

  return {
    icon: renderUiIconSvg(layersIcon),
    toggle() {
      setOpen(!root.classList.contains('open'));
    },
    present(next: Readonly<Record<string, string>>) {
      labels = next;
      relabel();
      refresh();
    },
    update(ids: string[], selectionEpoch: number) {
      selectedIds = ids;
      epoch = selectionEpoch;
      refresh();
    },
    refresh,
    idle: () => queue,
    setReadonly(value: boolean) {
      readonly = value;
      refresh();
    },
  };
}
