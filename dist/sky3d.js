'use strict';

const skyCloudProfiles=[
  [[-22,-1,0,20,5,13],[-7,4,2,19,12,17],[12,6,-5,15,15,12],[29,0,2,18,6,10]],
  [[-35,0,4,29,4.8,12],[-1,2,0,36,5.8,9],[31,-1,-4,27,3.3,9],[55,-3,-7,12,2.2,6]],
  [[-16,-4,7,21,7,16],[12,-3,-6,24,7,15],[.5,8,5,17,11,13],[6,19,-1,13,12,11],[19,14,-7,9,9,8]],
  [[-27,.3,3,17,4,9],[-14,4,-3,12,7,10],[13,2,3,10,4.5,7],[32,0,-6,19,5.5,13]]
];
const skyFlightClock={last:0,planeAt:0,birdsAt:0,plane:null,birds:null};
const skyCloudCache=new Map();
const skyCloudBands=[
  ['#233557','#273a60','#2c3f65'],
  ['#334871','#3c507a','#3a4d76'],
  ['#465d84','#50678f','#496188'],
  ['#587399','#617da0','#567396']
];

// Chuẩn bị mặt lưới mây tại một ô và dùng lại hình dạng trong suốt vòng đường.
function buildCloudCell(cell) {
  const z=cell*160+hash(cell+118)*90;
  const x=center(z)+(hash(cell+193)-.5)*240;
  const y=37+hash(cell+281)*32;
  const seed=cell*41+7;
  const profile=skyCloudProfiles[Math.floor(hash(seed)*skyCloudProfiles.length)];
  const shape=.72+hash(seed+12)*.53;
  const slant=(hash(seed+14)-.5)*.28;
  const quads=[];
  for(let i=0;i<profile.length;i++){
    const [dx,dy,dz,rx,ry,rz]=profile[i], puffSeed=seed+i*17;
    const rings=[];
    for(let band=0;band<=4;band++){
      const pitch=[-Math.PI/2,-.55,.0,.63,Math.PI/2][band];
      const ring=[];
      for(let step=0;step<10;step++){
        const angle=step*TAU/10;
        const swell=.86+hash(puffSeed+step*9+band*73)*.25;
        const u=Math.cos(angle)*Math.cos(pitch)*rx*swell;
        const v=(pitch<0?Math.sin(pitch)*.60:Math.sin(pitch))*ry;
        const front=Math.sin(angle)*Math.cos(pitch)*rz*swell;
        ring.push([x+(dx+u+front*slant)*shape,y+(dy+v)*shape,z+(dz+front)*shape]);
      }
      rings.push(ring);
    }
    for(let band=0;band<4;band++){
      for(let step=0;step<10;step++){
        const next=(step+1)%10;
        const shade=skyCloudBands[band][Math.floor(hash(puffSeed+step)*3)];
        quads.push([rings[band][step],rings[band][next],rings[band+1][next],rings[band+1][step],shade]);
      }
    }
  }
  return {x,quads};
}

// Vẽ các lớp mây 3D quanh camera và ghép tọa độ qua điểm nối cao tốc.
function drawCloudField(quad,origin,originX,loop,now) {
  const count=loop/160;
  const drift=mod(now*.63,loop), crosswind=Math.sin(now*.016)*29;
  const first=Math.floor((origin-drift-(yawCos<.35?480:90))/160);
  const last=Math.floor((origin-drift+(yawCos<-.35?130:635))/160);
  for(let i=first;i<=last;i++){
    const cell=mod(i,count);
    if(!skyCloudCache.has(cell)) skyCloudCache.set(cell,buildCloudCell(cell));
    const cloud=skyCloudCache.get(cell);
    if(Math.abs(cloud.x+crosswind-originX)>420) continue;
    const wrap=(i-cell)*160+drift;
    const shear=crosswind+Math.sin(now*.028+cell*.81)*3.5;
    for(const [a,b,c,d,shade] of cloud.quads){
      quad([a[0]+shear,a[1],a[2]+wrap],[b[0]+shear,b[1],b[2]+wrap],
        [c[0]+shear,c[1],c[2]+wrap],[d[0]+shear,d[1],d[2]+wrap],shade,1,-2);
    }
  }
}

// Lấy một chuyến bay thưa, với hướng băng qua, tầm cao và tốc độ riêng.
function flightClearance(flight,duration,margin){
  let height=flight.y;
  for(let time=0;time<=duration;time++){
    const z=flight.z+flight.vz*time;
    const check=28+Math.abs(flight.vz);
    for(const offset of [-check,0,check]){
      const area=district(z+offset);
      const obstacle=area===2?96:area===0?63:area===3?39:area===4?21:10;
      height=Math.max(height,obstacle+margin);
    }
  }
  return height;
}
function newSkyPlane(now,originX,playerZ) {
  const direction=Math.random()<.5?-1:1;
  const near=Math.random()<.5;
  const depth=near?115+Math.random()*55:295+Math.random()*145;
  const speed=(near?19:32)+Math.random()*8;
  const plane={begin:now,x:originX-direction*depth*(.45+Math.random()*.12),z:playerZ+depth,
    y:near?17+Math.random()*15:54+Math.random()*34,vx:speed*direction,
    vz:Math.max(6,state.v)+(Math.random()-.5)*14,span:.75+Math.random()*.28};
  plane.y=flightClearance(plane,15,18);
  return plane;
}

// Tạo đàn chim bay chếch qua đường, với quy mô và khoảng cách đội hình thay đổi.
function newSkyFlock(now,originX,playerZ) {
  const direction=Math.random()<.5?-1:1;
  const depth=Math.random()<.5?76+Math.random()*67:225+Math.random()*154;
  const flock={begin:now,x:originX-direction*depth*(.29+Math.random()*.2),z:playerZ+depth,
    y:32+Math.random()*13,vx:direction*(8+Math.random()*6),vz:9+Math.random()*14,
    count:5+Math.floor(Math.random()*5),seed:Math.random()*1000};
  flock.y=flightClearance(flock,12,12);
  return flock;
}

// Đưa độ sâu về cùng vòng tuyến với người chơi để chuyến bay không nhảy khi qua điểm nối.
function skyFlightDepth(z,playerZ,loop) {
  return playerZ+mod(z-playerZ+loop*.5,loop)-loop*.5;
}

// Dựng máy bay cánh quét, thân có sống lưng và đèn vị trí ở đầu cánh.
function drawSkyPlane(quad,plane,now,playerZ,loop) {
  const age=now-plane.begin;
  const x=plane.x+age*plane.vx,z=skyFlightDepth(plane.z+age*plane.vz,playerZ,loop);
  if(z-playerZ<34||z-playerZ>610) return;
  const yaw=Math.atan2(plane.vx,plane.vz), cos=Math.cos(yaw), sin=Math.sin(yaw), scale=plane.span;
  // Đổi các điểm cục bộ từ trục thân máy bay sang tọa độ cảnh.
  function point(side,height,along) {
    return [x+(side*cos+along*sin)*scale,plane.y+height*scale,z+(along*cos-side*sin)*scale];
  }
  const rings=[[-6.7,.25,.31],[-4.6,.67,.72],[.8,1.1,1.04],[4.8,.94,.88],[6.8,.14,.23]];
  const shell=(section,i)=>{
    const [along,w,h]=section,a=i*TAU/8;
    return point(Math.cos(a)*w,Math.sin(a)*h+(along<-4?.14:0),along);
  };
  for(let row=1;row<rings.length;row++) for(let i=0;i<8;i++){
    const tint=i<4?(i%2?'#d4d5c6':'#aebbbd'):(i%2?'#687981':'#83939b');
    quad(shell(rings[row-1],i),shell(rings[row-1],i+1),shell(rings[row],i+1),shell(rings[row],i),tint,1,-1);
  }
  for(const side of [-1,1]){
    const wing=(a,b,c)=>point(side*a,b,c);
    quad(wing(.76,.12,2.22),wing(4.15,.20,.08),wing(7.5,.27,-2.19),wing(.72,.09,-1.04),'#abbabe',1,-1);
    quad(wing(.72,.09,-1.04),wing(7.5,.27,-2.19),wing(8.4,.44,-3.14),wing(5.6,.24,-3.27),'#84959a',1,-1);
    quad(wing(7.6,.28,-2.05),wing(8.7,.49,-3.06),wing(8.66,.98,-3.48),wing(7.88,.70,-2.64),
      side<0?'#e98673':'#6bc4b1',1,-1);
    quad(wing(.41,.17,-4.36),wing(3.05,.26,-5.82),wing(2.95,.37,-6.50),wing(.29,.22,-5.72),'#9cafb4',1,-1);
    for(let i=0;i<6;i++){
      const engine=(n,r,at)=>wing(2.13+Math.cos(n*TAU/6)*r,-.37+Math.sin(n*TAU/6)*r,at);
      quad(engine(i,.43,1.68),engine(i+1,.43,1.68),engine(i+1,.36,-.47),engine(i,.36,-.47),'#aebbb5',1,-1);
      quad(engine(i,.38,1.69),engine(i+1,.38,1.69),wing(2.13,-.37,1.69),wing(2.13,-.37,1.69),'#3c4c5a',1,-1);
    }
    quad(wing(.32,.61,5.38),wing(.65,.65,4.69),wing(.59,.82,4.63),wing(.25,.76,5.23),'#455d68',1,-1);
  }
  quad(point(0,.55,-3.96),point(0,2.48,-5.84),point(0,2.27,-6.39),point(0,.43,-6.55),'#9fb8b6',1,-1);

}

// Vệt khói lưu dấu quỹ đạo cũ, nở rộng và tan dần sau đuôi.
function drawSkyContrail(quad,plane,now,playerZ,loop){
  if(!plane) return;
  const age=now-plane.begin;
  const visibleAge=Math.min(age,15);
  const speed=Math.hypot(plane.vx,plane.vz);
  const dx=plane.vx/speed,dz=plane.vz/speed;
  function edge(emission,side){
    const elapsed=now-plane.begin-emission;
    const spread=.3+elapsed*.38;
    const along=emission*speed-6*plane.span;
    const x=plane.x+dx*along+dz*side*spread;
    const z=skyFlightDepth(plane.z+dz*along-dx*side*spread,playerZ,loop);
    return [x,plane.y+elapsed*.22+side*spread*.31,z];
  }
  const first=Math.max(0,age-8);
  for(let emission=first;emission<visibleAge;emission+=.32){
    const end=Math.min(emission+.32,visibleAge);
    const a=edge(emission,-1), b=edge(emission,1), c=edge(end,1), d=edge(end,-1);
    if(Math.min(a[2],c[2])-playerZ<11||Math.max(a[2],c[2])-playerZ>650) continue;
    const opacity=.52*(1-clamp((age-(emission+end)*.5)/8,0,1))**1.4;
    quad(a,b,c,d,'#bfccdb',opacity,-1);
  }
}

// Vẽ đàn chim dạng chữ V lệch, mỗi con có nhịp đập cánh riêng.
function drawSkyFlock(quad,flock,now,playerZ,loop) {
  const age=now-flock.begin;
  const x=flock.x+age*flock.vx,z=skyFlightDepth(flock.z+age*flock.vz,playerZ,loop);
  if(z-playerZ<27||z-playerZ>510) return;
  const yaw=Math.atan2(flock.vx,flock.vz), cos=Math.cos(yaw), sin=Math.sin(yaw);
  for(let i=0;i<flock.count;i++){
    const seed=flock.seed+i*33;
    const rank=Math.ceil(i/2), side=i%2===0?1:-1;
    const spread=rank*4.0*side+(hash(seed)-.5)*1.8, lag=-rank*3.5+(hash(seed+4)-.5)*1.8;
    const size=.83+hash(seed+89)*.48;
    const flap=Math.sin(age*(9+hash(seed+12)*4)+hash(seed+6)*TAU);
    // Đặt các đỉnh của từng con chim trong đội hình và hướng bay.
    function point(across,height,along) {
      const dx=spread+across*size,dz=lag+along*size;
      return [x+dx*cos+dz*sin,flock.y+(hash(seed+3)-.5)*3+height*size,z+dz*cos-dx*sin];
    }
    const beak=point(0,.10,.72), tail=point(0,-.04,-.71), left=point(-.18,0,.1), right=point(.18,0,.1);
    const breast=point(0,-.18,.19),back=point(0,.17,.12);
    quad(beak,left,tail,back,'#65716d',1,-1);
    quad(beak,back,tail,right,'#72817b',1,-1);
    quad(left,breast,right,beak,'#bac0ac',1,-1);
    for(const wing of [-1,1]){
      const root=wing<0?left:right;
      const elbow=point(wing*.78,flap*.36,.13);
      const far=point(wing*1.58,flap*.75-.08,-.26);
      const inner=point(wing*.54,flap*.18,-.39);
      quad(root,elbow,inner,inner,'#b1b9a7',1,-1);
      quad(elbow,far,point(wing*1.12,flap*.53,-.49),inner,'#556363',1,-1);
    }
  }
}

// Duy trì lịch xuất hiện ngẫu nhiên của máy bay và đàn chim trong mỗi lượt chơi.
function drawSkyTraffic3D(quad,origin,originX,playerZ,now,loop,started) {
  drawCloudField(quad,origin,originX,loop,now);
  if(!started) return;
  const schedule=skyFlightClock;
  if(!schedule.planeAt||now<schedule.last){
    schedule.planeAt=now+2+Math.random()*4;
    schedule.birdsAt=now+1+Math.random()*5;
    schedule.plane=null;schedule.birds=null;
  }
  schedule.last=now;
  if(now>=schedule.planeAt){
    schedule.plane=newSkyPlane(now,originX,playerZ);
    schedule.planeAt=now+17+Math.random()*10;
  }
  if(now>=schedule.birdsAt){
    schedule.birds=newSkyFlock(now,originX,playerZ);
    schedule.birdsAt=now+13+Math.random()*19;
  }
  if(schedule.plane&&now-schedule.plane.begin<15)
    drawSkyPlane(quad,schedule.plane,now,playerZ,loop);
  if(schedule.birds&&now-schedule.birds.begin<12)
    drawSkyFlock(quad,schedule.birds,now,playerZ,loop);
}

// Chiếu các điểm trên thiên cầu bằng cùng góc quay với camera lái xe.
const starField=[];
function drawCelestialSky(context,skyLine){
  function screen(x,y,z){
    const forward=x*yawSin+z*yawCos;
    const depth=forward*pitchCos+y*pitchSin;
    if(depth<=.04) return null;
    return [cx+(x*yawCos-z*yawSin)*focal/depth,horizon-(y*pitchCos-forward*pitchSin)*focal/depth];
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
      if(!point||point[0]<0||point[0]>w||point[1]<0||point[1]>skyLine) continue;
      const size=(.75+brightness*1.5)*Math.max(.8,h/830);
      context.globalAlpha=world.stars*(.28+brightness*.67);
      context.fillRect(point[0],point[1],size,size);
    }
    context.globalAlpha=1;
  }
  if(world.sunStrength<.025) return;
  const point=screen(...world.sun);
  if(!point) return;
  const [x,y]=point,radius=clamp(focal*.035,9,28),halo=radius*3.2;
  if(x<-halo||x>w+halo||y<-halo||y>skyLine+radius) return;
  const glow=context.createRadialGradient(x,y,radius*.25,x,y,halo);
  glow.addColorStop(0,'#ffe4aade');
  glow.addColorStop(.32,'#ffc68458');
  glow.addColorStop(1,'#ffc68400');
  const animated=usesAnimatedTheme();
  context.globalAlpha=world.sunStrength*(animated?.27:.66);
  context.fillStyle=glow;
  context.fillRect(x-halo,y-halo,halo*2,halo*2);
  if(animated) context.globalAlpha=world.sunStrength*.92;
  context.fillStyle=world.twilight>.55?'#ffd09c':'#fff1c2';
  context.beginPath();context.arc(x,y,radius,0,TAU);context.fill();
  context.globalAlpha=1;
}
