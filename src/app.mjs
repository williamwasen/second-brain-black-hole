// The standalone page around the map: header, toolbar, Pages panel (search + reading), Home dashboard.
// assemble.mjs inlines this with the core modules into one HTML file.
import { createBlackHole } from './blackhole.js';

const {nodes, edges, regions} = JSON.parse(document.getElementById('data').textContent);
const get = id => document.getElementById(id);
const menu = get('pages');
const neighbors = nodes.map(() => []);
for (const [a, b] of edges) {
  neighbors[a].push(b);
  neighbors[b].push(a);
}
const order = nodes.map((_, i) => i).sort((a, b) => nodes[a].title.localeCompare(nodes[b].title));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
for (const i of order) menu.add(new Option(nodes[i].title, String(i)));

// Pages changed since the previous visit glow gold. First visit: the last 48 hours.
let storedVisit = 0;
const lastVisit = (() => {
  try {
    storedVisit = Number(localStorage.getItem('brain3d.lastVisit')) || 0;
    const previous = storedVisit || Date.now() - 48 * 3600e3;
    localStorage.setItem('brain3d.lastVisit', String(Date.now()));
    return previous;
  } catch { return Date.now() - 48 * 3600e3; }
})();
const isNew = nodes.map(node => node.modified > lastVisit);

// Note HTML (escaped by the importer) is parsed into an inert document: nothing in it loads or runs.
const parseNote = html => new DOMParser().parseFromString(html || '', 'text/html').body;
// Search titles first, then page text.
const searchText = nodes.map(node => parseNote(node.html).textContent.toLowerCase());
let results = [], current = 0;
function runSearch() {
  const query = get('search').value.trim().toLowerCase();
  const list = get('results');
  list.hidden = !query;
  if (!query) return;
  const words = query.split(/\s+/);
  const score = i => {
    const title = nodes[i].title.toLowerCase();
    if (words.every(w => title.includes(w))) return title.startsWith(words[0]) ? 0 : 1;
    return words.every(w => title.includes(w) || searchText[i].includes(w)) ? 2 : null;
  };
  results = order.map(i => [i, score(i)]).filter(([, s]) => s !== null).sort((a, b) => a[1] - b[1]).map(([i]) => i);
  current = 0;
  list.replaceChildren(...(results.length ? results.slice(0, 30).map((i, n) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.classList.toggle('current', n === 0);
    button.append(nodes[i].title);
    if (isNew[i]) button.append(Object.assign(document.createElement('span'), {className: 'new-tag', textContent: 'new'}));
    button.append(Object.assign(document.createElement('small'), {textContent: `${nodes[i].category} · ${nodes[i].region}`}));
    button.addEventListener('click', () => pickResult(i));
    item.append(button);
    return item;
  }) : [Object.assign(document.createElement('li'), {className: 'empty', textContent: 'No pages match'})]));
}
function pickResult(i) {
  get('search').value = '';
  get('results').hidden = true;
  selectPage(i);
}
get('search').addEventListener('input', runSearch);
get('search').addEventListener('keydown', event => {
  const buttons = [...get('results').querySelectorAll('button')];
  if (event.key === 'Enter' && results.length) pickResult(results[current]);
  else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && buttons.length) {
    event.preventDefault();
    current = (current + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length;
    buttons.forEach((b, n) => b.classList.toggle('current', n === current));
    buttons[current].scrollIntoView({block: 'nearest'});
  } else return;
  event.stopPropagation();
});
document.addEventListener('keydown', event => {
  if (event.key !== '/' || event.target.matches('input, select, textarea')) return;
  event.preventDefault();
  setPanelOpen(true);
  get('search').focus();
});
const clusters = Object.keys(regions).map(name => ({name}));
const ideas = [];
nodes.forEach((node, page) => (node.ideas || []).forEach((title, k) => ideas.push({page, k, title})));

const core = createBlackHole(get('stage'), {nodes, edges, regions}, {
  label: 'Interactive 3D wiki. Drag to rotate, scroll to zoom. Use Pages to select a page with the keyboard.',
  onSelect: (node, {index, idea}) => {
    showPage(index);
    if (idea) showIdea(idea.k);
  },
  onRegionChange: (name, source) => {
    if (name !== null) get('home-panel').hidden = true;
    get('brand-block').hidden = name !== null;
    get('overview').hidden = name === null;
    get('overview').textContent = name === null ? '← Overview' : '← ' + name;
    get('overview').setAttribute('aria-label', 'Return to overview');
    if (source === 'hub') get('overview').focus({preventScroll: true});
  },
  onCoreClick: () => openHome(),
  onFps: fps => {
    const label = get('fps');
    label.textContent = `${fps} fps`;
    label.classList.toggle('slow', fps < 45);
  },
  onMotionChange: () => updateMotionButton(),
});
const focusRegion = name => core.focusRegion(name);
// The map pauses its spin and hides its labels while Home is open.
new MutationObserver(() => core.setOverlayOpen(!get('home-panel').hidden))
  .observe(get('home-panel'), {attributes: true, attributeFilter: ['hidden']});

let recentPaths = [];
try { const saved=JSON.parse(localStorage.getItem('second-brain-recent') || '[]'); if(Array.isArray(saved)) recentPaths=saved.filter(p=>typeof p==='string').slice(0,8); } catch { /* storage blocked: start empty */ }
function rememberPage(index) {
  const path=nodes[index].path;
  recentPaths=[path,...recentPaths.filter(p=>p!==path)].slice(0,8);
  try {localStorage.setItem('second-brain-recent',JSON.stringify(recentPaths));} catch { /* storage blocked: not remembered */ }
}
function homePageButton(index, subtitle, query = '') {
  const button=document.createElement('button');button.type='button';
  const title=document.createElement('span');title.textContent=nodes[index].title;
  const detail=document.createElement('small');detail.textContent=typeof subtitle==='string'?subtitle:nodes[index].region;
  button.append(title,detail);
  if(query){
    const body=parseNote(nodes[index].html).textContent.replace(/\s+/g,' ').trim();
    const at=body.toLowerCase().indexOf(query.split(/\s+/)[0]);
    const start=Math.max(0,at-65), snippet=document.createElement('div');snippet.className='snippet';
    snippet.textContent=(start?'…':'')+body.slice(start,start+220);button.append(snippet);
  }
  button.addEventListener('click',()=>{get('home-panel').hidden=true;selectPage(index);});return button;
}
// Home dashboard: quick numbers and three small charts built from the wiki itself.
const dayMs = 864e5;
const dayKey = t => { const d = new Date(t); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
const touched = node => { const t = Date.parse(node.updated); return Number.isFinite(t) ? t + 12 * 3600e3 : node.modified; };
function chartTip(event, title, detail) {
  const tip = get('chart-tip'), panel = get('home-panel').getBoundingClientRect();
  tip.replaceChildren(document.createTextNode(title), Object.assign(document.createElement('small'), {textContent: detail}));
  tip.hidden = false;
  const x = Math.min(event.clientX - panel.left + 12, panel.width - tip.offsetWidth - 8);
  tip.style.left = x + 'px';
  tip.style.top = (event.clientY - panel.top + get('home-panel').scrollTop - tip.offsetHeight - 10) + 'px';
}
function hideTip() { get('chart-tip').hidden = true; }
// Numbers roll up from zero when Home opens.
function countUp(element, value, duration = 900) {
  const start = performance.now();
  const step = now => {
    const t = Math.min(1, (now - start) / duration), eased = 1 - (1 - t) ** 3;
    element.textContent = Math.round(value * eased).toLocaleString();
    if (t < 1 && element.isConnected) requestAnimationFrame(step);
  };
  element.textContent = '0';
  requestAnimationFrame(step);
}
function renderDashboard() {
  const now = Date.now();
  const weekAgo = now - 7 * dayMs;
  const fresh = nodes.filter(n => touched(n) >= weekAgo).length;
  get('home-date').textContent = new Date(now).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'});
  const byGroup = clusters.map(c => c.name);
  const perGroup = fn => byGroup.map(name => fn(name)).sort((a, b) => a - b);
  // Each tile: big number, label, detail, a quiet chip, and mini bars (lighter to stronger) from real counts.
  const kpi = (value, label, detail, chip, bars, color, barsLabel) => {
    const tile = Object.assign(document.createElement('div'), {className: 'kpi'});
    tile.style.setProperty('--kpi', color);
    const spark = Object.assign(document.createElement('div'), {className: 'spark', title: barsLabel});
    const top = Math.max(1, ...bars);
    bars.forEach((v, k) => { const bar = document.createElement('i'); bar.style.height = Math.max(6, 100 * v / top) + '%'; bar.style.opacity = (.55 + .45 * k / Math.max(1, bars.length - 1)).toFixed(2); bar.style.setProperty('--j', k); spark.append(bar); });
    const number = Object.assign(document.createElement('b'), {textContent: value.toLocaleString()});
    if (get('home-panel').classList.contains('intro') && !reducedMotion.matches) countUp(number, value);
    tile.append(number,
      Object.assign(document.createElement('span'), {textContent: label}),
      Object.assign(document.createElement('small'), {textContent: detail}),
      Object.assign(document.createElement('em'), {className: 'chip', textContent: chip}), spark);
    tile.style.setProperty('--i', kpiCount++);
    return tile;
  };
  let kpiCount = 0;
  const lastWeek = Array.from({length: 7}, (_, i) => now - (6 - i) * dayMs).map(t => nodes.filter(n => dayKey(touched(n)) === dayKey(t)).length);
  const added = nodes.filter(n => { const t = Date.parse(n.created); return Number.isFinite(t) && t >= weekAgo; }).length;
  get('home-kpis').replaceChildren(
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
  const box = get('chart-activity');
  const width = Math.max(240, box.clientWidth), height = 210, left = 22, bottom = 18, top = 6;
  const max = Math.max(2, ...counts), step = Math.ceil(max / 2);
  const ceiling = step * 2, plotW = width - left, plotH = height - bottom - top;
  const gap = 2, barW = (plotW - gap * 29) / 30;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Pages updated per day over the last 30 days; ${counts.reduce((a, b) => a + b, 0)} updates in total, most in one day ${max}.`);
  const el = (name, attrs, text, parent = svg) => { const e = document.createElementNS(svgNS, name); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; parent.append(e); return e; };
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
    hit.addEventListener('pointermove', event => chartTip(event, `${count} ${count === 1 ? 'page' : 'pages'}`, fmt(days[i])));
    hit.addEventListener('pointerleave', hideTip);
  });
  box.replaceChildren(svg);

  // Ideas by group and most connected pages: one series each, labelled bars.
  const barRow = (name, value, maxValue, detail, onClick) => {
    const button = document.createElement('button');
    button.type = 'button';
    const track = Object.assign(document.createElement('span'), {className: 'track'});
    track.append(Object.assign(document.createElement('span'), {className: 'fill', style: `width:${Math.max(2, 100 * value / maxValue)}%`}));
    button.append(Object.assign(document.createElement('span'), {className: 'name', textContent: name}),
      Object.assign(document.createElement('span'), {className: 'value', textContent: value}), track);
    button.setAttribute('aria-label', `${name}: ${detail}`);
    button.addEventListener('pointermove', event => chartTip(event, name, detail));
    button.addEventListener('pointerleave', hideTip);
    button.addEventListener('click', () => { hideTip(); onClick(); });
    return button;
  };
  const groups = clusters.map(c => ({name: c.name, ideas: ideas.filter(idea => nodes[idea.page].region === c.name).length,
    pages: nodes.filter(n => n.region === c.name).length})).sort((a, b) => b.ideas - a.ideas);
  const topIdeas = Math.max(1, ...groups.map(g => g.ideas));
  get('chart-groups').replaceChildren(...groups.map(g => barRow(g.name, g.ideas, topIdeas, `${g.ideas} ideas in ${g.pages} pages`,
    () => { get('home-panel').hidden = true; focusRegion(g.name); })));
  const connected = nodes.map((n, i) => i).sort((a, b) => nodes[b].degree - nodes[a].degree).slice(0, 6);
  const topDegree = Math.max(1, nodes[connected[0]]?.degree || 1);
  get('chart-connected').replaceChildren(...connected.map(i => barRow(nodes[i].title, nodes[i].degree, topDegree,
    `${nodes[i].degree} linked pages · ${nodes[i].region}`, () => { get('home-panel').hidden = true; selectPage(i); })));
  for (const list of ['chart-groups', 'chart-connected']) get(list).querySelectorAll('.fill').forEach((fill, j) => fill.style.setProperty('--j', j));
}

function renderHome() {
  const q=get('home-search').value.trim().toLowerCase(), words=q.split(/\s+/);
  const matches=q?order.filter(i=>words.every(w=>(nodes[i].title+' '+nodes[i].region+' '+searchText[i]).toLowerCase().includes(w))):[];
  matches.sort((a,b)=>Number(nodes[b].title.toLowerCase().includes(q))-Number(nodes[a].title.toLowerCase().includes(q)));
  get('home-results').replaceChildren(...matches.map(i=>homePageButton(i,nodes[i].region,q)));
  get('home-feed').hidden=!!q;
  get('home-dash').hidden=!!q;
  hideTip();
  if(!q)renderDashboard();
  if(q&&!matches.length){const p=document.createElement('p');p.className='home-empty';p.textContent='No matching pages';get('home-results').append(p);}
  const recent=recentPaths.map(path=>nodes.findIndex(n=>n.path===path)).filter(i=>i>=0);
  get('home-recent').replaceChildren(...recent.slice(0,5).map(i=>homePageButton(i,'Opened · '+nodes[i].region)));
  if(!recent.length){const p=document.createElement('p');p.className='home-empty';p.textContent='Pages you open will appear here.';get('home-recent').append(p);}
  const date = value => {const n=Date.parse(value);return Number.isFinite(n)?n:0;};
  const conversations=order.filter(i=>nodes[i].category==='Chat record').sort((a,b)=>date(nodes[b].created)-date(nodes[a].created)||nodes[a].title.localeCompare(nodes[b].title));
  get('home-conversations').replaceChildren(...conversations.slice(0,6).map(i=>homePageButton(i,nodes[i].created?'Summary created '+nodes[i].created:'Creation date unavailable')));
  if(!conversations.length){const p=document.createElement('p');p.className='home-empty';p.textContent='No conversation summaries yet.';get('home-conversations').append(p);}
}

function openHome() {
  selectPage(null); focusRegion(null); core.flyHome();
  const panel=get('home-panel');panel.classList.remove('intro');void panel.offsetWidth;
  if(!reducedMotion.matches){panel.classList.add('intro');clearTimeout(openHome.timer);openHome.timer=setTimeout(()=>panel.classList.remove('intro'),1800);}
  panel.hidden=false;renderHome();get('home-search').focus();
}
get('home-nav').addEventListener('click',openHome);
get('close-home').addEventListener('click',()=>{get('home-panel').hidden=true;get('home-nav').focus();get('reset').click();});
get('home-search').addEventListener('input',renderHome);
new ResizeObserver(()=>{if(!get('home-panel').hidden&&!get('home-dash').hidden)renderDashboard();}).observe(get('home-dash'));

get('overview').addEventListener('click', () => {
  const previous = core.region;
  selectPage(null);
  focusRegion(null);
  if (core.moving) {
    get('browse').focus({preventScroll: true});
  } else {
    core.hubButton(previous)?.focus({preventScroll: true});
  }
});

function selectPage(index) {
  core.select(index);
  showPage(index);
}
// The reading panel: fills in the page that the map selected.
function showPage(index) {
  menu.value = index === null ? '' : String(index);
  get('detail').hidden = index === null;
  get('panel').classList.toggle('reading', index !== null);
  document.body.classList.toggle('reading', index !== null);
  setPanelOpen(index !== null);
  if (index !== null) {
    rememberPage(index);
    const node = nodes[index];
    get('category').textContent = node.category;
    get('title').textContent = node.title;
    get('path').textContent = node.path;
    get('open-page').href = node.url;
    get('meta').textContent = `${node.status === 'superseded' ? 'Superseded · ' : ''}Updated ${node.updated}`;
    get('page-body').replaceChildren(...parseNote(node.html).childNodes);
    get('page-body').scrollTop = 0;
    get('panel').scrollTop = 0;
    get('connections').textContent = `${node.degree} connected ${node.degree === 1 ? 'page' : 'pages'}`;
    get('neighbors').replaceChildren(...order.filter(i => neighbors[index].includes(i)).map(i => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = nodes[i].title;
      button.addEventListener('click', () => {
        selectPage(i);
        menu.focus();
      });
      item.append(button);
      return item;
    }));
  }
}

function setPanelOpen(open) {
  get('panel').hidden = !open;
  get('browse').setAttribute('aria-expanded', String(open));
}
get('browse').addEventListener('click', () => {
  get('home-panel').hidden=true;
  setPanelOpen(get('panel').hidden);
  if (!get('panel').hidden) menu.focus();
});
function closePanel() {
  selectPage(null);
  get('browse').focus();
}
get('close-panel').addEventListener('click', closePanel);
get('page-body').addEventListener('click', event => {
  const jump = event.target.closest('a[data-page]');
  if (!jump) return;
  event.preventDefault();
  selectPage(Number(jump.dataset.page));
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if(!get('home-panel').hidden){get('close-home').click();return;}
  if (!get('panel').hidden) closePanel();
  else if (core.region) get('overview').click();
});
get('fullscreen').hidden = !document.fullscreenEnabled;
get('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    get('fullscreen').hidden = true;
  }
});
document.addEventListener('fullscreenchange', () => {
  const label = document.fullscreenElement ? 'Exit full screen' : 'Enter full screen';
  get('fullscreen').setAttribute('aria-label', label);
  get('fullscreen').title = label;
});

// Open the idea's page and scroll the reader to that section.
function showIdea(k) {
  const heading = get('page-body').querySelector('#idea-' + k);
  if (!heading) return;
  get('panel').scrollTop = Math.max(0, heading.offsetTop - 20);
  heading.classList.add('idea-focus');
  setTimeout(() => heading.classList.remove('idea-focus'), 2400);
}
menu.addEventListener('change', () => selectPage(menu.value === '' ? null : Number(menu.value)));
get('zoom-in').addEventListener('click', () => core.zoomBy(1.2));
get('zoom-out').addEventListener('click', () => core.zoomBy(1 / 1.2));
get('reset').addEventListener('click', () => {
  get('home-panel').hidden=true;
  if (core.region) {
    get('overview').click();
  } else {
    core.resetCamera();
  }
});
function updateMotionButton() {
  const label = core.motion ? 'Pause animation' : 'Resume animation';
  get('motion').textContent = core.motion ? 'Ⅱ' : '▷';
  get('motion').title = label;
  get('motion').setAttribute('aria-label', label);
  get('motion').setAttribute('aria-pressed', String(core.motion));
}
get('motion').addEventListener('click', () => {
  core.setMotion(!core.motion);
  updateMotionButton();
});
updateMotionButton();
