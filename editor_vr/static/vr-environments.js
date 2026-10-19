// The room around the model in VR: the studio the desktop page shows, a still 360° sky, or a living environment, one
// that animates. A living environment is built in the scene (`create`) and runs on a day clock that VR advances each
// frame: it brings its own sky and its own light, and the studio's lights are dimmed while it is shown.
import * as THREE from 'three';

export const DAY_SECONDS=240;   // one full turn of a living environment's clock: the day, then the night
export const ENVIRONMENTS=[{key:'studio',label:'Studio'},
  {key:'forest',label:'Mellow forest',sky:'forest.jpg'},{key:'desert',label:'Sandy desert',sky:'desert.jpg'},{key:'lake',label:'Moonlit lake',sky:'lake.jpg'},
  {key:'desert-day',label:'Desert day & night',aliases:['desert day and night','day and night'],living:true,create:desertDay}];

export function createEnvironments(viewer) {
  const {scene,renderer}=viewer;
  const studio={background:scene.background,fog:scene.fog,grid:scene.children.find(child=>child.type==='GridHelper'),
    lights:scene.children.filter(child=>child.isLight).map(light=>({light,intensity:light.intensity}))};
  // Only a living environment's light casts shadows, so this costs nothing in the studio or under a still sky.
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  const skies={},clock={phase:.03,running:true,last:null};   // a living day starts just after sunrise
  let key='studio',live=null;
  function sky(file) {
    if(!skies[file]){skies[file]=new THREE.TextureLoader().load(`/static/backgrounds/${file}`);skies[file].mapping=THREE.EquirectangularReflectionMapping;skies[file].colorSpace=THREE.SRGBColorSpace;}
    return skies[file];
  }
  function show(next) {
    const env=ENVIRONMENTS.find(e=>e.key===next)||ENVIRONMENTS[0];
    if(live&&live.key!==env.key){live.dispose();live=null;}
    if(env.create&&!live){live={key:env.key,...env.create(viewer)};live.update(clock.phase);}
    key=env.key;
    scene.background=env.sky?sky(env.sky):live?null:studio.background;scene.fog=env.key==='studio'?studio.fog:null;
    if(studio.grid)studio.grid.visible=env.key==='studio';
    for(const {light,intensity} of studio.lights)light.intensity=live?0:intensity;
  }
  return {show,
    get key(){return key;},
    get living(){return Boolean(live);},
    get running(){return clock.running;},
    pause(paused=clock.running){clock.running=!paused;},
    // For the tests: put the clock at a time of day (0 is sunrise, .25 noon, .5 sunset and moonrise, .75 midnight).
    setPhase(phase){clock.phase=((phase%1)+1)%1;live?.update(clock.phase);},
    update(time) {
      const dt=clock.last===null?0:Math.min((time-clock.last)/1000,.25);clock.last=time;
      if(!live)return;
      if(clock.running)clock.phase=(clock.phase+dt/DAY_SECONDS)%1;
      live.update(clock.phase);
    },
    get state(){return {key,living:Boolean(live),running:clock.running,phase:clock.phase,...live?.state()};}};
}

// ---------- the desert by day and night ----------
// The sun crosses the sky from east (+x, on your right) to west behind you, then the moon follows it, so both light the
// side of the model you face. One
// directional light follows whichever is up, warm and low at sunrise and sunset, white at noon, faint blue by moonlight,
// and casts the model's shadow; a hemisphere light gives the sky's own glow, enough to work by at night.
const SKY_VERTEX=`varying vec3 vDirection;
void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position.z=gl_Position.w;}`;
const SKY_FRAGMENT=`varying vec3 vDirection;uniform vec3 sun;uniform float day,dusk,night;
float hash(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
void main(){
  vec3 d=normalize(vDirection);float h=clamp(d.y,0.,1.),low=pow(1.-h,4.);
  vec3 color=mix(mix(vec3(.01,.015,.045),vec3(.05,.07,.13),low),mix(vec3(.16,.4,.78),vec3(.74,.85,.93),low),day);
  vec2 toward=normalize(d.xz+1e-4),from=normalize(sun.xz+1e-4);
  color=mix(color,mix(vec3(.3,.2,.4),vec3(1.,.48,.2),low),dusk*low*(.35+.65*max(dot(toward,from),0.)));
  float s=max(dot(d,sun),0.);
  color+=vec3(1.,.82,.6)*(smoothstep(.99955,.9998,s)*3.+pow(s,24.)*.35)*max(day,dusk)*smoothstep(-.04,.0,d.y);
  vec3 cell=floor(d*240.),spot=fract(d*240.)-.5;
  color+=vec3(.9,.92,1.)*step(.997,hash(cell))*smoothstep(.45,.1,length(spot))*(.4+.6*hash(cell+7.))*night*smoothstep(.0,.2,d.y);
  gl_FragColor=vec4(color,1.);
}`;
const SUN_PATH={tilt:THREE.MathUtils.degToRad(30),behind:1},MOON_PATH={tilt:THREE.MathUtils.degToRad(22),behind:1};

// A direction on a path across the sky: rising in the east at 0, highest at .5, setting in the west at 1.
function across(path,t,target) {
  const a=Math.PI*t;
  return target.set(Math.cos(a),Math.sin(a)*Math.cos(path.tilt),path.behind*Math.sin(a)*Math.sin(path.tilt)).normalize();
}
// Height of the dunes (m) at a point on the floor: flat sand where you stand, rising into dunes beyond.
function dune(x,z) {
  const r=Math.hypot(x,z),rise=THREE.MathUtils.smoothstep(r,3,9);
  return rise*(.55+.5*Math.sin(x*.31+z*.17)+.32*Math.sin(z*.53-x*.27+1.3)+.12*Math.sin((x+z)*1.1))+.04*Math.sin(x*2.3)*Math.sin(z*1.9);
}
function moonTexture() {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const c=canvas.getContext('2d');
  const glow=c.createRadialGradient(64,64,30,64,64,64);glow.addColorStop(0,'rgba(220,230,255,.35)');glow.addColorStop(1,'rgba(220,230,255,0)');
  c.fillStyle=glow;c.fillRect(0,0,128,128);
  c.beginPath();c.arc(64,64,30,0,Math.PI*2);c.fillStyle='#eef0f4';c.fill();
  c.fillStyle='rgba(150,158,172,.55)';
  for(const [x,y,r] of [[54,54,9],[74,60,6],[62,76,7],[76,76,4],[50,70,4]]){c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();}
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

function desertDay(viewer) {
  const group=new THREE.Group();group.name='desert-day';viewer.scene.add(group);
  const sky=new THREE.Mesh(new THREE.SphereGeometry(25,48,24),new THREE.ShaderMaterial({vertexShader:SKY_VERTEX,fragmentShader:SKY_FRAGMENT,
    side:THREE.BackSide,depthWrite:false,fog:false,uniforms:{sun:{value:new THREE.Vector3(1,0,0)},day:{value:1},dusk:{value:0},night:{value:0}}}));
  sky.renderOrder=-10;sky.frustumCulled=false;group.add(sky);
  // The sand: flat underfoot, dunes beyond, a ring of mesas at the edge (they also hide where the sand ends).
  const sand=new THREE.RingGeometry(.01,22,160,56);sand.rotateX(-Math.PI/2);
  const position=sand.attributes.position,normals=sand.attributes.normal,normal=new THREE.Vector3(),shade=new Float32Array(position.count*3);
  for(let i=0;i<position.count;i++){
    const x=position.getX(i),z=position.getZ(i),y=dune(x,z),tint=.94+.06*Math.sin(x*3.1+z*2.3);position.setY(i,y);
    shade[i*3]=tint;shade[i*3+1]=tint*.97;shade[i*3+2]=tint*.92;
    normal.set(dune(x-.05,z)-dune(x+.05,z),.1,dune(x,z-.05)-dune(x,z+.05)).normalize();normals.setXYZ(i,normal.x,normal.y,normal.z);
  }
  sand.setAttribute('color',new THREE.BufferAttribute(shade,3));
  const ground=new THREE.Mesh(sand,new THREE.MeshStandardMaterial({color:0xc99a62,roughness:.97,vertexColors:true}));ground.receiveShadow=true;group.add(ground);
  const ridge=[],faces=[],steps=180;
  for(let i=0;i<=steps;i++){
    const a=i/steps*Math.PI*2,top=1.2+1.4*Math.max(0,Math.sin(a*3+.7))**.6+.7*Math.sin(a*7+2)+.35*Math.sin(a*17),plateau=Math.min(top,2.6);
    ridge.push(Math.cos(a)*21.5,-.5,Math.sin(a)*21.5,Math.cos(a)*21,plateau,Math.sin(a)*21);
    if(i<steps)faces.push(i*2,i*2+1,i*2+2,i*2+1,i*2+3,i*2+2);
  }
  const mesas=new THREE.BufferGeometry();mesas.setAttribute('position',new THREE.Float32BufferAttribute(ridge,3));mesas.setIndex(faces);mesas.computeVertexNormals();
  group.add(new THREE.Mesh(mesas,new THREE.MeshStandardMaterial({color:0xb4714a,roughness:1,side:THREE.DoubleSide})));
  const moon=new THREE.Mesh(new THREE.PlaneGeometry(2.4,2.4),new THREE.MeshBasicMaterial({map:moonTexture(),transparent:true,depthWrite:false,fog:false}));
  moon.renderOrder=-9;group.add(moon);
  // The light that follows the sun or the moon, and the sky's glow.
  const light=new THREE.DirectionalLight(0xffffff,4);light.castShadow=true;light.shadow.mapSize.set(1024,1024);light.shadow.bias=-.0004;light.shadow.normalBias=.02;
  group.add(light,light.target);
  const glow=new THREE.HemisphereLight(0xbfd8ff,0x8a6a48,1.4);group.add(glow);
  const platform=viewer.platform;if(platform)platform.receiveShadow=true;

  const sunDirection=new THREE.Vector3(),moonDirection=new THREE.Vector3(),box=new THREE.Box3(),center=new THREE.Vector3(),sphere=new THREE.Sphere();
  const warm=new THREE.Color(1,.5,.25),noon=new THREE.Color(1,.96,.9),moonlight=new THREE.Color(.62,.72,1);
  let frames=0,shown={};
  function fitShadow() {
    // The shadow covers the model wherever it has been moved or scaled to.
    for(const mesh of viewer.meshes.values())mesh.castShadow=true;
    box.makeEmpty();for(const mesh of viewer.meshes.values())if(mesh.visible)box.expandByObject(mesh);if(box.isEmpty())return;
    box.getBoundingSphere(sphere);center.copy(sphere.center);
    const r=Math.max(sphere.radius*1.4,.3),cam=light.shadow.camera;
    cam.left=cam.bottom=-r;cam.right=cam.top=r;cam.near=.05;cam.far=8+r*2;cam.updateProjectionMatrix();
  }
  return {
    update(phase) {
      const sunUp=phase<.5,t=sunUp?phase*2:phase*2-1;
      across(SUN_PATH,sunUp?t:1+t,sunDirection);   // below the horizon, the sun keeps on round
      across(MOON_PATH,sunUp?t-1:t,moonDirection);
      const sunHeight=sunDirection.y,moonHeight=moonDirection.y;
      const day=THREE.MathUtils.smoothstep(sunHeight,-.08,.25),dusk=THREE.MathUtils.smoothstep(sunHeight,-.2,0)*(1-THREE.MathUtils.smoothstep(sunHeight,0,.3));
      const night=1-THREE.MathUtils.smoothstep(sunHeight,-.22,.05);
      const u=sky.material.uniforms;u.sun.value.copy(sunDirection);u.day.value=day;u.dusk.value=dusk;u.night.value=night;
      moon.position.copy(moonDirection).multiplyScalar(22);moon.lookAt(0,0,0);moon.visible=moonHeight>-.15;
      moon.material.opacity=.35+.65*night;
      if(frames++%30===0)fitShadow();
      const bySun=sunHeight>=moonHeight,direction=bySun?sunDirection:moonDirection;
      if(bySun){light.color.copy(warm).lerp(noon,THREE.MathUtils.smoothstep(sunHeight,.02,.45));light.intensity=3.4*THREE.MathUtils.smoothstep(sunHeight,-.03,.3);}
      else{light.color.copy(moonlight);light.intensity=1.1*THREE.MathUtils.smoothstep(moonHeight,-.03,.25);}
      light.target.position.copy(center);light.position.copy(center).addScaledVector(direction,6);
      glow.intensity=.85+.3*day+.25*dusk;
      glow.color.setRGB(.3+.45*day+.5*dusk,.36+.48*day+.2*dusk,.6+.4*day);glow.groundColor.setRGB(.12+.42*day,.1+.32*day,.09+.2*day);
      shown={source:bySun?'sun':'moon',sun:sunDirection.toArray(),moon:moonDirection.toArray(),light:{intensity:light.intensity,color:light.color.getHexString(),direction:direction.toArray()}};
    },
    state:()=>shown,
    dispose() {
      viewer.scene.remove(group);
      for(const mesh of viewer.meshes.values())mesh.castShadow=false;
      if(platform)platform.receiveShadow=false;
      light.shadow.map?.dispose();
      group.traverse(object=>{object.geometry?.dispose();if(object.material){object.material.map?.dispose();object.material.dispose();}});
    }};
}
