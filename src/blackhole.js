// The black-hole map as a reusable module: createBlackHole(container, graph, options).
// Used by the standalone page (src/app.js) and the Obsidian plugin (obsidian/).
// graph = {nodes, edges, regions}; see README "Data format".
import { createSkyRenderer, releaseSpaceSkyCanvas } from './sky.js';
import { createLensRenderer, lensRadius, randomSource } from './lensing.js';

// True when this browser can draw the black hole. Hosts can show a message instead.
let labelCount = 0;

export function supportsWebGL2(doc) {
  const gl = doc.createElement('canvas').getContext('webgl2');
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return !!gl;
}

/**
 * options:
 *  onSelect(node | null, {index, idea, event})  a star (or empty space) was clicked
 *  readingPanel = true   true: a click also selects the star and flies to its group, leaving room for
 *                        a reading panel. false: clicks only call onSelect; the host shows notes itself.
 *  onRegionChange(name | null, source)  source: 'hub' | 'select' | 'api' | 'update'
 *  onCoreClick()         adds a clickable "Home" target on the black hole
 *  onFps(fps), onMotionChange(enabled)
 *  label                 accessible label for the map
 * returns {update(graph), resize(), destroy(), resetCamera(), select(i), focusRegion(name), zoomBy(f),
 *          flyHome(), setOverlayOpen(open), setMotion(on), hubButton(name), region, selected, motion, moving}
 */
export function createBlackHole(container, graph, options = {}) {
  const {onSelect, onRegionChange, onCoreClick, onFps, onMotionChange, readingPanel = true,
    label = 'Interactive 3D map of your notes. Drag to rotate, scroll to zoom.'} = options;
  const doc = container.ownerDocument, win = doc.defaultView;
  const events = new AbortController();
  const on = (target, type, fn, opts = {}) => target.addEventListener(type, fn, {...opts, signal: events.signal});
  const make = (tag, className, attrs = {}) => Object.assign(doc.createElement(tag), {className}, attrs);

  // ---- DOM: sky (WebGL), lens (WebGL), signals and stars (2D), group labels, black-hole button ----
  container.classList.add('sbbh');
  const skyCanvas = make('canvas', 'sbbh-sky', {hidden: true});
  const signalCanvas = make('canvas', 'sbbh-signals');
  const canvas = make('canvas', 'sbbh-graph');
  const hubLayer = make('div', 'sbbh-hubs');
  skyCanvas.setAttribute('aria-hidden', 'true');
  signalCanvas.setAttribute('aria-hidden', 'true');
  // The label is hidden text, not aria-label: apps like Obsidian turn aria-label into a hover tooltip.
  const labelEl = make('span', 'sbbh-sr', {id: `sbbh-label-${++labelCount}`, textContent: label});
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-labelledby', labelEl.id);
  const core = onCoreClick ? make('button', 'sbbh-core', {type: 'button', title: 'Home'}) : null;
  if (core) {
    core.setAttribute('aria-label', 'Open Home');
    core.append(make('span', '', {textContent: 'Home'}));
    on(core, 'click', () => onCoreClick());
  }
  const created = [labelEl, skyCanvas, signalCanvas, canvas, hubLayer, ...(core ? [core] : [])];
  container.append(...created);
  const ctx = canvas.getContext('2d');
  const signalCtx = signalCanvas.getContext('2d');

  const defaultView = {yaw: 0.12, pitch: -0.08, zoom: .86, center: [0, 0, 0]};
  const view = {...defaultView};
  let region = null;
  let cameraMove = null;
  const cameraDuration = 1200;
  let selected = null;
  let hovered = null;
  let hoveredIdea = null;
  let projected = [];
  let projectedIdeas = [];
  let spin = 0;
  let drag = null;
  let pendingFrame = false;
  let glowTime = 0;
  let lastTick = null;
  let overlayOpen = false;
  let destroyed = false;
  let frameId = 0, pendingId = 0;
  const reducedMotion = win.matchMedia('(prefers-reduced-motion: reduce)');
  let glowEnabled = !reducedMotion.matches;
  const scene = {get view() { return view; }, get time() { return glowTime; }, get region() { return region; }};

  const whiteGlow = glowSprite('#ffffff');
  const whiteOrb = orbSprite('#ffffff');

  // ---- graph-derived state (rebuilt by update) ----
  let nodes, edges, regions, neighbors, pageOrbits, clusters, ideas, ideaOffsets, beadLinks, beadCount, hubs = [];
  let clusterKey = '';
  function setGraph(next) {
    nodes = next.nodes;
    edges = next.edges;
    regions = structuredClone(next.regions);
    // One continuous disc around the Home black hole. Each group is a wedge sized by its page count,
    // and neighbouring wedges overlap a little so the map reads as one vault, not six islands.
    const groupOrder = ['Knowledge', 'Projects', 'Decisions', 'Reference notes', 'Reviews', 'Plans'];
    const rankOf = name => { const i = groupOrder.indexOf(name); return i < 0 ? 99 : i; };
    const groupNames = Object.keys(regions).sort((a, b) => rankOf(a) - rankOf(b));
    const groupWeights = groupNames.map(name => Math.max(1, nodes.filter(n => n.region === name).length) ** .6);
    const weightSum = groupWeights.reduce((a, b) => a + b, 0);
    const sectors = {};
    let sweep = -Math.PI * groupWeights[0] / weightSum;
    groupNames.forEach((name, g) => { const width = 2 * Math.PI * groupWeights[g] / weightSum; sectors[name] = {start: sweep, width}; sweep += width; });
    const frac = x => x - Math.floor(x);
    pageOrbits = nodes.map((node, i) => {
      const sector = sectors[node.region];
      const siblings = nodes.reduce((list, n, j) => { if (n.region === node.region) list.push(j); return list; }, []);
      const slot = siblings.indexOf(i);
      const u = frac(.5 + slot * .7548776662), v = frac(.5 + slot * .5698402910);
      const angle = sector.start - sector.width * .16 + sector.width * 1.32 * u;
      const radius = .34 + .72 * Math.sqrt(v);
      const z = (frac(Math.sin(i * 12.9898 + 4.1) * 43758.5453) - .5) * .26;
      return [radius * Math.cos(angle), radius * Math.sin(angle) * .9, z];
    });
    Object.entries(regions).forEach(([name, r]) => {
      const own = pageOrbits.filter((_, i) => nodes[i].region === name);
      const mid = sectors[name].start + sectors[name].width / 2;
      r.center = own.length ? [0, 1, 2].map(axis => own.reduce((sum, p) => sum + p[axis], 0) / own.length) : [.7 * Math.cos(mid), .63 * Math.sin(mid), 0];
      r.spread = r.spread.map(v => v * .76);
    });
    neighbors = nodes.map(() => []);
    for (const [a, b] of edges) {
      neighbors[a].push(b);
      neighbors[b].push(a);
    }
    clusters = Object.entries(regions).map(([name, r], index) =>
      ({name, ...r, particles: [], phase: index * 0.83, sprite: whiteGlow, orb: whiteOrb}));
    // Ideas: every h2/h3 section of a page is one tiny orb fanning out from its page.
    ideas = [];
    nodes.forEach((node, page) => (node.ideas || []).forEach((title, k) => ideas.push({page, k, title})));
    ideaOffsets = ideas.map(idea => {
      const rng = seeded(idea.page * 7919 + idea.k * 104729 + 11);
      const count = nodes[idea.page].ideas.length;
      const y = 1 - 2 * (idea.k + .5) / count;
      const ring = Math.sqrt(Math.max(0, 1 - y*y));
      const angle = idea.k * 2.399963229728653 + rng() * 6.2832;
      const reach = .03 + .11 * rng() ** 1.6;
      return [ring*Math.cos(angle)*reach, y*reach*.85, ring*Math.sin(angle)*reach];
    });
    for (const cluster of clusters) {
      let extent = .2;
      const grow = p => { extent = Math.max(extent, Math.hypot(...p.map((v,a) => v - cluster.center[a]))); };
      nodes.forEach((node, i) => { if (node.region === cluster.name) grow(pageOrbits[i]); });
      ideas.forEach((idea, n) => { if (nodes[idea.page].region === cluster.name) grow(pageOrbits[idea.page].map((v,a) => v + ideaOffsets[n][a])); });
      cluster.extent = regions[cluster.name].extent = extent;
    }
    // Light beads: small lights travelling along page links and idea spokes.
    beadLinks = [
      ...ideas.map((idea, n) => ({spoke: true, page: idea.page, idea: n})),
      ...edges.map(([a, b]) => ({spoke: false, a, b})),
    ];
    beadCount = Math.min(320, beadLinks.length);
    buildHubs();
    // The lens only depends on the groups, so it is rebuilt (in the same WebGL context) only when they change.
    const key = JSON.stringify(clusters.map(c => [c.name, c.center, c.spread]));
    if (key !== clusterKey) { clusterKey = key; buildLens(); }
  }

  // ---- WebGL renderers ----
  let skyRenderer = null;
  try {
    skyRenderer = createSkyRenderer(skyCanvas, scene);
  } catch (error) {
    console.error('Sky renderer unavailable', error);
  }
  let lensRenderer = null;
  let liveCamera = null;
  let liveVisibility = null;
  function buildLens() {
    const surface = lensRenderer?.surface;
    lensRenderer?.dispose();
    lensRenderer = null;
    try {
      lensRenderer = createLensRenderer(clusters, scene, surface ?? doc.createElement('canvas'));
    } catch (error) {
      console.error('Lensing unavailable', error);
    }
    if (lensRenderer && !surface) {
      lensRenderer.surface.className = 'sbbh-lens';
      lensRenderer.surface.setAttribute('aria-hidden', 'true');
      signalCanvas.before(lensRenderer.surface);
    }
  }

  // The whole map turns slowly in its own plane around the black hole.
  function spinPos(p) {
    const c = Math.cos(spin), s = Math.sin(spin);
    return [p[0]*c - p[1]*s, p[0]*s + p[1]*c, p[2]];
  }
  function pageBase(index, time = glowTime) {
    return pageOrbits[index].map((v,axis) => v + .006*Math.sin(time*(.13+axis*.027)+index*1.71+axis*2.1));
  }
  function pageWorldPosition(index, time = glowTime) {
    return spinPos(pageBase(index, time));
  }
  function projectPagePosition(index, camera, time = glowTime) {
    return project(pageWorldPosition(index,time),camera);
  }
  function hash(n) {
    n = Math.imul(n ^ 61, 0x27d4eb2d); n ^= n >>> 15; n = Math.imul(n, 0x2c1b3c6d); n ^= n >>> 12;
    return (n >>> 0) / 4294967296;
  }
  function seeded(seed) { return randomSource(Math.floor(hash(seed) * 4294967296)); }
  function ideaWorldPosition(n, time = glowTime) {
    const base = pageBase(ideas[n].page, time), o = ideaOffsets[n];
    return spinPos(base.map((v,axis) => v + o[axis] + .003*Math.sin(time*(.21+axis*.05)+n*1.3+axis)));
  }
  // Comets: bright heads with long fading tails on wide orbits outside the groups.
  const comets = Array.from({length: 13}, (_, j) => {
    const r = seeded(900 + j * 37);
    return {radius: 1.22 + .5*r(), tilt: (r()-.5)*1.2, node: r()*6.2832, speed: (.07 + .09*r()) * (r() < .5 ? -1 : 1),
            phase: r()*6.2832, tail: .65 + .7*r(), brightness: .5 + .5*r()};
  });
  function cometWorld(c, angle) {
    const x = Math.cos(angle)*c.radius, y = Math.sin(angle)*c.radius*.94;
    const y1 = y*Math.cos(c.tilt), z1 = y*Math.sin(c.tilt);
    const cn = Math.cos(c.node), sn = Math.sin(c.node);
    return [x*cn - y1*sn, x*sn + y1*cn, z1];
  }

  // ---- group labels ----
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  function buildHubs() {
    hubs = clusters.map(cluster => {
      const button = make('button', 'sbbh-hub', {type: 'button'});
      const dot = make('span', 'sbbh-hub-dot');
      dot.setAttribute('aria-hidden', 'true');
      const name = make('span', 'sbbh-hub-name', {textContent: cluster.name});
      const amount = ideas.filter(idea => nodes[idea.page].region === cluster.name).length;
      const count = make('span', 'sbbh-hub-count',
        {textContent: amount ? plural(amount, 'idea') : plural(nodes.filter(n => n.region === cluster.name).length, 'page')});
      button.append(dot, name, count);
      // plain listener: it goes away with the button when the labels are rebuilt
      button.addEventListener('click', () => {
        select(null);
        onSelect?.(null, {index: null, idea: null, event: null});
        focusRegion(cluster.name, 'hub');
      });
      return {button, cluster};
    });
    hubLayer.replaceChildren(...hubs.map(hub => hub.button));
  }

  function focusRegion(name, source = 'api') {
    if (region === name) return;
    const startVisibility = new Map(clusters.map(cluster => [cluster.name, regionOpacity(cluster.name)]));
    const startHubs = hubOpacity();
    region = name;
    hovered = null;
    hoveredIdea = null;
    const destination = name === null ? defaultView : {
      center: spinPos(regions[name].center),
      zoom: Math.min(3.25, 0.9 / regions[name].extent),
    };
    cameraMove = null;
    if (reducedMotion.matches) {
      Object.assign(view, destination);
    } else {
      const targetView = {...view, ...destination};
      for (const angle of ['yaw', 'pitch']) {
        const delta = targetView[angle] - view[angle];
        targetView[angle] = view[angle] + Math.atan2(Math.sin(delta), Math.cos(delta));
      }
      cameraMove = {
        start: performance.now(),
        fraction: 0,
        origin: {...view},
        destination: targetView,
        startVisibility,
        startHubs,
      };
    }
    onRegionChange?.(name, source);
    draw();
  }

  function flyHome() {
    const destination = {...defaultView, zoom: 1.23};
    if (reducedMotion.matches) Object.assign(view, destination);
    else cameraMove = {start: performance.now(), fraction: 0, origin: {...view, center: [...view.center]}, destination,
      startVisibility: new Map(clusters.map(c => [c.name, regionOpacity(c.name)])), startHubs: hubOpacity()};
    draw();
  }

  function glowSprite(color) {
    const sprite = doc.createElement('canvas');
    sprite.width = sprite.height = 24;
    const brush = sprite.getContext('2d');
    const gradient = brush.createRadialGradient(12, 12, 0, 12, 12, 12);
    gradient.addColorStop(0, color + 'aa');
    gradient.addColorStop(0.28, color + '70');
    gradient.addColorStop(0.58, color + '25');
    gradient.addColorStop(1, color + '00');
    brush.fillStyle = gradient;
    brush.fillRect(0, 0, 24, 24);
    return sprite;
  }

  function orbSprite(color) {
    const sprite = doc.createElement('canvas');
    sprite.width = sprite.height = 64;
    const brush = sprite.getContext('2d');
    const body = brush.createRadialGradient(23, 21, 2, 32, 32, 29);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(0.14, '#ffffff');
    body.addColorStop(0.38, color);
    body.addColorStop(0.80, color + 'a8');
    body.addColorStop(1, '#242424');
    brush.beginPath();
    brush.arc(32, 32, 29, 0, Math.PI * 2);
    brush.fillStyle = body;
    brush.fill();
    brush.strokeStyle = color;
    brush.lineWidth = 1.4;
    brush.stroke();
    return sprite;
  }

  function glowWave(distance, phase) {
    return Math.max(0, Math.cos(distance * 3.1 - glowTime * 0.86 + phase)) ** 12;
  }

  function project(position, camera) {
    const x = position[0] - view.center[0];
    const y = position[1] - view.center[1];
    const z = position[2] - view.center[2];
    const {cy, sy, cp, sp, width, height} = camera;
    const rx = x * cy - z * sy;
    const rz = x * sy + z * cy;
    const ry = y * cp - rz * sp;
    const depth = y * sp + rz * cp;
    const perspective = 3.4 / (3.4 - depth);
    const scale = Math.min(width, height) * 0.46 * view.zoom * perspective;
    return {x: width / 2 + rx * scale, y: height / 2 + ry * scale, depth,
            perspective};
  }

  function smoothRange(value, start, end) {
    const t = Math.min(1, Math.max(0, (value - start) / (end - start)));
    return t * t * (3 - 2 * t);
  }

  function regionOpacity(name) {
    const target = !region || name === region ? 1 : 0;
    if (!cameraMove) return target;
    const fade = smoothRange(cameraMove.fraction, 0.12, 0.82);
    const origin = cameraMove.startVisibility.get(name) ?? target;
    return origin + (target - origin) * fade;
  }

  function hubOpacity() {
    const target = region ? 0 : 1;
    if (!cameraMove) return target;
    const fade = region
      ? smoothRange(cameraMove.fraction, 0.05, 0.36)
      : smoothRange(cameraMove.fraction, 0.60, 0.96);
    return cameraMove.startHubs + (target - cameraMove.startHubs) * fade;
  }

  function draw() {
    if (destroyed) return;
    const {width, height} = canvas.getBoundingClientRect();
    const dpr = win.devicePixelRatio || 1;
    const pxWidth = Math.round(width * dpr), pxHeight = Math.round(height * dpr);
    if (canvas.width !== pxWidth || canvas.height !== pxHeight) {
      canvas.width = pxWidth;
      canvas.height = pxHeight;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const camera = {width, height, cy: Math.cos(view.yaw), sy: Math.sin(view.yaw),
                    cp: Math.cos(view.pitch), sp: Math.sin(view.pitch)};
    skyCanvas.hidden = !skyRenderer?.(camera);
    if (signalCanvas.width !== pxWidth || signalCanvas.height !== pxHeight) {
      signalCanvas.width = pxWidth;
      signalCanvas.height = pxHeight;
      signalCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const points = nodes.map((node, i) => {
      const point = projectPagePosition(i, camera);
      return {...point, i, radius: (4 + Math.sqrt(node.degree) * .8) * point.perspective};
    });
    const ideaPoints = ideas.map((idea, n) => ({...project(ideaWorldPosition(n), camera), n, i: idea.page}));
    const visibility = new Map(clusters.map(cluster => [cluster.name, regionOpacity(cluster.name)]));
    liveCamera = camera;
    liveVisibility = visibility;
    const lensLayer = lensRenderer?.(camera, visibility, nodes[selected]?.region);
    hubLayer.classList.remove('sbbh-lensed');
    if (core) {
      const home = project([0,0,0],camera);
      const size = Math.max(44,2*lensRadius*Math.min(width,height)*.46*view.zoom*home.perspective);
      core.style.left = home.x+'px'; core.style.top = home.y+'px'; core.style.width = size+'px'; core.style.height = size+'px';
      core.hidden = !!region||!!cameraMove||overlayOpen;
    }
    drawParticles(camera, visibility, !!lensLayer);

    const adjacent = new Set(neighbors[selected] || []);
    const focusOf = i => selected === null ? 1 : i === selected ? 1 : adjacent.has(i) ? .7 : .32;
    // Spokes from each page to its ideas: the thin star shapes.
    for (const cluster of clusters) {
      const opacity = visibility.get(cluster.name);
      if (!opacity) continue;
      const quiet = new Path2D(), lit = new Path2D();
      for (const p of ideaPoints) {
        if (nodes[p.i].region !== cluster.name) continue;
        const from = points[p.i], path = p.i === selected || p.i === hovered ? lit : quiet;
        path.moveTo(from.x, from.y);
        path.lineTo(p.x, p.y);
      }
      ctx.lineWidth = .6;
      ctx.strokeStyle = '#d4d4d4';
      ctx.globalAlpha = opacity * (selected === null ? .17 : .07);
      ctx.stroke(quiet);
      ctx.lineWidth = .9;
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = opacity * .6;
      ctx.stroke(lit);
    }
    // Links between pages.
    for (const [a, b] of edges) {
      const opacity = Math.min(visibility.get(nodes[a].region), visibility.get(nodes[b].region));
      if (opacity === 0) continue;
      const active = a === selected || b === selected;
      ctx.beginPath();
      ctx.moveTo(points[a].x, points[a].y);
      ctx.lineTo(points[b].x, points[b].y);
      ctx.strokeStyle = active ? '#ffffff' : '#bdbdbd';
      ctx.globalAlpha = opacity * (active ? .62 : selected === null ? .075 : .035);
      ctx.lineWidth = active ? 1.1 : .55;
      ctx.stroke();
    }

    drawMotion(camera, points, ideaPoints, visibility);
    // The GPU surface is visible directly. Keep page markers and labels crisp
    // on this separate overlay, without copying GPU pixels into Canvas each frame.
    if (lensLayer) maskShadows(ctx, camera);

    projected = points.filter(p => !region || nodes[p.i].region === region).sort((a,b) => a.depth-b.depth);
    projectedIdeas = ideaPoints.filter(p => !region || nodes[p.i].region === region);
    const reveal = cameraMove ? smoothRange(cameraMove.fraction, 0.57, 0.97) : 1;
    const sizeBoost = Math.sqrt(Math.sqrt(view.zoom));
    if (reveal > 0) {
      // Ideas: tiny white points, batched into four brightness bands.
      const bands = Array.from({length: 4}, () => new Path2D());
      for (const p of projectedIdeas) {
        if (p.n === hoveredIdea) continue;
        const r = Math.max(.55, .95 * Math.sqrt(p.perspective) * sizeBoost);
        const twinkle = .5 + .5 * Math.sin(glowTime * (.55 + (p.n % 7) * .1) + p.n);
        const band = (focusOf(p.i) > .5 ? 2 : 0) + (twinkle > .55 ? 1 : 0);
        bands[band].moveTo(p.x + r, p.y);
        bands[band].arc(p.x, p.y, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = '#ffffff';
      bands.forEach((path, b) => { ctx.globalAlpha = reveal * [.22, .38, .62, .9][b]; ctx.fill(path); });
      // Pages: slightly larger stars with a soft glow.
      ctx.globalCompositeOperation = 'lighter';
      for (const p of projected) {
        const active = p.i === selected || p.i === hovered;
        const o = reveal * focusOf(p.i);
        const coreSize = (active ? 2.5 : 1.55) * Math.sqrt(p.perspective) * sizeBoost;
        const reach = coreSize * (active ? 7 : 5.5);
        ctx.globalAlpha = o * .5;
        ctx.drawImage(whiteGlow, p.x - reach, p.y - reach, reach * 2, reach * 2);
        ctx.globalAlpha = o;
        ctx.beginPath();
        ctx.arc(p.x, p.y, coreSize, 0, Math.PI * 2);
        ctx.fill();
      }
      const lit = hoveredIdea === null ? null : projectedIdeas.find(q => q.n === hoveredIdea);
      if (lit) {
        ctx.globalAlpha = reveal;
        ctx.drawImage(whiteGlow, lit.x - 13, lit.y - 13, 26, 26);
        ctx.beginPath();
        ctx.arc(lit.x, lit.y, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.globalAlpha = 1;
    const hubLight = hubOpacity();
    hubLayer.hidden = hubLight === 0 || overlayOpen;
    hubLayer.inert = !!cameraMove || !!region;
    hubLayer.style.opacity = hubLight;
    if (hubLight > 0) positionHubs(camera);
    const ideaLabel = hoveredIdea === null ? null : projectedIdeas.find(p => p.n === hoveredIdea);
    const label = ideaLabel || projected.find(point => point.i === (hovered ?? selected));
    if (label && !cameraMove) {
      const font = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';
      const name = ideaLabel ? ideas[hoveredIdea].title : nodes[label.i].title;
      const sub = ideaLabel ? nodes[label.i].title : '';
      ctx.font = '500 12px ' + font;
      let box = ctx.measureText(name).width;
      ctx.font = '400 11px ' + font;
      if (sub) box = Math.max(box, ctx.measureText(sub).width);
      box = Math.min(width - 12, box + 24);
      const tall = sub ? 42 : 28;
      const lift = ideaLabel ? 12 : label.radius;
      const x = Math.min(Math.max(6, label.x - box / 2), width - box - 6);
      const y = Math.max(4, Math.min(height - tall - 4, label.y - lift - tall - 8));
      ctx.beginPath();
      ctx.roundRect(x, y, box, tall, 12);
      ctx.fillStyle = 'rgba(18, 18, 20, .86)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, .14)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#efefef';
      ctx.font = '500 12px ' + font;
      ctx.fillText(name, x + 12, y + 18, box - 24);
      if (sub) {
        ctx.fillStyle = '#9a9a9a';
        ctx.font = '400 11px ' + font;
        ctx.fillText(sub, x + 12, y + 33, box - 24);
      }
    }
  }

  function maskShadows(context, camera) {
    context.save();
    context.globalCompositeOperation = 'destination-out';
    const p = project([0,0,0], camera);
    context.globalAlpha=1;
    context.beginPath();
    context.arc(p.x,p.y,lensRadius*Math.min(camera.width,camera.height)*.46*view.zoom*p.perspective,0,Math.PI*2);
    context.fill();
    context.restore();
  }

  // Light beads on links, and comets on wide orbits around the outside.
  function drawMotion(camera, points, ideaPoints, visibility) {
    const scale = win.devicePixelRatio || 1;
    signalCtx.clearRect(0, 0, signalCanvas.width / scale, signalCanvas.height / scale);
    signalCtx.globalCompositeOperation = 'lighter';
    signalCtx.fillStyle = '#ffffff';
    signalCtx.strokeStyle = '#ffffff';
    for (let j = 0; j < beadCount; j++) {
      const duration = 2.6 + 2.8 * hash(j * 3 + 1);
      const t = glowTime / duration + hash(j * 3 + 2);
      const cycle = Math.floor(t), f = t - cycle;
      const link = beadLinks[Math.floor(hash(j * 7919 + cycle * 104729) * beadLinks.length)];
      let start, end, opacity, touches;
      if (link.spoke) {
        opacity = visibility.get(nodes[link.page].region);
        [start, end] = hash(j + cycle * 31) < .5 ? [points[link.page], ideaPoints[link.idea]] : [ideaPoints[link.idea], points[link.page]];
        touches = link.page === selected;
      } else {
        opacity = Math.min(visibility.get(nodes[link.a].region), visibility.get(nodes[link.b].region));
        [start, end] = hash(j + cycle * 31) < .5 ? [points[link.a], points[link.b]] : [points[link.b], points[link.a]];
        touches = link.a === selected || link.b === selected;
      }
      if (!opacity) continue;
      const alpha = opacity * Math.sin(Math.PI * f) * (selected === null || touches ? .85 : .2);
      const x = start.x + (end.x - start.x) * f, y = start.y + (end.y - start.y) * f;
      const back = Math.max(0, f - .08);
      signalCtx.globalAlpha = alpha * .45;
      signalCtx.lineWidth = .8;
      signalCtx.beginPath();
      signalCtx.moveTo(start.x + (end.x - start.x) * back, start.y + (end.y - start.y) * back);
      signalCtx.lineTo(x, y);
      signalCtx.stroke();
      signalCtx.globalAlpha = alpha * .55;
      signalCtx.drawImage(whiteGlow, x - 5, y - 5, 10, 10);
      signalCtx.globalAlpha = alpha;
      signalCtx.beginPath();
      signalCtx.arc(x, y, .95, 0, Math.PI * 2);
      signalCtx.fill();
    }
    const cometLight = hubOpacity();
    if (cometLight > 0) for (const comet of comets) {
      const head = comet.phase + comet.speed * glowTime;
      const direction = Math.sign(comet.speed), steps = 28;
      let previous = null;
      for (let k = 0; k <= steps; k++) {
        const p = project(cometWorld(comet, head - direction * comet.tail * k / steps), camera);
        if (previous) {
          const fade = (1 - k / steps) ** 1.7;
          signalCtx.globalAlpha = cometLight * comet.brightness * fade * .8;
          signalCtx.lineWidth = .35 + 1.5 * fade;
          signalCtx.beginPath();
          signalCtx.moveTo(previous.x, previous.y);
          signalCtx.lineTo(p.x, p.y);
          signalCtx.stroke();
        }
        previous = p;
      }
      const h = project(cometWorld(comet, head), camera);
      signalCtx.globalAlpha = cometLight * comet.brightness;
      signalCtx.drawImage(whiteGlow, h.x - 11, h.y - 11, 22, 22);
      signalCtx.beginPath();
      signalCtx.arc(h.x, h.y, 1.7, 0, Math.PI * 2);
      signalCtx.fill();
    }
    signalCtx.globalAlpha = 1;
    signalCtx.globalCompositeOperation = 'source-over';
    if (lensRenderer && liveCamera) maskShadows(signalCtx, liveCamera, liveVisibility);
  }

  function drawParticles(camera, visibility, lensed) {
    if (lensed) return;
    const {width, height} = camera;
    const zoomScale = Math.sqrt(view.zoom);
    ctx.globalCompositeOperation = 'lighter';

    for (const cluster of clusters) {
      const visible = visibility.get(cluster.name);
      if (visible === 0) continue;
      const center = project(spinPos(cluster.center), camera);
      const dimmed = selected !== null && nodes[selected].region !== cluster.name;
      const radius = Math.min(width, height) * 0.29 * view.zoom * center.perspective;
      const ambient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
      ambient.addColorStop(0, '#ffffff12');
      ambient.addColorStop(0.38, '#ffffff06');
      ambient.addColorStop(1, '#ffffff00');
      ctx.globalAlpha = visible * (dimmed ? 0.45 : 1) * (0.70 + 0.30 * Math.sin(glowTime * 0.58 + cluster.phase) ** 2);
      ctx.fillStyle = ambient;
      ctx.fillRect(center.x - radius, center.y - radius, radius * 2, radius * 2);
    }

    for (const cluster of clusters) {
      const visible = visibility.get(cluster.name);
      if (visible === 0) continue;
      const dimmed = selected !== null && nodes[selected].region !== cluster.name;
      const opacity = visible * (dimmed ? 0.44 : 1);
      const cores = Array.from({length: 5}, () => new Path2D());
      const highlights = new Path2D();
      for (const particle of cluster.particles) {
        const {x, y, perspective} = project(particle.position, camera);
        const radius = Math.max(0.65, particle.size * perspective * zoomScale);
        const wave = glowWave(particle.distance, cluster.phase);
        const halo = radius * (2.8 + wave * 3.5);
        if (x < -halo || x > width + halo || y < -halo || y > height + halo) continue;
        ctx.globalAlpha = opacity * (0.20 + wave * 0.75);
        ctx.drawImage(cluster.sprite, x - halo, y - halo, halo * 2, halo * 2);

        const coreRing = cores[Math.min(4, Math.floor((particle.intensity * 0.55 + wave * 0.45) * 5))];
        coreRing.moveTo(x + radius, y);
        coreRing.arc(x, y, radius, 0, 2 * Math.PI);
        if (radius > 1.25) {
          const hx = x - radius * 0.25, hy = y - radius * 0.3;
          highlights.moveTo(hx + radius * 0.30, hy);
          highlights.arc(hx, hy, radius * 0.30, 0, 2 * Math.PI);
        }
      }
      ctx.fillStyle = '#ffffff';
      cores.forEach((path, i) => {
        ctx.globalAlpha = opacity * Math.min(1, 0.53 + i * 0.15);
        ctx.fill(path);
      });
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = opacity * 0.75;
      ctx.fill(highlights);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function queueDraw() {
    if (pendingFrame || destroyed) return;
    pendingFrame = true;
    pendingId = win.requestAnimationFrame(() => {
      pendingFrame = false;
      draw();
    });
  }

  function positionHubs(camera) {
    for (const {button, cluster} of hubs) {
      const point = project(spinPos(cluster.center), camera);
      button.style.left = Math.min(camera.width - 60, Math.max(60, point.x)) + 'px';
      button.style.top = Math.min(camera.height - 70, Math.max(70, point.y)) + 'px';
      button.style.zIndex = Math.round(point.depth * 100 + 100);
      const radius = lensRadius * Math.min(camera.width, camera.height) * 0.46 * view.zoom * point.perspective;
      const hitSize = Math.max(44, radius * 2);
      button.style.setProperty('--shadow-size', 2 * radius + 'px');
      button.style.setProperty('--hub-hit', hitSize + 'px');
      button.style.setProperty('--hub-label-y', Math.max(41, hitSize / 2 + radius + 7) + 'px');
    }
  }

  function select(index) {
    selected = index;
    hovered = null;
    hoveredIdea = null;
    if (index !== null) focusRegion(nodes[index].region, 'select');
    draw();
  }
  function clearSelection() {
    if (selected === null) return;
    select(null);
    onSelect?.(null, {index: null, idea: null, event: null});
  }

  function pick(event) {
    if (cameraMove) return null;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    let best = null;
    for (const p of projected) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= p.radius + 4 && (!best || d < best.d)) best = {d, page: p.i, idea: null};
    }
    for (const p of projectedIdeas) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= 6 && (!best || d < best.d - 1)) best = {d, page: p.i, idea: p.n};
    }
    return best;
  }
  function zoom(factor) {
    if (cameraMove) return;
    view.zoom = Math.max(0.55, Math.min(3.25, view.zoom * factor));
    draw();
  }

  on(canvas, 'pointerdown', event => {
    if (cameraMove || drag || event.button !== 0) return;
    drag = {id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, hit: pick(event)};
    canvas.setPointerCapture(event.pointerId);
  });
  on(canvas, 'pointermove', event => {
    if (drag) {
      if (event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      view.yaw += dx * 0.008;
      view.pitch += dy * 0.008;
      Object.assign(drag, {x: event.clientX, y: event.clientY, moved: true});
      hovered = null;
      hoveredIdea = null;
      canvas.classList.add('dragging');
    } else {
      const hit = pick(event);
      hovered = hit?.page ?? null;
      hoveredIdea = hit?.idea ?? null;
    }
    queueDraw();
  });
  function endDrag(event) {
    if (drag?.id !== event.pointerId) return;
    const clicked = event.type === 'pointerup' && !drag.moved;
    const hit = drag.hit;
    drag = null;
    canvas.classList.remove('dragging');
    if (!clicked) return;
    const index = hit?.page ?? null;
    if (readingPanel) select(index);
    onSelect?.(index === null ? null : nodes[index], {index, idea: hit?.idea != null ? ideas[hit.idea] : null, event});
  }
  on(canvas, 'pointerup', endDrag);
  on(canvas, 'pointercancel', endDrag);
  on(canvas, 'lostpointercapture', endDrag);
  on(canvas, 'pointerleave', () => { hovered = null; hoveredIdea = null; draw(); });
  on(canvas, 'wheel', event => {
    event.preventDefault();
    zoom(Math.exp(-Math.max(-180, Math.min(180, event.deltaY)) * 0.0025));
  }, {passive: false});
  on(reducedMotion, 'change', event => {
    glowEnabled = !event.matches;
    lastTick = null;
    onMotionChange?.(glowEnabled);
  });
  let mapVisible = true;
  const visibilityWatch = new win.IntersectionObserver(entries => {
    mapVisible = entries[0].isIntersecting;
    lastTick = null;
  });
  visibilityWatch.observe(canvas);
  const sizeWatch = new win.ResizeObserver(() => draw());
  sizeWatch.observe(canvas);

  const fpsMeter = {frames: 0, since: null};
  function countFrame(now) {
    fpsMeter.frames++;
    fpsMeter.since ??= now;
    if (now - fpsMeter.since < 500) return;
    onFps?.(Math.round(fpsMeter.frames * 1000 / (now - fpsMeter.since)));
    fpsMeter.frames = 0; fpsMeter.since = now;
  }
  function animate(now) {
    if (destroyed) return;
    countFrame(now);
    if (cameraMove) {
      const {start, origin, destination} = cameraMove;
      const fraction = Math.max(0, Math.min(1, (now - start) / cameraDuration));
      cameraMove.fraction = fraction;
      const eased = fraction ** 3 * (10 - 15 * fraction + 6 * fraction ** 2);
      const mix = (from, to) => from + (to - from) * eased;
      view.center = origin.center.map((value, axis) => mix(value, destination.center[axis]));
      view.zoom = mix(origin.zoom, destination.zoom);
      view.yaw = mix(origin.yaw, destination.yaw);
      view.pitch = mix(origin.pitch, destination.pitch);
      if (fraction === 1) cameraMove = null;
      queueDraw();
    }
    if (glowEnabled && !doc.hidden && mapVisible) {
      if (lastTick === null) lastTick = now;
      const step = Math.max(0, Math.min(0.1, (now - lastTick) / 1000));
      glowTime += step;
      if (!region && selected === null && !drag && !cameraMove && !overlayOpen) spin += step * .035;
      lastTick = now;
      // One frame rebuilds moving page positions, hit targets, connection
      // endpoints, sky, and plasma with the same time value.
      if (!pendingFrame) draw();
    } else {
      lastTick = null;
    }
    frameId = win.requestAnimationFrame(animate);
  }

  setGraph(graph);
  releaseSpaceSkyCanvas();
  draw();
  frameId = win.requestAnimationFrame(animate);

  return {
    // New notes, links or groups: keeps the WebGL contexts and camera, swaps the data.
    update(next) {
      const path = selected === null ? null : nodes[selected]?.path;
      setGraph(next);
      selected = path == null ? null : nodes.findIndex(n => n.path === path);
      if (selected < 0) selected = null;
      hovered = null;
      hoveredIdea = null;
      if (region !== null && !regions[region]) { region = null; cameraMove = null; Object.assign(view, defaultView); onRegionChange?.(null, 'update'); }
      draw();
    },
    resize: () => draw(),
    resetCamera() {
      if (region) { clearSelection(); focusRegion(null, 'api'); return; }
      clearSelection();
      cameraMove = null;
      Object.assign(view, defaultView);
      draw();
    },
    select,
    focusRegion: name => focusRegion(name, 'api'),
    zoomBy: zoom,
    flyHome,
    setOverlayOpen(open) { overlayOpen = open; draw(); },
    setMotion(enabled) { glowEnabled = enabled; lastTick = null; },
    hubButton: name => hubs.find(hub => hub.cluster.name === name)?.button,
    get region() { return region; },
    get selected() { return selected; },
    get motion() { return glowEnabled; },
    get moving() { return !!cameraMove; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      events.abort();
      win.cancelAnimationFrame(frameId);
      win.cancelAnimationFrame(pendingId);
      visibilityWatch.disconnect();
      sizeWatch.disconnect();
      for (const renderer of [skyRenderer, lensRenderer]) {
        if (!renderer) continue;
        renderer.dispose();
        renderer.gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
      const surfaces = [...created, ...(lensRenderer ? [lensRenderer.surface] : [])];
      for (const el of surfaces) {
        if (el instanceof win.HTMLCanvasElement) el.width = el.height = 0;
        el.remove();
      }
      skyRenderer = lensRenderer = null;
      hubs = [];
      container.classList.remove('sbbh');
    },
  };
}
