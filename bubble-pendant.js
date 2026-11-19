/*!
 * bubble-pendant — 头像旁的小对话气泡 / a tiny speech-bubble pendant for chat avatars.
 * PolyForm Noncommercial License 1.0.0 (see LICENSE / NOTICE.md). No dependencies. Works as a plain <script> (window.BubblePendant)
 * or via require()/bundlers (module.exports).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BubblePendant = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ───────────────────────── values ─────────────────────────
  const TEXT_MAX = 8;
  const PRESET_MAX = 40;
  const NOTE_MAX = 4; // a note the AI leaves: at most 4 characters per side, longer looks bad in a bubble
  // scale sizes the bubble (relative to the avatar), textScale sizes only the text.
  const RANGES = Object.freeze({
    scale: [0.6, 1.6], textScale: [0.6, 1.6], amplitude: [0, 6], period: [2, 12], nightFrom: [0, 23], nightTo: [0, 23],
  });
  // Bubble look. Sizes are multiples of the avatar diameter; size / sizePhone are px.
  const LOOK = Object.freeze({
    w: 0.59, h: 0.72, pad: 0.21, radius: 0.48, lineW: 1.3, size: 10.25, sizePhone: 8.5, weight: 800, vGap: 0.11,
    reach: 0.26, drop: 0.39, tail: 0.13, tailW: 0.22, tailInset: 0.13, shadowBlur: 6.5, shadowAlpha: 0.31,
    bg: '#fbfaff', ink: '#1a1724', line: '#1a1724',
  });
  const LOOK_RANGES = Object.freeze({
    w: [0.3, 1.6], h: [0.3, 1.6], pad: [0, 0.6], radius: [0, 0.5], lineW: [0, 3], size: [7, 24], sizePhone: [6, 20],
    weight: [300, 900], vGap: [0, 0.4], reach: [-0.3, 1], drop: [-0.6, 1], tail: [0, 1], tailW: [0, 1], tailInset: [0, 1],
    shadowBlur: [0, 16], shadowAlpha: [0, 0.9],
  });
  const LOOK_COLORS = ['bg', 'ink', 'line'];
  const LOOK_UNITS = { lineW: 'px', size: 'px', sizePhone: 'px', vGap: 'em', shadowBlur: 'px' };
  // Per preset, per side: width / height / padding (avatar multiples) and text size (multiplier).
  const SIDE_RANGES = Object.freeze({ w: [0.3, 1.6], h: [0.3, 1.6], pad: [0, 0.6], text: [0.5, 2] });
  const DEFAULT_PRESETS = Object.freeze([
    { id: 'woof', user: '汪。', assistant: '乖。', enabled: true },
    { id: 'huh', user: '？', assistant: '。', enabled: true },
    { id: 'face', user: 'ʊ_ʊ', assistant: '笨蛋。', enabled: true },
  ]);
  const DEFAULTS = Object.freeze({
    enabled: true, scale: 1, textScale: 1, float: true, amplitude: 4, period: 3.5, nightFrom: 0, nightTo: 6,
    look: LOOK, presets: DEFAULT_PRESETS,
  });

  const clamp = (value, [min, max], fallback) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  const kebab = (key) => key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

  /** Trim, collapse whitespace and cut to TEXT_MAX code points. */
  function cleanText(value) {
    const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    return Array.from(text).slice(0, TEXT_MAX).join('');
  }

  /** A yearly date as 'MM-DD'. Accepts '5-20', '05/20', '5.20', '5月20日'. Invalid → ''. */
  function cleanDate(value) {
    const m = String(value || '').trim().match(/^(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/);
    if (!m) return '';
    const month = Number(m[1]), day = Number(m[2]);
    const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    return days && day >= 1 && day <= days ? `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
  }
  const dayKey = (now) => `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  function normalizeLook(value) {
    const input = value && typeof value === 'object' ? value : {};
    const look = { ...LOOK };
    for (const [key, range] of Object.entries(LOOK_RANGES)) look[key] = clamp(input[key], range, LOOK[key]);
    for (const key of LOOK_COLORS) if (/^#[0-9a-f]{6}$/i.test(input[key] || '')) look[key] = input[key].toLowerCase();
    return look;
  }
  // Keep only the keys that were adjusted; an empty side means "use the shared look".
  function normalizeSide(value) {
    const out = {};
    for (const [key, range] of Object.entries(SIDE_RANGES)) { const v = clamp(value?.[key], range, null); if (v !== null) out[key] = v; }
    return Object.keys(out).length ? out : null;
  }
  function normalizeStyle(value) {
    const user = normalizeSide(value?.user), assistant = normalizeSide(value?.assistant);
    return user || assistant ? { ...(user ? { user } : {}), ...(assistant ? { assistant } : {}) } : null;
  }

  function normalizePreset(item, index, seen) {
    let id = typeof item?.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(item.id) ? item.id : `p-${index + 1}`;
    while (seen.has(id)) id += 'x';
    seen.add(id);
    const date = cleanDate(item?.date), style = normalizeStyle(item?.style);
    return {
      id, user: cleanText(item?.user), assistant: cleanText(item?.assistant), enabled: item?.enabled !== false,
      ...(date ? { date } : {}), ...(item?.night === true ? { night: true } : {}), ...(style ? { style } : {}),
    };
  }

  /** A one-off note the AI left for the next visit: { user?, assistant?, at }. Each side is cut to NOTE_MAX. */
  function normalizeNote(value) {
    if (!value || typeof value !== 'object') return null;
    const cut = (v) => Array.from(cleanText(v)).slice(0, NOTE_MAX).join('');
    const user = cut(value.user), assistant = cut(value.assistant);
    const at = typeof value.at === 'string' && !Number.isNaN(Date.parse(value.at)) ? value.at : new Date().toISOString();
    return user || assistant ? { ...(user ? { user } : {}), ...(assistant ? { assistant } : {}), at } : null;
  }

  // ───────────────────────── AI note tag ─────────────────────────
  /**
   * Let the AI write the bubbles for the next visit with a hidden inline tag:
   *   <pendant user="困" assistant="快睡"/>
   * Put PROMPT_RULE (or your own wording) in the system prompt, pass each finished reply to
   * controller.takeReply(text) (or parseTag + leaveNote yourself) and show stripTags(text).
   */
  const PROMPT_RULE = Object.freeze({
    zh: '聊天界面里，用户的头像和你的头像旁各有一个小气泡，平时随机显示。想让用户下次打开聊天时看到你写的，在回复末尾写 <pendant user="用户那边的字" assistant="你这边的字"/>，每边最多4个字，可以只写一边，没写的那边照常随机。标签不会显示，只用一次，后写的覆盖先写的。偶尔用就好，不用每轮都写。',
    en: 'In the chat, the user\'s avatar and yours each have a tiny speech bubble that normally shows a random pair. To choose what the user sees the next time they open the chat, end your reply with <pendant user="their side" assistant="your side"/>, at most 4 characters per side; you may fill only one side and the other stays random. The tag is hidden, used once, and a later tag replaces an earlier one. Use it now and then, not every turn.',
  });
  const TAG_SCAN = /```[\s\S]*?(?:```|$)|`[^`\n]*(?:`|$)|<(think|thinking)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)|<pendant\b([^>]*?)\/?>/gi;
  const attrs = (raw) => Object.fromEntries([...String(raw || '').matchAll(/(\w+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1].toLowerCase(), m[2].trim()]));
  /** The last <pendant user=".." assistant=".."/> in a reply (tags inside code or <think> are ignored), or null. */
  function parseTag(text) {
    let out = null;
    for (const m of String(text || '').matchAll(TAG_SCAN)) {
      if (m[2] === undefined) continue;
      const a = attrs(m[2]);
      if (a.user || a.assistant) out = { user: a.user || '', assistant: a.assistant || '' };
    }
    return out;
  }
  /** Remove pendant tags for display, including a half-written one at the end while streaming. Code stays untouched. */
  function stripTags(text) {
    return String(text ?? '')
      .replace(TAG_SCAN, (m, think, tagAttrs) => (tagAttrs === undefined ? m : ''))
      .replace(/<(?:p(?:e(?:n(?:d(?:a(?:n(?:t(?:\b[^>]*)?)?)?)?)?)?)?)?$/i, '');
  }

  /** Normalize any input into a valid config. Missing `presets` → the default three. */
  function normalize(value) {
    const input = value && typeof value === 'object' ? value : {};
    const seen = new Set();
    const presets = Array.isArray(input.presets)
      ? input.presets.slice(0, PRESET_MAX).map((item, index) => normalizePreset(item, index, seen)).filter((item) => item.user || item.assistant)
      : DEFAULT_PRESETS.map((item) => ({ ...item }));
    const num = (key) => clamp(input[key], RANGES[key], DEFAULTS[key]);
    return {
      enabled: input.enabled !== false,
      scale: num('scale'), textScale: num('textScale'),
      float: input.float !== false,
      amplitude: num('amplitude'), period: num('period'),
      nightFrom: Math.round(num('nightFrom')), nightTo: Math.round(num('nightTo')),
      look: normalizeLook(input.look),
      presets,
      ...(normalizeNote(input.note) ? { note: normalizeNote(input.note) } : {}),
    };
  }

  /** 2–3 CJK characters (full-width punctuation allowed, at least one Han) stack vertically, like QQ. */
  function isVertical(text) {
    const chars = Array.from(text || '');
    return chars.length >= 2 && chars.length <= 3
      && chars.every((c) => /[\p{Script=Han}　-〿！-？～]/u.test(c))
      && chars.some((c) => /\p{Script=Han}/u.test(c));
  }

  /** Is `now` inside the night window [from, to)? It may wrap past midnight; from === to means never. */
  function isNight(now = new Date(), from = DEFAULTS.nightFrom, to = DEFAULTS.nightTo) {
    const hour = now.getHours();
    return from === to ? false : from < to ? hour >= from && hour < to : hour >= from || hour < to;
  }

  const usable = (p) => Boolean(p && (p.user || p.assistant));
  function pickFrom(pool, lastId, random) {
    if (!pool.length) return null;
    const fresh = pool.length > 1 ? pool.filter((p) => p.id !== lastId) : pool;
    return fresh[Math.floor(random() * fresh.length)] || fresh[0];
  }
  /**
   * Pick the preset for one visit:
   *  1. If today is some presets' special date, pick among those. Dated presets never show on other days.
   *  2. At night prefer presets marked `night`; in the daytime skip them (unless nothing else is left).
   *  3. Otherwise random, avoiding `lastId` unless it is the only one.
   * The third argument may be a random() function or { random, now, nightFrom, nightTo }.
   */
  function pick(presets, lastId, options = {}) {
    const { random = Math.random, now = new Date(), nightFrom, nightTo } = typeof options === 'function' ? { random: options } : options;
    const pool = (presets || []).filter((p) => p.enabled && usable(p));
    const today = pool.filter((p) => p.date === dayKey(now));
    if (today.length) return pickFrom(today, lastId, random);
    const rest = pool.filter((p) => !p.date);
    const night = rest.filter((p) => p.night), day = rest.filter((p) => !p.night);
    if (isNight(now, nightFrom, nightTo) && night.length) return pickFrom(night, lastId, random);
    return pickFrom(day.length ? day : rest, lastId, random);
  }

  /** CSS custom properties for one side: the shared look, overridden by this preset's side style. */
  function lookVars(look, side) {
    const merged = { ...normalizeLook(look) };
    for (const key of ['w', 'h', 'pad']) if (side?.[key] != null) merged[key] = side[key];
    const out = {};
    for (const key of Object.keys(LOOK)) out['--_' + kebab(key)] = `${merged[key]}${LOOK_UNITS[key] || ''}`;
    return out;
  }

  // ───────────────────────── storage ─────────────────────────
  /**
   * A storage adapter is any object with
   *   load(): config | null | Promise<config | null>
   *   save(config): void | Promise<void>
   * and optionally
   *   loadLast(): string | null,  saveLast(id): void   (which preset was shown last)
   */
  function localStorageAdapter(key = 'bubble-pendant') {
    const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
    return {
      load: () => safe(() => JSON.parse(localStorage.getItem(key) || 'null'), null),
      save: (config) => safe(() => localStorage.setItem(key, JSON.stringify(config))),
      loadLast: () => safe(() => localStorage.getItem(key + ':last'), null),
      saveLast: (id) => safe(() => localStorage.setItem(key + ':last', id)),
    };
  }
  function memoryAdapter(initial = null) {
    let data = initial, last = null;
    return { load: () => data, save: (c) => { data = c; }, loadLast: () => last, saveLast: (id) => { last = id; } };
  }

  // ───────────────────────── controller ─────────────────────────
  let uid = 0;
  const newId = () => `p-${Date.now().toString(36)}${(uid++).toString(36)}`;
  const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const copyPreset = (p) => ({ ...p, ...(p.style ? { style: JSON.parse(JSON.stringify(p.style)) } : {}) });

  /**
   * const pendants = BubblePendant.create({ storage, random, now });
   * await pendants.ready;
   * pendants.startVisit();      // call once each time the chat page opens
   */
  function create(options = {}) {
    const storage = options.storage || localStorageAdapter(options.key);
    const random = options.random || Math.random;
    const now = options.now || (() => new Date());
    const listeners = new Set();
    let config = normalize(options.defaults);
    let visit = null;

    const emit = () => listeners.forEach((fn) => { try { fn(api); } catch (e) { console.error(e); } });
    const save = async () => { await storage.save(normalize(config)); emit(); };
    const cleanPreset = (p) => ({
      ...p, user: cleanText(p.user), assistant: cleanText(p.assistant), enabled: p.enabled !== false,
      date: cleanDate(p.date) || undefined, night: p.night === true || undefined, style: normalizeStyle(p.style) || undefined,
    });

    const api = {
      ready: Promise.resolve(storage.load()).then((saved) => { if (saved) config = normalize(saved); emit(); return api; }),
      /** Current config (a copy). Freshly added, still-empty presets are included so editors can show them. */
      get config() { return { ...config, look: { ...config.look }, presets: config.presets.map(copyPreset), ...(config.note ? { note: { ...config.note } } : {}) }; },
      /** Patch top-level fields: enabled, scale, textScale, float, amplitude, period, nightFrom, nightTo, look, presets. */
      async set(patch) {
        const look = patch?.look ? { ...config.look, ...patch.look } : config.look;
        const next = normalize({ ...config, ...patch, look, presets: [] });
        // Without new presets, keep the in-memory list as is (it may hold empty ones still being filled in).
        config = { ...next, presets: patch?.presets ? normalize({ presets: patch.presets }).presets : config.presets };
        await save();
      },
      async addPreset({ user = '', assistant = '', enabled = true, date, night, style } = {}) {
        if (config.presets.length >= PRESET_MAX) throw new Error(`At most ${PRESET_MAX} presets.`);
        const preset = JSON.parse(JSON.stringify(cleanPreset({ id: newId(), user, assistant, enabled, date, night, style })));
        // Saved copies drop presets with no text yet; the in-memory list keeps it so it can be filled in.
        config = { ...config, presets: [...config.presets, preset] };
        await save();
        return preset;
      },
      /** Patch one preset: user, assistant, enabled, date ('MM-DD' or ''), night (bool), style ({user,assistant} or null). */
      async updatePreset(id, patch) {
        config = { ...config, presets: config.presets.map((p) => (p.id === id ? JSON.parse(JSON.stringify(cleanPreset({ ...p, ...patch, id }))) : p)) };
        await save();
      },
      async removePreset(id) { config = { ...config, presets: config.presets.filter((p) => p.id !== id) }; await save(); },
      async setPresetEnabled(id, enabled) { return api.updatePreset(id, { enabled: !!enabled }); },
      /** JSON text of the whole config, for backup or sharing. */
      exportJSON() { return JSON.stringify(normalize(config), null, 2); },
      /** Import JSON text or an object. `merge: true` appends presets instead of replacing everything. */
      async importJSON(source, { merge = false } = {}) {
        const data = typeof source === 'string' ? JSON.parse(source) : source;
        const incoming = normalize(Array.isArray(data) ? { presets: data } : data);
        config = merge ? normalize({ ...config, presets: [...config.presets, ...incoming.presets.map((p) => ({ ...p, id: newId() }))] }) : incoming;
        await save();
      },
      /** Leave a one-off note for the next visit: { user?, assistant? }, at most NOTE_MAX characters per side. */
      async leaveNote(note) {
        const clean = normalizeNote({ ...note, at: new Date().toISOString() });
        config = clean ? { ...config, note: clean } : config;
        await save();
        return clean;
      },
      async clearNote() { const { note, ...rest } = config; config = rest; await save(); },
      /**
       * Feed a finished AI reply: a <pendant .../> tag in it becomes the note for the next visit.
       * Returns the reply with the tags removed, ready to display.
       */
      async takeReply(text) {
        const tag = parseTag(text);
        if (tag) await api.leaveNote(tag);
        return stripTags(text);
      },
      /**
       * Start a new "visit" and keep the result until the next startVisit():
       * special date → the AI's one-off note → night → random (avoiding the previous pick).
       * A note is used up here; on a special date it waits for the next visit.
       * Pendants drawn right after this pop in once.
       */
      startVisit() {
        const last = (visit?.once ? null : visit?.id) ?? (storage.loadLast ? storage.loadLast() : null);
        const c = normalize(config), today = now();
        const picked = c.enabled ? pick(c.presets, last, { random, now: today, nightFrom: c.nightFrom, nightTo: c.nightTo }) : null;
        visit = picked;
        if (c.enabled && c.note && picked?.date !== dayKey(today)) {
          visit = { id: 'note', once: true, user: c.note.user || picked?.user || '', assistant: c.note.assistant || picked?.assistant || '' };
          const { note, ...rest } = config; config = rest;
          Promise.resolve(storage.save(normalize(config))).catch((e) => console.error(e));
        }
        api.visitStartedAt = clock();
        if (visit && !visit.once && storage.saveLast) storage.saveLast(visit.id);
        emit();
        return visit ? { ...visit } : null;
      },
      /** performance.now() of the last startVisit(), used for the entrance pop. */
      visitStartedAt: -Infinity,
      /** The preset picked for this visit (null when disabled or nothing is enabled). */
      get current() {
        if (!config.enabled || !visit) return null;
        if (visit.once) return { ...visit };
        const p = config.presets.find((item) => item.id === visit.id && item.enabled);
        return p ? copyPreset(p) : null;
      },
      /** Text for one side in this visit: 'user' or 'assistant'. */
      textFor(side) { return api.current?.[side === 'assistant' ? 'assistant' : 'user'] || ''; },
      /** Subscribe to changes; returns an unsubscribe function. */
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
    return api;
  }

  // ───────────────────────── element ─────────────────────────
  // Every look value reads a public --bp-* variable first (so page CSS can override it),
  // then the internal --_* one the element writes from the controller's config.
  const v = (key, fallback) => `var(--bp-${kebab(key)},var(--_${kebab(key)},${fallback}))`;
  const STYLE = `
:host{position:absolute;top:0;width:0;height:0;display:block;pointer-events:none;z-index:var(--bp-z,2);--_avatar:var(--bp-avatar-size,32px)}
:host([side="user"]){right:0}
:host([side="assistant"]){left:0}
:host([hidden]){display:none}
.f{position:absolute;inset:0;animation:bp-float var(--_period,3.5s) ease-in-out var(--_delay,0s) infinite;will-change:transform}
.f.still{animation:none}
.b{--_u:calc(var(--_avatar) * var(--_scale,1));--_bw:calc(var(--_u) * ${v('w', 0.59)});--_bh:calc(var(--_u) * ${v('h', 0.72)});--_short:min(var(--_bw),var(--_bh));
  --_lw:${v('lineW', '1.3px')};--_ln:${v('line', '#1a1724')};
  position:absolute;bottom:calc(var(--_avatar) * ${v('drop', 0.39)} * -1);isolation:isolate;
  display:flex;align-items:center;justify-content:center;box-sizing:border-box;
  min-width:var(--_bw);min-height:var(--_bh);padding:0 calc(var(--_u) * ${v('pad', 0.21)});
  color:${v('ink', '#1a1724')};white-space:nowrap;
  font:${v('weight', 800)} calc(var(--_fs) * var(--_text-scale,1))/1 var(--bp-font,system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif);letter-spacing:0;
  --_fs:${v('size', '10.25px')};transform-origin:calc(var(--_short) * ${v('tailInset', 0.13)}) 100%}
@media (max-width:600px){.b{--_fs:${v('sizePhone', '8.5px')}}}
.shape{position:absolute;inset:0;z-index:-1;border-radius:calc(var(--_short) * ${v('radius', 0.48)});background:${v('bg', '#fbfaff')};
  filter:drop-shadow(var(--_lw) 0 0 var(--_ln)) drop-shadow(calc(var(--_lw) * -1) 0 0 var(--_ln)) drop-shadow(0 var(--_lw) 0 var(--_ln)) drop-shadow(0 calc(var(--_lw) * -1) 0 var(--_ln))
    drop-shadow(0 1px ${v('shadowBlur', '6.5px')} rgb(6 5 11 / ${v('shadowAlpha', 0.31)}))}
.tail{--_hid:calc(var(--_short) * .16);--_len:calc(var(--_short) * ${v('tail', 0.13)});
  position:absolute;top:calc(100% - var(--_hid));width:calc(var(--_short) * ${v('tailW', 0.22)});height:calc(var(--_hid) + var(--_len));
  background:${v('bg', '#fbfaff')};clip-path:polygon(0 0,100% 0,100% var(--_hid),0 100%)}
.ch{display:block;line-height:1;white-space:pre}
.b.v{flex-direction:column;gap:${v('vGap', '.11em')};padding:calc(var(--_u) * ${v('pad', 0.21)}) 0}
.b.v .p{height:.42em;transform:translate(.3em,-.5em)}
.b.solo .p{transform:translate(.3em,-.28em)}
:host([side="user"]) .b{left:calc(var(--_avatar) * ${v('reach', 0.26)} * -1 - var(--_shift,0px))}
:host([side="user"]) .tail{left:calc(var(--_short) * ${v('tailInset', 0.13)} + var(--_shift,0px))}
:host([side="assistant"]) .b{right:calc(var(--_avatar) * ${v('reach', 0.26)} * -1 - var(--_shift,0px));transform-origin:calc(100% - var(--_short) * ${v('tailInset', 0.13)}) 100%}
:host([side="assistant"]) .tail{right:calc(var(--_short) * ${v('tailInset', 0.13)} + var(--_shift,0px));transform:scaleX(-1)}
.b.enter{animation:bp-pop .5s cubic-bezier(.3,1.4,.5,1) var(--_enter,0s) both}
.b.poke{animation:bp-poke .55s ease-out}
:host([side="assistant"]) .b.poke{animation-name:bp-poke-r}
@keyframes bp-float{0%,100%{transform:translateY(0)}50%{transform:translateY(calc(var(--_amp,4px) * -1))}}
@keyframes bp-pop{0%{transform:scale(.2);opacity:0}60%{transform:scale(1.1);opacity:1}100%{transform:scale(1);opacity:1}}
@keyframes bp-poke{0%,100%{transform:rotate(0)}20%{transform:rotate(-9deg) scale(1.06)}45%{transform:rotate(7deg)}70%{transform:rotate(-3deg)}}
@keyframes bp-poke-r{0%,100%{transform:rotate(0)}20%{transform:rotate(9deg) scale(1.06)}45%{transform:rotate(-7deg)}70%{transform:rotate(3deg)}}
@media (prefers-reduced-motion:reduce){.f,.b.enter,.b.poke{animation:none}}`;

  const ENTER_SECONDS = 0.6;
  const PUNCT = /^[。，、．.,]$/u;
  let defaultController = null;
  const HTMLBase = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

  /**
   * <bubble-pendant side="user|assistant" [text="汪。"] [scale] [text-scale] [float="off"] [amplitude] [period]>
   * Put it inside a position:relative box that wraps the avatar (see README).
   * Without `text`, it shows the controller's pick for this visit.
   * Tap the bubble and it wiggles (the avatar underneath stays clickable).
   */
  class BubblePendantElement extends HTMLBase {
    static get observedAttributes() { return ['side', 'text', 'scale', 'text-scale', 'float', 'amplitude', 'period']; }
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = `<style>${STYLE}</style><span class="f"><span class="b" part="bubble"></span></span>`;
      this._float = this.shadowRoot.querySelector('.f');
      this._bubble = this.shadowRoot.querySelector('.b');
      this._off = null;
    }
    connectedCallback() {
      if (!this.hasAttribute('side')) this.setAttribute('side', 'user');
      this.setAttribute('aria-hidden', 'true');
      this._watch(this.controller);
      this.refresh();
      this._enter();
    }
    disconnectedCallback() { this._off?.(); this._off = null; }
    attributeChangedCallback() { if (this.isConnected) this.refresh(); }
    /** The controller this element follows: `el.controller = c`, else the default one. */
    get controller() { return this._controller || defaultController; }
    set controller(value) { this._controller = value; if (this.isConnected) { this._watch(value); this.refresh(); } }
    get bubble() { return this._bubble; }
    _watch(controller) {
      this._off?.();
      let visitAt = controller?.visitStartedAt;
      this._off = controller ? controller.subscribe(() => {
        this.refresh();
        if (controller.visitStartedAt !== visitAt) { visitAt = controller.visitStartedAt; this._enter(); }
      }) : null;
    }
    _num(name, key, fallback) {
      const raw = this.hasAttribute(name) ? Number(this.getAttribute(name)) : this.controller?.config?.[key];
      return clamp(raw, RANGES[key], fallback);
    }
    /** Pop in if this pendant is drawn within ENTER_SECONDS of the visit start (keeps the same phase on redraws). */
    _enter() {
      const since = (clock() - (this.controller?.visitStartedAt ?? -Infinity)) / 1000;
      if (!(since < ENTER_SECONDS) || this.hidden) return;
      this._bubble.style.setProperty('--_enter', `${(-since).toFixed(2)}s`);
      this._bubble.classList.remove('enter'); void this._bubble.offsetWidth; this._bubble.classList.add('enter');
    }
    /** Pop in once now. */
    pop() { this._bubble.style.setProperty('--_enter', '0s'); this._bubble.classList.remove('enter'); void this._bubble.offsetWidth; this._bubble.classList.add('enter'); }
    /** Wiggle once. The text does not change. */
    poke() {
      const b = this._bubble;
      b.classList.remove('poke'); void b.offsetWidth; b.classList.add('poke');
      b.addEventListener('animationend', () => b.classList.remove('poke'), { once: true });
    }
    refresh() {
      const side = this.getAttribute('side') === 'assistant' ? 'assistant' : 'user';
      const c = this.controller?.config;
      const preset = this.hasAttribute('text') ? null : this.controller?.current;
      const text = cleanText(this.hasAttribute('text') ? this.getAttribute('text') : preset?.[side]);
      this.hidden = !text;
      if (!text) return;
      const style = preset?.style?.[side];
      for (const [name, value] of Object.entries(lookVars(c?.look, style))) this.style.setProperty(name, value);
      const period = this._num('period', 'period', DEFAULTS.period);
      this.style.setProperty('--_scale', String(this._num('scale', 'scale', DEFAULTS.scale)));
      this.style.setProperty('--_text-scale', String(+(this._num('text-scale', 'textScale', DEFAULTS.textScale) * (style?.text || 1)).toFixed(3)));
      this.style.setProperty('--_amp', `${this._num('amplitude', 'amplitude', DEFAULTS.amplitude)}px`);
      if (this._period !== period) {
        // Same period and phase for both sides, tied to the page clock: re-drawn pendants never jump.
        this._period = period;
        this.style.setProperty('--_period', `${period}s`);
        this.style.setProperty('--_delay', `${(-((clock() / 1000) % period)).toFixed(2)}s`);
      }
      const still = this.getAttribute('float') === 'off' || (!this.hasAttribute('float') && c && !c.float);
      this._float.classList.toggle('still', still);
      if (this._bubble.dataset.text !== text) {
        const chars = Array.from(text);
        this._bubble.dataset.text = text;
        this._bubble.classList.toggle('v', isVertical(text));
        this._bubble.classList.toggle('solo', chars.length === 1);
        const shape = '<span class="shape"><span class="tail"></span></span>';
        const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
        this._bubble.innerHTML = shape + chars.map((ch) => `<span class="ch${PUNCT.test(ch) ? ' p' : ''}">${esc(ch)}</span>`).join('');
      }
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => this.fit());
    }
    /**
     * Keep a long bubble inside its boundary: the closest [data-bp-boundary] ancestor,
     * else the viewport. The tail stays where it is, still pointing at the avatar.
     */
    fit() {
      if (this.hidden || !this.isConnected) return;
      const boundary = this.closest('[data-bp-boundary]');
      const edge = boundary ? boundary.getBoundingClientRect() : { left: 0, right: document.documentElement.clientWidth };
      const anchor = this.getBoundingClientRect().left;
      const css = getComputedStyle(this);
      const reach = (parseFloat(css.getPropertyValue('--_avatar')) || 32) * (parseFloat(css.getPropertyValue('--bp-reach')) || parseFloat(css.getPropertyValue('--_reach')) || LOOK.reach);
      const width = this._bubble.offsetWidth, gap = 4;
      const over = this.getAttribute('side') === 'assistant'
        ? (edge.left + gap) - (anchor + reach - width)
        : (anchor - reach + width) - (edge.right - gap);
      this.style.setProperty('--_shift', `${Math.max(0, Math.ceil(over))}px`);
    }
  }

  // Tap to wiggle: pendants never take pointer events (so avatars stay clickable);
  // one capturing listener checks whether the tap landed on a bubble.
  let listening = false;
  function listenForTaps(tag) {
    if (listening || typeof document === 'undefined') return;
    listening = true;
    document.addEventListener('click', (event) => {
      if (event.button) return;
      for (const el of document.querySelectorAll(tag)) {
        if (el.hidden || !el.bubble) continue;
        const box = el.bubble.getBoundingClientRect();
        if (event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom) el.poke();
      }
    }, true);
  }

  function define(tag = 'bubble-pendant') {
    if (typeof customElements !== 'undefined' && !customElements.get(tag)) customElements.define(tag, class extends BubblePendantElement {});
    listenForTaps(tag);
  }

  /**
   * Convenience: put a pendant next to an avatar element.
   * If the avatar can hold children (not <img>, not overflow:hidden) the pendant goes inside it;
   * otherwise the avatar is wrapped in an inline-block, position:relative <span class="bp-anchor">.
   */
  function attach(avatar, side, { text, controller } = {}) {
    define();
    let host = avatar;
    const style = getComputedStyle(avatar);
    const canHold = !/^(IMG|svg|VIDEO|CANVAS|INPUT)$/i.test(avatar.tagName) && style.overflow === 'visible' && style.overflowX === 'visible';
    if (canHold) { if (style.position === 'static') avatar.style.position = 'relative'; }
    else {
      host = document.createElement('span');
      host.className = 'bp-anchor';
      host.style.cssText = 'position:relative;display:inline-block;vertical-align:top;line-height:0';
      avatar.replaceWith(host); host.append(avatar);
    }
    const existing = host.querySelector(':scope > bubble-pendant');
    const el = existing || document.createElement('bubble-pendant');
    el.setAttribute('side', side === 'assistant' ? 'assistant' : 'user');
    if (text != null) el.setAttribute('text', text);
    if (controller) el.controller = controller;
    el.style.setProperty('--bp-avatar-size', `${avatar.getBoundingClientRect().height || 32}px`);
    if (!existing) host.append(el);
    return el;
  }

  /** Make `controller` the one that text-less <bubble-pendant> elements follow. */
  function use(controller) {
    defaultController = controller;
    if (typeof document !== 'undefined') document.querySelectorAll('bubble-pendant').forEach((el) => { if (!el._controller) { el._watch(controller); el.refresh(); } });
    return controller;
  }

  define();
  return {
    create, use, attach, define, normalize, normalizeLook, isVertical, isNight, pick, cleanText, cleanDate, lookVars,
    parseTag, stripTags, PROMPT_RULE,
    localStorageAdapter, memoryAdapter, DEFAULTS, RANGES, LOOK, LOOK_RANGES, SIDE_RANGES, TEXT_MAX, PRESET_MAX, NOTE_MAX, Element: BubblePendantElement,
  };
});
