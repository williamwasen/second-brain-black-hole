// World-space thin-lens approximation. The map camera is 3.4 units from
// its target. Capture is evaluated independently by intersecting camera rays
// with each spherical shadow.
const lensRadius = 0.074 * 1.25;

function createLensRenderer(clusters) {
  const surface = document.createElement('canvas');
  const gl = surface.getContext('webgl2', {alpha: true, antialias: false, depth: false});
  if (!gl) return null;

  const accretion = createAccretionPass(gl, clusters, surface);
  const count = clusters.length;
  const cameraGLSL = `
    const int LENS_COUNT = ${count};
    const float CAMERA_Z = 3.4;
    const float RADIUS = ${lensRadius};
    uniform vec2 uViewport;
    uniform float uFocal;
    uniform vec4 uLenses[LENS_COUNT];
    vec2 screen(vec3 p) { return p.xy * uFocal / (CAMERA_Z - p.z); }
    vec2 clip(vec2 p) { return p / uViewport * vec2(2., -2.); }
    vec3 cameraRay(vec2 p) { return normalize(vec3(p / uFocal, -1.)); }
    vec2 sphereRay(vec3 ray, vec3 center) {
      vec3 offset = center - vec3(0., 0., CAMERA_Z);
      float closest = dot(ray, offset);
      return vec2(length(offset - closest * ray), closest);
    }
  `;
  const vertexCamera = cameraGLSL + `
    vec2 corner() {
      return vec2((gl_VertexID & 1) == 0 ? -1. : 1., gl_VertexID < 2 ? -1. : 1.);
    }
  `;

  const stars = compileProgram(`
    ${vertexCamera}
    layout(location=0) in vec3 aWorld;
    layout(location=1) in vec4 aStyle;
    uniform vec3 uTarget, uCenters[LENS_COUNT];
    uniform vec4 uRotation;
    uniform float uOpacity[LENS_COUNT], uTime, uZoom;
    uniform bool uSecondary;
    out vec2 vPixel;
    flat out vec2 vCenter, vLens, vRadial, vWidth;
    flat out float vDistance, vIntensity, vArc;
    vec3 rotateCamera(vec3 p) {
      float x = p.x * uRotation.x - p.z * uRotation.y;
      float z = p.x * uRotation.y + p.z * uRotation.x;
      return vec3(x, p.y * uRotation.z - z * uRotation.w, p.y * uRotation.w + z * uRotation.z);
    }
    void main() {
      int cluster = int(aStyle.w);
      float opacity = uOpacity[cluster];
      gl_Position = vec4(2., 2., 0., 1.);
      if (opacity < 0.002) return;
      vec3 world = aWorld;
      float life = 1.;
      if (aStyle.z < 0.) {
        float seed = -aStyle.z - 1.;
        float progress = fract(seed + uTime / mix(52., 96., seed));
        vec3 orbit = world;
        float turn = progress * (1.1 + 3.6 * progress);
        float c = cos(turn), s = sin(turn);
        orbit = vec3(c * orbit.x - s * orbit.z, orbit.y, s * orbit.x + c * orbit.z)
          * (1. - 0.93 * pow(progress, 1.6));
        world = orbit;
        life = smoothstep(0., 0.15, progress) * smoothstep(RADIUS, RADIUS * 1.5, length(orbit));
      }
      vec3 source = rotateCamera(world - uTarget);
      float distance = CAMERA_Z - source.z;
      if (distance < 0.10) return;
      vec2 pixel = screen(source);
      float perspective = CAMERA_Z / distance;
      float size = max(0.53, aStyle.x * 1.12 * sqrt(uZoom) * perspective);
      float wave = pow(max(0., cos(aStyle.z * 3.1 - uTime * 0.86 + float(cluster) * 0.83)), 12.);
      float intensity = opacity * life * (aStyle.y * 1.12 + wave * 0.26);
      float best = 0.;
      float einstein = 0.;
      vec2 lens = pixel;
      float beta = 0.;
      for (int i = 0; i < LENS_COUNT; ++i) {
        vec4 hole = uLenses[i];
        float lensDistance = CAMERA_Z - hole.z;
        float gap = distance - lensDistance;
        if (gap <= 0.002 || hole.w <= 0.002 || lensDistance < 0.10) continue;
        vec2 center = screen(hole.xyz);
        float separation = length(pixel - center);
        // Einstein angle scales with the source–lens separation and both
        // distances to the viewer. The mass scale is tuned for this map.
        float theta = uFocal * sqrt(0.19 * gap / (distance * lensDistance));
        float influence = hole.w * (1. - smoothstep(2.2, 4.5, separation / max(theta, 1.)));
        if (influence > best) {
          best = influence;
          einstein = theta;
          lens = center;
          beta = separation;
        }
      }
      if (uSecondary && best < 0.012) return;

      vDistance = distance;
      vLens = lens;
      vRadial = vec2(1., 0.);
      vArc = 0.;
      vWidth = vec2(size);
      vCenter = pixel;
      if (best > 0.) {
        vRadial = beta > 0.001 ? (pixel - lens) / beta : vec2(1., 0.);
        float split = sqrt(beta * beta + 4. * einstein * einstein);
        float imageRadius = 0.5 * (beta + (uSecondary ? -split : split));
        float radialScale = 0.5 * (1. + (uSecondary ? -1. : 1.) * beta / split);
        float tangentScale = abs(imageRadius) / max(beta, size * 0.72);
        float imageWeight = min(1.25, abs(radialScale * tangentScale));
        if (uSecondary && imageWeight * best < 0.025) return;
        vCenter = lens + vRadial * (uSecondary ? imageRadius : mix(beta, imageRadius, best));
        if (uSecondary) vRadial = -vRadial;
        vWidth.x = size * mix(1., max(0.42, radialScale), best);
        vWidth.y = clamp(size * mix(1., tangentScale, best), 0.45, 20. * sqrt(uZoom));
        vArc = smoothstep(1.15, 2.0, vWidth.y / vWidth.x) * best;
        intensity *= uSecondary ? best * imageWeight * 0.84 : mix(1., max(0.72, imageWeight), best);
      }
      vIntensity = intensity;
      float bounds = max(vWidth.x, vWidth.y) * 2.85;
      vPixel = vCenter + corner() * bounds;
      gl_Position = vec4(clip(vPixel), 0., 1.);
    }
  `, `
    ${cameraGLSL}
    in vec2 vPixel;
    flat in vec2 vCenter, vLens, vRadial, vWidth;
    flat in float vDistance, vIntensity, vArc;
    out vec4 color;
    void main() {
      vec2 delta = vPixel - vCenter;
      vec2 tangent = vec2(-vRadial.y, vRadial.x);
      vec2 axes = vec2(dot(delta, vRadial), dot(delta, tangent));
      if (vArc > 0.01) {
        vec2 offset = vPixel - vLens;
        float radius = length(vCenter - vLens);
        float angle = atan(dot(offset, tangent), dot(offset, vRadial));
        axes = mix(axes, vec2(length(offset) - radius, angle * radius), vArc);
      }
      vec2 profile = axes / vWidth;
      float falloff = dot(profile, profile);
      if (falloff > 8.) discard;
      vec3 ray = cameraRay(vPixel);
      float throughput = 1.;
      for (int i = 0; i < LENS_COUNT; ++i) {
        vec4 hole = uLenses[i];
        if (hole.w < 0.002) continue;
        vec2 hit = sphereRay(ray, hole.xyz);
        if (hit.y <= 0. || hit.x > RADIUS * 1.04) continue;
        float entrance = hit.y - sqrt(max(0., RADIUS * RADIUS - hit.x * hit.x));
        float aa = max(0.00015, hit.y / uFocal * 0.62);
        float shadow = 1. - smoothstep(RADIUS - aa, RADIUS + aa, hit.x);
        bool captured = entrance < vDistance / -ray.z;
        // Suppress decorative foreground specks over the shadow for legibility.
        // The wiki overlay is separate and its markers remain selectable.
        throughput *= 1. - hole.w * shadow * (captured ? 1. : 0.97);
      }
      float alpha = min(1., vIntensity * throughput * (0.92 * exp(-falloff * 2.65) + 0.08 * exp(-falloff * 0.78)));
      color = vec4(vec3(alpha), alpha);
    }
  `);

  const shadows = compileProgram(`
    ${vertexCamera}
    out vec2 vPixel;
    flat out vec4 vHole;
    void main() {
      vHole = uLenses[gl_InstanceID];
      gl_Position = vec4(2., 2., 0., 1.);
      if (vHole.w <= 0.002 || CAMERA_Z - vHole.z < 0.10) return;
      vec2 center = screen(vHole.xyz);
      float halfSize = 2.25 * RADIUS * uFocal / (CAMERA_Z - vHole.z);
      vPixel = center + corner() * halfSize;
      gl_Position = vec4(clip(vPixel), 0., 1.);
    }
  `, `
    ${cameraGLSL}
    in vec2 vPixel;
    flat in vec4 vHole;
    out vec4 color;
    void main() {
      vec2 hit = sphereRay(cameraRay(vPixel), vHole.xyz);
      float r = hit.x / RADIUS;
      float aa = max(0.003, fwidth(r) * 0.65);
      float shadow = 1. - smoothstep(1. - aa, 1. + aa, r);
      float ringDistance = (r - 1.035) / max(0.018, aa);
      float ring = exp(-ringDistance * ringDistance) * (1. - shadow);
      float haloDistance = (r - 1.12) / 0.13;
      float halo = exp(-haloDistance * haloDistance) * (1. - shadow);
      float alpha = vHole.w * (shadow + ring * 0.28 + halo * 0.045);
      float white = vHole.w * (ring * 0.12 + halo * 0.018);
      color = vec4(vec3(white), alpha);
    }
  `);

  function compileProgram(vertex, fragment) {
    const program = gl.createProgram();
    for (const [kind, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = gl.createShader(kind);
      gl.shaderSource(shader, '#version 300 es\nprecision highp float;\nprecision highp int;\n' + source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
    return {
      id: program,
      loc: Object.fromEntries(['Viewport', 'Focal', 'Lenses[0]', 'Target', 'Centers[0]', 'Rotation', 'Opacity[0]', 'Time', 'Zoom', 'Secondary']
        .map(name => [name.split('[')[0], gl.getUniformLocation(program, 'u' + name)])),
    };
  }

  const data = [];
  const batches = clusters.map((cluster, index) => {
    const first = data.length / 7;
    for (const particle of cluster.particles) {
      data.push(...particle.position, particle.size, particle.intensity, particle.distance, index);
    }
    // A stable, dimmer three-dimensional dust population gives highly
    // magnified arcs some texture without changing the cluster's layout.
    const rng = randomSource(1703 + index);
    for (let i = 0; i < 175; i++) {
      const offset = cluster.spread.map(spread => (rng() + rng() - 1) * spread * 2.4);
      const infalling = i < 175 && Math.hypot(...offset) > 0.23;
      if (!infalling) continue; // Decorative stars belong only to the central black hole.
      const size = rng();
      const intensity = rng();
      const phase = rng();
      data.push(...cluster.center.map((value, axis) => (infalling ? 0 : value) + offset[axis]),
        infalling ? 0.55 + size * 0.62 : 0.39 + size * 0.34,
        infalling ? 0.31 + intensity * 0.35 : 0.07 + intensity * 0.12,
        infalling ? -1 - phase : 3 + phase * 2, index);
    }
    return {first, count: data.length / 7 - first};
  });
  const buffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  const emptyVao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  for (const [attribute, size] of [[0, 3], [1, 4]]) {
    gl.enableVertexAttribArray(attribute);
    gl.vertexAttribDivisor(attribute, 1);
  }
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  const centers = new Float32Array(clusters.flatMap(cluster => cluster.center));
  const holes = new Float32Array(count * 4);
  const opacity = new Float32Array(count);

  const render = (camera, visibility, selectedRegion) => {
    if (gl.isContextLost()) return null;
    const {width, height, cy, sy, cp, sp} = camera;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(1450000 / Math.max(1, width * height)));
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (surface.width !== w || surface.height !== h) {
      surface.width = w;
      surface.height = h;
    }
    clusters.forEach((cluster, index) => {
      const [x, y, z] = cluster.center.map((value, axis) => value - view.center[axis]);
      const rz = x * sy + z * cy;
      const visible = visibility.get(cluster.name);
      holes.set([x * cy - z * sy, y * cp - rz * sp, y * sp + rz * cp, visible], index * 4);
      opacity[index] = visible * (selectedRegion && selectedRegion !== cluster.name ? 0.44 : 1);
    });
    // The six particle groups share one central gravitational source.
    holes.fill(0);
    const [hx,hy,hz] = view.center.map(v => -v);
    const rz = hx*sy + hz*cy;
    holes.set([hx*cy-hz*sy,hy*cp-rz*sp,hy*sp+rz*cp,1],0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const focal = Math.min(width, height) * 0.46 * view.zoom * 3.4;
    const configure = ({id, loc}) => {
      gl.useProgram(id);
      gl.uniform2f(loc.Viewport, width, height);
      gl.uniform1f(loc.Focal, focal);
      gl.uniform4fv(loc.Lenses, holes);
    };
    accretion.render(camera, holes, focal);
    configure(stars);
    gl.bindVertexArray(vao);
    const {loc} = stars;
    gl.uniform3fv(loc.Target, view.center);
    gl.uniform3fv(loc.Centers, centers);
    gl.uniform4f(loc.Rotation, cy, sy, cp, sp);
    gl.uniform1fv(loc.Opacity, opacity);
    gl.uniform1f(loc.Time, glowTime);
    gl.uniform1f(loc.Zoom, view.zoom);
    for (const secondary of [0, 1]) {
      gl.uniform1i(loc.Secondary, secondary);
      for (const [index, batch] of batches.entries()) {
        if (opacity[index] < 0.002) continue;
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, batch.first * 28);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, batch.first * 28 + 12);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, batch.count);
      }
    }
    return surface;
  };
  Object.assign(render, {surface, gl, diskNormals: accretion.normals, stats: accretion.stats});
  return render;
}
