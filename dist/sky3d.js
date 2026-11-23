import { DAY_SECONDS, LOOP, TAU, clamp, hash, mod } from './src/constants.js';
import { center, district, eachCityBuilding, eachWindTurbine, passSample } from './src/route.js';
import { passHeights, runtime, state, usesAnimatedTheme, world } from './src/runtime.js';
import { modelMeters } from './src/model-scale.js';

export const skyFlightClock={last:-1,planeAt:0,birdsAt:0,planes:[],birds:[]};
const planeDuration=16;
const planeSeparation=170;
const flockDuration=12;
// Mái nhà thành phố được kiểm tra riêng theo kích thước từng công trình.
const ridgeHeight=[15,17,106,23,16,64,19];

// Xét khoảng thời gian đường bay cắt hình chữ nhật của nhà đã nới theo sải cánh.
export function buildingFlightClearance(flight,duration,margin,radius){
  let height=flight.y;
  const endZ=flight.z+flight.vz*duration,padding=radius+18;
  eachCityBuilding(Math.min(flight.z,endZ)-padding,Math.max(flight.z,endZ)+padding,(x,z,width,roof,depth)=>{
    let entry=0,exit=duration;
    for(const [start,speed,center,extent] of [[flight.x,flight.vx,x,depth*.5],[flight.z,flight.vz,z,width*.5]]){
      const reach=extent+radius,offset=start-center;
      if(Math.abs(speed)<.001){
        if(Math.abs(offset)>reach) return;
        continue;
      }
      const a=(-reach-offset)/speed,b=(reach-offset)/speed;
      entry=Math.max(entry,Math.min(a,b));exit=Math.min(exit,Math.max(a,b));
      if(entry>exit) return;
    }
    height=Math.max(height,passSample(z,passHeights)+roof+margin);
  });
  return height;
}

// Bố trí các khối mây và ghép tọa độ qua điểm nối cao tốc.
function drawCloudField(origin,originX,loop,now,glbSky){
  const count=loop/160;
  const drift=mod(now*.63,loop),crosswind=Math.sin(now*.016)*29;
  const first=Math.floor((origin-drift-(runtime.yawCos<.35?480:90))/160);
  const last=Math.floor((origin-drift+(runtime.yawCos<-.35?130:635))/160);
  for(let i=first;i<=last;i++){
    const cell=mod(i,count),z=cell*160+hash(cell+118)*90;
    const x=center(z)+(hash(cell+193)-.5)*240,y=37+hash(cell+281)*32;
    if(Math.abs(x+crosswind-originX)>420) continue;
    const wrap=(i-cell)*160+drift;
    const shear=crosswind+Math.sin(now*.028+cell*.81)*3.5;
    glbSky.drawCloud(x+shear,y,z+wrap,cell);
  }
}

// Tìm độ cao tuyệt đối an toàn trên toàn bộ quỹ đạo, kể cả sườn đèo và turbine.
export function flightClearance(flight,duration,margin,radius=8){
  let height=flight.y;
  const turbines=[];
  eachWindTurbine(flight.z,(x,z)=>turbines.push([x,z,passSample(z,passHeights)+modelMeters.turbine[1]]));
  const reach=radius+Math.hypot(flight.vx,flight.vz)*.5;
  for(let time=0;time<=duration;time+=.5){
    const x=flight.x+flight.vx*time;
    const z=flight.z+flight.vz*time;
    for(const offset of [-reach,0,reach]){
      const at=z+offset,area=district(at);
      const across=Math.abs(x-center(at));
      const obstacle=across<130+reach||area===2||area===5?ridgeHeight[area]??16:12;
      height=Math.max(height,passSample(at,passHeights)+obstacle+margin);
    }
    for(const [tx,tz,top] of turbines)
      if(Math.abs(x-tx)<reach+11&&Math.abs(z-tz)<reach+modelMeters.turbine[0]*.5)
        height=Math.max(height,top+margin);
  }
  return buildingFlightClearance({...flight,y:height},duration,margin,radius);
}
// Tính khoảng cách nhỏ nhất trên mặt phẳng trong phần quỹ đạo trùng thời gian.
function closestFlightDistance(plane,other){
  const age=plane.begin-other.begin;
  const remaining=Math.max(0,Math.min(planeDuration,planeDuration-age));
  const dx=plane.x-(other.x+other.vx*age);
  const dz=plane.z-skyFlightDepth(other.z+other.vz*age,plane.z,LOOP);
  const vx=plane.vx-other.vx,vz=plane.vz-other.vz;
  const rate=vx*vx+vz*vz;
  const at=rate>0?clamp(-(dx*vx+dz*vz)/rate,0,remaining):0;
  return Math.hypot(dx+vx*at,dz+vz*at);
}

// Chỉ coi là ngoài màn hình khi toàn bộ thân và hai cánh đã qua mép khung.
export function planeStartsOffscreen(plane,origin,originX){
  const x=plane.x-originX,z=plane.z-origin;
  const forward=x*runtime.yawSin+z*runtime.yawCos;
  const right=x*runtime.yawCos-z*runtime.yawSin;
  const depth=forward*runtime.pitchCos+(plane.y-runtime.eye)*runtime.pitchSin;
  const radius=modelMeters.airliner*plane.span*.74;
  const edge=Math.max(runtime.cx,runtime.w-runtime.cx)/Math.max(1,runtime.focal);
  return Math.abs(right)-radius>Math.max(1,depth+radius)*edge;
}

// Tạo máy bay ngoài mép camera, bay vào từ ngang và giữ khoảng cách với chuyến khác.
export function newSkyPlane(now,origin,originX,active=[]){
  const near=active.length?!active[0].near:false;
  let best=null;
  const cos=runtime.yawCos,sin=runtime.yawSin;
  for(let i=0;i<6;i++){
    const side=Math.random()<.5?-1:1;
    const depth=near?145+Math.random()*60:510+Math.random()*70;
    const acrossSpeed=(near?19:47)+Math.random()*(near?15:19);
    // Thử các hướng lệch nhau để có thể bay vòng qua dãy nhà thay vì phải leo cao.
    const alongSpeed=clamp(state.v*cos*Math.cos(state.heading??0)+state.v*sin*Math.sin(state.heading??0),-28,38)+(Math.random()-.5)*22;
    const base=passSample(origin,passHeights)+(near?65+Math.random()*18:54+Math.random()*16);
    const edge=Math.max(runtime.cx,runtime.w-runtime.cx)/Math.max(1,runtime.focal);
    const plane={begin:now,near,x:0,z:0,y:base,
      vx:alongSpeed*sin-side*acrossSpeed*cos,vz:alongSpeed*cos+side*acrossSpeed*sin,span:.87+Math.random()*.17};
    const radius=modelMeters.airliner*plane.span*.74;
    for(let gap=radius+12;gap<=radius+220;gap+=22){
      const lateral=side*(Math.max(1,depth*runtime.pitchCos+(plane.y-runtime.eye)*runtime.pitchSin+radius)*edge+gap);
      plane.x=originX+depth*sin+lateral*cos;
      plane.z=origin+depth*cos-lateral*sin;
      plane.y=flightClearance({...plane,y:base},planeDuration,26,radius);
      if(planeStartsOffscreen(plane,origin,originX)) break;
    }
    if(!planeStartsOffscreen(plane,origin,originX)) continue;
    if(active.some(other=>closestFlightDistance(plane,other)<planeSeparation
      ||(plane.vx*other.vx+plane.vz*other.vz)/Math.hypot(plane.vx,plane.vz)/Math.hypot(other.vx,other.vz)>.95)) continue;
    if(!best||plane.y<best.y) best=plane;
    if(plane.y<=base) break;
  }
  return best;
}

// Tạo đàn chim bay chếch qua đường, với quy mô và khoảng cách đội hình thay đổi.
export function newSkyFlock(now,originX,playerZ,band=0) {
  const direction=Math.random()<.5?-1:1;
  const depth=76+band*93+Math.random()*59;
  const heading=direction*(.42+Math.random()*1.82),speed=8+band*6+Math.random()*5;
  const flock={begin:now,x:originX-direction*depth*(.29+Math.random()*.2),z:playerZ+depth,
    y:32+Math.random()*13,vx:Math.sin(heading)*speed,vz:Math.cos(heading)*speed,
    count:5+Math.floor(Math.random()*5),seed:Math.random()*1000,band};
  flock.y=flightClearance(flock,flockDuration,8,22);
  return flock;
}

// Đưa độ sâu về cùng vòng tuyến với người chơi để chuyến bay không nhảy khi qua điểm nối.
export function skyFlightDepth(z,playerZ,loop) {
  return playerZ+mod(z-playerZ+loop*.5,loop)-loop*.5;
}

// Đặt máy bay GLB theo hướng và vận tốc của chuyến bay.
function drawSkyPlane(plane,now,playerZ,loop,glbSky){
  const age=now-plane.begin;
  const x=plane.x+age*plane.vx,z=skyFlightDepth(plane.z+age*plane.vz,playerZ,loop);
  if(Math.abs(z-playerZ)>650) return;
  glbSky.drawPlane(x,plane.y,z,Math.atan2(plane.vx,plane.vz),plane.span);
}

// Vẽ vệt ngưng tụ theo đường bay đã đi qua.
export function drawSkyContrail(quad,plane,now,playerZ,loop){
  if(!plane) return;
  const age=now-plane.begin;
  const visibleAge=Math.min(age,planeDuration);
  const speed=Math.hypot(plane.vx,plane.vz);
  const dx=plane.vx/speed,dz=plane.vz/speed;
  function edge(emission,side){
    const elapsed=now-plane.begin-emission;
    const spread=.3+elapsed*.38;
    const along=emission*speed-modelMeters.airliner*.42*plane.span;
    const x=plane.x+dx*along+dz*side*spread;
    const z=skyFlightDepth(plane.z+dz*along-dx*side*spread,playerZ,loop);
    return [x,plane.y-passSample(z,passHeights)+elapsed*.22+side*spread*.31,z];
  }
  const first=Math.max(0,age-8);
  for(let emission=first;emission<visibleAge;emission+=.32){
    const end=Math.min(emission+.32,visibleAge);
    const a=edge(emission,-1), b=edge(emission,1), c=edge(end,1), d=edge(end,-1);
    if(Math.abs(a[2]-playerZ)>650&&Math.abs(c[2]-playerZ)>650) continue;
    const opacity=.52*(1-clamp((age-(emission+end)*.5)/8,0,1))**1.4;
    quad(a,b,c,d,'#bfccdb',opacity,-1);
  }
}

// Vẽ đàn chim dạng chữ V lệch, mỗi con có nhịp đập cánh riêng.
function drawSkyFlock(flock,now,playerZ,loop,glbSky) {
  const age=now-flock.begin;
  const x=flock.x+age*flock.vx,z=skyFlightDepth(flock.z+age*flock.vz,playerZ,loop);
  if(Math.abs(z-playerZ)>540) return;
  const yaw=Math.atan2(flock.vx,flock.vz), cos=Math.cos(yaw), sin=Math.sin(yaw);
  for(let i=0;i<flock.count;i++){
    const seed=flock.seed+i*33;
    const rank=Math.ceil(i/2), side=i%2===0?1:-1;
    const spread=rank*4.0*side+(hash(seed)-.5)*1.8, lag=-rank*3.5+(hash(seed+4)-.5)*1.8;
    const size=.83+hash(seed+89)*.48;
    const flap=Math.sin(age*(9+hash(seed+12)*4)+hash(seed+6)*TAU);
    const bx=x+spread*cos+lag*sin, by=flock.y+(hash(seed+3)-.5)*3, bz=z+lag*cos-spread*sin;
    glbSky.drawBird(bx,by,bz,yaw,size,flap);
  }
}

// Duy trì lịch xuất hiện ngẫu nhiên của máy bay và đàn chim trong mỗi lượt chơi.
export function drawSkyTraffic3D(origin,originX,playerZ,now,loop,started,glbSky) {
  drawCloudField(origin,originX,loop,now,glbSky);
  if(!started) return;
  const schedule=skyFlightClock;
  if(!schedule.planeAt||now<schedule.last){
    schedule.planeAt=now+2+Math.random()*4;
    schedule.birdsAt=now+1+Math.random()*5;
    schedule.planes.length=0;schedule.birds.length=0;
  }
  schedule.last=now;
  for(let i=schedule.planes.length-1;i>=0;i--)
    if(now-schedule.planes[i].begin>=planeDuration) schedule.planes.splice(i,1);
  if(now>=schedule.planeAt){
    if(schedule.planes.length<2){
      const plane=newSkyPlane(now,origin,originX,schedule.planes);
      if(plane) schedule.planes.push(plane);
      schedule.planeAt=now+1+Math.random()*1.4;
    }else schedule.planeAt=now+.5;
  }
  for(let i=schedule.birds.length-1;i>=0;i--)
    if(now-schedule.birds[i].begin>=flockDuration) schedule.birds.splice(i,1);
  if(now>=schedule.birdsAt){
    const available=[0,1,2].filter(band=>!schedule.birds.some(flock=>flock.band===band));
    if(available.length)
      schedule.birds.push(newSkyFlock(now,originX,playerZ,available[Math.floor(Math.random()*available.length)]));
    schedule.birdsAt=now+.7+Math.random()*1.1;
  }
  for(const plane of schedule.planes) drawSkyPlane(plane,now,playerZ,loop,glbSky);
  for(const flock of schedule.birds) drawSkyFlock(flock,now,playerZ,loop,glbSky);
}

// Vẽ mặt trăng với viền sáng nhẹ và các vùng tối trên bề mặt.
function drawMoon(context,point,skyLine,opacity){
  if(!point||opacity<.02) return;
  const [x,y]=point,radius=clamp(runtime.focal*.015,5,16);
  if(x<-radius*3||x>runtime.w+radius*3||y<-radius*3||y>skyLine+radius) return;
  const halo=context.createRadialGradient(x,y,radius*.35,x,y,radius*3);
  halo.addColorStop(0,'#b2c9ff44');halo.addColorStop(1,'#b2c9ff00');
  context.save();
  context.beginPath();context.rect(0,0,runtime.w,skyLine);context.clip();
  context.globalAlpha=opacity;
  context.fillStyle=halo;
  context.beginPath();context.arc(x,y,radius*3,0,TAU);context.fill();
  const disk=context.createRadialGradient(x-radius*.3,y-radius*.32,0,x,y,radius);
  disk.addColorStop(0,'#fff8e2');disk.addColorStop(1,'#b3c6e1');
  context.fillStyle=disk;
  context.beginPath();context.arc(x,y,radius,0,TAU);context.fill();
  context.clip();
  for(let i=0;i<9;i++){
    context.fillStyle=i%2?'#8c9db046':'#8091aa37';
    const cx=x+(hash(i+74)-.5)*radius*1.5,cy=y+(hash(i+99)-.5)*radius*1.5;
    context.beginPath();context.ellipse(cx,cy,radius*(.10+hash(i+113)*.20),radius*.17,i*.9,0,TAU);context.fill();
  }
  context.restore();
}

// Chiếu các điểm trên thiên cầu bằng cùng góc quay với camera lái xe.
const starField=[];
export function drawCelestialSky(context,skyLine){
  function screen(x,y,z){
    const forward=x*runtime.yawSin+z*runtime.yawCos;
    const depth=forward*runtime.pitchCos+y*runtime.pitchSin;
    if(depth<=.04) return null;
    return [runtime.cx+(x*runtime.yawCos-z*runtime.yawSin)*runtime.focal/depth,runtime.horizon-(y*runtime.pitchCos-forward*runtime.pitchSin)*runtime.focal/depth];
  }
  if(!starField.length){
    for(let i=0;i<440;i++){
      const azimuth=hash(i+831)*TAU, height=.035+hash(i+1279)*.96;
      const ring=Math.sqrt(1-height*height);
      starField.push([Math.sin(azimuth)*ring,height,Math.cos(azimuth)*ring,hash(i+2191)]);
    }
  }
  if(world.stars>.02){
    context.fillStyle='#dbe8ff';
    for(const [x,y,z,brightness] of starField){
      const point=screen(x,y,z);
      if(!point||point[0]<0||point[0]>runtime.w||point[1]<0||point[1]>skyLine) continue;
      const size=(.75+brightness*1.5)*Math.max(.8,runtime.h/830);
      context.globalAlpha=world.stars*(.28+brightness*.67);
      context.fillRect(point[0],point[1],size,size);
    }
    context.globalAlpha=1;
  }
  const lunarTime=world.time*TAU/DAY_SECONDS;
  const moonYaw=.33+.42*Math.sin(lunarTime),moonPitch=.27+.14*Math.cos(lunarTime);
  const moonPoint=screen(Math.sin(moonYaw)*Math.cos(moonPitch),Math.sin(moonPitch),Math.cos(moonYaw)*Math.cos(moonPitch));
  drawMoon(context,moonPoint,skyLine,(1-world.daylight)**2*(1-world.fog*.65));
  if(world.sunStrength<.025) return;
  const point=screen(...world.sun);
  if(!point) return;
  const [x,y]=point,radius=clamp(runtime.focal*.032,9,26),halo=radius*3.4;
  if(x<-halo||x>runtime.w+halo||y<-halo||y>skyLine+radius) return;
  context.save();
  context.beginPath();
  context.rect(0,0,runtime.w,skyLine);
  context.clip();
  const glow=context.createRadialGradient(x,y,radius*.3,x,y,halo);
  glow.addColorStop(0,'#ffe7b0e8');
  glow.addColorStop(.35,'#ffc9825c');
  glow.addColorStop(1,'#ffc98200');
  const animated=usesAnimatedTheme();
  context.globalAlpha=world.sunStrength*(animated?.35:.62);
  context.fillStyle=glow;
  context.beginPath();context.arc(x,y,halo,0,TAU);context.fill();
  context.globalAlpha=clamp(world.sunStrength*.96,0,1);
  context.fillStyle=world.twilight>.55?'#ffd09c':'#fff3c9';
  context.beginPath();context.arc(x,y,radius,0,TAU);context.fill();
  context.restore();
  context.globalAlpha=1;
}
