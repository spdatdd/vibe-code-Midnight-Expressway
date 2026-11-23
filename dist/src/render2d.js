import { drawCelestialSky } from '../sky3d.js';
import { DAY_SECONDS, DISTANT_GROUND, HORIZON_RATIO, LOOP, SEASON_SECONDS, TAU, TUNNEL_LENGTH, clamp, hash, lerp, mod, particles } from './constants.js';
import { center, coastShore, district, footBlocked, inTunnel, passSample, relativeDistance, slope, terrainHeight, tunnelOffset } from './route.js';
import { backdrop, backdropCtx, canvas, chase, conditions, ctx, foot, passHeights, precipitation, runtime, state, usesAnimatedTheme, viewLook, wind, world } from './runtime.js';
import { carYaw, vehicleProfile, wreckExpired } from './traffic.js';

// Tính độ sáng của đèn đường; các pha ban ngày tắt hoàn toàn.
export function streetPower() {
  const t=clamp((world.daylight-.14)/.48,0,1);
  return 1-t*t*(3-2*t);
}

// Vẽ một đa giác tô phẳng.
export function poly(color, ...p) {
  ctx.fillStyle=color;
  ctx.beginPath();
  ctx.moveTo(p[0],p[1]);
  for(let i=2;i<p.length;i+=2) ctx.lineTo(p[i],p[i+1]);
  ctx.fill();
}

// Vẽ quầng sáng elip với mép mờ.
export function glow(x,y,rx,ry,color) {
  if(rx<1 || ry<1 || x+rx<0 || x-rx>runtime.w || y+ry<0 || y-ry>runtime.h) return;
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
export function project(z,x=0,y=0) {
  const dx=center(z)-runtime.originX+x,dz=z-runtime.origin,dy=y+passSample(z,passHeights)-runtime.eye;
  const right=dx*runtime.yawCos-dz*runtime.yawSin;
  const forward=dx*runtime.yawSin+dz*runtime.yawCos;
  const depth=forward*runtime.pitchCos+dy*runtime.pitchSin;
  const scale=runtime.focal/Math.max(.72,depth);
  return {x:runtime.cx+right*scale,y:runtime.horizon-(dy*runtime.pitchCos-forward*runtime.pitchSin)*scale,s:scale,depth};
}

// Tạo dải màu bầu trời dùng phía sau cảnh GLB.
export function makeSky(day=false) {
  const surface=document.createElement('canvas');
  surface.width=runtime.w*2; surface.height=Math.ceil(runtime.h*.62);
  const c=surface.getContext('2d');
  const g=c.createLinearGradient(0,0,0,surface.height);
  g.addColorStop(0,day?'#3d83be':'#0b153d');g.addColorStop(.52,day?'#8dc9e3':'#293d75');g.addColorStop(1,day?'#c8dee8':'#554271');
  c.fillStyle=g;c.fillRect(0,0,surface.width,surface.height);
  return surface;
}

// Cập nhật kích thước nội bộ theo cửa sổ và mức chất lượng.
export function resize() {
  runtime.compactCockpit=innerWidth<650||matchMedia('(pointer: coarse)').matches;
  const budget=(runtime.compactCockpit?480000:1400000)*runtime.graphics.resolution**2;
  const scale=Math.min(devicePixelRatio,1.5,1520/innerWidth,Math.sqrt(budget/(innerWidth*innerHeight)));
  runtime.w=canvas.width=Math.round(innerWidth*scale); runtime.h=canvas.height=Math.round(innerHeight*scale);
  if(runtime.world3D){backdrop.width=runtime.w;backdrop.height=runtime.h;}
  runtime.sky=makeSky();runtime.daySky=makeSky(true);
  runtime.duskClouds=document.createElement('canvas');
  runtime.duskClouds.width=runtime.w*2;runtime.duskClouds.height=runtime.sky.height;
  const clouds=runtime.duskClouds.getContext('2d');
  for(let i=0;i<24;i++){
    const x=hash(i+683)*runtime.duskClouds.width,y=(.09+hash(i+952)*.62)*runtime.duskClouds.height;
    const span=runtime.w*(.03+hash(i+715)*.14),rise=runtime.h*(.007+hash(i+721)*.023);
    clouds.beginPath();
    clouds.moveTo(x-span,y);
    for(let j=0;j<=10;j++) clouds.lineTo(x+span*(j*.2-1),y-rise*hash(i*31+j));
    for(let j=10;j>=0;j--) clouds.lineTo(x+span*(j*.2-1),y+rise*.31*hash(i*37+j));
    clouds.closePath();
    clouds.fillStyle=i%3===0?'#f5a181':'#a5779a';
    clouds.fill();
  }
}

// Tích lũy chuyển động biểu kiến của mưa tuyết, giúp hạt tăng tốc dần khi xe tăng ga.
export function advancePrecipitation(dt) {
  const response=1-Math.exp(-3.6*dt);
  precipitation.speed=lerp(precipitation.speed,clamp(Math.abs(state.v)/50,0,1),response);
  precipitation.side=lerp(precipitation.side,clamp(state.lateral/6,-1,1),response);
  precipitation.rainTravel+=dt*(.72+precipitation.speed*.56);
  precipitation.rainDrift+=dt*(-.044-precipitation.side*.056);
}

// Cập nhật ngày đêm và pha trộn thời tiết khi tuyến đường bước sang mùa kế tiếp.
export function advanceWorld(dt) {
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

export function closedCabinView(){
  return !foot.active&&state.model!==4&&state.camera<.24&&!state.wreck&&!wreckExpired(state);
}

// Tọa độ UV bám theo kính chắn gió, v tăng từ chân kính lên trên.
export function windshieldWeather(drop,blade){
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

export function drawWindshieldFallback(bottom){
  const top=runtime.h*.05,left=runtime.w*.12,width=runtime.w*.76,height=bottom-top;
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
export function windStrokes(){
  if(!state.started||inTunnel(runtime.origin)) return;
  const storm=wind.strength,cell=Math.floor(runtime.origin/20);
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
    ctx.lineWidth=Math.max(.65,runtime.h*.00115)*(.85+.32*Math.sin(Math.PI*phase));
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

export function weatherOverlay() {
  const [rain,,leaves]=world.weather;
  if(rain+leaves<.01) return;
  // Giữ mưa và lá ở ngoài hầm khi camera đi dưới mái.
  const phase=tunnelOffset(runtime.origin);
  const exposure=inTunnel(runtime.origin)?clamp(1-Math.min(phase,TUNNEL_LENGTH-phase)/6,0,1):1;
  if(exposure===0&&runtime.world3D&&!runtime.world3D.canvas.hidden) return;
  ctx.save();
  const outdoors=runtime.world3D&&!runtime.world3D.canvas.hidden?exposure:1;
  const now=world.time,{speed,side,rainTravel,rainDrift}=precipitation;
  const size=Math.max(1,runtime.h/740);
  for(const [x,y,seed] of particles){
    if(rain>.01){
      const t=mod(y+rainTravel*(.76+seed*.57),1.16)-.08;
      const dx=mod(x+rainDrift*(.76+seed*.54),1.06)*runtime.w, dy=t*runtime.h;
      const length=size*(6+seed*14+speed*(9+seed*13));
      const tilt=-.26-side*.24+(dx/runtime.w-.5)*speed*.88;
      ctx.strokeStyle='#c3e6ff';ctx.globalAlpha=rain*outdoors*(.14+seed*.31);
      ctx.lineWidth=size*(.68+seed*.55);
      ctx.beginPath();ctx.moveTo(dx,dy);ctx.lineTo(dx+length*tilt,dy+length);ctx.stroke();
    }
    if(leaves>.01&&seed>.55){
      const dx=mod(x+now*(.08+seed*.043)+Math.sin(now*2+y*TAU)*.028,1)*runtime.w;
      const dy=mod(y+now*(.09+seed*.072),1)*runtime.h;
      const span=size*(1.8+seed*3.6);
      ctx.globalAlpha=leaves*outdoors*(.45+seed*.43);
      poly(seed>.75?'#e29744':'#aa5839',dx-span,dy,dx,dy-span*.62,dx+span,dy,dx,dy+span*.64);
    }
  }
  ctx.restore();
}

// Kết xuất cùng một thế giới cho cả hai vị trí camera và vùng chuyển tiếp.
// Nước xa dùng cùng màu với mép lưới biển để nối thẳng tới chân trời phối cảnh.
export function distantSeaColor(){
  const daylight=world.daylight, mist=world.fog*.10;
  return [lerp(.075,.38,daylight)+mist,lerp(.134,.57,daylight)+mist,lerp(.224,.63,daylight)+mist];
}

export function seaAtHorizon(screenX){
  const right=(screenX-runtime.cx)*runtime.pitchCos/runtime.focal;
  const dx=runtime.yawSin+right*runtime.yawCos,dz=runtime.yawCos-right*runtime.yawSin;
  const farZ=runtime.origin+runtime.graphics.road*clamp(1+runtime.yawCos,.06,1);
  const backZ=runtime.origin-runtime.graphics.road*clamp(1-runtime.yawCos,.06,1);
  const limit=dz>0?(farZ-runtime.origin)/dz:dz<0?(backZ-runtime.origin)/dz:Infinity;
  for(let t=0;;t+=24){
    const sample=Math.min(t,limit),z=runtime.origin+dz*sample;
    const across=runtime.originX+dx*sample-center(z);
    if(Math.abs(across)<185&&sample<limit) continue;
    const area=district(z);
    return area===4||(area===3&&across>coastShore(z).edge);
  }
}

export function drawSeaHorizon(background,skyLine,focus){
  const area=district(focus);
  if((area!==3&&area!==4)||skyLine>=runtime.h) return;
  const [r,g,b]=distantSeaColor().map(channel=>Math.round(channel*255));
  background.fillStyle=`rgb(${r},${g},${b})`;
  const step=Math.max(4,Math.ceil(runtime.w/96));
  let start=null;
  for(let x=0;x<runtime.w;x+=step){
    if(seaAtHorizon(Math.min(runtime.w,x+step*.5))) start??=x;
    else if(start!==null){
      background.fillRect(start,skyLine,x-start,runtime.h-skyLine);
      start=null;
    }
  }
  if(start!==null) background.fillRect(start,skyLine,runtime.w-start,runtime.h-skyLine);
}

export function cameraGround(z,worldX){
  return passSample(z,passHeights)+terrainHeight(z,worldX-center(z));
}

export function cabinViewProfile(model){
  if(model===5) return {x:-.47,z:1.75,y:2.14};
  if(model===4) return {x:0,z:-.12,y:1.54};
  return {x:-.32,z:.28,y:vehicleProfile(model).roof-.15};
}

export function blendFromDisplayedCamera(duration,orbitCar=null){
  if(!runtime.displayedCamera) return;
  const orbit=orbitCar?{z:orbitCar.z,x:center(orbitCar.z)+orbitCar.x}:null;
  runtime.cameraTransfer={from:runtime.displayedCamera,elapsed:0,duration,orbit};
}

export function orbitToDrivingCamera(from,orbit,weight){
  const z=state.z,x=center(z)+state.x;
  const near=relativeDistance(orbit.z,from.z),far=relativeDistance(z,runtime.origin);
  const startAngle=Math.atan2(from.x-orbit.x,near);
  const endAngle=Math.atan2(runtime.originX-x,far);
  const turn=mod(endAngle-startAngle+Math.PI,TAU)-Math.PI;
  const angle=startAngle+turn*weight;
  const radius=lerp(Math.hypot(from.x-orbit.x,near),Math.hypot(runtime.originX-x,far),weight);
  runtime.origin=orbit.z+relativeDistance(orbit.z,z)*weight+Math.cos(angle)*radius;
  runtime.originX=lerp(orbit.x,x,weight)+Math.sin(angle)*radius;
}

// Giới hạn camera trong lòng hầm theo vị trí thật của xe hoặc người chơi.
export function constrainTunnelCamera(actorZ){
  const offset=tunnelOffset(actorZ);
  if(offset>=TUNNEL_LENGTH) return;
  const start=actorZ-offset;
  runtime.origin=clamp(actorZ+relativeDistance(actorZ,runtime.origin),start+.32,start+TUNNEL_LENGTH-.32);
  const middle=center(runtime.origin);
  runtime.originX=clamp(runtime.originX,middle-6,middle+6);
  const floor=cameraGround(runtime.origin,runtime.originX);
  // Giữ khoảng đệm dưới trần và phần vát nối với vách.
  runtime.eye=clamp(runtime.eye,floor+.40,floor+4.35);
}

// Tính phối cảnh, chốt camera và kết hợp cảnh 3D với bầu trời.
export function draw() {
  if(!runtime.w||!runtime.h) return;
  const dt=runtime.cameraStep;
  runtime.cameraStep=0;
  const blend=state.camera*state.camera*(3-2*state.camera);
  const scene=foot.active?runtime.vehicleTakeover:null;
  const focus=scene?.cameraFocus;
  const preview=foot.active?(focus?.z??foot.z):state.z;
  runtime.focal=Math.max(runtime.h*(runtime.compactCockpit?lerp(.57,.76,blend):.79),runtime.w*.57);runtime.cx=runtime.w*.5+state.hit*Math.sin(state.hit*50)*runtime.w*.014;
  // Dùng cùng một đường chân trời cho phối cảnh 3D và chân tòa nhà nền.
  runtime.horizon=Math.round(runtime.h*(foot.active?(foot.firstPerson?.43:.48):lerp(HORIZON_RATIO,.59,blend)));
  // Lùi camera đủ xa để thấy toàn bộ thân 3D kể cả trên màn hình dọc.
  const followYaw=(foot.active?foot.cameraYaw:carYaw(state))+viewLook.yaw;
  const footView=foot.active&&foot.firstPerson;
  const truck=!foot.active&&state.model===5;
  const cabin=foot.active?null:cabinViewProfile(state.model);
  const distance=foot.active?(footView?0:5.8):lerp(-cabin.z,chase.distance+(truck?5.5:0),blend);
  const targetX=center(preview)+(foot.active?(focus?.x??foot.x):state.x);
  const carAngle=carYaw(state);
  const mountYaw=cabin&&state.camera<.24?carAngle:followYaw;
  runtime.origin=preview-Math.cos(mountYaw)*distance;
  runtime.originX=targetX-Math.sin(mountYaw)*distance+(foot.active?0:Math.cos(followYaw)*chase.offset*blend);
  if(cabin){
    runtime.originX+=Math.cos(carAngle)*cabin.x*(1-blend);
    runtime.origin-=Math.sin(carAngle)*cabin.x*(1-blend);
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
    runtime.origin=preview-Math.cos(followYaw)*clearDistance;
    runtime.originX=targetX-Math.sin(followYaw)*clearDistance;
  }
  const ground=cameraGround(runtime.origin,runtime.originX);
  const mountGround=cabin?lerp(passSample(runtime.origin,passHeights)+terrainHeight(preview,state.x),ground,clamp(state.camera/.24,0,1)):ground;
  runtime.eye=mountGround+Math.max(.36,eyeOffset);
  let yaw=followYaw,pitch=viewLook.pitch;
  if(runtime.cameraTransfer){
    const {from,elapsed,duration,orbit}=runtime.cameraTransfer;
    const t=clamp(elapsed/duration,0,1),weight=t*t*(3-2*t);
    if(orbit) orbitToDrivingCamera(from,orbit,weight);
    else{
      runtime.origin=from.z+relativeDistance(from.z,runtime.origin)*weight;
      runtime.originX=lerp(from.x,runtime.originX,weight);
    }
    runtime.eye=lerp(from.eye,runtime.eye,weight);
    yaw=from.yaw+(mod(yaw-from.yaw+Math.PI,TAU)-Math.PI)*weight;
    pitch=lerp(from.pitch,pitch,weight);
    runtime.focal=lerp(from.focal,runtime.focal,weight);
    runtime.cx=lerp(from.cx,runtime.cx,weight);
    runtime.horizon=lerp(from.horizon,runtime.horizon,weight);
  }
  constrainTunnelCamera(foot.active?foot.z:state.z);
  runtime.displayedCamera={z:runtime.origin,x:runtime.originX,eye: runtime.eye,yaw,pitch,focal:runtime.focal,cx:runtime.cx,horizon:runtime.horizon};
  runtime.tangent=slope(runtime.origin);
  runtime.yawCos=Math.cos(yaw);runtime.yawSin=Math.sin(yaw);
  runtime.pitchCos=Math.cos(pitch);runtime.pitchSin=Math.sin(pitch);
  const skyLine=clamp(runtime.horizon+runtime.focal*Math.tan(pitch),0,runtime.h);
  const skyHeight=Math.max(runtime.sky.height,skyLine+1);
  // Xếp các canvas bằng trình duyệt để tránh sao chép ảnh từ GPU về Canvas 2D.
  const render3D=runtime.world3D?.draw();
  if(runtime.world3D) runtime.world3D.canvas.hidden=!render3D;
  const background=backdropCtx;
  background.fillStyle='#111629';background.fillRect(0,0,runtime.w,runtime.h);
  // Neo bầu trời và đường chân trời vào màn hình khi xe chạy, rẽ hoặc đổi camera.
  background.drawImage(runtime.sky,-runtime.w*.5-clamp(viewLook.yaw,-1,1)*runtime.w*.36,0,runtime.w*2,skyHeight);
  if(world.daylight>.001){
    background.globalAlpha=world.daylight;
    background.drawImage(runtime.daySky,-runtime.w*.5-clamp(viewLook.yaw,-1,1)*runtime.w*.36,0,runtime.w*2,skyHeight);
    background.globalAlpha=1;
  }
  if(world.twilight>.001){
    const animated=usesAnimatedTheme();
    const dusk=background.createLinearGradient(0,skyLine*.35,0,skyLine);
    dusk.addColorStop(0,animated?'#75518f00':'#ef866a00');
    if(animated) dusk.addColorStop(.55,`rgba(180,89,126,${world.twilight*.65})`);
    dusk.addColorStop(1,`rgba(246,143,108,${world.twilight*(animated?.82:.42)})`);
    background.fillStyle=dusk;background.fillRect(0,skyLine*.35,runtime.w,skyLine*.65);
    if(animated){
      background.globalAlpha=world.twilight*world.sunStrength*.78;
      background.drawImage(runtime.duskClouds,-runtime.w*.5-clamp(viewLook.yaw,-1,1)*runtime.w*.36,0,runtime.w*2,skyHeight);
      background.globalAlpha=1;
    }
  }
  const sun=world.daylight;
  drawCelestialSky(background,skyLine);
  // Lấp dải ở xa ngoài tầm kết xuất bằng màu sương của mặt đất.
  background.fillStyle=sun>.001?`rgb(${Math.round(29+121*sun)},${Math.round(40+131*sun)},${Math.round(75+114*sun)})`:DISTANT_GROUND;
  background.fillRect(0,skyLine,runtime.w,runtime.h-skyLine);
  if(render3D) drawSeaHorizon(background,skyLine,preview);
  if(world.fog){
    background.fillStyle=sun>.3?'#c3d5df88':'#738ba481';
    background.fillRect(0,0,runtime.w,skyLine);
  }
  ctx.clearRect(0,0,runtime.w,runtime.h);
  if(closedCabinView()) drawWindshieldFallback(runtime.h);
  else {windStrokes();weatherOverlay();}
}
