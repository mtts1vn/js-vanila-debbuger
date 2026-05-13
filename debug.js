/**
 * Usage: window.Debug.watch('fps', () => fps)
 *        window.Debug.set('player.x', x)
 *        window.Debug.remove('player.x')
 *        window.Debug.toggle()
 */

(function (global) {
  "use strict";

  const TICK_MS = 100;
  const MAX_ROWS = 40;
  const Z_INDEX = 99999;

  const CSS = `
  #__debug-overlay {
    position: fixed;
    top: 8px;
    left: 8px;
    z-index: ${Z_INDEX};
    width: 320px;
    max-height: 90vh;
    overflow-y: auto;
    overflow-x: hidden;
    background: rgba(10, 10, 10, 0.96);
    border: 1px solid #262626;
    font-family: Consolas, 'SF Mono', monospace;
    font-size: 11px;
    line-height: 1.45;
    color: #cfcfcf;
    user-select: none;
    pointer-events: none;
    scrollbar-width: thin;
    scrollbar-color: #2f2f2f transparent;
  }

  #__debug-overlay::-webkit-scrollbar {
    width: 4px;
  }

  #__debug-overlay::-webkit-scrollbar-thumb {
    background: #2f2f2f;
  }

  #__debug-header {
    display: flex;
    align-items: center;
    height: 28px;
    padding: 0 8px;
    border-bottom: 1px solid #1c1c1c;
    background: #111;
  }

  #__debug-header-dot {
    width: 5px;
    height: 5px;
    margin-right: 6px;
    background: #5a5a5a;
    border-radius: 50%;
    opacity: 0.8;
  }

  #__debug-header-title {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #8a8a8a;
  }

  #__debug-header-count {
    margin-left: auto;
    font-size: 10px;
    color: #555;
  }

  #__debug-body {
    padding: 4px 0;
  }

  .debug-row {
    display: flex;
    align-items: center;
    min-height: 18px;
    padding: 0 8px;
    white-space: nowrap;
  }

  .debug-row.changed {
    background: rgba(255, 255, 255, 0.03);
  }

  .debug-key {
    flex-shrink: 0;
    width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    color: #7a7a7a;
  }

  .debug-sep {
    flex-shrink: 0;
    margin: 0 6px;
    color: #3f3f3f;
  }

  .debug-val {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    font-variant-numeric: tabular-nums;
    color: #d6d6d6;
  }

  .debug-val.type-number {
    color: #bcbcbc;
  }

  .debug-val.type-boolean {
    color: #909090;
  }

  .debug-val.type-string {
    color: #d0d0d0;
  }

  .debug-val.type-null {
    color: #5f5f5f;
  }

  .debug-val.type-object {
    color: #a8a8a8;
  }

  .debug-divider {
    height: 1px;
    margin: 4px 0;
    background: #1a1a1a;
  }

  .debug-group-label {
    padding: 4px 8px 2px;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #525252;
  }
  `;

  /** @type {Map<string, { getter: (() => any) | null, value: any, prev: any, group: string | null }>} */
  const entries = new Map();
  let visible = true;
  let tickHandle = null;
  let el = null;
  let bodyEl = null;
  let countEl = null;

  function mount() {
    if (el) return;

    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    el = document.createElement("div");
    el.id = "__debug-overlay";

    const header = document.createElement("div");
    header.id = "__debug-header";

    const dot = document.createElement("div");
    dot.id = "__debug-header-dot";

    const title = document.createElement("div");
    title.id = "__debug-header-title";
    title.textContent = "Debug";

    countEl = document.createElement("div");
    countEl.id = "__debug-header-count";

    header.appendChild(dot);
    header.appendChild(title);
    header.appendChild(countEl);

    bodyEl = document.createElement("div");
    bodyEl.id = "__debug-body";

    el.appendChild(header);
    el.appendChild(bodyEl);
    document.body.appendChild(el);
  }

  function formatValue(v) {
    if (v === null) return { str: "null", cls: "type-null" };
    if (v === undefined) return { str: "undefined", cls: "type-null" };
    const t = typeof v;
    if (t === "object") {
      try {
        return { str: JSON.stringify(v), cls: "type-object" };
      } catch {
        return { str: String(v), cls: "type-object" };
      }
    }
    return {
      str: String(v),
      cls:
        t === "number"
          ? "type-number"
          : t === "boolean"
            ? "type-boolean"
            : t === "string"
              ? "type-string"
              : "",
    };
  }

  /** Full re-render (only when keys change). Otherwise we patch text nodes. */
  function fullRender() {
    bodyEl.innerHTML = "";
    let lastGroup = undefined;

    entries.forEach(({ value, group }, key) => {
      if (group !== lastGroup) {
        if (lastGroup !== undefined) {
          const div = document.createElement("div");
          div.className = "debug-divider";
          bodyEl.appendChild(div);
        }
        if (group) {
          const lbl = document.createElement("div");
          lbl.className = "debug-group-label";
          lbl.textContent = group;
          bodyEl.appendChild(lbl);
        }
        lastGroup = group;
      }

      const row = document.createElement("div");
      row.className = "debug-row";
      row.dataset.key = key;

      const k = document.createElement("span");
      k.className = "debug-key";
      k.textContent = key;

      const sep = document.createElement("span");
      sep.className = "debug-sep";
      sep.textContent = "·";

      const { str, cls } = formatValue(value);
      const v = document.createElement("span");
      v.className = "debug-val " + cls;
      v.textContent = str;

      row.appendChild(k);
      row.appendChild(sep);
      row.appendChild(v);
      bodyEl.appendChild(row);
    });

    countEl.textContent =
      entries.size + (entries.size === 1 ? " var" : " vars");
  }

  /** Patch only changed rows — no full re-render. */
  function patchRender() {
    entries.forEach((entry, key) => {
      const { value, prev } = entry;
      const strNow = JSON.stringify(value);
      const strPrev = JSON.stringify(prev);

      const row = bodyEl.querySelector(
        `[data-key="${CSS.escape ? CSS.escape(key) : key}"]`,
      );
      if (!row) return;

      const valEl = row.querySelector(".debug-val");
      if (strNow !== strPrev) {
        const { str, cls } = formatValue(value);
        valEl.textContent = str;
        valEl.className = "debug-val " + cls;
        row.classList.add("changed");
        setTimeout(() => row.classList.remove("changed"), 300);
        entry.prev = value;
      }
    });
  }

  let _lastSize = 0;
  let _lastKeys = "";

  function tick() {
    if (!visible || !el) return;

    entries.forEach((entry) => {
      if (typeof entry.getter === "function") {
        entry.value = entry.getter();
      }
    });

    const keysNow = [...entries.keys()].join("|");
    if (entries.size !== _lastSize || keysNow !== _lastKeys) {
      _lastSize = entries.size;
      _lastKeys = keysNow;
      fullRender();

      entries.forEach((e) => {
        e.prev = e.value;
      });
    } else {
      patchRender();
    }
  }

  function startTick() {
    if (tickHandle) return;
    tickHandle = setInterval(tick, TICK_MS);
  }

  function stopTick() {
    clearInterval(tickHandle);
    tickHandle = null;
  }

  const Debug = {
    /**
     * Watch a reactive value via getter function.
     * @param {string}   name
     * @param {Function} getter  — called every tick
     * @param {string}  [group]  — optional group label
     */
    watch(name, getter, group = null) {
      entries.set(name, { getter, value: getter(), prev: undefined, group });
      return this;
    },

    /**
     * Set a static value (updated only when you call set() again).
     * @param {string} name
     * @param {*}      value
     * @param {string} [group]
     */
    set(name, value, group = null) {
      const existing = entries.get(name);
      entries.set(name, {
        getter: null,
        value,
        prev: existing?.value,
        group: group ?? existing?.group ?? null,
      });
      return this;
    },

    /**
     * Remove a tracked variable.
     * @param {string} name
     */
    remove(name) {
      entries.delete(name);
      return this;
    },

    /** Remove all entries. */
    clear() {
      entries.clear();
      return this;
    },

    /** Show the overlay. */
    show() {
      visible = true;
      if (el) el.style.display = "";
      startTick();
      return this;
    },

    /** Hide the overlay. */
    hide() {
      visible = false;
      if (el) el.style.display = "none";
      return this;
    },

    /** Toggle visibility. */
    toggle() {
      return visible ? this.hide() : this.show();
    },

    /**
     * @param {'top-left'|'top-right'|'bottom-left'|'bottom-right'} corner
     */
    position(corner = "top-left") {
      if (!el) return this;
      const s = el.style;
      s.top = s.left = s.right = s.bottom = "";
      const [v, h] = corner.split("-");
      s[v] = "12px";
      s[h] = "12px";
      return this;
    },
  };

  function init() {
    mount();
    startTick();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  global.Debug = Debug;
})(window);
