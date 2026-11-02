// generate.js - turns ONE design file into everything the app draws, and checks it.
//
// A design file (designs/<name>.js) is a single call: design({ ...the design... }). index.html loads it, hands the object
// to generateWiring() below and draws what comes back: every part where it sits, every wire in its real colour, the
// resistors and capacitors on their wires, each supply pin's path back to the battery and each ground's path back to the
// ground point. Nothing is guessed - what is not in the design file is not drawn. The README walks through every field;
// in short:
//
//   name, status, about (Markdown for the Info panel), canvas {w, h}, zones [{id, name, note, x0, x1[, y0, y1]}],
//   outlines [{name, x, y, w, h}]   dashed boxes round a group of parts
//   volts {category: text}         the voltage a wire of that category carries (the wire panel)
//   categories [{id, name, colour, sys}]   optional: your own wire categories (the default six are below)
//   colourRules 'warn' (default) | 'fail' | 'off'   how the check treats a 5 V wire that is not red (and the like)
//   parts  [{id, name, what, desc, warn, pn, maker, url, status, qty, note, zone, area, box [x, y, w, h], fill, photo,
//            sys [...], source (true = the battery), mcu (true = the main board: its GPIOn / Dn pins are searchable),
//            pins [[ID, label, role, shortName, configName]], links [[feed|tie, pinA, pinB, why]], look, rate,
//            comp {ref, kind, value, where} (a small part such as an LED, drawn as a chip: box {x, y, w, h, chip: true})}]
//            pin role: pwr = takes a supply, gnd = a ground, plus / minus = the battery's ends; leave it out for a signal
//   splices [{id, name, what, desc, box [x, y, w, h], bar, lab, lp, star, rating, build, taps}]   one pin each: BUS
//   comps  [{ref, kind R|CN|CE|J, value, job, part, why, where, zone, a, b, series, wire {...}, t, cat, bridge}]
//            a = the pin it sits at; b = where its other leg goes; series = in line: a real wire ("wire") on from its
//            other leg to b, or soldered leg to leg with no wire of its own (then "cat" says what it carries)
//   wires  [{from, to, cat, awg, colour, text, len, cm, twist, rows, volts, amps [normal, peak], side, loom, ownLead}]
//            ownLead: the part's own lead (a battery holder's red wire) - the colour rules do not apply to it
//   notes  [{pin, text}]           optional: a note on a pin with no wire ("leave it empty", "bridged on the board")
//
// The checks (the "design check" chip): every wire end is a real pin, every part that takes a supply reaches the battery
// and every ground reaches the ground point, no supply or ground pin left without its wire, no splice over six conductors
// unless it is a bus wire, and the colour rules (every 5 V wire red, every battery + wire yellow, every ground wire black).
(function () {
'use strict';

const CATS = [
  { id: 'raw',   name: 'Battery + (after the switch)', colour: '#E0A100', sys: 'power' },
  { id: 'logic', name: '5 V',                          colour: '#D62828', sys: 'power' },
  { id: 'v33',   name: '3.3 V',                        colour: '#2A9D3F', sys: 'power' },
  { id: 'gnd',   name: 'Ground',                       colour: '#141414', sys: 'ground' },
  { id: 'i2c',   name: 'I2C buses',                    colour: '#1E6FD9', sys: 'i2c' },
  { id: 'sig',   name: 'Signals and data',             colour: '#F2F2F2', sys: null }];
const SYSTEMS = [{ id: 'power', name: 'Power' }, { id: 'ground', name: 'Ground' }, { id: 'i2c', name: 'I2C' }, { id: 'servos', name: 'Servos' },
                 { id: 'leds', name: 'LEDs' }, { id: 'lasers', name: 'Lasers' }, { id: 'sensors', name: 'Sensors' }];
const VOLTS = { raw: 'the battery, after the switch', logic: '5 V', v33: '3.3 V', gnd: '0 V (ground)', i2c: '3.3 V I2C', sig: '3.3 V logic' };
const JOBNAME = { 'divider': 'Divider', 'filter': 'Filter', 'pull-up': 'Pull-up', 'pull-down': 'Pull-down', 'data resistor': 'Data resistor', 'supply capacitor': 'Supply capacitor', 'gate resistor': 'Gate resistor' };
const list = v => v == null ? [] : Array.isArray(v) ? v : [v];
const titleCase = s => String(s || '').replace(/\b[a-z]/g, c => c.toUpperCase());

function generateWiring(SRC, file) {
  file = file || 'the design file';
  const unresolved = [], results = [];
  const addResult = (level, text) => results.push({ level, text });
  const cats = list(SRC.categories).length ? list(SRC.categories) : CATS;
  const catSys = {}; cats.forEach(c => catSys[c.id] = c.sys !== undefined ? c.sys : (CATS.find(d => d.id === c.id) || {}).sys || null);
  const systems = list(SRC.systems).length ? list(SRC.systems) : SYSTEMS;
  const supplyCat = cat => catSys[cat] === 'power';   // a resistor in line on one of these passes the power path
  const railOfCat = cat => {   // the symbol at a hanging part's far leg
    const r = { gnd: 'gnd', v33: 'v33', logic: '5v', raw: 'batt' }[cat]; if (r) return r;
    const c = cats.find(x => x.id === cat), nm = c ? String(c.name) : '';
    return /3\.3/.test(nm) ? 'v33' : /\b5 ?V\b/i.test(nm) ? '5v' : /batt/i.test(nm) ? 'batt' : catSys[cat] === 'ground' ? 'gnd' : null;
  };

  // ---- parts, splices, components --------------------------------------------------------------------------------
  const parts = [], partById = {}, pinOk = {}, pinRole = {};
  const getBox = (b, fill) => {
    if (!b) return null;
    if (Array.isArray(b)) return { x: Math.round(+b[0]), y: Math.round(+b[1]), w: Math.round(+b[2]), h: Math.round(+b[3]), fill };
    return Object.assign({}, b, { fill: b.fill || fill });   // {x, y, w, h, ends: [...]}: a long part with two labelled ends
  };
  const pinOf = q => Array.isArray(q) ? { id: q[0], label: q[1], role: q[2], name: q[3], config: q[4] } : q;
  const photoPath = s => !s ? null : /^(https?:|data:|\.{0,2}\/)/.test(s) || s.includes('/') ? s : 'photos/' + (/\.(jpe?g|png|webp|gif|svg)$/i.test(s) ? s : s + '.jpg');
  list(SRC.parts).forEach(p => {
    const pins = list(p.pins).map(pinOf).map(q => {
      const o = { id: String(q.id), label: String(q.label == null ? q.id : q.label) };
      if (q.name) o.name = String(q.name);
      if (q.config) o.config = String(q.config);
      pinOk[p.id + '.' + q.id] = true;
      if (q.role) pinRole[p.id + '.' + q.id] = String(q.role);
      return o;
    });
    const o = {
      id: p.id, group: p.id, zone: p.zone, name: p.name, alias: p.name, what: p.what, kind: 'part', photo: p.photo || null,
      pn: p.pn || '', pnOk: !!p.pn,
      buy: p.pn ? { pn: p.pn, section: p.status === 'owned' ? 'A' : 'B', status: p.status || 'to buy', ok: true, cells: { Part: '**' + p.pn + '**', Qty: p.qty ? String(p.qty) : '1', 'Where it goes': p.area, Note: p.note } } : null,
      maker: p.maker || '', url: p.url || '', img: photoPath(p.photo), photoNote: p.photoNote,
      pins, desc: p.desc || p.what, warn: p.warn, comp: p.comp || null, look: p.look || null,   // comp: a small part drawn as a chip ({ref, kind, value, where})
      draw: p.draw, rate: p.rate || null, sys: list(p.sys).filter(Boolean), hub: !!p.hub, area: p.area, source: !!p.source, isStar: false,
      power: [], ground: [], gndNote: p.gndNote,
      links: list(p.links).filter(Boolean).map(k => ({ kind: String(k[0]), a: String(k[1]), b: String(k[2]), what: String(k[3] || '') })),
      splice: null, box: getBox(p.box, p.fill)
    };
    if (partById[p.id]) unresolved.push('two parts have the id \'' + p.id + '\'');
    parts.push(o); partById[p.id] = o;
  });
  list(SRC.splices).forEach(s => {
    const b = getBox(s.box, '#2B2D42');
    if (b) { if (s.bar) b.bar = true; else b.dot = true; b.lab = s.lab || s.name; b.lp = s.lp || 'b'; }
    const o = {
      id: s.id, group: s.id, zone: s.zone, name: s.name, alias: s.name, what: s.what, kind: 'splice', photo: null,
      pn: s.pn || 'heat-shrink', pnOk: true, buy: null, maker: '', url: '', img: null,
      pins: [{ id: 'BUS', label: s.bar ? 'the bus wire' : 'the splice', name: s.bar ? 'bus wire' : 'splice' }],
      desc: s.desc || s.what, warn: s.warn, comp: null, look: null, draw: null, rate: s.rate || null,
      sys: [s.star ? 'ground' : 'power'], hub: true, area: s.area, source: false, isStar: !!s.star,
      power: [], ground: [], gndNote: null, links: [], splice: null, box: b
    };
    pinOk[s.id + '.BUS'] = true;
    if (partById[s.id]) unresolved.push('two parts have the id \'' + s.id + '\'');
    parts.push(o); partById[s.id] = o;
  });

  // ---- wires -------------------------------------------------------------------------------------------------------
  const wires = [], rows = [], rowWire = {};
  let n = 0;
  const testRef = (ref, what) => { if (!pinOk[ref]) unresolved.push(what + ' names \'' + ref + '\', which is no pin of the design'); };
  const getVolts = cat => (SRC.volts && SRC.volts[cat]) || VOLTS[cat] || cat;
  const getSys = (cat, a, b) => {
    let s = []; if (catSys[cat]) s.push(catSys[cat]);
    [a, b].forEach(r => { const pp = partById[String(r).split('.')[0]]; if (pp && !pp.hub) s = s.concat(pp.sys); });
    if (!s.length) s = ['sensors'];
    return [...new Set(s)];
  };
  function newWire(from, to, cat, awg, colour, text, len, cm, lead, rowsOf, extra) {
    const id = 'x' + (++n);
    testRef(from, 'wire ' + rowsOf[0]); testRef(to, 'wire ' + rowsOf[0]);
    const w = {
      id, rows: rowsOf, from, to, cat, text, awg, colour, side: null, n: 1, lead: !!lead,
      src: text, len: { text: len || 'short - on the same board', cm: cm == null ? null : cm, basis: file },
      wcolour: colour, wbasis: lead ? 'the part\'s own bare leg' : file, wover: null,
      sys: getSys(cat, from, to), loom: null, twist: [], twistWhy: null,
      volts: getVolts(cat), voltsWhy: file + ', the ' + cat + ' net', ampsN: null, ampsP: null, ampsFrom: []
    };
    if (extra) {
      if (extra.volts) { w.volts = extra.volts; w.voltsWhy = file + ', this wire'; }
      const a = list(extra.amps); if (a.length) { w.ampsN = a[0] == null ? null : +a[0]; w.ampsP = a[1] == null ? w.ampsN : +a[1]; }
      if (extra.side) w.side = extra.side;
      if (extra.loom) w.loom = extra.loom;
      if (extra.twistWhy) w.twistWhy = extra.twistWhy;
      if (extra.n) w.n = Math.max(1, +extra.n | 0);
    }
    wires.push(w);
    return w;
  }
  const twistOf = [];   // [wire, [row ids]]: resolved once every wire has its id
  list(SRC.wires).forEach((w, i) => {
    const rid = list(w.rows).length ? list(w.rows).map(String) : ['W' + (i + 1)];
    const x = newWire(w.from, w.to, w.cat, w.awg, w.colour, w.text, w.len, w.cm, false, rid, w);
    rid.forEach(r => (rowWire[r] = rowWire[r] || []).push(x));   // a row may name several wires (a table row for four servo leads)
    if (!rows.some(r => r.id === rid[0])) rows.push({ id: rid[0], section: 'W', text: rid[0] + ' | ' + w.from + ' | ' + w.to + ' | ' + (w.awg || '') + ' | ' + (w.colour || '') + ' | ' + (w.text || '') });
    if (list(w.twist).length) twistOf.push([x, list(w.twist).map(String)]);
    if (w.ownLead) x.ownLead = true;
  });

  // components: a part each, two legs; a series one's far leg is a real wire on to b
  const comps = [], dwires = [], seriesWire = {};
  list(SRC.comps).forEach(c => {
    const cid = String(c.ref).toLowerCase();
    pinOk[cid + '.A'] = true; pinOk[cid + '.B'] = true;
    const aPart = partById[String(c.a).split('.')[0]], bPart = partById[String(c.b).split('.')[0]];
    if (!aPart) unresolved.push(c.ref + ' sits at \'' + c.a + '\', which is no pin of the design');
    if (!bPart) unresolved.push(c.ref + '\'s other leg goes to \'' + c.b + '\', which is no pin of the design');
    const end1 = aPart ? aPart.name + ' ' + String(c.a).split('.')[1] : c.a;
    const end2 = bPart ? (bPart.hub && bPart.kind === 'splice' ? bPart.name : bPart.name + ' ' + String(c.b).split('.')[1]) : c.b;
    const kind = c.kind === 'CE' ? 'CP' : c.kind;   // CE = an electrolytic: polarised, drawn with its + on end a
    const kit = c.pn || { R: '1 % metal-film resistor kit', CP: 'electrolytic capacitor kit', CN: 'ceramic capacitor kit', J: 'solder' }[kind] || 'component';
    const partWord = String(c.part || c.job || kind).replace(/^the /, '');
    const o = {
      id: cid, group: cid, zone: c.zone, name: c.ref + ' ' + c.value, alias: c.ref + ' ' + c.value + ' - ' + partWord, what: 'The ' + partWord + ': ' + c.value + ', ' + c.where + '.', kind: 'part', photo: null,
      pn: kit, pnOk: true,
      buy: { pn: kit, section: 'B', status: c.pn ? 'to buy' : 'kit', ok: true, cells: { Part: kit, Qty: '1', 'Where it goes': c.where, Note: null } },
      maker: '', url: '', img: null,
      pins: [{ id: 'A', label: 'end 1: ' + (c.end1 || end1), name: 'end 1' }, { id: 'B', label: 'end 2: ' + (c.end2 || end2), name: 'end 2' }],
      desc: partWord.charAt(0).toUpperCase() + partWord.slice(1) + ': ' + c.value + ', ' + c.where + '.', warn: null,
      comp: { ref: c.ref, kind, value: c.value, part: c.part, where: c.where, end1: c.end1 || end1, end2: c.end2 || end2, job: c.job, why: c.why },
      look: null, draw: null, rate: null, sys: [aPart && aPart.sys.length ? aPart.sys[0] : 'sensors'], hub: false, area: null, source: false, isStar: false,
      power: [], ground: [], gndNote: null, links: [], splice: null, box: null
    };
    parts.push(o); partById[cid] = o;
    rows.push({ id: c.ref, section: 'K', text: [c.ref, c.part, c.value, c.where, c.a, c.b, c.job, c.why].join(' | ') });
    const leadCol = c.leadColour || 'silver', leadCat = c.cat || 'sig';
    const la = newWire(c.a, cid + '.A', leadCat, 'the part\'s own lead', leadCol, c.ref + '\'s end 1 soldered on ' + end1, 'its own leg, soldered straight on', null, true, [c.ref]);
    const rec = { id: cid, ref: c.ref, kind, value: c.value, job: c.job, jobName: JOBNAME[c.job] || titleCase(c.job), why: c.why, where: c.where };
    if (c.series && !c.wire) {   // in line between two legs (a resistor soldered on an LED's leg, its other leg on a splice): no wire of its own
      const lb = newWire(cid + '.B', c.b, leadCat, 'the part\'s own lead', leadCol, c.ref + '\'s end 2 soldered on ' + end2, 'its own leg, soldered straight on', null, true, [c.ref]);
      const t = c.t != null ? +c.t : 0.5, amps = list(c.amps);
      Object.assign(rec, { wires: [la.id, lb.id], role: 'series', ends: [c.a, c.b], dwire: la.id, t });
      dwires.push({ id: la.id, from: c.a, to: c.b, wires: [la.id, lb.id], series: [{ c: cid, t }], volts: c.volts || getVolts(leadCat), voltsWhy: file + ', ' + c.ref, ampsN: amps.length ? +amps[0] : null, ampsP: amps.length ? +(amps[1] == null ? amps[0] : amps[1]) : null });
    } else if (c.series) {
      const wd = c.wire || {};
      const rid = list(wd.rows).length ? list(wd.rows).map(String) : [c.ref];
      const lb = newWire(cid + '.B', c.b, wd.cat || 'sig', wd.awg, wd.colour, wd.text, wd.len, wd.cm, false, rid, wd);
      rid.forEach(r => { if (r !== c.ref) (rowWire[r] = rowWire[r] || []).push(lb); });
      const t = c.t != null ? +c.t : 0.1;
      Object.assign(rec, { wires: [la.id, lb.id], role: 'series', ends: [c.a, c.b], dwire: lb.id, t });
      dwires.push({ id: lb.id, from: c.a, to: c.b, wires: [la.id, lb.id], series: [{ c: cid, t }], volts: lb.volts, voltsWhy: lb.voltsWhy, ampsN: lb.ampsN, ampsP: lb.ampsP });
      seriesWire[lb.id] = true;
    } else {
      const lb = newWire(cid + '.B', c.b, c.cat || 'sig', 'the part\'s own lead', leadCol, c.ref + '\'s end 2 soldered on ' + end2, 'its own leg, soldered straight on', null, true, [c.ref]);
      rec.wires = [la.id, lb.id];
      if (aPart && bPart && aPart.id === bPart.id) Object.assign(rec, { role: c.bridge ? 'bridge' : 'across', at: c.a, far: c.b, rail: 'pin', farName: String(c.b).split('.')[1] });
      else {
        let farCat = bPart && bPart.isStar ? 'gnd' : null;
        if (!farCat && bPart && bPart.hub) { const fw = wires.find(w => !w.lead && (w.from === c.b || w.to === c.b)); farCat = fw ? fw.cat : null; }
        Object.assign(rec, { role: 'shunt', at: c.a, far: c.b, rail: { gnd: 'gnd', v33: 'v33', logic: '5v', raw: 'batt' }[farCat] || 'pin', farName: bPart ? bPart.name : c.b });
      }
    }
    comps.push(rec);
  });
  // twisted pairs name each other by row id
  twistOf.forEach(([x, rs]) => { x.twist = rs.map(r => {
    const o = rowWire[r] || [];
    if (!o.length) unresolved.push('wire ' + x.rows[0] + ' is twisted with ' + r + ', which is no wire of the design');
    else if (o.length > 1) unresolved.push('wire ' + x.rows[0] + ' is twisted with ' + r + ', but ' + o.length + ' wires share that row id - name it by a row of its own');
    return o.length === 1 ? o[0].id : null; }).filter(Boolean); });
  // the drawn lines: every real wire (a series part's two conductors are one line, above)
  wires.forEach(w => { if (w.lead || seriesWire[w.id]) return; dwires.push({ id: w.id, from: w.from, to: w.to, wires: [w.id], series: [], volts: w.volts, voltsWhy: w.voltsWhy, ampsN: w.ampsN, ampsP: w.ampsP }); });

  // ---- the paths: every supply pin back to the battery's +, every ground to the ground point ---------------------
  const adj = {};
  const addAdj = (a, e) => (adj[a] = adj[a] || []).push(e);
  wires.forEach(w => { addAdj(w.from, { to: w.to, w: w.id, lead: w.lead }); addAdj(w.to, { to: w.from, w: w.id, lead: w.lead }); });
  const feedUp = {}, tie = {};
  const push = (m, k, v) => (m[k] = m[k] || []).push(v);
  parts.forEach(p => p.links.forEach(k => {
    const a = p.id + '.' + k.a, b = p.id + '.' + k.b;
    if (!pinOk[a]) unresolved.push(p.name + '\'s link names its pin ' + k.a + ', which it does not have');
    if (!pinOk[b]) unresolved.push(p.name + '\'s link names its pin ' + k.b + ', which it does not have');
    if (k.kind === 'feed') push(feedUp, b, [a, k.what]); else { push(tie, a, [b, k.what]); push(tie, b, [a, k.what]); }
  }));
  // a resistor in line on a ground wire (a current-sense resistor) passes the ground path, one in line on a supply wire
  // the power path - either way, through its body (its two legs are wires of their own, walked like any other)
  list(SRC.comps).forEach(c => {
    if (!c.series) return;
    const cat = c.wire ? c.wire.cat : c.cat, cid = String(c.ref).toLowerCase(), ca = cid + '.A', cb = cid + '.B';
    if (cat === 'gnd') { const why = 'through ' + c.ref + ' (' + c.value + ', in line on the ground)'; push(tie, ca, [cb, why]); push(tie, cb, [ca, why]); }
    if (supplyCat(cat)) { const why = 'through ' + c.ref + ' (' + c.value + ', in line on the supply)'; push(feedUp, ca, [cb, why]); push(feedUp, cb, [ca, why]); }
  });
  const plusPins = Object.keys(pinRole).filter(k => pinRole[k] === 'plus');
  const starPins = parts.filter(p => p.isStar).map(p => p.id + '.BUS');
  if (!plusPins.length) unresolved.push('no pin has the role "plus": mark the battery\'s + pin so supplies can be traced to it');
  if (!starPins.length) unresolved.push('no splice is the ground point: give the main ground splice "star": true');
  function findPath(from, goals, power) {
    const seen = { [from]: true }; let level = [[{ pin: from }]];
    while (level.length) {
      const next = [];
      for (const path of level) {
        const at = path[path.length - 1].pin;
        if (goals.includes(at)) return path;
        const nb = [];
        (adj[at] || []).forEach(e => nb.push({ pin: e.to, w: e.w }));
        if (power) (feedUp[at] || []).forEach(u => nb.push({ pin: u[0], link: u[1] }));
        (tie[at] || []).forEach(u => nb.push({ pin: u[0], link: u[1] }));
        nb.forEach(s => { if (seen[s.pin]) return; seen[s.pin] = true; next.push(path.concat([s])); });
      }
      level = next;
    }
    return null;
  }
  const stepsOf = path => path.map(s => { const st = { pin: s.pin }; if (s.w) st.w = s.w; if (s.link) st.link = s.link; return st; });
  parts.forEach(p => p.pins.forEach(q => {
    const ref = p.id + '.' + q.id, role = pinRole[ref];
    if (role === 'pwr') {
      const path = findPath(ref, plusPins, true);
      if (path) p.power.push({ from: ref, steps: stepsOf(path) }); else unresolved.push(p.name + ' (' + ref + ') takes a supply but traces to no battery');
    }
    if (role === 'gnd' || role === 'minus') {
      const path = findPath(ref, starPins, false);
      if (path) p.ground.push({ from: ref, steps: stepsOf(path) }); else unresolved.push(p.name + ' (' + ref + ') is a ground that reaches no ground point');
    }
  }));
  parts.filter(p => p.isStar).forEach(p => p.ground = [{ from: p.id + '.BUS', steps: [{ pin: p.id + '.BUS' }] }]);
  // the splices and the resistors / capacitors get the path of the net they sit on: a 3.3 V bus its way back to the
  // battery, a capacitor's - leg its way to the ground point (a pull-up's leg on a signal pin has none)
  const onPower = new Set(), onGround = new Set();
  const mark = () => parts.forEach(p => { p.power.forEach(x => x.steps.forEach(s => onPower.add(s.pin))); p.ground.forEach(x => x.steps.forEach(s => onGround.add(s.pin))); });
  mark();
  parts.filter(p => p.kind === 'splice' && !p.isStar).forEach(p => {
    const ref = p.id + '.BUS';
    if (onGround.has(ref)) { const path = findPath(ref, starPins, false); if (path) p.ground.push({ from: ref, steps: stepsOf(path) }); }
    else if (onPower.has(ref)) { const path = findPath(ref, plusPins, true); if (path) p.power.push({ from: ref, steps: stepsOf(path) }); }
  });
  mark();
  const landing = (cid, pin) => { const w = wires.find(w => (w.from === cid + '.' + pin && !w.to.startsWith(cid + '.')) || (w.to === cid + '.' + pin && !w.from.startsWith(cid + '.'))); return w ? (w.from === cid + '.' + pin ? w.to : w.from) : null; };
  const kindOf = (ref, depth) => {   // 'power' / 'ground' / null: the net a pin is on (a leg twisted onto another part's leg: where that one lands)
    if (!ref) return null;
    if (onGround.has(ref) || starPins.includes(ref)) return 'ground';
    if (onPower.has(ref)) return 'power';
    const id = ref.split('.')[0];
    if (depth < 3 && comps.some(c => c.id === id)) return kindOf(landing(id, ref.split('.')[1]), depth + 1);
    return null;
  };
  comps.forEach(c => {
    const p = partById[c.id];
    ['power', 'ground'].forEach(k => {
      let best = null;
      ['A', 'B'].forEach(pin => {
        if (kindOf(landing(c.id, pin), 0) !== k) return;
        const path = findPath(c.id + '.' + pin, k === 'power' ? plusPins : starPins, k === 'power');
        if (path && (!best || path.length < best.length)) best = path;
      });
      if (best) p[k].push({ from: best[0].pin, steps: stepsOf(best) });
    });
    // the far leg's rail (the symbol drawn at it): ground, or the supply its net carries
    if (c.role === 'across' || c.role === 'shunt') {
      const far = c.far, k = kindOf(far, 0);
      if (k === 'ground') c.rail = 'gnd';
      else if (k === 'power') { const fw = wires.find(w => !w.lead && (w.from === far || w.to === far)); const r = fw ? railOfCat(fw.cat) : null; if (r) c.rail = r; }
    }
  });

  // ---- the splices' facts ------------------------------------------------------------------------------------------
  list(SRC.splices).forEach(s => {
    const p = partById[s.id], ref = s.id + '.BUS';
    let on = wires.filter(w => w.from === ref || w.to === ref);
    if (list(s.taps).length) { const ord = list(s.taps).map(String), ix = w => { const i = w.rows.findIndex(r => ord.includes(r)); return i < 0 ? 1e9 : ord.indexOf(w.rows[i]); }; on = on.slice().sort((a, b) => ix(a) - ix(b)); }
    const real = on.filter(w => !w.lead), legs = on.filter(w => w.lead);
    const legsWhy = legs.length ? [...new Set(legs.map(w => { const e = w.from === ref ? w.to : w.from; return partById[e.split('.')[0]].name; }))].join(', ') : null;
    const sp = { conductors: on.length, wires: real.length, legs: legs.length, legsWhy, amps: null, faultAmps: null, ampsWhy: null, flags: [] };
    if (!s.bar && on.length > 6) sp.flags = [on.length + ' conductors in one twisted splice - over six; make it a bus wire'];
    if (s.bar) sp.bus = { rating: s.rating || 7, build: s.build || 'one bare 22 AWG wire, tinned, a few cm long', taps: on.map((w, i) => ({ w: w.id, row: w.rows[0], end: i === 0 })) };
    p.splice = sp;
  });

  // ---- the checks --------------------------------------------------------------------------------------------------
  const realW = wires.filter(w => !w.lead), own = w => w.ownLead || /own|lead/i.test(String(w.awg || ''));   // a part's own lead keeps the colour it came with
  addResult('pass', list(SRC.parts).length + ' parts, ' + list(SRC.splices).length + ' junctions, ' + list(SRC.comps).length + ' resistors / capacitors, ' + realW.length + ' wires, ' + (wires.length - realW.length) + ' component legs');
  const colourRule = (cat, colour, what) => {
    if (!cats.some(c => c.id === cat)) return;
    const bad = realW.filter(w => w.cat === cat && w.colour !== colour && !own(w));
    if (bad.length) addResult(SRC.colourRules === 'fail' ? 'fail' : 'warn', what + ' not ' + colour + ': ' + bad.map(w => w.rows[0] + ' ' + w.from + ' -> ' + w.to + ' (' + w.colour + ')').join('; '));
    else addResult('pass', 'every ' + what + ' is ' + colour);
  };
  if (SRC.colourRules !== 'off') { colourRule('logic', 'red', '5 V wire'); colourRule('raw', 'yellow', 'battery + wire (after the switch)'); colourRule('gnd', 'black', 'ground wire'); }
  const COLOURS = ['red', 'black', 'yellow', 'blue', 'green', 'white', 'orange', 'purple', 'grey', 'gray', 'brown', 'silver', 'light grey'];
  const odd = realW.filter(w => !COLOURS.includes(String(w.colour || '').toLowerCase()) && !/^#[0-9a-f]{6}$/i.test(String(w.colour || '')));
  if (odd.length) addResult('warn', 'wire colours the app cannot draw (use ' + COLOURS.slice(0, 11).join(', ') + ' or #rrggbb): ' + odd.map(w => w.rows[0] + ' "' + (w.colour || '') + '"').join('; '));
  const used = {}; wires.forEach(w => { used[w.from] = true; used[w.to] = true; });
  const idle = []; parts.forEach(p => p.pins.forEach(q => { const r = p.id + '.' + q.id; if (pinRole[r] && !used[r]) idle.push(r); }));
  if (idle.length) addResult('fail', 'supply / ground pins with nothing on them: ' + idle.join(', ')); else addResult('pass', 'every supply and ground pin the design names has its wire');
  const flagged = parts.filter(p => p.splice && p.splice.flags.length);
  if (flagged.length) addResult('warn', 'splices to plan: ' + flagged.map(p => p.name).join(', ')); else addResult('pass', 'no twisted splice over six conductors');
  if (unresolved.length) unresolved.forEach(u => addResult('fail', u)); else addResult('pass', 'every supply pin traces to the battery and every ground to the ground point');

  // ---- out: the app's data ------------------------------------------------------------------------------------------
  const canvas = SRC.canvas || { w: 2400, h: 1400 };
  const zones = list(SRC.zones).map(z => ({ id: z.id, name: z.name, note: z.note, x0: z.x0, y0: z.y0 != null ? z.y0 : 0, x1: z.x1, y1: z.y1 != null ? z.y1 : canvas.h }));
  const mcu = list(SRC.parts).find(p => p.mcu);
  const cfgPins = [];
  if (mcu) list(mcu.pins).map(pinOf).forEach(q => { const m = /^(GPIO|D)(\d+)$/.exec(q.id); if (m) cfgPins.push({ gpio: +m[2], name: q.config || q.id, dir: '', note: q.label }); });
  const notes = list(SRC.notes).map((x, i) => { testRef(x.pin, 'note ' + (i + 1)); return { id: 'N' + (i + 1), rows: list(x.rows).length ? list(x.rows) : ['N' + (i + 1)], pin: x.pin, text: x.text, src: x.text }; });
  const pad = v => String(v).padStart(2, '0'), d = new Date();
  const when = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  const wiring = {
    generated: when, design: { id: SRC.id, name: SRC.name, group: null, status: SRC.status || null, line: SRC.line || null },
    sources: { wiring: file, generator: 'generate.js' },
    categories: cats.map(c => ({ id: c.id, name: c.name, colour: c.colour })), systems, lengths: {},
    spliceLimits: { maxConductors: 6, maxAmps: 5.0, why: 'A twisted splice over six conductors does not solder through in the middle; a bus wire takes any number.' },
    joints: [], comps, dwires, parts,
    layout: { canvas: { w: canvas.w, h: canvas.h }, zones, outlines: list(SRC.outlines) },
    wires, notes, rows, runs: [], config: SRC.config || { pins: cfgPins, channels: [], spare: [] },
    unresolved, colours: { file: null, chosen: [], stale: [], notes: [] }
  };
  const failed = results.filter(r => r.level === 'fail').length, warnings = results.filter(r => r.level === 'warn').length;
  const check = { when, passed: results.filter(r => r.level === 'pass').length, warnings, failed, results };
  return { wiring, check };
}

window.generateWiring = generateWiring;
})();
