import { COAST_LENGTH, COAST_SHORE_DISTANCE, FOOT_RADIUS, FOREST_LENGTH, LOCAL_JUNCTION, LOCAL_LENGTH, LOOP, PASS_LENGTH, TAU, TUNNEL_LENGTH, TUNNEL_MARGIN, VILLAGE_INTRO_LENGTH, clamp, graphicsPresets, hash, lerp, mod, routeLengths, vietnamScenes } from './constants.js';
import { footHitsCar } from './pedestrian.js';
import { cityExits, foot, localRoads, passBends, runtime, state, traffic, world } from './runtime.js';
import { carYaw, vehicleProfile } from './traffic.js';
import { cityModelSize } from './model-scale.js';

export function sceneryAt(z){return runtime.sceneryChoices[district(z)];}

export function inOpeningVillage(z){
  return mod(z-runtime.villageStart,LOOP)<VILLAGE_INTRO_LENGTH;
}

export function passSample(z,table){
  let d=z-runtime.passStart;
  if(d<0||d>=LOOP) d=mod(d,LOOP);
  if(d>=PASS_LENGTH) return 0;
  const i=Math.floor(d);
  return table[i]+(table[i+1]-table[i])*(d-i);
}

const centerTable=new Float32Array(LOOP+1);
const districtTable=new Uint8Array(LOOP);

export function setRoute(order) {
  let start=0;
  runtime.route=order.flatMap((area,index)=>{
    const end=start+routeLengths[area];
    if(area===2) runtime.passStart=start;
    if(area===3){
      runtime.coastStart=start;
      runtime.coastLandBefore=Number(order[(index+order.length-1)%order.length]!==4);
      runtime.coastLandAfter=Number(order[(index+1)%order.length]!==4);
    }
    if(area===0) runtime.cityStart=start;
    if(area===1){
      runtime.villageStart=start;
      runtime.chamStart=end-FOREST_LENGTH+192;
    }
    if(area===5) runtime.tunnelStart=start+TUNNEL_MARGIN;
    const from=start;
    start=end;
    if(area===1) return [{area,start:from,end:end-FOREST_LENGTH},{area:6,start:end-FOREST_LENGTH,end}];
    return {area,start:from,end};
  });
  for(let z=0;z<LOOP;z++){
    for(const section of runtime.route){
      if(z<section.end){districtTable[z]=section.area;break;}
    }
    const phase=z*TAU/LOOP;
    centerTable[z]=passSample(z,passBends)+38*Math.cos(phase*4)+10*Math.sin(phase*9)+14*Math.cos(phase*2)+8*Math.sin(phase*2);
  }
  centerTable[LOOP]=centerTable[0];
}

setRoute([0,1,2,3,4,5]);

export function randomizeRoute(random=Math.random) {
  const order=[1,2,3,4,5];
  for(let i=order.length-1;i>0;i--){
    const j=Math.floor(random()*(i+1));
    [order[i],order[j]]=[order[j],order[i]];
  }
  setRoute([0,...order]);
  runtime.sceneryChoices=vietnamScenes.map(choices=>choices[Math.floor(random()*choices.length)]);
}

export function district(z) {
  return districtTable[Math.floor(mod(z,LOOP))];
}

export function tunnelOffset(z) {
  return mod(z-runtime.tunnelStart,LOOP);
}

export function inTunnel(z) {
  return tunnelOffset(z)<TUNNEL_LENGTH;
}

// Tâm đường và tiếp tuyến tuần hoàn để ghép tuyến liền mạch.
export function center(z) {
  const p=mod(z,LOOP);
  const i=Math.floor(p);
  return centerTable[i]+(centerTable[i+1]-centerTable[i])*(p-i);
}

// Đặt chân núi ngoài khoảng cong của đường và lề.
export function mountainCenter(z,side,width,length,margin){
  let outer=side*center(z);
  for(let distance=-length;distance<=length;distance+=4)
    outer=Math.max(outer,side*center(z+distance));
  outer=Math.max(outer,side*center(z+length));
  return side*(outer+width+margin+5);
}

export function slope(z) {
  return (center(z+.5)-center(z-.5));
}

// Chọn ngẫu nhiên hai nhánh tách và nhập làn ngoài phạm vi hầm trong mỗi khu phố.
export function randomizeExits(random=Math.random) {
  cityExits.length=0;
  const rural=runtime.route.find(section=>section.area===1).start;
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
export function exitWidth(z,side=1) {
  const phase=mod(z-runtime.cityStart,LOOP);
  if(phase>=routeLengths[0]) return 0;
  for(const exit of cityExits){
    if(exit.side!==side||phase<=exit.start||phase>=exit.end) continue;
    const amount=Math.min((phase-exit.start)/43,(exit.end-phase)/53,1);
    return exit.width*amount*amount*(3-2*amount);
  }
  return 0;
}

export function localRoadAt(z){
  for(const road of localRoads)
    if(mod(z-road.start,LOOP)<LOCAL_LENGTH) return road;
  return null;
}

export function localOffset(road,z){
  const progress=mod(z-road.start,LOOP);
  const blend=clamp(Math.min(progress,LOCAL_LENGTH-progress)/104,0,1);
  return road.side*(4.4+21.6*blend*blend*(3-2*blend));
}

export function localWidth(road,z){
  const d=Math.abs(mod(z-road.start,LOOP)-LOCAL_JUNCTION);
  return d<4?9:3.1;
}

export function localMergeAt(z,side){
  const road=localRoadAt(z);
  if(road?.side!==side) return false;
  const offset=Math.abs(localOffset(road,z)), rail=6+exitWidth(z,side);
  return Math.abs(offset-rail)<6.25;
}

export function isLocalBuildingConflict(z,worldX,radius){
  for(const at of [z-6,z,z+6]){
    const road=localRoadAt(at);
    if(road&&Math.abs(center(at)+localOffset(road,at)-worldX)<radius+localWidth(road,at)+2.65) return true;
  }
  return false;
}

export function localSignal(road){
  const phase=mod(world.time+road.phase,22);
  return phase<10?'green':phase<13?'amber':'red';
}

export function stopGap(car,road){
  if(localSignal(road)==='green') return Infinity;
  const d=LOCAL_JUNCTION-5-mod(car.z-road.start,LOOP);
  const front=vehicleProfile(car.model).halfLength;
  return d>=front-.1?Math.max(0,d-front):Infinity;
}

export function roadLocation(car){
  const road=localRoadAt(car.z);
  return road&&Math.abs(car.x-localOffset(road,car.z))<localWidth(road,car.z)+.5?road:null;
}

export function clampLocalX(road,z,x){
  const mid=localOffset(road,z),outer=localWidth(road,z)-.72,inner=2.38;
  return clamp(x,mid-(road.side>0?inner:outer),mid+(road.side>0?outer:inner));
}

export function clampRoadX(z,x){
  const main=clamp(x,-4.73-exitWidth(z,-1),4.73+exitWidth(z,1));
  const road=localRoadAt(z);
  if(!road) return main;
  const local=clampLocalX(road,z,x);
  return Math.abs(x-local)<Math.abs(x-main)?local:main;
}

randomizeExits();

// Tính khoảng cách có dấu trên tuyến vòng để phát hiện cả xe trước và sau.
export function relativeDistance(from,to) {
  let d=to-from;
  if(d>LOOP/2) d-=LOOP;
  else if(d<-LOOP/2) d+=LOOP;
  return d;
}

export function railPresent(z){
  const area=district(z);
  return area===2||area===4||area===5||mod(z,48)>=15;
}

// Giữ tâm người đi bộ cách mép nước một bán kính cơ thể.
export function walkLimit(z,x){
  const area=district(z);
  if(area===4||area===5) return clamp(x,-5.7,5.7);
  return clamp(x,-105,area===3?coastShore(z).edge-FOOT_RADIUS:105);
}

export function railAt(z,side){
  const cell=Math.floor(z/3)*3+1.5;
  return railPresent(cell)&&!localMergeAt(cell,side);
}

export function sceneryClearance(z,worldX,radius,depth=0){
  for(const at of [z-depth,z,z+depth]){
    const x=worldX-center(at),side=Math.sign(x);
    if(Math.abs(x)<6.35+exitWidth(at,side)+radius) return false;
    const road=localRoadAt(at);
    if(road&&Math.abs(x-localOffset(road,at))<localWidth(road,at)+radius+.42) return false;
  }
  return true;
}

export function overlapsLocalHouse(z,worldX,radius,depth){
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
export function chamCourtyard(z,worldX,padding=0){
  return Math.abs(relativeDistance(runtime.chamStart,mod(z,LOOP)))<37+padding
    && Math.abs(worldX-center(runtime.chamStart)+34)<28+padding;
}

export function roadsidePlacement(z,worldX,radius,depth=radius){
  if(chamCourtyard(z,worldX,Math.max(radius,depth))) return false;
  if(!sceneryClearance(z,worldX,radius,depth)||isLocalBuildingConflict(z,worldX,radius)
    ||overlapsLocalHouse(z,worldX,radius,depth)) return false;
  return true;
}

export function eachExtraTree(z,side,seed,area,visit){
  if(area===3&&side===1) return;
  const rows=area===6?(runtime.graphics===graphicsPresets.highest?3:runtime.graphics===graphicsPresets.medium?2:1)
    :runtime.graphics===graphicsPresets.highest?1:0;
  for(let row=0;row<rows;row++){
    const n=seed+row*61,at=z+4+hash(n+51)*7;
    if(district(at)!==area) continue;
    const x=center(at)+side*(33+row*12+hash(n+73)*6);
    if(roadsidePlacement(at,x,2)) visit(at,x,n);
  }
}

// Tính mức đô thị hóa giống nhau cho khoảng lùi, va chạm và bố trí model.
export function cityBlend(z){
  const progress=mod(z-runtime.cityStart,LOOP);
  const t=clamp(Math.min(progress,routeLengths[0]-progress)/155,0,1);
  return t*t*(3-2*t);
}

// Chừa khoảng cách theo đúng mặt bằng của GLB sau khi xoay về phía đường.
export function tallCityClear(z,x,width,depth){
  if(!roadsidePlacement(z,x,width*.5,depth*.5)) return false;
  const room=depth*.5+9;
  const row=Math.floor((z-room-12)/46);
  for(let i=row;i*46+12<z+room;i++){
    const at=i*46+12;
    if(district(at)!==0) continue;
    for(const side of [-1,1]){
      const seed=mod(Math.round(at),LOOP)+side*19;
      const other=center(at)+side*(14+hash(seed)*8+exitWidth(at,side));
      const house=cityModelSize(seed,0,'',true);
      if(Math.abs(z-at)>depth*.5+house.width*.5+1.8) continue;
      if(Math.abs(x-other)<(width+house.depth)*.5+1.4&&roadsidePlacement(at,other,house.depth*.5,house.width*.5)) return false;
    }
  }
  return true;
}

export function countryHouseSize(seed){
  return {width:6+hash(seed)*3,depth:7.4};
}

// Duyệt đúng mặt bằng và chiều cao của nhà phố, cao ốc và nhà trên đường nhánh.
export function eachCityBuilding(near,far,visit){
  for(let z=Math.ceil(near/21)*21;z<far;z+=21){
    const road=localRoadAt(z+1.5);
    if(!road) continue;
    const p=mod(z+1.5-road.start,LOOP);
    if(p<=103||p>=283||Math.abs(p-LOCAL_JUNCTION)<=18) continue;
    const offset=localOffset(road,road.start+clamp(p-1.5,0,LOCAL_LENGTH-.001));
    const x=center(z)+offset+road.side*8.1;
    visit(x,z,8.7,road.side===1?9.5+hash(z)*2.8:3.4,5.4,
      offset<0?Math.PI/2:-Math.PI/2,road.side===1?'town':'house',true);
  }
  for(let i=Math.floor(near/32);i*32<far;i++){
    for(const side of [-1,1]){
      const seed=mod(i,LOOP/32)*13+side*17,z=i*32+hash(seed+3)*12;
      if(z<near||z>=far||district(z)!==0) continue;
      const x=center(z)+side*(25+hash(seed)*31+exitWidth(z,side));
      const {kind,width,height,depth}=cityModelSize(seed,cityBlend(z),sceneryAt(z).style);
      if(tallCityClear(z,x,depth,width)) visit(x,z,width,height,depth,-side*Math.PI/2,kind,false);
    }
  }
  for(let z=Math.ceil((near-12)/46)*46+12;z<far;z+=46){
    if(district(z)!==0) continue;
    for(const side of [-1,1]){
      const seed=mod(Math.round(z),LOOP)+side*19;
      const x=center(z)+side*(14+hash(seed)*8+exitWidth(z,side));
      const {width,height,depth}=cityModelSize(seed,0,'',true);
      if(roadsidePlacement(z,x,depth*.5,width*.5)) visit(x,z,width,height,depth,-side*Math.PI/2,'town',false);
    }
  }
}

export function solidScenery(z,x,radius,y=-Infinity){
  const area=district(z), px=center(z)+x;
  const chamZ=relativeDistance(runtime.chamStart,z),chamX=px-center(runtime.chamStart);
  if(Math.abs(chamZ)<34+radius&&Math.abs(chamX+43)<18+radius){
    for(const [offsetX,offsetZ,size,height] of [[-43,0,11,22],[-42,-17,8,15],[-48,20,7,13]]){
      if(y<height&&Math.abs(chamX-offsetX)<size*.5+radius&&Math.abs(chamZ-offsetZ)<size*.5+radius) return true;
    }
  }
  if(area===0){
    for(let i=Math.floor((z-26-radius)/32);i*32<=z+26+radius;i++){
      for(const side of [-1,1]){
        const seed=mod(i,LOOP/32)*13+side*17;
        const at=i*32+hash(seed+3)*12;
        if(district(at)!==0) continue;
        const bx=center(at)+side*(25+hash(seed)*31+exitWidth(at,side));
        const style=sceneryAt(at).style;
        const house=cityModelSize(seed,cityBlend(at),style);
        if(y<house.height&&Math.abs(z-at)<house.width*.5+radius&&Math.abs(px-bx)<house.depth*.5+radius
          &&tallCityClear(at,bx,house.depth,house.width)) return true;
      }
    }
    const i=Math.round((z-12)/46),at=i*46+12;
    if(district(at)===0) for(const side of [-1,1]){
      const seed=mod(Math.round(at),LOOP)+side*19;
      const bx=center(at)+side*(14+hash(seed)*8+exitWidth(at,side));
      const house=cityModelSize(seed,0,'',true);
      if(y<house.height&&Math.abs(z-at)<house.width*.5+radius&&Math.abs(px-bx)<house.depth*.5+radius
        &&roadsidePlacement(at,bx,house.depth*.5,house.width*.5)) return true;
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
export function railIntersectsCar(car,z,x,yaw=carYaw(car)){
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

export function limitRailRotation(car,current,target){
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

export function vehicleTerrainBlocked(car,z,x){
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
      const edge=sample+side*radius;
      // Xe vẫn dùng giới hạn lề cũ ở bãi biển, còn người đi bộ có thể ra bờ nước.
      if((district(at)===3&&edge>20)||walkLimit(at,edge)!==edge) return true;
      if(solidScenery(at,sample,radius)) return true;
    }
  }
  return false;
}

export function moveAcrossTerrain(car,z,x){
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

// Giữ bờ biển lùi khỏi đường và nối êm khi sang khu vực đất liền.
export function coastShore(z){
  const offset=clamp(z-runtime.coastStart-Math.round((z-runtime.coastStart-COAST_LENGTH/2)/LOOP)*LOOP,0,COAST_LENGTH);
  const join=Math.max(runtime.coastLandBefore*clamp(1-offset/68,0,1),runtime.coastLandAfter*clamp(1-(COAST_LENGTH-offset)/68,0,1));
  const eased=join*join*(3-2*join);
  return {edge:lerp(COAST_SHORE_DISTANCE,185,eased),height:lerp(-.65,-.18,eased)};
}

// Duyệt cùng vị trí turbine cho renderer và bộ kiểm tra đường bay.
export function eachWindTurbine(referenceZ,visit){
  const coast=referenceZ+relativeDistance(mod(referenceZ,LOOP),runtime.coastStart);
  for(let i=0;i<14;i++){
    const row=i%2,z=coast+126+Math.floor(i/2)*148+row*64;
    const x=center(z)+coastShore(z).edge+245+row*113;
    visit(x,z,row,i);
  }
}

export function terrainHeight(z,x){
  if(Math.abs(x)<=6.1+exitWidth(z,Math.sign(x))||roadLocation({z,x})) return 0;
  if(district(z)!==3||x<=10) return -.18;
  const shore=coastShore(z);
  return lerp(-.18,shore.height,clamp((x-10)/(shore.edge-10),0,1));
}

export function footGround(z,x){
  let floor=terrainHeight(z,x);
  const rail=6+exitWidth(z,Math.sign(x));
  if(railPresent(z)&&Math.abs(Math.abs(x)-rail)<.16&&foot.y>=.575) floor=.59;
  for(const car of [state,...traffic]){
    const {roof}=vehicleProfile(car.model);
    if(roof<=foot.y+.025&&footHitsCar(z,x,car)) floor=Math.max(floor,roof);
  }
  return floor;
}

export function footBlocked(z,x,y=foot.y){
  const side=Math.sign(x),rail=6+exitWidth(z,side);
  if(y<.575&&railAt(z,side)&&Math.abs(x-side*rail)<FOOT_RADIUS+.06) return true;
  for(const car of [state,...traffic])
    if(y<vehicleProfile(car.model).roof-.015&&footHitsCar(z,x,car)) return true;
  return Math.abs(x)>5.35&&y<8&&solidScenery(z,x,FOOT_RADIUS,y+.025);
}
