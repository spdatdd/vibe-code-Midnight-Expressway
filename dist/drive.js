import { toggleSound, updateAudio } from './src/audio.js';
import { LANE_WIDTH, PASS_LENGTH, SOLO_TOP_SPEED, TAU, bindings, cameraFields, carColors, carProfile, chaseDefaults, clamp, graphicsPresets, lerp, mod, newCharacter } from './src/constants.js';
import { footHitsCar, jump, pedestrianGap, reactDriver, recoverFootClearance, stepFormerDriver, stepVehicleTakeover, strikePedestrian, vehicleAction, walk } from './src/pedestrian.js';
import { advanceWorld, draw, resize } from './src/render2d.js';
import { center, clampRoadX, footGround, inOpeningVillage, limitRailRotation, localOffset, localRoadAt, railIntersectsCar, randomizeExits, randomizeRoute, relativeDistance, slope, stopGap } from './src/route.js';
import { active, auto, backdrop, cameraPanel, cameraSettings, canvas, chase, clearInput, conditions, coverTheme, effectsSlider, ejectedDrivers, fingers, foot, get, jumpButton, keys, labelControl, passBends, passHeights, pressed, resetWalkStick, runtime, sandFootprints, settingsPanel, settingsToggle, showCameraPanel, showSettingsPanel, state, stick, stickCap, themeControl, traffic, trafficActors, vehicleInteract, viewLook, walkStick, world } from './src/runtime.js';
import { advanceCar, carImpact, carPassengers, carYaw, clearExpiredWrecks, motorcyclePassenger, mountainTruckLane, planAutopilot, planTraffic, recoverRider, seedTraffic, setAutopilot, settleCar, spawnBehind, standingPosition, stepCrashDebris, stepReturningRider, stepWreck, updateVehicleDamage, vehicleGap, vehicleProfile, wreckExpired } from './src/traffic.js';
import { createWorld3D } from './world3d.js';

// Entry point: khởi tạo thế giới 3D, điều phối mô phỏng và gắn sự kiện UI.

// Cập nhật ga, quán tính, va chạm nhẹ và luồng xe theo thời gian thực.
function simulate(dt,clockDelta=dt) {
  runtime.cameraStep+=dt;
  if(runtime.cameraTransfer){
    runtime.cameraTransfer.elapsed+=dt;
    if(runtime.cameraTransfer.elapsed>=runtime.cameraTransfer.duration) runtime.cameraTransfer=null;
  }
  state.camera=lerp(state.camera,state.target,1-Math.exp(-dt*5.5));
  if(Math.abs(state.camera-state.target)<.001) state.camera=state.target;
  if(!state.started) return;
  advanceWorld(clockDelta);
  clearExpiredWrecks();
  while(sandFootprints.length&&world.time-sandFootprints[0].time>=36) sandFootprints.shift();
  stepCrashDebris(dt);
  for(let i=ejectedDrivers.length-1;i>=0;i--){
    const rider=ejectedDrivers[i];
    if(rider.shoveUntil){
      const remaining=clamp((rider.shoveUntil-world.time)/.33,0,1);
      rider.actionLean=-.28*remaining;
      rider.actionReach=.30*remaining;
      if(!remaining) rider.shoveUntil=0;
    }
    const life=rider.reaction==='chase'?21:rider.reaction==='flee'?11:12;
    if(world.time-rider.leftAt>life&&runtime.vehicleTakeover?.rider!==rider){
      ejectedDrivers.splice(i,1);
      if(state.claimant===rider) state.claimant=null;
    }
    else if(rider.recover!==1){
      recoverRider(rider,dt);
      if(rider.recover===1){standingPosition(rider);rider.actionLean=rider.actionCrouch=0;}
    }else stepFormerDriver(rider,dt);
  }
  let gas=false;
  const previousFoot=foot.active?{z:foot.z,x:foot.x}:null;
  updateVehicleDamage(state);
  if(foot.active){
    if(runtime.vehicleTakeover) stepVehicleTakeover(dt);
    else walk(dt,clockDelta);
    if(wreckExpired(state)) state.v=0;
    else if(state.wreck) stepWreck(state,dt);
    else{
      const magnitude=Math.abs(state.v);
      state.v=Math.sign(state.v)*Math.max(0,magnitude-(.8+magnitude*.23)*dt);
      advanceCar(state,dt,(state.slide??0)*dt);
    }
  }
  else if(state.wreck){
    if(auto.enabled) setAutopilot(false);
    state.target=1;
    stepWreck(state,dt);
  }else{
    const throttle=active('gas'), brake=active('brake');
    const assistance=auto.enabled?planAutopilot(dt):null;
    gas=assistance?assistance.acceleration>.7:throttle;
    const direction=assistance?.direction??(Number(active('right'))-Number(active('left')));
    state.steer=lerp(state.steer,direction,1-Math.exp(-dt*(Math.abs(direction)>.01?6.8:8.8)));
    if(assistance){
      state.v=clamp(state.v+assistance.acceleration*dt,assistance.reversing?-2.6:0,Math.min(runtime.soloDrive?SOLO_TOP_SPEED:50,assistance.limit));
    }else if(brake){
      state.v=state.v>0?Math.max(0,state.v-18*dt):Math.max(-9,state.v-4.6*dt);
    }else if(gas){
      const limit=state.local?20:50;
      if(state.v<0) state.v=Math.min(0,state.v+14*dt);
      else if(state.v>limit) state.v=Math.max(limit,state.v-4.6*dt);
      else state.v=Math.min(limit,state.v+8.5*(1-state.v/52)*dt);
    }else{
      state.v=Math.sign(state.v)*Math.max(0,Math.abs(state.v)-(.75+Math.abs(state.v)*.024)*dt);
    }
    const roadYaw=Math.atan(slope(state.z));
    if(!assistance&&Math.abs(state.steer)>.78&&Math.abs(state.v)>.35&&Math.abs(state.v)<7){
      if(!state.freeSteering) state.heading=carYaw(state)-(state.yawOffset??0);
      state.freeSteering=true;
    }
    if(state.freeSteering){
      const speed=Math.abs(state.v);
      const turnRate=Math.min(speed/2.7,1.42,7/Math.max(1,speed));
      const offset=state.yawOffset??0;
      const wanted=state.heading+state.steer*Math.sign(state.v)*turnRate*dt;
      state.heading=mod(limitRailRotation(state,state.heading+offset,wanted+offset)-offset+Math.PI,TAU)-Math.PI;
      if(Math.abs(state.steer)<.16&&Math.abs(mod(state.heading-roadYaw+Math.PI,TAU)-Math.PI)<.19)
        state.freeSteering=false;
    }
    state.lateral=lerp(state.lateral,(state.freeSteering?0:state.steer*Math.sign(state.v)*Math.min(6,Math.abs(state.v)*(auto.escapeLane!==undefined?1.1:.25))),1-Math.exp(-dt*5.5));
    const lateralStep=assistance?.shift??(state.lateral+(state.slide??0))*dt;
    const desiredX=advanceCar(state,dt,lateralStep);
    if(Math.abs(state.x-desiredX)>.025&&Math.abs(state.lateral+(state.slide??0))>1){
      state.slide=-Math.sign(desiredX-state.x)*Math.min(3,Math.abs(state.lateral+(state.slide??0))*.38);
      state.v*=Math.exp(-dt*.95);
      state.spin=(state.spin??0)-Math.sign(desiredX-state.x)*dt*2;
    }
  }
  if(!state.wreck) settleCar(state,dt);
  state.hit=Math.max(0,state.hit-dt);
  spawnBehind(dt);
  let nearestCar=null,closest=85,panning=0;
  const listener=foot.active?foot:state;
  const listenYaw=(foot.active?foot.cameraYaw:carYaw(state))+viewLook.yaw;
  const listenerX=center(listener.z)+listener.x;
  trafficActors.length=0;
  if(!wreckExpired(state)) trafficActors.push(state);
  for(const car of traffic) trafficActors.push(car);
  for(const car of traffic) planTraffic(car,dt);
  for(const car of traffic){
    updateVehicleDamage(car);
    if(runtime.vehicleTakeover?.car===car) continue;
    if(car.wreck){if(!stepReturningRider(car,dt)) stepWreck(car,dt);continue;}
    const fromZ=car.z,fromX=car.x;
    const profile=vehicleProfile(car.model);
    const target=car.targetSpeed, delta=target-car.v;
    const targetX=car.local?localOffset(car.local,car.z):mountainTruckLane(car,car.lane);
    const sideways=car.parked?0:targetX-car.x;
    const shiftSpeed=profile.shiftSpeed*clamp(Math.max(Math.abs(car.v),target)/16,.65,1);
    const desiredShift=Math.sign(sideways)*Math.min(shiftSpeed,Math.sqrt(2*2.8*Math.abs(sideways)),Math.abs(sideways)*2.7);
    const currentShift=car.lateral??0;
    car.lateral=car.parked?0:currentShift+clamp(desiredShift-currentShift,-3.8*dt,3.8*dt);
    if(sideways*car.lateral>0&&Math.abs(car.lateral*dt)>Math.abs(sideways))
      car.lateral=sideways/dt;
    settleCar(car,dt);
    const nextX=clampRoadX(car.z,car.x+(car.lateral+car.slide)*dt);
    const allowed=!foot.active||runtime.vehicleTakeover||!footHitsCar(foot.z,foot.x,car,nextX);
    if(!allowed) car.lateral=0;
    car.brake=delta<-.8;
    car.v+=clamp(delta,-15*dt,3.2*dt);
    // Giới hạn bước tiến nếu người chơi vừa cắt ngang đầu xe hoặc dừng đột ngột.
    const toPlayer=relativeDistance(car.z,state.z);
    if(!wreckExpired(state)&&toPlayer>0&&toPlayer<14+profile.halfLength-carProfile.halfLength
      &&Math.abs(car.x-state.x)<vehicleProfile(state.model).halfWidth+profile.halfWidth){
      const gap=vehicleGap(toPlayer,car.model,state.model);
      const safeSpeed=Math.max(0,(gap-5.2)/Math.max(dt,.001));
      if(safeSpeed<car.v){car.v=safeSpeed;car.brake=true;}
      if(gap<8&&car.v<1.3&&Math.abs(state.v)<1.3&&world.time>1) reactDriver(car);
    }
    const footGap=pedestrianGap(car);
    if(footGap<7&&car.v<1.3&&world.time>1) reactDriver(car);
    if(footGap<Infinity&&(car.v<4.5||car.v*car.v/30<Math.max(0,footGap-1.35))){
      const safeSpeed=Math.max(0,(footGap-1.35)/Math.max(dt,.001));
      if(safeSpeed<car.v){car.v=safeSpeed;car.brake=true;}
    }
    if(car.local){
      const gap=stopGap(car,car.local);
      if(gap<Infinity){
        const safe=Math.max(0,gap/Math.max(dt,.001));
        if(safe<car.v){car.v=safe;car.brake=true;}
      }
    }
    advanceCar(car,dt,allowed?(car.lateral+car.slide)*dt:0);
    strikePedestrian(car,fromZ,fromX,previousFoot);
    const dz=relativeDistance(state.z,car.z), dx=car.x-state.x;
    if(Math.abs(dz)<7.3){
      const impact=carImpact(state,car);
      if(impact>2) state.hit=Math.max(state.hit,Math.min(.48,impact*.027));
    }
    if(wreckExpired(car)) continue;
    const along=relativeDistance(listener.z,car.z),across=center(car.z)+car.x-listenerX;
    const distance=Math.hypot(along,across);
    if(distance<closest){
      closest=distance;nearestCar=car;
      panning=clamp((across*Math.cos(listenYaw)-along*Math.sin(listenYaw))/Math.max(5,distance),-1,1);
    }
  }
  recoverFootClearance();
  const focus=foot.active?foot.z:state.z;
  const nearby=traffic.filter(car=>Math.abs(relativeDistance(focus,car.z))<115);
  for(let i=0;i<nearby.length;i++){
    for(let j=i+1;j<nearby.length;j++){
      const a=nearby[i],b=nearby[j];
      if(Math.abs(relativeDistance(a.z,b.z))<7.3) carImpact(a,b);
    }
  }
  const label=foot.active?'':`${state.v<0?'R ':''}${Math.round(Math.abs(state.v)*3.6)} km/h`;
  if(get('speed').value!==label) get('speed').value=label;
  updateAudio(gas,nearestCar,closest,panning);
}

// Đổi góc nhìn mà không ảnh hưởng các nút điều khiển đang giữ.
function toggleCamera() {
  if(runtime.vehicleTakeover) return;
  if(foot.active){
    foot.firstPerson=!foot.firstPerson;
    labelControl(get('camera'),foot.firstPerson?'Góc nhìn thứ nhất':'Góc nhìn thứ ba');
    return;
  }
  state.target=1-state.target;
  labelControl(get('camera'),state.target?'Góc nhìn thứ ba':'Góc nhìn thứ nhất');
  viewLook.yaw=viewLook.pitch=0;
  if(!state.target) showCameraPanel(false);
}

// Đồng bộ trạng thái tự lái với nút điều khiển và làn gần xe nhất.
function setSoloDrive(enabled){
  if(runtime.soloDrive===enabled) return;
  runtime.soloDrive=enabled;
  if(enabled){
    traffic.length=0;
    const recovering=Boolean(foot.fall||state.wreck);
    Object.assign(state,{wreck:null,damage:null,crash:null,slide:0,roll:0,spin:0,yawOffset:0,hit:0,occupants:[]});
    if(recovering) state.v=0;
    if(foot.fall){
      Object.assign(foot,{fall:null,y:footGround(foot.z,foot.x),vy:0,grounded:true});
      recoverFootClearance();
    }
  }else seedTraffic(foot.active?foot:state);
  setAutopilot(auto.enabled);
}

get('solo-drive').addEventListener('change',event=>setSoloDrive(event.target.checked));

// Bật hoặc tắt tự lái bằng phím tắt hoặc nút trên màn hình.
function toggleAutopilot() {
  if(foot.active) return;
  setAutopilot(!auto.enabled);
}

const vehicleSelect=get('vehicle-select');
const vehicleChoices=[0,1,3,4,5];

// Đổi mẫu xe tại chỗ khi đã dừng và xe mới không chạm lan can hoặc xe khác.
function changeVehicle(model) {
  const current=state.model===2?1:state.model;
  vehicleSelect.value=String(current);
  const status=get('vehicle-change-status');
  status.textContent='';
  if(!state.started||!vehicleChoices.includes(model)||current===model) return;
  if(foot.active||runtime.vehicleTakeover||Math.abs(state.v)>.35||state.wreck){
    status.textContent='Dừng xe để đổi phương tiện.';
    return;
  }
  const candidate={...state,model};
  if(railIntersectsCar(candidate,state.z,state.x)||traffic.some(car=>carImpact(candidate,car,true))){
    status.textContent='Chỗ này không đủ rộng để đổi xe.';
    return;
  }
  setAutopilot(false);
  Object.assign(state,{model,v:0,steer:0,lateral:0,slide:0,roll:0,spin:0,wheelTravel:0,
    damage:null,crash:null,passenger:null,occupants:runtime.soloDrive?[]:carPassengers(model)});
  vehicleSelect.value=String(model);
}

// Điều phối phím lái, camera và đổi xe theo danh sách phương tiện.
function keyboard(event,down) {
  if(!state.started||(down&&['SELECT','INPUT'].includes(event.target?.tagName))) return;
  if(event.code==='Space'&&foot.active){
    event.preventDefault();
    if(down&&!event.repeat) jump();
    return;
  }
  if(down&&!event.repeat&&event.code==='KeyE') vehicleAction();
  if(down&&!event.repeat&&event.code==='KeyV'){
    const current=state.model===2?1:state.model;
    changeVehicle(vehicleChoices[(vehicleChoices.indexOf(current)+1)%vehicleChoices.length]);
  }
  const action=bindings[event.code];
  if(action) {
    event.preventDefault();
    if(down&&auto.enabled) setAutopilot(false);
    if(down) pressed.add(event.code);else pressed.delete(event.code);
    keys.clear();
    for(const code of pressed) keys.add(bindings[code]);
  }
  if(down&&!event.repeat&&event.code==='KeyC') toggleCamera();
  if(down&&!event.repeat&&event.code==='KeyP') toggleAutopilot();
}

// Giải phóng thao tác bị hủy hoặc khi ngón tay rời nút.
function release(event) {
  const button=fingers.get(event.pointerId);
  fingers.delete(event.pointerId);
  if(button&&![...fingers.values()].includes(button)) button.classList.remove('active');
}

// Chọn ngẫu nhiên vị trí xuất phát đủ xa các xe đang lưu thông.
function chooseStart(random=Math.random){
  const candidates=[];
  for(const section of runtime.route){
    const {start,end}=section,length=end-start;
    for(let offset=60;offset<length-60;offset+=18){
      const z=start+offset;
      const local=localRoadAt(z);
      if(local&&!inOpeningVillage(z)) continue;
      for(const x of local?[0,LANE_WIDTH]:[0,-LANE_WIDTH,LANE_WIDTH]){
        const clear=traffic.every(car=>{
          if(Math.abs(car.x-x)>2.8) return true;
          const distance=relativeDistance(z,car.z);
          return distance>38||distance<-Math.max(58,car.v*1.8+22);
        });
        if(clear) candidates.push({z,x});
      }
    }
  }
  return candidates[Math.floor(random()*candidates.length)]??{z:runtime.route[0].end*.5,x:0};
}

// Tạo tuyến đường, nạp toàn bộ model và vẽ cảnh đầu tiên trước khi mở HUD.
async function startDrive(report) {
  randomizeRoute();
  randomizeExits();
  const spawn=chooseStart();
  state.model=0;
  state.color=carColors[Math.floor(Math.random()*carColors.length)];
  state.occupants=runtime.soloDrive?[]:carPassengers(state.model);
  state.z=spawn.z;state.x=spawn.x;
  state.heading=Math.atan(slope(state.z));
  foot.look=newCharacter();
  for(const car of traffic){car.driver=newCharacter();car.passenger=motorcyclePassenger(car.model);car.occupants=carPassengers(car.model);}
  world.first=Math.floor(Math.random()*3);world.time=0;
  runtime.world3D=createWorld3D((loaded,total)=>report(`Đang tải tài nguyên… ${loaded}/${total}`));
  if(!runtime.world3D) throw new Error('Trình duyệt không khởi tạo được WebGL.');
  await runtime.world3D.prepare(()=>report('Đang chuẩn bị cảnh 3D…'));
  canvas.before(backdrop,runtime.world3D.canvas);
  // Tạo lại nền theo renderer 3D để bỏ đường chân trời và mây vẽ sẵn của chế độ 2D.
  resize();
  applyTheme();
  advanceWorld(0);
  state.camera=state.target=1;
  state.started=true;
  draw();
  if(runtime.world3D.canvas.hidden) throw new Error('Không vẽ được cảnh 3D.');
  get('hud-toggle').hidden=false;
  get('vehicle-actions').hidden=false;
  get('cover').hidden=true;get('hud').hidden=false;get('touch').hidden=false;get('drive-settings').hidden=false;
}

// Điều phối mô phỏng và giới hạn tốc độ vẽ ở 60 khung hình mỗi giây.
const frameInterval=1000/60;

function frame(now) {
  requestAnimationFrame(frame);
  if(now+.2<runtime.nextFrame) return;
  const elapsed=(now-runtime.lastFrame)/1000;
  runtime.lastFrame=now;
  runtime.nextFrame+=Math.max(1,Math.floor((now+.2-runtime.nextFrame)/frameInterval)+1)*frameInterval;
  if(document.hidden||!state.started) return;
  let remaining=clamp(elapsed,0,.45);
  while(remaining>1e-6){
    const step=Math.min(remaining,1/30);
    simulate(step);
    remaining-=step;
  }
  draw();
}

function setCameraField(field,value) {
  chase[field]=value;
  get(field+'-value').textContent=(field==='offset'&&value>0?'+':'')+value.toFixed(2)+' m';
}

cameraSettings.addEventListener('click',()=>showCameraPanel(true));

settingsToggle.addEventListener('click',()=>{
  const open=settingsPanel.hidden;
  showCameraPanel(false);
  showSettingsPanel(open);
});

function applyChasePreset(preset){
  for(const field of cameraFields){
    get('camera-'+field).value=preset[field];
    setCameraField(field,preset[field]);
  }
  viewLook.yaw=viewLook.pitch=0;
}

get('camera-reset').addEventListener('click',()=>applyChasePreset(chaseDefaults));

get('camera-night').addEventListener('click',()=>applyChasePreset({...chaseDefaults,offset:1.6}));

for(const field of cameraFields){
  const slider=get('camera-'+field);
  setCameraField(field,chaseDefaults[field]);
  slider.addEventListener('input',()=>setCameraField(field,slider.valueAsNumber));
}

function updateWalkStick(event){
  const rect=stick.getBoundingClientRect(),radius=rect.width*.33;
  const x=(event.clientX-rect.left-rect.width/2)/radius;
  const y=(event.clientY-rect.top-rect.height/2)/radius;
  const length=Math.hypot(x,y), div=Math.max(1,length);
  const value=clamp((length-.13)/.87,0,1)/(length||1);
  walkStick.x=x*value;walkStick.z=-y*value;
  stickCap.style.transform=`translate(${x/div*radius}px, ${y/div*radius}px)`;
}

stick.addEventListener('pointerdown',event=>{
  if(!foot.active||walkStick.pointer!==null||event.button!==0) return;
  stick.setPointerCapture(event.pointerId);
  walkStick.pointer=event.pointerId;
  updateWalkStick(event);
});

stick.addEventListener('pointermove',event=>{
  if(event.pointerId===walkStick.pointer) updateWalkStick(event);
});

for(const type of ['pointerup','pointercancel','lostpointercapture']){
  stick.addEventListener(type,event=>{
    if(event.pointerId===walkStick.pointer) resetWalkStick();
  });
}

canvas.addEventListener('pointerdown',event=>{
  if(!state.started||runtime.viewDrag||event.button!==0) return;
  canvas.setPointerCapture(event.pointerId);
  runtime.viewDrag={id:event.pointerId,x:event.clientX,y:event.clientY};
});

canvas.addEventListener('pointermove',event=>{
  if(runtime.viewDrag?.id!==event.pointerId) return;
  const firstPerson=foot.active?foot.firstPerson:state.target===0;
  const direction=firstPerson?-1:1;
  viewLook.yaw=mod(viewLook.yaw+(event.clientX-runtime.viewDrag.x)*.006*direction+Math.PI,TAU)-Math.PI;
  viewLook.pitch=clamp(viewLook.pitch+(runtime.viewDrag.y-event.clientY)*.003*direction,-.28,.32);
  runtime.viewDrag.x=event.clientX;runtime.viewDrag.y=event.clientY;
});

for(const type of ['pointerup','pointercancel','lostpointercapture']){
  canvas.addEventListener(type,event=>{if(runtime.viewDrag?.id===event.pointerId)runtime.viewDrag=null;});
}

// Gắn sự kiện giao diện và nhập liệu.
for(const selects of Object.values(conditions)){
  for(const select of selects){
    select.addEventListener('change',()=>{
      for(const peer of selects) peer.value=select.value;
      advanceWorld(0);
    });
  }
}

vehicleInteract.addEventListener('click',vehicleAction);
// Áp dụng ngay lựa chọn trên màn hình và trả bộ điều khiển về game.
vehicleSelect.addEventListener('change',event=>{
  changeVehicle(Number(event.target.value));
  vehicleSelect.blur();
});

jumpButton.addEventListener('pointerdown',event=>{
  if(event.button!==0) return;
  event.preventDefault();
  jump();
});

jumpButton.addEventListener('click',event=>{if(event.detail===0) jump();});

// Giữ màn hình chờ và cho thử lại nếu tài nguyên bắt buộc bị lỗi.
get('start').addEventListener('click',async event=>{
  const button=event.currentTarget;
  if(state.started||button.disabled) return;
  const status=get('start-status');
  const report=message=>{status.textContent=message;};
  button.disabled=true;
  status.hidden=false;
  report('Đang tải model 3D…');
  if(get('sound').getAttribute('aria-pressed')!=='true') void toggleSound();
  try{
    await startDrive(report);
  }catch(error){
    state.started=false;
    runtime.world3D?.dispose();
    runtime.world3D=null;
    report(`${error.message} Hãy thử lại.`);
    button.textContent='Thử lại';
    button.disabled=false;
  }
});

get('hud-toggle').addEventListener('click',()=>{
  const button=get('hud-toggle');
  const visible=button.getAttribute('aria-pressed')!=='true';
  button.setAttribute('aria-pressed',String(visible));
  button.setAttribute('aria-label',visible?'Ẩn HUD':'Hiện HUD');
  button.title=visible?'Ẩn HUD':'Hiện HUD';
  document.body.classList.toggle('hud-off',!visible);
  if(!visible){showCameraPanel(false);showSettingsPanel(false);}
});

function applyTheme(){
  const theme=themeControl.value;
  coverTheme.value=theme;
  for(const layer of [canvas,backdrop,runtime.world3D?.canvas]){
    if(layer) layer.setAttribute('data-scene-theme',theme);
  }
}

try {
  const savedTheme=localStorage.getItem('midnight-scene-theme');
  if([...themeControl.options].some(option=>option.value===savedTheme)) themeControl.value=savedTheme;
} catch {}
applyTheme();

for(const control of [themeControl,coverTheme]){
  control.addEventListener('change',()=>{
    themeControl.value=control.value;
    applyTheme();
    try { localStorage.setItem('midnight-scene-theme',themeControl.value); } catch {}
  });
}

// Cập nhật số xe đang lưu thông, giữ xe đỗ và xe đang được tương tác.
get('traffic-density').addEventListener('input',event=>{
  runtime.maxTraffic=Number(event.target.value);
  get('traffic-density-value').textContent=runtime.maxTraffic+' xe';
  const actor=foot.active?foot:state;
  const activeCars=traffic.filter(car=>!car.parked)
    .sort((a,b)=>Math.abs(relativeDistance(actor.z,a.z))-Math.abs(relativeDistance(actor.z,b.z)));
  for(const car of activeCars.slice(runtime.maxTraffic)){
    if(car!==runtime.vehicleTakeover?.car) traffic.splice(traffic.indexOf(car),1);
  }
  seedTraffic(actor);
});
// Áp dụng mật độ NPC đi bộ mà không đổi người đang ngồi trong xe.
get('pedestrian-density').addEventListener('input',event=>{
  const percent=Number(event.target.value);
  runtime.pedestrianDensity=percent/100;
  get('pedestrian-density-value').textContent=percent+'%';
});
// Đổi mật độ cây ngay khi kéo thanh và hiển thị hệ số hiện tại.
get('tree-density').addEventListener('input',event=>{
  runtime.treeDensity=Number(event.target.value);
  get('tree-density-value').textContent=runtime.treeDensity.toFixed(1)+'×';
});
get('graphics').addEventListener('change',event=>{
  runtime.graphics=graphicsPresets[event.target.value]??graphicsPresets.highest;
  resize();
});

// Áp tầm render ngay khi kéo thanh trượt và hiển thị giá trị theo mét.
get('object-distance').addEventListener('input',event=>{
  runtime.objectDistance=Number(event.target.value);
  get('object-distance-value').textContent=runtime.objectDistance+' m';
});

effectsSlider.addEventListener('input',()=>{
  runtime.effectsLevel=Number(effectsSlider.value)/100;
  get('effects-volume-value').textContent=effectsSlider.value+'%';
  if(!runtime.audio) return;
  runtime.audio.master.gain.setTargetAtTime(runtime.audio.effectsOn?runtime.effectsLevel:0,runtime.audio.ac.currentTime,.07);
  if(runtime.effectsLevel===0&&typeof window!=='undefined') window.speechSynthesis?.cancel();
});

get('sound').addEventListener('click',toggleSound);

get('camera').addEventListener('click',toggleCamera);

get('autopilot').addEventListener('click',toggleAutopilot);

addEventListener('keydown',event=>keyboard(event,true));

addEventListener('keyup',event=>keyboard(event,false));

addEventListener('blur',clearInput);

document.addEventListener('visibilitychange',clearInput);

addEventListener('resize',resize);

for(const button of document.querySelectorAll('[data-control]')){
  // Ghi nhận đa chạm và giữ điều khiển khi ngón tay trượt ngoài nút.
  button.addEventListener('pointerdown',event=>{
    if(auto.enabled) setAutopilot(false);
    event.preventDefault();button.setPointerCapture(event.pointerId);fingers.set(event.pointerId,button);button.classList.add('active');
  });
  button.addEventListener('pointerup',release);
  button.addEventListener('pointercancel',release);
  button.addEventListener('lostpointercapture',release);
}

advanceWorld(0);

seedTraffic();

resize();

requestAnimationFrame(frame);
