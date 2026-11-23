import { crashSound } from './audio.js';
import { FAR, LANE_WIDTH, LOCAL_LENGTH, LOOP, SOLO_TOP_SPEED, TAU, carColors, carProfile, clamp, hash, lerp, mod, motorcycleProfile, newCharacter, sedanVariants, trafficModels, truckProfile } from './constants.js';
import { footHitsCar, pedestrianGap, placeTakeoverActor, syncVehicleControls, vehicleAction } from './pedestrian.js';
import { center, clampLocalX, clampRoadX, district, exitWidth, limitRailRotation, localOffset, localRoadAt, localWidth, moveAcrossTerrain, passSample, railAt, railIntersectsCar, relativeDistance, roadLocation, slope, solidScenery, stopGap, terrainHeight, vehicleTerrainBlocked, walkLimit } from './route.js';
import { auto, crashDebris, ejectedDrivers, foot, get, labelControl, passHeights, runtime, state, traffic, trafficActors, world } from './runtime.js';

export function trackWheelTravel(car,z,x){
  if(!car.v||car.wreck) return;
  const dx=center(z)+x-center(car.z)-car.x;
  car.wheelTravel=(car.wheelTravel??0)+Math.sign(car.v)*Math.hypot(dx,relativeDistance(car.z,z));
}

export function mountainTruckLane(car,lane){
  const centerline=(lane-1)*LANE_WIDTH;
  return car.model===5&&district(car.z)===2?centerline*.88:centerline;
}

export function mountainTruckPose(car,z,x){
  const span=vehicleProfile(car.model).halfLength;
  const lateral=clamp((car.lateral??0)/Math.max(8,Math.abs(car.v)),-.14,.14);
  const yaw=Math.atan2(center(z+span)-center(z-span)+2*span*lateral,2*span)+(car.yawOffset??0);
  const edge=Math.sign(x);
  for(const inset of [0,.12,.25,.43,.65,.90]){
    const candidate=x-edge*Math.min(Math.abs(x),inset);
    if(!railIntersectsCar(car,z,candidate,yaw)) return {x:candidate,yaw};
  }
  return null;
}

export function advanceCar(car,dt,lateral){
  const old=car.z, oldWorldX=center(old)+car.x;
  const next=mod(old+car.v*dt,LOOP);
  if(car.freeSteering){
    const yaw=car.heading??Math.atan(slope(old));
    const z=mod(old+Math.cos(yaw)*car.v*dt,LOOP);
    const desired=oldWorldX+Math.sin(yaw)*car.v*dt+lateral-center(z);
    const moved=moveAcrossTerrain(car,z,desired);
    trackWheelTravel(car,moved.z,moved.x);
    car.z=moved.z;car.x=moved.x;
    car.local=roadLocation(car);
    if(moved.blocked) car.v*=Math.exp(-dt*8);
    return desired;
  }
  const road=localRoadAt(next);
  let selected=car.local&&car.local===road?road:null;
  const steering=car.steer??0;
  if(car===state&&!foot.active&&road&&car.v>0&&!selected){
    const offset=localOffset(road,next)*road.side;
    const toward=steering*road.side>.28;
    if(toward&&car.x*road.side>=2.8&&offset<11&&car.x*road.side>=offset-3.7)
      selected=road;
  }
  let desired=car.x+lateral;
  if(selected){
    const oldMid=localRoadAt(old)===selected?localOffset(selected,old):selected.side*4.4;
    const mid=localOffset(selected,next);
    desired+=mid-oldMid;
    if(car===state&&!car.local) desired=lerp(desired,mid,1-Math.exp(-dt*2));
    const progress=mod(next-selected.start,LOOP);
    const remaining=car.v<0?progress:LOCAL_LENGTH-progress;
    if(remaining<37){
      const align=clamp((37-remaining)/37,0,1);
      desired=lerp(desired,mid,1-Math.exp(-dt*lerp(0,7.5,align*align)));
    }
    if(car===state&&steering*selected.side<-.35&&Math.abs(mid)<7&&Math.abs(desired)<4.8)
      selected=null;
  }
  let x=selected?clampLocalX(selected,next,desired):clampRoadX(next,desired);
  let reached=next;
  const guidedTruck=car.model===5&&!car.wreck&&!car.parked&&!selected
    &&(car===state?auto.enabled||Math.abs(steering)<.65:!car.freeTerrain)&&district(next)===2
    &&Math.abs(car.x)<4.6&&Math.abs(x)<4.6;
  const pose=guidedTruck?mountainTruckPose(car,next,x):null;
  if(pose){
    x=pose.x;
    car.heading=pose.yaw-(car.yawOffset??0);
  }else if(car===state||car.freeTerrain){
    const moved=moveAcrossTerrain(car,next,desired);
    x=moved.x;reached=moved.z;
    if(moved.blocked){
      car.v*=Math.exp(-dt*8);
      if(Math.abs(car.v)<.18) car.v=0;
      if(car===state) car.hit=Math.max(car.hit,.12);
    }
    if(selected&&Math.abs(x-localOffset(selected,reached))>localWidth(selected,reached)+.45) selected=null;
  }else if(railIntersectsCar(car,reached,x)){
    reached=old;x=car.x;car.v*=Math.exp(-dt*8);
  }
  trackWheelTravel(car,reached,x);
  car.z=reached;
  car.x=x;
  car.local=selected&&localRoadAt(reached)===selected?selected:null;
  const dz=relativeDistance(old,reached);
  if(!pose&&Math.abs(dz)>.01&&dt>0){
    const dx=center(reached)+x-oldWorldX;
    let facing=Math.atan2(dx*Math.sign(dz),Math.abs(dz));
    if(car===state&&auto.enabled){
      const roadYaw=Math.atan(slope(reached));
      facing=roadYaw+clamp(mod(facing-roadYaw+Math.PI,TAU)-Math.PI,-.29,.29);
    }
    const last=car.heading??Math.atan(slope(old));
    const offset=car.yawOffset??0;
    const heading=last+(mod(facing-last+Math.PI,TAU)-Math.PI)*(1-Math.exp(-dt*7.5));
    car.heading=limitRailRotation(car,last+offset,heading+offset)-offset;
  }
  return desired;
}

export function vehicleYaw(z,lateral,speed,road=null) {
  const curve=road&&localRoadAt(z-.5)===road&&localRoadAt(z+.5)===road
    ?localOffset(road,z+.5)-localOffset(road,z-.5):0;
  return Math.atan(slope(z)+curve+clamp(lateral/Math.max(8,Math.abs(speed)),-.35,.35));
}

export function curveSpeed(car,cruise){
  const mountain=district(car.z)===2;
  const fastSolo=runtime.soloDrive&&car===state&&cruise>50;
  const grip=(car.model===5?1.8:2.5)*lerp(1,.72,world.weather[0])*(mountain?.83:1)*(fastSolo&&!mountain?2.15:1);
  const road=car.local;
  const path=z=>center(z)+(road&&localRoadAt(z)===road?localOffset(road,z):0);
  let limit=cruise;
  for(const distance of (fastSolo?[0,8,18,32,50,72,98,130,166,204,244]:mountain?[0,8,18,30,46,67,92]:[0,12,28,52,82])){
    const z=car.z+distance;
    const middle=path(z),before=(middle-path(z-6))/6,after=(path(z+6)-middle)/6;
    const slope=(before+after)*.5;
    // Quy đổi giới hạn gia tốc ngang sang tốc độ dọc theo trục z.
    const curvature=Math.abs(after-before)/(6*Math.hypot(1,slope));
    const grade=mountain?Math.max(0,(passSample(z-6,passHeights)-passSample(z+6,passHeights))/12):0;
    const cornerSpeed=Math.sqrt(grip/(Math.max(.0001,curvature)*(1+grade*.85)));
    const braking=fastSolo?lerp(6.4,4.8,world.weather[0]):mountain?lerp(2.45,1.75,world.weather[0]):3.2;
    limit=Math.min(limit,Math.sqrt(cornerSpeed*cornerSpeed+2*braking*Math.max(0,distance-5)));
  }
  return limit;
}

export function mountainFollowingSpeed(gap,lead){
  const brake=lerp(3.1,2.35,world.weather[0]);
  return Math.sqrt(Math.max(0,lead)**2+2*brake*Math.max(0,gap-7));
}

export function carYaw(car){
  return (car.heading??vehicleYaw(car.z,car.lateral??0,car.v,car.local))+(car.yawOffset??0);
}

// Tra kích thước, tốc độ tuần tra và giới hạn đổi làn theo loại phương tiện.
export function vehicleProfile(model) {
  if(model===4) return motorcycleProfile;
  if(model===5) return truckProfile;
  return sedanVariants[model]??carProfile;
}

// Hiệu chỉnh khoảng cách theo chiều dài thân xe, lấy sedan làm mốc.
export function vehicleGap(distance,fromModel,toModel) {
  return Math.max(0,Math.abs(distance)+2*carProfile.halfLength
    -vehicleProfile(fromModel).halfLength-vehicleProfile(toModel).halfLength);
}

// Tính xung lực va chạm hoặc chỉ kiểm tra giao nhau khi chọn xe mới.
export function carImpact(a,b,testOnly=false){
  if(wreckExpired(a)||wreckExpired(b)) return 0;
  const pa=vehicleProfile(a.model),pb=vehicleProfile(b.model);
  const dz=relativeDistance(a.z,b.z);
  const [ya,yb]=[carYaw(a),carYaw(b)];
  const [sa,sb,ca,cb]=[Math.sin(ya),Math.sin(yb),Math.cos(ya),Math.cos(yb)];
  const az=a.freeSteering?ca*a.v:a.v,bz=b.freeSteering?cb*b.v:b.v;
  const depth=(a.freeSteering?pa.halfLength*Math.abs(ca)+pa.halfWidth*Math.abs(sa):pa.halfLength)
    +(b.freeSteering?pb.halfLength*Math.abs(cb)+pb.halfWidth*Math.abs(sb):pb.halfLength);
  if(Math.abs(dz)>depth) return 0;
  const dx=center(b.z)+b.x-center(a.z)-a.x;
  // Bỏ va chạm giả khi hai xe ở làn khác nhau tại một đoạn cua.
  const aligned=Math.abs(sa*sb+ca*cb),crossed=Math.abs(sa*cb-ca*sb);
  if(Math.abs(dx*ca-dz*sa)>=pa.halfWidth+pb.halfWidth*aligned+pb.halfLength*crossed
    ||Math.abs(dx*sa+dz*ca)>=pa.halfLength+pb.halfLength*aligned+pb.halfWidth*crossed
    ||Math.abs(dx*cb-dz*sb)>=pb.halfWidth+pa.halfWidth*aligned+pa.halfLength*crossed
    ||Math.abs(dx*sb+dz*cb)>=pb.halfLength+pa.halfLength*aligned+pa.halfWidth*crossed) return 0;
  if(testOnly) return 1;
  const span=(a.freeSteering?pa.halfWidth*Math.abs(ca)+pa.halfLength*Math.abs(sa):pa.halfWidth)
    +(b.freeSteering?pb.halfWidth*Math.abs(cb)+pb.halfLength*Math.abs(sb):pb.halfWidth);
  const width=span-Math.abs(dx);
  if(width<=0) return 0;
  const length=depth-Math.abs(dz);
  const lateral=width<length&&(Math.abs(dx)>.47*span||Math.abs(az-bz)<2);
  const nx=lateral?(dx<0?-1:1):0,nz=lateral?0:(dz<0?-1:1);
  const ma=1/pa.mass,mb=1/pb.mass;
  const ax=(a.freeSteering?sa*a.v:(a.lateral??0)+slope(a.z)*a.v)+(a.slide??0);
  const bx=(b.freeSteering?sb*b.v:(b.lateral??0)+slope(b.z)*b.v)+(b.slide??0);
  const closing=(ax-bx)*nx+(az-bz)*nz;
  const fix=Math.max(0,(lateral?width:length)-.025)*.76/(ma+mb);
  for(const [car,sign,mass] of [[a,-1,ma],[b,1,mb]]){
    const oldZ=car.z;
    const nextZ=mod(oldZ+sign*nz*fix*mass,LOOP);
    const nextX=center(oldZ)+car.x-center(nextZ)+sign*nx*fix*mass;
    if(car===state||car.freeTerrain){
      const p=moveAcrossTerrain(car,nextZ,nextX);
      car.z=p.z;car.x=p.x;
    }else{
      const clamped=clampRoadX(nextZ,nextX);
      if(!railIntersectsCar(car,nextZ,clamped)){car.z=nextZ;car.x=clamped;}
    }
  }
  if(closing<=0) return 0;
  const impulse=1.16*closing/(ma+mb);
  for(const [car,sign,mass] of [[a,-1,ma],[b,1,mb]]){
    const yaw=carYaw(car);
    const driveAxis=car.freeSteering?nx*Math.sin(yaw)+nz*Math.cos(yaw):nz;
    car.v=clamp(car.v+sign*driveAxis*impulse*mass,car===state?-9:0,50);
    car.slide=clamp((car.slide??0)+sign*nx*impulse*mass,-12,12);
    const arm=lateral?clamp(dz*.45,-1.8,1.8):clamp(dx*.7,-1,1);
    car.spin=clamp((car.spin??0)+sign*impulse*mass*arm*.22,-2.8,2.8);
    car.roll=clamp((car.roll??0)-sign*nx*impulse*mass*.012,-.16,.16);
    const kick=impulse*mass;
    damageVehicle(car,kick,closing);
    recordCrash(car,-sign*nx,-sign*nz,kick,closing);
    const ai=car!==state&&!car.parked;
    if(car.model===4&&!car.wreck&&kick>(ai?2.9:3.8)) tipMotorcycle(car,sign*nx,sign*nz,kick);
    else if(!car.wreck&&car.model!==4&&kick>(ai?5.2:6.9)&&(lateral||Math.abs(arm)>.48||kick>12)){
      const across=sign*(nx*Math.cos(yaw)-nz*Math.sin(yaw));
      const along=sign*(nx*Math.sin(yaw)+nz*Math.cos(yaw));
      const signRoll=Math.sign(across||arm||sign);
      car.wreck={sign:signRoll,roll:0,spin:signRoll*(4.5+kick*.48)*(.77+Math.abs(across)*.23),
        pitch:0,pitchV:along*kick*.38+arm*.7,y:0,vy:clamp(kick*.24,1.55,6.2)};
    }
  }
  if(closing>3&&Math.abs(relativeDistance(state.z,a.z))<42) crashSound(closing);
  return closing;
}

export function recordCrash(car,nx,nz,kick,closing){
  if(kick<2.5||closing<3) return;
  const yaw=carYaw(car);
  const across=nx*Math.cos(yaw)-nz*Math.sin(yaw);
  const along=nx*Math.sin(yaw)+nz*Math.cos(yaw);
  const crash=car.crash??={front:0,rear:0,left:0,right:0,pitch:0,pitchV:0,hop:0,hopV:0};
  const side=Math.abs(across)>Math.abs(along);
  const zone=side?(across>0?'right':'left'):(along>0?'front':'rear');
  const dent=clamp((kick-2)*.028,.01,.48);
  crash[zone]=Math.min(.65,crash[zone]+dent);
  crash.pitchV=clamp(crash.pitchV+along*kick*.15,-3.4,3.4);
  if(kick<7) return;
  crash.hopV=Math.max(crash.hopV,Math.min(3.1,kick*.17));
  const profile=vehicleProfile(car.model);
  const z=mod(car.z+nz*profile.halfLength*.83,LOOP);
  const x=car.x+center(car.z)-center(z)+nx*profile.halfWidth*.83;
  const y=terrainHeight(z,x)+Math.min(profile.roof,.9);
  const count=Math.min(9,Math.floor(kick*.57));
  for(let i=0;i<count;i++){
    const angle=Math.random()*TAU;
    const speed=1.5+Math.random()*Math.min(8,kick*.35);
    if(crashDebris.length>=96) crashDebris.shift();
    crashDebris.push({z,x,y,vx:-nx+Math.cos(angle)*speed,vz:car.v*.26-nz+Math.sin(angle)*speed,
      vy:1.1+Math.random()*Math.min(5,kick*.36),size:i===0?.28:.055+Math.random()*.1,
      angle,spin:(Math.random()-.5)*16,age:0,life:1.3+Math.random()*1.5,color:i%3===0?car.color:i%3===1?'#8796a3':'#252b37'});
  }
}

export function stepCrashDebris(dt){
  for(let i=crashDebris.length-1;i>=0;i--){
    const part=crashDebris[i];
    part.age+=dt;
    if(part.age>=part.life){crashDebris.splice(i,1);continue;}
    const z=mod(part.z+part.vz*dt,LOOP);
    part.x+=center(part.z)-center(z)+part.vx*dt;
    part.z=z;
    part.angle+=part.spin*dt;
    part.vy-=9.81*dt;
    part.y+=part.vy*dt;
    const floor=terrainHeight(z,part.x)+part.size*.24;
    if(part.y>floor) continue;
    part.y=floor;
    part.vy=part.vy<-1.25?-part.vy*.3:0;
    const drag=Math.exp(-dt*7);
    part.vx*=drag;part.vz*=drag;part.spin*=drag;
  }
}

export function damageVehicle(car,kick,closing){
  if(runtime.soloDrive&&car===state||closing<2.3||car.damage?.stage==='exploded') return;
  const health=car.damage??={score:0,stage:'intact',stamp:world.time,seed:mod(car.z,LOOP)*.11+car.model*13};
  health.score=Math.min(130,health.score+kick*kick*.16+closing*.30);
  const ai=car!==state&&!car.parked;
  const stage=health.score>=(ai?58:84)?'fire':health.score>=(ai?23:35)?'smoke':'intact';
  if(stage==='fire'&&health.stage!=='fire'){
    health.stamp=world.time;
    health.explodeAt=world.time+2.8;
  }
  if(stage==='smoke'&&health.stage==='intact') health.stamp=world.time;
  health.stage=stage;
}

export function updateVehicleDamage(car){
  const damage=car.damage;
  if(damage?.stage!=='fire'||world.time<damage.explodeAt) return;
  damage.stage='exploded';damage.stamp=world.time;
  car.v*=.35;
  if(!car.wreck){
    car.wreck={sign:1,roll:0,spin:1.2,y:0,vy:1.85,blastOnly:true};
  }else car.wreck.vy=Math.max(1.85,car.wreck.vy);
}

export function scorchAmount(car){
  if(car.damage?.stage!=='exploded') return 0;
  return clamp((world.time-car.damage.stamp)/.62,0,1);
}

export function damageParticles(car,z,visit){
  if(wreckExpired(car)) return;
  const damage=car.damage;
  if(!damage||damage.stage==='intact') return;
  const since=Math.max(0,world.time-damage.stamp),yaw=carYaw(car);
  const forward=vehicleProfile(car.model).halfLength*.59;
  const hz=z+Math.cos(yaw)*forward;
  const hx=center(z)+car.x+Math.sin(yaw)*forward;
  const base=terrainHeight(z,car.x)+(car.wreck?.y??0)+.71;
  const seed=damage.seed??0;
  const exploded=damage.stage==='exploded',burning=damage.stage==='fire';
  const burst=exploded&&since<.85;
  for(let i=0;i<(burning||exploded?12:7);i++){
    const p=mod(world.time*(burning?.64:.43)+hash(i+31),1);
    const sway=Math.sin(world.time*1.12+i*1.7+seed);
    const spread=.24+p*(exploded?2.5:1.50);
    visit(hx+sway*spread+p*p*.72,base+p*(exploded?6.7:4.2),hz+(hash(i+90)-.5)*spread*2,
      .24+p*(exploded?1.42:.93),exploded?'#33313a':'#656672',(.38-.31*p)*Math.min(1,since*2.6));
  }
  if(burning||burst) for(let i=0;i<10;i++){
    const phase=mod(world.time*3.4+hash(i+17),1);
    const p=burst?since/.85:phase;
    const radius=burst?.18+p*(2.4+hash(i+53)*2):.36+p*.55;
    const angle=hash(i+71)*TAU;
    const scale=burst?.28+p*.78:.22+.38*(1-p);
    visit(hx+Math.cos(angle)*radius,base+.23+(burst?p*3.1:phase*1.35),hz+Math.sin(angle)*radius,
      scale,i%3===0?'#ffe18a':i%2===0?'#ffaf4b':'#ed6234',(1-p)*(burst?.92:.66));
  }
}

export function wreckExpired(car){
  if(car.damage?.stage==='exploded') return world.time-car.damage.stamp>=5;
  if(car.wreck?.dismount&&car.damage?.stage!=='fire') return false;
  if(car.model===4&&car.wreck?.rider&&car.damage?.stage!=='fire'&&world.time-car.wreck.since<25) return false;
  return (car.wreck?.sideTime??0)>=5-1e-8;
}

export function clearExpiredWrecks(){
  for(let i=traffic.length-1;i>=0;i--){
    if(wreckExpired(traffic[i])) traffic.splice(i,1);
  }
  if(!wreckExpired(state)||foot.active) return;
  vehicleAction();
  if(!foot.active){
    setAutopilot(false);
    const angle=carYaw(state);
    Object.assign(foot,{active:true,z:state.z,x:state.x,y:terrainHeight(state.z,state.x),
      angle,cameraYaw:angle,vy:0,fall:null,grounded:true,moving:false,stride:0});
    state.target=1;
    syncVehicleControls();
  }
}

export function engineBlocked(car){
  return car.damage?.stage==='exploded';
}

// Thân mô tô và người lái có vận tốc, trọng lực và ma sát riêng sau va chạm.
export function motorcyclePassenger(model,random=Math.random){
  return model===4&&random()<.39?newCharacter(random):null;
}

export function carPassengers(model,random=Math.random){
  if(model<0||model>3) return [];
  return [.53,.33,.17].map(chance=>random()<chance?newCharacter(random):null);
}

export function drivingLook(car){return car===state?foot.look:car.driver??foot.look;}

export function tipMotorcycle(car,nx,nz,kick){
  const sign=Math.sign(nx||car.spin||1);
  const speed=clamp(kick,5,19);
  const rider={source:car,z:car.z,x:car.x+sign*.36,y:1.18,vy:2.8+speed*.19,
    vx:clamp(nx*speed*.65+sign*1.8,-12,12),vz:clamp(car.v*.67+nz*speed*.25,-6,20),
    look:drivingLook(car),impact:speed,angle:carYaw(car),tilt:.18,spin:sign*(3.5+speed*.14),age:0};
  const driven=car===state;
  const passenger=car.passenger&&!car.parked?{...rider,look:car.passenger,
    z:mod(car.z-.68,LOOP),x:car.x-sign*.22,vy:rider.vy*.92,vx:rider.vx*.88,
    vz:rider.vz*.85,spin:-rider.spin*.88}:null;
  car.wreck={since:world.time,sign,roll:0,spin:sign*(4.4+speed*.22),y:0,vy:Math.min(3.6,speed*.19),rider:driven||car.parked?null:rider,passenger};
  car.v=Math.min(car.v,12);
  if(driven&&!foot.active){
    runtime.previousCamera=state.target;
    setAutopilot(false);
    Object.assign(foot,rider,{active:true,grounded:false,cameraYaw:rider.angle,moving:false,stride:0,fall:rider});
    state.target=1;
    showCameraPanel(false);
    syncVehicleControls();
  }
}

export function riderBlocked(z,x,y){
  const side=Math.sign(x);
  if(walkLimit(z,x)!==x) return true;
  if(y<.68&&railAt(z,side)&&Math.abs(Math.abs(x)-6-exitWidth(z,side))<.24) return true;
  return solidScenery(z,x,.25,y);
}

// Kiểm tra cả hai đầu thân đang nghiêng để tránh xuyên lan can hoặc xe khác.
export function fallenBodyBlocked(rider,z,x,y){
  const scale=rider.look?.scale??1,tilt=rider.tilt??0;
  const baseX=center(z)+x;
  for(const end of [-.73,0,.73]){
    const along=Math.sin(tilt)*end*scale;
    const at=mod(z+Math.cos(rider.angle)*along,LOOP);
    const offset=baseX+Math.sin(rider.angle)*along-center(at);
    const height=y+(rider.low?0:Math.cos(tilt)*end*scale);
    if(riderBlocked(at,offset,height)) return true;
    for(const car of [state,...traffic]){
      if(car===rider.source&&rider.age<.45) continue;
      if(height<terrainHeight(car.z,car.x)+vehicleProfile(car.model).roof
        &&footHitsCar(at,offset,car)) return true;
    }
  }
  return false;
}

export function fallenSupport(rider){
  let support=terrainHeight(rider.z,rider.x);
  const bottom=rider.y-(rider.low?0:Math.abs(Math.cos(rider.tilt))*.80*(rider.look?.scale??1));
  for(const car of [state,...traffic]){
    const top=terrainHeight(car.z,car.x)+vehicleProfile(car.model).roof;
    if(bottom>=top-.12&&footHitsCar(rider.z,rider.x,car)) support=Math.max(support,top);
  }
  return support;
}

export function recoverRider(rider,dt){
  if(rider.recover===undefined){
    stepRider(rider,dt);
    const ready=rider.low?.62:1.0+(rider.launchSpeed??12)*.028;
    if(rider.age>=ready&&rider.vy===0&&Math.hypot(rider.vx,rider.vz)<.9){
      rider.recover=0;rider.restTilt=mod(rider.tilt+Math.PI,TAU)-Math.PI;rider.restY=rider.y;
    }
    return;
  }
  rider.age+=dt;
  rider.recover=Math.min(1,rider.recover+dt/(rider.low?.42:1.24));
  const t=rider.recover,scale=rider.look?.scale??1;
  const pivot=clamp(t/.46,0,1),rise=clamp((t-.46)/.54,0,1);
  rider.tilt=rider.low?lerp(rider.restTilt,0,t):
    lerp(lerp(rider.restTilt,Math.sign(rider.restTilt)*.27,pivot*pivot*(3-2*pivot)),0,rise*rise*(3-2*rise));
  const base=rider.support??terrainHeight(rider.z,rider.x);
  rider.y=rider.low?base:lerp(lerp(rider.restY,base+.43*scale,pivot),base+.82*scale,rise);
}

export function moveFallenRider(rider,dt){
  const steps=Math.max(1,Math.ceil(Math.hypot(rider.vx,rider.vz)*dt/.14));
  const slice=dt/steps;
  for(let i=0;i<steps;i++){
    const x=rider.x+rider.vx*slice;
    const z=mod(rider.z+rider.vz*slice,LOOP);
    const offset=center(rider.z)-center(z);
    const y=rider.y+rider.vy*slice;
    if(!fallenBodyBlocked(rider,z,x+offset,y)){rider.x=x+offset;rider.z=z;continue;}
    const hitX=fallenBodyBlocked(rider,rider.z,x,y),hitZ=fallenBodyBlocked(rider,z,rider.x+offset,y);
    const corner=!hitX&&!hitZ;
    const impact=Math.hypot(hitX||corner?rider.vx:0,hitZ||corner?rider.vz:0);
    if(hitX||corner) rider.vx*=-.38;
    else rider.x=x;
    if(hitZ||corner) rider.vz*=-.38;
    else{rider.x+=offset;rider.z=z;}
    if(impact>2&&!rider.low){
      rider.vy=Math.max(rider.vy,Math.min(2.4,impact*.16));
      rider.spin=clamp(rider.spin+Math.sign(rider.spin||1)*impact*.25,-15,15);
    }
  }
}

export function stepRider(rider,dt){
  rider.age+=dt;
  moveFallenRider(rider,dt);
  const support=fallenSupport(rider);
  const floor=support+Math.max(.22,Math.abs(Math.cos(rider.tilt))*.82*(rider.look?.scale??1));
  rider.support=support;
  rider.y+=rider.vy*dt-5.4*dt*dt;
  rider.vy-=10.8*dt;
  const previousTilt=rider.tilt;
  rider.tilt+=rider.spin*dt;
  if(!rider.low&&Math.abs(rider.spin)>.15&&fallenBodyBlocked(rider,rider.z,rider.x,rider.y)){
    rider.tilt=previousTilt;
    rider.spin*=-.25;
  }
  if(rider.low){
    rider.y=support;
    rider.vy=0;
    rider.vx*=Math.exp(-dt*3.2);rider.vz*=Math.exp(-dt*3.2);
    rider.tilt=(rider.startingTilt??0)*Math.exp(-rider.age*5)+Math.sin(rider.age*12)*Math.exp(-rider.age*2.25)*.47;
    return;
  }
  if(rider.y<=floor){
    if(!rider.contacts) rider.contactAt=rider.age;
    rider.contacts=(rider.contacts??0)+1;
    rider.y=floor;
    rider.vy=rider.vy<-3?-rider.vy*.18:0;
    const friction=rider.launchSpeed?Math.max(1.65,4.5-rider.launchSpeed*.075):4.2;
    rider.vx*=Math.exp(-dt*friction);rider.vz*=Math.exp(-dt*friction);
    rider.spin*=Math.exp(-dt*5);
    const rest=Math.sign(Math.sin(rider.tilt)||1)*Math.PI/2;
    rider.tilt+=(mod(rest-rider.tilt+Math.PI,TAU)-Math.PI)*(1-Math.exp(-dt*6));
  }
}

export function wreckClearance(car){
  const {roll,pitch=0}=car.wreck;
  const {roof,halfWidth,halfLength}=vehicleProfile(car.model);
  const lean=Math.cos(roll),tilt=Math.cos(pitch);
  const height=(lean>=0?.35:roof-.35)*Math.abs(lean)+halfWidth*.94*Math.abs(Math.sin(roll));
  return Math.max(0,height*tilt+halfLength*.83*Math.abs(Math.sin(pitch))-.35);
}

export function stepWreck(car,dt){
  const wreck=car.wreck;
  if(wreck.dismount&&Math.abs(wreck.roll)<Math.PI/2){
    wreck.spin=wreck.sign*Math.max(wreck.spin*wreck.sign,1.2);
    wreck.roll=wreck.sign*Math.min(Math.PI/2,Math.abs(wreck.roll)+Math.abs(wreck.spin)*dt);
    if(Math.abs(wreck.roll)===Math.PI/2) wreck.spin=0;
  }else if(!wreck.dismount) wreck.roll+=wreck.spin*dt;
  if(wreck.pitchV!==undefined){
    wreck.pitchV=(wreck.pitchV-wreck.pitch*dt*10)*Math.exp(-dt*1.5);
    wreck.pitch=clamp(wreck.pitch+wreck.pitchV*dt,-.78,.78);
  }
  wreck.y+=wreck.vy*dt-5.4*dt*dt;
  wreck.vy-=10.8*dt;
  const floor=wreckClearance(car);
  if(wreck.y<=floor){
    wreck.y=floor;
    const tumbling=car.model!==4&&!wreck.blastOnly&&Math.abs(wreck.spin)>3.4;
    wreck.vy=wreck.vy<-2?-wreck.vy*(tumbling?.40:.23):0;
    if(tumbling) wreck.vy=Math.max(wreck.vy,Math.abs(wreck.spin)*.17);
    wreck.spin*=Math.exp(-dt*(tumbling?3.1:4.3));
    if(!tumbling){
      const {halfWidth,roof}=vehicleProfile(car.model);
      const roll=wreck.roll,sin=Math.sin(roll),cos=Math.cos(roll);
      const support=halfWidth*.94*Math.sign(sin)*cos-(cos>=0?.35:roof-.35)*Math.sign(cos)*sin;
      wreck.spin-=9.81*support*dt/(halfWidth*halfWidth+.35);
      const stable=Math.round(roll/(Math.PI/2))*Math.PI/2;
      if(Math.abs(roll-stable)<.025&&Math.abs(wreck.spin)<.45){
        wreck.roll=stable;wreck.spin=0;
        if(car.model!==4&&Math.cos(stable)>.99&&Math.abs(wreck.pitch??0)<.06&&!engineBlocked(car)&&car.damage?.stage!=='fire')
          car.wreck=null;
      }
      if(wreck.pitchV!==undefined) wreck.pitchV*=Math.exp(-dt*4);
      wreck.y=car.wreck?wreckClearance(car):0;
    }
    car.v*=Math.exp(-dt*3.4);
  }
  const overturned=car.wreck&&Math.cos(wreck.roll)<.36&&Math.abs(wreck.spin)<1.1
    &&Math.abs(wreck.vy)<1&&wreck.y<=wreckClearance(car)+.12;
  wreck.sideTime=overturned?(wreck.sideTime??0)+dt:0;
  advanceCar(car,dt,(car.slide??0)*dt);
  settleCar(car,dt);
  for(const seat of ['rider','passenger']){
    if(!wreck[seat]) continue;
    if(wreck[seat].recover!==1){
      recoverRider(wreck[seat],dt);
      if(wreck[seat].recover===1) standingPosition(wreck[seat]);
    }
    if(wreck[seat].age>14&&seat==='passenger') wreck[seat]=null;
  }
}

// Lấy vị trí ghế, cửa hoặc điểm cạnh xe theo hướng thân xe.
export function vehiclePoint(car,across,along){
  const yaw=carYaw(car),sin=Math.sin(yaw),cos=Math.cos(yaw);
  const z=mod(car.z+along*cos-across*sin,LOOP);
  return {z,x:center(car.z)+car.x+across*cos+along*sin-center(z)};
}

export function standingPosition(person){
  person.y=terrainHeight(person.z,person.x);
  person.grounded=true;
}

export function stepReturningRider(car,dt){
  const wreck=car.wreck;
  const driver=wreck.rider;
  if(!driver||engineBlocked(car)||car.damage?.stage==='fire'||world.time-wreck.since>=25) return false;
  if(wreck.righting!==undefined){
    wreck.righting=Math.min(1,wreck.righting+dt/1.19);
    wreck.roll=lerp(wreck.startRoll,Math.round(wreck.startRoll/TAU)*TAU,clamp(wreck.righting/.62,0,1));
    wreck.y=wreckClearance(car);
    driver.actionReach=.9*(1-wreck.righting);
    if(wreck.righting>.62){
      const mount=clamp((wreck.righting-.62)/.38,0,1);
      placeTakeoverActor(driver,wreck.mountStart,vehiclePoint(car,0,-.10),mount);
      driver.actionCrouch=mount;
      driver.y+=mount*.30;
    }
    if(wreck.righting===1){
      car.passenger=null;
      if(wreck.passenger){
        const passenger=wreck.passenger;
        if(passenger.recover===1) standingPosition(passenger);
        passenger.leftAt=world.time;
        ejectedDrivers.push(passenger);
      }
      Object.assign(car,{wreck:null,roll:0,spin:0,slide:0,lateral:0,v:0,brake:false,cooldown:1});
    }
    return true;
  }
  if(driver.recover!==1||Math.abs(car.v)>.35||Math.abs(wreck.vy)>.4||Math.abs(wreck.spin)>.45) return false;
  const yaw=carYaw(car),dz=relativeDistance(car.z,driver.z);
  const dx=center(driver.z)+driver.x-center(car.z)-car.x;
  const side=Math.sign(dx*Math.cos(yaw)-dz*Math.sin(yaw))||wreck.sign;
  const distance=vehicleProfile(car.model).halfWidth+.55;
  const spot=[side,-side].map(s=>vehiclePoint(car,s*distance,0))
    .find(p=>!riderBlocked(p.z,p.x,terrainHeight(p.z,p.x)+.15));
  if(!spot) return false;
  const zGap=relativeDistance(driver.z,spot.z);
  const xGap=center(spot.z)+spot.x-center(driver.z)-driver.x;
  const gap=Math.hypot(xGap,zGap);
  standingPosition(driver);
  driver.moving=false;
  if(gap<.24){
    wreck.startRoll=wreck.roll;
    wreck.mountStart={z:driver.z,x:driver.x};
    wreck.righting=0;
    driver.angle=yaw-side*Math.PI/2;
    return true;
  }
  const step=Math.min(gap,2.7*dt);
  const dxStep=xGap/gap*step,dzStep=zGap/gap*step;
  for(const [x,z] of [[dxStep,dzStep],[dxStep,0],[0,dzStep]]){
    if(Math.hypot(x,z)<.001) continue;
    const nextZ=mod(driver.z+z,LOOP),nextX=center(driver.z)+driver.x+x-center(nextZ);
    if(riderBlocked(nextZ,nextX,driver.y+.15)||[state,...traffic].some(other=>footHitsCar(nextZ,nextX,other))) continue;
    driver.z=nextZ;driver.x=nextX;
    driver.angle=Math.atan2(x,z);
    driver.stride=mod((driver.stride??0)+step/1.22,1);
    driver.moving=true;
    standingPosition(driver);
    break;
  }
  return true;
}

export function settleCar(car,dt){
  const crash=car.crash;
  if(crash){
    crash.pitchV=(crash.pitchV-crash.pitch*dt*44)*Math.exp(-dt*6);
    crash.pitch=clamp(crash.pitch+crash.pitchV*dt,-.31,.31);
    if(crash.hop>0||crash.hopV>0){
      crash.hopV-=11*dt;
      crash.hop=Math.max(0,crash.hop+crash.hopV*dt);
      if(crash.hop===0) crash.hopV=0;
    }
  }
  car.slide=(car.slide??0)*Math.exp(-dt*3.3);
  car.roll=(car.roll??0)*Math.exp(-dt*4.7);
  car.spin=((car.spin??0)-(car.yawOffset??0)*dt*8)*Math.exp(-dt*3.4);
  const oldOffset=car.yawOffset??0;
  const offset=clamp(oldOffset+car.spin*dt,-.55,.55);
  const yaw=carYaw(car);
  const safe=limitRailRotation(car,yaw,yaw+offset-oldOffset);
  car.yawOffset=oldOffset+safe-yaw;
  if(Math.abs(car.yawOffset-offset)>.001) car.spin*=.3;
}

// Chọn tốc độ theo loại xe, làn và thói quen riêng của tài xế.
function trafficCruise(lane,model,randomValue){
  return (19+lane*3.4+randomValue*12)*vehicleProfile(model).cruise;
}

// Tạo dòng xe gồm ô tô, mô tô và xe tải trên ba làn, mỗi loại có tốc độ phù hợp.
export function seedTraffic(avoid=null) {
  if(runtime.soloDrive||!runtime.maxTraffic) return;
  let count=traffic.filter(car=>!car.parked).length;
  const spacing=LOOP/runtime.maxTraffic;
  const start=avoid?avoid.z+spacing/2:17;
  // Thử cả khoảng giữa hai vị trí khi lấp thêm xe vào luồng hiện tại.
  for(let i=0;i<runtime.maxTraffic*2&&count<runtime.maxTraffic;i++){
    const lane=i%3, model=trafficModels[i%trafficModels.length];
    const cruise=trafficCruise(lane,model,hash(i+10));
    const z=mod(start+i*spacing+(i>=runtime.maxTraffic?spacing*.5:0)+(hash(i)-.5)*34,LOOP);
    if(avoid&&Math.abs(relativeDistance(z,avoid.z))<55) continue;
    if(traffic.some(car=>Math.abs(relativeDistance(z,car.z))<22)) continue;
    traffic.push({z,x:(lane-1)*LANE_WIDTH,lane,model,
      v:cruise,cruise,driver:newCharacter(),passenger:motorcyclePassenger(model),occupants:carPassengers(model),takesExit:i%4!==1,color:carColors[i%carColors.length],brake:false,cooldown:0});
    count++;
  }
}

// Tái sử dụng xe ngoài tầm nhìn và chỉ cho xe mới xuất hiện sau người chơi ở làn đủ khoảng trống.
export function spawnBehind(dt) {
  if(runtime.soloDrive) return;
  runtime.spawnTimer-=dt;
  if(runtime.spawnTimer>0) return;
  runtime.spawnTimer=1.6;
  const car=traffic.find(candidate=>candidate!==runtime.vehicleTakeover?.car&&!candidate.wreck&&!candidate.parked&&relativeDistance(state.z,candidate.z)<-FAR-165);
  if(!car) return;
  const z=mod(state.z-(82+hash(runtime.spawnIndex+43)*38),LOOP);
  for(let offset=0;offset<3;offset++){
    const lane=(runtime.spawnIndex+offset)%3, x=(lane-1)*LANE_WIDTH;
    // Tính cả làn đích của xe đang chuyển làn như một phần không gian đã có xe.
    if(traffic.some(other=>other!==car&&vehicleGap(relativeDistance(z,other.z),car.model,other.model)<33
      &&(Math.abs(x-other.x)<1.74+vehicleProfile(other.model).halfWidth||other.lane===lane))) continue;
    car.z=z;car.x=x;car.lane=lane;car.nextHornAt=0;car.reactAfter=0;car.lastComplaint=undefined;car.jam=null;car.waiting=0;car.wheelTravel=0;car.wreck=null;car.damage=null;car.crash=null;car.local=null;car.heading=null;car.driver=newCharacter();car.passenger=motorcyclePassenger(car.model);car.occupants=carPassengers(car.model);
    car.cruise=trafficCruise(lane,car.model,hash(runtime.spawnIndex+73));
    car.takesExit=hash(runtime.spawnIndex+83)<.64;
    car.v=Math.min(car.cruise,Math.max(8,state.v+3));
    car.cooldown=1.2;car.brake=false;
    runtime.spawnIndex++;runtime.spawnTimer=6+hash(runtime.spawnIndex)*3;
    return;
  }
}

// Quét các làn với khoảng trống theo thân xe, rồi chọn tốc độ hoặc làn an toàn.
export function planTraffic(car,dt) {
  if(car.parked||car.wreck){car.targetSpeed=0;return;}
  const road=localRoadAt(car.z);
  if(!road) car.local=null;
  if(!car.local&&road&&mod(car.z-road.start,LOOP)<32
    &&car.lane===1+road.side&&car.takesExit) car.local=road;
  if(car.local){
    car.jam=null;car.waiting=0;
    const gap=stopGap(car,car.local);
    let target=Math.min(curveSpeed(car,12),Math.sqrt(11*Math.max(0,gap-.2)));
    for(const peer of trafficActors){
      const d=relativeDistance(car.z,peer.z);
      if(peer===car||d<=0||d>32||Math.abs(car.x-peer.x)>2.5) continue;
      target=Math.min(target,Math.max(0,peer.v+(d-7)*.7));
    }
    car.targetSpeed=Math.min(target,Math.sqrt(11*Math.max(0,pedestrianGap(car)-1.35)));
    return;
  }
  const ahead=[100,100,100], behind=[-100,-100,-100];
  const frontSpeed=[0,0,0], backSpeed=[0,0,0], truckAhead=[false,false,false];
  for(const other of trafficActors){
    if(other===car) continue;
    const d=relativeDistance(car.z,other.z);
    if(Math.abs(d)>100) continue;
    // Xe đang chuyển làn giữ chỗ ở cả làn hiện tại và làn đích.
    const projected=other===state?clampRoadX(state.z,state.x+state.lateral*.65):other.x;
    const corridor=1.59+vehicleProfile(other.model).halfWidth;
    const gap=vehicleGap(d,car.model,other.model);
    for(let lane=0;lane<3;lane++){
      if(Math.abs(projected-(lane-1)*LANE_WIDTH)>corridor
        &&Math.abs(other.x-(lane-1)*LANE_WIDTH)>corridor&&other.lane!==lane&&other.jam?.lane!==lane) continue;
      if(d>=0&&gap<ahead[lane]){ahead[lane]=gap;frontSpeed[lane]=other.v;truckAhead[lane]=other.model===5;}
      if(d<0&&-gap>behind[lane]){behind[lane]=-gap;backSpeed[lane]=other.v;}
    }
  }
  car.cooldown=Math.max(0,car.cooldown-dt);
  const lane=car.lane,x=(lane-1)*LANE_WIDTH;
  const playerDistance=relativeDistance(car.z,state.z);
  const playerGap=vehicleGap(playerDistance,car.model,state.model);
  const playerX=clampRoadX(state.z,state.x+state.lateral*.65);
  const playerInLane=Math.abs(playerX-x)<2.55||Math.abs(state.x-x)<2.55;
  // Chỉ đổi làn né người chơi nếu người chơi ở phía trước trong hành lang sắp chạy.
  const playerAhead=playerDistance>0&&playerGap<=ahead[lane]&&playerInLane
    &&playerGap<10+Math.max(0,car.v-state.v)*1.6;
  const mountain=district(car.z)===2;
  const bendLimit=curveSpeed(car,mountain?29:car.cruise);
  const jammed=Math.abs(car.v)<.85&&ahead[lane]<12&&frontSpeed[lane]<3;
  car.waiting=jammed?(car.waiting??0)+dt:0;
  const roomInLane=next=>ahead[next]>13+Math.max(0,car.v-frontSpeed[next])*1.05
    &&-behind[next]>11+Math.max(0,backSpeed[next]-car.v)*1.15;
  // Xe có lịch rẽ chọn trước làn của nhánh trái hoặc phải nếu có khoảng trống.
  const exitRoad=car.takesExit?(road??localRoadAt(car.z+48)):null;
  if(exitRoad&&!car.jam&&!car.cooldown&&Math.abs(car.x-x)<.65){
    const exitLane=1+exitRoad.side;
    const next=lane+Math.sign(exitLane-lane);
    if(next!==lane&&roomInLane(next)){
      car.lane=next;
      car.cooldown=.7;
    }
  }
  const rearClear=-behind[lane]>17+Math.max(0,backSpeed[lane])*1.10
    &&(!foot.active||Math.abs(relativeDistance(car.z,foot.z))>12||Math.abs(car.x-foot.x)>2.5);
  if(car.jam){
    const maneuver=car.jam;
    maneuver.time+=dt;
    if(rearClear&&roomInLane(maneuver.lane)&&maneuver.time<3.8
      &&relativeDistance(maneuver.start,car.z)>-4.8){
      car.targetSpeed=-2;
      return;
    }
    if(car.v<-.1){car.targetSpeed=0;return;}
    if(roomInLane(maneuver.lane)) car.lane=maneuver.lane;
    car.jam=null;car.cooldown=2.8;
  // Xe nhanh có thể chuyển làn qua xe chậm khi cả phía trước và phía sau đều thoáng.
  }else if((playerAhead&&(!mountain||bendLimit>=24)||car.waiting>(mountain?2.5:1.2)
    ||!mountain&&!road&&ahead[lane]<27&&frontSpeed[lane]+4<car.cruise)&&!car.cooldown&&Math.abs(car.x-x)<.72){
    const candidate=[lane-1,lane+1].filter(next=>next>=0&&next<=2&&roomInLane(next))
      .sort((a,b)=>ahead[b]-ahead[a])[0];
    if(candidate!==undefined){
      if(ahead[lane]<8.5&&rearClear){
        car.jam={start:car.z,lane:candidate,time:0};
        car.targetSpeed=-2;
        return;
      }
      car.lane=candidate;car.cooldown=3.5;
    }
  }
  // Vẫn phanh theo làn đang chiếm cho đến khi thân xe ra khỏi vùng chồng lấn.
  let target=Math.min(car.cruise,bendLimit);
  for(let occupied=0;occupied<3;occupied++){
    if(occupied!==car.lane&&Math.abs(car.x-(occupied-1)*LANE_WIDTH)>2.05) continue;
    const gap=ahead[occupied], lead=frontSpeed[occupied];
    const safe=10+car.v*.63+(mountain?3+car.v*.25+(truckAhead[occupied]?5:0):0);
    if(mountain&&gap<100) target=Math.min(target,mountainFollowingSpeed(gap,lead));
    if(gap<safe+Math.max(0,car.v-lead)*1.45){
      target=Math.min(target,Math.max(0,lead+(gap-safe)*.62));
    }
  }
  const gap=pedestrianGap(car);
  car.targetSpeed=Math.min(target,Math.sqrt(2*5.5*Math.max(0,gap-1.35)));
}

// Tính tốc độ và hướng lái tự động theo khoảng trống và bề rộng xe ở mỗi làn.
export function reverseClear(lane,behind,follower){
  const rearFoot=foot.active&&relativeDistance(state.z,foot.z)<0
    &&relativeDistance(state.z,foot.z)>-13&&Math.abs(foot.x-state.x)<2.4;
  return !rearFoot&&behind[lane]>19+Math.max(0,follower[lane])*1.15;
}

export function canEaseIntoLane(x,dt){
  const own=vehicleProfile(state.model);
  const worldX=center(state.z)+x;
  return traffic.every(car=>{
    if(wreckExpired(car)) return true;
    const dz=relativeDistance(state.z,car.z);
    const profile=vehicleProfile(car.model);
    if(Math.abs(dz)>own.halfLength+profile.halfLength+2) return true;
    const yaw=carYaw(car);
    const reachZ=Math.abs(Math.cos(yaw))*profile.halfLength+Math.abs(Math.sin(yaw))*profile.halfWidth;
    const reachX=Math.abs(Math.sin(yaw))*profile.halfLength+Math.abs(Math.cos(yaw))*profile.halfWidth;
    return Math.abs(dz)>own.halfLength+reachZ+.18+Math.abs(car.v)*dt
      ||Math.abs(worldX-center(car.z)-car.x)>own.halfWidth+reachX+.18;
  });
}

export function alignAutopilot(dt,railOverlap){
  const target=Math.atan(slope(state.z)),yaw=carYaw(state);
  const turn=mod(target-yaw+Math.PI,TAU)-Math.PI;
  if(!railOverlap&&Math.abs(turn)<.19){
    state.freeSteering=false;
    return false;
  }
  if(Math.abs(state.v)>.12) return true;
  const wanted=yaw+clamp(turn,-1.35*dt,1.35*dt);
  const safe=limitRailRotation(state,yaw,wanted);
  if(Math.abs(safe-yaw)>1e-5){
    state.heading=safe-(state.yawOffset??0);
    return true;
  }

  const step=Math.min(Math.abs(state.x),.95*dt);
  const side=Math.sign(state.x);
  const x=state.x-side*step;
  // Nếu thân xe đang chạm lan can, xác nhận có điểm thoát ở phía trong trước khi dịch từng bước.
  const clearance=railOverlap?Math.min(Math.abs(state.x),1.2):step;
  for(let distance=step;distance>0&&distance<=clearance;distance=Math.min(distance+.08,clearance)){
    const candidate=state.x-side*distance;
    if(!canEaseIntoLane(candidate,dt)) break;
    if(!vehicleTerrainBlocked(state,state.z,candidate)){
      state.x=x;
      break;
    }
    if(distance===clearance) break;
  }
  return true;
}

export function planAutopilot(dt) {
  const stopped=Math.abs(state.v)<2;
  const railOverlap=stopped&&!state.local&&Math.abs(state.x)<5.2&&railIntersectsCar(state,state.z,state.x);
  if((railOverlap||state.freeSteering||stopped&&Math.abs(mod(carYaw(state)-Math.atan(slope(state.z))+Math.PI,TAU)-Math.PI)>.34)
    &&alignAutopilot(dt,railOverlap)) return {direction:0,acceleration:0,limit:0,shift:0};
  if(state.local){
    const gap=stopGap(state,state.local);
    const limit=gap/Math.max(dt,.001);
    const target=Math.min(curveSpeed(state,12),Math.sqrt(11*Math.max(0,gap-.2)));
    auto.brake=state.v>target+.3;
    return {direction:clamp((localOffset(state.local,state.z)-state.x)*.72,-.8,.8),
      acceleration:clamp((target-state.v)*2,-14,4),limit};
  }
  if(runtime.soloDrive){
    const target=curveSpeed(state,SOLO_TOP_SPEED);
    const direction=clamp((mountainTruckLane(state,auto.lane)-state.x)*.72-state.lateral*.21,-.66,.66);
    const acceleration=clamp((target-state.v)*2.6,-19,8);
    auto.brake=acceleration<-.7;
    return {direction,acceleration,limit:SOLO_TOP_SPEED};
  }
  const ahead=[110,110,110], behind=[110,110,110], leader=[30,30,30], follower=[0,0,0], truckAhead=[false,false,false];
  for(const car of traffic){
    const distance=relativeDistance(state.z,car.z);
    if(Math.abs(distance)>110) continue;
    const gap=vehicleGap(distance,state.model,car.model);
    const corridor=1.39+vehicleProfile(car.model).halfWidth;
    for(let lane=0;lane<3;lane++){
      if(Math.abs(car.x-(lane-1)*LANE_WIDTH)>corridor&&car.lane!==lane) continue;
      if(distance>=0&&gap<ahead[lane]){ahead[lane]=gap;leader[lane]=car.v;truckAhead[lane]=car.model===5;}
      if(distance<0&&gap<behind[lane]){ behind[lane]=gap;follower[lane]=car.v; }
    }
  }
  auto.cooldown=Math.max(0,auto.cooldown-dt);
  const lane=auto.lane;
  if(auto.recovery){
    const {start,target}=auto.recovery;
    auto.recovery.elapsed=(auto.recovery.elapsed??0)+dt;
    const clear=reverseClear(auto.recovery.lane??lane,behind,follower);
    const backedUp=relativeDistance(start,state.z)<=-11;
    if(clear&&!backedUp&&auto.recovery.elapsed<6&&ahead[target]>21&&behind[target]>18+follower[target])
      return {direction:0,acceleration:clamp((-2.6-state.v)*4,-5,6),limit:0,reversing:true};
    if(state.v<-.08) return {direction:0,acceleration:8,limit:0,reversing:true};
    auto.noReverse=auto.recovery.elapsed>=6;
    auto.recovery=null;
    auto.cooldown=3;
    if(ahead[target]>21&&behind[target]>18+follower[target]){auto.lane=target;auto.escapeLane=target;}
  }
  const occupiedLane=clamp(Math.round(state.x/LANE_WIDTH)+1,0,2);
  const blocked=state.v>=-.08&&state.v<.65&&ahead[occupiedLane]<11;
  auto.stuck=blocked?(auto.stuck??0)+dt:0;
  if(auto.stuck>1.15&&!auto.cooldown){
    const target=[occupiedLane-1,occupiedLane+1].find(i=>i>=0&&i<3&&ahead[i]>21&&behind[i]>22+follower[i]);
    if(target!==undefined){
      auto.stuck=0;
      if(reverseClear(occupiedLane,behind,follower)&&!auto.noReverse){
        auto.recovery={start:state.z,target,lane:occupiedLane};
        return {direction:0,acceleration:-4,limit:0,reversing:true};
      }
      auto.lane=target;auto.escapeLane=target;auto.cooldown=3;
    }
  }
  const bendLimit=curveSpeed(state,31),mountain=district(state.z)===2;
  if(bendLimit>24&&(!blocked||!reverseClear(lane,behind,follower)&&ahead[lane]>6)&&!auto.cooldown&&Math.abs(state.x-(lane-1)*LANE_WIDTH)<1.9&&ahead[lane]<25+Math.max(0,state.v-leader[lane])*1.4){
    let best=lane, bestGap=ahead[lane]+10;
    for(const candidate of [lane-1,lane+1]){
      if(candidate<0||candidate>2) continue;
      if(ahead[candidate]<21+Math.max(0,state.v-leader[candidate])*1.25
        ||behind[candidate]<16+Math.max(0,follower[candidate]-state.v)*1.22) continue;
      if(ahead[candidate]>bestGap){best=candidate;bestGap=ahead[candidate];}
    }
    if(best!==lane){auto.lane=best;auto.cooldown=3;}
  }
  let target=bendLimit, nearest=pedestrianGap(state);
  for(let occupied=0;occupied<3;occupied++){
    if(occupied!==auto.lane&&Math.abs(state.x-(occupied-1)*LANE_WIDTH)>2.25) continue;
    const gap=ahead[occupied], safe=9+state.v*.72+(mountain?3+state.v*.24+(truckAhead[occupied]?5:0):0);
    if(mountain&&gap<110) target=Math.min(target,mountainFollowingSpeed(gap,leader[occupied]));
    nearest=Math.min(nearest,gap);
    if(gap<safe+Math.max(0,state.v-leader[occupied])*1.6)
      target=Math.min(target,Math.max(0,leader[occupied]+(gap-safe)*.61));
  }
  const direction=clamp((mountainTruckLane(state,auto.lane)-state.x)*.72-state.lateral*.21,-.66,.66);
  if(auto.escapeLane!==undefined&&(Math.abs(state.x-(auto.escapeLane-1)*LANE_WIDTH)<.45
    ||behind[auto.escapeLane]<8+follower[auto.escapeLane]||ahead[auto.escapeLane]<10)) auto.escapeLane=undefined;
  if(auto.escapeLane!==undefined&&state.v<2.75&&nearest<11){
    const delta=(auto.escapeLane-1)*LANE_WIDTH-state.x;
    const shift=clamp(delta,-1.2*dt,1.2*dt);
    if(canEaseIntoLane(state.x+shift,dt)) return {direction,acceleration:-8,limit:0,shift};
  }
  const acceleration=clamp((target-state.v)*.9,-17,6);
  const limit=Math.max(0,(nearest-5.4)/Math.max(.001,dt));
  auto.brake=acceleration<-.7||state.v>limit;
  return {direction,acceleration,limit};
}

export function setAutopilot(enabled) {
  if(enabled&&(foot.active||state.wreck)) return;
  auto.enabled=enabled;auto.brake=false;auto.cooldown=0;auto.recovery=null;auto.escapeLane=undefined;auto.stuck=0;auto.noReverse=false;
  auto.lane=clamp(Math.round(state.x/LANE_WIDTH)+1,0,2);
  const button=get('autopilot');
  button.setAttribute('aria-pressed',String(enabled));
  labelControl(button,enabled?'Tắt tự lái':'Bật tự lái');
}
