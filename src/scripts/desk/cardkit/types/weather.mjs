/**
 * @file cardkit card type: `weather` — current conditions and an hourly temperature sparkline.
 *
 * Why this shape: a weather card is mostly failure handling. The interesting code is not the
 * fetch, it is what the card shows when the fetch does not come back — which is why the last
 * good reading is cached and re-rendered, visibly marked, rather than the card going blank and
 * the viewer being left to guess whether it is broken or just cold outside.
 *
 * Data comes from Open-Meteo, which needs no key and is on the desk server's allowlist. The
 * page cannot reach it directly — the CSP is connect-src 'self' — so every request goes through
 * `CK.net`, which proxies and returns text.
 *
 * The emitted script is ES5-shaped for the same reason the clock's is: it is injected as a
 * classic script into a preview surface with no transpile step.
 *
 * @see ../kit.js  — `CK.net`, `CK.once`, `CK.settings`, `CK.scale`, `CK.svg`
 * @see ../kit.css — `.ck-gear`, `.ck-set`, `.ck-cap`, `.ck-plot`, and the `--ck-*` tokens
 */

/**
 * Every setting the weather card understands, with the value it falls back to.
 *
 * `place` is free text handed to the geocoder, so "Seattle", "Seattle, WA" and "SeaTac" all
 * work and none of them is a coordinate the viewer had to look up. `units` is display-only —
 * see the note on `toUnit` in the emitted script for why the fetch is always metric. `hours` is
 * the sparkline's window ahead, one of the values in {@link SPANS}.
 */
const DEFAULTS = { place: 'Seattle', units: 'f', hours: 24 };

/** The hourly windows the sparkline offers. */
const SPANS = [12, 24, 48];

/**
 * What this card type is, for the desk's type picker and for tooling.
 *
 * `shape` is the one-line data literal a caller would write into a desk file; `defaults` is the
 * machine-readable half, every setting with its fallback, so a validator can check the settings
 * panel against it without building a card first.
 *
 * Like the clock, this card's `data` is a partial settings object and nothing else — the
 * readings are fetched, so the only thing a caller supplies is where and how to show them. The
 * meanings live on {@link DEFAULTS}.
 *
 * @example meta.name;   // 'weather'
 */
export const meta = {
  name: 'weather',
  summary: 'Current conditions for a named place, with an hourly temperature sparkline and a drawn sky glyph.',
  shape: '{ place, units, hours } — place free text for the geocoder, units "c" | "f", hours 12 | 24 | 48',
  defaults: { ...DEFAULTS },
};

/**
 * HTML-escape a build-time value. Mirrors `CK.esc` so markup produced here and markup produced
 * in the browser cannot disagree about what is safe.
 *
 * @example esc('Cote d\'Ivoire');   // 'Cote d&#39;Ivoire'
 */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * A JSON literal safe to paste into a classic `<script>` body.
 *
 * A place name containing `</script` would otherwise close the element early and spill the
 * rest of the card onto the page as text; the two line separators are newlines to a JS parser
 * but not to JSON, so they go too.
 *
 * @example jsJson({ place: '</script>' });   // '{"place":"\\u003c/script\\u003e"}'
 */
function jsJson(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * Fold caller-supplied `data` onto the defaults, rejecting anything the card cannot honour.
 *
 * Coercive rather than strict: a descriptor may be hand-edited, and a bad `units` should give
 * a working card in the default unit rather than an empty one.
 *
 * @param data partial settings; missing and null-valued keys keep their default
 *
 * @example settle({ units: 'K', hours: '48' });
 * // { place: 'Seattle', units: 'f', hours: 48 }
 */
function settle(data) {
  const out = { ...DEFAULTS };
  if (data && typeof data === 'object') {
    for (const k of Object.keys(DEFAULTS)) {
      if (Object.hasOwn(data, k) && data[k] != null) out[k] = data[k];
    }
  }
  out.place = String(out.place || '').trim() || DEFAULTS.place;
  out.units = out.units === 'c' ? 'c' : 'f';
  out.hours = SPANS.includes(Number(out.hours)) ? Number(out.hours) : DEFAULTS.hours;
  return out;
}

/** The `<option>` list for a `<select>`, with the seeded value pre-selected. */
function options(pairs, chosen) {
  return pairs
    .map(([value, label]) => '<option value="' + esc(value) + '"' +
      (String(value) === String(chosen) ? ' selected' : '') + '>' + esc(label) + '</option>')
    .join('');
}

/**
 * The card's markup: heading, gear, settings panel, conditions block, sparkline slot, caption.
 *
 * The gear button is emitted empty on purpose — `CK.settings` fills it with a drawn gear, and a
 * glyph typed here would be a second source of truth for a shape the kit already owns. The
 * conditions block ships with placeholder text rather than empty, so the card has a shape
 * before its first fetch resolves and does not jump when it does.
 */
function markup(id, title, cfg, ord) {
  const f = (name) => esc(id) + '-' + name;

  return '<section data-card="' + esc(id) + '" class="ck-weather" data-stale="0"' +
    (ord == null ? '' : ' data-ord="' + esc(ord) + '"') + '>' +
    '<h2>' + esc(title) + '</h2>' +
    '<button class="ck-gear" type="button" title="settings" aria-label="weather settings"></button>' +

    '<div class="ck-set" hidden>' +
      '<label for="' + f('place') + '">place</label>' +
      '<input id="' + f('place') + '" name="place" type="text" spellcheck="false"' +
        ' autocomplete="off" placeholder="city or town" value="' + esc(cfg.place) + '">' +

      '<label for="' + f('units') + '">units</label>' +
      '<select id="' + f('units') + '" name="units">' +
        options([['c', 'Celsius'], ['f', 'Fahrenheit']], cfg.units) +
      '</select>' +

      '<label for="' + f('hours') + '">outlook</label>' +
      '<select id="' + f('hours') + '" name="hours">' +
        options(SPANS.map((h) => [h, h + ' hours']), cfg.hours) +
      '</select>' +

      '<p class="ck-set-foot">Readings refresh at most once every ten minutes.</p>' +
    '</div>' +

    '<div class="ck-wx-now">' +
      '<div class="ck-wx-art" aria-hidden="true"></div>' +
      '<div class="ck-wx-read">' +
        '<div class="ck-wx-temp">--<span>&deg;</span></div>' +
        '<div class="ck-wx-desc">waiting for a reading</div>' +
        '<div class="ck-wx-meta"></div>' +
      '</div>' +
    '</div>' +

    '<div class="ck-wx-spark"></div>' +

    '<div class="ck-cap"></div>' +
  '</section>';
}

/**
 * Every rule scoped under `.ck-weather`.
 *
 * No literal colour appears: the desk is one document open in a browser and an editor that want
 * opposite themes, so a hex here would be wrong in exactly one of them. `prefers-color-scheme`
 * is likewise untouched — theme is a stamped `data-theme`, because the viewer's explicit choice
 * has to beat the operating system's.
 */
function styles() {
  return [
    '.ck-weather { position: relative; }',

    '.ck-weather .ck-wx-now { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }',

    '.ck-weather .ck-wx-art { flex: 0 0 auto; width: 50px; height: 50px; color: var(--accent); }',
    '.ck-weather .ck-wx-art svg { width: 50px; height: 50px; display: block; }',

    /* min-width:0 is what keeps a long place description from widening the flex item past the
       card and, through it, giving the page a horizontal scrollbar. */
    '.ck-weather .ck-wx-read { flex: 1 1 150px; min-width: 0; }',

    '.ck-weather .ck-wx-temp { font: 400 29px/1.05 var(--disp); color: var(--ink);' +
      ' font-variant-numeric: tabular-nums; }',
    '.ck-weather .ck-wx-temp span { font-size: 15px; color: var(--ink-dim); }',
    '.ck-weather .ck-wx-desc { margin-top: 3px; font: 400 12px/1.35 var(--ui);' +
      ' color: var(--ink-dim); overflow-wrap: anywhere; }',
    '.ck-weather .ck-wx-meta { margin-top: 3px; font-family: var(--mono); font-size: 10px;' +
      ' color: var(--ink-faint); }',

    '.ck-weather .ck-wx-spark { margin-top: 12px; }',
    '.ck-weather .ck-wx-spark svg { display: block; width: 100%; height: auto; }',
    '.ck-weather .ck-wx-line { fill: none; stroke: var(--accent); stroke-width: 1.6;' +
      ' stroke-linejoin: round; stroke-linecap: round; }',
    '.ck-weather .ck-wx-fill { fill: var(--accent); opacity: 0.1; stroke: none; }',
    '.ck-weather .ck-wx-wet { fill: var(--ck-s6); opacity: 0.38; stroke: none; }',
    '.ck-weather .ck-wx-dot { fill: var(--accent); stroke: var(--ground); stroke-width: 1.4; }',
    '.ck-weather .ck-wx-base { stroke: var(--hairline); stroke-width: 1; fill: none; }',

    /* Stale means "this is the last thing I knew, not what is happening". Dimming the readings
       while leaving the caption at full strength puts the explanation above the evidence. */
    '.ck-weather[data-stale="1"] .ck-wx-now,',
    '.ck-weather[data-stale="1"] .ck-wx-spark { opacity: 0.5; }',

    /* kit.css stretches settings fields to the cell; a stretched checkbox is a wide hit area
       with a glyph adrift in it, so any such control opts out. */
    '.ck-weather .ck-set input[type="checkbox"] { width: auto; justify-self: start; }',

    '.ck-weather .ck-cap { overflow-wrap: anywhere; }',
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

  /* The refresh floor. Open-Meteo updates on the order of a quarter-hour and asks callers to
     be polite; more to the point, a desk that sits open all day would otherwise spend the day
     re-asking for a number that did not change. Ten minutes is under the update interval, so
     nothing is missed for long, and far above the rate at which a viewer would notice. */
  var FLOOR_MS = 600000;

  /* The heartbeat is far shorter than the floor on purpose: it checks the age of the reading
     rather than blindly fetching, so a laptop that was shut for three hours catches up within
     a minute of waking instead of waiting out a full interval that started before the nap. */
  var BEAT_MS = 60000;

  var CACHE_KEY = 'desk.card.' + ID + '.wx';

  /* Module-scope, so a swapped section cannot leave a second timer or a second in-flight
     request behind. CK.once alone will not do this: it keys off the element, and a swap hands
     the builder a brand new element with a brand new dataset, so once would happily start a
     second timer. It still earns its place below as the guard against one element being wired
     twice; this pair is the guard against two elements each being wired once. */
  var timer = 0;
  var busy = false;
  var lastErr = '';

  /**
   * HTML-escape a value bound for innerHTML. A local copy of CK.esc: place names, country
   * names and the geocoder's own error text all reach the caption, and none of them is markup
   * this card wrote.
   *
   * @example esc('St. John<s');   // 'St. John&lt;s'
   */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** A finite number, or null. The API omits fields rather than nulling them when a model has no value. */
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  function spanOf(v) { var n = Number(v); return n === 12 || n === 48 ? n : 24; }
  function unitOf(v) { return v === 'c' ? 'c' : 'f'; }

  /**
   * Celsius to the display unit.
   *
   * Everything is fetched and cached in Celsius and converted only at paint time. That way
   * flipping the unit switch is instant and free — no request, and no bumping into the refresh
   * floor to see a number the card already had.
   *
   * @example toUnit(20, 'f');   // 68
   */
  function toUnit(c, u) { return u === 'f' ? c * 9 / 5 + 32 : c; }

  function tempText(c, u) { return c == null ? '--' : String(Math.round(toUnit(c, u))); }

  function sameSpot(a, b) {
    return String(a == null ? '' : a).trim().toLowerCase() ===
           String(b == null ? '' : b).trim().toLowerCase();
  }

  /** A rough age, for the caption: 'just now', '4 min', '2 hr'. */
  function ago(ms) {
    if (ms < 45000) return 'just now';
    var mins = Math.round(ms / 60000);
    if (mins < 90) return mins + ' min ago';
    return Math.round(mins / 60) + ' hr ago';
  }

  /**
   * WMO weather code to a glyph key and a plain description.
   *
   * Ranges rather than a table of ninety-nine entries: the codes are grouped by intensity
   * inside each family, so the family is the leading digits and the intensity is the tail.
   *
   * @example codeInfo(63);   // { key: 'rain', text: 'rain' }
   */
  function codeInfo(code) {
    var c = Number(code);
    if (c === 0) return { key: 'sun', text: 'clear' };
    if (c === 1) return { key: 'sun', text: 'mainly clear' };
    if (c === 2) return { key: 'partly', text: 'partly cloudy' };
    if (c === 3) return { key: 'cloud', text: 'overcast' };
    if (c === 45 || c === 48) return { key: 'fog', text: 'fog' };
    if (c >= 51 && c <= 57) return { key: 'rain', text: 'drizzle' };
    if (c >= 61 && c <= 67) return { key: 'rain', text: 'rain' };
    if (c >= 71 && c <= 77) return { key: 'snow', text: 'snow' };
    if (c >= 80 && c <= 82) return { key: 'rain', text: 'showers' };
    if (c === 85 || c === 86) return { key: 'snow', text: 'snow showers' };
    if (c >= 95 && c <= 99) return { key: 'storm', text: 'thunderstorms' };
    return { key: 'cloud', text: 'conditions unknown' };
  }

  /* Drawn rather than typed. An emoji sky is a font lottery — the same code point is a flat
     glyph on one machine and a full-colour cartoon on the next — and an icon font is a second
     network request the CSP would have to be widened for. These are paths, so they inherit
     the card's colour and thin correctly when the card is narrow. */
  var CLOUD = 'M6.8 18.4h10.4c2 0 3.6-1.6 3.6-3.5 0-1.9-1.5-3.4-3.4-3.5-.3-2.9-2.7-5.2-5.7-5.2' +
              '-2.6 0-4.8 1.7-5.5 4-2.1.3-3.8 2.1-3.8 4.2 0 2.2 1.8 4 4.4 4z';
  var CLOUD_UP = 'M6.8 15.6h10.4c2 0 3.6-1.5 3.6-3.4 0-1.8-1.5-3.3-3.4-3.4-.3-2.8-2.7-5-5.7-5' +
                 '-2.6 0-4.8 1.6-5.5 3.9-2.1.3-3.8 2-3.8 4 0 2.1 1.8 3.9 4.4 3.9z';

  var GLYPHS = {
    sun: '<circle cx="12" cy="12" r="4.6"/>' +
         '<path d="M12 2.2v2.6M12 19.2v2.6M21.8 12h-2.6M4.8 12H2.2' +
         'M18.9 5.1l-1.8 1.8M6.9 17.1l-1.8 1.8M18.9 18.9l-1.8-1.8M6.9 6.9L5.1 5.1"/>',
    partly: '<circle cx="8.4" cy="7.6" r="3"/>' +
            '<path d="M8.4 2.2v1.6M3 7.6h1.6M4.6 3.8l1.1 1.1M12.2 3.8l-1.1 1.1"/>' +
            '<path d="' + CLOUD + '"/>',
    cloud: '<path d="' + CLOUD + '"/>',
    rain: '<path d="' + CLOUD_UP + '"/>' +
          '<path d="M8.6 17.6L7.4 21M12.2 17.6L11 21M15.8 17.6L14.6 21"/>',
    snow: '<path d="' + CLOUD_UP + '"/>' +
          '<path d="M8 18.2v2.6M6.9 18.8l2.2 1.4M9.1 18.8l-2.2 1.4"/>' +
          '<path d="M15 18.2v2.6M13.9 18.8l2.2 1.4M16.1 18.8l-2.2 1.4"/>',
    fog: '<path d="' + CLOUD_UP + '"/>' +
         '<path d="M4.6 18.4h9.2M9.4 21.4h10"/>',
    storm: '<path d="' + CLOUD_UP + '"/>' +
           '<path d="M13.4 17.2h-3l1.4 2.6H9.4l4.6 3.4-1.4-2.8h2.2z"/>'
  };

  /** One sky glyph as SVG markup, sized for the card's art slot. */
  function glyph(key) {
    return CK.svg(GLYPHS[key] || GLYPHS.cloud, { w: 50, h: 50, sw: 1.5 });
  }

  function readCache() {
    try {
      var rec = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      return rec && rec.place && rec.rows ? rec : null;
    } catch (e) { return null; }
  }

  function writeCache(rec) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(rec)); } catch (e) { /* no store */ }
  }

  /**
   * Resolve free text to a coordinate.
   *
   * @throws {Error} when nothing matched, so the caller can name the place in the caption
   *   rather than showing a card that is merely blank.
   */
  function geocode(place) {
    var url = 'https://geocoding-api.open-meteo.com/v1/search?name=' +
              encodeURIComponent(place) + '&count=1';
    return CK.net(url).then(function (txt) {
      var body = JSON.parse(txt);
      var hit = body && body.results && body.results.length ? body.results[0] : null;
      if (!hit) throw new Error('no place matched that name');
      return {
        name: hit.name || place,
        admin: hit.admin1 || '',
        country: hit.country_code || hit.country || '',
        lat: hit.latitude,
        lon: hit.longitude
      };
    });
  }

  /* forecast_days=3 rather than the default: the 48-hour window has to start at the current
     hour, and the hourly series starts at local midnight, so up to 72 hours are needed to
     have 48 of them still ahead. */
  function forecast(spot) {
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + encodeURIComponent(spot.lat) +
              '&longitude=' + encodeURIComponent(spot.lon) +
              '&hourly=temperature_2m,precipitation_probability' +
              '&current=temperature_2m,weather_code,wind_speed_10m' +
              '&timezone=auto&forecast_days=3';
    return CK.net(url).then(function (txt) { return JSON.parse(txt); });
  }

  /**
   * Where "now" sits in the hourly series.
   *
   * timezone=auto puts current.time and the hourly stamps in the same local frame, so the
   * current hour is found by comparing the first thirteen characters of two strings. No zone
   * arithmetic happens here at all, which is the point: the one place this card could get
   * daylight saving wrong is the place it refuses to do the work.
   *
   * @example indexOfNow(['2026-08-29T00:00','2026-08-29T01:00'], '2026-08-29T01:14');   // 1
   */
  function indexOfNow(times, currentTime) {
    var stamp = String(currentTime == null ? '' : currentTime).slice(0, 13);
    var i;
    for (i = 0; i < times.length; i++) {
      if (String(times[i]).slice(0, 13) === stamp) return i;
    }
    return 0;
  }

  /** Fold the two responses into the one small record that gets cached and painted. */
  function pack(place, spot, body) {
    var cur = body && body.current ? body.current : {};
    var hourly = body && body.hourly ? body.hourly : {};
    var times = hourly.time || [];
    var temps = hourly.temperature_2m || [];
    var wets = hourly.precipitation_probability || [];

    var start = indexOfNow(times, cur.time);
    var rows = [], i;
    for (i = start; i < times.length && rows.length < 49; i++) {
      rows.push({ t: String(times[i]), c: num(temps[i]), p: num(wets[i]) });
    }

    return {
      at: Date.now(),
      place: place,
      geo: spot,
      cur: {
        c: num(cur.temperature_2m),
        code: Number(cur.weather_code),
        wind: num(cur.wind_speed_10m)
      },
      rows: rows
    };
  }

  CK.build(ID, function (sec) {

    var art  = sec.querySelector('.ck-wx-art'),
        temp = sec.querySelector('.ck-wx-temp'),
        desc = sec.querySelector('.ck-wx-desc'),
        meta = sec.querySelector('.ck-wx-meta'),
        wrap = sec.querySelector('.ck-wx-spark'),
        cap  = sec.querySelector('.ck-cap');

    var live = { place: DEFAULTS.place, units: DEFAULTS.units, hours: DEFAULTS.hours };
    var shown = null;

    /**
     * The hourly sparkline: precipitation probability as a band of bars along the bottom, the
     * temperature as a line above it, and a dot on the current hour.
     *
     * The svg is width:100% with a viewBox, so a narrow card scales it rather than clipping —
     * nothing here can push the page sideways.
     */
    function spark(rows, unit) {
      if (!wrap) return;

      var pts = [], i;
      for (i = 0; i < rows.length; i++) {
        if (rows[i] && rows[i].c != null) {
          pts.push({ at: i, v: toUnit(rows[i].c, unit), p: rows[i].p, t: rows[i].t });
        }
      }
      if (pts.length < 2) { wrap.innerHTML = ''; return; }

      var W = 240, H = 66, top = 13, base = 44, wetTop = 47, wetFoot = 55;
      var lo = pts[0].v, hi = pts[0].v, loAt = 0, hiAt = 0;
      for (i = 1; i < pts.length; i++) {
        if (pts[i].v < lo) { lo = pts[i].v; loAt = i; }
        if (pts[i].v > hi) { hi = pts[i].v; hiAt = i; }
      }

      /* A flat day is a legitimate day. CK.scale maps a zero-width domain to the middle of the
         range, so the line draws level instead of dividing by zero or vanishing. */
      var x = CK.scale([0, rows.length - 1], [3, W - 3]);
      var y = CK.scale([lo, hi], [base, top]);

      var barW = Math.max(1, (W - 6) / rows.length * 0.66);
      var out = [];

      for (i = 0; i < pts.length; i++) {
        var p = pts[i].p;
        if (p == null || p <= 0) continue;
        var h = (wetFoot - wetTop) * Math.min(100, p) / 100;
        out.push('<rect class="ck-wx-wet" x="' + r2(x(pts[i].at) - barW / 2) + '" y="' +
                 r2(wetFoot - h) + '" width="' + r2(barW) + '" height="' + r2(h) + '"/>');
      }

      var line = [], area = [];
      for (i = 0; i < pts.length; i++) {
        line.push(r2(x(pts[i].at)) + ',' + r2(y(pts[i].v)));
      }
      area.push('M' + r2(x(pts[0].at)) + ' ' + base);
      for (i = 0; i < pts.length; i++) area.push('L' + r2(x(pts[i].at)) + ' ' + r2(y(pts[i].v)));
      area.push('L' + r2(x(pts[pts.length - 1].at)) + ' ' + base + 'Z');

      out.push('<path class="ck-wx-fill" d="' + area.join('') + '"/>');
      out.push('<polyline class="ck-wx-line" points="' + line.join(' ') + '"/>');
      out.push('<line class="ck-wx-base" x1="3" y1="' + base + '" x2="' + (W - 3) +
               '" y2="' + base + '"/>');
      out.push('<circle class="ck-wx-dot" cx="' + r2(x(pts[0].at)) + '" cy="' +
               r2(y(pts[0].v)) + '" r="2.6"/>');

      out.push(label(x(pts[hiAt].at), y(hi) - 4.5, Math.round(hi) + '\u00b0', W));
      if (hiAt !== loAt) out.push(label(x(pts[loAt].at), y(lo) + 9, Math.round(lo) + '\u00b0', W));

      /* Hour labels every six hours. Fewer than that and the sparkline is decorative; more and
         they collide on a narrow card, where the viewBox has already scaled the type down. */
      for (i = 0; i < pts.length; i += 6) {
        var hh = String(pts[i].t).slice(11, 13);
        if (hh) out.push(label(x(pts[i].at), H - 3, hh, W));
      }

      wrap.innerHTML = '<svg class="ck-plot" viewBox="0 0 ' + W + ' ' + H +
        '" role="img" aria-label="hourly temperature and chance of precipitation">' +
        out.join('') + '</svg>';
    }

    /** A plot label, nudged inward at the edges so it cannot hang outside the viewBox. */
    function label(cx, cy, text, W) {
      var anchor = cx < 16 ? 'start' : cx > W - 16 ? 'end' : 'middle';
      var px = cx < 16 ? 3 : cx > W - 16 ? W - 3 : cx;
      return '<text x="' + r2(px) + '" y="' + r2(cy) + '" text-anchor="' + anchor + '">' +
             esc(text) + '</text>';
    }

    function r2(v) { return Math.round(v * 100) / 100; }

    /** Draw a record. A stale flag says the network did not answer and this is the last good one. */
    function paint(rec, stale) {
      shown = rec;
      var unit = unitOf(live.units), span = spanOf(live.hours);
      var info = codeInfo(rec.cur ? rec.cur.code : -1);

      if (art) art.innerHTML = glyph(info.key);
      if (temp) {
        temp.innerHTML = esc(tempText(rec.cur ? rec.cur.c : null, unit)) +
                         '<span>\u00b0' + esc(unit.toUpperCase()) + '</span>';
      }
      if (desc) desc.textContent = info.text;
      if (meta) {
        meta.textContent = rec.cur && rec.cur.wind != null
          ? 'wind ' + Math.round(rec.cur.wind) + ' km/h'
          : '';
      }

      spark(rec.rows.slice(0, span), unit);
      sec.dataset.stale = stale ? '1' : '0';

      var where = rec.geo.name +
        (rec.geo.admin ? ', ' + rec.geo.admin : '') +
        (rec.geo.country ? ' (' + rec.geo.country + ')' : '');

      var text = '<b>' + esc(where) + '</b> <i>' + esc(span + 'h outlook') + '</i>';
      if (stale) {
        text += ' <span class="ck-aside">stale: last good reading ' +
                esc(ago(Date.now() - rec.at)) + ', and the refresh failed';
        if (lastErr) text += ' with ' + esc(lastErr);
        text += '</span>';
      } else {
        text += ' <span class="ck-aside">updated ' + esc(ago(Date.now() - rec.at)) + '</span>';
      }
      if (cap) cap.innerHTML = text;
    }

    /** No data at all. Say what went wrong in the caption rather than leaving an empty card. */
    function note(headline, detail) {
      sec.dataset.stale = '0';
      if (desc) desc.textContent = headline;
      if (cap) {
        cap.innerHTML = '<b>no reading</b> <span class="ck-aside">' +
                        esc(detail || headline) + '</span>';
      }
    }

    /**
     * Fetch, cache and paint. A forced call skips the age check, which a changed place needs:
     * the floor exists to stop pointless re-asking for the same spot, not to make someone wait
     * ten minutes to see the city they just typed.
     */
    function load(force) {
      if (busy) return;
      var place = String(live.place || '').trim();
      if (!place) { note('no place set', 'open the gear and name a place'); return; }

      var cached = readCache();
      var fresh = cached && sameSpot(cached.place, place) &&
                  (Date.now() - cached.at) < FLOOR_MS;
      if (fresh && !force) { paint(cached, false); return; }

      /* A place's coordinates do not move, so a cached geocode for the same name is reused and
         the request count per refresh halves. */
      var known = cached && cached.geo && sameSpot(cached.place, place) ? cached.geo : null;

      busy = true;
      var step = known ? Promise.resolve(known) : geocode(place);

      step.then(function (spot) {
        return forecast(spot).then(function (body) {
          var rec = pack(place, spot, body);
          if (!rec.rows.length) throw new Error('the forecast came back with no hours in it');
          writeCache(rec);
          lastErr = '';
          busy = false;
          paint(rec, false);
        });
      }).catch(function (err) {
        busy = false;
        lastErr = err && err.message ? err.message : String(err);
        var back = readCache();
        if (back && sameSpot(back.place, place)) paint(back, true);
        else note('could not reach the forecast', place + ': ' + lastErr);
      });
    }

    /** Settings changed. Only a new place costs a request; units and window repaint what we have. */
    function apply(cfg) {
      var placeChanged = !sameSpot(cfg.place, live.place);
      live.place = String(cfg.place == null ? '' : cfg.place);
      live.units = unitOf(cfg.units);
      live.hours = spanOf(cfg.hours);

      if (placeChanged || !shown) load(placeChanged);
      else paint(shown, sec.dataset.stale === '1');
    }

    CK.settings(sec, DEFAULTS, apply);

    /* Show the cache before the network is asked, so a reload during an outage has something on
       screen immediately instead of a placeholder that may never resolve. */
    if (!shown) {
      var seeded = readCache();
      if (seeded && sameSpot(seeded.place, live.place)) {
        paint(seeded, (Date.now() - seeded.at) >= FLOOR_MS);
      }
    }

    CK.once(sec, 'wxbeat', function () {
      /* Clearing first is what actually prevents a doubled timer across a DOM swap; once only
         prevents this element being wired twice. Both cases are real, so both are handled. */
      clearInterval(timer);
      timer = setInterval(function () {
        if (!document.contains(sec)) { clearInterval(timer); timer = 0; return; }
        var rec = readCache();
        if (!rec || !sameSpot(rec.place, live.place) || (Date.now() - rec.at) >= FLOOR_MS) load(false);
      }, BEAT_MS);
    });
  });
})();`;
}

/**
 * Build one weather card.
 *
 * @param id    unique on the desk; becomes `data-card`, the settings key and the cache key
 * @param title the card's heading
 * @param data  optional seed for any of the settings; unknown keys are ignored
 * @param ord   the card's position on the desk, carried through for the host to sort by
 * @returns `{ json, html, css, js }` — the descriptor, the markup, scoped CSS, a classic script
 *
 * @example
 * const card = build({ id: 'lisbon', title: 'Lisbon', data: { place: 'Lisbon', units: 'c' } });
 * card.json.settings.units;   // 'c'
 *
 * @see meta
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'weather' : id);
  const heading = String(title == null ? 'Weather' : title);
  const cfg = settle(data);

  return {
    json: { id: cardId, type: meta.name, title: heading, ord: ord == null ? null : ord, settings: cfg },
    html: markup(cardId, heading, cfg, ord),
    css: styles(),
    js: script(cardId, cfg),
  };
}

export default { meta, build };
