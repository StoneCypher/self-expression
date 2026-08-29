/* The whole tracker as one incidence matrix, drawn by hand: the CSP will not load a
   charting library, and a binary matrix is a grid of squares.

   Thirty-six issues is small enough that nothing has to be aggregated. Every column is one
   real issue with its number on it and every cell is a fact rather than a rate — which is
   the thing a 1010-issue tracker can never give you, because there the only readable
   picture is a summary and a summary is where the individual case goes to disappear.

   Neither axis has a pre-existing order worth keeping. There are no milestones here at all
   — zero of thirty-six — and issue number is arrival order, not structure. So unlike a
   release-train matrix both sides are free, and the sweep is the real two-sided one:
   labels to the mean position of the issues carrying them, issues to the mean position of
   their labels, until neither moves.

   What comes out is the finding. Four ordinal scales live in the label set — size, effort,
   difficulty, priority — and nothing tells the sweep they are scales. All four land in
   their own order anyway, so the axis the matrix discovered is cost. Those rows are the
   accented ones; read them as a ladder. All 36 issues, open and closed, as of 2026-08-29. */
DESK.inits.push(function () {
  var svg = document.getElementById('tracker-m');
  if (!svg) return;

  /* [number, open?] in issue-number order — which is to say unsorted for our purposes. */
  var ISS = [[7,0],[8,0],[9,0],[10,0],[11,0],[12,0],[13,0],[14,0],[15,0],[16,0],[17,0],
             [18,0],[19,0],[20,0],[22,0],[23,0],[24,0],[25,0],[26,0],[27,0],[28,0],[29,0],
             [30,0],[31,0],[40,0],[41,0],[42,0],[43,0],[44,1],[45,0],[56,1],[75,1],[76,0],
             [78,1],[79,1],[83,1]];

  var TITLES = ["Render logged history as a PNG for visual review","stop-check.mjs prints unexpanded ${CLAUDE_PLUGIN_ROOT…","delta vocabulary drift: 164 of 1380 rows are non-cano…","MCP-ify the loggers instead of Bash plus scratch files","Open signatures are unenforced and drop ~46% of the t…","Divergence reporting already happens but has no column","Add a dissent channel for below-threshold reservations","Confidence marking, but only if joined to outcomes","Add an instruction-conflict channel","Retraction should mark the original, not just log the…","Modality: mark what kind of utterance something is","Anchoring: commentary bound to a location instead of …","Diagrams as a distinct mechanic from charts","Treat compression as the mechanic, not lists","Capture turn metadata from hooks and MCP instead of s…","Use prompt_id to replace the freshness time windows","Version-stamp every row: schema, plugin, format, model","Schema: one entries table, channel column, fresh data…","Implement the visuals vocabulary as renderers, not pr…","Checklist series key should be a stable id, not the t…","Recover the SKILL.md v1-v18 format history before it …","Two ambient-time hooks now exist; reconcile them","Configuration surface: keys, precedence, and the two …","Public aggregation carries structured fields only, ne…","Onboarding: ask the user their preferences at first r…","Addressivity: audience-tagged expression (messagebox-…","Channel extensions: forecast ground, faded kind, sali…","Self-initiated speech: choosing when to talk — valuab…","Voluntary audio expression (claudio successor) — own …","The dwelling: a per-assistant keepsake database — ena…","Release job fails with 'tag_name already exists' on e…","A standing webserver and docked browser: a persistent…","Per-channel text length, user-configurable, defaults …","Image generation behind a user-supplied credential; c…","Someday: a 4X played on the OKLab colour solid","Small VS Code extension to open a desk in an editor t…"];

  /* One bitstring per label, aligned to ISS. Labels used exactly once are left out: a row
     holding a single square cannot participate in a seriation and only adds height. */
  var LABS = [
    ['created by ai',         '111111111111111111111111111111011110'],
    ['enhancement',           '100111111111111111100011111111011100'],
    ['needs spec',            '000001111110010011010011011001010100'],
    ['closed by ai',          '011001111010001111001000000000000000'],
    ['priority medium',       '000011101010110000110110000000001000'],
    ['big picture',           '000100000000010011001011000101010010'],
    ['important for trust',   '000001111110001011100001000000000000'],
    ['effort 2/5',            '100001111010001001000011000000000000'],
    ['size small',            '100011111010000100001000000000001000'],
    ['mcp',                   '000100000000001101100010000000011100'],
    ['difficulty easy',       '010010000000000110011100000000001000'],
    ['priority high',         '010100000000001111001001000000000000'],
    ['needs research',        '100000000101100000001000000110000010'],
    ['difficulty medium',     '000100000000001001100011000000000100'],
    ['size medium',           '000100000000011001000011000000000100'],
    ['effort 1/5',            '000010000000000110011100000000000000'],
    ['llm',                   '100001111000001000000000000000000000'],
    ['ease of use',           '000000000011010000000010000000001000'],
    ['priority low',          '100000010101000000000000000000000010'],
    ['needs implementation',  '000110000000001100100000000000000000'],
    ['size large',            '000000000101100000100000000000010000'],
    ['visualizations',        '100000000000100000100000000000010010'],
    ['bug',                   '011000000000000000010100000000000000'],
    ['claude as a platform',  '000110000000000000000100000000010000'],
    ['agents',                '000100100000001000000000000000000000'],
    ['difficulty difficult',  '000000000101000000000000000000010000'],
    ['effort 3/5',            '000100000000010000100000000000000000'],
    ['effort 4/5',            '000000000101100000000000000000000000'],
    ['size tiny',             '000000000000000010010100000000000000'],
    ['cleanup',               '000000000000000100000100000000000000'],
    ['privacy',               '000000000000000000000001000000000100'],
    ['rendering compatibility','100000000000100000000000000000000000'],
    ['security',              '000000000000000000000001000000000100']
  ];

  var NR = LABS.length, NC = ISS.length,
      W = 900, GUT = 152, CW = 19, RP = 15, HEAD = 30, TOP = HEAD + 6, SIDE = 11,
      RIGHT = GUT + NC * CW, BOT = TOP + NR * RP, LEGY = BOT + 18, H = LEGY + 17,
      n = function (x) { return Math.round(x * 10) / 10; };

  var M = LABS.map(function (l) {
    return l[1].split('').map(function (c) { return c === '1' ? 1 : 0; });
  });

  /** The four scales, spotted by name so the ladder can be accented — never by the sweep. */
  var isScale = function (name) { return /^(size|effort|difficulty|priority) /.test(name); };

  /**
   * Two-sided barycentre sweep. Rows move to the mean position of the columns they touch,
   * columns to the mean position of the rows that touch them, alternately, until a pass
   * changes nothing. An empty row or column has no mean and is parked in the middle rather
   * than at an end, where it would masquerade as an extreme.
   */
  function sweep(ro, co) {
    for (var p = 0; p < 60; p++) {
      var cpos = {}, rpos = {};
      co.forEach(function (c, k) { cpos[c] = k; });
      var rb = {};
      ro.forEach(function (r) {
        var s = 0, w = 0;
        co.forEach(function (c) { if (M[r][c]) { s += cpos[c]; w++; } });
        rb[r] = w ? s / w : NC / 2;
      });
      var ro2 = ro.slice().sort(function (a, b) { return rb[a] - rb[b]; });
      ro2.forEach(function (r, k) { rpos[r] = k; });
      var cb = {};
      co.forEach(function (c) {
        var s = 0, w = 0;
        ro2.forEach(function (r) { if (M[r][c]) { s += rpos[r]; w++; } });
        cb[c] = w ? s / w : NR / 2;
      });
      var co2 = co.slice().sort(function (a, b) { return cb[a] - cb[b]; });
      var done = ro2.join() === ro.join() && co2.join() === co.join();
      ro = ro2; co = co2;
      if (done) break;
    }
    return [ro, co];
  }

  var swept = sweep(LABS.map(function (_, i) { return i; }), ISS.map(function (_, i) { return i; })),
      rows = swept[0], cols = swept[1];

  var cx = function (k) { return GUT + k * CW + CW / 2; },
      cy = function (k) { return TOP + k * RP + RP / 2; },
      esc = function (t) { return String(t).replace(/[&<>]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); };

  var parts = [];

  for (var r = 0; r < NR; r += 2) {
    parts.push('<rect class="band" x="' + GUT + '" y="' + n(TOP + r * RP) +
               '" width="' + (NC * CW) + '" height="' + RP + '"/>');
  }

  /* Open issues get a column wash rather than a marker. Where the still-open work sits is
     the second thing this picture says, and a wash says it without being read for. */
  cols.forEach(function (ci, k) {
    if (!ISS[ci][1]) return;
    parts.push('<rect class="open" x="' + n(cx(k) - CW / 2) + '" y="' + (TOP - HEAD + 4) +
               '" width="' + CW + '" height="' + n(BOT - TOP + HEAD - 4) + '"/>');
  });

  rows.forEach(function (ri, rk) {
    cols.forEach(function (ci, ck) {
      if (!M[ri][ci]) return;
      parts.push('<rect class="cell" x="' + n(cx(ck) - SIDE / 2) + '" y="' + n(cy(rk) - SIDE / 2) +
                 '" width="' + SIDE + '" height="' + SIDE + '"><title>' +
                 esc('#' + ISS[ci][0] + ' · ' + LABS[ri][0]) + '</title></rect>');
    });
  });

  parts.push('<line class="rule" x1="' + GUT + '" y1="' + (TOP - 0.5) +
             '" x2="' + RIGHT + '" y2="' + (TOP - 0.5) + '"/>');
  parts.push('<line class="rule" x1="' + GUT + '" y1="' + (BOT + 0.5) +
             '" x2="' + RIGHT + '" y2="' + (BOT + 0.5) + '"/>');

  cols.forEach(function (ci, k) {
    parts.push('<text class="' + (ISS[ci][1] ? 'msn' : 'axf') + '" x="' + n(cx(k)) +
               '" y="' + (TOP - 7) + '" text-anchor="middle" font-size="8.6">' + ISS[ci][0] +
               '<title>' + esc('#' + ISS[ci][0] + ' — ' + TITLES[ci] +
                               (ISS[ci][1] ? ' (open)' : ' (closed)')) + '</title></text>');
  });

  rows.forEach(function (ri, rk) {
    var y = n(cy(rk) + 3.3), cnt = M[ri].reduce(function (a, b) { return a + b; }, 0);
    parts.push('<text class="' + (isScale(LABS[ri][0]) ? 'msn' : 'ax') + '" x="' + (GUT - 8) +
               '" y="' + y + '" text-anchor="end" font-size="9.4">' + esc(LABS[ri][0]) + '</text>');
    parts.push('<text class="axf" x="' + (W - 2) + '" y="' + y +
               '" text-anchor="end" font-size="9">' + cnt + '</text>');
  });

  parts.push('<rect class="cell" x="' + GUT + '" y="' + n(LEGY - SIDE / 2) +
             '" width="' + SIDE + '" height="' + SIDE + '"/>');
  parts.push('<text class="axf" x="' + (GUT + SIDE + 6) + '" y="' + n(LEGY + 3.3) +
             '" font-size="9">label present</text>');
  parts.push('<rect class="open" x="' + (GUT + 104) + '" y="' + n(LEGY - SIDE / 2 - 2) +
             '" width="' + CW + '" height="' + (SIDE + 4) + '"/>');
  parts.push('<text class="axf" x="' + (GUT + 104 + CW + 6) + '" y="' + n(LEGY + 3.3) +
             '" font-size="9">still open &#8212; 6 of 36</text>');
  parts.push('<text class="axf" x="' + (W - 2) + '" y="' + n(LEGY + 3.3) +
             '" text-anchor="end" font-size="8.8">accented rows are the four ordinal scales, ' +
             'in the order the sweep put them</text>');

  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.innerHTML = parts.join('');
});
