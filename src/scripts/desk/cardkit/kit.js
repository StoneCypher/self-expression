/* cardkit — the runtime every card type shares.
 *
 * Classic script, not a module, and deliberately: it must be defined before any card's
 * builder runs, and the desk's builders are plain functions registered on `DESK.inits`.
 *
 * What lives here is the set of things I got wrong once per card while writing them by
 * hand. A swapped <main> re-runs every builder, so anything holding a timer, a listener or
 * an animation frame has to be safe to run twice; `spin` and `once` are the two places that
 * is handled, so a card type never has to remember it.
 */
window.CK = (function () {

  var SERIES = ['--ck-s1','--ck-s2','--ck-s3','--ck-s4','--ck-s5','--ck-s6','--ck-s7','--ck-s8'];

  /**
   * HTML-escape a value for interpolation into markup.
   *
   * Card data arrives from files, GitHub and the log; none of it is authored markup, so it
   * is escaped rather than trusted. A type that genuinely needs to emit markup builds it
   * from its own literals and escapes the data going into it.
   *
   * @example CK.esc('a<b & "c"');   // 'a&lt;b &amp; &quot;c&quot;'
   */
  function esc(s) {
    var raw = String(s == null ? '' : s), out = '', i, c;

    /* Control characters are dropped BEFORE the HTML escaping, not after.
       This used to escape only the five HTML metacharacters and pass NUL, BEL and ESC straight
       through — which is the evening's own failure arriving through the one door that escaping is
       supposed to cover. They are invisible, they are legal in an attribute, and a card that
       renders one has quietly put a byte on the page that nobody can see or delete.
       Compared numerically rather than matched against a character class, because writing the
       class is how the class gets corrupted. Tab, newline and carriage return survive: those are
       text. */
    for (i = 0; i < raw.length; i++) {
      c = raw.charCodeAt(i);
      if (c < 32 && c !== 9 && c !== 10 && c !== 13) continue;
      if (c === 127) continue;
      out += raw.charAt(i);
    }

    return out
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * One series colour, cycling. Index beyond the palette wraps rather than failing, so a
   * card with more members than colours degrades to repetition instead of to black.
   *
   * @example CK.hue(0);   // 'var(--ck-s1)'
   */
  function hue(i) { return 'var(' + SERIES[((i % SERIES.length) + SERIES.length) % SERIES.length] + ')'; }

  /**
   * An <svg> wrapper carrying the stroke defaults every drawn thing on the desk shares.
   *
   * `vector-effect` is deliberately not set: strokes should thin with the drawing, or a
   * small render becomes a bolder picture rather than a smaller one.
   *
   * @param inner  markup for the contents
   * @param opts   `{ box, cls, w, h }` — `box` defaults to a 24-unit square
   *
   * @example CK.svg('<path d="M4 4h16"/>', { cls: 'ck-icon' });
   */
  function svg(inner, opts) {
    var o = opts || {};
    return '<svg class="' + esc(o.cls || '') + '" viewBox="' + esc(o.box || '0 0 24 24') + '"' +
           (o.w ? ' width="' + esc(o.w) + '"' : '') + (o.h ? ' height="' + esc(o.h) + '"' : '') +
           ' fill="none" stroke="currentColor" stroke-width="' + esc(o.sw || 2) + '"' +
           ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }

  /**
   * A linear scale from a data domain to a pixel range.
   *
   * A zero-width domain maps everything to the range's midpoint rather than dividing by
   * zero — one data point is a legitimate chart and should draw, centred.
   *
   * @example CK.scale([0, 10], [0, 100])(5);   // 50
   */
  function scale(domain, range) {
    var d0 = domain[0], d1 = domain[1], r0 = range[0], r1 = range[1], span = d1 - d0;
    return function (v) { return span === 0 ? (r0 + r1) / 2 : r0 + (v - d0) / span * (r1 - r0); };
  }

  /**
   * Roughly `n` ticks on a nice step (1, 2, 5 × a power of ten) covering min..max.
   *
   * Ticks never run past `max`, so a domain whose top is not on the step stops below it — that is
   * the axis telling the truth about where the data ends rather than rounding the frame outwards.
   * A card that wants a tick ON the top must widen the domain first.
   *
   * The example here was wrong for a long time and was copied verbatim into eleven type modules,
   * which is how a wrong example does its real damage: it is read as a specification by the next
   * person, and nothing executes it.
   *
   * @example CK.ticks(0, 97, 5);    // [0, 20, 40, 60, 80]  — 100 is past max
   * @example CK.ticks(0, 100, 5);   // [0, 50, 100]
   */
  function ticks(min, max, n) {
    if (!(max > min)) return [min];
    var raw  = (max - min) / Math.max(1, n),
        mag  = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)),
        norm = raw / mag,
        step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag,
        out  = [];
    for (var v = Math.ceil(min / step) * step; v <= max + step / 1e6; v += step) {
      out.push(Math.round(v / step) * step);                 // kill float drift at the tick
    }
    return out;
  }

  /**
   * Compact number: 1_200 → '1.2k'. Keeps small numbers exact.
   *
   * A number that is not finite becomes an em dash, because there is no honest compact form of one.
   * It used to fall through the magnitude ladder, so `fmt(Infinity)` returned the string
   * `"Infinityb"` — `Math.abs(Infinity) >= 1e9`, and `(Infinity / 1e9).toFixed(1)` is `"Infinity"`
   * with a billions suffix stuck on the end. That nonsense went straight into card markup, where
   * `check.mjs` refuses any card containing `Infinity` or `NaN`, so one unguarded division
   * anywhere surfaced as a catalogue fault naming a token the author never wrote. Guarding at the
   * formatter means a card can only fail the check for a division it actually performed.
   *
   * @example CK.fmt(1200);       // '1.2k'
   * @example CK.fmt(0 / 0);      // '—'
   * @example CK.fmt(1 / 0);      // '—'
   */
  function fmt(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'b';
    if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'm';
    if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Math.round(n * 100) / 100);
  }

  /**
   * Run `fn` once per element, no matter how many times a builder re-runs.
   *
   * The desk re-runs every builder after a `<main>` swap. Anything that attaches a listener
   * or starts a timer would otherwise accumulate one copy per swap, and the symptom — a
   * click firing four times an hour into a session — is miserable to trace back.
   *
   * @example CK.once(el, 'wire', function () { el.addEventListener('click', go); });
   */
  function once(el, key, fn) {
    if (!el) return;
    var k = 'ck_' + key;
    if (el.dataset[k] === '1') return;
    el.dataset[k] = '1';
    fn();
  }

  /**
   * A rAF loop tied to one element's lifetime and visibility.
   *
   * Cancels any loop the same element already had, so a swap replaces rather than stacks.
   * Stops while the element is off screen or the document is hidden — a spinning molecule
   * on a desk left open all night should not hold a core awake — and never starts at all
   * under `prefers-reduced-motion`, where `frame` is called once so the card still draws.
   *
   * @param el    the element the animation belongs to
   * @param frame called with seconds elapsed since the loop started
   * @returns a stop function
   *
   * @example CK.spin(box, function (t) { draw(t * 0.3); });
   */
  function spin(el, frame) {
    if (!el) return function () {};
    if (el.__ckSpin) { cancelAnimationFrame(el.__ckSpin.raf); el.__ckSpin.dead = true; }

    var state = { raf: 0, dead: false, seen: true };
    el.__ckSpin = state;

    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) { frame(0); return function () { state.dead = true; }; }

    if (window.IntersectionObserver) {
      var io = new IntersectionObserver(function (rows) { state.seen = rows[0].isIntersecting; });
      io.observe(el);
    }

    var t0 = performance.now();
    (function step(now) {
      if (state.dead) return;
      if (state.seen && !document.hidden) frame((now - t0) / 1000);
      state.raf = requestAnimationFrame(step);
    })(t0);

    return function () { state.dead = true; cancelAnimationFrame(state.raf); };
  }

  /**
   * A repeating timer that survives a `<main>` swap without ever running twice.
   *
   * `once` cannot do this job and it is worth saying why, because the gap is invisible until
   * it bites: `once` keys off the ELEMENT, and a swap hands the builder a brand new element
   * with an empty dataset — so the guard passes, a second interval starts, and the old one is
   * still running against a detached node. The symptom is a card that fetches twice an hour,
   * then four times, then eight, and nothing in the code looks wrong.
   *
   * Keyed by name in a registry that outlives the DOM, so the swap replaces rather than
   * stacks. Found by the clock/weather build, which hit exactly this.
   *
   * @param name a stable key, conventionally the card's id plus the job
   * @param ms   the interval; the callback also fires once immediately
   * @param fn   the work
   * @returns a stop function
   *
   * @example CK.timer('weather:poll', 60000, refresh);
   */
  function timer(name, ms, fn) {
    window.__ckTimers = window.__ckTimers || {};
    clearInterval(window.__ckTimers[name]);
    fn();
    window.__ckTimers[name] = setInterval(fn, ms);
    return function () { clearInterval(window.__ckTimers[name]); };
  }

  /** The <section> a card lives in, by its `data-card` id. */
  function card(id) { return document.querySelector('section[data-card="' + id + '"]'); }

  /**
   * Register a builder that only runs when its card is actually on the desk.
   *
   * Every hand-written card opened with the same four lines of "find my node, bail if it is
   * missing"; a card that has been dismissed must not throw on the next swap.
   *
   * @example CK.build('flow', function (sec) { draw(sec.querySelector('svg')); });
   */
  function build(id, fn) {
    var run = function () {
      var sec = card(id);
      if (sec) { try { fn(sec); } catch (e) { console.error('card ' + id + ':', e); } }
    };
    /* John's desk hot-swaps `<main>` and replays this list; the other desk has no such
       registry. Registering where one exists and running directly where none does keeps a
       card type portable between the two without knowing which it landed on. */
    if (window.DESK && DESK.inits) DESK.inits.push(run);
    else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
  }

  /** The gear glyph, drawn rather than typed — an emoji ⚙ is a font lottery at 15px. */
  function gearIcon() {
    return svg('<circle cx="12" cy="12" r="3.2"/>' +
               '<path d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M5 12H2.6' +
               'M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6L17 17M7 7L5.4 5.4"/>',
               { sw: 1.8 });
  }

  /**
   * A card's own settings: persisted, per viewer, with a gear that opens them.
   *
   * Per viewer rather than on the server, and for the same reason the theme is: this desk is
   * open in a browser and in an editor at once, and a value shared between them means
   * setting it correctly for one sets it wrongly for the other. A clock's timezone and a
   * feed's refresh rate are properties of who is looking, not of the desk.
   *
   * Wiring is idempotent — `once` guards it — so a `<main>` swap cannot end up with two
   * listeners on the gear, which would toggle the panel twice and appear to do nothing.
   *
   * @param sec      the card's `<section>`
   * @param defaults every setting the card understands, with its fallback value
   * @param onChange called with the settled config now, and again after every edit
   * @returns `{ get, set }`
   *
   * @example
   * var cfg = CK.settings(sec, { tz: 'local', seconds: false }, redraw);
   * cfg.set({ seconds: true });
   */
  function settings(sec, defaults, onChange) {
    var key  = 'desk.card.' + (sec.dataset.card || 'anon'),
        gear = sec.querySelector('.ck-gear'),
        pane = sec.querySelector('.ck-set'),
        cur  = {};

    for (var k in defaults) if (Object.hasOwn(defaults, k)) cur[k] = defaults[k];
    try {
      var got = JSON.parse(localStorage.getItem(key) || '{}');
      for (var g in got) if (Object.hasOwn(defaults, g)) cur[g] = got[g];
    } catch (e) { /* private window, or a hand-edited value: defaults stand */ }

    function save() {
      try { localStorage.setItem(key, JSON.stringify(cur)); } catch (e) { /* no store */ }
      if (onChange) onChange(cur);
    }

    if (gear) {
      if (!gear.firstChild) gear.innerHTML = gearIcon();
      once(gear, 'gear', function () {
        gear.setAttribute('aria-expanded', 'false');
        gear.addEventListener('click', function () {
          var open = pane && pane.hidden;
          if (pane) pane.hidden = !open;
          gear.setAttribute('aria-expanded', String(!!open));
        });
      });
    }

    /* One delegated listener rather than one per field, so a card can add a control to its
       settings panel without also remembering to wire it. */
    if (pane) once(pane, 'set', function () {
      pane.addEventListener('change', function (ev) {
        var f = ev.target, name = f.name;
        if (!name || !Object.hasOwn(defaults, name)) return;
        if (f.type === 'checkbox') { cur[name] = f.checked; }
        else if (f.type === 'number') {
          /* `Number('')` is 0 and `Number('abc')` is NaN, and `JSON.stringify` writes NaN out as
             `null` — so an unparseable entry in a NUMBER field used to persist as null and come
             back as null, and every card was told to re-vet what it reads from storage while the
             kit was the thing putting the bad value in. A field that cannot be read falls back to
             the type's own default rather than storing a hole. */
          var num = Number(f.value);
          cur[name] = isFinite(num) ? num : defaults[name];
        }
        else { cur[name] = f.value; }
        save();
      });
    });

    /* Reflect the stored values onto the controls: the panel must open showing what is
       actually in force, not what the markup was written with. */
    if (pane) {
      var fields = pane.querySelectorAll('[name]');
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (!Object.hasOwn(cur, f.name)) continue;
        if (f.type === 'checkbox') f.checked = !!cur[f.name];
        else f.value = cur[f.name];
      }
    }

    if (onChange) onChange(cur);
    return {
      get: function () { return cur; },
      set: function (patch) {
        for (var p in patch) if (Object.hasOwn(defaults, p)) cur[p] = patch[p];
        save();
      },
    };
  }

  /**
   * Fetch a remote document through the desk's own server.
   *
   * The page's CSP is `connect-src 'self'`, so a card cannot reach the network directly —
   * which is the correct posture for a surface that renders text it did not write. The
   * server holds an allowlist of hosts and refuses everything else, so a card asking for a
   * feed is asking the desk, not the internet.
   *
   * @param url an absolute http(s) URL on the server's allowlist
   * @returns the response body as text
   * @throws {Error} when the host is not allowed or the fetch fails, with the reason
   *
   * @example
   * CK.net('https://api.open-meteo.com/v1/forecast?...').then(JSON.parse);
   */
  function net(url) {
    return fetch('/net?u=' + encodeURIComponent(url), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error(t || ('HTTP ' + r.status)); });
        return r.text();
      });
  }

  return { esc: esc, hue: hue, svg: svg, scale: scale, ticks: ticks, fmt: fmt,
           once: once, spin: spin, timer: timer, card: card, build: build,
           settings: settings, net: net, gearIcon: gearIcon, SERIES: SERIES };
})();
