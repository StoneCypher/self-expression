/**
 * @file cardkit card type: `clock` — an analogue dial plus a digital readout, in any IANA zone.
 *
 * Why a card type rather than a hand-written card: three desks wanted the same clock in three
 * zones, and the third one is where hand-written cards start disagreeing about what a caption
 * says. This emits the whole card — markup, scoped CSS, and a classic browser script — from one
 * settings object, so all three are the same clock pointed at different zones.
 *
 * The emitted script is deliberately ES5-shaped: `var`, function expressions, no template
 * literals. It is injected as a classic `<script>` on a page that also serves an editor preview
 * with no transpile step, so anything newer than ES5 is a silent blank card on the older of the
 * two viewers.
 *
 * @see ../kit.js  — `CK.settings`, `CK.spin`, `CK.build`, `CK.esc`
 * @see ../kit.css — `.ck-gear`, `.ck-set`, `.ck-cap`, and the `--ck-*` tokens
 */

/**
 * Every setting the clock understands, with the value it falls back to.
 *
 * `tz` is an IANA zone name or the string `local`; `face` is one of `analogue`, `digital`,
 * `both`. Seconds default to on because a clock without a moving part reads as a screenshot.
 * `hour12` renders the digital readout on a 12-hour clock; it does not touch the dial, which is
 * twelve-hour whatever anyone says.
 */
const DEFAULTS = { tz: 'local', seconds: true, face: 'both', hour12: false };

/** The three legal `face` values, as a set, so an unknown one falls back rather than blanking. */
const FACES = ['analogue', 'digital', 'both'];

/** A few zones offered as autocomplete. Not a limit — `tz` is free text. */
const ZONE_HINTS = [
  'local', 'UTC', 'America/Los_Angeles', 'America/Denver', 'America/Chicago',
  'America/New_York', 'America/Sao_Paulo', 'Europe/London', 'Europe/Berlin',
  'Europe/Moscow', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney',
];

/**
 * What this card type is, for the desk's type picker and for tooling.
 *
 * `shape` is the one-line data literal a caller would write into a desk file; `defaults` is the
 * machine-readable half, every setting with its fallback, so a validator can check the settings
 * panel against it without having to build the card first.
 *
 * The clock is the case where those two are the same four keys: `data` is a partial settings
 * object and nothing else, because a clock has no payload — the zone IS the content. The
 * meanings live on {@link DEFAULTS} rather than being restated here.
 *
 * @example meta.name;   // 'clock'
 */
export const meta = {
  name: 'clock',
  summary: 'Analogue dial and digital readout for any IANA time zone, with a live UTC offset.',
  shape: '{ tz, seconds, face, hour12 } — tz an IANA zone name or "local", face "analogue" | "digital" | "both", the rest booleans',
  defaults: { ...DEFAULTS },
};

/**
 * HTML-escape a build-time value. Mirrors `CK.esc` so markup produced here and markup produced
 * in the browser cannot disagree about what is safe.
 *
 * @param s any value; `null` and `undefined` become the empty string
 *
 * @example esc('a<b & "c"');   // 'a&lt;b &amp; &quot;c&quot;'
 */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * A JSON literal safe to paste into a classic `<script>` body.
 *
 * `JSON.stringify` alone is not enough: a value containing `</script` would close the element
 * early and the rest of the card would render as text. Escaping the angle brackets — and the
 * two line separators that are newlines to a JS parser but not to JSON — closes both holes.
 *
 * @example jsJson({ a: '</script>' });   // '{"a":"\\u003c/script\\u003e"}'
 */
function jsJson(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** Round to two places, so emitted path data stays short and diffs stay readable. */
function n2(v) { return Math.round(v * 100) / 100; }

/**
 * Fold caller-supplied `data` onto the defaults, rejecting anything the card cannot honour.
 *
 * Seeding is coercive rather than strict: a card descriptor may come from a hand-edited file,
 * and a typo in `face` should give a working clock with the default face, not an empty box.
 *
 * @param data partial settings; missing and null-valued keys keep their default
 *
 * @example settle({ face: 'nope', seconds: 0 });
 * // { tz: 'local', seconds: false, face: 'both', hour12: false }
 */
function settle(data) {
  const out = { ...DEFAULTS };
  if (data && typeof data === 'object') {
    for (const k of Object.keys(DEFAULTS)) {
      if (Object.hasOwn(data, k) && data[k] != null) out[k] = data[k];
    }
  }
  out.tz = String(out.tz || 'local');
  out.seconds = !!out.seconds;
  out.hour12 = !!out.hour12;
  if (!FACES.includes(out.face)) out.face = DEFAULTS.face;
  return out;
}

/**
 * The dial's static furniture: sixty ticks and four numerals, emitted once at build time.
 *
 * Drawn here rather than in the browser because none of it ever changes; shipping it as markup
 * means the card is a correct still clock before its script has run at all.
 *
 * @example dialFurniture().startsWith('<line');   // true
 */
function dialFurniture() {
  const out = [];
  for (let i = 0; i < 60; i++) {
    const a = (i * 6) * Math.PI / 180;
    const major = i % 5 === 0;
    const inner = major ? 38.5 : 42;
    const x1 = 50 + inner * Math.sin(a), y1 = 50 - inner * Math.cos(a);
    const x2 = 50 + 45 * Math.sin(a), y2 = 50 - 45 * Math.cos(a);
    out.push('<line class="' + (major ? 'ck-tick-h' : 'ck-tick-m') + '"' +
             ' x1="' + n2(x1) + '" y1="' + n2(y1) + '"' +
             ' x2="' + n2(x2) + '" y2="' + n2(y2) + '"/>');
  }
  const numerals = [[50, 20.5, '12'], [79.5, 50, '3'], [50, 79.5, '6'], [20.5, 50, '9']];
  for (const [x, y, label] of numerals) {
    out.push('<text x="' + x + '" y="' + y + '" text-anchor="middle"' +
             ' dominant-baseline="central">' + label + '</text>');
  }
  return out.join('');
}

/**
 * The `<option>` list for a `<select>`, with the seeded value pre-selected.
 *
 * The panel is also reflected from storage by `CK.settings` on open; marking the seed here
 * means the card is correct in a static render too, before any script runs.
 */
function options(values, chosen) {
  return values
    .map((v) => '<option value="' + esc(v[0]) + '"' + (v[0] === chosen ? ' selected' : '') +
                '>' + esc(v[1]) + '</option>')
    .join('');
}

/**
 * The card's markup: heading, gear, settings panel, dial, readout, caption.
 *
 * The gear button is emitted empty on purpose — `CK.settings` fills it with a drawn gear, and
 * a glyph typed here would be a second source of truth for a shape the kit already owns.
 */
function markup(id, title, cfg, ord) {
  const f = (name) => esc(id) + '-' + name;
  const hints = ZONE_HINTS
    .map((z) => '<option value="' + esc(z) + '"></option>').join('');

  return '<section data-card="' + esc(id) + '" class="ck-clock"' +
    ' data-face="' + esc(cfg.face) + '" data-seconds="' + (cfg.seconds ? 'on' : 'off') + '"' +
    (ord == null ? '' : ' data-ord="' + esc(ord) + '"') + '>' +
    '<h2>' + esc(title) + '</h2>' +
    '<button class="ck-gear" type="button" title="settings" aria-label="clock settings"></button>' +

    '<div class="ck-set" hidden>' +
      '<label for="' + f('tz') + '">zone</label>' +
      '<input id="' + f('tz') + '" name="tz" type="text" list="' + f('zones') + '"' +
        ' spellcheck="false" autocomplete="off" placeholder="local"' +
        ' value="' + esc(cfg.tz) + '">' +
      '<datalist id="' + f('zones') + '">' + hints + '</datalist>' +

      '<label for="' + f('face') + '">face</label>' +
      '<select id="' + f('face') + '" name="face">' +
        options([['analogue', 'analogue'], ['digital', 'digital'], ['both', 'both']], cfg.face) +
      '</select>' +

      '<label for="' + f('seconds') + '">seconds</label>' +
      '<input id="' + f('seconds') + '" name="seconds" type="checkbox"' +
        (cfg.seconds ? ' checked' : '') + '>' +

      '<label for="' + f('hour12') + '">12-hour</label>' +
      '<input id="' + f('hour12') + '" name="hour12" type="checkbox"' +
        (cfg.hour12 ? ' checked' : '') + '>' +

      '<p class="ck-set-foot">Zone accepts any IANA name, e.g. Asia/Kolkata.</p>' +
    '</div>' +

    '<div class="ck-body">' +
      '<svg class="ck-dial" viewBox="0 0 100 100" role="img" aria-label="analogue clock face">' +
        '<circle class="ck-rim" cx="50" cy="50" r="47.2"/>' +
        dialFurniture() +
        '<line class="ck-hand ck-hand-h" x1="50" y1="57" x2="50" y2="27"/>' +
        '<line class="ck-hand ck-hand-m" x1="50" y1="59.5" x2="50" y2="17"/>' +
        '<line class="ck-hand ck-hand-s" x1="50" y1="61.5" x2="50" y2="13"/>' +
        '<circle class="ck-pin" cx="50" cy="50" r="2.4"/>' +
      '</svg>' +
      '<div class="ck-read">' +
        '<div class="ck-time" aria-live="off">--:--</div>' +
        '<div class="ck-date"></div>' +
      '</div>' +
    '</div>' +

    '<div class="ck-cap"></div>' +
  '</section>';
}

/**
 * Every rule scoped under `.ck-clock`.
 *
 * No literal colour appears: the desk is one document open in a browser and an editor that want
 * opposite themes, so a hex here would be wrong in exactly one of them. `prefers-color-scheme`
 * is likewise untouched — theme is a stamped `data-theme`, because the viewer's choice has to
 * beat the operating system's.
 */
function styles() {
  return [
    '.ck-clock { position: relative; }',

    '.ck-clock .ck-body { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }',

    /* min-width:0 on the readout is what keeps a long formatted date from widening the flex
       item past the card and, through it, giving the page a horizontal scrollbar. */
    '.ck-clock .ck-dial { flex: 0 0 auto; width: 124px; max-width: 46%; height: auto; display: block; }',
    '.ck-clock .ck-read { flex: 1 1 132px; min-width: 0; }',

    '.ck-clock .ck-rim { fill: var(--well); stroke: var(--rule); stroke-width: 1; }',
    '.ck-clock .ck-tick-h { stroke: var(--ink-dim); stroke-width: 2; stroke-linecap: round; }',
    '.ck-clock .ck-tick-m { stroke: var(--ink-faint); stroke-width: 0.8; stroke-linecap: round; }',
    '.ck-clock .ck-dial text { font-family: var(--mono); font-size: 8px; fill: var(--ink-faint); }',

    '.ck-clock .ck-hand { stroke: var(--ink); stroke-linecap: round; fill: none; }',
    '.ck-clock .ck-hand-h { stroke-width: 3.4; }',
    '.ck-clock .ck-hand-m { stroke-width: 2.2; }',
    '.ck-clock .ck-hand-s { stroke: var(--accent); stroke-width: 1; }',
    '.ck-clock .ck-pin { fill: var(--accent); stroke: none; }',

    '.ck-clock .ck-time { font: 400 27px/1.1 var(--disp); color: var(--ink);' +
      ' font-variant-numeric: tabular-nums; letter-spacing: 0.01em; overflow-wrap: anywhere; }',
    '.ck-clock .ck-date { margin-top: 4px; font: 400 11.5px/1.35 var(--ui); color: var(--ink-dim); }',

    /* Face modes. Analogue-only hides the digits but keeps the date line: a dial cannot say
       what day it is, so dropping the whole readout would lose information rather than tidy. */
    '.ck-clock[data-face="digital"] .ck-dial { display: none; }',
    '.ck-clock[data-face="analogue"] .ck-time { display: none; }',
    '.ck-clock[data-seconds="off"] .ck-hand-s { display: none; }',

    /* kit.css stretches settings fields to the cell; a stretched checkbox is a wide hit area
       with a glyph adrift in it, so this one control opts out. */
    '.ck-clock .ck-set input[type="checkbox"] { width: auto; justify-self: start; }',

    '.ck-clock .ck-cap { overflow-wrap: anywhere; }',
  ].join('\n');
}

/**
 * The browser script: ES5-shaped, self-invoking, and safe to have run before its card exists.
 *
 * @param id       the card's `data-card` value
 * @param defaults the settled settings this card was built with
 */
function script(id, defaults) {
  return `(function () {
  'use strict';

  var ID = ${jsJson(id)};
  var DEFAULTS = ${jsJson(defaults)};
  var FACES = { analogue: 1, digital: 1, both: 1 };

  /**
   * HTML-escape a value bound for innerHTML. A local copy of CK.esc so the caption cannot
   * become an injection point if the kit is ever loaded in a reduced form.
   *
   * @example esc('a<b');   // 'a&lt;b'
   */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function pad2(v) { return (v < 10 ? '0' : '') + v; }

  /**
   * Resolve a configured zone into something Intl will accept.
   *
   * Returns undefined for the viewer's own zone, because Intl reads an absent timeZone as
   * exactly that, and null when the name is not a zone at all so the caller can say so in the
   * caption instead of throwing on every frame.
   *
   * @example resolveZone('Asia/Tokyo');   // 'Asia/Tokyo'
   * @example resolveZone('Mars/Olympus'); // null
   */
  function resolveZone(tz) {
    if (!tz || tz === 'local') return undefined;
    try { new Intl.DateTimeFormat('en-US', { timeZone: String(tz) }); return String(tz); }
    catch (e) { return null; }
  }

  /** The zone's display name; for the viewer's own zone, ask Intl what that resolved to. */
  function zoneLabel(zone) {
    if (zone) return zone;
    try { return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'; }
    catch (e) { return 'local'; }
  }

  function partsMap(list) {
    var o = {}, i;
    for (i = 0; i < list.length; i++) o[list[i].type] = list[i].value;
    return o;
  }

  /**
   * A formatter that spells out the wall-clock fields in one zone.
   *
   * hourCycle h23 rather than hour12:false — the two cannot both be honoured, and hour12:false
   * still yields a 24:07 midnight under some locales, which would put the hour hand a full
   * turn wrong for an hour every night.
   */
  function wallFormatter(zone) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  /** The wall-clock fields in the formatter's zone, as numbers. */
  function wallParts(fmt, d) {
    var p = partsMap(fmt.formatToParts(d));
    return {
      year: Number(p.year), month: Number(p.month), day: Number(p.day),
      hour: Number(p.hour) % 24, minute: Number(p.minute), second: Number(p.second)
    };
  }

  /**
   * Minutes east of UTC for the formatter's zone at this instant.
   *
   * Derived from Intl, never from a table: the zone conversion is Intl's, and the offset is
   * only the arithmetic difference between the wall time it produced and the instant we asked
   * about. That means DST, historical shifts and half-hour zones are all somebody else's
   * correctly-maintained problem.
   *
   * timeZoneName 'longOffset' would say this directly but renders inconsistently across
   * engines (GMT+5:30 against GMT+05:30), and the caption wants one stable shape.
   *
   * @example offsetMinutes(wallFormatter('Asia/Kolkata'), new Date());   // 330
   */
  function offsetMinutes(fmt, d) {
    var w = wallParts(fmt, d);
    var wall = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
    return Math.round((wall - d.getTime()) / 60000);
  }

  /** 330 becomes 'UTC+05:30'; -420 becomes 'UTC-07:00'. */
  function offsetText(min) {
    var a = Math.abs(min);
    return 'UTC' + (min < 0 ? '-' : '+') + pad2(Math.floor(a / 60)) + ':' + pad2(a % 60);
  }

  CK.build(ID, function (sec) {

    var hourHand = sec.querySelector('.ck-hand-h'),
        minHand  = sec.querySelector('.ck-hand-m'),
        secHand  = sec.querySelector('.ck-hand-s'),
        outTime  = sec.querySelector('.ck-time'),
        outDate  = sec.querySelector('.ck-date'),
        cap      = sec.querySelector('.ck-cap');

    /* One mutable bag rather than a variable per derived value: every one of these is
       recomputed together whenever settings change, and splitting them invites the state
       where the formatter is new and the zone label is still the old one. */
    var st = {
      zone: undefined, bad: '', seconds: true, sweep: true,
      wall: null, time: null, date: null,
      lastTime: '', lastDate: '', lastCap: ''
    };

    var reduced = !!(window.matchMedia &&
                     window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    /* Held in the builder's own scope, cleared before each new one is made. A DOM swap re-runs
       this builder against a fresh section, and without the clear the detached card's timer
       would keep ticking beside the live one. */
    var beat = 0;

    function timeOptions(zone, cfg) {
      var o = { timeZone: zone, hour: 'numeric', minute: '2-digit' };
      if (st.seconds) o.second = '2-digit';
      if (cfg.hour12) o.hour12 = true; else o.hourCycle = 'h23';
      return o;
    }

    function turn(el, deg) {
      if (el) el.setAttribute('transform', 'rotate(' + (Math.round(deg * 100) / 100) + ' 50 50)');
    }

    /** Rebuild everything derived from settings, then draw once so the change is immediate. */
    function apply(cfg) {
      var z = resolveZone(cfg.tz);
      st.bad = z === null ? String(cfg.tz) : '';
      st.zone = z === null ? undefined : z;
      st.seconds = !!cfg.seconds;

      /* A sweeping second hand is animation; a jumping one is a readout. Under reduced motion
         the hand still moves each second, it just stops interpolating between them. */
      st.sweep = st.seconds && !reduced;

      st.wall = wallFormatter(st.zone);
      st.time = new Intl.DateTimeFormat(undefined, timeOptions(st.zone, cfg));
      st.date = new Intl.DateTimeFormat(undefined, {
        timeZone: st.zone, weekday: 'short', month: 'short', day: 'numeric'
      });

      sec.dataset.face = FACES[cfg.face] ? cfg.face : 'both';
      sec.dataset.seconds = st.seconds ? 'on' : 'off';

      st.lastTime = ''; st.lastDate = ''; st.lastCap = '';
      render();
    }

    /**
     * Draw the current instant. Called up to sixty times a second, so every write is guarded
     * by a comparison: setting textContent to the string it already holds still costs a style
     * recalculation, and three of those per frame is a card that warms a laptop.
     */
    function render() {
      if (!st.wall) return;
      var now = new Date();
      var w = wallParts(st.wall, now);

      var s = w.second + (st.sweep ? (now.getTime() % 1000) / 1000 : 0);
      var m = w.minute + s / 60;
      var h = (w.hour % 12) + m / 60;

      turn(hourHand, h * 30);
      turn(minHand, m * 6);
      if (st.seconds) turn(secHand, s * 6);

      var t = st.time.format(now);
      if (t !== st.lastTime) { st.lastTime = t; if (outTime) outTime.textContent = t; }

      var d = st.date.format(now);
      if (d !== st.lastDate) { st.lastDate = d; if (outDate) outDate.textContent = d; }

      var c = '<b>' + esc(zoneLabel(st.zone)) + '</b> ' +
              '<i>' + esc(offsetText(offsetMinutes(st.wall, now))) + '</i>';
      if (st.bad) {
        c += ' <span class="ck-aside">' + esc(st.bad) +
             ' is not a zone this browser knows, so this is your own</span>';
      }
      if (c !== st.lastCap) { st.lastCap = c; if (cap) cap.innerHTML = c; }
    }

    CK.settings(sec, DEFAULTS, apply);

    /* The hands come off the real clock every frame rather than off the elapsed time spin
       hands us, so one call draws the right picture. That matters: under reduced motion spin
       calls the frame exactly once and never again. */
    CK.spin(sec, function () { render(); });

    if (reduced) {
      /* Reduced motion asks for no animation, not for no clock. Spin has already drawn one
         correct frame; this steps it forward without interpolating anything. */
      clearInterval(beat);
      beat = setInterval(function () {
        if (!document.contains(sec)) { clearInterval(beat); beat = 0; return; }
        render();
      }, 1000);
    }
  });
})();`;
}

/**
 * Build one clock card.
 *
 * @param id    unique on the desk; becomes `data-card` and the settings storage key
 * @param title the card's heading
 * @param data  optional seed for any of the settings; unknown keys are ignored
 * @param ord   the card's position on the desk, carried through for the host to sort by
 * @returns `{ json, html, css, js }` — the descriptor, the markup, scoped CSS, a classic script
 *
 * @example
 * const card = build({ id: 'tokyo', title: 'Tokyo', data: { tz: 'Asia/Tokyo' }, ord: 2 });
 * card.json.settings.tz;   // 'Asia/Tokyo'
 *
 * @see meta
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'clock' : id);
  const heading = String(title == null ? 'Clock' : title);
  const cfg = settle(data);

  return {
    json: { id: cardId, type: meta.name, title: heading, ord: ord == null ? null : ord, settings: cfg },
    html: markup(cardId, heading, cfg, ord),
    css: styles(),
    js: script(cardId, cfg),
  };
}

export default { meta, build };
