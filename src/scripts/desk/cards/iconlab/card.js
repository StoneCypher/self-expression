/* A hundred candidate icons, drawn rather than found.

   The emoji hunt failed for a structural reason and not for want of trying: Unicode's
   pictographs are a vocabulary for things you would say to a person. It has objects,
   feelings, animals, weather, and a small set of media-transport controls it inherited from
   tape decks. Nobody ever encoded "move to front", "insert here" or "merge into", because
   those are operations on a data structure and there is nothing to mime. So every candidate
   was a social proxy for a position, and each leaked its social meaning — the medal says
   good, the flag says wrong, the pin says permanent, the bell says urgent.

   Drawn icons have no such freight. Each is a 24x24 glyph stroked in tokens, so it themes
   with the desk and is exactly the size it is asked to be — which is the other half of the
   problem, since an emoji is sized by a font and a font is not ours to argue with.

   `class="m"` marks the moving part: the arrow, the inserted item, the approval mark. It
   gets the saturated hue and everything else gets the slate, because these sit beside 🤖 and
   🗑️ and a one-colour hairline does not read as a third button — it reads as an image that
   failed to load. Emoji are a body plus a highlight; so are these now.

   Every tile renders twice: at 26px so the idea is legible, and at 13px in a mock of the
   real row, because the second one is the only test that matters. */
DESK.inits.push(function () {
  var land = document.getElementById('iclab-land');
  if (!land) return;

  var LAND = [
    ['L01', 'chevron to floor',      '<path class="m" d="M7 8l5 5 5-5"/><path d="M4 19h16"/>'],
    ['L02', 'arrow to floor',        '<path class="m" d="M12 4v9"/><path class="m" d="M8 10l4 4 4-4"/><path d="M4 19h16"/>'],
    ['L03', 'into the tray',         '<path d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/><path class="m" d="M12 3v9"/><path class="m" d="M8.5 9L12 12.5 15.5 9"/>'],
    ['L04', 'confluence',            '<path d="M6 3v4c0 3 2.5 5 6 5"/><path d="M18 3v4c0 3-2.5 5-6 5"/><path class="m" d="M12 12v8"/>'],
    ['L05', 'git merge',             '<circle cx="6" cy="5" r="2.4"/><circle cx="18" cy="5" r="2.4"/><circle class="m" cx="6" cy="19" r="2.4"/><path d="M6 7.4v9.2"/><path class="m" d="M18 7.4v3a5 5 0 0 1-5 5H6"/>'],
    ['L06', 'into the open box',     '<path d="M4 9v10h16V9"/><path class="m" d="M12 3v9"/><path class="m" d="M8.5 8.5L12 12l3.5-3.5"/>'],
    ['L07', 'check in a circle',     '<circle cx="12" cy="12" r="9"/><path class="m" d="M8 12.5l2.8 2.8L16 10"/>'],
    ['L08', 'bare check',            '<path class="m" d="M4 13l5 5L20 6"/>'],
    ['L09', 'the stamp',             '<rect x="3" y="4" width="18" height="13" rx="2"/><path class="m" d="M8 10.5l2.6 2.6L16 8"/><path d="M4 21h16"/>'],
    ['L10', 'converging arrows',     '<path d="M4 4l6 6"/><path d="M20 4l-6 6"/><path class="m" d="M12 10v10"/><path class="m" d="M8.5 16.5L12 20l3.5-3.5"/>'],
    ['L11', 'funnel',                '<path class="m" d="M3 4h18l-7 8v8l-4-2v-6z"/>'],
    ['L12', 'into the slot',         '<path class="m" d="M12 3v11"/><path class="m" d="M8 10l4 4 4-4"/><path d="M4 18h5"/><path d="M15 18h5"/>'],
    ['L13', 'parachute',             '<path d="M3 12a9 9 0 0 1 18 0"/><path class="m" d="M3 12l9 9 9-9"/><path d="M9 12c0 4 1.4 7.4 3 9 1.6-1.6 3-5 3-9"/>'],
    ['L14', 'anchor',                '<circle class="m" cx="12" cy="5" r="2.4"/><path class="m" d="M12 7.4V21"/><path d="M5 13h14"/><path d="M5 13a7 7 0 0 0 14 0"/>'],
    ['L15', 'set it down',           '<rect class="m" x="6" y="3" width="12" height="9" rx="2"/><path class="m" d="M12 12v4"/><path class="m" d="M9 13.5L12 16.5l3-3"/><path d="M4 20h16"/>'],
    ['L16', 'puzzle piece',          '<path class="m" d="M4 4h6a2 2 0 1 1 4 0h6v6a2 2 0 1 0 0 4v6H4z"/>'],
    ['L17', 'two become one',        '<rect x="3" y="4" width="8" height="6" rx="1.5"/><rect x="13" y="4" width="8" height="6" rx="1.5"/><rect class="m" x="6" y="15" width="12" height="6" rx="1.5"/><path d="M7 10v3"/><path d="M17 10v3"/>'],
    ['L18', 'onto the layers',       '<path class="m" d="M12 3v8"/><path class="m" d="M8.5 7.5L12 11l3.5-3.5"/><path d="M4 14l8 4 8-4"/><path d="M4 18l8 4 8-4"/>'],
    ['L19', 'branch to trunk',       '<path d="M6 3v18"/><path class="m" d="M18 3v6a6 6 0 0 1-6 6H6"/>'],
    ['L20', 'into the basin',        '<path d="M4 12v2a8 8 0 0 0 16 0v-2"/><path class="m" d="M12 3v9"/><path class="m" d="M8.5 8.5L12 12l3.5-3.5"/>'],
    ['L21', 'arrow, two floors',     '<path class="m" d="M12 3v10"/><path class="m" d="M7.5 8.5L12 13l4.5-4.5"/><path d="M4 17h16"/><path d="M4 21h16"/>'],
    ['L22', 'between the brackets',  '<path d="M7 4H4v16h3"/><path d="M17 4h3v16h-3"/><path class="m" d="M12 6v9"/><path class="m" d="M8.5 11.5L12 15l3.5-3.5"/>'],
    ['L23', 'the inbox',             '<path class="m" d="M3 12h5l2 3h4l2-3h5"/><path d="M3 12l3-7h12l3 7v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>'],
    ['L24', 'glide slope',           '<path class="m" d="M3 5l14 12"/><path d="M3 21h18"/><circle class="m" cx="17" cy="17" r="1.7" fill="currentColor" stroke="none"/>'],
    ['L25', 'caught in the cup',     '<path d="M5 11v3a7 7 0 0 0 14 0v-3z"/><circle class="m" cx="12" cy="4.5" r="2.4"/><path class="m" d="M12 7v2"/>'],
    ['L26', 'into the container',    '<rect x="3" y="11" width="18" height="9" rx="1.5"/><path d="M9 11v9"/><path d="M15 11v9"/><path class="m" d="M12 2v6"/><path class="m" d="M9 5l3 3 3-3"/>'],
    ['L27', 'wheels down',           '<path class="m" d="M4 6l14 8-6 1-1 4z"/><path d="M4 21h4"/><path d="M11 21h4"/><path d="M18 21h2"/>'],
    ['L28', 'double chevron',        '<path class="m" d="M7 5l5 5 5-5"/><path class="m" d="M7 11l5 5 5-5"/><path d="M4 21h16"/>'],
    ['L29', 'checked box',           '<rect x="3" y="3" width="18" height="18" rx="3"/><path class="m" d="M8 12.2l2.8 2.8L16.5 9"/>'],
    ['L30', 'circled arrow',         '<circle cx="12" cy="12" r="9"/><path class="m" d="M12 7v9"/><path class="m" d="M8.5 12.5L12 16l3.5-3.5"/>'],
    ['L31', 'into the cradle',       '<path d="M5 10v5a5 5 0 0 0 5 5h4a5 5 0 0 0 5-5v-5"/><path class="m" d="M12 3v8"/><path class="m" d="M9 8l3 3 3-3"/>'],
    ['L32', 'two nodes, one node',   '<circle cx="5" cy="6" r="2.2"/><circle cx="19" cy="6" r="2.2"/><circle class="m" cx="12" cy="18" r="2.6"/><path d="M6.6 7.7L10.4 16"/><path d="M17.4 7.7L13.6 16"/>'],
    ['L33', 'press the button',      '<rect x="3" y="12" width="18" height="7" rx="3"/><path class="m" d="M12 3v6"/><path class="m" d="M9 6l3 3 3-3"/>'],
    ['L34', 'throw the lever',       '<circle cx="12" cy="18" r="2.5"/><path class="m" d="M12 18l6-9"/><circle class="m" cx="18" cy="9" r="1.6" fill="currentColor" stroke="none"/><path d="M4 21h16"/>'],
    ['L35', 'the clamp closes',      '<path class="m" d="M6 4v12a6 6 0 0 0 12 0V4"/><path d="M3 20h18"/>'],
    ['L36', 'zipper merge',          '<path class="m" d="M12 21V9"/><path d="M12 9L6 3"/><path d="M12 9l6-6"/><path d="M9 13h6"/><path d="M9 17h6"/>'],
    ['L37', 'down the pipe',         '<path d="M8 3v18"/><path d="M16 3v18"/><path class="m" d="M12 6v9"/><path class="m" d="M9 12l3 3 3-3"/>'],
    ['L38', 'the seal',              '<circle cx="12" cy="10" r="6"/><path class="m" d="M9 10.2l2.2 2.2L15 8.6"/><path d="M8.5 15L7 22l5-2.5L17 22l-1.5-7"/>'],
    ['L39', 'landing gear',          '<path class="m" d="M12 3v10"/><path class="m" d="M8.5 9.5L12 13l3.5-3.5"/><path d="M7 17h10"/><path d="M9 17v3"/><path d="M15 17v3"/>'],
    ['L40', 'return',                '<path class="m" d="M20 5v7a3 3 0 0 1-3 3H5"/><path class="m" d="M9 11l-4 4 4 4"/>'],
    ['L41', 'into the folder',       '<path d="M3 20V6h6l2 2h10v12z"/><path class="m" d="M12 10v4"/><path class="m" d="M10 12.5l2 2 2-2"/>'],
    ['L42', 'onto the platform',     '<path class="m" d="M12 3v9"/><path class="m" d="M8.5 8.5L12 12l3.5-3.5"/><path d="M4 15h16"/><path d="M12 15v6"/>'],
    ['L43', 'chevrons meet',         '<path d="M4 6l6 6-6 6"/><path d="M20 6l-6 6 6 6"/><circle class="m" cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>'],
    ['L44', 'the drop lands',        '<path class="m" d="M12 3c3 4 4.5 6.2 4.5 8a4.5 4.5 0 0 1-9 0c0-1.8 1.5-4 4.5-8z"/><path d="M5 20h14"/>'],
    ['L45', 'arrow in a chip',       '<rect x="2" y="7" width="20" height="10" rx="5"/><path class="m" d="M12 9v6"/><path class="m" d="M9.5 12.5L12 15l2.5-2.5"/>'],
    ['L46', 'interlock',             '<path d="M3 9l5 3-5 3"/><path d="M21 9l-5 3 5 3"/><path class="m" d="M8 12h8"/>'],
    ['L47', 'rails converge',        '<path d="M3 21L10 3"/><path d="M21 21L14 3"/><path class="m" d="M10 3h4"/><path class="m" d="M6 14h12"/>'],
    ['L48', 'ticked, in motion',     '<rect x="5" y="5" width="14" height="14" rx="2.5"/><path class="m" d="M9 12.2l2.4 2.4L16 9.5"/><path d="M2 9h1.5"/><path d="M2 12h1.5"/><path d="M2 15h1.5"/>'],
    ['L49', 'into the notch',        '<path d="M3 16h6l3 3 3-3h6"/><path class="m" d="M12 3v11"/><path class="m" d="M9 11l3 3 3-3"/>'],
    ['L50', 'merge right',           '<path d="M3 6h5l4 6"/><path d="M3 18h5l4-6"/><path class="m" d="M12 12h9"/><path class="m" d="M18 9l3 3-3 3"/>']
  ];

  var QUEUE = [
    ['Q01', 'list, then plus',       '<path d="M4 6h12"/><path d="M4 12h8"/><path d="M4 18h8"/><path class="m" d="M17 13v8"/><path class="m" d="M13 17h8"/>'],
    ['Q02', 'joins from below',      '<path d="M4 3h16"/><path d="M4 7h16"/><path d="M4 11h16"/><path class="m" d="M12 21v-6"/><path class="m" d="M9.5 17.5L12 15l2.5 2.5"/>'],
    ['Q03', 'marked at the head',    '<path d="M9 5h12"/><path d="M9 12h12"/><path d="M9 19h12"/><path class="m" d="M3 2l4 3-4 3"/>'],
    ['Q04', 'around to the front',   '<path d="M5 18h14"/><path class="m" d="M17 14a7 7 0 0 0-11-4"/><path class="m" d="M6 6v4h4"/>'],
    ['Q05', 'up against the wall',   '<path d="M4 4v16"/><path class="m" d="M20 12H8"/><path class="m" d="M12 8l-4 4 4 4"/>'],
    ['Q06', 'dropped in at front',   '<circle cx="17" cy="16" r="2"/><circle cx="11" cy="16" r="2"/><circle cx="5" cy="16" r="2"/><path class="m" d="M5 4v7"/><path class="m" d="M2.5 8.5L5 11l2.5-2.5"/>'],
    ['Q07', 'first, numbered',       '<path class="m" d="M4 5.5L6 4v9"/><path d="M11 5h9"/><path d="M11 9h9"/><path d="M4 17h16"/><path d="M4 21h16"/>'],
    ['Q08', 'up to the bar',         '<path d="M4 5h16"/><path class="m" d="M12 20V9"/><path class="m" d="M7 14l5-5 5 5"/>'],
    ['Q09', 'double up',             '<path class="m" d="M7 11l5-5 5 5"/><path class="m" d="M7 18l5-5 5 5"/><path d="M4 3h16"/>'],
    ['Q10', 'to the top',            '<path d="M4 4h16"/><path class="m" d="M12 20V8"/><path class="m" d="M8 12l4-4 4 4"/>'],
    ['Q11', 'top-loaded',            '<path d="M5 8h14l-4 5v7H9v-7z"/><path class="m" d="M12 2v4"/><path class="m" d="M9.5 4.5L12 7l2.5-2.5"/>'],
    ['Q12', 'plus in a circle',      '<circle cx="12" cy="12" r="9"/><path class="m" d="M12 8v8"/><path class="m" d="M8 12h8"/>'],
    ['Q13', 'plus in a square',      '<rect x="3" y="3" width="18" height="18" rx="3"/><path class="m" d="M12 8v8"/><path class="m" d="M8 12h8"/>'],
    ['Q14', 'plus at the top',       '<path d="M4 6h9"/><path d="M4 12h16"/><path d="M4 18h16"/><path class="m" d="M17 3v6"/><path class="m" d="M14 6h6"/>'],
    ['Q15', 'onto the pile',         '<rect x="3" y="14" width="18" height="3.5" rx="1"/><rect x="3" y="19" width="18" height="3.5" rx="1"/><path class="m" d="M12 3v8"/><path class="m" d="M9 8l3 3 3-3"/>'],
    ['Q16', 'a card for the deck',   '<rect x="4" y="10" width="16" height="11" rx="2"/><path class="m" d="M7 7h10"/><path class="m" d="M9 4h6"/>'],
    ['Q17', 'onto the belt',         '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 15.5h12"/><rect class="m" x="9" y="8" width="6" height="5" rx="1"/><path class="m" d="M12 3v3"/>'],
    ['Q18', 'ticket, plus',          '<path d="M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z"/><path class="m" d="M12 10v4"/><path class="m" d="M10 12h4"/>'],
    ['Q19', 'onto the clipboard',    '<rect x="5" y="4" width="14" height="17" rx="2"/><rect x="9" y="2" width="6" height="3" rx="1"/><path class="m" d="M12 10v6"/><path class="m" d="M9 13h6"/>'],
    ['Q20', 'top of the deck',       '<rect x="4" y="12" width="16" height="9" rx="2"/><path d="M6 9h12"/><path class="m" d="M12 2v5"/><path class="m" d="M9.5 4.5L12 7l2.5-2.5"/>'],
    ['Q21', 'head of the line',      '<circle cx="5" cy="16" r="3"/><circle cx="12" cy="16" r="2.2"/><circle cx="18" cy="16" r="1.5"/><path class="m" d="M5 3v6"/><path class="m" d="M2.5 6.5L5 9l2.5-2.5"/>'],
    ['Q22', 'the return rail',       '<path d="M8 6h12"/><path d="M8 12h12"/><path d="M8 18h12"/><path class="m" d="M4 18V8"/><path class="m" d="M2 10l2-2 2 2"/>'],
    ['Q23', 'the insertion caret',   '<path d="M3 9h18"/><path class="m" d="M8 18l4-6 4 6"/>'],
    ['Q24', 'caret, pointing up',    '<path d="M3 15h18"/><path class="m" d="M8 12l4-6 4 6"/>'],
    ['Q25', 'up out of the tray',    '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M3 13v6a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6"/><path class="m" d="M12 10V3"/><path class="m" d="M9 6l3-3 3 3"/>'],
    ['Q26', 'the gate lifts',        '<circle cx="4" cy="18" r="2.2"/><path class="m" d="M4.8 16L20 8"/><path class="m" d="M20 8v4"/>'],
    ['Q27', 'pointed at the first',  '<rect x="9" y="4" width="12" height="4" rx="1"/><rect x="9" y="11" width="12" height="4" rx="1"/><rect x="9" y="18" width="12" height="4" rx="1"/><path class="m" d="M3 6h3"/><path class="m" d="M4.5 4L6.5 6l-2 2"/>'],
    ['Q28', 'a slot held open',      '<path d="M3 12h6"/><path d="M15 12h6"/><path class="m" d="M11 8v8"/><path class="m" d="M13 8v8"/>'],
    ['Q29', 'one more bar',          '<path class="m" d="M4 20v-7" stroke-dasharray="3 2"/><path d="M10 20V9"/><path d="M16 20V5"/><path d="M3 22h18"/>'],
    ['Q30', 'into the pipe',         '<path d="M4 8h16"/><path d="M4 18h16"/><circle class="m" cx="8" cy="13" r="2.5" fill="currentColor" stroke="none"/><path class="m" d="M13 13h6"/>'],
    ['Q31', 'onto the track',        '<path d="M4 12a8 8 0 0 1 16 0"/><circle class="m" cx="4" cy="12" r="2"/><circle class="m" cx="12" cy="4" r="2"/><circle class="m" cx="20" cy="12" r="2"/>'],
    ['Q32', 'the pending head',      '<circle cx="17" cy="12" r="2.2"/><circle cx="11" cy="12" r="2.2"/><circle class="m" cx="5" cy="12" r="2.2" stroke-dasharray="2.2 2"/>'],
    ['Q33', 'push',                  '<path d="M5 21h14"/><rect x="6" y="15" width="12" height="4" rx="1"/><rect x="6" y="10" width="12" height="4" rx="1"/><path class="m" d="M12 2v6"/><path class="m" d="M9.5 5.5L12 8l2.5-2.5"/>'],
    ['Q34', 'cutting in',            '<circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><circle class="m" cx="12" cy="18" r="2" stroke-dasharray="2 2"/><path class="m" d="M12 5v7"/><path class="m" d="M9.5 9.5L12 12l2.5-2.5"/>'],
    ['Q35', 'the next segment',      '<rect x="2" y="10" width="6" height="6" rx="1.5"/><rect x="9" y="10" width="6" height="6" rx="1.5"/><rect class="m" x="16" y="10" width="6" height="6" rx="1.5" stroke-dasharray="3 2"/>'],
    ['Q36', 'into the basket',       '<path d="M5 9h14l-1.5 11h-11z"/><path d="M9 9l3-6 3 6"/><path class="m" d="M12 12v5"/><path class="m" d="M9.5 14.5h5"/>'],
    ['Q37', 'one on the stack',      '<ellipse cx="12" cy="18" rx="7" ry="2.5"/><path d="M5 18v-4"/><path d="M19 18v-4"/><ellipse cx="12" cy="14" rx="7" ry="2.5"/><path class="m" d="M12 3v6"/><path class="m" d="M9.5 6.5L12 9l2.5-2.5"/>'],
    ['Q38', 'a new layer',           '<path class="m" d="M12 2L3 7l9 5 9-5z" stroke-dasharray="3 2"/><path d="M3 12l9 5 9-5"/><path d="M3 17l9 5 9-5"/>'],
    ['Q39', 'the first slot',        '<rect class="m" x="3" y="3" width="18" height="7" rx="2"/><path class="m" d="M9 5.5L11 4v5"/><path d="M3 14h18"/><path d="M3 19h18"/>'],
    ['Q40', 'coupling on',           '<path d="M2 20h20"/><rect x="4" y="12" width="7" height="6" rx="1.5"/><rect class="m" x="13" y="12" width="7" height="6" rx="1.5" stroke-dasharray="3 2"/><path class="m" d="M11 15h2"/>'],
    ['Q41', 'chevron over rows',     '<path class="m" d="M7 8l5-5 5 5"/><path d="M4 13h16"/><path d="M4 18h16"/>'],
    ['Q42', 'the top row, filled',   '<rect class="m" x="4" y="4" width="16" height="4" rx="1" fill="currentColor" stroke="none"/><path d="M4 13h16"/><path d="M4 18h16"/>'],
    ['Q43', 'in between',            '<circle cx="5" cy="16" r="2"/><circle cx="19" cy="16" r="2"/><path class="m" d="M12 4v9"/><path class="m" d="M9.5 10.5L12 13l2.5-2.5"/>'],
    ['Q44', 'up the left rail',      '<path d="M9 5h12"/><path d="M9 12h12"/><path d="M9 19h12"/><path class="m" d="M5 19V7"/><path class="m" d="M2.5 9.5L5 7l2.5 2.5"/>'],
    ['Q45', 'a ticket',              '<path d="M4 4h16v6a2 2 0 0 0 0 4v6H4v-6a2 2 0 0 0 0-4z"/><path class="m" d="M4 12h16" stroke-dasharray="2 3"/>'],
    ['Q46', 'raised to the line',    '<path d="M6 5h12"/><path class="m" d="M12 20V9"/><path class="m" d="M8 13l4-4 4 4"/>'],
    ['Q47', 'in-tray',               '<path d="M4 15h4l1.5 2h5L16 15h4"/><path d="M4 15v4h16v-4"/><path class="m" d="M8 4h8"/><path class="m" d="M7 8h10"/><path class="m" d="M6.5 12h11"/>'],
    ['Q48', 'the queue grows',       '<path d="M4 20v-4"/><path d="M9 20v-7"/><path d="M14 20v-10"/><path class="m" d="M19 20v-13" stroke-dasharray="3 2"/>'],
    ['Q49', 'the head slot waits',   '<rect x="4" y="14" width="16" height="7" rx="2" stroke-dasharray="4 3"/><rect class="m" x="7" y="2" width="10" height="7" rx="2"/><path class="m" d="M12 9v4"/>'],
    ['Q50', 'the fast lane',         '<path d="M3 16h18"/><path d="M3 21h18"/><path class="m" d="M4 8h10"/><path class="m" d="M11 5l3 3-3 3"/>']
  ];

  /* Adopted. L03 is the land button; Q02, redrawn so the arrow rises INTO the stack from
     below, is the queue button — an item that joins at the back shown joining at the back,
     moving the way it actually moves. Both are live in the inbox now; this strip is what
     they look like beside their neighbours, kept so a later change can be judged the same
     way it was chosen. */
  var FINAL = [
    ['L03',  'into the tray — as drawn',   'land',  '<path d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/><path class="m" d="M12 3v9"/><path class="m" d="M8.5 9L12 12.5 15.5 9"/>'],
    ['L03b', 'tray — wider mouth, shorter drop', 'land', '<path d="M3 13v6a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6"/><path class="m" d="M12 4v7"/><path class="m" d="M8 8l4 4 4-4"/>'],
    ['L03c', 'tray — solid tray, light arrow', 'land', '<path d="M3 13v6a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6z" fill="currentColor" stroke="none"/><path class="m" d="M12 3v8"/><path class="m" d="M8 7.5l4 4 4-4"/>'],
    ['L21',  'two floors — as drawn',      'land',  '<path class="m" d="M12 3v10"/><path class="m" d="M7.5 8.5L12 13l4.5-4.5"/><path d="M4 17h16"/><path d="M4 21h16"/>'],
    ['L21b', 'two floors — tighter, fatter head', 'land', '<path class="m" d="M12 4v9"/><path class="m" d="M6.5 8L12 13.5 17.5 8"/><path d="M4 18h16"/><path d="M4 22h16"/>'],
    ['L21c', 'two floors — one is the ground', 'land', '<path class="m" d="M12 3v10"/><path class="m" d="M7 8.5L12 13.5l5-5"/><path d="M4 17.5h16"/><path d="M7 21.5h10"/>'],
    ['Q02',  'ADOPTED — rises into the stack', 'queue', '<path d="M4 3h16"/><path d="M4 7h16"/><path d="M4 11h16"/><path class="m" d="M12 21v-6"/><path class="m" d="M9.5 17.5L12 15l2.5 2.5"/>'],
    ['Q02f', 'same, with a longer run',   'queue', '<path d="M4 3h16"/><path d="M4 7h16"/><path d="M4 11h16"/><path class="m" d="M12 22v-7"/><path class="m" d="M9 18L12 15l3 3"/>'],
    ['Q02g', 'two rows, more air',        'queue', '<path d="M4 4h16"/><path d="M4 9h16"/><path class="m" d="M12 21v-7"/><path class="m" d="M9 17l3-3 3 3"/>']
  ];

  var KEY = 'desk.iclab.picks';

  /**
   * One <svg> for an icon, with the stroke defaults every glyph shares.
   *
   * `stroke-linecap` and `stroke-linejoin` are round because at 13px a mitre is a pixel of
   * noise, and `vector-effect` is deliberately NOT set: the strokes should thin with the
   * glyph, otherwise the small render is a bolder drawing rather than a smaller one.
   */
  function svg(markup, cls) {
    return '<svg class="' + cls + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
           'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
           'aria-hidden="true">' + markup + '</svg>';
  }

  /* A mock of the real control group, so the glyph is judged against 🤖 and 🗑️ at the size
     and treatment they actually get rather than against nothing. */
  function row(art) {
    return '<span class="icrow">' + svg(art, 'sm') + '<span>🤖</span><span>🗑️</span></span>';
  }

  var picks = [];
  try { picks = JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch (e) { picks = []; }

  function tile(id, name, art) {
    return '<button type="button" class="ic' + (picks.indexOf(id) >= 0 ? ' on' : '') +
           '" data-id="' + id + '" title="' + id + ' — ' + name + '">' +
           svg(art, 'big') + row(art) + '<span class="icid">' + id + '</span></button>';
  }

  function paint(host, rows) {
    if (!host) return;
    var html = '';
    for (var i = 0; i < rows.length; i++) html += tile(rows[i][0], rows[i][1], rows[i][2]);
    host.innerHTML = html;
  }

  /* The shortlist gets the name spelled out, because three columns have room for it and
     because at this stage the question is which drawing, not which of a hundred. */
  function paintFinal(host) {
    if (!host) return;
    var html = '';
    for (var i = 0; i < FINAL.length; i++) {
      var f = FINAL[i];
      html += '<div class="icfin ' + f[2] + '">' + svg(f[3], 'big') + row(f[3]) +
              '<span class="icid">' + f[0] + '</span><span class="icnm">' + f[1] + '</span></div>';
    }
    host.innerHTML = html;
  }

  function showPicks() {
    var out = document.getElementById('iclab-picks');
    if (!out) return;
    var sorted = picks.slice().sort();
    out.textContent = sorted.length ? sorted.join(', ') : 'nothing yet';
    out.className = sorted.length ? '' : 'icnone';
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(picks)); } catch (e) { /* private window */ }
  }

  paintFinal(document.getElementById('iclab-final'));
  paint(land, LAND);
  paint(document.getElementById('iclab-queue'), QUEUE);
  showPicks();

  /* One listener on the card rather than two hundred on the tiles. */
  var card = land.closest('section');
  card.addEventListener('click', function (ev) {
    var tgt = ev.target.closest('.ic');
    if (tgt) {
      var id = tgt.dataset.id, at = picks.indexOf(id);
      if (at >= 0) picks.splice(at, 1); else picks.push(id);
      tgt.classList.toggle('on', at < 0);
      save(); showPicks();
      return;
    }
    if (ev.target.id === 'iclab-clear') {
      picks = [];
      save(); showPicks();
      var on = card.querySelectorAll('.ic.on');
      for (var i = 0; i < on.length; i++) on[i].classList.remove('on');
    }
  });
});
