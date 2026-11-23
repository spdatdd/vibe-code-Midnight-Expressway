import { tone } from './audio.js';
import { FOOT_RADIUS, LANE_WIDTH, LOOP, RECLAIM_GRACE_SECONDS, TAU, clamp, lerp, mod } from './constants.js';
import { blendFromDisplayedCamera } from './render2d.js';
import { center, district, exitWidth, footBlocked, footGround, moveAcrossTerrain, railAt, relativeDistance, roadLocation, terrainHeight, walkLimit } from './route.js';
import { active, clearInput, ejectedDrivers, foot, get, jumpButton, labelControl, runtime, sandFootprints, showCameraPanel, state, stick, traffic, vehicleInteract, viewLook, walkStick, world } from './runtime.js';
import { carYaw, engineBlocked, recoverRider, riderBlocked, setAutopilot, standingPosition, vehiclePoint, vehicleProfile, wreckClearance, wreckExpired } from './traffic.js';

export function reactDriver(car,taken=false){
  if(!car.driver||car.parked||car.wreck||!runtime.audio?.effectsOn||runtime.effectsLevel===0) return;
  if((taken||world.time>=(car.nextHornAt??0))&&runtime.audio.ac.currentTime>=(runtime.audio.nextHorn??0)){
    const at=runtime.audio.ac.currentTime,frequency=car.model===5?245:car.model===4?445:375;
    runtime.audio.nextHorn=at+.85;
    car.nextHornAt=world.time+2.6+Math.random()*2.2;
    tone(runtime.audio.ac,runtime.audio.master,frequency,frequency*.95,.29,.22,'triangle',at);
    tone(runtime.audio.ac,runtime.audio.master,frequency*1.29,frequency*1.22,.16,.21,'square',at);
    if(taken||Math.random()<.24) tone(runtime.audio.ac,runtime.audio.master,frequency,frequency*.86,.25,.24,'triangle',at+.29);
  }
}

// Chuyển quyền điều khiển xe và giữ hành khách trên đúng phương tiện.
export function enterVehicle(chosen){
  blendFromDisplayedCamera(1.32,runtime.previousCamera>=.5?chosen:null);
  let previous=null;
  if(chosen!==state){
    previous={z:state.z,x:state.x,model:state.model,color:state.color,v:0,cruise:0,
      lane:-1,parked:true,freeTerrain:true,brake:false,lateral:0,cooldown:0,wreck:state.wreck,damage:state.damage,crash:state.crash,passenger:state.passenger,occupants:state.occupants,wheelTravel:state.wheelTravel,heading:state.heading,freeSteering:state.freeSteering,yawOffset:state.yawOffset??0};
    traffic[traffic.indexOf(chosen)]=previous;
    Object.assign(state,{claimant:null,z:chosen.z,x:chosen.x,model:chosen.model,color:chosen.color,
      v:0,lateral:0,slide:0,spin:0,roll:0,damage:chosen.damage,crash:chosen.crash,passenger:chosen.passenger,occupants:chosen.occupants,wheelTravel:chosen.wheelTravel,heading:chosen.heading,freeSteering:chosen.freeSteering,yawOffset:chosen.yawOffset??0});
  }
  Object.assign(state,{wreck:null,v:0,slide:0,spin:0,roll:0});
  state.local=roadLocation(state)&&Math.abs(state.x)>5.5?roadLocation(state):null;
  foot.active=false;
  state.target=runtime.previousCamera;
  syncVehicleControls();
  return previous;
}

export function doorAlong(car){return car.model===5?2.32:car.model===4?-.13:.42;}

export function actorSpotClear(spot,ignore=null){
  const height=terrainHeight(spot.z,spot.x)+.15;
  return !riderBlocked(spot.z,spot.x,height)
    && ![state,...traffic].some(peer=>peer!==ignore&&footHitsCar(spot.z,spot.x,peer));
}

export function actorWaypoint(from,to,t){
  const z=mod(from.z+relativeDistance(from.z,to.z)*t,LOOP);
  return {z,x:lerp(center(from.z)+from.x,center(to.z)+to.x,t)-center(z)};
}

export function actorPathClear(from,to,ignore=null){
  const distance=Math.hypot(center(to.z)+to.x-center(from.z)-from.x,relativeDistance(from.z,to.z));
  const steps=Math.max(1,Math.ceil(distance/.16));
  for(let i=1;i<=steps;i++) if(!actorSpotClear(actorWaypoint(from,to,i/steps),ignore)) return false;
  return true;
}

export function beginTakeover(car,pull){
  const yaw=carYaw(car),along=doorAlong(car),width=vehicleProfile(car.model).halfWidth;
  const dz=relativeDistance(car.z,foot.z),dx=center(foot.z)+foot.x-center(car.z)-car.x;
  const side=Math.sign(dx*Math.cos(yaw)-dz*Math.sin(yaw))||-1;
  const footStart={z:foot.z,x:foot.x};
  const approach=vehiclePoint(car,side*(width+.50),along);
  const distance=Math.hypot(relativeDistance(foot.z,approach.z),center(approach.z)+approach.x-center(foot.z)-foot.x);
  if(distance>3.1) return;
  const land=pull?vehiclePoint(car,side*(width+1.30),along+.30):null;
  runtime.vehicleTakeover={car,side,along,elapsed:0,door:0,footStart,footYaw:foot.angle,
    cameraFocus:approach,land,driver:null,mode:pull?'take':'entry'};
  blendFromDisplayedCamera(.58);
  car.v=car.lateral=car.slide=0;
  foot.firstPerson=false;
  foot.cameraYaw=yaw-side*.65;
  viewLook.yaw=viewLook.pitch=0;
  clearInput();
}

export function placeTakeoverActor(actor,from,to,t){
  Object.assign(actor,actorWaypoint(from,to,t));
  standingPosition(actor);
}

export function releaseTakeoverDriver(action){
  if(!action.driver) return;
  const rider=action.driver;
  Object.assign(rider,{age:0,low:true,vx:0,vz:0,vy:0,tilt:rider.tilt??0,startingTilt:rider.tilt??0,spin:0,leftAt:world.time});
  rider.reaction=Math.random()<.5?'flee':'chase';
  rider.originalCar=action.car;
  action.ejected=rider;
  ejectedDrivers.push(rider);
  action.driver=null;
}

export function clearEntryPose(){
  foot.actionGrip=foot.actionStep=foot.actionReach=foot.actionCrouch=foot.actionLean=0;
  foot.actionPlant=foot.actionFeet=null;
}

export function poseCabinEntry(action,approach,seat,t){
  const {car,side}=action;
  const ease=(a,b)=>{const n=clamp((t-a)/(b-a),0,1);return n*n*(3-2*n);};
  const step=ease(.16,.42),sit=ease(.49,.84);
  placeTakeoverActor(foot,approach,seat,sit);
  const plant=ease(0,.13)*(1-ease(.52,.64));
  const yaw=carYaw(car);
  if(plant>.001){
    const width=vehicleProfile(car.model).halfWidth;
    const point=vehiclePoint(car,side*(width+.58),action.along-.17);
    foot.actionPlant={...point,y:terrainHeight(point.z,point.x),weight:plant,yaw:yaw-side*Math.PI/2};
  }else foot.actionPlant=null;
  foot.angle=yaw-side*Math.PI/2*(1-ease(.37,.77));
  foot.actionStepSide=-side;
  foot.actionStep=step*(1-ease(.57,.87))*(car.model===5?1.25:1);
  foot.actionCrouch=.82*ease(.34,.72);
  foot.actionLean=.42*ease(.37,.63)*(1-ease(.66,.92));
  foot.actionGrip=car.model===4?0:1-ease(.18,.43)+.82*ease(.69,.83);
  foot.actionReach=foot.actionGrip*.60;
  foot.y+=(car.model===5?.84:.16)*ease(.48,.79)+(car.model===5?.08:.02)*foot.actionStep;
  foot.moving=false;
}

export function poseMotorcycleMount(action,approach,seat,t){
  const {car,side}=action,yaw=carYaw(car);
  const ease=(a,b)=>{const n=clamp((t-a)/(b-a),0,1);return n*n*(3-2*n);};
  const swing=ease(.18,.74),settle=ease(.68,.96);
  const mount=ease(.31,.71);
  placeTakeoverActor(foot,approach,seat,mount);
  foot.angle=yaw-side*.42*(1-ease(.08,.35));
  foot.actionLean=.20+.29*ease(.05,.36)*(1-settle);
  foot.actionGrip=ease(0,.25);
  foot.actionCrouch=.70*settle;
  foot.y+=.26*mount+.22*Math.sin(Math.PI*swing)+.06*settle;
  foot.moving=false;
  const leg=(across,along,height,weight)=>{
    const point=vehiclePoint(car,across,along);
    return {...point,y:terrainHeight(point.z,point.x)+height,weight,yaw};
  };
  const weight=ease(0,.16);
  foot.actionFeet={
    [side]:leg(side*lerp(.79,.29,settle),lerp(-.23,-.30,settle),.37*settle,weight),
    [-side]:leg(lerp(side*.74,-side*.29,swing),lerp(-.61,-.30,settle),
      .37*swing+.94*Math.sin(Math.PI*swing),weight)
  };
}

export function stepVehicleTakeover(dt){
  const action=runtime.vehicleTakeover;
  const {car,side,along,footStart}=action;
  if((car!==state&&!traffic.includes(car))||wreckExpired(car)||engineBlocked(car)||car.wreck||car.damage?.stage==='fire'||foot.fall){
    if(action.mode==='reclaim') action.rider.reaction='flee';
    releaseTakeoverDriver(action);
    blendFromDisplayedCamera(.46);
    runtime.vehicleTakeover=null;
    clearEntryPose();
    return;
  }
  action.elapsed+=dt;
  const t=action.elapsed, width=vehicleProfile(car.model).halfWidth;
  const approach=vehiclePoint(car,side*(width+.50),along);
  const pullBack=vehiclePoint(car,side*(width+.90),along-.27);
  const yaw=carYaw(car);
  const phase=(start,end)=>{const t=clamp((action.elapsed-start)/(end-start),0,1);return t*t*(3-2*t);};
  const seat=vehiclePoint(car,side*(car.model===4?0:.33),along);
  const seatHeight=car.model===5?.72:.30;
  if(action.mode==='entry'){
    action.door=car.model===4?0:phase(.43,.74)*(1-phase(1.40,1.75));
    foot.actionStepSide=-side;
    if(t<.43){
      placeTakeoverActor(foot,footStart,approach,phase(0,.40));
      const mountHeading=yaw-side*(car.model===4?.42:Math.PI/2);
      const turn=mod(mountHeading-action.footYaw+Math.PI,TAU)-Math.PI;
      foot.angle=action.footYaw+turn*phase(0,.40);
      foot.moving=t<.39;
      foot.stride=mod(t*1.8,1);
      foot.actionGrip=car.model===4?0:phase(.25,.43);
    }else{
      const pose=car.model===4?poseMotorcycleMount:poseCabinEntry;
      pose(action,approach,seat,clamp((t-.43)/1.32,0,1));
    }
    if(t>=1.77){
      runtime.vehicleTakeover=null;
      clearEntryPose();
      enterVehicle(car);
    }
    return;
  }
  if(action.mode!=='take'){
    const reclaim=action.mode==='reclaim';
    action.door=phase(.05,.37)*(1-phase(.99,1.30));
    if(reclaim){
      const {rider}=action;
      if(action.withPlayer){
        placeTakeoverActor(foot,seat,pullBack,phase(.37,.82));
        foot.y+=seatHeight*(1-phase(.37,.82));
        foot.actionCrouch=1-phase(.37,.82);
        foot.actionLean=phase(.44,.76)*.78;
        foot.angle=yaw+side*Math.PI/2;
      }
      placeTakeoverActor(rider,action.riderStart,seat,phase(.82,1.29));
      rider.actionReach=phase(.18,.43)*(1-phase(.70,.85));
      rider.actionCrouch=phase(.83,1.29);
      rider.y+=seatHeight*rider.actionCrouch;
    }else{
      const mount=1-phase(.30,.95);
      placeTakeoverActor(foot,action.exitSpot??approach,seat,mount);
      foot.angle=yaw+side*Math.PI/2;
      foot.actionReach=phase(.13,.36)*(1-phase(.74,1.06));
      foot.actionCrouch=mount;
      foot.y+=seatHeight*mount;
      foot.moving=false;
    }
    if(t>=1.33){
      blendFromDisplayedCamera(.46);
      runtime.vehicleTakeover=null;
      clearEntryPose();
      if(reclaim) finishReclaim(action);
      syncVehicleControls();
    }
    return;
  }
  foot.angle=yaw-side*Math.PI/2;
  foot.moving=t<.53;
  foot.stride=mod(t*1.8,1);
  if(t<.63) placeTakeoverActor(foot,footStart,approach,phase(0,.53));
  else if(t<1.16) placeTakeoverActor(foot,approach,pullBack,phase(.63,1.02));
  else{
    const pose=car.model===4?poseMotorcycleMount:poseCabinEntry;
    pose(action,pullBack,seat,clamp((t-1.16)/1.23,0,1));
  }
  action.door=car.model===4?0:phase(.37,.68)*(1-phase(2.04,2.39));
  if(t<1.16){
    foot.actionReach=phase(.25,.60)*(1-phase(.99,1.16));
    foot.actionGrip=car.model===4?0:phase(.25,.43)*(1-phase(.59,.67));
    foot.actionStepSide=-side;
  }
  if(t>=.63&&t<1.19){
    action.driver??={source:car,look:car.driver,angle:yaw+side*Math.PI/2,tilt:0};
    const start=vehiclePoint(car,side*(car.model===4?0:.33),along);
    const pulled=phase(.63,1.19);
    placeTakeoverActor(action.driver,start,action.land,pulled);
    action.driver.y+=seatHeight*(1-pulled)+Math.sin(pulled*Math.PI)*.12;
    action.driver.actionLean=phase(.72,1.16)*.92;
    action.driver.tilt=action.driver.actionLean;
    action.driver.actionCrouch=1-phase(.63,.90);
  }
  if(t>=1.19&&action.driver){
    releaseTakeoverDriver(action);
    reactDriver(car,true);
  }
  if(t>=2.41){
    runtime.vehicleTakeover=null;
    clearEntryPose();
    const previous=enterVehicle(car);
    if(action.ejected?.reaction==='chase'){
      action.ejected.previous=previous;
      action.ejected.reclaimAfter=world.time+RECLAIM_GRACE_SECONDS;
      state.claimant=action.ejected;
    }
  }
}

export function walkFormerDriver(rider,target,dt){
  if(!actorSpotClear(rider)){
    const startX=center(rider.z)+rider.x;
    for(const radius of [.24,.46,.68]){
      for(let i=0;i<12;i++){
        const heading=rider.angle+i*TAU/12;
        const z=mod(rider.z+Math.cos(heading)*radius,LOOP),x=startX+Math.sin(heading)*radius-center(z);
        if(!actorSpotClear({z,x})) continue;
        Object.assign(rider,{x,z,moving:false});
        standingPosition(rider);
        return;
      }
    }
  }
  const dx=center(target.z)+target.x-center(rider.z)-rider.x;
  const dz=relativeDistance(rider.z,target.z);
  const distance=Math.hypot(dx,dz);
  rider.moving=false;
  if(distance<.18) return;
  const step=Math.min(distance,5.7*dt);
  const yaw=Math.atan2(dx,dz);
  const preferred=rider.detour??1;
  for(const angle of [0,preferred*.56,-preferred*.56,preferred*1.12,-preferred*1.12,
    preferred*1.65,-preferred*1.65,preferred*2.22,-preferred*2.22]){
    const heading=yaw+angle;
    const z=mod(rider.z+Math.cos(heading)*step,LOOP);
    const x=center(rider.z)+rider.x+Math.sin(heading)*step-center(z);
    if(!actorSpotClear({z,x})) continue;
    rider.x=x;rider.z=z;
    rider.angle+=clamp(mod(heading-rider.angle+Math.PI,TAU)-Math.PI,-8*dt,8*dt);
    rider.stride=mod((rider.stride??0)+step/1.16,1);
    rider.detour=Math.sign(angle)||preferred;
    rider.running=rider.moving=true;
    standingPosition(rider);
    return;
  }
  rider.detour=-preferred;
}

// Khôi phục xe trước đó cùng những người đang ngồi trên từng xe.
export function finishReclaim(action){
  const {rider}=action;
  const slot=traffic.indexOf(rider.previous);
  if(slot<0){rider.reaction='flee';state.claimant=null;return;}
  const {z,x,heading,color,damage,crash,model,occupants,passenger}=state;
  const npc=rider.originalCar;
  Object.assign(npc,{z,x,heading,color,damage,crash,model,occupants,passenger,driver:rider.look,parked:false,
    v:0,lateral:0,slide:0,wreck:null,local:state.local,lane:clamp(Math.round(x/LANE_WIDTH)+1,0,2),cooldown:1});
  traffic[slot]=npc;
  const previous=rider.previous;
  Object.assign(state,{z:previous.z,x:previous.x,model:previous.model,color:previous.color,
    damage:previous.damage,crash:previous.crash,wreck:previous.wreck,passenger:previous.passenger,occupants:previous.occupants,
    wheelTravel:previous.wheelTravel,heading:previous.heading,yawOffset:previous.yawOffset,
    freeSteering:previous.freeSteering,local:null,claimant:null,v:0,steer:0,lateral:0,slide:0,roll:0,spin:0,target:1});
  ejectedDrivers.splice(ejectedDrivers.indexOf(rider),1);
}

export function stepFormerDriver(rider,dt){
  if(!rider.reaction||runtime.vehicleTakeover?.rider===rider||runtime.vehicleTakeover?.ejected===rider||rider.shoveUntil>world.time) return;
  const dx=center(state.z)+state.x-center(rider.z)-rider.x;
  const dz=relativeDistance(rider.z,state.z);
  const distance=Math.hypot(dx,dz);
  const elapsed=world.time-rider.leftAt;
  if(rider.reaction==='chase'&&(state.claimant!==rider||!traffic.includes(rider.previous)
    ||distance>62||elapsed>17||engineBlocked(state)||state.damage?.stage==='fire'||state.wreck)){
    rider.reaction='flee';
    if(state.claimant===rider) state.claimant=null;
  }
  if(rider.reaction==='flee'){
    rider.fleeSide??=Math.sign(rider.x)||Math.sign(-dx)||1;
    rider.fleeDirection??=Math.sign(-dz)||1;
    // Dùng làn ngoài làm lối chạy nếu lan can chắn đường ra lề.
    const side=rider.fleeSide,z=mod(rider.z+rider.fleeDirection*11,LOOP);
    const shoulder=railAt(rider.z,side)&&Math.abs(rider.x)<6?side*5.42:side*10;
    walkFormerDriver(rider,{z,x:walkLimit(z,shoulder)},dt);
    return;
  }
  const yaw=carYaw(state);
  const side=Math.sign(-dx*Math.cos(yaw)+dz*Math.sin(yaw))||-1;
  const along=doorAlong(state),width=vehicleProfile(state.model).halfWidth;
  const door=vehiclePoint(state,side*(width+.55),along);
  const gap=Math.hypot(relativeDistance(rider.z,door.z),center(door.z)+door.x-center(rider.z)-rider.x);
  if(!runtime.vehicleTakeover&&world.time>=rider.reclaimAfter&&gap<.73&&Math.abs(state.v)<1.2
    &&actorPathClear(rider,door)){
    runtime.vehicleTakeover={car:state,side,along,elapsed:0,door:0,mode:'reclaim',rider,withPlayer:!foot.active,
      cameraFocus:foot.active?null:door,riderStart:{z:rider.z,x:rider.x}};
    state.v=state.steer=state.lateral=state.slide=0;
    if(!foot.active){
      blendFromDisplayedCamera(.72);
      Object.assign(foot,door,{active:true,firstPerson:false,grounded:true,fall:null,angle:yaw,cameraYaw:yaw-side*.65});
      standingPosition(foot);
      setAutopilot(false);
      syncVehicleControls();
    }
    rider.angle=yaw-side*Math.PI/2;
    rider.moving=false;
    return;
  }
  walkFormerDriver(rider,door,dt);
}

export function sceneRiders(){
  const riders=ejectedDrivers.slice();
  if(runtime.vehicleTakeover?.driver) riders.push(runtime.vehicleTakeover.driver);
  for(const car of traffic) for(const rider of [car.wreck?.rider,car.wreck?.passenger])
    if(rider) riders.push(rider);
  return riders;
}

export function riderFallPose(rider){
  return rider.recover===1||rider.age===undefined?null:rider;
}

export function vehicleAction(){
  if(!state.started||runtime.vehicleTakeover) return;
  if(foot.active){
    if(foot.fall) return;
    let chosen=null,best=Infinity;
    for(const car of [state,...traffic]){
      const dz=relativeDistance(car.z,foot.z);
      if(Math.abs(dz)>6) continue;
      const dx=center(foot.z)+foot.x-center(car.z)-car.x;
      const heading=carYaw(car);
      const across=dx*Math.cos(heading)-dz*Math.sin(heading);
      const along=dx*Math.sin(heading)+dz*Math.cos(heading);
      const profile=vehicleProfile(car.model);
      const distance=Math.hypot(Math.max(0,Math.abs(across)-profile.halfWidth),
        Math.max(0,Math.abs(along)-profile.halfLength));
      const wreck=car.wreck;
      const stopped=Math.abs(car.v)<=.65&&(!wreck||Math.abs(wreck.spin)<.55&&Math.abs(wreck.vy)<.55
        &&wreck.y<=wreckClearance(car)+.1);
      if(!wreckExpired(car)&&!engineBlocked(car)&&car.damage?.stage!=='fire'&&stopped&&distance<=(wreck?1.95:1.55)&&distance<best){
        best=distance;chosen=car;
      }
    }
    if(!chosen||!foot.grounded||foot.y>terrainHeight(foot.z,foot.x)+.35){
      return;
    }
    if(chosen.wreck) enterVehicle(chosen);
    else beginTakeover(chosen,Boolean(chosen!==state&&chosen.driver&&!chosen.parked));
    return;
  }else{
    const exitSpeed=Math.abs(state.v);
    const angle=carYaw(state),cos=Math.cos(angle),sin=Math.sin(angle);
    const direction=state.x*cos>0?-1:1;
    const spacing=vehicleProfile(state.model).halfWidth+.75;
    const animated=exitSpeed<=1.5&&!state.wreck;
    const along=animated?doorAlong(state):0;
    const exitSpot=side=>({...vehiclePoint(state,side*spacing,along),side});
    const door=animated?exitSpot(direction):[direction,-direction].map(exitSpot)
      .find(({z,x})=>walkLimit(z,x)===x&&!riderBlocked(z,x,terrainHeight(z,x)+.15)
        &&!traffic.some(car=>footHitsCar(z,x,car)));
    if(!door) return;
    blendFromDisplayedCamera(.72);
    runtime.previousCamera=state.target;
    setAutopilot(false);
    Object.assign(foot,{active:true,z:door.z,x:door.x,y:terrainHeight(door.z,door.x),vy:0,
      angle,cameraYaw:angle,stride:0,moving:false,grounded:true});
    state.steer=state.lateral=0;
    if(animated){
      runtime.vehicleTakeover={car:state,side:door.side,along,elapsed:0,door:0,mode:'exit',
        cameraFocus:door,exitSpot:door,footStart:door};
      state.v=state.slide=0;
      foot.firstPerson=false;
      foot.cameraYaw=angle-door.side*.65;
    }
    const jumpFromBike=state.model===4&&exitSpeed>1.5&&!state.wreck;
    if(exitSpeed>1.5&&(!runtime.soloDrive||jumpFromBike)){
      const fast=exitSpeed>=7;
      const sideways=door.side*(fast?2.4:1.2),forward=state.v*(fast?.88:.64);
      foot.fall={source:state,x:door.x,z:door.z,y:foot.y+(fast?.85:0),vx:cos*sideways+sin*forward,
        vz:cos*forward-sin*sideways,vy:fast?Math.min(5,1+exitSpeed*.10):0,
        angle,tilt:0,spin:fast?Math.min(13,2.8+exitSpeed*.24):0,
        age:0,low:!fast,launchSpeed:exitSpeed,impact:exitSpeed,look:foot.look};
      foot.grounded=false;
      if(jumpFromBike){
        const side=-door.side;
        state.wreck={dismount:true,since:world.time,sign:side,roll:side*.18,
          spin:side*lerp(1.8,3.05,clamp(exitSpeed/18,0,1)),vy:0,y:0};
        state.wreck.y=wreckClearance(state);
        state.slide=side*Math.min(.85,exitSpeed*.06);
      }
    }
    state.target=1;
    showCameraPanel(false);
  }
  syncVehicleControls();
}

// Đồng bộ nút lái và lựa chọn phương tiện sau khi lên hoặc xuống xe.
export function syncVehicleControls(){
  clearInput();
  foot.walkYaw=null;foot.directionHold=0;foot.running=false;
  viewLook.yaw=viewLook.pitch=0;
  labelControl(vehicleInteract,foot.active?'Lên xe':'Xuống xe');
  vehicleInteract.setAttribute('data-entering',String(foot.active));
  jumpButton.hidden=!foot.active;
  const vehicleSelect=get('vehicle-select');
  vehicleSelect.hidden=foot.active;
  vehicleSelect.value=String(state.model===2?1:state.model);
  get('vehicle-change-status').textContent='';
  labelControl(get('camera'),foot.active&&foot.firstPerson?'Góc nhìn thứ nhất':'Đổi góc nhìn');
  for(const id of ['camera-settings','autopilot'])get(id).disabled=foot.active;
  get('touch').hidden=foot.active;
  stick.hidden=!foot.active;
}

export function jump(){
  if(foot.active&&foot.grounded&&!runtime.vehicleTakeover){foot.grounded=false;foot.vy=6.6;}
}

export function footHitsCar(z,x,car,carX=car.x){
  if(wreckExpired(car)) return false;
  const {halfLength,halfWidth}=vehicleProfile(car.model);
  const dz=relativeDistance(car.z,z);
  if(Math.abs(dz)>halfLength+halfWidth+FOOT_RADIUS) return false;
  const dx=center(z)+x-center(car.z)-carX;
  const yaw=carYaw(car);
  const c=Math.cos(yaw),s=Math.sin(yaw);
  const across=Math.max(0,Math.abs(dx*c-dz*s)-halfWidth);
  const along=Math.max(0,Math.abs(dx*s+dz*c)-halfLength);
  return across*across+along*along<FOOT_RADIUS*FOOT_RADIUS;
}

export function pedestrianGap(car,x=car.x){
  if(!foot.active||foot.fall||runtime.vehicleTakeover) return Infinity;
  const dz=relativeDistance(car.z,foot.z);
  const profile=vehicleProfile(car.model);
  if(dz<0||Math.abs(foot.x-x)>profile.halfWidth+FOOT_RADIUS+.23) return Infinity;
  return dz-profile.halfLength-FOOT_RADIUS;
}

export function strikePedestrian(car,fromZ,fromX,previousFoot){
  if(runtime.soloDrive) return false;
  if(!foot.active||foot.fall||runtime.vehicleTakeover||!previousFoot||car.v<4.5) return false;
  const oldGap=relativeDistance(fromZ,previousFoot.z);
  if(Math.abs(oldGap)>12) return false;
  const profile=vehicleProfile(car.model);
  if(foot.y>terrainHeight(car.z,car.x)+profile.roof+.10) return false;
  const travelZ=relativeDistance(fromZ,car.z);
  const travelX=center(car.z)+car.x-center(fromZ)-fromX;
  const footZ=relativeDistance(previousFoot.z,foot.z);
  const footX=center(foot.z)+foot.x,oldFootX=center(previousFoot.z)+previousFoot.x;
  const startX=center(fromZ)+fromX;
  const yaw=carYaw(car),c=Math.cos(yaw),s=Math.sin(yaw);
  let contact=false;
  // Lấy mẫu tương đối theo bước ngắn để bắt va chạm ngay cả khi xe và người đi cắt ngang nhau.
  const steps=Math.max(1,Math.ceil((Math.hypot(travelX,travelZ)+Math.hypot(footX-oldFootX,footZ))/.24));
  for(let i=0;i<=steps;i++){
    const t=i/steps,dx=lerp(oldFootX,footX,t)-startX-travelX*t;
    const dz=oldGap+(footZ-travelZ)*t;
    const across=Math.abs(dx*c-dz*s),along=Math.abs(dx*s+dz*c);
    if(across<=profile.halfWidth+FOOT_RADIUS&&along<=profile.halfLength+FOOT_RADIUS){contact=true;break;}
  }
  if(!contact) return false;
  const sideways=Math.sign(footX-(center(car.z)+car.x)||1);
  const impulse=clamp(car.v*(.65+profile.mass*.000035),3.5,23);
  foot.fall={source:car,z:foot.z,x:foot.x,y:Math.max(foot.y+.45,.58),vy:Math.min(5.2,1.5+impulse*.18),
    vx:s*impulse+c*sideways*impulse*.22,vz:c*impulse-s*sideways*impulse*.22,
    tilt:.16,spin:sideways*clamp(impulse*.5,2.5,12),age:0,angle:yaw,look:foot.look,impact:impulse,launchSpeed:car.v};
  foot.angle=yaw;foot.grounded=false;foot.moving=false;foot.walkYaw=null;
  car.v*=profile.mass<450?.7:.9;
  state.hit=Math.max(state.hit,.28);
  return true;
}

// Một chu kỳ gồm 60% chống chân và 40% vung chân, mỗi bên lệch nửa chu kỳ.
export function gaitSample(cycle,running=false){
  const phase=mod(cycle,1),stance=running?.45:.64,reach=running?.41:.30;
  if(phase<stance){
    const t=phase/stance;
    return {along:lerp(reach,-reach,t),lift:0,pitch:-.28*(1-clamp(t*4,0,1))+.42*clamp((t-.7)/.3,0,1)};
  }
  const t=(phase-stance)/(1-stance), ease=t*t*(3-2*t);
  return {along:lerp(-reach,reach,ease),lift:(running?.23:.115)*Math.sin(Math.PI*t)**1.25,pitch:lerp(.42,-.28,t)};
}

export function leaveSandFootprint(side){
  const sin=Math.sin(foot.angle),cos=Math.cos(foot.angle),scale=foot.look.scale;
  const z=mod(foot.z+(.18*cos-side*.12*sin)*scale,LOOP);
  const x=center(foot.z)+foot.x+(.18*sin+side*.12*cos)*scale-center(z);
  if(district(z)!==3||x<=Math.max(10.2,6.3+exitWidth(z,1))||x>=21.7||roadLocation({z,x})) return;
  const y=terrainHeight(z,x);
  if(Math.abs(foot.y-y)>.08) return;
  if(sandFootprints.length>=120) sandFootprints.shift();
  sandFootprints.push({z,x,y,angle:foot.angle,scale,time:world.time});
}

export function recoverFootClearance(){
  if(!foot.active||foot.fall||runtime.vehicleTakeover||!footBlocked(foot.z,foot.x)) return;
  const originZ=foot.z,originX=center(originZ)+foot.x;
  for(const radius of [.30,.55,.85,1.25,1.75,2.4,3.2,4.3,5.7,7.4]){
    for(let i=0;i<16;i++){
      const angle=foot.angle+i*TAU/16;
      const z=mod(originZ+Math.cos(angle)*radius,LOOP);
      const x=originX+Math.sin(angle)*radius-center(z);
      if(walkLimit(z,x)!==x||footBlocked(z,x)) continue;
      foot.z=z;foot.x=x;
      return;
    }
  }
}

export function nudgeFormerDriver(rider,dx,dz){
  const z=mod(rider.z+dz,LOOP),x=center(rider.z)+rider.x+dx-center(z);
  if(!actorPathClear(rider,{x,z})) return false;
  rider.x=x;rider.z=z;
  standingPosition(rider);
  rider.shoveUntil=world.time+.33;
  rider.actionLean=-.28;
  rider.actionReach=.30;
  rider.moving=false;
  return true;
}

export function pushAtFoot(z,x,dx,dz){
  let blocked=false;
  for(const rider of ejectedDrivers){
    if(rider.recover!==1||runtime.vehicleTakeover?.rider===rider||Math.abs(foot.y-rider.y)>.65) continue;
    if(Math.hypot(center(z)+x-center(rider.z)-rider.x,relativeDistance(z,rider.z))>.60) continue;
    if(!nudgeFormerDriver(rider,dx*1.28,dz*1.28)
      ||Math.hypot(center(z)+x-center(rider.z)-rider.x,relativeDistance(z,rider.z))<.42) blocked=true;
  }
  for(const bike of [state,...traffic]){
    if(bike.model!==4||Math.abs(bike.v)>.75||wreckExpired(bike)||!footHitsCar(z,x,bike)) continue;
    const nextZ=mod(bike.z+dz*.82,LOOP);
    const nextX=center(bike.z)+bike.x+dx*.82-center(nextZ);
    const {halfWidth,halfLength}=vehicleProfile(bike.model);
    const destination={...bike,z:nextZ,x:nextX};
    if(![-halfLength+.10,0,halfLength-.10].every(along=>[-halfWidth*.55,halfWidth*.55]
      .every(across=>actorSpotClear(vehiclePoint(destination,across,along),bike)))) continue;
    const move=moveAcrossTerrain(bike,nextZ,nextX);
    bike.x=move.x;bike.z=move.z;
    if(!move.blocked&&!bike.wreck) bike.roll=clamp(Math.sign(dx||1)*.11,-.11,.11);
  }
  return blocked;
}

export function stepFoot(dx,dz){
  const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.12));
  for(let i=0;i<steps;i++){
    const worldX=center(foot.z)+foot.x;
    const nextZ=mod(foot.z+dz/steps,LOOP);
    const nextX=walkLimit(nextZ,worldX+dx/steps-center(nextZ));
    if(!pushAtFoot(nextZ,nextX,dx/steps,dz/steps)&&!footBlocked(nextZ,nextX)){foot.z=nextZ;foot.x=nextX;continue;}
    const sideX=walkLimit(foot.z,foot.x+dx/steps);
    if(!footBlocked(foot.z,sideX)) foot.x=sideX;
    const forwardX=walkLimit(nextZ,center(foot.z)+foot.x-center(nextZ));
    if(!footBlocked(nextZ,forwardX)){foot.z=nextZ;foot.x=forwardX;}
  }
}

export function walk(dt,elapsed=dt){
  if(foot.fall){
    foot.directionHold=0;foot.running=false;
    const fall=foot.fall;
    recoverRider(fall,dt);
    Object.assign(foot,{z:fall.z,x:fall.x,y:fall.y,vy:fall.vy});
    if(fall.recover===1){
      foot.fall=null;
      foot.angle=fall.angle;
      foot.walkYaw=null;
      foot.recoveryTurn=.38;
      foot.vy=0;
      foot.y=fall.support??terrainHeight(foot.z,foot.x);
      foot.grounded=true;
    }
    return;
  }
  const sideways=walkStick.x+Number(active('right'))-Number(active('left'));
  const forward=walkStick.z+Number(active('gas'))-Number(active('brake'));
  const length=Math.hypot(sideways,forward);
  const inputAngle=Math.atan2(sideways,forward);
  if(length<.12){foot.walkYaw=null;foot.directionHold=0;}
  else if(foot.walkYaw===null||Math.abs(mod(inputAngle-(foot.inputAngle??inputAngle)+Math.PI,TAU)-Math.PI)>.46){
    foot.walkYaw=foot.cameraYaw+viewLook.yaw;
    foot.inputAngle=inputAngle;
    if(!foot.running) foot.directionHold=0;
  }
  if(length>=.12) foot.directionHold=Math.min(2,foot.directionHold+elapsed);
  foot.running=foot.directionHold>=2-1e-8;
  const yaw=foot.walkYaw??foot.cameraYaw+viewLook.yaw;
  const distance=(foot.running?8.0:3.5)*dt/Math.max(1,length);
  const dx=(Math.cos(yaw)*sideways+Math.sin(yaw)*forward)*distance;
  const dz=(Math.cos(yaw)*forward-Math.sin(yaw)*sideways)*distance;
  recoverFootClearance();
  const oldX=center(foot.z)+foot.x,oldZ=foot.z;
  if(length>=.001&&dt>0) stepFoot(dx,dz);
  const movedX=center(foot.z)+foot.x-oldX,movedZ=relativeDistance(oldZ,foot.z);
  const moved=Math.hypot(movedX,movedZ);
  foot.moving=moved>.0001;
  if(foot.moving){
    const wanted=Math.atan2(movedX,movedZ);
    const turn=(mod(wanted-foot.angle+Math.PI,TAU)-Math.PI)*(1-Math.exp(-dt*17));
    foot.angle+=foot.recoveryTurn>0?clamp(turn,-5*dt,5*dt):turn;
    foot.recoveryTurn=Math.max(0,(foot.recoveryTurn??0)-dt);
    const previous=foot.stride;
    const next=previous+moved/(foot.running?1.82:1.22);
    if(foot.grounded&&Math.floor(next*2)!==Math.floor(previous*2))
      leaveSandFootprint(Math.floor(next*2)%2?-1:1);
    foot.stride=mod(next,1);
  }
  if(dt>0){
    const ground=footGround(foot.z,foot.x);
    const nextY=foot.y+foot.vy*dt-5.4*dt*dt;
    const followSurface=foot.grounded&&foot.vy<=0&&foot.y-ground<=.24;
    foot.grounded=foot.vy<=0&&(nextY<=ground||followSurface);
    foot.y=foot.grounded?ground:nextY;
    foot.vy=foot.grounded?0:foot.vy-10.8*dt;
  }
}
