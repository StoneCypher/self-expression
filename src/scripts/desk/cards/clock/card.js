(function () {
  'use strict';

  var ID = "clock";
  var DEFAULTS = {"tz":"Asia/Tokyo","seconds":true,"face":"both","hour12":false};
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
})();