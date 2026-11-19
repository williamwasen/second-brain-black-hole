// The Home dashboard: four number tiles and three small charts built from the map's graph.
// Shared by the web page (src/app.mjs) and the Obsidian plugin (obsidian/dashboard-panel.ts).
const dayMs = 864e5;
const dayKey = t => { const d = new Date(t); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
const touched = node => { const t = Date.parse(node.updated); return Number.isFinite(t) ? t + 12 * 3600e3 : node.modified; };

// Numbers roll up from zero when Home opens.
function countUpNumber(element, value, duration = 900) {
  const win = element.ownerDocument.defaultView;
  const start = win.performance.now();
  const step = now => {
    const t = Math.min(1, (now - start) / duration), eased = 1 - (1 - t) ** 3;
    element.textContent = Math.round(value * eased).toLocaleString();
    if (t < 1 && element.isConnected) win.requestAnimationFrame(step);
  };
  element.textContent = '0';
  win.requestAnimationFrame(step);
}

export function hideDashboardTip(els) { els.tip.hidden = true; }

let chartLabels = 0;

/**
 * els: {panel, date, kpis, activity, groups, connected, tip}: elements to fill (panel is the scrolling box).
 * graph: {nodes, edges, regions}. options: {countUp, onGroup(name), onNote(index)}.
 */
export function renderHomeDashboard(els, graph, {countUp = false, onGroup, onNote} = {}) {
  const doc = els.panel.ownerDocument;
  const {nodes, edges, regions} = graph;
  const clusters = Object.keys(regions).map(name => ({name}));
  const ideas = [];
  nodes.forEach((node, page) => (node.ideas || []).forEach((title, k) => ideas.push({page, k, title})));
  const tip = (event, title, detail) => {
    const panel = els.panel.getBoundingClientRect();
    els.tip.replaceChildren(doc.createTextNode(title), Object.assign(doc.createElement('small'), {textContent: detail}));
    els.tip.hidden = false;
    const x = Math.min(event.clientX - panel.left + 12, panel.width - els.tip.offsetWidth - 8);
    els.tip.style.left = x + 'px';
    els.tip.style.top = (event.clientY - panel.top + els.panel.scrollTop - els.tip.offsetHeight - 10) + 'px';
  };
  const hide = () => hideDashboardTip(els);

  const now = Date.now();
  const weekAgo = now - 7 * dayMs;
  const fresh = nodes.filter(n => touched(n) >= weekAgo).length;
  els.date.textContent = new Date(now).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'});
  const byGroup = clusters.map(c => c.name);
  const perGroup = fn => byGroup.map(name => fn(name)).sort((a, b) => a - b);
  // Each tile: big number, label, detail, a quiet chip, and mini bars (lighter to stronger) from real counts.
  const kpi = (value, label, detail, chip, bars, color, barsLabel) => {
    const tile = Object.assign(doc.createElement('div'), {className: 'kpi'});
    tile.style.setProperty('--kpi', color);
    const spark = Object.assign(doc.createElement('div'), {className: 'spark', title: barsLabel});
    const top = Math.max(1, ...bars);
    bars.forEach((v, k) => { const bar = doc.createElement('i'); bar.style.height = Math.max(6, 100 * v / top) + '%'; bar.style.opacity = (.55 + .45 * k / Math.max(1, bars.length - 1)).toFixed(2); bar.style.setProperty('--j', k); spark.append(bar); });
    const number = Object.assign(doc.createElement('b'), {textContent: value.toLocaleString()});
    if (countUp) countUpNumber(number, value);
    tile.append(number,
      Object.assign(doc.createElement('span'), {textContent: label}),
      Object.assign(doc.createElement('small'), {textContent: detail}),
      Object.assign(doc.createElement('em'), {className: 'chip', textContent: chip}), spark);
    tile.style.setProperty('--i', kpiCount++);
    return tile;
  };
  let kpiCount = 0;
  const lastWeek = Array.from({length: 7}, (_, i) => now - (6 - i) * dayMs).map(t => nodes.filter(n => dayKey(touched(n)) === dayKey(t)).length);
  const added = nodes.filter(n => { const t = Date.parse(n.created); return Number.isFinite(t) && t >= weekAgo; }).length;
  els.kpis.replaceChildren(
    kpi(nodes.length, 'Pages', `in ${clusters.length} groups`, added ? `+${added} new` : `${clusters.length} groups`,
      perGroup(name => nodes.filter(n => n.region === name).length), 'var(--c-pages)', 'Pages per group'),
    kpi(ideas.length, 'Ideas', 'sections across all pages', `${(ideas.length / Math.max(1, nodes.length)).toFixed(1)} / page`,
      perGroup(name => ideas.filter(idea => nodes[idea.page].region === name).length), 'var(--c-ideas)', 'Ideas per group'),
    kpi(edges.length, 'Links', 'between pages', `${(2 * edges.length / Math.max(1, nodes.length)).toFixed(1)} / page`,
      perGroup(name => edges.filter(([a, b]) => nodes[a].region === name || nodes[b].region === name).length), 'var(--c-links)', 'Links touching each group'),
    kpi(fresh, 'Updated this week', 'pages changed in 7 days', `${Math.round(100 * fresh / Math.max(1, nodes.length))}%`,
      lastWeek, 'var(--c-updates)', 'Pages updated per day, last 7 days'));

  // Pages updated per day, last 30 days: one series, columns anchored to the baseline.
  const days = Array.from({length: 30}, (_, i) => now - (29 - i) * dayMs);
  const counts = days.map(t => nodes.filter(n => dayKey(touched(n)) === dayKey(t)).length);
  const box = els.activity;
  const width = Math.max(240, box.clientWidth), height = 210, left = 22, bottom = 18, top = 6;
  const max = Math.max(2, ...counts), step = Math.ceil(max / 2);
  const ceiling = step * 2, plotW = width - left, plotH = height - bottom - top;
  const gap = 2, barW = (plotW - gap * 29) / 30;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  // The chart's name is hidden text, not aria-label: apps like Obsidian turn aria-label into hover tooltips.
  const chartLabel = Object.assign(doc.createElement('span'), {className: 'sbbh-sr', id: `sbbh-chart-label-${++chartLabels}`,
    textContent: `Pages updated per day over the last 30 days; ${counts.reduce((a, b) => a + b, 0)} updates in total, most in one day ${max}.`});
  svg.setAttribute('aria-labelledby', chartLabel.id);
  const el = (name, attrs, text, parent = svg) => { const e = doc.createElementNS(svgNS, name); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; parent.append(e); return e; };
  const defs = el('defs', {});
  for (const [id, from, to] of [['bar-fill', '#c58dff', '#9a45ff'], ['bar-hover', '#dcb8ff', '#b06cff']]) {
    const g = el('linearGradient', {id, x1: 0, y1: 0, x2: 0, y2: 1}, null, defs);
    el('stop', {offset: '0', 'stop-color': from}, null, g);
    el('stop', {offset: '1', 'stop-color': to}, null, g);
  }
  for (const tick of [0, step, ceiling]) {
    const y = top + plotH - plotH * tick / ceiling;
    el('line', {class: 'grid', x1: left, x2: width, y1: y, y2: y});
    el('text', {x: 0, y: y + 3}, tick);
  }
  const fmt = t => new Date(t).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
  [[0, 'start'], [15, 'middle'], [29, 'end']].forEach(([i, anchor]) =>
    el('text', {x: left + i * (barW + gap) + (anchor === 'start' ? 0 : anchor === 'end' ? barW : barW / 2), y: height - 4, 'text-anchor': anchor}, fmt(days[i])));
  counts.forEach((count, i) => {
    const x = left + i * (barW + gap);
    const hit = el('rect', {class: 'hit', x, y: top, width: barW + gap, height: plotH, fill: 'transparent'});
    if (count) {
      const h = Math.max(3, plotH * count / ceiling), y = top + plotH - h, r = Math.min(4, barW / 2, h);
      el('path', {class: 'bar', style: `--j:${i}`, d: `M${x},${top + plotH}V${y + r}Q${x},${y} ${x + r},${y}H${x + barW - r}Q${x + barW},${y} ${x + barW},${y + r}V${top + plotH}Z`});
    }
    hit.addEventListener('pointermove', event => tip(event, `${count} ${count === 1 ? 'page' : 'pages'}`, fmt(days[i])));
    hit.addEventListener('pointerleave', hide);
  });
  box.replaceChildren(chartLabel, svg);

  // Ideas by group and most connected pages: one series each, labelled bars.
  const barRow = (name, value, maxValue, detail, onClick) => {
    const button = doc.createElement('button');
    button.type = 'button';
    const track = Object.assign(doc.createElement('span'), {className: 'track'});
    track.append(Object.assign(doc.createElement('span'), {className: 'fill', style: `width:${Math.max(2, 100 * value / maxValue)}%`}));
    button.append(Object.assign(doc.createElement('span'), {className: 'name', textContent: name}),
      Object.assign(doc.createElement('span'), {className: 'value', textContent: value}), track);
    button.setAttribute('aria-description', detail);
    button.addEventListener('pointermove', event => tip(event, name, detail));
    button.addEventListener('pointerleave', hide);
    button.addEventListener('click', () => { hide(); onClick(); });
    return button;
  };
  const groups = clusters.map(c => ({name: c.name, ideas: ideas.filter(idea => nodes[idea.page].region === c.name).length,
    pages: nodes.filter(n => n.region === c.name).length})).sort((a, b) => b.ideas - a.ideas);
  const topIdeas = Math.max(1, ...groups.map(g => g.ideas));
  els.groups.replaceChildren(...groups.map(g => barRow(g.name, g.ideas, topIdeas, `${g.ideas} ideas in ${g.pages} pages`,
    () => onGroup(g.name))));
  const connected = nodes.map((n, i) => i).sort((a, b) => nodes[b].degree - nodes[a].degree).slice(0, 6);
  const topDegree = Math.max(1, nodes[connected[0]]?.degree || 1);
  els.connected.replaceChildren(...connected.map(i => barRow(nodes[i].title, nodes[i].degree, topDegree,
    `${nodes[i].degree} linked pages · ${nodes[i].region}`, () => onNote(i))));
  for (const list of [els.groups, els.connected]) list.querySelectorAll('.fill').forEach((fill, j) => fill.style.setProperty('--j', j));
}
