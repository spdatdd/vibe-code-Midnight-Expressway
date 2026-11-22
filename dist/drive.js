'use strict';
const get = document.getElementById.bind(document);
const canvas = get('view');
const themeControl=get('theme'),coverTheme=get('cover-theme');
const usesAnimatedTheme=()=>themeControl.value==='animated';
const ctx = canvas.getContext('2d');
const TAU = Math.PI * 2;
// Một đơn vị tọa độ và khoảng cách tương ứng một mét.
const LANE_WIDTH=3.8;
const ROAD = 3*LANE_WIDTH, LOOP = 6400, FAR = 440, SCENERY_FAR = 635, LAMP = 32;
const HORIZON_RATIO = .43;
const vietnamScenes=[
  [{name:'Phố Sài Gòn',style:'saigon'},{name:'Phố Hà Nội',style:'hanoi'},{name:'Phố Huế',style:'hue'}],
  [{name:'Đồng Tháp Mười',style:'lotus'},{name:'Làng ven sông miền Tây',style:'delta'},{name:'Đồng quê Bắc Bộ',style:'rice'}],
  [{name:'Mù Cang Chải',style:'terraces'},{name:'Đèo Hải Vân',style:'pass'},{name:'Cao nguyên Hà Giang',style:'karst'}],
  [{name:'Vịnh Hạ Long',style:'bay'},{name:'Bờ biển Nha Trang',style:'beach'},{name:'Mũi Né',style:'dunes'}],
  [{name:'Cầu Nhật Tân',style:'white'},{name:'Cầu Cần Thơ',style:'gold'},{name:'Cầu Mỹ Thuận',style:'blue'}],
  [{name:'Hầm Hải Vân',style:'warm'},{name:'Hầm Đèo Cả',style:'cool'}],
  [{name:'Rừng Cúc Phương',style:'forest'},{name:'Rừng Cát Tiên',style:'forest'}]
];
let sceneryChoices=vietnamScenes.map(choices=>choices[0]);
function sceneryAt(z){return sceneryChoices[district(z)];}

const routeLengths=[1120,1280,1280,1280,920,520];
const PASS_LENGTH=routeLengths[2],COAST_LENGTH=routeLengths[3];
const FOREST_LENGTH=520;
const TUNNEL_MARGIN=40;
const TUNNEL_LENGTH=routeLengths[5]-TUNNEL_MARGIN*2;
const graphicsPresets={
  low:{road:320,scenery:420,detail:145,grass:1,grassRange:65,resolution:.75,
    house:140,tree:92,extraTree:70,vehicle:105,person:48},
  medium:{road:FAR,scenery:SCENERY_FAR,detail:230,grass:3,grassRange:120,resolution:1,
    house:140,tree:92,extraTree:70,vehicle:105,person:48},
  highest:{road:625,scenery:895,detail:365,grass:6,grassRange:240,resolution:1.15,
    house:220,tree:150,extraTree:115,vehicle:160,person:75}
};
let graphics=graphicsPresets.highest;
let route,cityStart,tunnelStart,chamStart,villageStart;
const VILLAGE_INTRO_LENGTH=480;
function inOpeningVillage(z){
  return mod(z-villageStart,LOOP)<VILLAGE_INTRO_LENGTH;
}
const conditions={time:[get('time'),get('drive-time')],weather:[get('weather'),get('drive-weather')]};
const chaseDefaults={height:1.90,distance:8.5,offset:0};
const chase={...chaseDefaults};
const cameraPanel=get('camera-panel'),cameraSettings=get('camera-settings');
const cameraFields=Object.keys(chaseDefaults);
const viewLook={yaw:0,pitch:0};
let displayedCamera=null,cameraTransfer=null;
let cameraStep=0;
let viewDrag=null,yawCos=1,yawSin=0,pitchCos=1,pitchSin=0;
let compactCockpit=false;
const DISTANT_GROUND = '#1d284b';
const SEASON_SECONDS=60, DAY_SECONDS=240;
const keys = new Set(), fingers = new Map();
const bindings = {KeyW:'gas',ArrowUp:'gas',KeyS:'brake',ArrowDown:'brake',KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right'};
const carColors = ['#503746','#29465b','#666275','#653d40','#726b5e'];
const trafficModels=[0,1,2,3,4,0,1,5,2,0,3,1,4,2,5,0];
const carProfile={halfLength:2.24,halfWidth:.95,mass:1450,roof:1.44,cruise:1,shiftSpeed:2.8};
const sedanVariants=[carProfile,{...carProfile,halfLength:2.10,halfWidth:.94,mass:1310,roof:1.29},{...carProfile,halfLength:2.29,halfWidth:.98,mass:1550,roof:1.54},{...carProfile,halfLength:2.36,halfWidth:1.01,mass:1850,roof:1.69}];
const motorcycleProfile={halfLength:1.23,halfWidth:.47,mass:240,roof:.93,cruise:1.04,shiftSpeed:3.05};
const truckProfile={halfLength:3.6,halfWidth:1.22,mass:5400,roof:3.05,cruise:.76,shiftSpeed:1.95};
const skinTones=[['#d49b79','#a76d55','#e3ad8b'],['#b98766','#815641','#c99b7b'],
  ['#e0b094','#ac7865','#efc0a1'],['#996c52','#714633','#b08261']];
const shirts=[['#b9644f','#804638','#da856a'],['#587f82','#3b565e','#7e9e9a'],
  ['#8c7252','#594a40','#af9873'],['#62759c','#414c73','#7e90ae'],
  ['#7e567b','#533c5b','#a17b9c'],['#ad8149','#745735','#c89f61'],['#6f7754','#49523c','#8d9670']];
const hairTones=[['#303144','#202636','#45485b'],['#524038','#352927','#64504a'],
  ['#3a3237','#232630','#51454b']];
function newCharacter(random=Math.random){
  const pick=list=>list[Math.floor(random()*list.length)];
  const female=random()<.5,age=18+Math.floor(random()*61);
  const hair=age>=56&&random()<.83?pick([['#aaa5a1','#777476','#c4beb8'],['#d1c7bb','#a69e99','#e0d8cc']]):pick(hairTones);
  const pants=pick([['#414b66','#30384e','#566078'],['#695747','#4e4037','#85715b'],
    ['#42443d','#2a302b','#5b6451'],['#6b6b73','#50535d','#8a8590']]);
  return {female,age,skin:pick(skinTones),shirt:pick(shirts),hair,pants,
    scale:(female?.93:.99)+random()*.13,build:.85+random()*.22,
    hairStyle:Math.floor(random()*6),faceWidth:.22+random()*.061,faceDepth:.208+random()*.054,
    longHair:random()<(female?.64:.17),trim:random()<.44,glasses:random()<(age>=50?.39:.14),
    beard:!female&&random()<.30,outfit:Math.floor(random()*4)};
}
const MAX_TRAFFIC_VEHICLES=14; // Cộng một xe người chơi, kể cả khi đang đi bộ.
const traffic = [];
const ejectedDrivers=[];
let vehicleTakeover=null;
const RECLAIM_GRACE_SECONDS=4;
const state = {model:0,color:"#464d79",z:477,x:0,v:0,steer:0,lateral:0,camera:0,target:0,hit:0,started:false};
const foot={look:newCharacter(),walkYaw:null,directionHold:0,running:false,firstPerson:false,grounded:true,active:false,z:0,x:0,y:0,vy:0,angle:0,cameraYaw:0,stride:0,moving:false};
const vehicleInteract=get('vehicle-interact'),jumpButton=get('jump');
const FOOT_RADIUS=.29;
const stick=get('walk-stick'),stickCap=stick.firstElementChild;
const walkStick={pointer:null,x:0,z:0};
let previousCamera=0;
const world={time:0,first:1,daylight:0,twilight:0,fog:0,sun:[0,0,1],sunStrength:0,stars:1,weather:[0,1,0]};
const precipitation={speed:0,side:0,rainTravel:0,rainDrift:0};
const SOLO_TOP_SPEED=250/3.6;
let soloDrive=false;
const auto={enabled:false,lane:1,cooldown:0,brake:false};
let w, h, horizon, focal, cx, eye, origin, originX, tangent, sky, daySky, duskClouds;
let audio;
let effectsLevel=1;
const wind={strength:.26,x:1,z:0};
let spawnTimer=6, spawnIndex=0;
const world3D = createWorld3D();
const backdrop = document.createElement('canvas');
const backdropCtx = backdrop.getContext('2d', {alpha:false});
if(world3D) canvas.before(backdrop, world3D.canvas);

// Giới hạn và nội suy giá trị dùng trong mô phỏng và kết xuất.
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const lerp = (a,b,t) => a+(b-a)*t;
// Đưa tọa độ về chu kỳ dương và tạo số giả ngẫu nhiên ổn định theo chỉ số.
const mod = (v,n) => ((v%n)+n)%n;
const hash = n => mod(Math.sin(n*127.1+39.7)*43758.5453,1);
let passStart=0,coastStart=0,coastLandBefore=1,coastLandAfter=1;
const passHeights=new Float32Array(PASS_LENGTH+1),passBends=new Float32Array(PASS_LENGTH+1);
for(let i=0;i<=PASS_LENGTH;i++){
  const t=i/PASS_LENGTH, envelope=Math.sin(Math.PI*t)**2;
  passHeights[i]=envelope*(48+11*Math.sin(t*TAU*2));
  passBends[i]=envelope*35*Math.tanh(2.4*Math.sin(t*TAU*3));
}
function passSample(z,table){
  let d=z-passStart;
  if(d<0||d>=LOOP) d=mod(d,LOOP);
  if(d>=PASS_LENGTH) return 0;
  const i=Math.floor(d);
  return table[i]+(table[i+1]-table[i])*(d-i);
}
function setRoute(order) {
  let start=0;
  route=order.flatMap((area,index)=>{
    const end=start+routeLengths[area];
    if(area===2) passStart=start;
    if(area===3){
      coastStart=start;
      coastLandBefore=Number(order[(index+order.length-1)%order.length]!==4);
      coastLandAfter=Number(order[(index+1)%order.length]!==4);
    }
    if(area===0) cityStart=start;
    if(area===1){
      villageStart=start;
      chamStart=end-FOREST_LENGTH+192;
    }
    if(area===5) tunnelStart=start+TUNNEL_MARGIN;
    const from=start;
    start=end;
    if(area===1) return [{area,start:from,end:end-FOREST_LENGTH},{area:6,start:end-FOREST_LENGTH,end}];
    return {area,start:from,end};
  });
}
setRoute([0,1,2,3,4,5]);
function randomizeRoute(random=Math.random) {
  const order=[1,2,3,4,5];
  for(let i=order.length-1;i>0;i--){
    const j=Math.floor(random()*(i+1));
    [order[i],order[j]]=[order[j],order[i]];
  }
  setRoute([0,...order]);
  sceneryChoices=vietnamScenes.map(choices=>choices[Math.floor(random()*choices.length)]);
}
function district(z) {
  const position=mod(z,LOOP);
  for(const section of route) if(position<section.end) return section.area;
}
function tunnelOffset(z) {
  return mod(z-tunnelStart,LOOP);
}
function inTunnel(z) {
  return tunnelOffset(z)<TUNNEL_LENGTH;
}
const cityExits=[];
const localRoads=[];
const LOCAL_LENGTH=385,LOCAL_JUNCTION=177;
// Tạo hạt thời tiết một lần để chuyển động lặp ổn định và nhẹ.
const particles=Array.from({length:104},(_,i)=>[hash(i+900),hash(i+1300),hash(i+1500)]);
// Tâm đường và tiếp tuyến tuần hoàn để ghép tuyến liền mạch.
function center(z) {
  const phase = z*TAU/LOOP;
  return passSample(z,passBends)+38*Math.cos(phase*4)+10*Math.sin(phase*9)+14*Math.cos(phase*2)+8*Math.sin(phase*2);
}
function mountainCenter(z,side,width,length,margin){
  let outer=side*center(z);
  for(let distance=-length;distance<=length;distance+=4)
    outer=Math.max(outer,side*center(z+distance));
  outer=Math.max(outer,side*center(z+length));
  const t=clamp((Math.abs(relativeDistance(waterfallAnchor(),z))-38)/67,0,1);
  const waterfallClearance=side===-1?27*(1-t*t*(3-2*t)):0;
  return side*(outer+width+margin+5+waterfallClearance);
}
function waterfallAnchor(){return mod(passStart+PASS_LENGTH*.42,LOOP);}
function slope(z) {
  return (center(z+.5)-center(z-.5));
}
// Chọn ngẫu nhiên hai nhánh tách và nhập làn ngoài phạm vi hầm trong mỗi khu phố.
function randomizeExits(random=Math.random) {
  cityExits.length=0;
  const rural=route.find(section=>section.area===1).start;
  localRoads.splice(0,localRoads.length,
    {start:493,side:1,name:'Đường vào thành phố',phase:0},
    {start:rural+96,side:-1,name:'Đường khu dân cư',phase:8});
  for(const [first,last,minLength,maxLength] of [[90,200,145,230],[480,550,138,188]]){
    const start=lerp(first,last,random());
    const end=start+lerp(minLength,maxLength,random());
    cityExits.push({start,end,side:random()<.5?-1:1,width:lerp(4.45,5.25,random())});
  }
}
// Đọc bề rộng nhánh cùng phía tại một lát cắt và làm thon đều ở hai đầu.
function exitWidth(z,side=1) {
  const phase=mod(z-cityStart,LOOP);
  if(phase>=routeLengths[0]) return 0;
  for(const exit of cityExits){
    if(exit.side!==side||phase<=exit.start||phase>=exit.end) continue;
    const amount=Math.min((phase-exit.start)/43,(exit.end-phase)/53,1);
    return exit.width*amount*amount*(3-2*amount);
  }
  return 0;
}
function localRoadAt(z){
  for(const road of localRoads)
    if(mod(z-road.start,LOOP)<LOCAL_LENGTH) return road;
  return null;
}
function localOffset(road,z){
  const progress=mod(z-road.start,LOOP);
  const blend=clamp(Math.min(progress,LOCAL_LENGTH-progress)/104,0,1);
  return road.side*(4.4+21.6*blend*blend*(3-2*blend));
}
function localWidth(road,z){
  const d=Math.abs(mod(z-road.start,LOOP)-LOCAL_JUNCTION);
  return d<4?9:3.1;
}
function localMergeAt(z,side){
  const road=localRoadAt(z);
  if(road?.side!==side) return false;
  const offset=Math.abs(localOffset(road,z)), rail=6+exitWidth(z,side);
  return Math.abs(offset-rail)<6.25;
}
function isLocalBuildingConflict(z,worldX,radius){
  for(const at of [z-6,z,z+6]){
    const road=localRoadAt(at);
    if(road&&Math.abs(center(at)+localOffset(road,at)-worldX)<radius+localWidth(road,at)+2.65) return true;
  }
  return false;
}
function localSignal(road){
  const phase=mod(world.time+road.phase,22);
  return phase<10?'green':phase<13?'amber':'red';
}
function stopGap(car,road){
  if(localSignal(road)==='green') return Infinity;
  const d=LOCAL_JUNCTION-5-mod(car.z-road.start,LOOP);
  const front=vehicleProfile(car.model).halfLength;
  return d>=front-.1?Math.max(0,d-front):Infinity;
}
function roadLocation(car){
  const road=localRoadAt(car.z);
  return road&&Math.abs(car.x-localOffset(road,car.z))<localWidth(road,car.z)+.5?road:null;
}
function clampLocalX(road,z,x){
  const mid=localOffset(road,z),outer=localWidth(road,z)-.72,inner=2.38;
  return clamp(x,mid-(road.side>0?inner:outer),mid+(road.side>0?outer:inner));
}
function clampRoadX(z,x){
  const main=clamp(x,-4.73-exitWidth(z,-1),4.73+exitWidth(z,1));
  const road=localRoadAt(z);
  if(!road) return main;
  const local=clampLocalX(road,z,x);
  return Math.abs(x-local)<Math.abs(x-main)?local:main;
}
function trackWheelTravel(car,z,x){
  if(!car.v||car.wreck) return;
  const dx=center(z)+x-center(car.z)-car.x;
  car.wheelTravel=(car.wheelTravel??0)+Math.sign(car.v)*Math.hypot(dx,relativeDistance(car.z,z));
}
function mountainTruckLane(car,lane){
  const centerline=(lane-1)*LANE_WIDTH;
  return car.model===5&&district(car.z)===2?centerline*.88:centerline;
}
function mountainTruckPose(car,z,x){
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
function advanceCar(car,dt,lateral){
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
randomizeExits();
function vehicleYaw(z,lateral,speed,road=null) {
  const curve=road&&localRoadAt(z-.5)===road&&localRoadAt(z+.5)===road
    ?localOffset(road,z+.5)-localOffset(road,z-.5):0;
  return Math.atan(slope(z)+curve+clamp(lateral/Math.max(8,Math.abs(speed)),-.35,.35));
}
function curveSpeed(car,cruise){
  const mountain=district(car.z)===2;
  const fastSolo=soloDrive&&car===state&&cruise>50;
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
function mountainFollowingSpeed(gap,lead){
  const brake=lerp(3.1,2.35,world.weather[0]);
  return Math.sqrt(Math.max(0,lead)**2+2*brake*Math.max(0,gap-7));
}
function carYaw(car){
  return (car.heading??vehicleYaw(car.z,car.lateral??0,car.v,car.local))+(car.yawOffset??0);
}
// Tính độ sáng của đèn đường; các pha ban ngày tắt hoàn toàn.
function streetPower() {
  const t=clamp((world.daylight-.14)/.48,0,1);
  return 1-t*t*(3-2*t);
}
// Vẽ một đa giác tô phẳng.
function poly(color, ...p) {
  ctx.fillStyle=color;
  ctx.beginPath();
  ctx.moveTo(p[0],p[1]);
  for(let i=2;i<p.length;i+=2) ctx.lineTo(p[i],p[i+1]);
  ctx.fill();
}
// Vẽ quầng sáng elip với mép mờ.
function glow(x,y,rx,ry,color) {
  if(rx<1 || ry<1 || x+rx<0 || x-rx>w || y+ry<0 || y-ry>h) return;
  ctx.save();
  ctx.translate(x,y);
  ctx.scale(rx,ry);
  const g=ctx.createRadialGradient(0,0,0,0,0,1);
  g.addColorStop(0,color);
  g.addColorStop(1,'transparent');
  ctx.fillStyle=g;
  ctx.fillRect(-1,-1,2,2);
  ctx.restore();
}
// Chuyển tọa độ trên tuyến sang màn hình theo phối cảnh của xe.
function project(z,x=0,y=0) {
  const dx=center(z)-originX+x,dz=z-origin,dy=y+passSample(z,passHeights)-eye;
  const right=dx*yawCos-dz*yawSin;
  const forward=dx*yawSin+dz*yawCos;
  const depth=forward*pitchCos+dy*pitchSin;
  const scale=focal/Math.max(.72,depth);
  return {x:cx+right*scale,y:horizon-(dy*pitchCos-forward*pitchSin)*scale,s:scale,depth};
}
// Tạo nền thành phố và mây một lần mỗi khi đổi độ phân giải.
function makeSky(day=false) {
  const surface=document.createElement('canvas');
  surface.width=w*2; surface.height=Math.ceil(h*.62);
  const c=surface.getContext('2d');
  const g=c.createLinearGradient(0,0,0,surface.height);
  g.addColorStop(0,day?'#3d83be':'#0b153d');g.addColorStop(.52,day?'#8dc9e3':'#293d75');g.addColorStop(1,day?'#c8dee8':'#554271');
  c.fillStyle=g;c.fillRect(0,0,surface.width,surface.height);
  for(let i=0;!world3D&&i<68;i++){
    const x=hash(i+305)*surface.width,y=surface.height*(.19+hash(i+70)*.57);
    c.fillStyle=day?(i%3===0?'#becfe7':'#92b9d5'):(i%3===0?'#223667':'#1c2c59');
    c.beginPath();c.ellipse(x,y,w*(.015+hash(i)*.06),h*(.003+hash(i+8)*.012),-.08,0,TAU);c.fill();
  }
  const base=Math.round(h*HORIZON_RATIO);
  for(let i=0;!world3D&&i<115;i++){
    const bw=w*(.009+hash(i+32)*.019), x=i*surface.width/115;
    const bh=h*(.012+hash(i+99)**2*.105), y=base-bh;
    c.fillStyle=day?(i%3===0?'#65778e':'#536681'):(i%3===0?'#1e203a':'#13172d');c.fillRect(x,y,bw,bh);
    c.fillStyle=day?'#849bb0':'#34304d';c.fillRect(x,y,bw,1);
    for(let row=5;row<bh-3;row+=7) for(let col=4;col<bw-2;col+=6){
      const r=hash(i*918+row*13+col);
      if(r>.47){c.fillStyle=day?'#7c9db4':r>.88?'#c7a17a':r>.72?'#697ca6':'#394668';c.fillRect(x+col,y+row,2,2);}
    }
    if(!day&&i%11===0){c.fillStyle='#d87782';c.fillRect(x+bw/2,y-4,2,2);}
  }
  return surface;
}
// Cập nhật kích thước nội bộ theo cửa sổ và mức chất lượng.
function resize() {
  compactCockpit=innerWidth<650||matchMedia('(pointer: coarse)').matches;
  const budget=(compactCockpit?480000:1400000)*graphics.resolution**2;
  const scale=Math.min(devicePixelRatio,1.5,1520/innerWidth,Math.sqrt(budget/(innerWidth*innerHeight)));
  w=canvas.width=Math.round(innerWidth*scale); h=canvas.height=Math.round(innerHeight*scale);
  if(world3D){backdrop.width=w;backdrop.height=h;}
  sky=makeSky();daySky=makeSky(true);
  duskClouds=document.createElement('canvas');
  duskClouds.width=w*2;duskClouds.height=sky.height;
  const clouds=duskClouds.getContext('2d');
  for(let i=0;i<24;i++){
    const x=hash(i+683)*duskClouds.width,y=(.09+hash(i+952)*.62)*duskClouds.height;
    const span=w*(.03+hash(i+715)*.14),rise=h*(.007+hash(i+721)*.023);
    clouds.beginPath();
    clouds.moveTo(x-span,y);
    for(let j=0;j<=10;j++) clouds.lineTo(x+span*(j*.2-1),y-rise*hash(i*31+j));
    for(let j=10;j>=0;j--) clouds.lineTo(x+span*(j*.2-1),y+rise*.31*hash(i*37+j));
    clouds.closePath();
    clouds.fillStyle=i%3===0?'#f5a181':'#a5779a';
    clouds.fill();
  }
}
// Dựng hình thang của một dải mặt đường giữa hai lát cắt.
function strip(a,b,left,right,color) {
  poly(color,a.x+left*a.s,a.y,a.x+right*a.s,a.y,b.x+right*b.s,b.y,b.x+left*b.s,b.y);
}
// Vẽ mặt đường, lan can, vạch phân làn và ánh sáng theo chiều sâu.
function asphalt() {
  const step=3, first=Math.floor((origin+.75)/step)*step;
  const segments=[],around=foot.active||yawCos<.72;
  for(let i=around?-145:0;i<=145;i++){
    const z=first+i*step;
    if(!around&&z+step<=origin+.75) continue;
    const a=project(around?z:Math.max(z,origin+.75)),b=project(z+step);
    if(around?(a.depth<.72||b.depth<.72):(b.y>h+4||a.y<=b.y)) continue;
    segments.push({i,z,a,b});
  }
  segments.sort((a,b)=>b.a.depth-a.a.depth);
  for(const {i,z,a,b} of segments){
    const pulse=Math.max(0,1-Math.abs(mod(z+LAMP/2,LAMP)-LAMP/2)/13)*streetPower();
    const near=clamp(1-(z-origin)/80,0,1);
    const grey=Math.round(32+pulse*15+near*9);
    a.y+=.42;
    strip(a,b,-48,48,'#151829');
    const local=localRoadAt(z+1.5);
    if(local){
      const p=mod(z+1.5-local.start,LOOP);
      const near=localOffset(local,local.start+clamp(p-1.5,0,LOCAL_LENGTH-.001));
      const far=localOffset(local,local.start+clamp(p+1.5,0,LOCAL_LENGTH-.001));
      const side=local.side,outer=localWidth(local,z+1.5);
      const clipA=Math.max(6.1,5.85+exitWidth(z,side)),clipB=Math.max(6.1,5.85+exitWidth(z+3,side));
      const edgeA=Math.max(clipA,side*near+outer),edgeB=Math.max(clipB,side*far+outer);
      const innerA=clamp(side*near-3.15,clipA,edgeA),innerB=clamp(side*far-3.15,clipB,edgeB);
      poly('#35435c',a.x+side*innerA*a.s,a.y,a.x+side*edgeA*a.s,a.y,
        b.x+side*edgeB*b.s,b.y,b.x+side*innerB*b.s,b.y);
    }
    strip(a,b,-6.05,6.05,'#252539');
    strip(a,b,-ROAD/2,ROAD/2,`rgb(${grey+5+pulse*11},${grey+pulse*3},${grey+15-pulse*5})`);
    if(mod(z,12)<6) for(const x of [-1.9,1.9]) strip(a,b,x-.055,x+.055,'#c3c0d2');
    for(const side of [-1,1]){
      const branch=exitWidth(z,side),farBranch=exitWidth(z+step,side);
      if(branch+farBranch>0){
        poly('#25273c',a.x+side*5.65*a.s,a.y,a.x+side*(5.85+branch)*a.s,a.y,
          b.x+side*(5.85+farBranch)*b.s,b.y,b.x+side*5.65*b.s,b.y);
      }
      if(!localMergeAt(z+1.5,side)) poly('#aaa4b1',a.x+side*(5.49+branch)*a.s,a.y,a.x+side*(5.58+branch)*a.s,a.y,
        b.x+side*(5.58+farBranch)*b.s,b.y,b.x+side*(5.49+farBranch)*b.s,b.y);
      if(branch>1.25&&mod(z,9)<3) strip(a,b,side*5.45,side*5.56,'#c1c9d8');
      const l=project(around?z:Math.max(z,origin+.75),side*(6.04+branch),.65);
      const r=project(z+step,side*(6.04+farBranch),.65);
      if(!railPresent(z+1.5)||localMergeAt(z+1.5,side)) continue;
      poly('#38384b',l.x,l.y,l.x,l.y+.14*l.s,r.x,r.y+.14*r.s,r.x,r.y);
      if(i%2===0) poly('#777084',l.x,l.y,l.x+.07*l.s,l.y,l.x+.07*l.s,a.y,l.x,a.y);
      if(i%4===0){ctx.fillStyle=side===1?'#eac699':'#d5786d';ctx.fillRect(l.x-.07*l.s,l.y,.14*l.s,.055*l.s);}
    }
  }
  // Phủ ánh đèn cyan lên lề và mặt đường theo từng cột đèn đang nhìn thấy.
  for(let z=Math.ceil((origin+3)/LAMP)*LAMP;z<origin+180;z+=LAMP){
    const p=project(z,4.8+exitWidth(z,1));
    glow(p.x,p.y,p.s*4.6,Math.max(1,p.s*p.s*9/focal),`rgba(74,166,255,${streetPower()*.26})`);
    if(Math.round(z/LAMP)%2===0){
      const q=project(z,-4.8-exitWidth(z,-1));
      glow(q.x,q.y,q.s*4.6,Math.max(1,q.s*q.s*9/focal),`rgba(74,166,255,${streetPower()*.26})`);
    }
  }
  // Lớp sáng đèn pha mờ nằm trên phần đường gần xe.
  if(!foot.active&&streetPower()>0) glow(cx,h*.78,w*.35,h*.30,`rgba(158,185,243,${.17*streetPower()})`);
}
// Vẽ một cột đèn và quầng sáng cyan phía trong làn.
function lamp(z,side) {
  const branch=side*exitWidth(z,side);
  const base=project(z,side*6.5+branch), top=project(z,side*6.5+branch,7), bulb=project(z,side*5.35+branch,7);
  if(base.depth<1||base.s>180) return;
  ctx.strokeStyle='#6b5962';ctx.lineWidth=Math.max(1,base.s*.095);
  ctx.beginPath();ctx.moveTo(base.x,base.y);ctx.lineTo(top.x,top.y+base.s*.21);ctx.quadraticCurveTo(top.x,top.y,top.x-side*.22*base.s,top.y);ctx.lineTo(bulb.x,bulb.y);ctx.stroke();
  const power=streetPower();
  if(power>0) glow(bulb.x,bulb.y,Math.min(w*.24,base.s*.85),Math.min(h*.22,base.s*.65),`rgba(49,159,255,${.74*power})`);
  ctx.fillStyle=power>.08?'#b4f4ff':'#566781';ctx.fillRect(bulb.x-.21*base.s,bulb.y,Math.max(1,.42*base.s),Math.max(1,.09*base.s));
}
// Vẽ sàn cầu vượt, trụ cầu và bảng chỉ đường bằng phối cảnh.
function gantry(z,bridge) {
  const left=-7.4-exitWidth(z,-1),right=7.4+exitWidth(z,1);
  const l=project(z,left),r=project(z,right), a=project(z,left,6),b=project(z,right,6);
  const s=a.s;
  for(const [p,q] of [[l,a],[r,b]]) poly('#474152',p.x-.24*s,p.y,p.x+.24*s,p.y,q.x+.24*s,q.y,q.x-.24*s,q.y);
  ctx.fillStyle=bridge?'#39354b':'#625c72';
  ctx.fillRect(a.x-(bridge?8*s:0),a.y-(bridge?.75:.14)*s,b.x-a.x+(bridge?16*s:0),(bridge?1.05:.18)*s);
  if(bridge){ctx.fillStyle='#746070';ctx.fillRect(a.x-8*s,a.y-.69*s,b.x-a.x+16*s,.08*s);return;}
  const p=project(z,1.4,5.5);
  ctx.fillStyle='#9db7b1';ctx.fillRect(p.x-2.7*s,p.y-1.05*s,5.4*s,1.22*s);
  ctx.fillStyle='#1a514c';ctx.fillRect(p.x-2.65*s,p.y-s,5.3*s,1.12*s);
  if(s>11){ctx.fillStyle='#e0eee6';ctx.font=`600 ${.37*s}px system-ui`;ctx.textAlign='center';ctx.fillText('TRUNG TÂM',p.x,p.y-.53*s);ctx.font=`${.22*s}px system-ui`;ctx.fillText('ĐI BÊN PHẢI',p.x,p.y-.18*s);}
}
// Vẽ hình dáng và đèn hậu từng loại phương tiện ở chế độ 2D dự phòng.
function vehicle(z,x,color,braking,model=0,wreck=null,crash=null) {
  const p=project(z,x,terrainHeight(z,x)+(wreck?.y??crash?.hop??0)), s=p.s;
  if(p.x+2*s<0 || p.x-2*s>w || p.y>h+s) return;
  ctx.save();
  ctx.translate(p.x,p.y);
  ctx.scale(s,s);
  if(wreck) ctx.rotate(-wreck.roll);
  else if(crash) ctx.scale(1-.18*(crash.left+crash.right),1+crash.pitch*.6);
  if(model===4){
    poly('#0c1020',-.12,-.49,.12,-.49,.12,.01,-.12,.01);
    poly(color,-.27,-.48,-.36,-.71,-.18,-.85,.18,-.85,.36,-.71,.27,-.48);
    poly('#333d50',-.36,-.72,-.27,-.76,.27,-.76,.36,-.72,.24,-.64,-.24,-.64);
    ctx.fillStyle=braking?'#ffe3bf':'#ff5866';
    ctx.fillRect(-.13,-.66,.26,.12);
    ctx.restore();
    glow(p.x,p.y-.59*s,s*.32,s*.24,braking?'#ff513f9e':'#f1344f60');
    return;
  }
  if(model===5){
    poly('#0c1020',-1.15,-.56,-.79,-.56,-.79,.02,-1.15,.02);
    poly('#0c1020',1.15,-.56,.79,-.56,.79,.02,1.15,.02);
    poly(color,-1.2,-.45,-1.2,-2.65,1.2,-2.65,1.2,-.45);
    poly('#35425a',-1.12,-.53,-1.12,-2.55,1.12,-2.55,1.12,-.53);
    ctx.fillStyle='#9299ac';ctx.fillRect(-1,-2.49,2,.045);ctx.fillRect(-.023,-2.48,.046,1.84);
    ctx.fillStyle='#181e30';ctx.fillRect(-1.12,-.46,2.24,.23);
    ctx.fillStyle=braking?'#ffe3bf':'#ff5866';
    ctx.fillRect(-1.03,-.41,.28,.105);ctx.fillRect(.75,-.41,.28,.105);
    ctx.restore();
    for(const side of [-1,1]) glow(p.x+side*.89*s,p.y-.36*s,s*.42,s*.22,braking?'#ff513f9e':'#f1344f60');
    return;
  }
  poly('#0c1020',-.88,-.42,-.62,-.42,-.62,.04,-.88,.04);
  poly('#0c1020',.88,-.42,.62,-.42,.62,.04,.88,.04);
  poly(color,-.97,-.09,-.99,-.54,-.76,-.77,-.56,-1.19,.57,-1.19,.81,-.76,.98,-.54,.94,-.09);
  poly('#182138',-.68,-.77,-.49,-1.11,.49,-1.11,.69,-.77);
  poly('#8791aa45',-.56,-1.09,-.39,-1.09,-.02,-.8,-.51,-.8);
  poly('#56607a',-.49,-1.11,.49,-1.11,.45,-1.06,-.52,-1.06);
  poly('#221e31',-.94,-.5,.94,-.5,.88,-.17,-.88,-.17);
  ctx.fillStyle='#9992a9';ctx.fillRect(-.19,-.37,.38,.13);
  ctx.fillStyle=braking?'#ffb5a2':'#ff4f54';
  ctx.fillRect(-.91,-.48,.48,.15);ctx.fillRect(.43,-.48,.48,.15);
  ctx.fillStyle=braking?'#ffe3bf':'#ff9c8b';
  ctx.fillRect(-.88,-.46,.41,.032);ctx.fillRect(.47,-.46,.41,.032);
  ctx.fillStyle='#171827';ctx.fillRect(-.82,-.13,1.64,.045);
  ctx.restore();
  if(s>5){
    for(const side of [-1,1]) glow(p.x+side*.67*s,p.y-.4*s,s*(braking?.66:.37),s*.28,braking?'#ff513f9e':'#f1344f60');
  }
}
// Vẽ vô-lăng, táp-lô và đồng hồ tốc độ theo trạng thái thực của xe.
function motorcycleCockpit(alpha){
  ctx.save();ctx.globalAlpha=alpha;
  const size=Math.min(w*.67,h*.61);
  ctx.translate(w*.5,h*.89);ctx.scale(size,size);
  ctx.rotate(clamp(state.steer*.16+(state.roll??0)*.47,-.25,.25));
  poly('#26354a',-.26,.22,-.23,.04,-.13,-.075,.13,-.075,.23,.04,.26,.22);
  ctx.lineCap='round';ctx.lineWidth=.024;ctx.strokeStyle='#41495b';
  ctx.beginPath();ctx.moveTo(-.64,-.12);ctx.lineTo(-.34,-.077);ctx.lineTo(-.13,.014);
  ctx.lineTo(.13,.014);ctx.lineTo(.34,-.077);ctx.lineTo(.64,-.12);ctx.stroke();
  for(const side of [-1,1]){
    ctx.save();ctx.scale(side,1);
    ctx.strokeStyle='#86919a';ctx.lineWidth=.012;ctx.beginPath();
    ctx.moveTo(.38,-.064);ctx.lineTo(.50,-.176);ctx.stroke();
    poly('#232c3d',.42,-.175,.46,-.23,.61,-.226,.65,-.186,.61,-.15,.47,-.148);
    poly('#71859a',.45,-.18,.48,-.208,.60,-.207,.62,-.182,.59,-.166,.48,-.163);
    poly(foot.look.shirt[1],.66,.28,.48,.26,.43,-.06,.47,-.115,.55,-.089);
    poly(foot.look.skin[0],.432,-.087,.447,-.143,.54,-.138,.576,-.102,.546,-.067,.461,-.062);
    ctx.restore();
  }
  ctx.fillStyle='#192437';ctx.beginPath();ctx.ellipse(0,-.047,.088,.062,0,0,TAU);ctx.fill();
  ctx.font='600 .045px system-ui';ctx.textAlign='center';ctx.fillStyle='#d1eeed';
  ctx.fillText(String(Math.round(Math.abs(state.v)*3.6)),0,-.028);
  ctx.restore();
}
// Chiếu tâm khoang lái theo hướng xe vào camera đang nhìn.
function cockpitView(blend){
  if(foot.active||blend>=.99) return;
  const forward=Math.cos(viewLook.yaw);
  const down=(h*.80-horizon)/focal;
  const depth=forward*pitchCos-down*pitchSin;
  if(depth<=.22) return;
  const x=cx-focal*Math.sin(viewLook.yaw)/depth;
  const y=horizon+focal*(down*pitchCos+forward*pitchSin)/depth;
  const scale=1/depth;
  if(Math.abs(x-w*.5)>w*(.55+scale*.55)) return;
  ctx.save();
  ctx.translate(x,y);
  ctx.scale(scale,scale);
  ctx.translate(-w*.5,-h*.80);
  cockpit((1-blend)*clamp((depth-.22)/.34,0,1));
  ctx.restore();
}
function cockpit(alpha) {
  if(alpha<.01) return;
  if(state.model===4){motorcycleCockpit(alpha);return;}
  const dash=compactCockpit?.86:.76;
  const y=h*(dash+.03), s=Math.min(h*.42,w*.51), x=w*.50;
  ctx.save();ctx.globalAlpha=alpha;
  if(closedCabinView()) drawWindshieldFallback(h*dash);
  const pillar=compactCockpit?.62:1;
  poly('#101025',0,0,w*.028*pillar,0,w*.116*pillar,y,0,h);
  poly('#373145',w*.019*pillar,0,w*.028*pillar,0,w*.116*pillar,y,w*.104*pillar,y);
  poly('#18172c',w,0,w*(1-.018*pillar),0,w*(1-.077*pillar),y,w,h);
  poly('#363049',w*(1-.018*pillar),0,w*(1-.011*pillar),0,w*(1-.065*pillar),y,w*(1-.077*pillar),y);
  poly('#17182b',0,h*(dash+.08),w*.18,y,w*.37,h*dash,w*.70,h*(dash+.01),w*.86,h*(dash+.05),w,h*(dash+.10),w,h,0,h);
  poly('#302c42',0,h*(dash+.08),w*.18,y,w*.37,h*dash,w*.70,h*(dash+.01),w*.86,h*(dash+.05),w,h*(dash+.10),w,h*(dash+.115),w*.69,h*(dash+.05),w*.34,h*(dash+.045),0,h*(dash+.12));
  const lampLight=Math.max(0,1-Math.abs(mod(state.z+LAMP/2,LAMP)-LAMP/2)/11);
  glow(w*.62,y,s*2,s*.2,`rgba(51,160,255,${lampLight*.51*streetPower()})`);
  for(const side of [-1,1]){
    const vent=x+side*s*.59;
    ctx.fillStyle='#0d1020';ctx.fillRect(vent-s*.14,h*(dash+.11),s*.28,s*.079);
    ctx.fillStyle='#37334a';
    for(let i=1;i<5;i++) ctx.fillRect(vent-s*.13,h*(dash+.11)+i*s*.014,s*.26,Math.max(1,s*.004));
  }
  const mirrorW=s*.49,mirrorY=h*.030;
  ctx.fillStyle='#181b2c';ctx.fillRect(x-mirrorW*.5,mirrorY,mirrorW,s*.12);
  const mirror=ctx.createLinearGradient(0,mirrorY,0,mirrorY+s*.10);
  mirror.addColorStop(0,world.daylight>.35?'#8197a5':'#283958');
  mirror.addColorStop(1,'#20283a');
  ctx.fillStyle=mirror;ctx.fillRect(x-mirrorW*.46,mirrorY+s*.022,mirrorW*.92,s*.076);
  ctx.fillStyle='#353b4d';ctx.fillRect(x-s*.036,mirrorY-s*.035,s*.052,s*.035);
  const consoleX=x+s*.53,consoleY=h*(dash+.035);
  ctx.fillStyle='#111a26';ctx.fillRect(consoleX,consoleY,s*.51,s*.15);
  ctx.fillStyle='#648892';ctx.fillRect(consoleX+s*.038,consoleY+s*.031,s*.26,s*.012);
  ctx.fillStyle='#be765c';ctx.fillRect(consoleX+s*.38,consoleY+s*.042,s*.061,s*.045);
  ctx.fillStyle='#8a97a5';
  for(let i=0;i<4;i++) ctx.fillRect(consoleX+s*(.038+i*.076),consoleY+s*.090,s*.039,s*.015);
  ctx.fillStyle='#0a0c18';ctx.beginPath();ctx.ellipse(x,h*(dash+.127),s*.49,s*.25,0,0,TAU);ctx.fill();
  const dialY=h*(dash+.135), radius=s*.188, angle=Math.PI*.78;
  ctx.strokeStyle='#f0b777';ctx.lineWidth=Math.max(1,s*.005);
  for(let i=0;i<=18;i++){
    const a=angle+i*Math.PI*1.44/18;
    ctx.beginPath();ctx.moveTo(x+Math.cos(a)*radius*.84,dialY+Math.sin(a)*radius*.84);ctx.lineTo(x+Math.cos(a)*radius,dialY+Math.sin(a)*radius);ctx.stroke();
  }
  const needle=angle+state.v*3.6/180*Math.PI*1.44;
  ctx.strokeStyle='#ff6b52';ctx.lineWidth=Math.max(2,s*.01);ctx.beginPath();ctx.moveTo(x,dialY);ctx.lineTo(x+Math.cos(needle)*radius*.8,dialY+Math.sin(needle)*radius*.8);ctx.stroke();
  ctx.translate(x,h*(compactCockpit?1.09:1.094));ctx.rotate(state.steer*.37);
  ctx.strokeStyle='#0a0b14';ctx.lineWidth=s*.075;ctx.beginPath();ctx.arc(0,0,s*.60,0,TAU);ctx.stroke();
  ctx.strokeStyle='#4d3c51';ctx.lineWidth=s*.012;ctx.beginPath();ctx.arc(0,0,s*.631,Math.PI,TAU);ctx.stroke();
  poly('#171622',-s*.59,-s*.11,-s*.2,-s*.015,s*.2,-s*.015,s*.59,-s*.11,s*.54,s*.05,0,s*.14,-s*.54,s*.05);
  // Gắn hai bàn tay lên vành để chúng xoay cùng vô-lăng khi đánh lái.
  for(const side of [-1,1]){
    ctx.save();ctx.scale(side*s,s);ctx.translate(.48,-.345);ctx.rotate(.58);
    poly('#171a31',.055,.045,.175,.059,.22,.38,.095,.39,-.008,.13);
    poly('#985f58',-.12,-.019,-.089,-.108,-.018,-.13,.087,-.078,.113,-.013,.102,.109,.035,.139,-.053,.069);
    poly('#d69075',-.109,-.039,-.067,-.106,.026,-.107,.082,-.066,.083,-.02,.022,.008,-.036,.055,-.075,.04);
    poly('#e7a184',-.107,-.03,-.058,-.023,-.024,.022,-.05,.057,-.098,.018);
    poly('#563d4a',-.015,-.097,.063,-.075,.08,-.058,.015,-.068);
    ctx.restore();
  }
  ctx.restore();
}
// Tích lũy chuyển động biểu kiến của mưa tuyết, giúp hạt tăng tốc dần khi xe tăng ga.
function advancePrecipitation(dt) {
  const response=1-Math.exp(-3.6*dt);
  precipitation.speed=lerp(precipitation.speed,clamp(Math.abs(state.v)/50,0,1),response);
  precipitation.side=lerp(precipitation.side,clamp(state.lateral/6,-1,1),response);
  precipitation.rainTravel+=dt*(.72+precipitation.speed*.56);
  precipitation.rainDrift+=dt*(-.044-precipitation.side*.056);
}
// Cập nhật ngày đêm và pha trộn thời tiết khi tuyến đường bước sang mùa kế tiếp.
function advanceWorld(dt) {
  world.time+=dt;
  advancePrecipitation(dt);
  const time=conditions.time[0].value, weather=conditions.weather[0].value;
  const progress=mod(world.time+(usesAnimatedTheme()?DAY_SECONDS*.732:0),DAY_SECONDS)/DAY_SECONDS;
  const elevation=-Math.cos(progress*TAU);
  const sun=clamp((elevation+.17)/.58,0,1);
  world.daylight=time==='auto'?sun*sun*(3-2*sun):({dawn:.54,day:1,dusk:.42,night:0})[time];
  world.twilight=time==='auto'?Math.max(0,1-Math.abs(elevation)*4):Number(time==='dawn'||time==='dusk');
  world.fog=Number(weather==='fog');
  const cycle=Math.floor(world.time/SEASON_SECONDS), current=(world.first+cycle)%3;
  const fraction=cycle===0?1:clamp(mod(world.time,SEASON_SECONDS)/5,0,1);
  world.weather.fill(0);
  if(weather==='auto'){
    world.weather[(current+2)%3]=1-fraction;
    world.weather[current]=fraction;
  }else{
    world.weather[({rain:0,clear:1,leaves:2,fog:1})[weather]??1]=1;
  }
  const windAngle=.45+Math.sin(world.time*.045)*1.25;
  wind.x=Math.cos(windAngle);wind.z=Math.sin(windAngle);
  wind.strength=.24+world.weather[0]*.43+world.weather[2]*.21
    +.18*(.5+.5*Math.sin(world.time*.88)*Math.sin(world.time*.26));
  const azimuth=time==='auto'?lerp(-.85,.85,clamp((progress-.25)*2,0,1)):({dawn:-.27,day:.18,dusk:.38,night:0})[time];
  const altitude=time==='auto'?elevation*.57:({dawn:.09,day:.38,dusk:.075,night:-.45})[time];
  world.sun[0]=Math.sin(azimuth)*Math.cos(altitude);
  world.sun[1]=Math.sin(altitude);
  world.sun[2]=Math.cos(azimuth)*Math.cos(altitude);
  const obscured=clamp(world.weather[0]*.80+world.fog*.92,0,1);
  world.sunStrength=clamp((altitude+.025)*12,0,1)*(1-obscured);
  world.stars=(1-world.daylight)**2*(1-obscured);

}
function closedCabinView(){
  return !foot.active&&state.model!==4&&state.camera<.24&&!state.wreck&&!wreckExpired(state);
}
// Tọa độ UV bám theo kính chắn gió, v tăng từ chân kính lên trên.
function windshieldWeather(drop,blade){
  if(!state.started) return;
  const [rain,,leaves]=world.weather;
  const exposure=inTunnel(state.z)?0:1;
  const period=lerp(2.8,1.55,rain);
  const cycle=mod(world.time,period)/period;
  const parked=.13,range=Math.PI-2*parked;
  const angle=parked+range*(1-Math.abs(2*cycle-1));
  const pivot=.055,reachX=.43,reachY=.76;
  if(rain>.06){
    for(const [x,y,seed] of particles){
      if(seed>rain*.80) continue;
      const u=.03+x*.94;
      const v=.075+.88*mod(y-world.time*(.052+seed*.071),1);
      const dx=(u-.5)/reachX,dy=(v-pivot)/reachY;
      const radius=Math.hypot(dx,dy);
      let wetness=1;
      const dropAngle=Math.atan2(dy,dx);
      const crossing=(dropAngle-parked)/range;
      if(radius>=.10&&radius<=1&&crossing>=0&&crossing<=1){
        const since=Math.min(mod(cycle-crossing*.5,1),mod(cycle-(1-crossing*.5),1))*period;
        wetness=Math.abs(dropAngle-angle)<.055?0:clamp((since-.10)/.74,0,1);
      }
      const alpha=wetness*rain*(.42+seed*.38)*(exposure||.30);
      if(alpha>.025) drop(u,v,.003+seed*.005,.008+seed*.017,alpha,'#cce9ff');
    }
    const du=reachX*Math.cos(angle),dv=reachY*Math.sin(angle);
    blade(.5,pivot,.5+du,pivot+dv);
  }
  if(exposure&&leaves>.08){
    for(let i=0;i<12;i++){
      const [x,y,seed]=particles[i];
      const t=mod(world.time*(.39+seed*.18)+y,1);
      if(t>=.23) continue;
      drop(.08+x*.84,.82-t*2.8,.011,.017,leaves*(1-t/.23)*.74,'#d38a43');
    }
  }
}
function drawWindshieldFallback(bottom){
  const top=h*.05,left=w*.12,width=w*.76,height=bottom-top;
  const y=v=>bottom-v*height;
  ctx.save();
  ctx.beginPath();ctx.rect(left,top,width,height);ctx.clip();
  windshieldWeather((u,v,du,dv,alpha,color)=>{
    ctx.globalAlpha=alpha;ctx.fillStyle=color;
    ctx.beginPath();ctx.ellipse(left+u*width,y(v),du*width,dv*height,0,0,TAU);ctx.fill();
  },(u,v,toU,toV)=>{
    ctx.globalAlpha=1;ctx.strokeStyle='#151a21';ctx.lineWidth=Math.max(2,width*.014);
    ctx.beginPath();ctx.moveTo(left+u*width,y(v));ctx.lineTo(left+toU*width,y(toV));ctx.stroke();
  });
  ctx.restore();
}
// Vẽ hạt ngoài kính với quãng đường tích lũy, không đổi chỗ tức thì khi tốc độ đổi.
function windStrokes(){
  if(!state.started||inTunnel(origin)) return;
  const storm=wind.strength,cell=Math.floor(origin/20);
  ctx.save();ctx.lineCap='round';
  for(let j=cell-4;j<=cell+4;j++){
    const i=mod(j,LOOP/20), seed=hash(i+313);
    const phase=mod(world.time*(.17+storm*.11)+seed,1);
    const z=j*20+hash(i+911)*12;
    const offset=(hash(i+591)-.5)*38+(phase-.5)*48;
    const height=1.15+hash(i+732)*6.8;
    const span=(3+seed*7)*(.64+.58*Math.sin(Math.PI*phase));
    const alpha=Math.sin(Math.PI*phase)**2*(.22+storm*.28);
    const curl=world.time*2.3+seed*TAU;
    const curve=t=>project(z+t*span*wind.z,offset+t*span*wind.x,
      height+Math.sin(t*Math.PI)*(.58+.31*Math.sin(curl-t*4))+.34*t*Math.sin(curl+t*5));
    ctx.strokeStyle='#e2f7ff';
    ctx.lineWidth=Math.max(.65,h*.00115)*(.85+.32*Math.sin(Math.PI*phase));
    for(let j=1;j<=10;j++){
      const p=(j-1)/10,q=j/10;
      const a=curve(p),b=curve(q);
      if(a.depth<2||b.depth<2) continue;
      ctx.globalAlpha=alpha*Math.sin((p+q)*Math.PI*.5);
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    }
  }
  ctx.restore();
}
function weatherOverlay() {
  const [rain,,leaves]=world.weather;
  if(rain+leaves<.01) return;
  // Giữ mưa và lá ở ngoài hầm khi camera đi dưới mái.
  const phase=tunnelOffset(origin);
  const exposure=inTunnel(origin)?clamp(1-Math.min(phase,TUNNEL_LENGTH-phase)/6,0,1):1;
  if(exposure===0&&world3D&&!world3D.canvas.hidden) return;
  ctx.save();
  const outdoors=world3D&&!world3D.canvas.hidden?exposure:1;
  const now=world.time,{speed,side,rainTravel,rainDrift}=precipitation;
  const size=Math.max(1,h/740);
  for(const [x,y,seed] of particles){
    if(rain>.01){
      const t=mod(y+rainTravel*(.76+seed*.57),1.16)-.08;
      const dx=mod(x+rainDrift*(.76+seed*.54),1.06)*w, dy=t*h;
      const length=size*(6+seed*14+speed*(9+seed*13));
      const tilt=-.26-side*.24+(dx/w-.5)*speed*.88;
      ctx.strokeStyle='#c3e6ff';ctx.globalAlpha=rain*outdoors*(.14+seed*.31);
      ctx.lineWidth=size*(.68+seed*.55);
      ctx.beginPath();ctx.moveTo(dx,dy);ctx.lineTo(dx+length*tilt,dy+length);ctx.stroke();
    }
    if(leaves>.01&&seed>.55){
      const dx=mod(x+now*(.08+seed*.043)+Math.sin(now*2+y*TAU)*.028,1)*w;
      const dy=mod(y+now*(.09+seed*.072),1)*h;
      const span=size*(1.8+seed*3.6);
      ctx.globalAlpha=leaves*outdoors*(.45+seed*.43);
      poly(seed>.75?'#e29744':'#aa5839',dx-span,dy,dx,dy-span*.62,dx+span,dy,dx,dy+span*.64);
    }
  }
  ctx.restore();
}
// Kết xuất cùng một thế giới cho cả hai vị trí camera và vùng chuyển tiếp.
// Nước xa dùng cùng màu với mép lưới biển để nối thẳng tới chân trời phối cảnh.
function distantSeaColor(){
  const daylight=world.daylight, mist=world.fog*.10;
  return [lerp(.075,.38,daylight)+mist,lerp(.134,.57,daylight)+mist,lerp(.224,.63,daylight)+mist];
}
function seaAtHorizon(screenX){
  const right=(screenX-cx)*pitchCos/focal;
  const dx=yawSin+right*yawCos,dz=yawCos-right*yawSin;
  const farZ=origin+graphics.road*clamp(1+yawCos,.06,1);
  const backZ=origin-graphics.road*clamp(1-yawCos,.06,1);
  const limit=dz>0?(farZ-origin)/dz:dz<0?(backZ-origin)/dz:Infinity;
  for(let t=0;;t+=24){
    const sample=Math.min(t,limit),z=origin+dz*sample;
    const across=originX+dx*sample-center(z);
    if(Math.abs(across)<185&&sample<limit) continue;
    const area=district(z);
    return area===4||(area===3&&across>coastShore(z).edge);
  }
}
function drawSeaHorizon(background,skyLine,focus){
  const area=district(focus);
  if((area!==3&&area!==4)||skyLine>=h) return;
  const [r,g,b]=distantSeaColor().map(channel=>Math.round(channel*255));
  background.fillStyle=`rgb(${r},${g},${b})`;
  const step=Math.max(4,Math.ceil(w/96));
  let start=null;
  for(let x=0;x<w;x+=step){
    if(seaAtHorizon(Math.min(w,x+step*.5))) start??=x;
    else if(start!==null){
      background.fillRect(start,skyLine,x-start,h-skyLine);
      start=null;
    }
  }
  if(start!==null) background.fillRect(start,skyLine,w-start,h-skyLine);
}
function cameraGround(z,worldX){
  return passSample(z,passHeights)+terrainHeight(z,worldX-center(z));
}
function cabinViewProfile(model){
  if(model===5) return {x:-.47,z:1.75,y:2.14};
  if(model===4) return {x:0,z:-.12,y:1.54};
  return {x:-.32,z:.28,y:vehicleProfile(model).roof-.15};
}
function blendFromDisplayedCamera(duration,orbitCar=null){
  if(!displayedCamera) return;
  const orbit=orbitCar?{z:orbitCar.z,x:center(orbitCar.z)+orbitCar.x}:null;
  cameraTransfer={from:displayedCamera,elapsed:0,duration,orbit};
}
function orbitToDrivingCamera(from,orbit,weight){
  const z=state.z,x=center(z)+state.x;
  const near=relativeDistance(orbit.z,from.z),far=relativeDistance(z,origin);
  const startAngle=Math.atan2(from.x-orbit.x,near);
  const endAngle=Math.atan2(originX-x,far);
  const turn=mod(endAngle-startAngle+Math.PI,TAU)-Math.PI;
  const angle=startAngle+turn*weight;
  const radius=lerp(Math.hypot(from.x-orbit.x,near),Math.hypot(originX-x,far),weight);
  origin=orbit.z+relativeDistance(orbit.z,z)*weight+Math.cos(angle)*radius;
  originX=lerp(orbit.x,x,weight)+Math.sin(angle)*radius;
}
function draw() {
  const dt=cameraStep;
  cameraStep=0;
  const blend=state.camera*state.camera*(3-2*state.camera);
  const scene=foot.active?vehicleTakeover:null;
  const focus=scene?.cameraFocus;
  const preview=foot.active?(focus?.z??foot.z):state.z;
  focal=Math.max(h*(compactCockpit?lerp(.57,.76,blend):.79),w*.57);cx=w*.5+state.hit*Math.sin(state.hit*50)*w*.014;
  // Dùng cùng một đường chân trời cho phối cảnh 3D và chân tòa nhà nền.
  horizon=Math.round(h*(foot.active?(foot.firstPerson?.43:.48):lerp(HORIZON_RATIO,.59,blend)));
  // Lùi camera đủ xa để thấy toàn bộ thân 3D kể cả trên màn hình dọc.
  const followYaw=(foot.active?foot.cameraYaw:carYaw(state))+viewLook.yaw;
  const footView=foot.active&&foot.firstPerson;
  const truck=!foot.active&&state.model===5;
  const cabin=foot.active?null:cabinViewProfile(state.model);
  const distance=foot.active?(footView?0:5.8):lerp(-cabin.z,chase.distance+(truck?5.5:0),blend);
  const targetX=center(preview)+(foot.active?(focus?.x??foot.x):state.x);
  const carAngle=carYaw(state);
  const mountYaw=cabin&&state.camera<.24?carAngle:followYaw;
  origin=preview-Math.cos(mountYaw)*distance;
  originX=targetX-Math.sin(mountYaw)*distance+(foot.active?0:Math.cos(followYaw)*chase.offset*blend);
  if(cabin){
    originX+=Math.cos(carAngle)*cabin.x*(1-blend);
    origin-=Math.sin(carAngle)*cabin.x*(1-blend);
  }
  const step=foot.moving&&foot.grounded?Math.cos(foot.stride*TAU*2)*.031:0;
  const footLift=foot.y-terrainHeight(foot.z,foot.x);
  const footEye=foot.fall?Math.max(.32,footLift+.38):footLift+1.56*foot.look.scale+step;
  const eyeOffset=foot.active?(footView?footEye:2.25+(focus?0:footLift))
    :lerp(cabin.y,chase.height+(truck?2.85:0),blend);
  const cameraY=cameraGround(preview,targetX)+eyeOffset;
  if(foot.active&&!footView){
    // Giữ camera phía trước vật cản nằm trên đoạn từ nhân vật đến camera.
    let clearDistance=distance;
    for(let length=.4;length<=distance;length+=.35){
      const z=preview-Math.cos(followYaw)*length, x=targetX-Math.sin(followYaw)*length;
      if(!footBlocked(z,x-center(z),cameraY-passSample(z,passHeights))) continue;
      clearDistance=Math.max(.05,length-.4);
      break;
    }
    if(focus){
      scene.cameraDistance??=clearDistance;
      scene.cameraDistance=lerp(scene.cameraDistance,clearDistance,1-Math.exp(-Math.min(dt,.05)*8));
      clearDistance=scene.cameraDistance;
    }
    origin=preview-Math.cos(followYaw)*clearDistance;
    originX=targetX-Math.sin(followYaw)*clearDistance;
  }
  const ground=cameraGround(origin,originX);
  const mountGround=cabin?lerp(passSample(origin,passHeights)+terrainHeight(preview,state.x),ground,clamp(state.camera/.24,0,1)):ground;
  eye=mountGround+Math.max(.36,eyeOffset);
  let yaw=followYaw,pitch=viewLook.pitch;
  if(cameraTransfer){
    const {from,elapsed,duration,orbit}=cameraTransfer;
    const t=clamp(elapsed/duration,0,1),weight=t*t*(3-2*t);
    if(orbit) orbitToDrivingCamera(from,orbit,weight);
    else{
      origin=from.z+relativeDistance(from.z,origin)*weight;
      originX=lerp(from.x,originX,weight);
    }
    eye=lerp(from.eye,eye,weight);
    yaw=from.yaw+(mod(yaw-from.yaw+Math.PI,TAU)-Math.PI)*weight;
    pitch=lerp(from.pitch,pitch,weight);
    focal=lerp(from.focal,focal,weight);
    cx=lerp(from.cx,cx,weight);
    horizon=lerp(from.horizon,horizon,weight);
  }
  displayedCamera={z:origin,x:originX,eye,yaw,pitch,focal,cx,horizon};
  tangent=slope(origin);
  yawCos=Math.cos(yaw);yawSin=Math.sin(yaw);
  pitchCos=Math.cos(pitch);pitchSin=Math.sin(pitch);
  const skyLine=clamp(horizon+focal*Math.tan(pitch),0,h);
  const skyHeight=Math.max(sky.height,skyLine+1);
  // Xếp các canvas bằng trình duyệt để tránh sao chép ảnh từ GPU về Canvas 2D.
  const render3D=world3D?.draw();
  if(world3D) world3D.canvas.hidden=!render3D;
  const background=render3D?backdropCtx:ctx;
  background.fillStyle='#111629';background.fillRect(0,0,w,h);
  // Neo bầu trời và đường chân trời vào màn hình khi xe chạy, rẽ hoặc đổi camera.
  background.drawImage(sky,-w*.5-clamp(viewLook.yaw,-1,1)*w*.36,0,w*2,skyHeight);
  if(world.daylight>.001){
    background.globalAlpha=world.daylight;
    background.drawImage(daySky,-w*.5-clamp(viewLook.yaw,-1,1)*w*.36,0,w*2,skyHeight);
    background.globalAlpha=1;
  }
  if(world.twilight>.001){
    const animated=usesAnimatedTheme();
    const dusk=background.createLinearGradient(0,skyLine*.35,0,skyLine);
    dusk.addColorStop(0,animated?'#75518f00':'#ef866a00');
    if(animated) dusk.addColorStop(.55,`rgba(180,89,126,${world.twilight*.65})`);
    dusk.addColorStop(1,`rgba(246,143,108,${world.twilight*(animated?.82:.42)})`);
    background.fillStyle=dusk;background.fillRect(0,skyLine*.35,w,skyLine*.65);
    if(animated){
      background.globalAlpha=world.twilight*world.sunStrength*.78;
      background.drawImage(duskClouds,-w*.5-clamp(viewLook.yaw,-1,1)*w*.36,0,w*2,skyHeight);
      background.globalAlpha=1;
    }
  }
  // Lấp dải ở xa ngoài tầm kết xuất bằng màu sương của mặt đất.
  const sun=world.daylight;
  background.fillStyle=sun>.001?`rgb(${Math.round(29+121*sun)},${Math.round(40+131*sun)},${Math.round(75+114*sun)})`:DISTANT_GROUND;
  background.fillRect(0,skyLine,w,h-skyLine);
  if(render3D) drawSeaHorizon(background,skyLine,preview);
  if(world.fog){
    background.fillStyle=sun>.3?'#c3d5df88':'#738ba481';
    background.fillRect(0,0,w,skyLine);
  }
  drawCelestialSky(background,skyLine);
  if(render3D){
    ctx.clearRect(0,0,w,h);
    if(!closedCabinView()){windStrokes();weatherOverlay();}
    return;
  }
  asphalt();
  const objects=[];
  for(let z=Math.ceil((origin+((foot.active||yawCos<.72)?-FAR:2))/LAMP)*LAMP;z<origin+FAR;z+=LAMP) objects.push({z,type:'lamp'});
  for(let i=Math.ceil((origin-((foot.active||yawCos<.72)?FAR:20))/240);i*240+25<origin+FAR;i++){
    const z=i*240+25;
    if(foot.active||yawCos<.72||z>origin+1.5) objects.push({z,type:i%2===0?'bridge':'sign'});
  }
  for(const car of traffic){
    const d=relativeDistance(origin,car.z);
    if(Math.abs(d)<FAR&&project(origin+d,car.x).depth>1.8) objects.push({z:origin+d,type:'car',car});
  }
  const parkedDepth=relativeDistance(origin,state.z);
  if(!wreckExpired(state)&&(foot.active||blend>.24)&&Math.abs(parkedDepth)<FAR&&project(origin+parkedDepth,state.x).depth>1)
    objects.push({z:origin+parkedDepth,type:'player'});
  if(foot.active&&!foot.firstPerson) objects.push({z:foot.z,type:'pedestrian'});
  for(const road of localRoads){
    const z=origin+relativeDistance(origin,road.start+LOCAL_JUNCTION);
    const x=localOffset(road,z)-road.side*3.55;
    if(Math.abs(z-origin)<FAR&&project(z,x).depth>1) objects.push({z,x,road,type:'signal'});
  }
  for(const rider of sceneRiders()){
    const z=origin+relativeDistance(origin,rider.z);
    if(Math.abs(z-origin)<FAR&&project(z,rider.x,rider.y).depth>1)
      objects.push({z,type:'rider',x:rider.x,rider});
  }
  eachTrailProp(origin-FAR,origin+FAR,(x,z,y,width,height,length,area)=>{
    if(project(z,x-center(z)).depth>1) objects.push({z,type:'prop',x:x-center(z),y,width,height,length,area});
  });
  // Sắp xếp từ xa đến gần để vật gần che đúng vật xa.
  objects.sort((a,b)=>project(b.z,b.car?.x??b.x??0).depth-project(a.z,a.car?.x??a.x??0).depth);
  for(const obj of objects){
    if(project(obj.z,obj.car?.x??obj.x??0).depth<.75&&obj.type!=='pedestrian'&&obj.type!=='player') continue;
    if(obj.type==='lamp'){lamp(obj.z,1);if(Math.round(obj.z/LAMP)%2===0) lamp(obj.z,-1);}
    else if(obj.type==='car') vehicle(obj.z,obj.car.x,scorchAmount(obj.car)>.48?'#161519':obj.car.color,obj.car.brake,obj.car.model,obj.car.wreck,obj.car.crash);
    else if(obj.type==='signal'){
      const a=project(obj.z,obj.x),b=project(obj.z,obj.x,4.2);
      ctx.strokeStyle='#74839c';ctx.lineWidth=Math.max(1,a.s*.10);
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
      const color={red:'#ff4549',amber:'#ffd25e',green:'#62fcb6'}[localSignal(obj.road)];
      ctx.fillStyle='#242739';ctx.fillRect(b.x-.22*a.s,b.y,.44*a.s,.89*a.s);
      ctx.fillStyle=color;ctx.fillRect(b.x-.12*a.s,b.y+.3*a.s,.24*a.s,.22*a.s);
    }
    else if(obj.type==='prop'){
      const p=project(obj.z,obj.x,obj.y);
      ctx.fillStyle=obj.area===2?'#777e77':'#786c57';
      ctx.fillRect(p.x-p.s*obj.width*.5,p.y-p.s*obj.height,p.s*obj.width,p.s*obj.height);
    }
    else if(obj.type==='pedestrian') drawFootFallback(foot,foot.z,foot.fall);
    else if(obj.type==='rider') drawFootFallback(obj.rider,obj.z,riderFallPose(obj.rider));
    else if(obj.type==='player'){
      ctx.save();ctx.globalAlpha=foot.active?1:clamp((blend-.24)*3,0,1);vehicle(obj.z,state.x,scorchAmount(state)>.48?'#161519':state.color,active('brake')||auto.brake,state.model,state.wreck,state.crash);ctx.restore();
    } else gantry(obj.z,obj.type==='bridge');
  }
  // Nhấc tông cảnh 2D dự phòng theo chu kỳ ngày đêm.
  if(sun>.001){
    ctx.fillStyle=`rgba(172,207,236,${sun*.26})`;ctx.fillRect(0,horizon,w,h-horizon);
  }
  drawDamageFallback();
  if(!closedCabinView()){windStrokes();weatherOverlay();}
  cockpitView(blend);
}
// Đọc một hành động từ cả bàn phím và đa chạm.
function active(action) {
  if(keys.has(action)) return true;
  for(const entry of fingers.values()) if(entry.dataset.control===action) return true;
  return false;
}
// Tra kích thước, tốc độ tuần tra và giới hạn đổi làn theo loại phương tiện.
function vehicleProfile(model) {
  if(model===4) return motorcycleProfile;
  if(model===5) return truckProfile;
  return sedanVariants[model]??carProfile;
}
// Hiệu chỉnh khoảng cách theo chiều dài thân xe, lấy sedan làm mốc.
function vehicleGap(distance,fromModel,toModel) {
  return Math.max(0,Math.abs(distance)+2*carProfile.halfLength
    -vehicleProfile(fromModel).halfLength-vehicleProfile(toModel).halfLength);
}
// Xung lực theo phương va chạm và mô-men theo điểm tiếp xúc.
function carImpact(a,b){
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
const crashDebris=[];
function recordCrash(car,nx,nz,kick,closing){
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
function stepCrashDebris(dt){
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
function damageVehicle(car,kick,closing){
  if(soloDrive&&car===state||closing<2.3||car.damage?.stage==='exploded') return;
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
function updateVehicleDamage(car){
  const damage=car.damage;
  if(damage?.stage!=='fire'||world.time<damage.explodeAt) return;
  damage.stage='exploded';damage.stamp=world.time;
  car.v*=.35;
  if(!car.wreck){
    car.wreck={sign:1,roll:0,spin:1.2,y:0,vy:1.85,blastOnly:true};
  }else car.wreck.vy=Math.max(1.85,car.wreck.vy);
}
function scorchAmount(car){
  if(car.damage?.stage!=='exploded') return 0;
  return clamp((world.time-car.damage.stamp)/.62,0,1);
}
function damageParticles(car,z,visit){
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
function drawDamageFallback(){
  for(const part of crashDebris){
    const z=origin+relativeDistance(origin,part.z);
    const p=project(z,part.x,part.y);
    if(p.depth<1||p.depth>140) continue;
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(part.angle);
    ctx.globalAlpha=clamp((part.life-part.age)*3,0,1);ctx.fillStyle=part.color;
    ctx.fillRect(-part.size*p.s,-part.size*p.s*.25,part.size*p.s*2,part.size*p.s*.5);
    ctx.restore();
  }
  for(const car of [state,...traffic]){
    const z=origin+relativeDistance(origin,car.z);
    if(Math.abs(z-origin)>140) continue;
    damageParticles(car,z,(x,y,z,radius,color,alpha)=>{
      const p=project(z,x-center(z),y);
      if(p.depth<1) return;
      ctx.save();ctx.globalAlpha=alpha;ctx.fillStyle=color;ctx.beginPath();
      ctx.ellipse(p.x,p.y,radius*p.s,radius*p.s*.78,0,0,TAU);ctx.fill();ctx.restore();
    });
  }
}
function wreckExpired(car){
  if(car.damage?.stage==='exploded') return world.time-car.damage.stamp>=5;
  if(car.wreck?.dismount&&car.damage?.stage!=='fire') return false;
  if(car.model===4&&car.wreck?.rider&&car.damage?.stage!=='fire'&&world.time-car.wreck.since<25) return false;
  return (car.wreck?.sideTime??0)>=5-1e-8;
}
function clearExpiredWrecks(){
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
function engineBlocked(car){
  return car.damage?.stage==='exploded';
}
// Thân mô tô và người lái có vận tốc, trọng lực và ma sát riêng sau va chạm.
function motorcyclePassenger(model,random=Math.random){
  return model===4&&random()<.39?newCharacter(random):null;
}
function carPassengers(model,random=Math.random){
  if(model<0||model>3) return [];
  return [.53,.33,.17].map(chance=>random()<chance?newCharacter(random):null);
}
function drivingLook(car){return car===state?foot.look:car.driver??foot.look;}
function tipMotorcycle(car,nx,nz,kick){
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
    previousCamera=state.target;
    setAutopilot(false);
    Object.assign(foot,rider,{active:true,grounded:false,cameraYaw:rider.angle,moving:false,stride:0,fall:rider});
    state.target=1;
    showCameraPanel(false);
    syncVehicleControls();
  }
}
function riderBlocked(z,x,y){
  const side=Math.sign(x);
  if(walkLimit(z,x)!==x) return true;
  if(y<.68&&railAt(z,side)&&Math.abs(Math.abs(x)-6-exitWidth(z,side))<.24) return true;
  return solidScenery(z,x,.25,y);
}
// Kiểm tra cả hai đầu thân đang nghiêng để tránh xuyên lan can hoặc xe khác.
function fallenBodyBlocked(rider,z,x,y){
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
function fallenSupport(rider){
  let support=terrainHeight(rider.z,rider.x);
  const bottom=rider.y-(rider.low?0:Math.abs(Math.cos(rider.tilt))*.80*(rider.look?.scale??1));
  onProp(rider.z,rider.x,top=>{if(bottom>=top-.12) support=Math.max(support,top);});
  for(const car of [state,...traffic]){
    const top=terrainHeight(car.z,car.x)+vehicleProfile(car.model).roof;
    if(bottom>=top-.12&&footHitsCar(rider.z,rider.x,car)) support=Math.max(support,top);
  }
  return support;
}
function recoverRider(rider,dt){
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
function moveFallenRider(rider,dt){
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
function stepRider(rider,dt){
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
function wreckClearance(car){
  const {roll,pitch=0}=car.wreck;
  const {roof,halfWidth,halfLength}=vehicleProfile(car.model);
  const lean=Math.cos(roll),tilt=Math.cos(pitch);
  const height=(lean>=0?.35:roof-.35)*Math.abs(lean)+halfWidth*.94*Math.abs(Math.sin(roll));
  return Math.max(0,height*tilt+halfLength*.83*Math.abs(Math.sin(pitch))-.35);
}
function stepWreck(car,dt){
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
function vehiclePoint(car,across,along){
  const yaw=carYaw(car),sin=Math.sin(yaw),cos=Math.cos(yaw);
  const z=mod(car.z+along*cos-across*sin,LOOP);
  return {z,x:center(car.z)+car.x+across*cos+along*sin-center(z)};
}
function standingPosition(person){
  person.y=terrainHeight(person.z,person.x);
  person.grounded=true;
}
function stepReturningRider(car,dt){
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
function settleCar(car,dt){
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
// Tạo dòng xe gồm ô tô, mô tô và xe tải trên ba làn, mỗi loại có tốc độ phù hợp.
function seedTraffic(avoid=null) {
  const spacing=LOOP/MAX_TRAFFIC_VEHICLES;
  const start=avoid?avoid.z+spacing/2:17;
  for(let i=0;i<MAX_TRAFFIC_VEHICLES&&traffic.length<MAX_TRAFFIC_VEHICLES;i++){
    const lane=i%3, model=trafficModels[i%trafficModels.length];
    const cruise=(22+lane*4+hash(i+10)*6)*vehicleProfile(model).cruise;
    const z=mod(start+i*spacing+(hash(i)-.5)*34,LOOP);
    traffic.push({z,x:(lane-1)*LANE_WIDTH,lane,model,
      v:cruise,cruise,driver:newCharacter(),passenger:motorcyclePassenger(model),occupants:carPassengers(model),takesExit:i%4!==1,color:carColors[i%carColors.length],brake:false,cooldown:0});
  }
}
// Tính khoảng cách có dấu trên tuyến vòng để phát hiện cả xe trước và sau.
function relativeDistance(from,to) {
  let d=to-from;
  if(d>LOOP/2) d-=LOOP;
  else if(d<-LOOP/2) d+=LOOP;
  return d;
}
// Tái sử dụng xe ngoài tầm nhìn và chỉ cho xe mới xuất hiện sau người chơi ở làn đủ khoảng trống.
function spawnBehind(dt) {
  if(soloDrive) return;
  spawnTimer-=dt;
  if(spawnTimer>0) return;
  spawnTimer=1.6;
  const car=traffic.find(candidate=>candidate!==vehicleTakeover?.car&&!candidate.wreck&&!candidate.parked&&relativeDistance(state.z,candidate.z)<-FAR-165);
  if(!car) return;
  const z=mod(state.z-(82+hash(spawnIndex+43)*38),LOOP);
  for(let offset=0;offset<3;offset++){
    const lane=(spawnIndex+offset)%3, x=(lane-1)*LANE_WIDTH;
    // Tính cả làn đích của xe đang chuyển làn như một phần không gian đã có xe.
    if(traffic.some(other=>other!==car&&vehicleGap(relativeDistance(z,other.z),car.model,other.model)<33
      &&(Math.abs(x-other.x)<1.74+vehicleProfile(other.model).halfWidth||other.lane===lane))) continue;
    car.z=z;car.x=x;car.lane=lane;car.nextHornAt=0;car.reactAfter=0;car.lastComplaint=undefined;car.jam=null;car.waiting=0;car.wheelTravel=0;car.wreck=null;car.damage=null;car.crash=null;car.local=null;car.heading=null;car.driver=newCharacter();car.passenger=motorcyclePassenger(car.model);car.occupants=carPassengers(car.model);
    car.v=Math.min(car.cruise,Math.max(8,state.v+3));
    car.cooldown=1.2;car.brake=false;
    spawnIndex++;spawnTimer=6+hash(spawnIndex)*3;
    return;
  }
}
// Quét các làn với khoảng trống theo thân xe, rồi chọn tốc độ hoặc làn an toàn.
function planTraffic(car,dt) {
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
  }else if((playerAhead&&(!mountain||bendLimit>=24)||car.waiting>(mountain?2.5:1.2))&&!car.cooldown&&Math.abs(car.x-x)<.72){
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
const trafficActors=[state];
// Tính tốc độ và hướng lái tự động theo khoảng trống và bề rộng xe ở mỗi làn.
function reverseClear(lane,behind,follower){
  const rearFoot=foot.active&&relativeDistance(state.z,foot.z)<0
    &&relativeDistance(state.z,foot.z)>-13&&Math.abs(foot.x-state.x)<2.4;
  return !rearFoot&&behind[lane]>19+Math.max(0,follower[lane])*1.15;
}
function canEaseIntoLane(x,dt){
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
function alignAutopilot(dt,railOverlap){
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
function planAutopilot(dt) {
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
  if(soloDrive){
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
function drawFootFallback(person,z,fall){
  const base=project(z,person.x,person.y);
  if(base.depth<1) return;
  const look=person.look??foot.look;
  const s=base.s*look.scale,walking=person.moving&&person.grounded&&!fall;
  ctx.save();ctx.translate(base.x,base.y);ctx.scale(s,s);
  if(fall) ctx.rotate(fall.tilt);
  const lateral=Math.sin((person.angle??0)-Math.atan2(yawSin,yawCos));
  ctx.lineCap='round';ctx.lineJoin='round';
  for(const side of [-1,1]){
    const phase=(person.stride??0)+(side===1?0:.5);
    const gait=walking?gaitSample(phase,person.running):{along:0,lift:0};
    const hip=side*.104,shoe=hip+gait.along*lateral;
    ctx.strokeStyle='#30344b';ctx.lineWidth=.13;
    ctx.beginPath();ctx.moveTo(hip,-.72);
    ctx.lineTo((shoe+hip)*.5+gait.lift*lateral*.64,-.40-gait.lift*.28);
    ctx.lineTo(shoe,-.07-gait.lift);ctx.stroke();
    ctx.fillStyle='#1c1925';ctx.fillRect(shoe-.083,-.09-gait.lift,.174,.09);
    const arm=walking?-.23*Math.cos(phase*TAU)*lateral*(person.running?1.65:1):0;
    ctx.strokeStyle=look.shirt[1];ctx.lineWidth=.093;
    ctx.beginPath();ctx.moveTo(side*.23,-1.25);
    ctx.lineTo(side*.24+arm*.52,-1.04);ctx.lineTo(side*.24+arm,-.86);ctx.stroke();
  }
  ctx.fillStyle=look.shirt[0];ctx.fillRect(-.24,-1.36,.48,.66);
  ctx.fillStyle='#e1be99';ctx.fillRect(-.015,-1.34,.03,.58);
  ctx.fillStyle=look.skin[0];ctx.fillRect(-.135,-1.65,.27,.29);
  ctx.fillStyle=look.hair[0];ctx.fillRect(-.145,-1.67,.29,.075);
  if(Math.cos((person.angle??0)-Math.atan2(yawSin,yawCos))<0){
    ctx.fillStyle='#302438';
    ctx.fillRect(-.09,-1.55,.055,.026);ctx.fillRect(.035,-1.55,.055,.026);
    ctx.fillRect(-.038,-1.45,.076,.022);
  }
  ctx.restore();
}
let nextDriverSpeech=0;
function speakDriver(line,response){
  if(!audio?.effectsOn||effectsLevel===0||typeof window==='undefined'||!window.speechSynthesis||!window.SpeechSynthesisUtterance||world.time<nextDriverSpeech) return;
  const speech=window.speechSynthesis;
  const voices=speech.getVoices().filter(voice=>voice.lang.toLowerCase().startsWith('vi'));
  const utterance=new SpeechSynthesisUtterance(line);
  utterance.lang='vi-VN';
  if(voices.length) utterance.voice=voices[response%voices.length];
  utterance.rate=.94+response%4*.04;
  utterance.pitch=.88+response%4*.08;
  utterance.volume=effectsLevel;
  nextDriverSpeech=world.time+3.2;
  speech.speak(utterance);
}
const blockedDriverLines=[
  'Ê, nhích giùm cái coi!','Đứng chình ình vậy cha?','Ủa, tính đậu luôn giữa đường hả?',
  'Né xíu đi ông nội!','Trời đất, kẹt cứng ngắc rồi!','Đi giùm cái, má ơi!',
  'Quẹo hay đứng đó ngắm cảnh vậy?','Mẹ kiếp, tránh ra giùm!','Chừa đường người ta chạy với!',
  'Ủa alo, đường để chạy mà!','Tới luôn đi, lẹ giùm!','Né ra, người ta còn đi làm!'
];
const takenDriverLines=['Ê, trả xe đây!','Đồ khốn, xuống xe!','Ủa rồi ai cho lấy xe tui?','Ê cha nội, xe của tui!'];
function reactDriver(car,taken=false){
  if(!car.driver||car.parked||car.wreck||!audio?.effectsOn||effectsLevel===0) return;
  if((taken||world.time>=(car.nextHornAt??0))&&audio.ac.currentTime>=(audio.nextHorn??0)){
    const at=audio.ac.currentTime,frequency=car.model===5?245:car.model===4?445:375;
    audio.nextHorn=at+.85;
    car.nextHornAt=world.time+2.6+Math.random()*2.2;
    tone(audio.ac,audio.master,frequency,frequency*.95,.29,.22,'triangle',at);
    tone(audio.ac,audio.master,frequency*1.29,frequency*1.22,.16,.21,'square',at);
    if(taken||Math.random()<.24) tone(audio.ac,audio.master,frequency,frequency*.86,.25,.24,'triangle',at+.29);
  }
  if(!taken&&(world.time<(car.reactAfter??0)||world.time<nextDriverSpeech)) return;
  const lines=taken?takenDriverLines:blockedDriverLines;
  const start=Math.floor(Math.random()*lines.length);
  const response=start===car.lastComplaint?(start+1)%lines.length:start;
  car.lastComplaint=response;
  car.reactAfter=world.time+6.5+Math.random()*4;
  speakDriver(lines[response],response);
}
function enterVehicle(chosen){
  blendFromDisplayedCamera(1.32,previousCamera>=.5?chosen:null);
  let previous=null;
  if(chosen!==state){
    previous={z:state.z,x:state.x,model:state.model,color:state.color,v:0,cruise:0,
      lane:-1,parked:true,freeTerrain:true,brake:false,lateral:0,cooldown:0,wreck:state.wreck,damage:state.damage,crash:state.crash,occupants:state.occupants,wheelTravel:state.wheelTravel,heading:state.heading,freeSteering:state.freeSteering,yawOffset:state.yawOffset??0};
    traffic[traffic.indexOf(chosen)]=previous;
    Object.assign(state,{claimant:null,z:chosen.z,x:chosen.x,model:chosen.model,color:chosen.color,
      v:0,lateral:0,slide:0,spin:0,roll:0,damage:chosen.damage,crash:chosen.crash,occupants:chosen.occupants,wheelTravel:chosen.wheelTravel,heading:chosen.heading,freeSteering:chosen.freeSteering,yawOffset:chosen.yawOffset??0});
  }
  Object.assign(state,{wreck:null,v:0,slide:0,spin:0,roll:0});
  state.local=roadLocation(state)&&Math.abs(state.x)>5.5?roadLocation(state):null;
  foot.active=false;
  state.target=previousCamera;
  syncVehicleControls();
  return previous;
}
function doorAlong(car){return car.model===5?2.32:car.model===4?-.13:.42;}
function actorSpotClear(spot,ignore=null){
  const height=terrainHeight(spot.z,spot.x)+.15;
  return !riderBlocked(spot.z,spot.x,height)
    && ![state,...traffic].some(peer=>peer!==ignore&&footHitsCar(spot.z,spot.x,peer));
}
function actorWaypoint(from,to,t){
  const z=mod(from.z+relativeDistance(from.z,to.z)*t,LOOP);
  return {z,x:lerp(center(from.z)+from.x,center(to.z)+to.x,t)-center(z)};
}
function actorPathClear(from,to,ignore=null){
  const distance=Math.hypot(center(to.z)+to.x-center(from.z)-from.x,relativeDistance(from.z,to.z));
  const steps=Math.max(1,Math.ceil(distance/.16));
  for(let i=1;i<=steps;i++) if(!actorSpotClear(actorWaypoint(from,to,i/steps),ignore)) return false;
  return true;
}
function beginTakeover(car,pull){
  const yaw=carYaw(car),along=doorAlong(car),width=vehicleProfile(car.model).halfWidth;
  const dz=relativeDistance(car.z,foot.z),dx=center(foot.z)+foot.x-center(car.z)-car.x;
  const side=Math.sign(dx*Math.cos(yaw)-dz*Math.sin(yaw))||-1;
  const footStart={z:foot.z,x:foot.x};
  const approach=vehiclePoint(car,side*(width+.50),along);
  const distance=Math.hypot(relativeDistance(foot.z,approach.z),center(approach.z)+approach.x-center(foot.z)-foot.x);
  if(distance>3.1) return;
  const land=pull?vehiclePoint(car,side*(width+1.30),along+.30):null;
  vehicleTakeover={car,side,along,elapsed:0,door:0,footStart,footYaw:foot.angle,
    cameraFocus:approach,land,driver:null,mode:pull?'take':'entry'};
  blendFromDisplayedCamera(.58);
  car.v=car.lateral=car.slide=0;
  foot.firstPerson=false;
  foot.cameraYaw=yaw-side*.65;
  viewLook.yaw=viewLook.pitch=0;
  clearInput();
}
function placeTakeoverActor(actor,from,to,t){
  Object.assign(actor,actorWaypoint(from,to,t));
  standingPosition(actor);
}
function releaseTakeoverDriver(action){
  if(!action.driver) return;
  const rider=action.driver;
  Object.assign(rider,{age:0,low:true,vx:0,vz:0,vy:0,tilt:rider.tilt??0,startingTilt:rider.tilt??0,spin:0,leftAt:world.time});
  rider.reaction=Math.random()<.5?'flee':'chase';
  rider.originalCar=action.car;
  action.ejected=rider;
  ejectedDrivers.push(rider);
  action.driver=null;
}
function clearEntryPose(){
  foot.actionGrip=foot.actionStep=foot.actionReach=foot.actionCrouch=foot.actionLean=0;
  foot.actionPlant=foot.actionFeet=null;
}
function poseCabinEntry(action,approach,seat,t){
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
function poseMotorcycleMount(action,approach,seat,t){
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
function stepVehicleTakeover(dt){
  const action=vehicleTakeover;
  const {car,side,along,footStart}=action;
  if((car!==state&&!traffic.includes(car))||wreckExpired(car)||engineBlocked(car)||car.wreck||car.damage?.stage==='fire'||foot.fall){
    if(action.mode==='reclaim') action.rider.reaction='flee';
    releaseTakeoverDriver(action);
    blendFromDisplayedCamera(.46);
    vehicleTakeover=null;
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
      vehicleTakeover=null;
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
      vehicleTakeover=null;
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
    vehicleTakeover=null;
    clearEntryPose();
    const previous=enterVehicle(car);
    if(action.ejected?.reaction==='chase'){
      action.ejected.previous=previous;
      action.ejected.reclaimAfter=world.time+RECLAIM_GRACE_SECONDS;
      state.claimant=action.ejected;
    }
  }
}
function walkFormerDriver(rider,target,dt){
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
function finishReclaim(action){
  const {rider}=action;
  const slot=traffic.indexOf(rider.previous);
  if(slot<0){rider.reaction='flee';state.claimant=null;return;}
  const {z,x,heading,color,damage,crash,model,occupants}=state;
  const npc=rider.originalCar;
  Object.assign(npc,{z,x,heading,color,damage,crash,model,occupants,driver:rider.look,parked:false,
    v:0,lateral:0,slide:0,wreck:null,local:state.local,lane:clamp(Math.round(x/LANE_WIDTH)+1,0,2),cooldown:1});
  traffic[slot]=npc;
  const previous=rider.previous;
  Object.assign(state,{z:previous.z,x:previous.x,model:previous.model,color:previous.color,
    damage:previous.damage,crash:previous.crash,wreck:previous.wreck,occupants:previous.occupants,
    wheelTravel:previous.wheelTravel,heading:previous.heading,yawOffset:previous.yawOffset,
    freeSteering:previous.freeSteering,local:null,claimant:null,v:0,steer:0,lateral:0,slide:0,roll:0,spin:0,target:1});
  ejectedDrivers.splice(ejectedDrivers.indexOf(rider),1);
}
function stepFormerDriver(rider,dt){
  if(!rider.reaction||vehicleTakeover?.rider===rider||vehicleTakeover?.ejected===rider||rider.shoveUntil>world.time) return;
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
  if(!vehicleTakeover&&world.time>=rider.reclaimAfter&&gap<.73&&Math.abs(state.v)<1.2
    &&actorPathClear(rider,door)){
    vehicleTakeover={car:state,side,along,elapsed:0,door:0,mode:'reclaim',rider,withPlayer:!foot.active,
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
function sceneRiders(){
  const riders=ejectedDrivers.slice();
  if(vehicleTakeover?.driver) riders.push(vehicleTakeover.driver);
  for(const car of traffic) for(const rider of [car.wreck?.rider,car.wreck?.passenger])
    if(rider) riders.push(rider);
  return riders;
}
function riderFallPose(rider){
  return rider.recover===1||rider.age===undefined?null:rider;
}
function vehicleAction(){
  if(!state.started||vehicleTakeover) return;
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
    previousCamera=state.target;
    setAutopilot(false);
    Object.assign(foot,{active:true,z:door.z,x:door.x,y:terrainHeight(door.z,door.x),vy:0,
      angle,cameraYaw:angle,stride:0,moving:false,grounded:true});
    state.steer=state.lateral=0;
    if(animated){
      vehicleTakeover={car:state,side:door.side,along,elapsed:0,door:0,mode:'exit',
        cameraFocus:door,exitSpot:door,footStart:door};
      state.v=state.slide=0;
      foot.firstPerson=false;
      foot.cameraYaw=angle-door.side*.65;
    }
    const jumpFromBike=state.model===4&&exitSpeed>1.5&&!state.wreck;
    if(exitSpeed>1.5&&(!soloDrive||jumpFromBike)){
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
function syncVehicleControls(){
  clearInput();
  foot.walkYaw=null;foot.directionHold=0;foot.running=false;
  viewLook.yaw=viewLook.pitch=0;
  labelControl(vehicleInteract,foot.active?'Lên xe':'Xuống xe');
  vehicleInteract.setAttribute('data-entering',String(foot.active));
  jumpButton.hidden=!foot.active;
  labelControl(get('camera'),foot.active&&foot.firstPerson?'Góc nhìn thứ nhất':'Đổi góc nhìn');
  for(const id of ['camera-settings','autopilot'])get(id).disabled=foot.active;
  get('touch').hidden=foot.active;
  stick.hidden=!foot.active;
}
function jump(){
  if(foot.active&&foot.grounded&&!vehicleTakeover){foot.grounded=false;foot.vy=6.6;}
}
function railPresent(z){
  const area=district(z);
  return area===2||area===4||area===5||mod(z,48)>=15;
}
function walkLimit(z,x){
  const area=district(z);
  if(area===4||area===5) return clamp(x,-5.7,5.7);
  return clamp(x,-105,area===3?20:105);
}
function railAt(z,side){
  const cell=Math.floor(z/3)*3+1.5;
  return railPresent(cell)&&!localMergeAt(cell,side);
}
function sceneryClearance(z,worldX,radius,depth=0){
  for(const at of [z-depth,z,z+depth]){
    const x=worldX-center(at),side=Math.sign(x);
    if(Math.abs(x)<6.35+exitWidth(at,side)+radius) return false;
    const road=localRoadAt(at);
    if(road&&Math.abs(x-localOffset(road,at))<localWidth(road,at)+radius+.42) return false;
  }
  return true;
}
function overlapsLocalHouse(z,worldX,radius,depth){
  for(let at=Math.floor((z-depth-4.35)/3)*3;at<=z+depth+4.35;at+=3){
    if(mod(at,21)>=3) continue;
    const road=localRoadAt(at+1.5);
    if(!road) continue;
    const phase=mod(at+1.5-road.start,LOOP);
    if(phase<=103||phase>=283||Math.abs(phase-LOCAL_JUNCTION)<=18) continue;
    const house=center(at)+localOffset(road,at)+road.side*8.1;
    if(Math.abs(worldX-house)<radius+2.7&&Math.abs(z-at)<depth+4.35) return true;
  }
  return false;
}
// Dành khoảng trống riêng cho sân tháp và lối nhìn từ đường.
function chamCourtyard(z,worldX,padding=0){
  return Math.abs(relativeDistance(chamStart,mod(z,LOOP)))<37+padding
    && Math.abs(worldX-center(chamStart)+34)<28+padding;
}
function roadsidePlacement(z,worldX,radius,depth=radius){
  if(chamCourtyard(z,worldX,Math.max(radius,depth))) return false;
  if(!sceneryClearance(z,worldX,radius,depth)||isLocalBuildingConflict(z,worldX,radius)
    ||overlapsLocalHouse(z,worldX,radius,depth)) return false;
  let overlap=false;
  eachTrailProp(z-depth-2,z+depth+2,(x,at,_y,width,_height,length)=>{
    if(Math.abs(worldX-x)<radius+width*.5&&Math.abs(z-at)<depth+length*.5) overlap=true;
  });
  return !overlap;
}
function eachExtraTree(z,side,seed,area,visit){
  if(area===3&&side===1) return;
  const rows=area===6?(graphics===graphicsPresets.highest?3:graphics===graphicsPresets.medium?2:1)
    :graphics===graphicsPresets.highest?1:0;
  for(let row=0;row<rows;row++){
    const n=seed+row*61,at=z+4+hash(n+51)*7;
    if(district(at)!==area) continue;
    const x=center(at)+side*(33+row*12+hash(n+73)*6);
    if(roadsidePlacement(at,x,2)) visit(at,x,n);
  }
}
function tallCityClear(z,x,width){
  if(!roadsidePlacement(z,x,width*.5,6)) return false;
  const row=Math.floor((z-24-12)/46);
  for(let i=row;i*46+12<z+24;i++){
    const at=i*46+12;
    if(district(at)!==0||Math.abs(z-at)>13.3) continue;
    for(const side of [-1,1]){
      const seed=mod(Math.round(at),LOOP)+side*19;
      const other=center(at)+side*(14+hash(seed)*8+exitWidth(at,side));
      if(Math.abs(x-other)<width*.5+5.15&&roadsidePlacement(at,other,4.35,6.5)) return false;
    }
  }
  return true;
}
function countryHouseSize(seed){
  return {width:6+hash(seed)*3,depth:7.4};
}
function solidScenery(z,x,radius,y=-Infinity){
  const area=district(z), px=center(z)+x;
  const chamZ=relativeDistance(chamStart,z),chamX=px-center(chamStart);
  if(Math.abs(chamZ)<34+radius&&Math.abs(chamX+43)<18+radius){
    for(const [offsetX,offsetZ,size,height] of [[-43,0,11,22],[-42,-17,8,15],[-48,20,7,13]]){
      if(y<height&&Math.abs(chamX-offsetX)<size*.5+radius&&Math.abs(chamZ-offsetZ)<size*.5+radius) return true;
    }
  }
  let hit=false;
  eachTrailProp(z-radius-2,z+radius+2,(qx,qz,bottom,width,height,length)=>{
    if(y<=bottom+height&&Math.abs(px-qx)<width/2+radius&&Math.abs(z-qz)<length/2+radius) hit=true;
  });
  if(hit) return true;
  if(area===0){
    for(let i=Math.floor((z-22)/32);i*32<=z+22;i++){
      for(const side of [-1,1]){
        const seed=mod(i,LOOP/32)*13+side*17;
        const at=i*32+hash(seed+3)*12;
        if(district(at)!==0||Math.abs(z-at)>6+radius) continue;
        const bx=center(at)+side*(25+hash(seed)*31+exitWidth(at,side));
        const style=sceneryAt(at).style;
        const width=style==='saigon'?9+hash(seed+8)*14:8+hash(seed+8)*9;
        if(Math.abs(px-bx)<width*.5+radius&&tallCityClear(at,bx,width)) return true;
      }
    }
    const i=Math.round((z-12)/46),at=i*46+12;
    if(district(at)===0&&Math.abs(z-at)<6.5+radius) for(const side of [-1,1]){
      const seed=mod(Math.round(at),LOOP)+side*19;
      const bx=center(at)+side*(14+hash(seed)*8+exitWidth(at,side));
      if(Math.abs(px-bx)<4.3+radius&&roadsidePlacement(at,bx,4.35,6.5)) return true;
    }
  }
  const road=localRoadAt(z);
  if(road){
    for(let at=Math.floor((z-6)/3)*3;at<=z+6;at+=3){
      if(localRoadAt(at+1.5)!==road||Math.abs(z-at)>4.35+radius||mod(at,21)>=3) continue;
      const p=mod(at+1.5-road.start,LOOP);
      if(p<=103||p>=283||Math.abs(p-LOCAL_JUNCTION)<=18) continue;
      const bx=center(at)+localOffset(road,at)+road.side*8.1;
      if(Math.abs(px-bx)<2.7+radius) return true;
    }
  }
  if(area===2&&Math.abs(x)>20){
    for(let i=Math.floor((z-62)/48)*3;i*16<z+62;i+=3){
      const at=i*16+4;
      if(district(at)!==2) continue;
      for(const side of [-1,1]){
        const n=mod(i,LOOP/16)*29+side*7;
        const width=24+hash(n)*25,length=31+hash(n+4)*29;
        const bx=mountainCenter(at,side,width,length,15+hash(n+2)*15);
        if(((px-bx)/(width*.84+radius))**2+((z-at)/(length*.84+radius))**2<1) return true;
      }
    }
  }
  if(area>=1&&area<=3||area===6){
    for(let i=Math.floor((z-16)/16);i*16<z+11;i++){
      const at=i*16+4;
      if(district(at)!==area) continue;
      const seed=mod(i,LOOP/16)*29;
      for(const side of [-1,1]){
        if(area===3&&side===1) continue;
        const n=seed+side*7,bx=center(at)+side*(12+hash(n)*14);
        let extraHit=false;
        eachExtraTree(at,side,n,area,(treeZ,treeX)=>{
          if(Math.hypot(px-treeX,z-treeZ)<.23+radius) extraHit=true;
        });
        if(extraHit) return true;
        if(area===1&&i%5===0){
          const {width,depth}=countryHouseSize(n);
          if(Math.abs(z-at)<depth*.5+radius&&Math.abs(px-bx)<width*.5+radius
            &&roadsidePlacement(at,bx,width*.5,depth*.5)) return true;
        }else if((i%3!==0||area===2||area===6||area===3&&i%2===0)
          &&Math.hypot(px-bx,z-at)<.19+radius
          &&roadsidePlacement(at,bx,1.65)) return true;
      }
    }
  }
  return false;
}
// Cắt đoạn lan can với hộp thân xe trong hệ tọa độ của xe.
function railIntersectsCar(car,z,x,yaw=carYaw(car)){
  const {halfWidth,halfLength}=vehicleProfile(car.model);
  const sin=Math.sin(yaw),cos=Math.cos(yaw),worldX=center(z)+x;
  const reach=halfLength*Math.abs(cos)+halfWidth*Math.abs(sin)+.12;
  for(let start=Math.floor((z-reach)/3)*3;start<=z+reach;start+=3){
    const end=start+3;
    for(const side of [-1,1]){
      if(!railAt(start+1.5,side)) continue;
      const local=at=>{
        const dx=center(at)+side*(6+exitWidth(at,side))-worldX,dz=at-z;
        return [cos*dx-sin*dz,sin*dx+cos*dz];
      };
      const first=local(start),last=local(end);
      let near=0,far=1;
      for(let axis=0;axis<2;axis++){
        const limit=(axis===0?halfWidth:halfLength)+.095;
        const offset=first[axis],delta=last[axis]-offset;
        if(Math.abs(delta)<1e-8){
          if(Math.abs(offset)>limit){near=1;far=0;}
          continue;
        }
        const a=(-limit-offset)/delta,b=(limit-offset)/delta;
        near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));
      }
      if(near<=far) return true;
    }
  }
  return false;
}
function limitRailRotation(car,current,target){
  const turn=mod(target-current+Math.PI,TAU)-Math.PI;
  if(Math.abs(turn)<1e-8) return current;
  const steps=Math.max(1,Math.ceil(Math.abs(turn)/.05));
  let safe=current;
  for(let step=1;step<=steps;step++){
    const next=current+turn*step/steps;
    if(railIntersectsCar(car,car.z,car.x,next)) break;
    safe=next;
  }
  return safe;
}
function vehicleTerrainBlocked(car,z,x){
  const {halfWidth,halfLength}=vehicleProfile(car.model);
  if(railIntersectsCar(car,z,x)) return true;
  if(Math.abs(x)<1.95) return false;
  const yaw=carYaw(car), c=Math.cos(yaw),s=Math.sin(yaw);
  const radius=Math.min(.39,halfWidth*.48);
  for(const front of [-halfLength+radius,0,halfLength-radius]){
    const span=Math.max(.12,halfWidth-radius);
    for(const across of [-span,0,span]){
      const at=mod(z+c*front-s*across,LOOP);
      const sample=center(z)+x+s*front+c*across-center(at);
      const side=Math.sign(sample);
      if(walkLimit(at,sample+side*radius)!==sample+side*radius) return true;
      if(solidScenery(at,sample,radius)) return true;
    }
  }
  return false;
}
function moveAcrossTerrain(car,z,x){
  const startZ=car.z,startX=center(startZ)+car.x;
  const dz=relativeDistance(startZ,z),dx=center(z)+x-startX;
  const distance=Math.hypot(dx,dz);
  if(distance<.0001) return {z:car.z,x:car.x,blocked:false};
  const steps=Math.max(1,Math.ceil(distance/.31));
  let currentZ=startZ,currentX=car.x,blocked=false;
  for(let i=1;i<=steps;i++){
    const at=mod(startZ+dz*i/steps,LOOP),px=startX+dx*i/steps-center(at);
    if(!vehicleTerrainBlocked(car,at,px)){currentZ=at;currentX=px;continue;}
    blocked=true;
    const straight=center(currentZ)+currentX-center(at);
    if(!vehicleTerrainBlocked(car,at,straight)){currentZ=at;currentX=straight;}
    else{
      const slide=startX+dx*i/steps-center(currentZ);
      if(!vehicleTerrainBlocked(car,currentZ,slide)) currentX=slide;
    }
    break;
  }
  return {z:currentZ,x:currentX,blocked};
}
function coastShore(z){
  const offset=clamp(z-coastStart-Math.round((z-coastStart-COAST_LENGTH/2)/LOOP)*LOOP,0,COAST_LENGTH);
  const join=Math.max(coastLandBefore*clamp(1-offset/68,0,1),coastLandAfter*clamp(1-(COAST_LENGTH-offset)/68,0,1));
  const eased=join*join*(3-2*join);
  return {edge:lerp(22,185,eased),height:lerp(-.65,-.18,eased)};
}
function terrainHeight(z,x){
  if(Math.abs(x)<=6.1+exitWidth(z,Math.sign(x))||roadLocation({z,x})) return 0;
  if(district(z)!==3||x<=10) return -.18;
  const shore=coastShore(z);
  return lerp(-.18,shore.height,clamp((x-10)/(shore.edge-10),0,1));
}
function eachTrailProp(from,to,visit){
  for(let i=Math.ceil((from-15)/48);i*48+15<=to;i++){
    const z=i*48+15,area=district(z);
    if(area===4||area===5) continue;
    for(const side of [-1,1]){
      const x=center(z)+side*(9+exitWidth(z,side)+(area===1?5:0));
      if(!sceneryClearance(z,x,1.10,1.25)||isLocalBuildingConflict(z,x,1.5)
        ||overlapsLocalHouse(z,x,1.10,1.25)) continue;
      const height=area===2?1.10:area===0?.76:.70;
      const width=area===2?2.0:1.15,length=area===2?2.5:1.35;
      const bottom=terrainHeight(z,x-center(z));
      visit(x,z,bottom,width,height,length,area);
    }
  }
}
function onProp(z,x,visit){
  const px=center(z)+x;
  eachTrailProp(z-3,z+3,(qx,qz,bottom,width,height,length)=>{
    if(Math.abs(px-qx)<width/2+FOOT_RADIUS&&Math.abs(z-qz)<length/2+FOOT_RADIUS) visit(bottom+height);
  });
}
function footGround(z,x){
  let floor=terrainHeight(z,x);
  const rail=6+exitWidth(z,Math.sign(x));
  if(railPresent(z)&&Math.abs(Math.abs(x)-rail)<.16&&foot.y>=.575) floor=.59;
  onProp(z,x,top=>{if(top<=foot.y+.025) floor=Math.max(floor,top);});
  for(const car of [state,...traffic]){
    const {roof}=vehicleProfile(car.model);
    if(roof<=foot.y+.025&&footHitsCar(z,x,car)) floor=Math.max(floor,roof);
  }
  return floor;
}
function footBlocked(z,x,y=foot.y){
  const side=Math.sign(x),rail=6+exitWidth(z,side);
  if(y<.575&&railAt(z,side)&&Math.abs(x-side*rail)<FOOT_RADIUS+.06) return true;
  let blocked=false;
  onProp(z,x,top=>{if(y<top-.015) blocked=true;});
  if(blocked) return true;
  for(const car of [state,...traffic])
    if(y<vehicleProfile(car.model).roof-.015&&footHitsCar(z,x,car)) return true;
  return Math.abs(x)>5.35&&y<8&&solidScenery(z,x,FOOT_RADIUS,y+.025);
}
function footHitsCar(z,x,car,carX=car.x){
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
function pedestrianGap(car,x=car.x){
  if(!foot.active||foot.fall||vehicleTakeover) return Infinity;
  const dz=relativeDistance(car.z,foot.z);
  const profile=vehicleProfile(car.model);
  if(dz<0||Math.abs(foot.x-x)>profile.halfWidth+FOOT_RADIUS+.23) return Infinity;
  return dz-profile.halfLength-FOOT_RADIUS;
}
function strikePedestrian(car,fromZ,fromX,previousFoot){
  if(soloDrive) return false;
  if(!foot.active||foot.fall||vehicleTakeover||!previousFoot||car.v<4.5) return false;
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
function gaitSample(cycle,running=false){
  const phase=mod(cycle,1),stance=running?.45:.64,reach=running?.41:.30;
  if(phase<stance){
    const t=phase/stance;
    return {along:lerp(reach,-reach,t),lift:0,pitch:-.28*(1-clamp(t*4,0,1))+.42*clamp((t-.7)/.3,0,1)};
  }
  const t=(phase-stance)/(1-stance), ease=t*t*(3-2*t);
  return {along:lerp(-reach,reach,ease),lift:(running?.23:.115)*Math.sin(Math.PI*t)**1.25,pitch:lerp(.42,-.28,t)};
}
const sandFootprints=[];
function leaveSandFootprint(side){
  const sin=Math.sin(foot.angle),cos=Math.cos(foot.angle),scale=foot.look.scale;
  const z=mod(foot.z+(.18*cos-side*.12*sin)*scale,LOOP);
  const x=center(foot.z)+foot.x+(.18*sin+side*.12*cos)*scale-center(z);
  if(district(z)!==3||x<=Math.max(10.2,6.3+exitWidth(z,1))||x>=21.7||roadLocation({z,x})) return;
  const y=terrainHeight(z,x);
  if(Math.abs(foot.y-y)>.08) return;
  if(sandFootprints.length>=120) sandFootprints.shift();
  sandFootprints.push({z,x,y,angle:foot.angle,scale,time:world.time});
}
function recoverFootClearance(){
  if(!foot.active||foot.fall||vehicleTakeover||!footBlocked(foot.z,foot.x)) return;
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
function nudgeFormerDriver(rider,dx,dz){
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
function pushAtFoot(z,x,dx,dz){
  let blocked=false;
  for(const rider of ejectedDrivers){
    if(rider.recover!==1||vehicleTakeover?.rider===rider||Math.abs(foot.y-rider.y)>.65) continue;
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
function stepFoot(dx,dz){
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
function walk(dt,elapsed=dt){
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
// Cập nhật ga, quán tính, va chạm nhẹ và luồng xe theo thời gian thực.
function simulate(dt,clockDelta=dt) {
  cameraStep+=dt;
  if(cameraTransfer){
    cameraTransfer.elapsed+=dt;
    if(cameraTransfer.elapsed>=cameraTransfer.duration) cameraTransfer=null;
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
    if(world.time-rider.leftAt>life&&vehicleTakeover?.rider!==rider){
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
    if(vehicleTakeover) stepVehicleTakeover(dt);
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
      state.v=clamp(state.v+assistance.acceleration*dt,assistance.reversing?-2.6:0,Math.min(soloDrive?SOLO_TOP_SPEED:50,assistance.limit));
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
    if(vehicleTakeover?.car===car) continue;
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
    const allowed=!foot.active||vehicleTakeover||!footHitsCar(foot.z,foot.x,car,nextX);
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
// Khởi tạo tiếng động cơ và các lớp tiếng gió, lốp, xe đi ngang.
function tone(ac,destination,hz,endHz,volume,seconds,type,time=ac.currentTime){
  const osc=ac.createOscillator(),gain=ac.createGain();
  osc.type=type;osc.frequency.setValueAtTime(hz,time);osc.frequency.exponentialRampToValueAtTime(endHz,time+seconds);
  gain.gain.setValueAtTime(.001,time);gain.gain.linearRampToValueAtTime(volume,time+.012);
  gain.gain.exponentialRampToValueAtTime(.001,time+seconds);
  osc.connect(gain).connect(destination);osc.start(time);osc.stop(time+seconds+.02);
  osc.onended=()=>{osc.disconnect();gain.disconnect();};
}
function crashSound(force){
  if(!audio||!audio.effectsOn||audio.ac.currentTime<audio.nextCrash) return;
  audio.nextCrash=audio.ac.currentTime+.12;
  tone(audio.ac,audio.master,175,36,Math.min(.5,force*.017),.27,'sawtooth');
}
function createAudio() {
  const ac=new AudioContext(), master=ac.createGain();
  const effectsLimiter=ac.createDynamicsCompressor();
  effectsLimiter.threshold.value=-10;
  effectsLimiter.ratio.value=14;
  effectsLimiter.attack.value=.003;
  effectsLimiter.release.value=.13;
  master.gain.value=0;master.connect(effectsLimiter).connect(ac.destination);
  const engine=ac.createOscillator(), volume=ac.createGain();
  engine.type='triangle';engine.connect(volume).connect(master);engine.start();
  const buffer=ac.createBuffer(1,ac.sampleRate*2,ac.sampleRate), data=buffer.getChannelData(0);
  for(let i=0;i<data.length;i++) data[i]=Math.random()*2-1;
  const noise=ac.createBufferSource();
  noise.buffer=buffer;noise.loop=true;
  function ambience(type,frequency,q=.7){
    const filter=ac.createBiquadFilter(),gain=ac.createGain();
    filter.type=type;filter.frequency.value=frequency;filter.Q.value=q;gain.gain.value=0;
    noise.connect(filter).connect(gain).connect(master);
    return {filter,gain:gain.gain};
  }
  const air=ambience('lowpass',620),road=ambience('bandpass',210);
  const leaves=ambience('bandpass',1750),rain=ambience('highpass',2400),surf=ambience('lowpass',790);
  const passNoise=ac.createBiquadFilter(),passRoad=ac.createGain(),pass=ac.createOscillator();
  const passGain=ac.createGain(),pan=ac.createStereoPanner();
  pass.type='triangle';passNoise.type='bandpass';passNoise.frequency.value=390;
  passGain.gain.value=0;passRoad.gain.value=0;volume.gain.value=0;
  pass.connect(passGain).connect(pan).connect(master);
  noise.connect(passNoise).connect(passRoad).connect(pan);
  pass.start();noise.start();
  return {nextCrash:0,ac,master,engine,volume,air,road,leaves,rain,surf,pass,passGain,passRoad,pan};
}
// Âm môi trường theo địa hình, thời tiết và vị trí người nghe.
function updateAudio(gas,car,distance,panning) {
  if(!audio) return;
  const {ac,engine,volume,air,road,leaves,rain,surf,pass,passGain,passRoad,pan}=audio;
  const listener=foot.active?foot:state,t=ac.currentTime,v=foot.active?0:Math.abs(state.v);
  const area=district(listener.z),indoors=inTunnel(listener.z),open=indoors?.07:foot.active||state.model===4?1:.58;
  const vegetation=area===6?1.35:area>=1&&area<=3?1:.22;
  const treeDistance=Math.abs(Math.abs(listener.x)-13);
  const waterDistance=area===3?Math.max(0,coastShore(listener.z).edge-listener.x)
    :area===4?10:area===2?Math.abs(listener.x+21):Infinity;
  const wave=.42+.58*(.5+.5*Math.sin(world.time*(area===2?1.8:1.23)))**2;
  const slip=clamp(Math.abs(state.slide??0)/5+Math.abs(state.steer)*v/30,0,1);
  road.filter.frequency.setTargetAtTime(210+slip*860,t,.07);
  engine.frequency.setTargetAtTime(37+v*1.7+(gas?15:0),t,.13);
  volume.gain.setTargetAtTime(foot.active||engineBlocked(state)?0:gas?.25:.15,t,.12);
  air.filter.frequency.setTargetAtTime(340+wind.strength*450+v*15,t,.14);
  air.gain.setTargetAtTime(closedCabinView()?0:.018+open*wind.strength*.15+v*.0035,t,.15);
  road.gain.setTargetAtTime(v*.0038+(foot.active?0:slip*.21),t,.15);
  leaves.gain.setTargetAtTime(closedCabinView()?0:open*vegetation*wind.strength*.16/(1+treeDistance/12),t,.20);
  rain.gain.setTargetAtTime(open*world.weather[0]*.075,t,.20);
  surf.gain.setTargetAtTime(open*wave*(area===2?.11:.17)*Math.max(0,1-waterDistance/43)**2,t,.24);
  const proximity=car?1/(1+(distance/10)**2):0;
  const passSpeed=Math.abs(car?.v??0);
  const shift=car&&relativeDistance(listener.z,car.z)>0?.93:1.07;
  pass.frequency.setTargetAtTime((car?.model===5?40:car?.model===4?78:54)*shift+passSpeed*2.3,t,.12);
  passGain.gain.setTargetAtTime(proximity*(car?.parked||car?.wreck?0:.035+passSpeed*.005),t,.10);
  passRoad.gain.setTargetAtTime(proximity*passSpeed*.004,t,.10);
  pan.pan.setTargetAtTime(panning,t,.12);
}
// Bật hoặc tắt âm thanh sau thao tác người chơi.
async function toggleSound() {
  const button=get('sound'), enabled=button.getAttribute('aria-pressed')!=='true';
  try{
    audio??=createAudio();
    if(enabled) await audio.ac.resume();
    audio.effectsOn=enabled;
    if(!enabled&&typeof window!=='undefined') window.speechSynthesis?.cancel();
    audio.master.gain.setTargetAtTime(enabled?effectsLevel:0,audio.ac.currentTime,.07);
    button.setAttribute('aria-pressed',String(enabled));
    labelControl(button,enabled?'Tắt hiệu ứng âm thanh':'Bật hiệu ứng âm thanh');
  }catch{labelControl(button,'Âm thanh không khả dụng');}
}
// Đổi góc nhìn mà không ảnh hưởng các nút điều khiển đang giữ.
function toggleCamera() {
  if(vehicleTakeover) return;
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
  if(soloDrive===enabled) return;
  soloDrive=enabled;
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
function setAutopilot(enabled) {
  if(enabled&&(foot.active||state.wreck)) return;
  auto.enabled=enabled;auto.brake=false;auto.cooldown=0;auto.recovery=null;auto.escapeLane=undefined;auto.stuck=0;auto.noReverse=false;
  auto.lane=clamp(Math.round(state.x/LANE_WIDTH)+1,0,2);
  const button=get('autopilot');
  button.setAttribute('aria-pressed',String(enabled));
  labelControl(button,enabled?'Tắt tự lái':'Bật tự lái');
}
// Bật hoặc tắt tự lái bằng phím tắt hoặc nút trên màn hình.
function toggleAutopilot() {
  if(foot.active) return;
  setAutopilot(!auto.enabled);
}
// Đọc phím, giữ từng phím riêng để các phím cùng chức năng thả độc lập.
const pressed=new Set();
function keyboard(event,down) {
  if(!state.started||(down&&['SELECT','INPUT'].includes(event.target?.tagName))) return;
  if(event.code==='Space'&&foot.active){
    event.preventDefault();
    if(down&&!event.repeat) jump();
    return;
  }
  if(down&&!event.repeat&&event.code==='KeyE') vehicleAction();
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
// Xóa trạng thái nhập liệu khi người chơi rời cửa sổ.
function clearInput() {
  viewDrag=null;
  resetWalkStick();
  pressed.clear();keys.clear();
  for(const button of fingers.values()) button.classList.remove('active');
  fingers.clear();
}
// Chọn ngẫu nhiên vị trí xuất phát đủ xa các xe đang lưu thông.
function chooseStart(random=Math.random){
  const candidates=[];
  for(const section of route){
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
  return candidates[Math.floor(random()*candidates.length)]??{z:route[0].end*.5,x:0};
}
// Tạo tuyến đường, đặt xe vào vị trí xuất phát và mở HUD.
function startDrive() {
  randomizeRoute();
  randomizeExits();
  const spawn=chooseStart();
  state.model=0;
  state.color=carColors[Math.floor(Math.random()*carColors.length)];
  state.occupants=soloDrive?[]:carPassengers(state.model);
  state.z=spawn.z;state.x=spawn.x;
  state.heading=Math.atan(slope(state.z));
  foot.look=newCharacter();
  for(const car of traffic){car.driver=newCharacter();car.passenger=motorcyclePassenger(car.model);car.occupants=carPassengers(car.model);}
  world.first=Math.floor(Math.random()*3);world.time=0;advanceWorld(0);
  state.camera=state.target=1;
  state.started=true;
  get('hud-toggle').hidden=false;
  get('vehicle-actions').hidden=false;
  get('cover').hidden=true;get('hud').hidden=false;get('touch').hidden=false;get('drive-settings').hidden=false;
}
// Điều phối mô phỏng và giới hạn tốc độ vẽ ở 60 khung hình mỗi giây.
const frameInterval=1000/60;
let lastFrame=performance.now(),nextFrame=lastFrame+frameInterval;
function frame(now) {
  requestAnimationFrame(frame);
  if(now+.2<nextFrame) return;
  const elapsed=(now-lastFrame)/1000;
  lastFrame=now;
  nextFrame+=Math.max(1,Math.floor((now+.2-nextFrame)/frameInterval)+1)*frameInterval;
  if(document.hidden) return;
  let remaining=clamp(elapsed,0,.45);
  while(remaining>1e-6){
    const step=Math.min(remaining,1/30);
    simulate(step);
    remaining-=step;
  }
  draw();
}

function labelControl(button,label){
  button.setAttribute('aria-label',label);
  button.title=label;
}
const settingsPanel=get('settings-panel'),settingsToggle=get('settings-toggle');
function showSettingsPanel(open){
  settingsPanel.hidden=!open;
  settingsToggle.setAttribute('aria-expanded',String(open||!cameraPanel.hidden));
}
function showCameraPanel(open) {
  cameraPanel.hidden=!open;
  cameraSettings.setAttribute('aria-expanded',String(open));
  if(open){state.target=1;showSettingsPanel(false);}
  else settingsToggle.setAttribute('aria-expanded',String(!settingsPanel.hidden));
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
function resetWalkStick(){
  walkStick.pointer=null;
  walkStick.x=walkStick.z=0;
  stickCap.style.transform='';
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
  if(!state.started||viewDrag||event.button!==0) return;
  canvas.setPointerCapture(event.pointerId);
  viewDrag={id:event.pointerId,x:event.clientX,y:event.clientY};
});
canvas.addEventListener('pointermove',event=>{
  if(viewDrag?.id!==event.pointerId) return;
  const firstPerson=foot.active?foot.firstPerson:state.target===0;
  const direction=firstPerson?-1:1;
  viewLook.yaw=mod(viewLook.yaw+(event.clientX-viewDrag.x)*.006*direction+Math.PI,TAU)-Math.PI;
  viewLook.pitch=clamp(viewLook.pitch+(viewDrag.y-event.clientY)*.003*direction,-.28,.32);
  viewDrag.x=event.clientX;viewDrag.y=event.clientY;
});
for(const type of ['pointerup','pointercancel','lostpointercapture']){
  canvas.addEventListener(type,event=>{if(viewDrag?.id===event.pointerId)viewDrag=null;});
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
jumpButton.addEventListener('pointerdown',event=>{
  if(event.button!==0) return;
  event.preventDefault();
  jump();
});
jumpButton.addEventListener('click',event=>{if(event.detail===0) jump();});
get('start').addEventListener('click',()=>{
  if(state.started) return;
  startDrive();
  void toggleSound();
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
  for(const layer of [canvas,backdrop,world3D?.canvas]){
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
get('graphics').addEventListener('change',event=>{
  graphics=graphicsPresets[event.target.value]??graphicsPresets.highest;
  resize();
});
const effectsSlider=get('effects-volume');
effectsSlider.addEventListener('input',()=>{
  effectsLevel=Number(effectsSlider.value)/100;
  get('effects-volume-value').textContent=effectsSlider.value+'%';
  if(!audio) return;
  audio.master.gain.setTargetAtTime(audio.effectsOn?effectsLevel:0,audio.ac.currentTime,.07);
  if(effectsLevel===0&&typeof window!=='undefined') window.speechSynthesis?.cancel();
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
advanceWorld(0);seedTraffic();resize();requestAnimationFrame(frame);
