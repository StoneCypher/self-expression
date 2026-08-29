(function () {
  'use strict';

  var ID = "candles";
  var DEFAULTS = {"bars":90,"ma":0,"logScale":false,"volume":true};
  var DATA = {"symbol":"ACME","currency":"USD","bars":[{"t":"2026-04-21","o":138.4,"h":142.53,"l":136.79,"c":140.43,"v":1970706},{"t":"2026-04-22","o":140.43,"h":142.18,"l":139.07,"c":140.65,"v":2593333},{"t":"2026-04-23","o":140.65,"h":141.69,"l":140.38,"c":141.63,"v":2985758},{"t":"2026-04-24","o":141.63,"h":144.84,"l":141.43,"c":143.7,"v":2846350},{"t":"2026-04-27","o":143.7,"h":146.16,"l":143.44,"c":145.66,"v":2759140},{"t":"2026-04-28","o":145.66,"h":147.31,"l":145.59,"c":146.89,"v":2927743},{"t":"2026-04-29","o":146.89,"h":151.09,"l":146.34,"c":149.1,"v":2162269},{"t":"2026-04-30","o":149.1,"h":152.24,"l":149.04,"c":150.97,"v":2600699},{"t":"2026-05-01","o":150.97,"h":151.34,"l":150.24,"c":150.99,"v":2487233},{"t":"2026-05-04","o":150.99,"h":154.06,"l":150.94,"c":153.41,"v":2520280},{"t":"2026-05-05","o":153.41,"h":153.64,"l":152.25,"c":153.18,"v":3249697},{"t":"2026-05-06","o":153.18,"h":156.54,"l":150.63,"c":155.5,"v":2047572},{"t":"2026-05-07","o":155.5,"h":157.15,"l":154.36,"c":156.46,"v":2335366},{"t":"2026-05-08","o":156.46,"h":158.9,"l":155.69,"c":157.85,"v":2893717},{"t":"2026-05-11","o":157.85,"h":160.66,"l":157.68,"c":160.3,"v":2864241},{"t":"2026-05-12","o":160.3,"h":161.4,"l":160.11,"c":160.72,"v":2747537},{"t":"2026-05-13","o":160.72,"h":162.38,"l":159.69,"c":162.32,"v":2030459},{"t":"2026-05-14","o":162.32,"h":164.01,"l":160.92,"c":162.53,"v":2449098},{"t":"2026-05-15","o":162.53,"h":165.51,"l":160.76,"c":163.73,"v":2730360},{"t":"2026-05-18","o":163.73,"h":165.21,"l":163.41,"c":165.12,"v":2078104},{"t":"2026-05-19","o":165.12,"h":168.37,"l":164.82,"c":167.03,"v":2416631},{"t":"2026-05-20","o":167.03,"h":171.01,"l":166.1,"c":169.67,"v":2796837},{"t":"2026-05-21","o":169.67,"h":172.7,"l":168.4,"c":172.37,"v":2015612},{"t":"2026-05-22","o":172.37,"h":172.62,"l":170.46,"c":171.87,"v":4293544},{"t":"2026-05-25","o":171.87,"h":174.39,"l":170.75,"c":173.11,"v":2047304},{"t":"2026-05-26","o":173.11,"h":175.85,"l":172.38,"c":175.13,"v":2878316},{"t":"2026-05-27","o":175.13,"h":176.49,"l":172.55,"c":174.13,"v":3702925},{"t":"2026-05-28","o":174.13,"h":175.98,"l":172.83,"c":174.67,"v":1980157},{"t":"2026-05-29","o":174.67,"h":174.8,"l":173.33,"c":173.81,"v":3514678},{"t":"2026-06-01","o":173.81,"h":175.38,"l":173.13,"c":173.89,"v":2148059},{"t":"2026-06-02","o":173.89,"h":175.79,"l":173.67,"c":173.9,"v":2286819},{"t":"2026-06-03","o":173.9,"h":175.8,"l":173.74,"c":175.15,"v":2590303},{"t":"2026-06-04","o":175.15,"h":176.82,"l":174.6,"c":175.97,"v":2324693},{"t":"2026-06-05","o":175.97,"h":177.61,"l":173.05,"c":175.31,"v":4062036},{"t":"2026-06-08","o":175.31,"h":175.8,"l":174.79,"c":175.5,"v":2249601},{"t":"2026-06-09","o":175.5,"h":177.25,"l":173.98,"c":175.89,"v":2133230},{"t":"2026-06-10","o":175.89,"h":179.77,"l":174.98,"c":177.9,"v":2602126},{"t":"2026-06-11","o":177.9,"h":180.23,"l":177.69,"c":177.93,"v":2268314},{"t":"2026-06-12","o":177.93,"h":178.4,"l":168.33,"c":171.91,"v":5485039},{"t":"2026-06-15","o":171.91,"h":175.19,"l":166.3,"c":169.92,"v":7298384},{"t":"2026-06-16","o":169.92,"h":170.97,"l":161.63,"c":163.78,"v":6974305},{"t":"2026-06-17","o":163.78,"h":167.3,"l":157.04,"c":159.05,"v":5794522},{"t":"2026-06-18","o":159.05,"h":161.98,"l":158.58,"c":160.04,"v":3604985},{"t":"2026-06-19","o":160.04,"h":165.03,"l":158.51,"c":160.37,"v":3545094},{"t":"2026-06-22","o":160.37,"h":160.73,"l":156.97,"c":157.45,"v":7260273},{"t":"2026-06-23","o":157.45,"h":158.45,"l":151.72,"c":155.25,"v":6845067},{"t":"2026-06-24","o":155.25,"h":158.06,"l":148.3,"c":149.68,"v":5082528},{"t":"2026-06-25","o":149.68,"h":153.22,"l":146.24,"c":150.74,"v":3602463},{"t":"2026-06-26","o":150.74,"h":152.41,"l":150.19,"c":151.66,"v":4372503},{"t":"2026-06-29","o":151.66,"h":154.28,"l":151.44,"c":153.61,"v":3303185},{"t":"2026-06-30","o":153.61,"h":153.77,"l":151.11,"c":152.44,"v":7201151},{"t":"2026-07-01","o":152.44,"h":154.4,"l":148.51,"c":150.41,"v":7189542},{"t":"2026-07-02","o":150.41,"h":151.5,"l":148.9,"c":149.23,"v":4356934},{"t":"2026-07-03","o":149.23,"h":150.58,"l":147.73,"c":148.63,"v":3304149},{"t":"2026-07-06","o":148.63,"h":151.04,"l":148.49,"c":150.49,"v":2363770},{"t":"2026-07-07","o":150.49,"h":152.22,"l":149.75,"c":151.3,"v":2348644},{"t":"2026-07-08","o":151.3,"h":153.35,"l":150.04,"c":152.64,"v":2376773},{"t":"2026-07-09","o":152.64,"h":154.97,"l":150.62,"c":154.03,"v":2295601},{"t":"2026-07-10","o":154.03,"h":157.83,"l":152.27,"c":156.56,"v":1923557},{"t":"2026-07-13","o":156.56,"h":156.7,"l":154.55,"c":156.05,"v":3605511},{"t":"2026-07-14","o":156.05,"h":160.22,"l":155.61,"c":158.43,"v":2254894},{"t":"2026-07-15","o":158.43,"h":160.69,"l":155.64,"c":156.91,"v":3380633},{"t":"2026-07-16","o":156.91,"h":157.79,"l":153.68,"c":155.59,"v":3990304},{"t":"2026-07-17","o":155.59,"h":156.94,"l":154.57,"c":156.32,"v":2338527},{"t":"2026-07-20","o":156.32,"h":157.48,"l":154.87,"c":157.45,"v":2358560},{"t":"2026-07-21","o":157.45,"h":161.03,"l":155.74,"c":159.31,"v":2499152},{"t":"2026-07-22","o":159.31,"h":161.15,"l":158.05,"c":159.12,"v":3943838},{"t":"2026-07-23","o":159.12,"h":162.52,"l":158.46,"c":160.93,"v":2600053},{"t":"2026-07-24","o":160.93,"h":162.01,"l":158.17,"c":159.25,"v":3988518},{"t":"2026-07-27","o":159.25,"h":159.42,"l":156.63,"c":158,"v":4135561},{"t":"2026-07-28","o":158,"h":159.22,"l":154.39,"c":156.37,"v":4130321},{"t":"2026-07-29","o":156.37,"h":159.08,"l":155.4,"c":158.27,"v":2971051},{"t":"2026-07-30","o":158.27,"h":160.62,"l":156.69,"c":160.32,"v":2936875},{"t":"2026-07-31","o":160.32,"h":161.12,"l":158.4,"c":158.5,"v":4553935},{"t":"2026-08-03","o":158.5,"h":162.72,"l":157.72,"c":160.44,"v":2284880},{"t":"2026-08-04","o":160.44,"h":161.95,"l":158.91,"c":161.85,"v":2866678},{"t":"2026-08-05","o":161.85,"h":164.94,"l":160.62,"c":162.95,"v":2449754},{"t":"2026-08-06","o":162.95,"h":167.2,"l":160.96,"c":165.32,"v":2489020},{"t":"2026-08-07","o":165.32,"h":165.43,"l":164.96,"c":165.26,"v":3176020},{"t":"2026-08-10","o":165.26,"h":167.62,"l":165.01,"c":166.71,"v":2949022},{"t":"2026-08-11","o":166.71,"h":169.17,"l":165.7,"c":168.27,"v":2224497},{"t":"2026-08-12","o":168.27,"h":170.59,"l":166.84,"c":169.78,"v":2872781},{"t":"2026-08-13","o":169.78,"h":174.01,"l":168.39,"c":172.09,"v":2790168},{"t":"2026-08-14","o":172.09,"h":174.75,"l":168.87,"c":172.28,"v":2884812},{"t":"2026-08-17","o":172.28,"h":175.46,"l":172.28,"c":174.05,"v":1996868},{"t":"2026-08-18","o":174.05,"h":178.54,"l":172.71,"c":175.52,"v":2146980},{"t":"2026-08-19","o":175.52,"h":179.3,"l":174.54,"c":177.4,"v":2311245},{"t":"2026-08-20","o":177.4,"h":179.55,"l":176.81,"c":178.24,"v":2784291},{"t":"2026-08-21","o":178.24,"h":180.32,"l":177.06,"c":179.29,"v":2533117},{"t":"2026-08-24","o":179.29,"h":180.39,"l":177.74,"c":178.42,"v":3114898}]};
  var K = {"CHW":5.42,"TXT":9,"W0":640,"H0":300,"WMAX":2400,"MINSLOT":4.5,"VOLFRAC":0.2,"GAP":10,"MAXBODY":26,"TIPMAX":400};

function ckN(v, what) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('cardkit/candles: non-finite coordinate from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

function ckTw(s) { return String(s).length * K.CHW; }

function ckClip(s, max) {
  var str = String(s);
  var room = Math.floor(max / K.CHW);
  return str.length <= room ? str : str.slice(0, Math.max(1, room - 1)) + '\u2026';
}

function ckSettle(cfg) {
  var c = cfg && typeof cfg === 'object' ? cfg : {};
  var ma = Math.floor(Number(c.ma));
  var bars = Math.floor(Number(c.bars));
  return {
    /* A window of 1 is the close line drawn on top of itself, so it counts as off. */
    ma: isFinite(ma) && ma > 1 ? Math.min(ma, 400) : 0,
    logScale: !!c.logScale,
    volume: c.volume == null ? true : !!c.volume,
    /* 0 or negative reads as "no limit"; the ceiling stops a bad feed from asking for a
       hundred thousand candles at a pixel and a half each. */
    bars: isFinite(bars) && bars > 0 ? Math.min(bars, 2000) : 0,
  };
}

function ckBars(data) {
  var d = data && typeof data === 'object' ? data : {};
  var src = Object.prototype.toString.call(d.bars) === '[object Array]' ? d.bars : [];
  var rows = [], badHL = 0, badNum = 0, i, b, o, h, l, c, v;

  for (i = 0; i < src.length; i++) {
    b = src[i];
    if (!b || typeof b !== 'object') { badNum++; continue; }
    o = Number(b.o); h = Number(b.h); l = Number(b.l); c = Number(b.c); v = Number(b.v);
    if (!isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) { badNum++; continue; }
    if (h < l) { badHL++; continue; }
    rows.push({
      t: b.t == null ? i + 1 : b.t,
      o: o, h: h, l: l, c: c,
      v: isFinite(v) && v > 0 ? v : 0,
    });
  }

  return {
    rows: rows,
    badHL: badHL,
    badNum: badNum,
    symbol: d.symbol == null ? '' : String(d.symbol),
    currency: d.currency == null ? '' : String(d.currency),
  };
}

function ckStamp(t, withYear) {
  var ms = null, d, y, m, day;

  if (typeof t === 'number' && isFinite(t)) {
    if (Math.abs(t) >= 1e11) ms = t;               // milliseconds
    else if (Math.abs(t) >= 1e8) ms = t * 1000;    // seconds
    else return String(t);                         // an index, a week number, a plain label
  } else if (typeof t === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return withYear ? t.slice(0, 10) : t.slice(5, 10);
    return t;
  } else {
    return String(t);
  }

  d = new Date(ms);
  if (isNaN(d.getTime())) return String(t);
  y = d.getUTCFullYear();
  m = d.getUTCMonth() + 1;
  day = d.getUTCDate();
  return (withYear ? y + '-' : '') + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

function ckSma(rows, w) {
  var out = [], sum = 0, i;
  for (i = 0; i < rows.length; i++) {
    sum += rows[i].c;
    if (i >= w) sum -= rows[i - w].c;
    out.push(i >= w - 1 ? sum / w : null);
  }
  return out;
}

function ckPad(lo, hi, frac) {
  var e;
  if (lo < hi) return [lo, hi];
  e = Math.abs(lo) * frac || 1;
  return [lo - e, hi + e];
}

function ckSnap(lo, hi, want) {
  var t = CK.ticks(lo, hi, want), step, nlo, nhi, ticks, k, v;
  if (t.length < 2) return { lo: lo, hi: hi, ticks: t };
  step = t[1] - t[0];
  if (!(step > 0)) return { lo: lo, hi: hi, ticks: t };
  nlo = Math.floor(lo / step) * step;
  nhi = Math.ceil(hi / step) * step;
  if (!(nhi > nlo)) return { lo: lo, hi: hi, ticks: t };

  ticks = [];
  for (k = 0; k < 400; k++) {
    v = nlo + k * step;
    if (v > nhi + step / 1e6) break;
    ticks.push(Math.round(v / step) * step);      // kill float drift at the tick
  }
  return { lo: nlo, hi: nhi, ticks: ticks };
}

function ckLogTicks(lo, hi) {
  var mant = [1, 2, 5], out = [], k, m, v, k0, k1, lin, i;
  k0 = Math.floor(Math.log(lo) / Math.LN10);
  k1 = Math.ceil(Math.log(hi) / Math.LN10);
  for (k = k0; k <= k1; k++) {
    for (m = 0; m < mant.length; m++) {
      v = mant[m] * Math.pow(10, k);
      if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v);
    }
  }
  if (out.length >= 3) return out;

  out = [];
  lin = CK.ticks(lo, hi, 5);
  for (i = 0; i < lin.length; i++) if (lin[i] > 0) out.push(lin[i]);
  return out.length ? out : [lo, hi];
}

function ckPrice(v, step) {
  var s = step > 0 ? step : Math.abs(v) / 100 || 1;
  var d = Math.max(0, Math.min(6, -Math.floor(Math.log(s) / Math.LN10)));
  return v.toFixed(d);
}

function ckLine(x1, y1, x2, y2, cls) {
  return '<line x1="' + ckN(x1, 'line') + '" y1="' + ckN(y1, 'line') +
         '" x2="' + ckN(x2, 'line') + '" y2="' + ckN(y2, 'line') + '" class="' + cls + '"/>';
}

function ckRect(x, y, w, h, cls) {
  return '<rect x="' + ckN(x, 'rect') + '" y="' + ckN(y, 'rect') +
         '" width="' + ckN(Math.max(0, w), 'rect') + '" height="' + ckN(Math.max(0, h), 'rect') +
         '" class="' + cls + '"/>';
}

function ckText(x, y, s, cls, anchor) {
  return '<text x="' + ckN(x, 'text') + '" y="' + ckN(y, 'text') + '" class="' + cls + '"' +
         (anchor ? ' text-anchor="' + anchor + '"' : '') + '>' + CK.esc(s) + '</text>';
}

function ckFrame(rows, logOk, volOn) {
  var F = { n: rows.length, logOk: logOk, volOn: volOn };
  var loP = Infinity, hiP = -Infinity, maxV = 0, i, b, lo, hi, p, sn, a, z, w, gap, innerH;

  for (i = 0; i < rows.length; i++) {
    b = rows[i];
    lo = Math.min(b.l, b.o, b.c);
    hi = Math.max(b.h, b.o, b.c);
    if (lo < loP) loP = lo;
    if (hi > hiP) hiP = hi;
    if (b.v > maxV) maxV = b.v;
  }
  /* An empty window is a legitimate state — a card seeded with no bars, or a feed that has not
     answered yet — and it gets a frame with nothing in it rather than an exception. */
  if (!isFinite(loP) || !isFinite(hiP)) { loP = 0; hiP = 1; }
  F.loP = loP; F.hiP = hiP; F.maxV = maxV;

  if (logOk) {
    a = Math.log(loP);
    z = Math.log(hiP);
    /* One price, or a run of identical ones: widen by 5% either side in price space, which is a
       constant distance in log space and therefore centres the flat line. */
    if (!(z > a)) { a = Math.log(loP * 0.95); z = Math.log(hiP * 1.05); }
    F.dlo = a; F.dhi = z;
    F.ticks = ckLogTicks(Math.exp(a), Math.exp(z));
  } else {
    p = ckPad(loP, hiP, 0.05);
    sn = ckSnap(p[0], p[1], 5);
    F.dlo = sn.lo; F.dhi = sn.hi; F.ticks = sn.ticks;
  }

  /* The label step is the smallest gap between adjacent ticks, which on a log axis is the gap at
     the bottom — the tightest one, and therefore the one that decides how many decimals the whole
     axis needs to stay distinguishable. */
  F.step = 0;
  for (i = 1; i < F.ticks.length; i++) {
    w = Math.abs(F.ticks[i] - F.ticks[i - 1]);
    if (w > 0 && (F.step === 0 || w < F.step)) F.step = w;
  }

  /* The quantum for a *quoted* price, as opposed to an axis label: about one part in two hundred
     of the visible range, which is roughly a pixel of the price lane. Fine enough that no two
     distinguishable prices print the same, coarse enough that a tooltip does not offer six
     decimals of a number that only ever moves in cents. */
  F.vstep = (F.hiP - F.loP) / 200;

  F.padT = 12;
  F.padB = 22;
  F.padL = 8;
  w = 0;
  for (i = 0; i < F.ticks.length; i++) w = Math.max(w, ckTw(ckPrice(F.ticks[i], F.step)));
  if (volOn && maxV > 0) w = Math.max(w, ckTw(CK.fmt(maxV)));
  F.padR = Math.round(Math.min(90, w)) + 12;

  F.W = K.W0;
  a = F.padL + F.padR + F.n * K.MINSLOT;
  if (a > K.W0) F.W = Math.min(K.WMAX, a);
  F.H = K.H0;

  innerH = F.H - F.padT - F.padB;
  gap = volOn ? K.GAP : 0;
  F.volH = volOn ? Math.round((innerH - gap) * K.VOLFRAC) : 0;
  F.priceY0 = F.padT;
  F.priceY1 = F.padT + (innerH - gap - F.volH);
  F.volY0 = F.priceY1 + gap;
  F.volY1 = F.padT + innerH;
  F.x0 = F.padL;
  F.x1 = F.W - F.padR;

  F.plotW = F.x1 - F.x0;
  F.slot = F.plotW / Math.max(1, F.n);
  F.body = Math.max(1, Math.min(K.MAXBODY, F.slot * 0.62));

  F.yPrice = CK.scale([F.dlo, F.dhi], [F.priceY1, F.priceY0]);
  F.yVol = CK.scale([0, maxV > 0 ? maxV : 1], [F.volY1, F.volY0]);

  /** Screen x of the centre of bar number i. */
  F.cx = function (i) { return F.x0 + (i + 0.5) * F.slot; };
  /** A price in whichever space the value axis is currently in. */
  F.space = function (v) { return logOk ? Math.log(v) : v; };

  return F;
}

function ckDrawGrid(F) {
  var out = [], i, t, y;

  for (i = 0; i < F.ticks.length; i++) {
    t = F.ticks[i];
    if (F.logOk && !(t > 0)) continue;
    y = F.yPrice(F.space(t));
    if (y < F.priceY0 - 0.5 || y > F.priceY1 + 0.5) continue;
    out.push(ckLine(F.x0, y, F.x1, y, 'ck-rule'));
    out.push(ckText(F.x1 + 5, y + 3.2, ckPrice(t, F.step), 'ck-tk', 'start'));
  }

  out.push(ckLine(F.x1, F.priceY0, F.x1, F.priceY1, 'ck-axis'));
  out.push(ckLine(F.x0, F.priceY1, F.x1, F.priceY1, 'ck-axis'));

  if (F.volOn) {
    out.push(ckLine(F.x0, F.volY1, F.x1, F.volY1, 'ck-axis'));
    out.push(ckText(F.x1 + 5, F.volY0 + 6.5, CK.fmt(F.maxV), 'ck-tk', 'start'));
  }

  return out.join('');
}

function ckDrawCandles(F, rows, withYear) {
  var out = [], i, b, cx, yH, yL, yO, yC, top, bot, mid, up, cls, tip;
  var tips = rows.length <= K.TIPMAX;

  for (i = 0; i < rows.length; i++) {
    b = rows[i];
    cx = F.cx(i);
    yH = F.yPrice(F.space(b.h));
    yL = F.yPrice(F.space(b.l));
    yO = F.yPrice(F.space(b.o));
    yC = F.yPrice(F.space(b.c));
    top = Math.min(yO, yC);
    bot = Math.max(yO, yC);

    /* A body thinner than a pixel is still a body. Growing it symmetrically about its own
       midpoint keeps it on the price it belongs to rather than nudging the bar up or down. */
    if (bot - top < 1) { mid = (top + bot) / 2; top = mid - 0.5; bot = mid + 0.5; }

    /* An unchanged bar counts as up, which is the convention: the body is hollow, and a reader
       who cares that it closed exactly flat has the tooltip. */
    up = b.c >= b.o;
    cls = up ? 'ck-up' : 'ck-dn';

    if (tips) {
      tip = ckStamp(b.t, withYear) +
            '  O ' + ckPrice(b.o, F.vstep) + '  H ' + ckPrice(b.h, F.vstep) +
            '  L ' + ckPrice(b.l, F.vstep) + '  C ' + ckPrice(b.c, F.vstep) +
            (b.v > 0 ? '  V ' + CK.fmt(b.v) : '');
      out.push('<g class="ck-cd ' + cls + '"><title>' + CK.esc(tip) + '</title>');
    } else {
      out.push('<g class="ck-cd ' + cls + '">');
    }

    /* Zero-length wicks are skipped rather than emitted: a line whose ends coincide draws a dot
       under a round linecap, and a row of stray dots along the body edge is noise. */
    if (top - yH > 0.4) out.push(ckLine(cx, yH, cx, top, 'ck-wick'));
    if (yL - bot > 0.4) out.push(ckLine(cx, bot, cx, yL, 'ck-wick'));
    out.push(ckRect(cx - F.body / 2, top, F.body, bot - top, 'ck-body'));
    out.push('</g>');
  }

  return out.join('');
}

function ckDrawVolume(F, rows) {
  var out = [], i, b, y, h, cls;
  if (!F.volOn) return '';

  for (i = 0; i < rows.length; i++) {
    b = rows[i];
    y = F.yVol(b.v);
    h = Math.max(1, F.volY1 - y);
    cls = 'ck-vol ' + (b.c >= b.o ? 'ck-up' : 'ck-dn');
    out.push(ckRect(F.cx(i) - F.body / 2, F.volY1 - h, F.body, h, cls));
  }
  return out.join('');
}

function ckDrawMa(F, ma) {
  var out = [], run = [], i, d, j;

  function flush() {
    if (run.length > 1) {
      d = [];
      for (j = 0; j < run.length; j++) d.push((j ? 'L' : 'M') + run[j][0] + ' ' + run[j][1]);
      out.push('<path class="ck-ma" d="' + d.join(' ') + '"/>');
    } else if (run.length === 1) {
      /* One defined point is drawn as a dot. A path with an M and no L renders as literally
         nothing, which is the most common way an overlay goes missing without an error. */
      out.push('<circle class="ck-ma-dot" cx="' + run[0][0] + '" cy="' + run[0][1] + '" r="1.8"/>');
    }
    run = [];
  }

  for (i = 0; i < ma.length; i++) {
    if (ma[i] == null) { flush(); continue; }
    run.push([ckN(F.cx(i), 'ma'), ckN(F.yPrice(F.space(ma[i])), 'ma')]);
  }
  flush();
  return out.join('');
}

function ckDrawTime(F, rows, withYear) {
  var out = [], labels = [], i, wide = 0, k, y, last, prev;
  if (!rows.length) return '';

  for (i = 0; i < rows.length; i++) {
    labels.push(ckStamp(rows[i].t, withYear));
    wide = Math.max(wide, ckTw(labels[i]));
  }
  k = Math.max(1, Math.ceil((wide + 10) / Math.max(0.01, F.slot)));
  y = F.H - 6;

  prev = -Infinity;
  for (i = 0; i < rows.length; i += k) {
    out.push(ckText(F.cx(i), y, ckClip(labels[i], Math.max(18, F.slot * k)), 'ck-tk', 'middle'));
    prev = F.cx(i);
  }

  last = rows.length - 1;
  if (last % k !== 0 && F.cx(last) - prev >= wide + 6) {
    out.push(ckText(F.cx(last), y, ckClip(labels[last], Math.max(18, F.slot * k)), 'ck-tk', 'middle'));
  }
  return out.join('');
}

function ckDescribe(F, read, rows, cfg, notes, withYear) {
  var sym = read.symbol, cur = read.currency;
  var n = rows.length, first, last, o, c, delta, pct, dir, aria, cap, bits = [];

  if (!n) {
    aria = 'Candlestick chart' + (sym ? ' of ' + sym : '') +
           ' with no bars: the axes are drawn but nothing is plotted.';
    cap = 'no bars to plot' + (sym ? ' for <b>' + CK.esc(sym) + '</b>' : '') +
          ' &mdash; <i>the frame is drawn so the card keeps its place</i>.';
    if (notes.badHL || notes.badNum) {
      cap += ' <b>' + (notes.badHL + notes.badNum) + '</b> bar' +
             (notes.badHL + notes.badNum === 1 ? ' was' : 's were') + ' refused as bad data.';
    }
    return { aria: aria, caption: cap };
  }

  first = ckStamp(rows[0].t, true);
  last = ckStamp(rows[n - 1].t, true);
  o = rows[0].o;
  c = rows[n - 1].c;
  delta = c - o;
  pct = o !== 0 ? (delta / Math.abs(o)) * 100 : null;
  dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  cur = cur ? ' ' + cur : '';

  aria = 'Candlestick chart' + (sym ? ' of ' + sym : '') + ': ' + n + ' bar' + (n === 1 ? '' : 's') +
    (n > 1 ? ' from ' + first + ' to ' + last : ' at ' + first) + '. ' +
    (dir === 'flat'
      ? 'It opened and closed at ' + ckPrice(o, F.vstep) + cur + ', unchanged'
      : 'It opened at ' + ckPrice(o, F.vstep) + ' and closed at ' + ckPrice(c, F.vstep) + cur +
        ', ' + dir + ' ' + ckPrice(Math.abs(delta), F.vstep) +
        (pct == null ? '' : ' or ' + CK.fmt(Math.abs(pct)) + ' percent')) + '. ' +
    'Prices ran between ' + ckPrice(F.loP, F.vstep) + ' and ' + ckPrice(F.hiP, F.vstep) + '. ' +
    'Bodies are hollow on days that closed up and filled on days that closed down. ' +
    (F.volOn ? 'A volume lane below shares the time axis; the busiest bar traded ' + CK.fmt(F.maxV) + '. ' : '') +
    (cfg.ma > 1 && notes.maDrawn ? 'A ' + cfg.ma + '-bar moving average is drawn over the prices. ' : '') +
    (F.logOk ? 'The price axis is logarithmic. ' : '');

  bits.push('<b>' + CK.esc(String(n)) + '</b> bar' + (n === 1 ? '' : 's') +
            (sym ? ' of <b>' + CK.esc(sym) + '</b>' : '') +
            (n > 1 ? ' &middot; ' + CK.esc(first) + ' to ' + CK.esc(last) : ' &middot; ' + CK.esc(first)));
  bits.push(dir === 'flat'
    ? '<i>closed exactly where it opened</i>, at ' + CK.esc(ckPrice(c, F.vstep) + cur)
    : 'close <b>' + CK.esc(ckPrice(c, F.vstep) + cur) + '</b> against an open of ' +
      CK.esc(ckPrice(o, F.vstep)) + ', ' + dir + ' ' + CK.esc(ckPrice(Math.abs(delta), F.vstep)) +
      (pct == null ? '' : ' (' + CK.esc(CK.fmt(Math.abs(pct))) + '%)'));

  if (notes.trimmed) {
    bits.push('<span class="ck-aside">showing the most recent ' + CK.esc(String(n)) +
              ' of ' + CK.esc(String(notes.total)) + '</span>');
  }
  if (notes.badHL) {
    bits.push('<b>' + CK.esc(String(notes.badHL)) + '</b> bar' + (notes.badHL === 1 ? '' : 's') +
              ' refused: <i>the high was below the low</i>, which is a broken quote rather than a shape');
  }
  if (notes.badNum) {
    bits.push('<b>' + CK.esc(String(notes.badNum)) + '</b> bar' + (notes.badNum === 1 ? '' : 's') +
              ' refused for a missing or non-numeric price');
  }
  if (notes.logFell) {
    bits.push('<i>log scale asked for but drawn linear</i> &mdash; a price of ' +
              CK.esc(ckPrice(F.loP, F.vstep)) + ' has no logarithm');
  }
  if (notes.volMissing) {
    bits.push('<span class="ck-aside">no volume in this data, so the lane is hidden</span>');
  }
  if (cfg.ma > 1 && !notes.maDrawn) {
    bits.push('<span class="ck-aside">a ' + CK.esc(String(cfg.ma)) +
              '-bar average needs more bars than are shown</span>');
  }

  return { aria: aria.trim(), caption: bits.join('. ') + '.' };
}

function ckPlan(data, cfg) {
  var c = ckSettle(cfg);
  var read = ckBars(data);
  var all = read.rows;
  var want = c.bars > 0 ? c.bars : all.length;
  var rows = all.length > want ? all.slice(all.length - want) : all;
  var notes = {
    badHL: read.badHL, badNum: read.badNum, total: all.length,
    trimmed: all.length > rows.length, logFell: false, volMissing: false, maDrawn: false,
  };
  var i, maxV = 0, minP = Infinity, logOk, volOn, F, ma, withYear, yr, note, svg;

  for (i = 0; i < rows.length; i++) {
    if (rows[i].v > maxV) maxV = rows[i].v;
    if (Math.min(rows[i].l, rows[i].o, rows[i].c) < minP) minP = Math.min(rows[i].l, rows[i].o, rows[i].c);
  }

  logOk = c.logScale && rows.length > 0 && minP > 0;
  notes.logFell = c.logScale && !logOk && rows.length > 0;

  volOn = c.volume && maxV > 0;
  notes.volMissing = c.volume && maxV <= 0 && rows.length > 0;

  F = ckFrame(rows, logOk, volOn);

  /* Spell the year out only when the window straddles more than one. On a three-month chart the
     year is the same four characters on every label, and four characters of nothing is the
     difference between labelling every bar and labelling every third. */
  withYear = false;
  yr = null;
  for (i = 0; i < rows.length; i++) {
    note = ckStamp(rows[i].t, true);
    if (!/^\d{4}-/.test(note)) { withYear = true; break; }
    if (yr === null) yr = note.slice(0, 4);
    else if (yr !== note.slice(0, 4)) { withYear = true; break; }
  }

  ma = c.ma > 1 && rows.length >= c.ma ? ckSma(rows, c.ma) : null;
  notes.maDrawn = !!ma;

  svg = ckDrawGrid(F) +
        ckDrawVolume(F, rows) +
        ckDrawCandles(F, rows, withYear) +
        (ma ? ckDrawMa(F, ma) : '') +
        ckDrawTime(F, rows, withYear);

  note = ckDescribe(F, read, rows, c, notes, withYear);

  return {
    w: ckN(F.W, 'view'), h: ckN(F.H, 'view'),
    svg: svg, aria: note.aria, caption: note.caption,
    volOn: volOn, maOn: notes.maDrawn,
  };
}

  CK.build(ID, function (sec) {

    var plot = sec.querySelector("svg.ck-plot");
    var cap = sec.querySelector(".ck-cap");
    if (!plot) { return; }

    /* Redraw from data plus settings. Every setting this card has changes the geometry, so
       there is nothing to patch in place: the honest move is to plan the picture again. It
       is a few hundred string concatenations, which is nothing next to the layout the
       browser then does anyway. */
    function apply(cfg) {
      var p;
      try {
        p = ckPlan(DATA, cfg);
      } catch (e) {
        /* A throw here means the geometry went non-finite, which is a bug in this card and
           not in the data. Say so where somebody will see it rather than leaving the last
           good drawing up and pretending it is current. */
        if (cap) { cap.textContent = "this chart could not be drawn: " + e.message; }
        return;
      }
      plot.setAttribute("viewBox", "0 0 " + p.w + " " + p.h);
      plot.setAttribute("aria-label", p.aria);
      plot.style.minWidth = p.w > K.W0 ? p.w + "px" : "";
      plot.innerHTML = p.svg;
      if (cap) { cap.innerHTML = p.caption; }
      sec.setAttribute("data-ma", p.maOn ? "on" : "off");
      sec.setAttribute("data-vol", p.volOn ? "on" : "off");
    }

    /* CK.settings wires the gear and the panel idempotently and calls back with the settled
       config immediately, so this one line is also the first redraw after a DOM swap. */
    CK.settings(sec, DEFAULTS, apply);
  });
})();
