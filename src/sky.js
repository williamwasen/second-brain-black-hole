// One deterministic celestial sphere, shared by unobstructed sky and bent rays.
// Generated locally: no tiled or mirrored photograph.
let spaceSkyTextureCanvas;
function createSpaceSkyTexture() {
  if (spaceSkyTextureCanvas) return spaceSkyTextureCanvas;
  const low = document.createElement('canvas');
  low.width = 1024; low.height = 512;
  const context = low.getContext('2d');
  const pixels = context.createImageData(low.width, low.height);
  const hash = (x, y, z) => {
    let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = x => x * x * (3 - 2 * x);
  const mix = (a, b, t) => a + (b - a) * t;
  function noise(x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = smooth(x - ix), fy = smooth(y - iy), fz = smooth(z - iz);
    return mix(mix(mix(hash(ix, iy, iz), hash(ix + 1, iy, iz), fx),
      mix(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), fx), fy),
      mix(mix(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), fx),
      mix(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), fx), fy), fz);
  }
  function field(x, y, z) {
    return noise(x * 2.2 + 11, y * 2.2, z * 2.2) * .45
      + noise(x * 5.3, y * 5.3 + 23, z * 5.3) * .27
      + noise(x * 13.1, y * 13.1, z * 13.1 + 7) * .17
      + noise(x * 31.7 + 41, y * 31.7, z * 31.7) * .08
      + noise(x * 75.3, y * 75.3 + 19, z * 75.3) * .03;
  }
  for (let row = 0; row < low.height; row++) {
    const lat = ((row + .5) / low.height - .5) * Math.PI;
    const cy = Math.cos(lat), y = Math.sin(lat);
    for (let col = 0; col < low.width; col++) {
      const lon = ((col + .5) / low.width - .5) * 2 * Math.PI;
      const x = Math.sin(lon) * cy, z = -Math.cos(lon) * cy;
      const n = field(x, y, z);
      const warp = (noise(x * 3 + 8, y * 3 - 2, z * 3) - .5) * .20;
      const latitude = x * .706 + y * .706 + z * .055 + warp;
      const band = Math.exp(-latitude * latitude / .035);
      const core = Math.pow(Math.max(0, -.32 * x + .14 * y - .937 * z), 7);
      const dust = .06 + .94 * smooth(Math.min(1, Math.max(0, (n - .36) * 4.6)));
      const cloud = band * (10 + 32 * core) * dust * (.30 + n);
      const blue = Math.pow(Math.max(0, .78 * x - .25 * y + .573 * z), 3);
      const rust = core * noise(x * 4 + 71, y * 4, z * 4);
      const at = (row * low.width + col) * 4;
      pixels.data[at] = 1.0 + cloud * (.86 + rust * .70) + blue * band * 2;
      pixels.data[at + 1] = 1.8 + cloud * (.73 - rust * .15) + blue * band * 5;
      pixels.data[at + 2] = 4.0 + cloud * (1.48 - rust * .38) + blue * band * 12;
      pixels.data[at + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  const canvas = document.createElement('canvas');
  canvas.width = 4096; canvas.height = 2048;
  const paint = canvas.getContext('2d');
  paint.imageSmoothingEnabled = true;
  paint.imageSmoothingQuality = 'high';
  paint.drawImage(low, 0, 0, canvas.width, canvas.height);
  spaceSkyTextureCanvas = canvas;
  return canvas;
}

const SPACE_METEOR_COUNT = 10;
function spaceMeteorRandom(n) {
  let v = Math.imul(n ^ 0x6ac690c5, 0x45d9f3b);
  v = Math.imul(v ^ (v >>> 16), 0x45d9f3b);
  return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
}
function spaceMeteorEvent(lane, time) {
  const period = 3.75 + spaceMeteorRandom(lane * 37 + 1) * 1.35;
  const offset = lane * .41;
  const cycle = Math.floor((time + offset) / period);
  const seed = cycle * 173 + lane * 4099;
  const start = .24 + spaceMeteorRandom(seed + 13) * .48;
  const duration = 1.16 + spaceMeteorRandom(seed + 29) * .48;
  const age = time + offset - cycle * period - start;
  const progress = age / duration;
  const lon = spaceMeteorRandom(seed + 43) * Math.PI * 2 - Math.PI;
  // A broad shower around the celestial equator still exists in world space.
  const latitude = (spaceMeteorRandom(seed + 71) - .5) * 1.10;
  const axis = [Math.sin(lon) * Math.cos(latitude), Math.sin(latitude), -Math.cos(lon) * Math.cos(latitude)];
  const angle = spaceMeteorRandom(seed + 97) * Math.PI * 2;
  const east = [Math.cos(lon), 0, Math.sin(lon)];
  const north = [-Math.sin(lon) * Math.sin(latitude), Math.cos(latitude), Math.cos(lon) * Math.sin(latitude)];
  const tangent = east.map((v, i) => v * Math.cos(angle) + north[i] * Math.sin(angle));
  const arc = .075 + spaceMeteorRandom(seed + 113) * .09;
  const distance = (progress - .5) * arc;
  const tailLength = .015 + spaceMeteorRandom(seed + 139) * .023;
  const along = d => axis.map((v, i) => v * Math.cos(d) + tangent[i] * Math.sin(d));
  const active = progress > 0 && progress < 1;
  const fade = active ? Math.pow(Math.sin(Math.PI * progress), .75) : 0;
  return {head: along(distance), tail: along(distance - tailLength),
    brightness: fade * (.23 + spaceMeteorRandom(seed + 157) * .15),
    width: .00016 + spaceMeteorRandom(seed + 179) * .00015,
    period, offset, start, duration, cycle};
}

const SPACE_SKY_GLSL = `
  uniform sampler2D uSpaceSky;
  uniform vec3 uSpaceObserver;
  uniform vec4 uMeteorHead[${SPACE_METEOR_COUNT}];
  uniform vec4 uMeteorTail[${SPACE_METEOR_COUNT}];
  float skyHash(vec3 p) {p=fract(p*vec3(.1031,.11369,.13787));p+=dot(p,p.yzx+19.19);return fract((p.x+p.y)*p.z);}
  float skyNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(mix(skyHash(i),skyHash(i+vec3(1,0,0)),f.x),mix(skyHash(i+vec3(0,1,0)),skyHash(i+vec3(1,1,0)),f.x),f.y),
      mix(mix(skyHash(i+vec3(0,0,1)),skyHash(i+vec3(1,0,1)),f.x),mix(skyHash(i+vec3(0,1,1)),skyHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
  vec3 spaceSky(vec3 worldRay, float time) {
    vec3 ray = normalize(worldRay);
    // A finite celestial shell responds to camera translation as well as rotation.
    float b = dot(uSpaceObserver, ray);
    float t = -b + sqrt(max(0., b*b + 6400. - dot(uSpaceObserver,uSpaceObserver)));
    vec3 skyRay = normalize(uSpaceObserver + ray*t);
    vec2 uv = vec2(.5 + atan(skyRay.x, -skyRay.z) / 6.28318530718,
                   .5 + asin(clamp(skyRay.y, -1., 1.)) / 3.14159265359);
    // Explicit LOD keeps tiny distant sources stable through bent-ray derivatives.
    vec3 result = textureLod(uSpaceSky, uv, 0.).rgb;
    // Analytical stars retain crisp subpixel edges during camera rotation.
    float latitude=dot(skyRay,vec3(.706,.706,.055));
    float band=exp(-latitude*latitude/.035);
    float grain=skyNoise(skyRay*34.)*.5+skyNoise(skyRay*93.)*.28+skyNoise(skyRay*241.)*.15+skyNoise(skyRay*613.)*.07;
    float veins=smoothstep(.38,.7,grain);
    result += band*veins*vec3(.048,.045,.090);
    result *= .66+.7*smoothstep(.25,.64,grain);
    vec2 starGrid=uv*vec2(1800.,900.), cell=floor(starGrid);
    float seed=skyHash(vec3(cell,17.));
    vec2 offset=vec2(skyHash(vec3(cell,31.)),skyHash(vec3(cell,71.)))*.65+.175;
    vec2 delta=(fract(starGrid)-offset)/max(fwidth(starGrid),vec2(.00001));
    float stellar=1.-smoothstep(.45,1.05,length(delta));
    float population=step(.982-band*.025,seed);
    result += population*stellar*mix(vec3(.42,.59,.9),vec3(.95,.92,.86),skyHash(vec3(cell,101.)))*(.42+.5*seed);
    float pixel = max(length(dFdx(ray)), length(dFdy(ray))) * .62;
    for (int i = 0; i < ${SPACE_METEOR_COUNT}; ++i) {
      vec4 head = uMeteorHead[i], tail = uMeteorTail[i];
      if (head.w <= .0001 || dot(ray, head.xyz) < .995) continue;
      vec3 span = tail.xyz - head.xyz;
      float t = clamp(dot(ray - head.xyz, span) / max(dot(span, span), .000001), 0., 1.);
      vec3 nearPoint = normalize(mix(head.xyz, tail.xyz, t));
      float d = length(ray - nearPoint);
      float width = max(tail.w, pixel);
      float profile = exp(-d * d / (width * width)) * pow(1. - t, 1.45);
      // Subpixel energy compensation prevents oversized or overly bright streaks.
      float intensity = head.w * min(1., tail.w / max(pixel, .00001));
      result += vec3(.88, .94, 1.) * profile * intensity;
    }
    return result;
  }
`;

const spaceSkyTextures = new WeakMap();
function configureSpaceSky(program, gl, unit = 0) {
  let texture = spaceSkyTextures.get(gl);
  if (!texture) {
    texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, createSpaceSkyTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    spaceSkyTextures.set(gl, texture);
  }
  const sampler = gl.getUniformLocation(program, 'uSpaceSky');
  const observer = gl.getUniformLocation(program, 'uSpaceObserver');
  const headLocation = gl.getUniformLocation(program, 'uMeteorHead[0]');
  const tailLocation = gl.getUniformLocation(program, 'uMeteorTail[0]');
  const heads = new Float32Array(SPACE_METEOR_COUNT * 4);
  const tails = new Float32Array(SPACE_METEOR_COUNT * 4);
  return time => {
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(sampler, unit);
    const distance=3.4/Math.max(.5,view.zoom), z=distance*Math.cos(view.pitch);
    gl.uniform3f(observer, view.center[0]+z*Math.sin(view.yaw), view.center[1]+distance*Math.sin(view.pitch), view.center[2]+z*Math.cos(view.yaw));
    for (let i = 0; i < SPACE_METEOR_COUNT; i++) {
      const meteor = spaceMeteorEvent(i, time);
      heads.set([...meteor.head, meteor.brightness], i * 4);
      tails.set([...meteor.tail, meteor.width], i * 4);
    }
    gl.uniform4fv(headLocation, heads); gl.uniform4fv(tailLocation, tails);
  };
}

function spaceSkyMeteorProbe() {
  const event = spaceMeteorEvent(0, 8.5);
  const timeDuring = event.cycle * event.period - event.offset + event.start + event.duration * .52;
  const during = spaceMeteorEvent(0, timeDuring);
  return {timeBefore: event.cycle * event.period - event.offset + event.start - .16,
    timeDuring, yaw: Math.atan2(-during.head[0], -during.head[2]), pitch: -Math.asin(during.head[1])};
}

function createSkyRenderer(canvas, _photo) {
  const gl = canvas.getContext('webgl2', {alpha: false, antialias: false});
  if (!gl) return null;
  const program = gl.createProgram();
  for (const [kind, source] of [
    [gl.VERTEX_SHADER, `#version 300 es
      out vec2 vScreen;
      void main() {
        vec2 corner = vec2((gl_VertexID & 1) == 0 ? -1. : 1., gl_VertexID < 2 ? -1. : 1.);
        vScreen = corner * vec2(1., -1.); gl_Position = vec4(corner, 0., 1.);
      }`],
    [gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      in vec2 vScreen; uniform vec2 uRayScale; uniform vec4 uRotation; uniform float uSkyTime;
      out vec4 color;
      ${SPACE_SKY_GLSL}
      void main() {
        vec3 ray = normalize(vec3(vScreen * uRayScale, -1.));
        float y = ray.y * uRotation.z + ray.z * uRotation.w;
        float z = ray.z * uRotation.z - ray.y * uRotation.w;
        vec3 world = vec3(ray.x * uRotation.x + z * uRotation.y, y, z * uRotation.x - ray.x * uRotation.y);
        float vignette = 1. - .24 * smoothstep(.15, 1.42, length(vScreen));
        color = vec4(spaceSky(world, uSkyTime) * vignette, 1.);
      }`],
  ]) {
    const shader = gl.createShader(kind); gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader); gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
  const scale = gl.getUniformLocation(program, 'uRayScale'), rotation = gl.getUniformLocation(program, 'uRotation');
  const timeLocation = gl.getUniformLocation(program, 'uSkyTime');
  const updateSky = configureSpaceSky(program, gl, 0);
  let previous = '';
  const render = camera => {
    if (gl.isContextLost()) return false;
    const {width, height, cy, sy, cp, sp} = camera;
    const key = [width, height, cy, sy, cp, sp, view.zoom, window.devicePixelRatio, glowTime].join(',');
    if (key === previous) return true;
    previous = key;
    const dpr = Math.min(window.devicePixelRatio || 1, Math.sqrt(6000000 / Math.max(1, width * height)));
    const w = Math.max(1, Math.round(width * dpr)), h = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const focal = Math.min(width, height) * .46 * 3.4 * (1 + .10 * (view.zoom - 1));
    gl.useProgram(program); gl.viewport(0, 0, w, h); updateSky(glowTime);
    gl.uniform2f(scale, width / (2 * focal), height / (2 * focal));
    gl.uniform4f(rotation, cy, sy, cp, sp); gl.uniform1f(timeLocation, glowTime);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  };
  render.meteorProbe = spaceSkyMeteorProbe();
  render.gl = gl;
  return render;
}
