// The standalone page around the map: header, toolbar, Pages panel (search + reading), Home dashboard.
// assemble.mjs inlines this with the core modules into one HTML file.
import { createBlackHole } from './blackhole.js';
import { hideDashboardTip, renderHomeDashboard } from './dashboard.js';

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
// Home dashboard: drawn by src/dashboard.js into this page's elements.
const dashboard = {panel: get('home-panel'), date: get('home-date'), kpis: get('home-kpis'), activity: get('chart-activity'),
  groups: get('chart-groups'), connected: get('chart-connected'), tip: get('chart-tip')};
const hideTip = () => hideDashboardTip(dashboard);
function renderDashboard() {
  renderHomeDashboard(dashboard, {nodes, edges, regions}, {
    countUp: get('home-panel').classList.contains('intro') && !reducedMotion.matches,
    onGroup: name => { get('home-panel').hidden = true; focusRegion(name); },
    onNote: i => { get('home-panel').hidden = true; selectPage(i); },
  });
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
