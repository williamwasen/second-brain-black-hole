// Procedural world-space accretion with curved null-ray orbits.
// Internal distances use Schwarzschild radii; 2.598 Rs is the apparent shadow.
// The central-force orbit integrator is a finite-step Schwarzschild-inspired
// approximation. Six independent fields are composited; no binary spacetime.
const DISK_NORMALS = [[-.12,.98,.16],[.20,.95,.24],[-.10,.99,.12],[.24,.96,-.08],[-.20,.96,.18],[.10,.98,-.16]]
  .map(n => n.map(v => v / Math.hypot(...n)));
function createAccretionPass(gl, clusters, surface) {
  const rs = lensRadius / 2.598076211;
  const normals = DISK_NORMALS;
  const hdr = !!gl.getExtension('EXT_color_buffer_float');
  const vao = gl.createVertexArray();
  function program(vertex, fragment) {
    const p = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, '#version 300 es\nprecision highp float;\nprecision highp int;\n' + source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
      gl.attachShader(p,s); gl.deleteShader(s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
    const loc = new Map();
    return {p, u(name) { if (!loc.has(name)) loc.set(name,gl.getUniformLocation(p,name)); return loc.get(name); }};
  }
  const fullVertex = `out vec2 vUV;
    void main(){vec2 p=vec2((gl_VertexID&1)==0?0.:1.,gl_VertexID<2?0.:1.);vUV=p;gl_Position=vec4(p*2.-1.,0.,1.);}`;
  const ray = program(`
    uniform vec2 uViewport; uniform float uFocal; uniform vec4 uHole;
    out vec2 vPixel;
    void main(){
      vec2 c=vec2((gl_VertexID&1)==0?-1.:1.,gl_VertexID<2?-1.:1.);
      float depth=3.4-uHole.z;
      float bounds=14.5*${rs}*uFocal/max(.15,depth-14.5*${rs});
      vPixel=uHole.xy*uFocal/depth+c*bounds;
      gl_Position=vec4(vPixel/uViewport*vec2(2.,-2.),0.,1.);
    }`, `
    in vec2 vPixel; out vec4 color;
    uniform vec2 uViewport;
    uniform vec4 uHole,uRotation;
    uniform vec3 uNormal,uBasis;
    uniform float uFocal,uSkyFocal,uTime,uSeed;
    uniform int uSteps;
    ${SPACE_SKY_GLSL}
    const float RS=${rs};
    const float STORE=${hdr ? '1.' : '0.0625'};
    float hash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
    float noise(vec3 p){
      vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
    }
    float fbm(vec3 p){return .56*noise(p)+.28*noise(p*2.03+7.1)+.16*noise(p*4.07-3.8);}
    vec3 sky(vec3 ray){
      float y=ray.y*uRotation.z+ray.z*uRotation.w;
      float z=ray.z*uRotation.z-ray.y*uRotation.w;
      vec3 w=normalize(vec3(ray.x*uRotation.x+z*uRotation.y,y,z*uRotation.x-ray.x*uRotation.y));
      float vignette=1.-.24*smoothstep(.15,1.42,length(vPixel*2./uViewport));
      return spaceSky(w,uTime)*vignette;
    }
    vec3 plasma(vec3 p, vec3 direction, out float density){
      vec3 tangent=normalize(cross(uNormal,uBasis));
      float x=dot(p,uBasis),y=dot(p,tangent),r=length(vec2(x,y));
      float window=smoothstep(2.85,3.5,r)*(1.-smoothstep(8.5,12.8,r));
      if(window<.0001){density=0.;return vec3(0);}
      float a=atan(y,x);
      // Differential advection: an inner lane circles in ~20s, outer lanes
      // take much longer. Two incommensurate evolving fields avoid a loop.
      float omega=.31*pow(3.4/r,1.5);
      float phase=a-uTime*omega+uSeed;
      float drift=r+uTime*.018;
      vec3 q=vec3(cos(phase),sin(phase),drift*.30);
      float flow=fbm(q*vec3(4.,4.,5.)+vec3(0,0,uTime*.065));
      float detail=fbm(vec3(cos(phase)*13.,sin(phase)*13.,drift*2.7)+flow*2.7+uTime*.038);
      float filament=fbm(vec3(cos(phase)*5.,sin(phase)*5.,drift*3.8)+vec3(flow*2.,flow*2.,flow*4.));
      float lanes=pow(smoothstep(.24,.80,filament),3.);
      float knots=pow(smoothstep(.25,.88,detail),2.);
      float energy=(.10+lanes*2.2+knots*2.8)*(.30+1.1*flow);
      float sector=.28+1.55*noise(vec3(cos(phase)*2.2,sin(phase)*2.2,uSeed+uTime*.13));
      energy*=sector;
      float falloff=pow(3.8/r,3.0);
      density=window*(.22+energy*.55);
      vec3 velocity=normalize(cross(uNormal,p))*sqrt(.5/max(r-1.,1.));
      float doppler=clamp(1./(1.+dot(velocity,direction)),.65,1.65);
      float heat=clamp(.85-(r-3.)*.075+knots*.25,0.,1.);
      vec3 tint=mix(vec3(1.,.27,.055),vec3(1.,.80,.49),heat);
      tint=mix(tint,vec3(1.,.95,.82),smoothstep(.72,1.,heat)*.62);
      return tint*(3.8*falloff*energy*window*pow(doppler,2.3));
    }
    float erfApprox(float x){
      float a=abs(x),t=1./(1.+.3275911*a);
      float poly=(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t;
      return sign(x)*(1.-poly*exp(-a*a));
    }
    vec3 acceleration(vec3 p,float h2){float r2=dot(p,p);return -1.5*h2*p/(r2*r2*sqrt(r2));}
    void main(){
      vec3 incoming=normalize(vec3(vPixel/uFocal,-1.));
      vec3 origin=(vec3(0,0,3.4)-uHole.xyz)/RS;
      float closest=-dot(origin,incoming);
      float b2=max(0.,dot(origin,origin)-closest*closest);
      float b=sqrt(b2);
      if(b>14.3||closest<0.)discard;
      float coverage=(1.-smoothstep(10.,14.3,b))*uHole.w;
      vec3 p=origin+incoming*(closest-sqrt(max(0.,26.*26.-b2)));
      vec3 radial=normalize(p);
      float vr=dot(incoming,radial);
      vec3 velocity=incoming-radial*vr-radial*sqrt(max(.0001,vr*vr+b2/(26.*26.*26.)));
      vec3 emission=vec3(0);float transmission=1.;bool captured=false;
      for(int i=0;i<176;i++){
        if(i>=uSteps)break;
        float r=length(p);
        if(r<1.015){captured=true;break;}
        if(r>26.5&&dot(p,velocity)>0.)break;
        float ds=clamp(r*.105,.055,1.6);
        vec3 a=acceleration(p,b2);
        vec3 next=p+velocity*ds+.5*a*ds*ds;
        vec3 nextV=velocity+.5*(a+acceleration(next,b2))*ds;
        float h0=dot(p,uNormal),h1=dot(next,uNormal);
        float across=clamp(h0/(abs(h0-h1)<.00001?.00001:h0-h1),0.,1.);
        vec3 sampleP=mix(p,next,across);
        float diskR=length(sampleP-uNormal*dot(sampleP,uNormal));
        float thickness=.075+.009*diskR;
        if(min(abs(h0),abs(h1))<thickness*3.||h0*h1<0.){
          float density;
          vec3 light=plasma(sampleP,normalize(velocity),density);
          // Analytically integrate the Gaussian vertical column over this
          // segment; point samples caused bright step bands at grazing angles.
          float dh=abs(h1-h0);
          float column=dh>.0001
            ? abs(erfApprox(h1/thickness)-erfApprox(h0/thickness))*.8862269*length(next-p)/dh
            : exp(-pow((h0+h1)*.5/thickness,2.))*length(next-p)/thickness;
          float optical=column*.22;
          emission+=transmission*light*optical;
          transmission*=exp(-density*optical*.65);
        }
        p=next;velocity=nextV;
      }
      vec3 originalSky=normalize(vec3(vPixel/uSkyFocal,-1.));
      vec3 outgoing=normalize(originalSky+normalize(velocity)-incoming);
      // Bent starlight around the hole is drawn in gray so no purple sky bleeds in; the disk keeps its color.
      vec3 bentSky=pow(sky(outgoing),vec3(2.2));
      vec3 background=captured?vec3(0):vec3(dot(bentSky,vec3(.2126,.7152,.0722)))*transmission;
      // Only emission and escaped sky enter bloom. The capture region is black.
      color=vec4((emission+background)*coverage*STORE,coverage);
    }`);
  const blur = program(fullVertex,`
    in vec2 vUV;out vec4 color;uniform sampler2D uInput;uniform vec2 uDirection;uniform bool uExtract;
    vec3 value(vec2 uv){vec3 c=texture(uInput,uv).rgb;${hdr ? '' : 'c*=16.;'}
      if(uExtract)c=max(c-vec3(1.),vec3(0));return c;}
    void main(){
      vec3 c=value(vUV)*.227027;
      c+=(value(vUV+uDirection*1.384615)+value(vUV-uDirection*1.384615))*.316216;
      c+=(value(vUV+uDirection*3.230769)+value(vUV-uDirection*3.230769))*.070270;
      color=vec4(c*${hdr ? '1.' : '.0625'},1.);
    }`);
  const composite = program(fullVertex,`
    in vec2 vUV;out vec4 color;uniform sampler2D uScene,uBloom,uWide;
    void main(){
      vec4 scene=texture(uScene,vUV);
      float decode=${hdr ? '1.' : '16.'};
      vec3 base=scene.rgb*decode;
      vec3 bloom=(texture(uBloom,vUV).rgb*.38+texture(uWide,vUV).rgb*.38)*decode;
      float glow=max(bloom.r,max(bloom.g,bloom.b));
      float alpha=scene.a+(1.-scene.a)*clamp(glow*2.,0.,1.);
      if(alpha<.0001){color=vec4(0);return;}
      vec3 mapped=pow(1.-exp(-(base+bloom)/max(alpha,.001)),vec3(1./2.2));
      color=vec4(mapped*alpha,alpha);
    }`);
  const targets=[];
  for(let i=0;i<5;i++){
    const texture=gl.createTexture(), framebuffer=gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    targets.push({texture,framebuffer,w:0,h:0});
  }
  const updateSpaceSky = configureSpaceSky(ray.p,gl,0);
  function resize(w,h){
    targets.forEach((t,i)=>{
      const divisor=i>2?12:3;
      const tw=i?Math.max(1,Math.ceil(w/divisor)):w,th=i?Math.max(1,Math.ceil(h/divisor)):h;
      if(t.w===tw&&t.h===th)return;
      t.w=tw;t.h=th;gl.bindTexture(gl.TEXTURE_2D,t.texture);
      gl.texImage2D(gl.TEXTURE_2D,0,hdr?gl.RGBA16F:gl.RGBA,tw,th,0,gl.RGBA,hdr?gl.HALF_FLOAT:gl.UNSIGNED_BYTE,null);
      gl.bindFramebuffer(gl.FRAMEBUFFER,t.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t.texture,0);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Incomplete plasma framebuffer');
    });
  }
  function texture(unit,tex){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,tex);}
  function target(t){gl.bindFramebuffer(gl.FRAMEBUFFER,t?.framebuffer||null);gl.viewport(0,0,t?.w||surface.width,t?.h||surface.height);}
  const stats={hdr,steps:0,visibleHoles:0};
  function render(camera,holes,focal){
    resize(surface.width,surface.height);gl.bindVertexArray(vao);target(targets[0]);
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(ray.p);updateSpaceSky(glowTime);
    gl.uniform2f(ray.u('uViewport'),camera.width,camera.height);
    gl.uniform1f(ray.u('uFocal'),focal);
    gl.uniform1f(ray.u('uSkyFocal'),Math.min(camera.width,camera.height)*.46*3.4*(1+.10*(view.zoom-1)));
    gl.uniform4f(ray.u('uRotation'),camera.cy,camera.sy,camera.cp,camera.sp);
    gl.uniform1f(ray.u('uTime'),glowTime);
    stats.steps=region?176:136;stats.visibleHoles=0;gl.uniform1i(ray.u('uSteps'),stats.steps);
    const rotate=p=>{const z=p[0]*camera.sy+p[2]*camera.cy;return [p[0]*camera.cy-p[2]*camera.sy,p[1]*camera.cp-z*camera.sp,p[1]*camera.sp+z*camera.cp];};
    const order=clusters.map((_,i)=>i).sort((a,b)=>holes[a*4+2]-holes[b*4+2]);
    for(const i of order){
      const h=holes.subarray(i*4,i*4+4);if(h[3]<.002||3.4-h[2]<.12)continue;
      const x=h[0]*focal/(3.4-h[2]),y=h[1]*focal/(3.4-h[2]);
      const bound=14.5*rs*focal/Math.max(.15,3.4-h[2]-14.5*rs);
      if(Math.abs(x)>camera.width/2+bound||Math.abs(y)>camera.height/2+bound)continue;
      stats.visibleHoles++;
      const n=normals[i],basis=[n[1],-n[0],0],len=Math.hypot(...basis);
      gl.uniform4fv(ray.u('uHole'),h);gl.uniform3fv(ray.u('uNormal'),rotate(n));
      gl.uniform3fv(ray.u('uBasis'),rotate(basis.map(v=>v/len)));
      gl.uniform1f(ray.u('uSeed'),i*1.73);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    }
    gl.disable(gl.BLEND);gl.useProgram(blur.p);gl.uniform1i(blur.u('uInput'),0);
    for(const [from,to,dx,dy,extract] of [[0,1,1,0,true],[1,2,0,1,false],[2,3,1,0,false],[3,4,0,1,false]]){
      target(targets[to]);texture(0,targets[from].texture);
      gl.uniform2f(blur.u('uDirection'),dx/targets[to].w,dy/targets[to].h);
      gl.uniform1i(blur.u('uExtract'),extract);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    }
    target(null);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(composite.p);
    for(const [unit,index,name]of [[0,0,'uScene'],[1,2,'uBloom'],[2,4,'uWide']]){
      texture(unit,targets[index].texture);gl.uniform1i(composite.u(name),unit);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
  }
  return {render,normals,stats};
}
