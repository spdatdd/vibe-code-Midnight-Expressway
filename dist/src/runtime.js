import { LOOP, PASS_LENGTH, TAU, chaseDefaults, graphicsPresets, newCharacter, vietnamScenes } from './constants.js';

export const get = document.getElementById.bind(document);
export const canvas = get('view');
export const themeControl = get('theme'), coverTheme = get('cover-theme');
export const usesAnimatedTheme = () => themeControl.value === 'animated';
export const ctx = canvas.getContext('2d');
export const backdrop = document.createElement('canvas');
export const backdropCtx = backdrop.getContext('2d', { alpha: false });

export const runtime = {
  sceneryChoices: null,
  graphics: null,
  route: null,
  cityStart: 0,
  tunnelStart: 0,
  chamStart: 0,
  villageStart: 0,
  passStart: 0,
  coastStart: 0,
  coastLandBefore: 1,
  coastLandAfter: 1,
  displayedCamera: null,
  cameraTransfer: null,
  cameraStep: 0,
  viewDrag: null,
  yawCos: 1,
  yawSin: 0,
  pitchCos: 1,
  pitchSin: 0,
  compactCockpit: false,
  vehicleTakeover: null,
  previousCamera: 0,
  soloDrive: false,
  w: 0,
  h: 0,
  horizon: 0,
  focal: 0,
  cx: 0,
  eye: 0,
  origin: 0,
  originX: 0,
  tangent: 0,
  sky: null,
  daySky: null,
  duskClouds: null,
  audio: null,
  effectsLevel: 1,
  spawnTimer: 6,
  spawnIndex: 0,
  world3D: null,
  maxTraffic: 14,
  pedestrianDensity: 1,
  objectDistance: 750,
  treeDensity: 1.6,
  lastFrame: performance.now(),
  nextFrame: 0,
};

export const conditions={time:[get('time'),get('drive-time')],weather:[get('weather'),get('drive-weather')]};

export const chase={...chaseDefaults};

export const cameraPanel=get('camera-panel'),cameraSettings=get('camera-settings');

export const viewLook={yaw:0,pitch:0};

export const keys = new Set(), fingers = new Map();

 // Cộng một xe người chơi, kể cả khi đang đi bộ.
export const traffic = [];

export const ejectedDrivers=[];

export const state = {model:0,color:"#464d79",z:477,x:0,v:0,steer:0,lateral:0,camera:0,target:0,hit:0,started:false};

export const foot={look:newCharacter(),walkYaw:null,directionHold:0,running:false,firstPerson:false,grounded:true,active:false,z:0,x:0,y:0,vy:0,angle:0,cameraYaw:0,stride:0,moving:false};

export const vehicleInteract=get('vehicle-interact'),jumpButton=get('jump');

export const stick=get('walk-stick'),stickCap=stick.firstElementChild;

export const walkStick={pointer:null,x:0,z:0};

export const world={time:0,first:1,daylight:0,twilight:0,fog:0,sun:[0,0,1],sunStrength:0,stars:1,weather:[0,1,0]};

export const precipitation={speed:0,side:0,rainTravel:0,rainDrift:0};

export const auto={enabled:false,lane:1,cooldown:0,brake:false};

export const wind={strength:.26,x:1,z:0};

export const passHeights=new Float32Array(PASS_LENGTH+1),passBends=new Float32Array(PASS_LENGTH+1);
for(let i=0;i<=PASS_LENGTH;i++){
  const t=i/PASS_LENGTH, envelope=Math.sin(Math.PI*t)**2;
  passHeights[i]=envelope*(48+11*Math.sin(t*TAU*2));
  passBends[i]=envelope*35*Math.tanh(2.4*Math.sin(t*TAU*3));
}

export const cityExits=[];

export const localRoads=[];

export const crashDebris=[];

export const trafficActors=[state];

export const sandFootprints=[];

// Đọc phím, giữ từng phím riêng để các phím cùng chức năng thả độc lập.
export const pressed=new Set();

export const settingsPanel=get('settings-panel'),settingsToggle=get('settings-toggle');

export const effectsSlider=get('effects-volume');
runtime.sceneryChoices = vietnamScenes.map(choices => choices[0]);
runtime.graphics = graphicsPresets.highest;
runtime.nextFrame = runtime.lastFrame + 1000 / 60;

// Đọc một hành động từ cả bàn phím và đa chạm.
export function active(action) {
  if(keys.has(action)) return true;
  for(const entry of fingers.values()) if(entry.dataset.control===action) return true;
  return false;
}

export function labelControl(button,label){
  button.setAttribute('aria-label',label);
  button.title=label;
}

export function resetWalkStick(){
  walkStick.pointer=null;
  walkStick.x=walkStick.z=0;
  stickCap.style.transform='';
}

// Xóa trạng thái nhập liệu khi người chơi rời cửa sổ.
export function clearInput() {
  runtime.viewDrag=null;
  resetWalkStick();
  pressed.clear();keys.clear();
  for(const button of fingers.values()) button.classList.remove('active');
  fingers.clear();
}

export function showSettingsPanel(open){
  settingsPanel.hidden=!open;
  settingsToggle.setAttribute('aria-expanded',String(open||!cameraPanel.hidden));
}

export function showCameraPanel(open) {
  cameraPanel.hidden=!open;
  cameraSettings.setAttribute('aria-expanded',String(open));
  if(open){state.target=1;showSettingsPanel(false);}
  else settingsToggle.setAttribute('aria-expanded',String(!settingsPanel.hidden));
}
