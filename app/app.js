/* TSAD Taxonomy — interactive explorer
 * Data: data/tsad.json (built by scripts/build_data.py), with a fallback that
 * reads taxonomy.json + methods/*.json directly, so the site also works before
 * the bundle has been built.
 */
(() => {
'use strict';

// ------------------------------------------------------------------ config
const CONFIG = {
  repo: 'boniolp/TSADtaxonomy',   // GitHub owner/repo, used for PR / issue / edit links
  branch: 'main',
};
const FAMILY_VARS = ['--fam-1', '--fam-2', '--fam-3'];

// ------------------------------------------------------------------ utils
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => (typeof u === 'string' && /^https?:\/\//i.test(u.trim())) ? u.trim() : null;
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
};
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
}
async function copyText(text, msg = 'Copied to clipboard') {
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
    ta.select(); try { document.execCommand('copy'); } catch (_) { /* ignore */ } ta.remove();
  }
  toast(msg);
}
function download(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ------------------------------------------------------------------ data
let DATA, ROOT, METHODS = [], FAMILIES = [], CATEGORIES = [], YEAR_MIN, YEAR_MAX;
const isMethod = d => !!d && ['full_name', 'Dim', 'authors'].some(k => Object.prototype.hasOwnProperty.call(d, k));
const famVar = fam => `var(${FAMILY_VARS[Math.max(0, FAMILIES.indexOf(fam))]})`;
const node = name => DATA.nodes[name];

function normalizeNode(d, name, path) {
  d._path = path;
  if (!isMethod(d)) return d;
  d.name = name;
  const dim = String(d.Dim || '').toLowerCase();
  d.Dim = dim.startsWith('multi') ? 'Multivariate' : 'Univariate';
  const sup = String(d.Sup || '').toLowerCase();
  d.Sup = sup.startsWith('semi') ? 'Semi-supervised' : sup.startsWith('sup') ? 'Supervised' : 'Unsupervised';
  if (d.bibtex && typeof d.bibtex === 'object') {
    const b = d.bibtex;
    d.bibtex = `@${b.type || 'article'}{${name},\n` + Object.entries(b)
      .filter(([k]) => !['type', 'keywords'].includes(k))
      .map(([k, v]) => `  ${k === 'authors' ? 'author' : k}={${Array.isArray(v) ? v.join(' and ') : v}}`).join(',\n') + '\n}';
  }
  d.family = path[1] || null;
  d.category = path[2] || d.category;
  return d;
}

async function loadData() {
  try {
    const r = await fetch('data/tsad.json', { cache: 'no-cache' });
    if (r.ok) return await r.json();
  } catch (e) { /* fall through */ }
  const taxonomy = await (await fetch('taxonomy.json')).json();
  const list = [];
  (function walk(n, p) { list.push([n.name, p]); (n.children || []).forEach(c => walk(c, [...p, n.name])); })(taxonomy[0], []);
  const nodes = {};
  await Promise.all(list.map(async ([name, path]) => {
    try {
      const d = await (await fetch(`methods/${encodeURIComponent(name)}.json`)).json();
      nodes[name] = normalizeNode(d, name, path);
    } catch (e) { nodes[name] = { name, text: '', _path: path }; }
  }));
  return { taxonomy, nodes };
}

function prepare() {
  ROOT = d3.hierarchy(DATA.taxonomy[0]);
  ROOT.each(h => {
    const d = DATA.nodes[h.data.name] || (DATA.nodes[h.data.name] = { name: h.data.name, text: '' });
    const path = h.ancestors().reverse().slice(0, -1).map(a => a.data.name);
    normalizeNode(d, h.data.name, path);
    d._depth = h.depth;
    d._children = (h.children || []).map(c => c.data.name);
    d._parent = h.parent ? h.parent.data.name : null;
  });
  FAMILIES = (ROOT.children || []).map(c => c.data.name);
  CATEGORIES = (ROOT.children || []).flatMap(f => (f.children || []).map(c => ({ name: c.data.name, family: f.data.name })));
  METHODS = ROOT.descendants().map(h => DATA.nodes[h.data.name]).filter(isMethod);
  METHODS.forEach(m => {
    m._search = [m.name, m.full_name, (m.authors || []).join(' '), m.paper, m.category, m.family, m.description]
      .join(' ').toLowerCase();
    m._variants = m._children.filter(n => isMethod(node(n)));
    m._parentMethod = isMethod(node(m._parent)) ? m._parent : null;
  });
  const years = METHODS.map(m => m.year).filter(Number.isFinite);
  YEAR_MIN = d3.min(years); YEAR_MAX = d3.max(years);
}

// ------------------------------------------------------------------ state + URL
const FINDER_DEFAULT = { dim: 'uni', labels: 'none', stream: 'any', code: 'yes', era: 'any' };
const state = {
  view: 'tree', q: '', fam: new Set(), cat: new Set(), dim: new Set(), sup: new Set(), stream: new Set(),
  code: false, snippet: false, y0: null, y1: null, only: false, sel: [], m: null,
  sort: { key: 'year', dir: -1 }, finder: { ...FINDER_DEFAULT },
};
const VIEWS = ['tree', 'table', 'insights', 'finder', 'contribute'];

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const set = k => new Set((p.get(k) || '').split(',').filter(Boolean));
  state.view = VIEWS.includes(p.get('view')) ? p.get('view') : 'tree';
  state.q = p.get('q') || '';
  state.fam = set('fam'); state.cat = set('cat'); state.dim = set('dim'); state.sup = set('sup'); state.stream = set('stream');
  state.code = p.get('code') === '1'; state.snippet = p.get('ex') === '1'; state.only = p.get('only') === '1';
  state.y0 = +p.get('from') || null; state.y1 = +p.get('to') || null;
  state.sel = (p.get('sel') || '').split(',').filter(n => isMethod(node(n)));
  state.m = node(p.get('m')) ? p.get('m') : null;
  const f = (p.get('f') || '').split('.');
  if (f.length === 5) state.finder = { dim: f[0], labels: f[1], stream: f[2], code: f[3], era: f[4] };
}
function writeHash(push = false) {
  const p = new URLSearchParams();
  if (state.view !== 'tree') p.set('view', state.view);
  if (state.q) p.set('q', state.q);
  for (const k of ['fam', 'cat', 'dim', 'sup', 'stream']) if (state[k].size) p.set(k, [...state[k]].join(','));
  if (state.code) p.set('code', '1');
  if (state.snippet) p.set('ex', '1');
  if (state.only) p.set('only', '1');
  if (state.y0) p.set('from', state.y0);
  if (state.y1) p.set('to', state.y1);
  if (state.sel.length) p.set('sel', state.sel.join(','));
  if (state.m) p.set('m', state.m);
  if (state.view === 'finder') p.set('f', Object.values(state.finder).join('.'));
  const h = p.toString().replace(/%2C/g, ',');
  const url = location.pathname + location.search + (h ? '#' + h : '');
  if (url === location.pathname + location.search + location.hash) return;
  history[push ? 'pushState' : 'replaceState'](null, '', url);
}

// ------------------------------------------------------------------ filtering
function searchMatch(m, q) {
  const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
  return toks.every(t => m._search.includes(t));
}
function matches(m, skip) {
  if (skip !== 'appr' && (state.fam.size || state.cat.size) && !(state.fam.has(m.family) || state.cat.has(m.category))) return false;
  if (skip !== 'dim' && state.dim.size && !state.dim.has(m.Dim)) return false;
  if (skip !== 'sup' && state.sup.size && !state.sup.has(m.Sup)) return false;
  if (skip !== 'stream' && state.stream.size && !state.stream.has(m.Stream ? 'Yes' : 'No')) return false;
  if (state.code && !safeUrl(m.code)) return false;
  if (state.snippet && !m.snippet) return false;
  if (state.y0 && m.year < state.y0) return false;
  if (state.y1 && m.year > state.y1) return false;
  if (state.q && !searchMatch(m, state.q)) return false;
  return true;
}
const filtered = () => METHODS.filter(m => matches(m));
const anyFilter = () => !!(state.q || state.fam.size || state.cat.size || state.dim.size || state.sup.size ||
  state.stream.size || state.code || state.snippet || state.y0 || state.y1);

// ------------------------------------------------------------------ facets
const FACETS = [
  { key: 'dim', title: 'Dimensionality', opts: ['Univariate', 'Multivariate'], val: m => m.Dim },
  { key: 'sup', title: 'Supervision', opts: ['Unsupervised', 'Semi-supervised', 'Supervised'], val: m => m.Sup },
  { key: 'stream', title: 'Streaming', opts: ['Yes', 'No'], val: m => (m.Stream ? 'Yes' : 'No') },
];
function buildFacets() {
  let html = '<section class="facet"><h4>Approach</h4>';
  FAMILIES.forEach(f => {
    html += `<label class="opt"><input type="checkbox" data-facet="fam" value="${esc(f)}"><span class="swatch" style="background:${famVar(f)}"></span><span>${esc(f)}</span><span class="n"></span></label>`;
    CATEGORIES.filter(c => c.family === f).forEach(c => {
      html += `<label class="opt sub"><input type="checkbox" data-facet="cat" value="${esc(c.name)}"><span>${esc(c.name)}</span><span class="n"></span></label>`;
    });
  });
  html += '</section>';
  FACETS.forEach(fc => {
    html += `<section class="facet"><h4>${fc.title}</h4>` + fc.opts.map(o =>
      `<label class="opt"><input type="checkbox" data-facet="${fc.key}" value="${esc(o)}"><span>${esc(o)}</span><span class="n"></span></label>`).join('') + '</section>';
  });
  $('#facet-groups').innerHTML = html;
  $('#facet-groups').addEventListener('change', e => {
    const i = e.target; if (!i.dataset.facet) return;
    const s = state[i.dataset.facet];
    i.checked ? s.add(i.value) : s.delete(i.value);
    update();
  });
  $('#year-min').placeholder = YEAR_MIN; $('#year-max').placeholder = YEAR_MAX;
  const yr = debounce(() => { state.y0 = +$('#year-min').value || null; state.y1 = +$('#year-max').value || null; update(); }, 300);
  $('#year-min').addEventListener('input', yr); $('#year-max').addEventListener('input', yr);
  $('#f-code').addEventListener('change', e => { state.code = e.target.checked; update(); });
  $('#f-snippet').addEventListener('change', e => { state.snippet = e.target.checked; update(); });
  $('#reset-filters').addEventListener('click', resetFilters);
}
function resetFilters() {
  state.q = ''; $('#search').value = '';
  ['fam', 'cat', 'dim', 'sup', 'stream'].forEach(k => state[k].clear());
  state.code = state.snippet = false; state.y0 = state.y1 = null;
  update();
}
function renderFacets() {
  $$('#facet-groups input[data-facet]').forEach(i => {
    const k = i.dataset.facet, v = i.value;
    i.checked = state[k].has(v);
    let n;
    if (k === 'fam') n = METHODS.filter(m => matches(m, 'appr') && m.family === v).length;
    else if (k === 'cat') n = METHODS.filter(m => matches(m, 'appr') && m.category === v).length;
    else { const fc = FACETS.find(f => f.key === k); n = METHODS.filter(m => matches(m, k) && fc.val(m) === v).length; }
    const lab = i.closest('.opt'); lab.querySelector('.n').textContent = n; lab.classList.toggle('zero', n === 0);
  });
  $('#year-min').value = state.y0 || ''; $('#year-max').value = state.y1 || '';
  $('#f-code').checked = state.code; $('#f-snippet').checked = state.snippet;
  $('#match-count').textContent = anyFilter() ? `${filtered().length} / ${METHODS.length}` : METHODS.length;
  $('#reset-filters').hidden = !anyFilter();
}

// ------------------------------------------------------------------ tree view
const T = { ROW: 18, COLS: [16, 120, 270], X0: 440, TOP: 52 };
const tree = { t: null, x: null, W: 0, H: 0, fitted: false };
const tip = $('#tip');
document.body.appendChild(tip);

function showTip(ev, html) {
  tip.innerHTML = html; tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
const hideTip = () => { tip.hidden = true; };

function setupTree() {
  const svg = d3.select('#tree-svg');
  tree.svg = svg;
  tree.gZoom = svg.append('g').attr('class', 't-zoom');
  tree.gAxis = svg.append('g').attr('class', 't-axis');
  tree.zoom = d3.zoom().scaleExtent([0.2, 3])
    .filter(ev => (ev.type === 'wheel' ? ev.ctrlKey : !ev.button))
    .on('zoom', ev => { tree.t = ev.transform; tree.gZoom.attr('transform', ev.transform); drawAxis(); });
  svg.call(tree.zoom).on('dblclick.zoom', null);
  svg.on('wheel.pan', ev => {
    if (ev.ctrlKey) return;
    ev.preventDefault();
    const k = (tree.t || d3.zoomIdentity).k;
    tree.zoom.translateBy(svg, -ev.deltaX / k, -ev.deltaY / k);
  }, { passive: false });
  $('#zoom-in').onclick = () => tree.zoom.scaleBy(svg.transition().duration(200), 1.3);
  $('#zoom-out').onclick = () => tree.zoom.scaleBy(svg.transition().duration(200), 1 / 1.3);
  $('#zoom-fit').onclick = () => fitTree(true);
  $('#only-matches').onchange = e => { state.only = e.target.checked; update(); };
  $('#export-svg').onclick = exportSVG;
  $('#tree-legend').innerHTML = FAMILIES.map(f => `<span><span class="swatch" style="background:${famVar(f)}"></span>${esc(f)}</span>`).join('')
    + '<span><svg width="14" height="14"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>has variants</span>';
}

function layoutTree() {
  const match = new Set(filtered().map(m => m.name));
  const keep = new Set();
  if (state.only) match.forEach(n => { let c = n; while (c) { keep.add(c); c = node(c)._parent; } });
  const root = d3.hierarchy(DATA.taxonomy[0], d => {
    const ch = d.children || [];
    return state.only ? ch.filter(c => keep.has(c.name)) : ch;
  });
  if (state.only) root.each(h => { if (h.depth < 3 && !keep.has(h.data.name) && h.parent) h.hidden = true; });

  // one row per method, in taxonomy (pre-order) order
  const years = METHODS.map(m => m.year);
  const y0 = Math.floor(d3.min(years) / 5) * 5, y1 = Math.ceil((d3.max(years) + 1) / 5) * 5;
  const span = Math.max(640, (y1 - y0) * 17);
  const x = d3.scaleLinear().domain([y0, y1]).range([T.X0, T.X0 + span]);
  let row = 0;
  root.eachBefore(h => {
    const d = node(h.data.name);
    h.info = d;
    if (isMethod(d)) { h.y = T.TOP + row * T.ROW; h.x = x(d.year); row++; }
  });
  root.eachAfter(h => {
    if (!isMethod(h.info)) {
      const ys = (h.children || []).map(c => c.y).filter(v => v != null);
      h.y = ys.length ? (d3.min(ys) + d3.max(ys)) / 2 : T.TOP;
      h.x = T.COLS[Math.min(h.depth, 2)];
    }
  });
  tree.x = x; tree.y0 = y0; tree.y1 = y1;
  tree.W = T.X0 + span + 150; tree.H = T.TOP + Math.max(row, 1) * T.ROW + 30;
  return { root, match };
}

function renderTree() {
  const { root, match } = layoutTree();
  const g = tree.gZoom; g.selectAll('*').remove();
  const hasFilter = anyFilter();
  const nodes = root.descendants();
  // which categories contain a match
  const catHas = new Set();
  match.forEach(n => { let c = n; while (c) { catHas.add(c); c = node(c)._parent; } });
  const isDim = h => hasFilter && (isMethod(h.info) ? !match.has(h.data.name) : (!state.only && !catHas.has(h.data.name)));

  // year bands
  const bands = g.append('g');
  for (let yr = tree.y0; yr < tree.y1; yr += 5) {
    if (((yr - tree.y0) / 5) % 2) continue;
    bands.append('rect').attr('class', 't-band').attr('x', tree.x(yr)).attr('y', 0)
      .attr('width', tree.x(yr + 5) - tree.x(yr)).attr('height', tree.H);
  }

  // links
  const link = d3.linkHorizontal().x(d => d.x).y(d => d.y);
  g.append('g').selectAll('path').data(root.links()).join('path')
    .attr('class', d => 't-link' + (isDim(d.target) ? ' dim' : ''))
    .attr('data-t', d => d.target.data.name)
    .attr('d', d => link({ source: { x: d.source.x + (isMethod(d.source.info) ? 0 : 0), y: d.source.y }, target: d.target }));

  // nodes
  const ng = g.append('g').selectAll('g').data(nodes).join('g')
    .attr('class', h => {
      const c = ['t-node'];
      if (!isMethod(h.info)) c.push('cat', h.depth === 0 ? 'root' : h.depth === 1 ? 'lvl1' : 'lvl2');
      if (isDim(h)) c.push('dim');
      if (state.q && isMethod(h.info) && match.has(h.data.name)) c.push('hit');
      if (state.sel.includes(h.data.name)) c.push('sel');
      if (state.m === h.data.name) c.push('active');
      return c.join(' ');
    })
    .attr('transform', h => `translate(${h.x},${h.y})`)
    .attr('tabindex', 0).attr('role', 'button')
    .attr('aria-label', h => h.info.full_name ? `${h.data.name}: ${h.info.full_name}` : h.data.name);

  ng.each(function (h) {
    const s = d3.select(this);
    const d = h.info;
    const fam = h.depth === 0 ? null : (h.ancestors().reverse()[1] || h).data.name;
    const col = fam ? famVar(fam) : 'var(--text-2)';
    if (isMethod(d)) {
      if (state.sel.includes(d.name)) s.append('circle').attr('class', 'ring').attr('r', 9);
      const hl = s.append('rect').attr('class', 'hlbox').attr('rx', 3).attr('fill', 'none');
      if (d._variants.length) s.append('circle').attr('class', 'dot').attr('r', 5.5).style('fill', 'var(--surface)').style('stroke', col).style('stroke-width', '2.5px');
      else s.append('circle').attr('class', 'dot').attr('r', 4.5).style('fill', col);
      const t = s.append('text').attr('x', 9).attr('dy', '.35em').text(d.name);
      if (s.classed('hit')) { const b = t.node().getBBox(); hl.attr('x', b.x - 3).attr('y', b.y - 1).attr('width', b.width + 6).attr('height', b.height + 2); }
    } else {
      const label = h.depth === 0 ? 'TSAD methods' : d.name;
      const pill = s.append('rect').attr('class', 'pill').attr('rx', 8).style('stroke', col);
      let tx = 0;
      if (h.depth === 2) {
        s.append('rect').attr('class', 'icon').attr('x', -2).attr('y', -15).attr('width', 30).attr('height', 30).attr('rx', 6).style('fill', '#fff');
        s.append('image').attr('href', `method_icons/${encodeURIComponent(d.name)}.png`).attr('x', 0).attr('y', -13).attr('width', 26).attr('height', 26);
        tx = 34;
      }
      const t = s.append('text').attr('x', tx + 8).attr('dy', '.35em').text(label).style('fill', h.depth ? col : 'var(--text)');
      const b = t.node().getBBox();
      pill.attr('x', -6).attr('y', Math.min(b.y, h.depth === 2 ? -19 : b.y) - (h.depth === 2 ? 0 : 6))
        .attr('width', b.x + b.width + 14).attr('height', h.depth === 2 ? 38 : b.height + 12);
      if (h.depth === 2) s.select('.icon').raise(); s.select('image').raise(); t.raise();
    }
  });

  ng.on('click', (ev, h) => openNode(h.data.name))
    .on('keydown', (ev, h) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openNode(h.data.name); } })
    .on('mouseenter', (ev, h) => {
      const anc = new Set(h.ancestors().map(a => a.data.name));
      g.selectAll('.t-link').classed('hot', function () { return anc.has(this.dataset.t); });
      const d = h.info;
      showTip(ev, isMethod(d)
        ? `<b>${esc(d.name)}</b> · ${d.year}<br>${esc(d.full_name || '')}<div class="muted" style="margin-top:4px">${esc(d.Dim)} · ${esc(d.Sup)}${d.Stream ? ' · Streaming' : ''}${safeUrl(d.code) ? ' · Code' : ''}</div>`
        : `<b>${esc(d.name)}</b><br><span class="muted">${countUnder(d.name)} methods · click for description</span>`);
    })
    .on('mousemove', (ev) => { tip.style.left = Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = Math.min(ev.clientY + 14, innerHeight - tip.offsetHeight - 8) + 'px'; })
    .on('mouseleave', () => { g.selectAll('.t-link').classed('hot', false); hideTip(); });

  const wrap = $('#tree-wrap');
  tree.zoom.extent([[0, 0], [wrap.clientWidth, wrap.clientHeight]])
    .translateExtent([[-300, -200], [tree.W + 300, tree.H + 300]]);
  if (!tree.fitted && wrap.clientWidth) { fitTree(false); tree.fitted = true; }
  drawAxis();
}
function countUnder(name) {
  let n = 0; (function w(c) { node(c)._children.forEach(k => { if (isMethod(node(k))) n++; w(k); }); })(name); return n;
}
function fitTree(animate) {
  const wrap = $('#tree-wrap'); if (!wrap.clientWidth) return;
  const k = Math.max(0.8, Math.min(1.15, wrap.clientWidth / tree.W));
  const t = d3.zoomIdentity.translate(8, 8).scale(k);
  (animate ? tree.svg.transition().duration(300) : tree.svg).call(tree.zoom.transform, t);
}
function focusTreeNode(name) {
  const g = tree.gZoom.selectAll('.t-node').filter(h => h.data.name === name);
  if (g.empty()) return;
  const h = g.datum(), wrap = $('#tree-wrap');
  const k = Math.max((tree.t || d3.zoomIdentity).k, 0.8);
  const t = d3.zoomIdentity.translate(Math.min(8, wrap.clientWidth * 0.45 - h.x * k), Math.min(8, wrap.clientHeight * 0.4 - h.y * k)).scale(k);
  tree.svg.transition().duration(450).call(tree.zoom.transform, t);
}
function drawAxis() {
  if (!tree.x) return;
  const t = tree.t || d3.zoomIdentity;
  const xs = t.rescaleX(tree.x);
  const W = $('#tree-wrap').clientWidth;
  const ticks = d3.range(tree.y0, tree.y1 + 1, t.k < 0.7 ? 10 : 5).filter(y => xs(y) > T.X0 * 0 && xs(y) < W + 20);
  const a = tree.gAxis.attr('transform', 'translate(0,22)');
  a.selectAll('rect.axbg').data([0]).join('rect').attr('class', 'axbg').attr('x', 0).attr('y', -22).attr('width', W).attr('height', 30).style('fill', 'var(--surface)').style('opacity', .92);
  a.call(d3.axisTop(xs).tickValues(ticks).tickFormat(d3.format('d')).tickSizeOuter(0));
  a.select('.domain').remove();
  a.selectAll('rect.axbg').lower();
}

async function exportSVG() {
  const { root } = layoutTree(); // ensure scale is current
  const NS = 'http://www.w3.org/2000/svg';
  const out = document.createElementNS(NS, 'svg');
  out.setAttribute('xmlns', NS);
  out.setAttribute('viewBox', `0 0 ${tree.W} ${tree.H}`);
  out.setAttribute('width', tree.W); out.setAttribute('height', tree.H);
  const css = `text{font-family:Inter,Helvetica,Arial,sans-serif;font-size:12px;fill:var(--text);paint-order:stroke;stroke:var(--surface);stroke-width:3px;stroke-linejoin:round}
.t-band{fill:var(--band)}.t-link{fill:none;stroke:var(--link);stroke-width:1.5px}.t-link.dim,.t-node.dim{opacity:.18}
.t-node.cat text{font-weight:600}.t-node.root text{font-size:15px}.t-node.lvl1 text{font-size:14px}.t-node.cat .pill{fill:var(--panel);stroke-width:1.5px}
.t-node .dot{stroke:var(--surface);stroke-width:2px}.t-node.hit text{font-weight:700}.t-node.hit .hlbox{fill:var(--hl)}.t-node.sel .ring{stroke:var(--accent);stroke-width:2px;fill:none}
.t-axis text{fill:var(--muted);font-size:11px;stroke:none}.t-axis line{stroke:var(--border-strong)}`;
  const style = document.createElementNS(NS, 'style'); style.textContent = css; out.appendChild(style);
  const bg = document.createElementNS(NS, 'rect'); bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', 'var(--surface)'); out.appendChild(bg);
  const g = tree.gZoom.node().cloneNode(true); g.removeAttribute('transform'); out.appendChild(g);
  g.querySelectorAll('.ring').forEach(r => r.remove());
  g.querySelectorAll('.active').forEach(n => n.classList.remove('active'));
  const ax = d3.select(out).append('g').attr('class', 't-axis').attr('transform', 'translate(0,22)')
    .call(d3.axisTop(tree.x).tickValues(d3.range(tree.y0, tree.y1 + 1, 5)).tickFormat(d3.format('d')).tickSizeOuter(0));
  ax.select('.domain').remove();
  // inline category icons so the file is self-contained
  await Promise.all([...out.querySelectorAll('image')].map(async im => {
    try {
      const blob = await (await fetch(im.getAttribute('href'))).blob();
      const uri = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
      im.setAttribute('href', uri);
    } catch (e) { /* keep relative href */ }
  }));
  let text = new XMLSerializer().serializeToString(out);
  text = text.replace(/var\((--[\w-]+)\)/g, (_, n) => cssVar(n) || '#888');
  download(`tsad-taxonomy${anyFilter() ? '-filtered' : ''}.svg`, text, 'image/svg+xml');
}

// ------------------------------------------------------------------ table view
const COLS = {
  name: m => m.name.toLowerCase(), year: m => m.year, category: m => `${m.family} ${m.category}`,
  Dim: m => m.Dim, Sup: m => m.Sup, Stream: m => (m.Stream ? 0 : 1), code: m => (safeUrl(m.code) ? 0 : 1),
};
function setupTable() {
  $$('#mtable th[data-sort]').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (k === 'year' ? -1 : 1) };
    renderTable();
  }));
  $('#mtable tbody').addEventListener('click', e => {
    const tr = e.target.closest('tr'); if (!tr) return;
    if (e.target.matches('input[type=checkbox]')) { toggleSel(tr.dataset.name); return; }
    if (e.target.closest('a')) return;
    openNode(tr.dataset.name);
  });
  $('#sel-all').addEventListener('change', e => {
    const names = filtered().map(m => m.name);
    if (e.target.checked) state.sel = [...new Set([...state.sel, ...names])];
    else state.sel = state.sel.filter(n => !names.includes(n));
    update();
  });
  $('#export-csv').onclick = () => {
    const cols = ['name', 'full_name', 'year', 'family', 'category', 'Dim', 'Sup', 'Stream', 'authors', 'paper', 'url', 'code'];
    const q = v => `"${String(Array.isArray(v) ? v.join('; ') : v ?? '').replace(/"/g, '""')}"`;
    download('tsad-methods.csv', [cols.join(','), ...sorted(filtered()).map(m => cols.map(c => q(m[c])).join(','))].join('\n'), 'text/csv');
  };
  $('#export-bib').onclick = () => download('tsad-methods.bib', bibOf(sorted(filtered())), 'application/x-bibtex');
  $('#export-json').onclick = () => download('tsad-methods.json', JSON.stringify(sorted(filtered()).map(clean), null, 2), 'application/json');
}
const clean = m => Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith('_')));
const bibOf = ms => ms.map(m => (m.bibtex || '').trim()).filter(Boolean).join('\n\n') + '\n';
function sorted(ms) {
  const { key, dir } = state.sort, f = COLS[key];
  return [...ms].sort((a, b) => d3.ascending(f(a), f(b)) * dir || d3.ascending(a.name, b.name));
}
function renderTable() {
  const ms = sorted(filtered());
  $$('#mtable th[data-sort]').forEach(th => { th.classList.toggle('asc', th.dataset.sort === state.sort.key && state.sort.dir > 0); th.classList.toggle('desc', th.dataset.sort === state.sort.key && state.sort.dir < 0); });
  $('#mtable tbody').innerHTML = ms.map(m => `<tr data-name="${esc(m.name)}">
    <td class="c-sel"><input type="checkbox" ${state.sel.includes(m.name) ? 'checked' : ''} aria-label="Select ${esc(m.name)}"></td>
    <td><div class="m-name">${esc(m.name)}</div><div class="m-full">${esc(m.full_name || '')}</div></td>
    <td class="num">${m.year}</td>
    <td><span class="cat-cell"><span class="swatch" style="background:${famVar(m.family)}"></span>${esc(m.category)}</span></td>
    <td>${esc(m.Dim)}</td><td>${esc(m.Sup)}</td>
    <td class="${m.Stream ? 'yes' : 'no'}">${m.Stream ? 'Yes' : 'No'}</td>
    <td>${safeUrl(m.code) ? `<a href="${esc(safeUrl(m.code))}" target="_blank" rel="noopener">Code ↗</a>` : '<span class="no">—</span>'}</td>
  </tr>`).join('') || `<tr><td colspan="8" class="muted" style="padding:24px;text-align:center">No method matches these filters. <button class="link-btn" data-reset>Reset filters</button></td></tr>`;
  const inSel = ms.filter(m => state.sel.includes(m.name)).length;
  $('#sel-all').checked = ms.length > 0 && inSel === ms.length;
  $('#sel-all').indeterminate = inSel > 0 && inSel < ms.length;
  $('#table-summary').textContent = `${plural(ms.length, 'method')}${state.sel.length ? ` · ${state.sel.length} selected` : ''} — export the list shown:`;
}

// ------------------------------------------------------------------ insights view
function renderInsights() {
  const ms = filtered();
  const pct = (a, b) => (b ? Math.round(100 * a / b) : 0);
  const withCode = ms.filter(m => safeUrl(m.code)).length;
  const tiles = [
    [ms.length, 'methods'],
    [new Set(ms.map(m => m.category)).size, 'categories covered'],
    [ms.length ? `${pct(withCode, ms.length)}%` : '–', 'with public code'],
    [ms.length ? `${pct(ms.filter(m => m.Stream).length, ms.length)}%` : '–', 'support streaming'],
    [ms.length ? `${d3.min(ms, m => m.year)}–${d3.max(ms, m => m.year)}` : '–', 'publication years'],
  ];
  $('#tiles').innerHTML = tiles.map(([v, l]) => `<div class="tile"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  $('#leg-period').innerHTML = FAMILIES.map(f => `<span><span class="swatch" style="background:${famVar(f)}"></span>${esc(f)}</span>`).join('');
  chartPeriod(ms); chartCategory(ms); chartShares(ms);
}
const binStart = y => Math.floor(y / 5) * 5;
function bins() { return d3.range(binStart(YEAR_MIN), binStart(YEAR_MAX) + 1, 5); }
function roundedTop(x, y, w, h, r) {
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
function chartPeriod(ms) {
  const el = $('#ch-period'), W = el.clientWidth || 800, H = 260, M = { t: 18, r: 8, b: 26, l: 32 };
  const B = bins();
  const rows = B.map(b => { const r = { bin: b }; FAMILIES.forEach(f => { r[f] = ms.filter(m => binStart(m.year) === b && m.family === f).length; }); r.total = FAMILIES.reduce((s, f) => s + r[f], 0); return r; });
  const x = d3.scaleBand().domain(B).range([M.l, W - M.r]).padding(0.28);
  const y = d3.scaleLinear().domain([0, Math.max(4, d3.max(rows, r => r.total))]).nice().range([H - M.b, M.t]);
  const svg = d3.create('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Stacked bar chart of methods per five-year period by approach');
  svg.append('g').attr('class', 'grid').attr('transform', `translate(${M.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(W - M.l - M.r)).tickFormat(''));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(${M.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(6)).select('.domain').remove();
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - M.b})`).call(d3.axisBottom(x).tickSize(0).tickPadding(8).tickFormat(b => (x.bandwidth() > 34 ? `${b}–${String(b + 4).slice(2)}` : `${b}`)));
  const stack = d3.stack().keys(FAMILIES)(rows);
  const g = svg.append('g');
  rows.forEach((r, i) => {
    const top = [...FAMILIES].reverse().find(f => r[f] > 0);
    const col = g.append('g').attr('class', 'bar')
      .on('mousemove', ev => showTip(ev, `<b>${r.bin}–${r.bin + 4}</b> · ${plural(r.total, 'method')}<br>` + FAMILIES.map(f => `<span class="swatch" style="display:inline-block;background:${famVar(f)}"></span> ${esc(f)}: ${r[f]}`).join('<br>') + '<br><span class="muted">Click to filter to this period</span>'))
      .on('mouseleave', hideTip)
      .on('click', () => { state.y0 = r.bin; state.y1 = r.bin + 4; hideTip(); update(); });
    col.append('rect').attr('x', x(r.bin) - 4).attr('width', x.bandwidth() + 8).attr('y', M.t).attr('height', H - M.b - M.t).attr('fill', 'transparent');
    FAMILIES.forEach((f, k) => {
      const [a, b] = stack[k][i]; if (b - a <= 0) return;
      const yy = y(b), hh = y(a) - y(b) - (a > 0 ? 2 : 0);
      col.append('path').attr('d', f === top ? roundedTop(x(r.bin), yy, x.bandwidth(), hh, 4) : `M${x(r.bin)},${yy}h${x.bandwidth()}v${hh}h${-x.bandwidth()}Z`).style('fill', famVar(f));
    });
    if (r.total) col.append('text').attr('class', 'lbl').attr('x', x(r.bin) + x.bandwidth() / 2).attr('y', y(r.total) - 5).attr('text-anchor', 'middle').text(r.total);
  });
  el.replaceChildren(svg.node());
}
function chartCategory(ms) {
  const el = $('#ch-cat'), W = el.clientWidth || 400, rowH = 26, M = { t: 4, r: 36, b: 4, l: 138 };
  const rows = CATEGORIES.map(c => ({ ...c, n: ms.filter(m => m.category === c.name).length }));
  const H = M.t + M.b + rows.length * rowH;
  const x = d3.scaleLinear().domain([0, Math.max(4, d3.max(rows, r => r.n))]).range([M.l, W - M.r]);
  const svg = d3.create('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Bar chart of methods per category');
  rows.forEach((r, i) => {
    const yy = M.t + i * rowH;
    const g = svg.append('g').attr('class', 'bar')
      .on('mousemove', ev => showTip(ev, `<b>${esc(r.name)}</b> (${esc(r.family)})<br>${plural(r.n, 'method')}<br><span class="muted">Click to toggle this filter</span>`))
      .on('mouseleave', hideTip)
      .on('click', () => { state.cat.has(r.name) ? state.cat.delete(r.name) : state.cat.add(r.name); hideTip(); update(); });
    g.append('rect').attr('x', 0).attr('y', yy).attr('width', W).attr('height', rowH).attr('fill', 'transparent');
    g.append('text').attr('x', M.l - 8).attr('y', yy + rowH / 2).attr('dy', '.35em').attr('text-anchor', 'end').text(r.name)
      .style('font-weight', state.cat.has(r.name) ? 700 : 400);
    const w = x(r.n) - M.l;
    if (w > 0) g.append('path').attr('d', `M${M.l},${yy + 5}h${Math.max(0, w - 4)}q4,0 4,4v${rowH - 18}q0,4 -4,4h${-Math.max(0, w - 4)}Z`).style('fill', famVar(r.family));
    g.append('text').attr('class', 'lbl').attr('x', x(r.n) + 6).attr('y', yy + rowH / 2).attr('dy', '.35em').text(r.n);
  });
  el.replaceChildren(svg.node());
}
const MIN_BIN = 3; // periods with fewer methods are too noisy to report a share
function chartShares(ms) {
  const el = $('#ch-share'), W = el.clientWidth || 400, H = 58, M = { l: 4, r: 40, t: 6, b: 4 };
  const B = bins();
  const defs = [
    ['Multivariate', m => m.Dim === 'Multivariate'],
    ['Unsupervised', m => m.Sup === 'Unsupervised'],
    ['Streaming', m => m.Stream],
    ['With public code', m => !!safeUrl(m.code)],
  ];
  const x = d3.scalePoint().domain(B).range([M.l + 4, W - M.r]);
  const y = d3.scaleLinear().domain([0, 1]).range([H - M.b, M.t]);
  el.replaceChildren();
  defs.forEach(([label, fn]) => {
    const pts = B.map(b => { const inb = ms.filter(m => binStart(m.year) === b); return { b, n: inb.length, k: inb.filter(fn).length }; }).filter(p => p.n >= MIN_BIN);
    const wrap = document.createElement('div');
    const last = pts[pts.length - 1];
    wrap.innerHTML = `<div class="mh"><span>${label}</span><b>${last ? Math.round(100 * last.k / last.n) + '% in ' + last.b + '–' + (last.b + 4) : '–'}</b></div>`;
    const svg = d3.create('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', `Share of ${label} methods per period`);
    svg.append('line').attr('x1', M.l).attr('x2', W - M.r).attr('y1', y(0.5)).attr('y2', y(0.5)).style('stroke', 'var(--border)').style('stroke-dasharray', '2 3');
    svg.append('text').attr('x', W - M.r + 6).attr('y', y(0.5)).attr('dy', '.35em').text('50%');
    if (pts.length) {
      svg.append('path').attr('class', 'spark-area').attr('d', d3.area().x(p => x(p.b)).y0(y(0)).y1(p => y(p.k / p.n))(pts));
      svg.append('path').attr('class', 'spark-line').attr('d', d3.line().x(p => x(p.b)).y(p => y(p.k / p.n))(pts));
      svg.append('circle').attr('class', 'spark-dot').attr('r', 4).attr('cx', x(last.b)).attr('cy', y(last.k / last.n));
      const step = pts.length > 1 ? (x(pts[1].b) - x(pts[0].b)) : W;
      svg.append('g').selectAll('rect').data(pts).join('rect')
        .attr('x', p => x(p.b) - step / 2).attr('width', step).attr('y', 0).attr('height', H).attr('fill', 'transparent')
        .on('mousemove', (ev, p) => showTip(ev, `<b>${p.b}–${p.b + 4}</b><br>${label}: ${Math.round(100 * p.k / p.n)}% (${p.k} of ${p.n})`))
        .on('mouseleave', hideTip);
    }
    wrap.appendChild(svg.node());
    el.appendChild(wrap);
  });
}

// ------------------------------------------------------------------ finder
const FQ = [
  { key: 'dim', label: 'Your time series is…', opts: [['uni', 'Univariate'], ['multi', 'Multivariate']] },
  { key: 'labels', label: 'What training data do you have?', help: 'Semi-supervised methods learn “normal” behaviour from a clean segment.', opts: [['none', 'Nothing, just the series'], ['normal', 'A clean, anomaly-free segment'], ['labels', 'Labeled anomalies']] },
  { key: 'stream', label: 'Must it run online, on streaming data?', opts: [['any', 'No / not sure'], ['yes', 'Yes']] },
  { key: 'code', label: 'Need an open-source implementation?', opts: [['yes', 'Yes'], ['any', 'Not required']] },
  { key: 'era', label: 'Preference', opts: [['any', 'None'], ['classic', 'Established, lightweight'], ['recent', 'Recent (2020+)']] },
];
function setupFinder() {
  $('#finder-questions').innerHTML = FQ.map(q => `<div class="q"><div class="qlabel">${q.label}</div>${q.help ? `<div class="qhelp">${q.help}</div>` : ''}
    <div class="seg" data-q="${q.key}">${q.opts.map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('')}</div></div>`).join('');
  $('#finder-questions').addEventListener('click', e => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    state.finder[b.parentElement.dataset.q] = b.dataset.v; writeHash(); renderFinder();
  });
  $('#finder-out').addEventListener('click', e => {
    if (e.target.closest('[data-apply]')) { applyFinderAsFilters(); return; }
    if (e.target.closest('[data-more]')) { renderFinder(true); return; }
    const c = e.target.closest('[data-name]'); if (c) openNode(c.dataset.name);
  });
}
function scoreMethods() {
  const f = state.finder, out = [];
  for (const m of METHODS) {
    const why = []; let s = 0;
    if (f.stream === 'yes' && !m.Stream) continue;
    if (f.code === 'yes' && !safeUrl(m.code)) continue;
    if (m.Sup === 'Supervised' && f.labels !== 'labels') continue;
    if (f.dim === 'uni') { s += m.Dim === 'Univariate' ? 2 : 1.5; why.push([`${m.Dim}`, 'good']); }
    else if (m.Dim === 'Multivariate') { s += 2; why.push(['Multivariate', 'good']); }
    else { s += 0.3; why.push(['Univariate: run per channel', 'warn']); }
    if (m.Sup === 'Unsupervised') { s += 2; why.push(['No labels needed', 'good']); }
    else if (m.Sup === 'Semi-supervised') {
      if (f.labels === 'none') { s += 0.2; why.push(['Needs clean training data', 'warn']); }
      else { s += 2; why.push(['Uses your clean training data', 'good']); }
    } else { s += 2; why.push(['Uses your labels', 'good']); }
    if (m.Stream) { s += f.stream === 'yes' ? 1 : 0.2; if (f.stream === 'yes') why.push(['Streaming', 'good']); }
    if (safeUrl(m.code)) { s += 0.5; why.push(['Public code', 'good']); }
    if (m.snippet) { s += 0.6; why.push(['Ready-to-run example', 'good']); }
    if (m._variants.length) { s += Math.min(0.6, 0.15 * m._variants.length); why.push([`${plural(m._variants.length, 'variant')}`, '']); }
    if (f.era === 'recent') { if (m.year >= 2020) s += 1.5; else if (m.year < 2015) s -= 1; }
    if (f.era === 'classic') { if (m.year < 2015) s += 1.2; else if (m.year >= 2020) s -= 0.8; }
    out.push({ m, s, why });
  }
  return out.sort((a, b) => b.s - a.s || b.m.year - a.m.year);
}
function renderFinder(all = false) {
  $$('#finder-questions .seg').forEach(seg => $$('button', seg).forEach(b => b.setAttribute('aria-pressed', String(state.finder[seg.dataset.q] === b.dataset.v))));
  const res = scoreMethods();
  const shown = all ? res : res.slice(0, 12);
  $('#finder-out').innerHTML = `<div class="toolbar"><div><strong>${plural(res.length, 'candidate')}</strong> <span class="muted">ranked by fit</span></div>
    <button class="btn" data-apply>Show these in the taxonomy</button></div>` +
    (shown.map(({ m, why }, i) => `<article class="rcard" data-name="${esc(m.name)}">
      <div class="rank">${i + 1}</div>
      <div class="t">${esc(m.name)} <span class="muted">· ${esc(m.full_name || '')} · ${m.year}</span></div>
      <span class="cat-cell small"><span class="swatch" style="background:${famVar(m.family)}"></span>${esc(m.category)}</span>
      <div class="chips">${why.map(([w, c]) => `<span class="chip ${c}">${esc(w)}</span>`).join('')}</div>
      <div class="blurb">${esc(m.description || '')}</div>
    </article>`).join('') || '<p class="muted">No method fits all constraints. Try relaxing “streaming” or “open-source”.</p>') +
    (!all && res.length > shown.length ? `<button class="btn" data-more>Show all ${res.length}</button>` : '');
}
function applyFinderAsFilters() {
  const f = state.finder;
  ['fam', 'cat', 'dim', 'sup', 'stream'].forEach(k => state[k].clear());
  state.q = ''; $('#search').value = '';
  if (f.dim === 'multi') state.dim.add('Multivariate');
  if (f.labels === 'none') state.sup.add('Unsupervised');
  if (f.labels === 'normal') { state.sup.add('Unsupervised'); state.sup.add('Semi-supervised'); }
  if (f.stream === 'yes') state.stream.add('Yes');
  state.code = f.code === 'yes';
  state.y0 = f.era === 'recent' ? 2020 : null; state.y1 = f.era === 'classic' ? 2014 : null;
  state.snippet = false;
  setView('tree');
}

// ------------------------------------------------------------------ drawer
function openNode(name, { focus = false } = {}) {
  if (!node(name)) return;
  const wasOpen = !!state.m;
  state.m = name; writeHash(true); renderDrawer(); markActive();
  if (!wasOpen && state.view === 'insights') renderInsights();
  if (focus && state.view === 'tree') focusTreeNode(name);
}
function closeDrawer() { state.m = null; writeHash(); renderDrawer(); markActive(); if (state.view === 'insights') renderInsights(); }
function markActive() {
  if (tree.gZoom) tree.gZoom.selectAll('.t-node').classed('active', h => h.data.name === state.m);
}
function crumbs(d) {
  return (d._path || []).map(p => `<button data-open="${esc(p)}">${esc(p === 'TSAD' ? 'All methods' : p)}</button>`).join(' › ');
}
function renderDrawer() {
  const dr = $('#drawer'), d = state.m && node(state.m);
  if (!d) { dr.hidden = true; return; }
  dr.hidden = false;
  const b = $('#drawer-body');
  if (!isMethod(d)) {
    const under = [];
    (function w(c) { node(c)._children.forEach(k => { if (isMethod(node(k))) under.push(node(k)); w(k); }); })(d.name);
    const isCatFilter = d._depth === 1 || d._depth === 2;
    b.innerHTML = `<div class="crumbs">${crumbs(d)}</div>
      <h2>${d._depth === 2 ? `<img src="method_icons/${encodeURIComponent(d.name)}.png" alt="" width="36" height="36" style="background:#fff;border-radius:6px">` : ''}${esc(d._depth === 0 ? 'Time-series anomaly detection' : d.name)}</h2>
      <p class="full">${plural(under.length, 'method')}</p>
      <p class="desc">${esc(d.text || '')}</p>
      ${isCatFilter ? `<div class="links"><button class="btn primary" data-filter-cat>Show only ${esc(d.name)} methods</button></div>` : ''}
      <section><h4>Methods</h4><div class="chips">${under.sort((a, b) => a.year - b.year).map(m => `<button class="chip" data-open="${esc(m.name)}">${esc(m.name)} <span class="muted">${m.year}</span></button>`).join('')}</div></section>`;
  } else {
    const sel = state.sel.includes(d.name);
    const code = safeUrl(d.code), url = safeUrl(d.url);
    const siblings = (node(d._parent)?._children || []).filter(n => n !== d.name && isMethod(node(n)));
    b.innerHTML = `<div class="crumbs">${crumbs(d)}</div>
      <h2><span class="swatch" style="background:${famVar(d.family)};width:12px;height:12px"></span>${esc(d.name)}</h2>
      <p class="full">${esc(d.full_name || '')}</p>
      <div class="chips">
        <span class="chip">${d.year}</span><span class="chip">${esc(d.Dim)}</span><span class="chip">${esc(d.Sup)}</span>
        <span class="chip">${d.Stream ? 'Streaming' : 'Batch'}</span>${code ? '<span class="chip good">Public code</span>' : ''}
      </div>
      <div class="links">
        ${url ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Paper ↗</a>` : ''}
        ${code ? `<a class="btn" href="${esc(code)}" target="_blank" rel="noopener">Code ↗</a>` : ''}
        <button class="btn ${sel ? 'on' : ''}" data-toggle-sel>${sel ? '✓ Selected' : '+ Compare / cite'}</button>
        <button class="btn ghost" data-copy-link title="Copy a link to this method">Copy link</button>
      </div>
      <section><p class="desc">${esc(d.description || 'No description yet.')}</p>
        ${(d.authors || []).length ? `<p class="muted small">${esc(d.authors.join(', '))}</p>` : ''}
        ${d.paper ? `<p class="small"><em>${esc(d.paper)}</em></p>` : ''}</section>
      ${d._parentMethod || d._variants.length ? `<section><h4>Lineage</h4>
        ${d._parentMethod ? `<div class="small muted" style="margin-bottom:6px">Builds on</div><div class="chips"><button class="chip" data-open="${esc(d._parentMethod)}">${esc(d._parentMethod)} <span class="muted">${node(d._parentMethod).year}</span></button></div>` : ''}
        ${d._variants.length ? `<div class="small muted" style="margin:8px 0 6px">Extended by</div><div class="chips">${d._variants.map(n => `<button class="chip" data-open="${esc(n)}">${esc(n)} <span class="muted">${node(n).year}</span></button>`).join('')}</div>` : ''}
      </section>` : ''}
      ${siblings.length ? `<section><h4>Related in ${esc(node(d._parent).name)}</h4><div class="chips">${siblings.slice(0, 12).map(n => `<button class="chip" data-open="${esc(n)}">${esc(n)}</button>`).join('')}</div></section>` : ''}
      ${d.snippet ? `<section><h4>Try it</h4>${d.snippet_description ? `<p class="small">${esc(d.snippet_description)}</p>` : ''}
        ${d.snippet_install ? `<div class="pre-wrap"><pre class="code">${esc(d.snippet_install)}</pre><button class="btn copy-btn" data-copy="install">Copy</button></div><div style="height:8px"></div>` : ''}
        <div class="pre-wrap snippet"><div id="snippet"></div><button class="btn copy-btn" data-copy="snippet">Copy</button></div></section>` : ''}
      <section><h4>Cite</h4><div class="pre-wrap"><pre class="code">${esc(d.bibtex || 'N/A')}</pre>${d.bibtex ? '<button class="btn copy-btn" data-copy="bib">Copy</button>' : ''}</div></section>
      <section class="small muted">Something wrong or missing?
        <a href="https://github.com/${CONFIG.repo}/edit/${CONFIG.branch}/methods/${encodeURIComponent(d.name)}.json" target="_blank" rel="noopener">Suggest an edit</a> ·
        <a href="https://github.com/${CONFIG.repo}/issues/new?title=${encodeURIComponent(`[${d.name}] correction`)}&body=${encodeURIComponent(`Method: ${d.name}\n\nWhat should be changed?\n`)}" target="_blank" rel="noopener">Report an issue</a></section>`;
    if (d.snippet) {
      const html = window.marked ? marked.parse(d.snippet) : `<pre><code>${esc(d.snippet)}</code></pre>`;
      $('#snippet').innerHTML = window.DOMPurify ? DOMPurify.sanitize(html) : esc(d.snippet);
      if (window.hljs) $$('#snippet pre code').forEach(c => hljs.highlightElement(c));
    }
  }
  b.scrollTop = 0; dr.scrollTop = 0;
}
function setupDrawer() {
  $('#drawer-close').onclick = closeDrawer;
  $('#drawer').addEventListener('click', e => {
    const d = node(state.m);
    const o = e.target.closest('[data-open]'); if (o) { openNode(o.dataset.open, { focus: true }); return; }
    if (e.target.closest('[data-toggle-sel]')) { toggleSel(d.name); return; }
    if (e.target.closest('[data-copy-link]')) { copyText(location.href, 'Link copied'); return; }
    if (e.target.closest('[data-filter-cat]')) {
      state.fam.clear(); state.cat.clear();
      (d._depth === 1 ? state.fam : state.cat).add(d.name); update(); return;
    }
    const c = e.target.closest('[data-copy]');
    if (c) {
      const k = c.dataset.copy;
      const txt = k === 'bib' ? d.bibtex : k === 'install' ? d.snippet_install : (d.snippet || '').replace(/^```\w*\n?|```\s*$/g, '');
      copyText(txt);
    }
  });
}

// ------------------------------------------------------------------ selection tray + compare
function toggleSel(name) {
  state.sel = state.sel.includes(name) ? state.sel.filter(n => n !== name) : [...state.sel, name];
  update(false);
}
function renderTray() {
  const tr = $('#tray');
  tr.hidden = !state.sel.length;
  document.documentElement.style.setProperty('--tray-h', state.sel.length ? '84px' : '0px');
  $('#tray-chips').innerHTML = state.sel.map(n => `<span class="chip" data-name="${esc(n)}" title="Remove">${esc(n)} ×</span>`).join('');
  $('#tray-compare').disabled = state.sel.length < 2;
  $('#tray-compare').textContent = state.sel.length > 4 ? 'Compare first 4' : 'Compare';
}
function setupTray() {
  $('#tray-chips').addEventListener('click', e => { const c = e.target.closest('[data-name]'); if (c) toggleSel(c.dataset.name); });
  $('#tray-clear').onclick = () => { state.sel = []; update(false); };
  $('#tray-bib').onclick = () => download('tsad-selection.bib', bibOf(state.sel.map(node)), 'application/x-bibtex');
  $('#tray-link').onclick = () => copyText(location.href, 'Link to this selection copied');
  $('#tray-compare').onclick = openCompare;
}
function openCompare() {
  const ms = state.sel.slice(0, 4).map(node);
  const row = (label, f) => `<tr><th>${label}</th>${ms.map(m => `<td>${f(m)}</td>`).join('')}</tr>`;
  const link = u => (safeUrl(u) ? `<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener">Open ↗</a>` : '<span class="muted">—</span>');
  openModal(`<h2>Compare methods</h2><div style="overflow:auto"><table class="cmp">
    <thead><tr><th></th>${ms.map(m => `<th><button class="link-btn" style="font-size:15px;font-weight:700" data-open="${esc(m.name)}">${esc(m.name)}</button></th>`).join('')}</tr></thead><tbody>
    ${row('Full name', m => esc(m.full_name))}
    ${row('Year', m => m.year)}
    ${row('Approach', m => `<span class="cat-cell"><span class="swatch" style="background:${famVar(m.family)}"></span>${esc(m.family)}</span>`)}
    ${row('Category', m => esc(m.category))}
    ${row('Builds on', m => (m._parentMethod ? esc(m._parentMethod) : '<span class="muted">—</span>'))}
    ${row('Dimensionality', m => esc(m.Dim))}
    ${row('Supervision', m => esc(m.Sup))}
    ${row('Streaming', m => (m.Stream ? 'Yes' : 'No'))}
    ${row('Paper', m => link(m.url))}
    ${row('Code', m => link(m.code))}
    ${row('Description', m => `<div class="desc">${esc(m.description)}</div>`)}
    </tbody></table></div>`);
}

// ------------------------------------------------------------------ contribute
function setupContribute() {
  const form = $('#contrib-form');
  const sel = form.elements.parent;
  const opts = ['<option value="">Choose where the method belongs…</option>'];
  ROOT.eachBefore(h => { if (h.depth > 0) opts.push(`<option value="${esc(h.data.name)}">${' '.repeat(h.depth - 1)}${esc(h.data.name)}${isMethod(node(h.data.name)) ? ' (variant of)' : ''}</option>`); });
  sel.innerHTML = opts.join('');
  form.addEventListener('input', renderContribute);
  $('#bib-prefill').onclick = () => {
    const b = parseBib(form.elements.bibtex.value);
    if (!b) { toast('Could not read that BibTeX entry'); return; }
    const f = b.fields, set = (n, v) => { if (v && !form.elements[n].value) form.elements[n].value = v; };
    const title = (f.title || '').replace(/[{}]/g, '');
    set('year', (f.year || '').match(/\d{4}/)?.[0]);
    set('full_name', title);
    set('paper', [title, f.booktitle || f.journal].filter(Boolean).join('. ').replace(/[{}]/g, ''));
    set('url', f.url || (f.doi ? `https://doi.org/${f.doi.replace(/^https?:\/\/doi.org\//, '')}` : (f.eprint ? `https://arxiv.org/abs/${f.eprint}` : '')));
    set('authors', (f.author || '').replace(/[{}]/g, '').split(/\s+and\s+/i).map(a => a.includes(',') ? a.split(',').reverse().map(s => s.trim()).join(' ') : a.trim()).filter(Boolean).join('\n'));
    set('description', (f.abstract || '').replace(/[{}]/g, ''));
    renderContribute(); toast('Pre-filled from BibTeX');
  };
  $('#contrib-copy').onclick = () => copyText(contribJSON());
  $('#contrib-download').onclick = () => download(`${form.elements.name.value.trim() || 'method'}.json`, contribJSON(), 'application/json');
  $('#contrib-pr').onclick = () => {
    const name = form.elements.name.value.trim();
    window.open(`https://github.com/${CONFIG.repo}/new/${CONFIG.branch}/methods?filename=${encodeURIComponent(name + '.json')}&value=${encodeURIComponent(contribJSON())}`, '_blank', 'noopener');
  };
  $('#contrib-issue').onclick = () => {
    const name = form.elements.name.value.trim();
    const body = `A new method for the taxonomy.\n\n**File:** \`methods/${name}.json\`\n\n\`\`\`json\n${contribJSON()}\n\`\`\`\n`;
    window.open(`https://github.com/${CONFIG.repo}/issues/new?title=${encodeURIComponent('New method: ' + name)}&body=${encodeURIComponent(body)}&labels=new-method`, '_blank', 'noopener');
  };
  renderContribute();
}
function parseBib(text) {
  const m = text.match(/@(\w+)\s*\{\s*([^,]*),/); if (!m) return null;
  const fields = {}; const re = /(\w+)\s*=\s*/g; let r;
  while ((r = re.exec(text))) {
    let i = re.lastIndex, v = '';
    if (text[i] === '{') { let depth = 0; for (; i < text.length; i++) { const ch = text[i]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) { i++; break; } } v += ch; } v = v.slice(1); }
    else if (text[i] === '"') { const e = text.indexOf('"', i + 1); v = text.slice(i + 1, e); i = e + 1; }
    else { const mm = text.slice(i).match(/^[^,}\n]+/); v = mm ? mm[0].trim() : ''; i += v.length; }
    fields[r[1].toLowerCase()] = v.replace(/\s+/g, ' ').trim(); re.lastIndex = i;
  }
  return { type: m[1], key: m[2], fields };
}
function contribObject() {
  const f = $('#contrib-form').elements, v = n => f[n].value.trim();
  const parent = v('parent');
  const cat = parent ? (node(parent)._path.concat(parent))[2] || parent : '';
  const o = {
    name: v('name'), full_name: v('full_name'), category: cat, Dim: v('Dim'), Sup: v('Sup'),
    Stream: v('Stream') === 'true', year: +v('year') || null,
    authors: v('authors').split(/\n|\s+and\s+/).map(s => s.trim()).filter(Boolean),
    paper: v('paper'), description: v('description'), code: v('code'), url: v('url'), bibtex: v('bibtex').replace(/\s*\n\s*/g, ' '),
  };
  if (parent) o.parent = parent;
  return o;
}
const contribJSON = () => JSON.stringify(contribObject(), null, 2) + '\n';
function renderContribute() {
  const o = contribObject(), errs = [];
  if (!o.name) errs.push('Short name is required.');
  else if (!/^[\w.+\-]+$/.test(o.name)) errs.push('Short name may only contain letters, digits, “.”, “+”, “-” and “_” (it becomes the file name).');
  else if (node(o.name)) errs.push(`“${o.name}” already exists in the taxonomy.`);
  if (!o.full_name) errs.push('Full name is required.');
  if (!o.parent) errs.push('Choose where the method belongs in the taxonomy.');
  if (!o.year || o.year < 1950 || o.year > new Date().getFullYear() + 1) errs.push('Year is missing or out of range.');
  if (!o.authors.length) errs.push('At least one author is required.');
  if (!safeUrl(o.url)) errs.push('Paper URL must start with http:// or https://.');
  if (o.code && !safeUrl(o.code)) errs.push('Code URL must start with http:// or https://.');
  if (!o.description) errs.push('A short description is required.');
  if (o.bibtex && !o.bibtex.startsWith('@')) errs.push('BibTeX should start with “@”.');
  $('#contrib-errors').innerHTML = errs.length ? `<ul>${errs.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : '';
  $('#contrib-json').textContent = contribJSON();
  $('#contrib-filename').textContent = `methods/${o.name || '…'}.json`;
  $('#contrib-taxo').textContent = o.parent
    ? `The “parent” field places the method under ${o.parent}; the site adds it to the tree automatically when the file is merged.`
    : '';
  $('#contrib-pr').disabled = $('#contrib-issue').disabled = errs.length > 0;
}

// ------------------------------------------------------------------ search box
function setupSearch() {
  const input = $('#search'), list = $('#search-suggest');
  let active = -1, items = [];
  const apply = debounce(() => { state.q = input.value.trim(); update(); }, 150);
  const suggest = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { list.hidden = true; return; }
    const cats = Object.values(DATA.nodes).filter(d => !isMethod(d) && d._depth > 0 && d.name.toLowerCase().includes(q));
    const rank = m => { const n = m.name.toLowerCase(), f = (m.full_name || '').toLowerCase();
      return n === q ? 5 : n.startsWith(q) ? 4 : n.includes(q) ? 3 : f.startsWith(q) ? 2.5 : f.includes(q) ? 2 : 0; };
    const ms = METHODS.filter(m => searchMatch(m, q)).sort((a, b) => rank(b) - rank(a) || b._variants.length - a._variants.length || b.year - a.year);
    items = [...cats.slice(0, 3), ...ms.slice(0, 8)];
    active = -1;
    list.innerHTML = items.map((d, i) => `<li role="option" data-i="${i}"><strong>${esc(d.name)}</strong><span class="muted">${isMethod(d) ? `${d.year} · ${esc(d.full_name || d.category)}` : 'category'}</span></li>`).join('')
      || '<li class="muted">No match</li>';
    list.hidden = false;
  };
  const choose = i => { const d = items[i]; if (!d) return; list.hidden = true; input.value = ''; state.q = ''; update(); openNode(d.name, { focus: true }); input.blur(); };
  input.addEventListener('input', () => { apply(); suggest(); });
  input.addEventListener('focus', suggest);
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
  input.addEventListener('keydown', e => {
    const lis = $$('li[data-i]', list);
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(lis.length - 1, active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(-1, active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0) choose(active); else { list.hidden = true; state.q = input.value.trim(); update(); } return; }
    else if (e.key === 'Escape') { list.hidden = true; input.blur(); return; }
    else return;
    lis.forEach((li, i) => li.classList.toggle('active', i === active));
  });
  list.addEventListener('mousedown', e => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); choose(+li.dataset.i); } });
}

// ------------------------------------------------------------------ modal, pages, theme
function openModal(html) { $('#modal-body').innerHTML = html; const m = $('#modal'); if (!m.open) m.showModal(); }
const CITES = [
  ['Long survey paper (arXiv 2024)', `@misc{boniol2024divetimeseriesanomalydetection,
  title={Dive into Time-Series Anomaly Detection: A Decade Review},
  author={Paul Boniol and Qinghua Liu and Mingyi Huang and Themis Palpanas and John Paparrizos},
  year={2024}, eprint={2412.20512}, archivePrefix={arXiv}, primaryClass={cs.LG},
  url={https://arxiv.org/abs/2412.20512}
}`],
  ['Short survey paper (KDD 2025)', `@inproceedings{10.1145/3711896.3736565,
  author={Paparrizos, John and Boniol, Paul and Liu, Qinghua and Palpanas, Themis},
  title={Advances in Time-Series Anomaly Detection: Algorithms, Benchmarks, and Evaluation Measures},
  booktitle={Proceedings of the 31st ACM SIGKDD Conference on Knowledge Discovery and Data Mining V.2},
  year={2025}, pages={6151--6161}, publisher={ACM}, doi={10.1145/3711896.3736565}
}`],
];
function setupChrome() {
  $('#gh-link').href = $('#gh-menu-link').href = `https://github.com/${CONFIG.repo}`;
  $('#modal-close').onclick = () => $('#modal').close();
  $('#modal').addEventListener('click', e => {
    if (e.target === $('#modal')) $('#modal').close();
    const o = e.target.closest('[data-open]'); if (o) { $('#modal').close(); openNode(o.dataset.open); }
    const c = e.target.closest('[data-cite]'); if (c) copyText(CITES[+c.dataset.cite][1]);
  });
  const menuBtn = $('#about-menu-btn'), menu = $('#about-menu');
  menuBtn.onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  document.addEventListener('click', () => { menu.hidden = true; });
  $$('#about-menu [data-page]').forEach(b => b.onclick = async () => {
    try {
      const html = await (await fetch(b.dataset.page)).text();
      openModal(window.DOMPurify ? DOMPurify.sanitize(html) : html);
    } catch (e) { openModal('<p>Could not load this page.</p>'); }
  });
  $('#cite-btn').onclick = () => openModal(`<h2>How to cite</h2><p class="muted">If this taxonomy helps your research, please cite:</p>` +
    CITES.map(([t, b], i) => `<h3 style="margin-top:16px">${t}</h3><div class="pre-wrap"><pre class="code">${esc(b)}</pre><button class="btn copy-btn" data-cite="${i}">Copy</button></div>`).join(''));
  const isDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const syncHl = () => { $('#hljs-dark').disabled = !isDark(); $('#hljs-light').disabled = isDark(); };
  syncHl();
  $('#theme-toggle').onclick = () => {
    const t = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = t; store.set('tsad-theme', t); syncHl();
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncHl);
  $$('.tabs button').forEach(b => b.onclick = () => setView(b.dataset.view));
  document.addEventListener('click', e => {
    const v = e.target.closest('[data-view-link]'); if (v) { e.preventDefault(); setView(v.dataset.viewLink); }
    if (e.target.closest('[data-reset]')) resetFilters();
  });
  $('#filters-toggle').onclick = () => $('#filters').classList.toggle('open');
  $('#filters-done').onclick = () => $('#filters').classList.remove('open');
  $('#main').addEventListener('click', () => $('#filters').classList.remove('open'));
  if (store.get('tsad-intro') !== 'hidden') $('#intro').hidden = false;
  $('#intro-close').onclick = () => { $('#intro').hidden = true; store.set('tsad-intro', 'hidden'); };
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#search').focus(); }
    if (e.key === 'Escape' && !$('#modal').open && state.m && document.activeElement !== $('#search')) closeDrawer();
  });
  addEventListener('resize', debounce(() => { if (state.view === 'insights') renderInsights(); if (state.view === 'tree') renderTree(); }, 200));
  addEventListener('popstate', () => { readHash(); syncSearch(); render(); });
  addEventListener('hashchange', () => { readHash(); syncSearch(); render(); });
}
const syncSearch = () => { if ($('#search') !== document.activeElement) $('#search').value = state.q; };

// ------------------------------------------------------------------ views + render loop
function setView(v) {
  state.view = v; writeHash(true); render();
  $('#main').scrollTop = 0;
}
function render() {
  $$('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === state.view)));
  VIEWS.forEach(v => { $(`#view-${v}`).hidden = v !== state.view; });
  $('.layout').classList.toggle('no-filters', state.view === 'finder' || state.view === 'contribute');
  $('#filters-toggle').style.visibility = (state.view === 'finder' || state.view === 'contribute') ? 'hidden' : '';
  renderDrawer(); renderTray();
  renderFacets();
  $('#only-matches').checked = state.only;
  if (state.view === 'tree') renderTree();
  if (state.view === 'table') renderTable();
  if (state.view === 'insights') renderInsights();
  if (state.view === 'finder') renderFinder();
}
function update() { writeHash(); render(); }

// ------------------------------------------------------------------ boot
(async function boot() {
  try {
    DATA = await loadData();
  } catch (e) {
    $('#main').innerHTML = '<p style="padding:40px">Could not load the taxonomy data. If you opened <code>index.html</code> directly from disk, serve the folder instead (e.g. <code>python -m http.server</code>).</p>';
    return;
  }
  prepare();
  readHash();
  $('#search').value = state.q;
  buildFacets(); setupTree(); setupTable(); setupFinder(); setupDrawer(); setupTray(); setupContribute(); setupSearch(); setupChrome();
  render();
  if (state.m && state.view === 'tree') setTimeout(() => focusTreeNode(state.m), 50);
})();
})();
