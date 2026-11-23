import { drawSkyContrail, drawSkyTraffic3D, skyFlightClock } from './sky3d.js';
import { COAST_LENGTH, COAST_SHORE_DISTANCE, FAR, LAMP, LOCAL_JUNCTION, LOCAL_LENGTH, LOOP, PASS_LENGTH, ROAD, TAU, TUNNEL_LENGTH, clamp, graphicsPresets, hash, lerp, mod, newCharacter, routeLengths } from './src/constants.js';
import { riderFallPose, sceneRiders } from './src/pedestrian.js';
import { distantSeaColor, streetPower } from './src/render2d.js';
import { center, cityBlend, coastShore, countryHouseSize, district, eachCityBuilding, eachExtraTree, eachWindTurbine, exitWidth, inTunnel, localMergeAt, localOffset, localRoadAt, localSignal, mountainCenter, passSample, railPresent, relativeDistance, roadsidePlacement, sceneryAt, slope, solidScenery, terrainHeight, tunnelOffset } from './src/route.js';
import { active, crashDebris, foot, localRoads, passHeights, runtime, sandFootprints, state, traffic, usesAnimatedTheme, wind, world } from './src/runtime.js';
import { carYaw, damageParticles, drivingLook, vehicleProfile, wreckExpired } from './src/traffic.js';
import { terrainModels } from './terrain/models.js';
import { bakeSurfaceLightMask, vehicleMaskForFace, windowMaskForFace } from './src/surface-lights.js';
import { modelMeters } from './src/model-scale.js';
import { buildCabinRoof, measureRigHead } from './src/cabin-roof.js';

// Three.js quản lý bộ đệm và lượt vẽ, còn shader giữ phép chiếu của game.
// Tạo bộ dựng cảnh và theo dõi các tài nguyên bắt buộc cho lần vẽ đầu tiên.
export function createWorld3D(onAssetProgress) {
  const canvas=document.createElement('canvas');
  const gl=canvas.getContext('webgl2',{alpha:true,antialias:false,premultipliedAlpha:false});
  if(!gl) return null;
  let renderer;
  try{
    renderer=new MidnightThree.WebGLRenderer({canvas,context:gl,alpha:true,premultipliedAlpha:false});
  }catch(error){
    console.warn('Three.js renderer unavailable',error);
    return null;
  }
  renderer.autoClear=false;
  renderer.setClearColor(0,0);
  const oceanFunctions=`
    const float routeLength=${LOOP}.0;
    const float coastLength=${COAST_LENGTH}.0;
    const float passLength=${PASS_LENGTH}.0;
    const float routeAngle=6.28318530718/routeLength;
    uniform vec3 coastJoin;
    float shoreEdge(float z){
      float t=clamp(mod(z-coastJoin.x+coastLength+50.0,routeLength)-coastLength-50.0,0.0,coastLength);
      float join=max(coastJoin.y*(1.0-smoothstep(0.0,68.0,t)),coastJoin.z*smoothstep(coastLength-68.0,coastLength,t));
      return mix(${COAST_SHORE_DISTANCE}.0,185.0,join);
    }
    float coastDistance(vec2 p){
      float t=mod(p.y,routeLength)*routeAngle;
      float road=38.0*cos(t*4.0)+10.0*sin(t*9.0)+14.0*cos(t*2.0)+8.0*sin(t*2.0);
      return p.x-road-shoreEdge(p.y);
    }
    vec3 swellPhases(vec2 p,float time){
      return vec3(dot(p,vec2(.52,.14137167))+time*1.36,
        dot(p,vec2(.28,-.17933258))+time*.91,
        dot(p,vec2(.94,.35866516))+time*1.96);
    }
    float swellHeight(vec3 waves){
      return .29*sin(waves.x)+.17*sin(waves.y)+.074*sin(waves.z)+.035*sin(waves.x*2.0);
    }`;
  const vertexSource=`
    in vec3 position;
    in vec4 tint;
    in float finish;
    uniform vec2 cameraYaw;
    uniform vec2 cameraPitch;
    uniform vec2 viewport;
    uniform vec2 vanishing;
    uniform float lens;
    uniform float altitude;
    uniform float clipOffset;
    out vec4 color;
    out vec3 world;
    out float depth;
    flat out float surfaceFinish;
    uniform float waterTime;
    uniform vec2 worldOrigin;
    ${oceanFunctions}
    void main(){
      vec2 rotated=vec2(dot(position.xz,vec2(cameraYaw.x,-cameraYaw.y)),
        dot(position.xz,cameraYaw.yx));
      vec3 displaced=position;
      if(finish<-2.5&&finish>-4.5){
        vec2 p=position.xz+worldOrigin;
        float envelope=finish<-3.5?smoothstep(0.0,4.4,coastDistance(p)):1.0;
        displaced.y+=swellHeight(swellPhases(p,waterTime))*envelope;
      }
      float height=displaced.y-altitude;
      float vertical=height*cameraPitch.x-rotated.y*cameraPitch.y;
      depth=rotated.y*cameraPitch.x+height*cameraPitch.y;
      vec2 offset=vec2(2.0*vanishing.x/viewport.x-1.0,1.0-2.0*vanishing.y/viewport.y);
      gl_Position=vec4(rotated.x*2.0*lens/viewport.x+offset.x*depth,
        vertical*2.0*lens/viewport.y+offset.y*depth,
        depth*(1.0+clipOffset/750.0)-clipOffset,depth);
      color=tint;
      world=displaced;
      surfaceFinish=finish;
    }`;
  const fragmentSource=`
    precision highp float;
    in vec4 color;
    in vec3 world;
    in float depth;
    flat in float surfaceFinish;
    uniform float textureDetail;
    uniform float animatedTheme;
    uniform float twilight;
    uniform float roadPhase;
    uniform float mountainPassStart;
    uniform vec2 headlampOrigin;
    uniform float headlampHeight;
    uniform float headlampSpread;
    uniform vec2 headlampDirection;
    uniform float altitude;
    uniform float daylight;
    uniform vec3 sunDirection;
    uniform float sunStrength;
    uniform float waterTime;
    uniform vec2 worldOrigin;
    uniform float streetIntensity;
    uniform float tunnelPhase;
    uniform float tunnelLength;
    uniform float fog;
    uniform vec3 season;
    uniform vec3 seaHorizon;
    uniform vec2 oceanRange;
    uniform sampler2D terrainDetail;
    uniform bool terrainDetailReady;
    out vec4 pixel;
    ${oceanFunctions}
    // Làm mờ vân nhỏ hơn một điểm ảnh để tránh nhấp nháy khi chạy nhanh.
    float textureWave(float phase){
      return sin(phase)*(1.0-smoothstep(0.55,2.6,fwidth(phase)));
    }
    vec2 passProfile(float z){
      float t=mod(z-mountainPassStart,routeLength)/passLength;
      if(t>=1.0) return vec2(0.0);
      float envelope=sin(3.14159265*t);
      envelope*=envelope;
      return envelope*vec2(48.0+11.0*sin(12.5663706*t),35.0*tanh(2.4*sin(18.8495559*t)));
    }
    float lightRoadCenter(float z){
      float angle=mod(z,routeLength)*routeAngle;
      return passProfile(z).y+38.0*cos(angle*4.0)+10.0*sin(angle*9.0)
        +14.0*cos(angle*2.0)+8.0*sin(angle*2.0);
    }
    // Ba mức ánh sáng, với chuyển tiếp rộng khoảng một điểm ảnh.
    float celBands(float value){
      float edge=clamp(fwidth(value),.003,.035);
      return .5*(smoothstep(.22-edge,.22+edge,value)+smoothstep(.57-edge,.57+edge,value));
    }
    void main(){
      bool paint=surfaceFinish>=8.0;
      bool trafficBeam=surfaceFinish==-6.0;
      float gloss=trafficBeam?-1.0:paint?surfaceFinish-8.0:surfaceFinish;
      float routeZ=world.z+worldOrigin.y;
      float passPosition=mod(routeZ-mountainPassStart+14.0,routeLength)-14.0;
      float mountain=smoothstep(-14.0,14.0,passPosition)*(1.0-smoothstep(passLength-14.0,passLength+14.0,passPosition));
      float roadY=world.y-passProfile(routeZ).x;
      float lampDistance=mod(world.z+roadPhase+16.0,32.0)-16.0;
      float across=world.x+worldOrigin.x-lightRoadCenter(routeZ);
      float standard=max(0.0,1.0-length(vec2(lampDistance/13.0,(abs(across)-4.25)/8.2)));
      float passDistance=mod(routeZ+64.0,128.0)-64.0;
      float lampZ=routeZ-passDistance;
      float fromPole=world.x+worldOrigin.x-lightRoadCenter(lampZ);
      float passPool=max(0.0,1.0-length(vec2(passDistance/13.0,(abs(fromPole)-5.3)/8.2)));
      passPool*=float(mod(lampZ-mountainPassStart,routeLength)<passLength)*(1.0-smoothstep(5.0,6.12,abs(across)));
      float pools=mix(standard,passPool,mountain);
      float alpha=color.a;
      if(trafficBeam){
        if(animatedTheme>.5) alpha=.20*streetIntensity*celBands(alpha/max(.20*streetIntensity,.0001));
        alpha*=1.0-mountain*smoothstep(5.05,5.9,abs(across));
      }
      pools*=1.0-smoothstep(6.0,8.0,abs(across));
      vec2 fromHeadlamp=world.xz-headlampOrigin;
      float headDistance=dot(fromHeadlamp,headlampDirection);
      float headWidth=0.55+max(headDistance,0.0)*0.10;
      float lampOffset=abs(dot(fromHeadlamp,vec2(headlampDirection.y,-headlampDirection.x)));
      float beam=clamp(headDistance/4.0,0.0,1.0)*max(0.0,1.0-headDistance/51.0)
        *max(0.0,1.0-abs(lampOffset-headlampSpread)/headWidth);
      float light=smoothstep(0.0,0.8,pools)*(1.0-smoothstep(0.0,7.0,roadY));
      float roadLight=max(0.0,1.0-abs(roadY)*0.6);
      roadLight*=mix(1.0,float(gloss==2.0),mountain);
      vec3 neon=vec3(0.065,0.32,0.58)*streetIntensity;
      vec3 lit=color.rgb;
      float rainy=season.x;
      // 2 = asphalt, 3 = unpaved ground. Independent of camera heading and curvature.
      float asphalt=float(gloss==2.0);
      float ground=float(gloss==3.0);
      vec3 seasonalGround=vec3(0.03,0.085,0.046)*season.x+vec3(0.07,0.085,0.037)*season.y
        +vec3(0.12,0.064,0.025)*season.z;
      lit+=seasonalGround*ground*mix(0.56,1.0,daylight);
      bool celSurface=animatedTheme>.5&&gloss>=0.0&&color.a>=.99;
      if(!celSurface){
        lit+=neon*light*(.62+rainy*asphalt*.65)+vec3(.22,.25,.32)*beam*roadLight*streetIntensity;
      }
      lit=mix(lit,lit*1.10+vec3(0.13,0.15,0.17),daylight*(1.0-rainy*0.26));
      float block=mod(tunnelPhase+world.z,routeLength);
      float tunnel=smoothstep(0.0,20.0,block)*(1.0-smoothstep(tunnelLength-20.0,tunnelLength,block));
      if(celSurface){
        vec3 normal=cross(dFdx(world),dFdy(world));
        normal*=inversesqrt(max(dot(normal,normal),.00000001));
        normal=faceforward(normal,world-vec3(0.0,altitude,0.0),normal);
        float sunBand=celBands(dot(normal,sunDirection));
        vec3 shade=mix(vec3(.58,.65,.82),vec3(1.23+.13*twilight,1.14,.96),sunBand);
        lit=mix(lit,lit*shade,sunStrength*(1.0-tunnel));

        // Đèn đổi mức theo vùng chiếu và hướng của mặt nhận sáng.
        float lampX=across<0.0?-1.0:1.0;
        vec3 toStreet=normalize(vec3(lampX*mix(4.25,5.3,mountain)-mix(across,fromPole,mountain),
          6.3-roadY,-mix(lampDistance,passDistance,mountain)));
        vec3 toHead=vec3(-fromHeadlamp.x,headlampHeight-world.y,-fromHeadlamp.y);
        toHead*=inversesqrt(max(dot(toHead,toHead),.0001));
        float streetBand=celBands(light*max(0.0,dot(normal,toStreet)));
        float headBand=celBands(beam*(.38+.62*max(0.0,dot(normal,toHead))));
        lit+=neon*streetBand*(.62+rainy*asphalt*.65)
          +vec3(.34,.36,.42)*headBand*streetIntensity;
      }else if(sunStrength>0.0&&gloss>=0.0){
        vec3 normal=cross(dFdx(world),dFdy(world));
        normal*=inversesqrt(max(dot(normal,normal),.00000001));
        float facing=max(0.0,dot(normal,sunDirection));
        lit+=lit*vec3(.22,.17,.10)*facing*sunStrength*(1.0-tunnel);
      }
      lit*=1.0-tunnel*0.58*daylight;
      if(!celSurface&&gloss>0.0&&gloss<2.0){
        vec3 normal=normalize(cross(dFdx(world),dFdy(world)));
        vec3 toEye=normalize(vec3(-world.x,altitude-world.y,-world.z));
        normal=faceforward(normal,-toEye,normal);
        vec3 toLamp=normalize(vec3((across<0.0?-5.3:5.3)-across,6.3-roadY,-lampDistance));
        float glint=pow(max(0.0,dot(normal,normalize(toLamp+toEye))),17.0);
        // Giữ phản xạ theo hướng đèn trên bề mặt, bỏ quầng sáng chạy dọc viền mô hình.
        lit+=neon*light*gloss*(0.24+0.51*glint);
      }
      if(textureDetail>0.0&&(asphalt>0.0||gloss==4.0||gloss==5.0)){
        vec2 p=world.xz+worldOrigin;
        float y=world.y;
        float fade=1.0-smoothstep(35.0,180.0,depth);
        float grain=0.0;
        if(asphalt>0.0){
          grain=.045*textureWave(p.x*12.0+p.y*7.0)*textureWave(p.y*16.0-p.x*9.0);
          if(textureDetail>1.0) grain+=.033*textureWave(p.x*34.0-p.y*22.0)*textureWave(p.y*37.0+p.x*21.0);
        }else if(gloss==4.0){
          float course=y*18.0;
          grain=.062*textureWave(course)+.021*textureWave(p.x*9.0+p.y*9.0+.85*cos(y*14.0));
          if(textureDetail>1.0) grain+=.032*textureWave(p.x*29.0+p.y*29.0+y*19.0);
        }else{
          // Vân đá giao nhau thay cho các dải sáng tối kéo dài theo sườn.
          grain=.046*textureWave(y*.86+p.x*.71+p.y*.32)*textureWave(y*1.4-p.x*.54+p.y*.61);
          if(textureDetail>1.0) grain+=.027*textureWave(p.x*5.5+y*6.8-p.y*3.1)
            *textureWave(p.x*3.9-y*5.4+p.y*4.6);
        }
        lit*=1.0+grain*fade;
      }
      if(terrainDetailReady&&textureDetail>0.0&&(gloss==6.0||gloss==7.0||ground>0.0)&&depth<240.0){
        vec3 at=world+vec3(worldOrigin.x,0.0,worldOrigin.y);
        float textureValue=0.5;
        if(gloss<5.5){
          textureValue=texture(terrainDetail,at.xz*.21).r;
        }else{
          vec3 normal=abs(cross(dFdx(world),dFdy(world)));
          normal/=max(.000001,normal.x+normal.y+normal.z);
          vec3 weights=normal*normal;
          weights/=max(.000001,weights.x+weights.y+weights.z);
          vec3 tiles=texture(terrainDetail,at.zy*.22).rgb*weights.x
            +texture(terrainDetail,at.xz*.21).rgb*weights.y
            +texture(terrainDetail,at.xy*.22).rgb*weights.z;
          float slope=smoothstep(.22,.74,normal.y);
          textureValue=gloss==7.0?mix(tiles.b,tiles.g,slope):mix(tiles.g,tiles.r,slope);
        }
        float strength=mix(.64,.46,animatedTheme)*(1.0-smoothstep(68.0,240.0,depth));
        lit*=1.0+(textureValue-.5)*strength;
      }
      if(gloss<0.0) lit=color.rgb;
      if(gloss<-1.5) lit=mix(color.rgb,color.rgb*0.69+vec3(0.42,0.48,0.51),daylight);
      if(gloss<-2.5){
        vec2 p=world.xz+worldOrigin;
        float a=dot(p,vec2(.83,1.3613568))-waterTime*1.58;
        float b=dot(p,vec2(-1.27,.6152286))+waterTime*1.12;
        float c=dot(p,vec2(.32,2.3470507))-waterTime*2.41;
        vec2 ripple=vec2(cos(a)*.035-cos(b)*.049+cos(c)*.022,cos(a)*.058+cos(b)*.024+cos(c)*.066);
        vec3 waves=swellPhases(p,waterTime);
        float coastal=coastDistance(p);
        if(gloss>-4.5){
          float weight=gloss<-3.5?smoothstep(0.0,4.4,coastal):1.0;
          vec3 w=cos(waves)*vec3(.29,.17,.074);
          ripple+=vec2(dot(w,vec3(.52,.28,.94)),dot(w,vec3(.14137167,-.17933258,.35866516)))*weight;
        }
        vec3 normal=normalize(vec3(-ripple.x,1.0,-ripple.y));
        vec3 toEye=normalize(vec3(-world.x,altitude-world.y,-world.z));
        vec3 halfAngle=sunDirection+toEye;
        halfAngle*=inversesqrt(max(dot(halfAngle,halfAngle),.000001));
        float facing=max(dot(normal,halfAngle),0.0);
        float fleck=.55+.45*sin(a+b)*sin(c);
        float glint=(pow(facing,290.0)*.63+pow(facing,72.0)*.12)*fleck*sunStrength;
        float fresnel=pow(1.0-max(dot(normal,toEye),0.0),3.0);
        vec3 reflection=mix(vec3(.105,.168,.264),vec3(.39,.59,.68),daylight);
        lit=mix(color.rgb*(.81+.23*daylight),reflection,fresnel*.67+.12);
        lit+=vec3(.027,.058,.060)*(sin(a)*.50+sin(b)*.33+sin(c)*.17)*exp(-max(depth,0.0)*.008);
        float roadCenter=lightRoadCenter(p.y);
        float across=p.x-roadCenter;
        float streamCenter=-21.0+3.1*sin(p.y*.034)+1.2*sin(p.y*.10);
        float shore=gloss<-4.5?2.4-abs(across-streamCenter):gloss<-3.5?coastal:100.0;
        float shallows=1.0-smoothstep(0.0,gloss<-4.5?1.65:13.0,shore);
        float shoreWave=.14+.16*sin(p.y*1.08-waterTime*1.35)+.08*sin(p.y*3.1+waterTime*.86);
        float edge=1.0-smoothstep(.10,.39,abs(shore-shoreWave));
        float rippleFoam=smoothstep(.77,.93,sin(a*.45+b*.29+sin(c*.48)*.92))
          *smoothstep(-.18,.77,sin(b*.39-c*.34))*shallows*.57;
        vec3 shallowColor=mix(vec3(.09,.28,.34),vec3(.22,.78,.67),daylight);
        lit=mix(lit,shallowColor,shallows*.77);
        lit=mix(lit,vec3(.82,.97,.92),(edge*.90+rippleFoam*.6)*(.27+.69*daylight));
        if(gloss>-4.5){
          float crest=smoothstep(.24,.50,swellHeight(waves));
          float tendril=smoothstep(.04,.77,sin(a*.63+sin(b*.62)*1.45)+sin(c*.71)*.36);
          float surf=gloss<-3.5?1.0-smoothstep(2.0,17.0,max(0.0,coastal)):0.0;
          float breaker=smoothstep(.73,.98,sin(waves.x+.33*sin(waves.y)))*surf;
          float foam=clamp(crest*tendril*.63+breaker*(.24+.49*tendril),0.0,.87);
          lit=mix(lit,vec3(.86,.98,.99),foam*(.27+daylight*.71));
        }
        lit+=vec3(1.00,.77,.43)*glint;
      }
      // Nén vùng sáng mạnh mà vẫn giữ sắc độ vật liệu ở phần tối.
      float peak=max(lit.r,max(lit.g,lit.b));
      if(peak>.75){
        float compressed=.75+.23*(1.0-exp(-(peak-.75)/.23));
        lit*=compressed/peak;
      }
      vec3 haze=mix(vec3(0.12,0.158,0.298),vec3(0.59,0.67,0.74),daylight);
      haze=mix(haze,vec3(.47,.40,.64),animatedTheme*twilight*.69);
      float distanceFog=smoothstep(72.0,690.0,depth)*(0.91+0.06*rainy);
      if(gloss<-2.5&&gloss>-4.5){
        float lateralEdge=abs(coastDistance(world.xz+worldOrigin)+shoreEdge(world.z+worldOrigin.y));
        float endGap=min(world.z-oceanRange.x,oceanRange.y-world.z);
        // Hạ tương phản sóng ở rìa lưới, giữ phần sóng gần bờ.
        float farWater=max(smoothstep(95.0,183.0,lateralEdge),
          (1.0-smoothstep(0.0,45.0,endGap))*smoothstep(20.0,110.0,length(world.xz)));
        pixel=vec4(mix(lit,seaHorizon,max(farWater,max(distanceFog,fog*smoothstep(12.0,130.0,depth)))),alpha);
      }else pixel=vec4(mix(lit,haze,max(distanceFog,fog*smoothstep(10.0,155.0,depth))),alpha);
    }`;

  const screenVertex=`
      out vec2 uv;
      void main(){
        uv=vec2(float((gl_VertexID << 1) & 2),float(gl_VertexID & 2));
        gl_Position=vec4(uv*2.0-1.0,0.0,1.0);
      }`;
  const screenFragment=`
      precision highp float;
      in vec2 uv;
      uniform sampler2D scene;
      uniform float speed;
      uniform float steering;
      out vec4 pixel;
      vec4 sampleScene(vec2 p){
        vec4 c=texture(scene,p);
        return vec4(c.rgb*c.a,c.a);
      }
      void main(){
        vec2 radial=(uv-vec2(0.5,0.56))*speed*0.024;
        radial.x+=steering*speed*0.005;
        vec4 base=sampleScene(uv)*0.63+sampleScene(uv-radial*0.42)*0.23
          +sampleScene(uv-radial)*0.14;
        pixel=vec4(base.rgb/max(base.a,0.0001),base.a);
      }`;
  const uniforms={
    cameraYaw:{value:[0,0]},
    cameraPitch:{value:[0,0]},
    viewport:{value:[0,0]},
    vanishing:{value:[0,0]},
    lens:{value:0},
    altitude:{value:0},
    clipOffset:{value:0},
    roadPhase:{value:0},
    mountainPassStart:{value:0},
    headlampOrigin:{value:[0,0]},
    headlampHeight:{value:0},
    headlampSpread:{value:0},
    headlampDirection:{value:[0,0]},
    daylight:{value:0},
    season:{value:[0,0,0]},
    sunDirection:{value:[0,0,0]},
    sunStrength:{value:0},
    waterTime:{value:0},
    textureDetail:{value:0},
    coastJoin:{value:[0,0,0]},
    worldOrigin:{value:[0,0]},
    streetIntensity:{value:0},
    tunnelPhase:{value:0},
    tunnelLength:{value:0},
    fog:{value:0},
    animatedTheme:{value:0},
    twilight:{value:0},
    seaHorizon:{value:[0,0,0]},
    oceanRange:{value:[0,0]},
    terrainDetail:{value:null},
    terrainDetailReady:{value:false}
  };
  const startupAssets=[];
  let loadedAssets=0;
  // Báo tiến độ sau khi tài nguyên đã giải mã và được chuẩn bị để vẽ.
  function trackStartupAsset(url,load,setup){
    startupAssets.push(load.then(setup).then(()=>{
      onAssetProgress?.(++loadedAssets,startupAssets.length);
    }).catch(error=>{
      throw new Error(`Không tải được ${url}`,{cause:error});
    }));
  }
  const terrainUrl='terrain/land-detail.webp';
  trackStartupAsset(terrainUrl,new MidnightThree.TextureLoader().loadAsync(terrainUrl),texture=>{
    texture.wrapS=texture.wrapT=MidnightThree.RepeatWrapping;
    texture.needsUpdate=true;
    uniforms.terrainDetail.value=texture;
    uniforms.terrainDetailReady.value=true;
  });
  const camera=new MidnightThree.Camera();
  const scene=new MidnightThree.Scene();
  const glbScene=new MidnightThree.Scene();
  // Tạo Environment Map bầu trời + mặt đường để vật liệu kim loại/sơn bóng phản xạ sáng tự nhiên.
  const envW=64,envH=32,envData=new Uint8Array(envW*envH*4);
  for(let y=0;y<envH;y++){
    const v=y/(envH-1);
    const sky=v<0.5;
    const t=sky?1-v*2:(v-0.5)*2;
    const r=sky?lerp(150,95,t):lerp(110,45,t);
    const g=sky?lerp(165,125,t):lerp(112,48,t);
    const b=sky?lerp(195,165,t):lerp(120,55,t);
    for(let x=0;x<envW;x++){
      const idx=(y*envW+x)*4;
      envData[idx]=r;envData[idx+1]=g;envData[idx+2]=b;envData[idx+3]=255;
    }
  }
  const glbEnv=new MidnightThree.DataTexture(envData,envW,envH);
  glbEnv.mapping=MidnightThree.EquirectangularReflectionMapping;
  glbEnv.colorSpace=MidnightThree.SRGBColorSpace;
  glbEnv.magFilter=MidnightThree.LinearFilter;
  glbEnv.minFilter=MidnightThree.LinearFilter;
  glbEnv.needsUpdate=true;
  glbScene.environment=glbEnv;
  const glbAmbient=new MidnightThree.AmbientLight(0xffffff,1.1);
  const glbHemi=new MidnightThree.HemisphereLight(0xeef5ff,0x707885,1.4);
  const glbSun=new MidnightThree.DirectionalLight(0xfff8ee,2.8);
  glbSun.position.set(1,2,1);
  glbScene.add(glbAmbient,glbHemi,glbSun);
  const glbPools=[];
  let glbUsed=0;
  // Chỉ nạp GLB tối ưu đi kèm bản web và APK.
  const glbLoader=new MidnightThree.GLTFLoader().setMeshoptDecoder(MidnightThree.MeshoptDecoder);
  const modelDirectory=new URL('./assets/models-optimized/',import.meta.url);
  const glbVec=new MidnightThree.Vector3();
  function computeSceneBounds(root){
    root.updateMatrixWorld(true);
    const min={x:Infinity,y:Infinity,z:Infinity};
    const max={x:-Infinity,y:-Infinity,z:-Infinity};
    root.traverse(obj=>{
      if(!obj.isMesh||!obj.geometry) return;
      if(!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
      const bb=obj.geometry.boundingBox;
      if(!bb) return;
      for(let ix=0;ix<2;ix++) for(let iy=0;iy<2;iy++) for(let iz=0;iz<2;iz++){
        glbVec.set(ix?bb.max.x:bb.min.x,iy?bb.max.y:bb.min.y,iz?bb.max.z:bb.min.z).applyMatrix4(obj.matrixWorld);
        if(glbVec.x<min.x) min.x=glbVec.x; if(glbVec.x>max.x) max.x=glbVec.x;
        if(glbVec.y<min.y) min.y=glbVec.y; if(glbVec.y>max.y) max.y=glbVec.y;
        if(glbVec.z<min.z) min.z=glbVec.z; if(glbVec.z>max.z) max.z=glbVec.z;
      }
    });
    return {
      min, max,
      size:{x:max.x-min.x,y:max.y-min.y,z:max.z-min.z},
      center:{x:(min.x+max.x)*0.5,y:(min.y+max.y)*0.5,z:(min.z+max.z)*0.5}
    };
  }
  const glbCarUniforms={
    uCameraYaw:uniforms.cameraYaw,
    uCameraPitch:uniforms.cameraPitch,
    uViewport:uniforms.viewport,
    uVanishing:uniforms.vanishing,
    uLens:uniforms.lens,
    uAltitude:uniforms.altitude,
    uClipOffset:uniforms.clipOffset,
    uUsePost:{value:0}
  };
  // Chiếu vị trí đỉnh sau biến đổi của Three.js, bao gồm skinning của NPC.
  function patchGlbMaterial(mat,doubleSide=false){
    const cloned=mat.clone();
    cloned.transparent=false;
    cloned.depthWrite=true;
    cloned.envMapIntensity=0.8;
    if(doubleSide) cloned.side=MidnightThree.DoubleSide;
    cloned.customProgramCacheKey=()=>'glb-static';
    cloned.onBeforeCompile=shader=>{
      shader.uniforms.uCameraYaw=glbCarUniforms.uCameraYaw;
      shader.uniforms.uCameraPitch=glbCarUniforms.uCameraPitch;
      shader.uniforms.uViewport=glbCarUniforms.uViewport;
      shader.uniforms.uVanishing=glbCarUniforms.uVanishing;
      shader.uniforms.uLens=glbCarUniforms.uLens;
      shader.uniforms.uAltitude=glbCarUniforms.uAltitude;
      shader.uniforms.uClipOffset=glbCarUniforms.uClipOffset;
      shader.uniforms.uUsePost=glbCarUniforms.uUsePost;
      const vs=`
        uniform vec2 uCameraYaw;
        uniform vec2 uCameraPitch;
        uniform vec2 uViewport;
        uniform vec2 uVanishing;
        uniform float uLens;
        uniform float uAltitude;
        uniform float uClipOffset;
      `+shader.vertexShader;
      shader.vertexShader=vs.replace('#include <project_vertex>',`
          vec4 worldPos=modelMatrix*vec4(transformed,1.0);
          vec2 rotated=vec2(dot(worldPos.xz,vec2(uCameraYaw.x,-uCameraYaw.y)),
            dot(worldPos.xz,uCameraYaw.yx));
          float vHeight=worldPos.y-uAltitude;
          float vVert=vHeight*uCameraPitch.x-rotated.y*uCameraPitch.y;
          float vDepth=rotated.y*uCameraPitch.x+vHeight*uCameraPitch.y;
          vec2 vOffset=vec2(2.0*uVanishing.x/uViewport.x-1.0,1.0-2.0*uVanishing.y/uViewport.y);
          gl_Position=vec4(rotated.x*2.0*uLens/uViewport.x+vOffset.x*vDepth,
            vVert*2.0*uLens/uViewport.y+vOffset.y*vDepth,
            vDepth*(1.0+uClipOffset/750.0)-uClipOffset,vDepth);
          vec4 mvPosition=vec4(worldPos.xyz-vec3(0.0,uAltitude,0.0),1.0);
        `);
      shader.fragmentShader=`uniform float uUsePost;\n`+shader.fragmentShader
        .replace('#include <colorspace_fragment>',`
          #include <colorspace_fragment>
          if(uUsePost>0.5){
            vec3 c=clamp(gl_FragColor.rgb,0.0,1.0);
            gl_FragColor.rgb=pow(c,vec3(1.0/2.2));
          }
        `);
    };
    return cloned;
  }
  // Tìm các mảng mặt rời để tách bộ phận chuyển động của GLB.
  function connectedGlbParts(geometry){
    const positions=geometry.attributes.position,indices=geometry.index.array;
    const parents=Array.from({length:positions.count},(_,i)=>i);
    const welded=new Map();
    // Gộp đỉnh trùng vị trí tại các đường nối UV trước khi tìm cụm mặt.
    for(let i=0;i<positions.count;i++){
      const key=[positions.getX(i),positions.getY(i),positions.getZ(i)].map(v=>Math.round(v*1e5)).join(',');
      if(welded.has(key)) parents[i]=welded.get(key);
      else welded.set(key,i);
    }
    // Tìm đại diện cụm và rút ngắn đường dẫn khi duyệt.
    function root(i){
      while(parents[i]!==i){
        parents[i]=parents[parents[i]];
        i=parents[i];
      }
      return i;
    }
    for(let i=0;i<indices.length;i+=3){
      const first=root(indices[i]);
      parents[root(indices[i+1])]=first;
      parents[root(indices[i+2])]=first;
    }
    const groups=new Map();
    const point=new MidnightThree.Vector3();
    for(let i=0;i<indices.length;i++){
      const index=indices[i],id=root(index);
      if(!groups.has(id)) groups.set(id,{indices:[],bounds:new MidnightThree.Box3()});
      const part=groups.get(id);
      part.indices.push(index);
      part.bounds.expandByPoint(point.fromBufferAttribute(positions,index));
    }
    return [...groups.values()];
  }
  // Giữ chung dữ liệu đỉnh, mỗi bộ phận dùng bộ chỉ mục tam giác riêng.
  function glbSubmesh(geometry,indices){
    const part=new MidnightThree.BufferGeometry();
    for(const name of Object.keys(geometry.attributes)) part.setAttribute(name,geometry.attributes[name]);
    part.setIndex(indices);
    return part;
  }
  // Đặt tâm xoay mà không thay đổi vị trí hình học ban đầu.
  function addGlbPivot(mesh,geometry,indices,center){
    const pivot=new MidnightThree.Group();
    const part=new MidnightThree.Mesh(glbSubmesh(geometry,indices),mesh.material);
    pivot.position.copy(center);
    part.position.copy(center).negate();
    mesh.add(pivot);
    pivot.add(part);
    return pivot;
  }
  // Đưa lốp xe máy về cùng bán kính theo hai phương trong mặt phẳng bánh.
  function roundMotorcycleTire(geometry,wheel){
    const {position,normal}=geometry.attributes;
    const width=wheel.bounds.max.x-wheel.bounds.min.x;
    const scale=2*wheel.radius/width;
    for(const index of new Set(wheel.indices)){
      position.setX(index,wheel.center.x+(position.getX(index)-wheel.center.x)*scale);
      if(normal){
        const x=normal.getX(index)/scale,y=normal.getY(index),z=normal.getZ(index);
        const length=Math.hypot(x,y,z)||1;
        normal.setXYZ(index,x/length,y/length,z/length);
      }
    }
  }
  // Tách bánh và mâm theo cụm riêng ở sát đáy của mỗi loại xe.
  function splitVehicleWheels(template,expected){
    const mesh=template.getObjectByProperty('isMesh',true),geometry=mesh.geometry;
    const groups=connectedGlbParts(geometry);
    const floor=Math.min(...groups.map(part=>part.bounds.min.y));
    const body=[],wheels=[],stand=[],frontFork=[];
    const bike=expected===2,maxDiameter=bike?.36:.22;
    for(const part of groups.values()){
      const size=part.bounds.getSize(new MidnightThree.Vector3());
      const center=part.bounds.getCenter(new MidnightThree.Vector3());
      const minDiameter=bike?.24:.10;
      const wheel=part.bounds.min.y<=floor+.009&&size.x>minDiameter&&size.y>minDiameter
        &&size.x<maxDiameter&&size.y<maxDiameter&&size.z<.10
        &&(bike?Math.abs(center.z)<.03:Math.abs(center.z)>.10);
      if(wheel) wheels.push({...part,center,radius:size.y*.5});
    }
    if(wheels.length!==expected) throw new Error('Không xác định được các cụm bánh rời');
    if(bike) for(const wheel of wheels) roundMotorcycleTire(geometry,wheel);
    // Các mặt mâm và nan hoa có thể là cụm riêng nằm trọn trong lốp.
    for(const part of groups.values()){
      if(wheels.some(wheel=>wheel.indices===part.indices)) continue;
      const {min,max}=part.bounds;
      // Chắn bùn trước và hai ống phuộc đổi hướng cùng bánh, độc lập với góc lăn.
      if(bike&&min.x<-.27&&max.x<-.175&&min.y>-.24&&max.y<-.025
        &&(max.x-min.x>.23||Math.abs((min.z+max.z)*.5)>.047&&max.y-min.y>.10)){
        frontFork.push(...part.indices);
        continue;
      }
      // Chân chống giữa là các cụm nhỏ dưới gầm, tách khỏi lốp và động cơ.
      if(bike&&part.bounds.min.x>.035&&part.bounds.max.x<.078
        &&part.bounds.min.y<-.25&&part.bounds.max.y<-.21){
        stand.push(...part.indices);
        continue;
      }
      const rim=wheels.find(({bounds})=>
        part.bounds.min.x>=bounds.min.x-.003&&part.bounds.max.x<=bounds.max.x+.003
        &&part.bounds.min.y>=bounds.min.y-.003&&part.bounds.max.y<=bounds.max.y+.003
        &&part.bounds.min.z>=bounds.min.z-.013&&part.bounds.max.z<=bounds.max.z+.013);
      const target=rim?.indices??body;
      for(const index of part.indices) target.push(index);
    }
    mesh.geometry=glbSubmesh(geometry,body);
    template.updateMatrixWorld(true);
    if(stand.length){
      const pivot=addGlbPivot(mesh,geometry,stand,new MidnightThree.Vector3(.066,-.228,0));
      pivot.userData.kickstand=true;
    }
    for(const wheel of wheels){
      const pivot=addGlbPivot(mesh,geometry,wheel.indices,wheel.center);
      pivot.userData.wheelRadius=wheel.radius*Math.abs(template.scale.y);
      pivot.userData.frontWheel=wheel.center.x<0;
      pivot.userData.wheelContact=wheel.center.clone().add(new MidnightThree.Vector3(0,-wheel.radius,0)).applyMatrix4(mesh.matrixWorld).toArray();
      pivot.rotation.order='YXZ';
      if(bike&&pivot.userData.frontWheel&&frontFork.length){
        const steering=addGlbPivot(mesh,geometry,frontFork,wheel.center);
        steering.userData.motorcycleSteering=true;
        steering.add(pivot);
        pivot.position.set(0,0,0);
      }
    }
  }
  // Lấy màu trung bình của vùng UV trên texture để nhận diện mặt kính đã bake.
  function vehicleTextureSampler(texture){
    const image=texture?.image;
    if(!image?.width||!image.height) return null;
    const surface=document.createElement('canvas');
    surface.width=image.width;surface.height=image.height;
    const ctx=surface.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(image,0,0);
    const pixels=ctx.getImageData(0,0,image.width,image.height).data;
    return (u,v)=>{
      const x=clamp(Math.floor(u*image.width),0,image.width-1);
      const y=clamp(Math.floor(v*image.height),0,image.height-1);
      const index=(y*image.width+x)*4;
      return Math.max(pixels[index],pixels[index+1],pixels[index+2]);
    };
  }
  // Giới hạn lựa chọn kính theo vùng cabin đo từ mỗi GLB gốc.
  const vehicleCabins={
    sports:[-.24,.27,.025,.105,.14,85],
    sedan:[-.27,.416,.047,.159,.143,87],
    suv:[-.29,.469,.057,.208,.157,75],
    truck:[-.499,-.219,-.012,.154,.11,82]
  };
  // Tách kính thành lượt vẽ trong suốt riêng, giữ nguyên phần còn lại của thân.
  function splitVehicleGlass(template,kind){
    const cabin=vehicleCabins[kind];
    if(!cabin) return;
    const mesh=template.getObjectByProperty('isMesh',true);
    const geometry=mesh.geometry,positions=geometry.attributes.position,uv=geometry.attributes.uv;
    const sample=vehicleTextureSampler(mesh.material.map);
    if(!uv||!sample) return;
    const [left,right,bottom,top,side,threshold]=cabin;
    const body=[],glass=[],indices=geometry.index.array;
    for(let i=0;i<indices.length;i+=3){
      const a=indices[i],b=indices[i+1],c=indices[i+2];
      const x=(positions.getX(a)+positions.getX(b)+positions.getX(c))/3;
      const y=(positions.getY(a)+positions.getY(b)+positions.getY(c))/3;
      const z=(positions.getZ(a)+positions.getZ(b)+positions.getZ(c))/3;
      const dx=positions.getX(b)-positions.getX(a),dy=positions.getY(b)-positions.getY(a),dz=positions.getZ(b)-positions.getZ(a);
      const ex=positions.getX(c)-positions.getX(a),ey=positions.getY(c)-positions.getY(a),ez=positions.getZ(c)-positions.getZ(a);
      const nx=Math.abs(dy*ez-dz*ey),ny=Math.abs(dz*ex-dx*ez);
      const length=Math.hypot(nx,ny,dx*ey-dy*ex);
      const u=(uv.getX(a)+uv.getX(b)+uv.getX(c))/3,v=(uv.getY(a)+uv.getY(b)+uv.getY(c))/3;
      // Kính trước nghiêng và có vùng phản sáng trên texture, nên nhận diện rộng hơn kính bên.
      const front=x<left+(right-left)*.48&&nx>.16*length;
      const onCabin=x>left&&x<right&&y>bottom&&y<top&&ny<(front?.987:.90)*length
        &&(front||Math.abs(z)>side||kind!=='truck'&&x>right-(right-left)*.24);
      const surface=onCabin&&sample(u,v)<threshold+(front?28:0)?glass:body;
      surface.push(a,b,c);
    }
    if(!glass.length) return;
    const pane=mesh.material.clone();
    pane.name=`vehicle-glass-${kind}`;
    mesh.geometry=glbSubmesh(geometry,body);
    mesh.add(new MidnightThree.Mesh(glbSubmesh(geometry,glass),pane));
  }
  // Tách ba cánh của turbine Meshy, giữ thân, trụ và hộp máy cố định.
  function splitTurbineRotor(template){
    const mesh=template.getObjectByProperty('isMesh',true),geometry=mesh.geometry;
    const tower=[],blades=[];
    for(const part of connectedGlbParts(geometry)){
      const {min,max}=part.bounds;
      if(min.z>.10&&max.z<.15&&Math.max(max.x-min.x,max.y-min.y)>.15) blades.push(part);
      else for(const index of part.indices) tower.push(index);
    }
    if(blades.length!==3) throw new Error('Turbine không có đủ ba cánh rời');
    mesh.geometry=glbSubmesh(geometry,tower);
    const pivot=addGlbPivot(mesh,geometry,blades.flatMap(part=>part.indices),new MidnightThree.Vector3(-.015,.232,.123));
    pivot.userData.turbineRotor=true;
  }
  // Sửa pháp tuyến bằng 0 trong GLB, vì chúng tạo mảng đen hình tam giác khi chiếu sáng.
  function repairCityNormals(geometry){
    const {position,normal}=geometry.attributes;
    if(!normal||!geometry.index) return;
    const bad=new Set();
    for(let i=0;i<normal.count;i++)
      if(Math.hypot(normal.getX(i),normal.getY(i),normal.getZ(i))<.01) bad.add(i);
    if(!bad.size) return;
    const origin=new MidnightThree.Vector3(),ab=new MidnightThree.Vector3(),ac=new MidnightThree.Vector3();
    const indices=geometry.index.array;
    for(let i=0;i<indices.length;i+=3){
      const a=indices[i],b=indices[i+1],c=indices[i+2];
      if(!bad.has(a)&&!bad.has(b)&&!bad.has(c)) continue;
      origin.fromBufferAttribute(position,a);
      ab.fromBufferAttribute(position,b).sub(origin);
      ac.fromBufferAttribute(position,c).sub(origin);
      ab.cross(ac);
      if(ab.lengthSq()<1e-16) continue;
      ab.normalize();
      for(const id of [a,b,c]) if(bad.delete(id)) normal.setXYZ(id,ab.x,ab.y,ab.z);
    }
    for(const id of bad) normal.setXYZ(id,0,1,0);
    normal.needsUpdate=true;
  }
  // Giữ texture mặt tiền nhưng hạn chế độ bóng và gợn pháp tuyến khi đi qua đèn.
  function softenBuildingMaterial(material,windowMask){
    material.metalness=0;
    material.metalnessMap=null;
    material.roughness=.9;
    material.roughnessMap=null;
    material.envMapIntensity=.08;
    if(windowMask) material.normalMap=null;
    else material.normalScale.multiplyScalar(.24);
    const compile=material.onBeforeCompile;
    material.customProgramCacheKey=()=>windowMask?'glb-city-windows':'glb-building';
    material.onBeforeCompile=shader=>{
      compile(shader);
      shader.uniforms.uBuildingDaylight=uniforms.daylight;
      if(windowMask) shader.uniforms.uWindowMask={value:windowMask};
      const windows=windowMask?`
        float night=1.0-smoothstep(0.12,0.64,uBuildingDaylight);
        outgoingLight += vec3(0.40,0.24,0.12)*texture2D(uWindowMask,vMapUv).r*night;
      `:'';
      shader.fragmentShader='uniform float uBuildingDaylight;\n'+(windowMask?'uniform sampler2D uWindowMask;\n':'')+shader.fragmentShader.replace('#include <opaque_fragment>',`
        outgoingLight *= mix(vec3(0.23,0.28,0.38),vec3(0.91,0.94,0.97),uBuildingDaylight);
        ${windowMask?`
          vec3 facadeFloor=mix(vec3(.015,.022,.034),vec3(.12,.15,.19),uBuildingDaylight);
          if(any(isnan(outgoingLight))||any(isinf(outgoingLight))) outgoingLight=facadeFloor+diffuseColor.rgb*.30;
          float invalid=1.0-smoothstep(.018,.13,max(outgoingLight.r,max(outgoingLight.g,outgoingLight.b)));
          outgoingLight=mix(outgoingLight,max(outgoingLight,facadeFloor),invalid);
        `:''}
        ${windows}
        #include <opaque_fragment>
      `);
    };
  }
  // Phát sáng trực tiếp trên vật liệu vỏ xe để không có lớp hình học chồng lên lens.
  function applyVehicleLightMaterial(material,mask,signals){
    const compile=material.onBeforeCompile;
    material.customProgramCacheKey=()=>'glb-vehicle-lens';
    material.onBeforeCompile=shader=>{
      compile(shader);
      shader.uniforms.uLensMask={value:mask};
      shader.uniforms.uVehicleSignals=signals;
      shader.fragmentShader='uniform sampler2D uLensMask;\nuniform vec3 uVehicleSignals;\n'+
        shader.fragmentShader.replace('#include <opaque_fragment>',`
          vec2 lens=texture2D(uLensMask,vMapUv).rg;
          outgoingLight+=lens.r*uVehicleSignals.x*vec3(0.84,1.0,1.19);
          outgoingLight+=lens.g*uVehicleSignals.y*mix(vec3(1.2,0.035,0.028),vec3(1.0,0.84,0.64),uVehicleSignals.z);
          #include <opaque_fragment>
        `);
    };
  }
  // Kích thước và độ nghiêng lens dùng đơn vị gốc của từng GLB.
  const vehicleLampLayout={
    sports:[[-.021,.158,.041,.010,.46],[.016,.176,.029,.008,-.22]],
    sedan:[[.020,.164,.046,.016,.29],[.037,.176,.035,.013,-.12]],
    suv:[[.008,.181,.044,.014,.20],[.041,.174,.038,.015,-.07]],
    truck:[[-.115,.153,.030,.019,0],[-.191,.146,.025,.012,0]],
    motorcycle:[[.137,0,.035,.025,0],[.066,0,.031,.014,0]]
  };
  // Đo vị trí lens trên GLB để đặt chùm sáng và giới hạn mặt nạ theo chiều sâu.
  function measureVehicleLamps(template,kind){
    const mesh=template.getObjectByProperty('isMesh',true);
    const geometry=mesh.geometry,positions=geometry.attributes.position,indices=geometry.index.array;
    template.updateMatrixWorld(true);
    const lights=[];
    // Tìm giao điểm bên ngoài thân xe tại cao độ và độ lệch đã cho.
    function surfaceAt(y,z,front){
      let x=front?Infinity:-Infinity;
      for(let i=0;i<indices.length;i+=3){
        const a=indices[i],b=indices[i+1],c=indices[i+2];
        const ay=positions.getY(a),az=positions.getZ(a);
        const by=positions.getY(b)-ay,bz=positions.getZ(b)-az;
        const cy=positions.getY(c)-ay,cz=positions.getZ(c)-az;
        const det=by*cz-bz*cy;
        if(Math.abs(det)<1e-9) continue;
        const v=((y-ay)*cz-(z-az)*cy)/det,w=(by*(z-az)-bz*(y-ay))/det;
        if(v<0||w<0||v+w>1) continue;
        const at=positions.getX(a)*(1-v-w)+positions.getX(b)*v+positions.getX(c)*w;
        x=front?Math.min(x,at):Math.max(x,at);
      }
      return x;
    }
    vehicleLampLayout[kind].forEach(([y,lateral,w,h,tilt],end)=>{
      const front=end===0,offset=front?-.006:.006;
      for(const z of lateral?[-lateral,lateral]:[0]){
        const x=surfaceAt(y,z,front);
        if(!Number.isFinite(x)) continue;
        const center=new MidnightThree.Vector3(x+offset,y,z).applyMatrix4(mesh.matrixWorld);
        lights.push({center,local:[x,y,z],front,width:w,height:h,tilt});
      }
    });
    return lights;
  }
  // Dùng chung hình học của mẫu GLB cho các vật thể và xe cùng loại.
  function createGlbPool(url,count,setupTemplate,{wheelCount=0,vehicle=null,roof=null,doubleSide=false,building=false,turbine=false,bird=false}={}){
    const pool={slots:[],ready:false,used:0,expand:building==='city'};
    glbPools.push(pool);
    trackStartupAsset(url,glbLoader.loadAsync(new URL(url,modelDirectory).href),gltf=>{
      const template=gltf.scene;
      const bounds=computeSceneBounds(template);
      if(!Number.isFinite(bounds.size.y)||bounds.size.y<=0) throw new Error('GLB không có hình học hợp lệ');
      setupTemplate(template,bounds,bounds.size,bounds.center);
      if(wheelCount) splitVehicleWheels(template,wheelCount);
      const lamps=vehicle?measureVehicleLamps(template,vehicle):null;
      if(vehicle) splitVehicleGlass(template,vehicle);
      if(turbine) splitTurbineRotor(template);
      const body=template.getObjectByProperty('isMesh',true);
      if(building==='city') repairCityNormals(body.geometry);
      const lensMask=lamps?.length?bakeSurfaceLightMask(MidnightThree,body.geometry,body.material.map,
        (a,b,c)=>vehicleMaskForFace(lamps,a,b,c)):null;
      const windowMask=building==='city'?bakeSurfaceLightMask(MidnightThree,body.geometry,body.material.map,windowMaskForFace):null;
      if(lensMask) lensMask.name=`${vehicle}-lens-mask`;
      if(windowMask) windowMask.name=`${url}-window-mask`;
      const fitHeight=roof===null?null:fitVehicleBody(template,bounds,body,lamps,roof);
      const cabinRoof=vehicle&&vehicle!=='motorcycle'?buildCabinRoof(MidnightThree,template,body):null;
      const sharedMats=new Map();
      template.traverse(obj=>{
        if(obj.isMesh&&obj.material&&!sharedMats.has(obj.material)){
          const material=patchGlbMaterial(obj.material,doubleSide);
          if(building) softenBuildingMaterial(material,windowMask);
          if(obj.material.name.startsWith('vehicle-glass-')){
            material.transparent=true;
            material.depthWrite=false;
            material.opacity=.25;
            // Bỏ màu đen đã bake trong ảnh thân xe để kính xuyên sáng.
            material.map=null;
            material.color.setHex(0xa8c6d7);
            material.forceSinglePass=true;
            material.metalness=0;
            material.metalnessMap=null;
            material.roughness=.38;
            material.roughnessMap=null;
            material.normalMap=null;
            material.side=MidnightThree.DoubleSide;
          }
          sharedMats.set(obj.material,material);
        }
      });
      // Tái dùng hình học và cấp thêm bản sao nếu một loại xe xuất hiện dày đặc.
      pool.addSlot=()=>{
        const wrapper=new MidnightThree.Group();
        const inner=template.clone();
        const wheels=[];
        const signals=lensMask?{value:[0,0,0]}:null;
        const vehicleBody=signals?inner.getObjectByProperty('isMesh',true):null;
        const flap=bird?{value:0}:null;
        let rotor=null,stand=null;
        inner.traverse(obj=>{
          if(obj.userData.wheelRadius) wheels.push(obj);
          if(obj.userData.turbineRotor) rotor=obj;
          if(obj.userData.kickstand) stand=obj;
          if(obj.isMesh&&obj.material){
            obj.frustumCulled=false;
            if(obj===vehicleBody){
              obj.material=patchGlbMaterial(obj.material,doubleSide);
              applyVehicleLightMaterial(obj.material,lensMask,signals);
            }else if(flap){
              obj.material=patchGlbMaterial(obj.material,doubleSide);
              applyBirdWingMaterial(obj.material,flap);
            }else{
              const shared=sharedMats.get(obj.material);
              if(building){
                const painted=shared.clone();
                painted.customProgramCacheKey=shared.customProgramCacheKey;
                painted.onBeforeCompile=shared.onBeforeCompile;
                obj.material=painted;
              }else obj.material=shared;
            }
          }
        });
        wrapper.add(inner);
        wrapper.visible=false;
        wrapper.matrixAutoUpdate=false;
        glbScene.add(wrapper);
        const slot={wrapper,wheels,rotor,stand,lamps,signals,fitHeight,flap,cabinRoof};
        pool.slots.push(slot);
        return slot;
      };
      for(let i=0;i<count;i++) pool.addSlot();
      pool.ready=true;
    });
    return pool;
  }
  // Uốn hai cánh quanh vai và xoay pháp tuyến cùng cánh khi đập.
  function applyBirdWingMaterial(material,flap){
    const compile=material.onBeforeCompile;
    material.customProgramCacheKey=()=>'glb-bird-wings';
    material.onBeforeCompile=shader=>{
      compile(shader);
      shader.uniforms.uWingFlap=flap;
      shader.vertexShader=`
        uniform float uWingFlap;
        mat2 skyWingRotation(float x){
          float angle=sign(x)*(.65*uWingFlap-.32)*smoothstep(.105,.43,abs(x));
          float c=cos(angle),s=sin(angle);
          return mat2(c,s,-s,c);
        }
      `+shader.vertexShader
        .replace('#include <beginnormal_vertex>',`
          #include <beginnormal_vertex>
          objectNormal.xy=skyWingRotation(position.x)*objectNormal.xy;
        `)
        .replace('#include <begin_vertex>',`
          #include <begin_vertex>
          vec2 shoulder=vec2(sign(position.x)*.108,.055);
          transformed.xy=shoulder+skyWingRotation(position.x)*(transformed.xy-shoulder);
        `);
    };
  }
  // Căn chiều dài và chiều ngang theo làn đường, giữ mặt phẳng quay của bánh.
  const setupVehicle=(targetLength,targetWidth)=>(template,box,size,center)=>{
    const scale=targetLength/(size.x||1);
    const widthScale=targetWidth/(size.z||1);
    template.scale.set(scale,scale,widthScale);
    template.rotation.y=Math.PI/2;
    template.position.set(-center.z*widthScale,-box.min.y*scale,center.x*scale);
  };
  // Chỉ đổi tỷ lệ từ phía trên vòm bánh, nên lốp và điểm chạm đất giữ nguyên.
  function fitVehicleBody(template,bounds,body,lamps,roof){
    const scale=template.scale.y;
    const height=bounds.size.y*scale;
    let tireTop=0;
    template.traverse(part=>{
      if(!part.userData.wheelContact) return;
      tireTop=Math.max(tireTop,part.userData.wheelContact[1]+2*part.userData.wheelRadius);
    });
    const sill=tireTop+.055;
    const ratio=(roof-sill)/(height-sill);
    if(!Number.isFinite(ratio)||ratio<=0) return null;
    // Áp cùng phép đổi độ cao lên model, kính, đèn và mốc ngồi của rig.
    const fit=y=>y<=sill?y:sill+(y-sill)*ratio;
    const {position,normal}=body.geometry.attributes;
    for(let i=0;i<position.count;i++){
      const y=(position.getY(i)-bounds.min.y)*scale;
      if(y<=sill) continue;
      position.setY(i,bounds.min.y+fit(y)/scale);
      if(normal){
        const x=normal.getX(i),ny=normal.getY(i)/ratio,z=normal.getZ(i);
        const length=Math.hypot(x,ny,z)||1;
        normal.setXYZ(i,x/length,ny/length,z/length);
      }
    }
    position.needsUpdate=true;
    if(normal) normal.needsUpdate=true;
    for(const lamp of lamps) lamp.center.y=fit(lamp.center.y);
    return fit;
  }
  // Căn model vào tâm mặt đáy, có thể xoay để đổi trục ngang và trục tiến.
  const setupGrounded=(normalizeXZ=false,rotation=0)=>(template,box,size,center)=>{
    const sx=normalizeXZ?(1/(size.x||1)):1;
    const sy=normalizeXZ?(1/(size.y||1)):1;
    const sz=normalizeXZ?(1/(size.z||1)):1;
    template.scale.set(sx,sy,sz);
    template.rotation.y=rotation;
    const x=-center.x*sx,z=-center.z*sz;
    template.position.set(x*Math.cos(rotation)+z*Math.sin(rotation),-box.min.y*sy,z*Math.cos(rotation)-x*Math.sin(rotation));
  };
  const setupCentered=(rotY=0)=>(template,box,size,center)=>{
    template.rotation.y=rotY;
    template.position.set(-center.x,-center.y,-center.z);
  };
  // Dựng mây trong một thể tích, để mật độ và màu thay đổi liên tục qua các cụm mây.
  function createCloudPool(){
    const geometry=new MidnightThree.BoxGeometry(1,1,1);
    const material=new MidnightThree.RawShaderMaterial({
      name:"cloud-volume",glslVersion:MidnightThree.GLSL3,side:MidnightThree.DoubleSide,
      transparent:true,forceSinglePass:true,depthWrite:false,uniforms,
      vertexShader: `
        precision highp float;
        in vec3 position;
        uniform mat4 modelMatrix;
        uniform vec2 cameraYaw,cameraPitch,viewport,vanishing;
        uniform float lens,altitude,clipOffset;
        out vec3 p,cameraLocal;
        void main(){
          vec3 world=(modelMatrix*vec4(position,1.0)).xyz;
          vec2 rotated=vec2(dot(world.xz,vec2(cameraYaw.x,-cameraYaw.y)),dot(world.xz,cameraYaw.yx));
          float h=world.y-altitude;
          float depth=rotated.y*cameraPitch.x+h*cameraPitch.y;
          float vertical=h*cameraPitch.x-rotated.y*cameraPitch.y;
          vec2 offset=vec2(2.0*vanishing.x/viewport.x-1.0,1.0-2.0*vanishing.y/viewport.y);
          gl_Position=vec4(vec2(rotated.x,vertical)*2.0*lens/viewport+offset*depth,
            depth*(1.0+clipOffset/750.0)-clipOffset,depth);
          p=position;
          cameraLocal=(inverse(modelMatrix)*vec4(0.0,altitude,0.0,1.0)).xyz;
        }`,
      fragmentShader: `
        precision highp float;
        in vec3 p,cameraLocal;
        uniform float daylight;
        out vec4 color;
        float puff(vec3 q,vec3 center,vec3 radius){
          return 1.0-length((q-center)/radius);
        }
        float density(vec3 q){
          float base=puff(q,vec3(0.0,-0.11,0.0),vec3(0.48,0.27,0.45));
          float left=puff(q,vec3(-0.22,0.02,0.02),vec3(0.25,0.35,0.34));
          float middle=puff(q,vec3(0.06,0.08,-0.05),vec3(0.28,0.40,0.36));
          float right=puff(q,vec3(0.25,-0.01,0.09),vec3(0.23,0.32,0.30));
          float detail=0.035*sin(dot(q,vec3(29.0,22.0,17.0)))*sin(dot(q,vec3(18.0,-14.0,27.0)));
          return smoothstep(-0.03,0.36,max(max(base,left),max(middle,right))+detail);
        }
        void main(){
          vec3 ray=normalize(cameraLocal-p);
          // Chỉ tích phân từ mặt xa của hộp, bất kể thứ tự đỉnh sau phép chiếu của game.
          if(any(bvec3(abs(p.x)>0.4999&&p.x*ray.x>0.0,
                       abs(p.y)>0.4999&&p.y*ray.y>0.0,
                       abs(p.z)>0.4999&&p.z*ray.z>0.0))) discard;
          vec3 side=mix(vec3(-0.5),vec3(0.5),greaterThan(ray,vec3(0.0)));
          vec3 hit=abs(side-p)/max(abs(ray),vec3(0.00001));
          // Bỏ mặt đang đứng trên tia thoát, chỉ lấy khoảng đi bên trong thể tích.
          if(hit.x<0.0001) hit.x=1000.0;
          if(hit.y<0.0001) hit.y=1000.0;
          if(hit.z<0.0001) hit.z=1000.0;
          float span=min(length(cameraLocal-p),min(hit.x,min(hit.y,hit.z)));
          float stepSize=span/16.0;
          vec4 sum=vec4(0.0);
          for(int i=0;i<16;i++){
            vec3 q=p+ray*(span-(float(i)+0.5)*stepSize);
            float a=1.0-exp(-density(q)*stepSize*5.3);
            float light=smoothstep(-0.32,0.39,q.y);
            vec3 night=mix(vec3(0.18,0.23,0.36),vec3(0.47,0.54,0.67),light);
            vec3 day=mix(vec3(0.65,0.73,0.80),vec3(0.98,0.99,1.0),light);
            sum+=vec4(mix(night,day,daylight)*a,a)*(1.0-sum.a);
          }
          if(sum.a<0.005) discard;
          color=vec4(sum.rgb/sum.a,sum.a);
        }`
    });
    const slots=[];
    for(let i=0;i<24;i++){
      const wrapper=new MidnightThree.Mesh(geometry,material);
      wrapper.frustumCulled=false;wrapper.matrixAutoUpdate=false;wrapper.visible=false;
      glbScene.add(wrapper);slots.push({wrapper});
    }
    const pool={slots,used:0,ready:true};
    glbPools.push(pool);
    return pool;
  }
  const sportsCarPool=createGlbPool('red-sports-car.glb',12,setupVehicle(4.48,1.90),{wheelCount:4,vehicle:'sports',roof:1.22});
  const sedanPool=createGlbPool('meshy-compact-sedan.glb',20,setupVehicle(4.39,1.92),{wheelCount:4,vehicle:'sedan',roof:1.49});
  const suvPool=createGlbPool('meshy-compact-suv.glb',14,setupVehicle(4.72,2.02),{wheelCount:4,vehicle:'suv',roof:1.89});
  const motoPool=createGlbPool('meshy-motorcycle.glb',10,setupVehicle(2.46,.94),{wheelCount:2,vehicle:'motorcycle',roof:1.49});
  const truckPool=createGlbPool('meshy-cargo-truck.glb',10,setupVehicle(7.2,2.44),{wheelCount:6,vehicle:'truck',roof:3.27});
  const vehicleGlbPools=[sportsCarPool,sedanPool,sedanPool,suvPool,motoPool,truckPool];
  // Ghép hai bước đối xứng thành tư thế đứng với mũi chân gần ngang nhau.
  function buildNpcIdle(walk){
    const tracks=walk.tracks.map(track=>{
      const sample=track.createInterpolant();
      const first=Float32Array.from(sample.evaluate(walk.duration*.0625));
      const second=sample.evaluate(walk.duration*.5625);
      if(track.ValueTypeName==='quaternion'){
        MidnightThree.Quaternion.slerpFlat(first,0,first,0,second,0,.5);
      }else{
        for(let i=0;i<first.length;i++) first[i]=(first[i]+second[i])*.5;
      }
      const idleTrack=track.clone();
      idleTrack.times=new Float32Array([0]);
      idleTrack.values=first;
      return idleTrack;
    });
    return new MidnightThree.AnimationClip('Idle',1,tracks);
  }
  // Mỗi nhân vật sở hữu bộ xương riêng và dùng chung hình học, texture của mẫu gốc.
  function createNpcPool(url,count){
    const pool={slots:[],ready:false,used:0};
    glbPools.push(pool);
    trackStartupAsset(url,glbLoader.loadAsync(new URL(url,modelDirectory).href),gltf=>{
      const {scene:template,animations}=gltf;
      const walk=MidnightThree.AnimationClip.findByName(animations,'Walk');
      const run=MidnightThree.AnimationClip.findByName(animations,'Run');
      const bounds=new MidnightThree.Box3().setFromObject(template);
      if(!walk||!run||bounds.isEmpty()||!Number.isFinite(bounds.min.y)) throw new Error('NPC thiếu hình học hoặc clip chuyển động');
      template.position.y=-bounds.min.y;
      const idle=buildNpcIdle(walk);
      const poseMixer=new MidnightThree.AnimationMixer(template);
      poseMixer.clipAction(idle).play();
      poseMixer.update(0);
      const idleGround=new MidnightThree.Box3().setFromObject(template,true).min.y;
      poseMixer.stopAllAction();
      const headSamples=measureRigHead(MidnightThree,template);
      const materials=new Map();
      template.traverse(mesh=>{
        if(!mesh.isSkinnedMesh) return;
        mesh.frustumCulled=false;
        if(!materials.has(mesh.material)) materials.set(mesh.material,patchGlbMaterial(mesh.material));
        mesh.material=materials.get(mesh.material);
      });
      if(!materials.size) throw new Error('NPC thiếu mesh có skinning');
      for(let i=0;i<count;i++){
        const wrapper=new MidnightThree.Group();
        const actor=MidnightThree.cloneSkeleton(template);
        const mixer=new MidnightThree.AnimationMixer(actor);
        const actions=[idle,walk,run].map(clip=>mixer.clipAction(clip).play());
        const bones=actor.getObjectByProperty('isSkinnedMesh',true).skeleton;
        wrapper.add(actor);
        wrapper.visible=false;
        wrapper.matrixAutoUpdate=false;
        glbScene.add(wrapper);
        pool.slots.push({wrapper,mixer,actions,bones,idleGround,headSamples,customPose:false});
      }
      pool.ready=true;
    });
    return pool;
  }
  const npcDriverPool=createNpcPool('meshy-npc-driver-animated.glb',12);
  const npcPassengerPool=createNpcPool('meshy-npc-passenger-animated.glb',44);
  const npcWorkerPool=createNpcPool('meshy-npc-road-worker-animated.glb',32);
  const housePool=createGlbPool('meshy-roadside-house.glb',64,setupGrounded(true),{building:true});
  const treePool=createGlbPool('meshy-roadside-tree.glb',260,setupGrounded(false));
  const palmPool=createGlbPool('meshy-coastal-palm.glb',96,setupGrounded(false),{doubleSide:true});
  const grassPool=createGlbPool('meshy-grass-clump.glb',540,setupGrounded(false));
  const overpassPool=createGlbPool('meshy-highway-overpass.glb',8,setupGrounded(true));
  // Đầu máy bay ở trục -X của GLB, còn hướng tiến của game là +Z.
  const airlinerPool=createGlbPool('meshy-passenger-jet.glb',4,setupCentered(Math.PI/2));
  const birdPool=createGlbPool('meshy-bird.glb',32,setupCentered(0),{doubleSide:true,bird:true});
  const cloudPool=createCloudPool();
  const townPool=createGlbPool('meshy-city-townhouse.glb',36,setupGrounded(true),{doubleSide:true,building:'city'});
  const apartmentPool=createGlbPool('meshy-city-apartment.glb',30,setupGrounded(true),{doubleSide:true,building:'city'});
  const officePool=createGlbPool('meshy-city-office.glb',30,setupGrounded(true),{doubleSide:true,building:'city'});
  const streetlightPool=createGlbPool('meshy-streetlight.glb',60,setupGrounded(true));
  const turbinePool=createGlbPool('meshy-wind-turbine.glb',14,setupGrounded(true),{turbine:true});
  const boatPool=createGlbPool('meshy-coastal-boat.glb',16,setupGrounded(true,Math.PI/2));
  const dogPool=createGlbPool('coastal-dog.glb',16,setupGrounded(true));
  const chamPool=createGlbPool('meshy-cham-tower.glb',3,setupGrounded(true));
  // Đặt model trên cao độ địa phương của tuyến đường.
  function placeRouteModel(pool,x,y,z,angle,width,height,depth){
    if(outsideObjectDistance(x,z,Math.hypot(width,depth)*.5)) return false;
    return placeGlbAligned(pool,x-runtime.originX,y+passSample(z,passHeights),z-runtime.origin,angle,width,height,depth);
  }
  // Chừa bán kính của vật thể để phần còn nằm trong phạm vi vẫn được vẽ.
  function outsideObjectDistance(x,z,radius=0){
    return Math.hypot(x-runtime.originX,z-runtime.origin)>runtime.objectDistance+radius;
  }
  // Đặt một bản sao GLB trong hệ tọa độ tương đối của camera.
  function placeGlbAligned(pool,wx,wy,wz,angle,sx=1,sy=sx,sz=sx){
    if(!pool?.ready) return false;
    const slot=pool.slots[pool.used]??(pool.expand&&pool.addSlot());
    if(!slot) return false;
    pool.used++;
    const cos=Math.cos(angle),sin=Math.sin(angle);
    slot.wrapper.matrix.set(
      cos*sx, 0, sin*sz, wx,
      0, sy, 0, wy,
      -sin*sx, 0, cos*sz, wz,
      0, 0, 0, 1
    );
    slot.wrapper.matrixWorldNeedsUpdate=true;
    slot.wrapper.visible=true;
    glbUsed++;
    return true;
  }
  const npcBendAxis=new MidnightThree.Vector3();
  const npcParentRotation=new MidnightThree.Quaternion();
  const npcBendRotation=new MidnightThree.Quaternion();
  // Xoay khớp quanh trục ngang của nhân vật, quy đổi sang hệ tọa độ của xương cha.
  function bendNpcBone(slot,name,angle){
    if(!angle) return;
    const bone=slot.bones.getBoneByName(name);
    if(!bone?.parent) return;
    bone.parent.updateWorldMatrix(true,false);
    bone.parent.getWorldQuaternion(npcParentRotation).invert();
    npcBendAxis.setFromMatrixColumn(slot.wrapper.matrixWorld,0).normalize().applyQuaternion(npcParentRotation);
    npcBendRotation.setFromAxisAngle(npcBendAxis,angle);
    bone.quaternion.premultiply(npcBendRotation);
  }
  // Áp tư thế cửa xe lên cùng bộ xương dùng để đi bộ và chạy.
  function poseNpcAtDoor(slot,person,kneel){
    const side=person.actionStepSide===1?'Left':'Right';
    const other=side==='Left'?'Right':'Left';
    const step=person.actionStep??0;
    const reach=Math.max(person.actionReach??0,person.actionGrip??0);
    slot.wrapper.updateWorldMatrix(true,false);
    bendNpcBone(slot,'Spine02',person.actionLean??0);
    bendNpcBone(slot,side+'UpLeg',-.75*kneel-.90*step);
    bendNpcBone(slot,side+'Leg',1.23*kneel+.50*step);
    bendNpcBone(slot,other+'UpLeg',-.60*kneel);
    bendNpcBone(slot,other+'Leg',1.05*kneel);
    bendNpcBone(slot,side+'Arm',-1.18*reach);
    bendNpcBone(slot,side+'ForeArm',-.35*reach);
  }
  // Xoay cả nhân vật quanh tâm ngã rồi co chân và tay theo từng giai đoạn.
  function poseNpcFall(slot,fall,kneel,scale){
    const matrix=slot.wrapper.matrix.elements;
    const sin=Math.sin(fall.tilt??0), cos=Math.cos(fall.tilt??0);
    const pivot=fall.low?0:.82*scale;
    const zX=matrix[8], zZ=matrix[10];
    matrix[4]=zX*sin;
    matrix[5]=scale*cos;
    matrix[6]=zZ*sin;
    matrix[8]=zX*cos;
    matrix[9]=-scale*sin;
    matrix[10]=zZ*cos;
    matrix[12]-=pivot*matrix[4]/scale;
    matrix[13]-=pivot*cos;
    matrix[14]-=pivot*matrix[6]/scale;
    slot.wrapper.matrixWorldNeedsUpdate=true;
    const recover=fall.recover;
    const brace=fall.contacts?.45:clamp(fall.age*4,0,1);
    const tuck=recover===undefined?(fall.low?.3:brace):kneel;
    slot.wrapper.updateWorldMatrix(true,false);
    for(const side of ['Left','Right']){
      bendNpcBone(slot,side+'UpLeg',-tuck*(side==='Left'?.85:.65));
      bendNpcBone(slot,side+'Leg',1.18*tuck);
      bendNpcBone(slot,side+'Arm',-(recover===undefined?brace:kneel)*.86);
      bendNpcBone(slot,side+'ForeArm',-.45*tuck);
    }
  }
  // Lấy mẫu clip theo chu kỳ chân, giữ vị trí nhân vật do mô phỏng điều khiển.
  function placeNpc(pool,wx,wy,wz,angle,scale,build,walking,running,stride,person,kneel,fall){
    if(!placeGlbAligned(pool,wx,wy,wz,angle,scale*build,scale,scale)) return false;
    const slot=pool.slots[pool.used-1];
    const {mixer,actions}=slot;
    // Buộc mixer ghi lại tư thế gốc sau một khung có biến đổi xương bổ sung.
    if(slot.customPose){
      mixer.stopAllAction();
    }
    const motion=running?2:walking?1:0;
    for(let i=0;i<actions.length;i++) actions[i].play().setEffectiveWeight(Number(i===motion));
    const action=actions[motion];
    action.time=walking?action.getClip().duration*mod(stride,1):0;
    if(!walking) slot.wrapper.matrix.elements[13]-=slot.idleGround*scale;
    mixer.update(0);
    slot.customPose=Boolean(fall||kneel||person.actionLean||person.actionReach||person.actionGrip||person.actionStep||person.gesture);
    if(fall) poseNpcFall(slot,fall,kneel,scale);
    else if(person.gesture){
      slot.wrapper.updateWorldMatrix(true,false);
      const {hand,amount}=person.gesture;
      bendNpcBone(slot,hand+'Arm',-.66*amount);
      bendNpcBone(slot,hand+'ForeArm',-1.12*amount);
      bendNpcBone(slot,hand+'Hand',.26*Math.sin(world.time*6)*amount);
    }else if(slot.customPose) poseNpcAtDoor(slot,person,kneel);
    return true;
  }
  // Hướng xương về điểm đích trong không gian xe, giữ nguyên chiều dài đoạn chi.
  function aimRiderBone(bone,tip,target){
    const joint=bone.getWorldPosition(new MidnightThree.Vector3());
    const before=tip.getWorldPosition(new MidnightThree.Vector3()).sub(joint).normalize();
    const after=target.clone().sub(joint).normalize();
    const frame=bone.parent.getWorldQuaternion(new MidnightThree.Quaternion()).invert();
    const turn=new MidnightThree.Quaternion().setFromUnitVectors(before.applyQuaternion(frame),after.applyQuaternion(frame));
    bone.quaternion.premultiply(turn);
  }
  // Uốn hai đốt về tay lái hoặc gác chân, với mặt phẳng gập theo hướng khuỷu/gối.
  function aimRiderLimb(slot,names,target,hint){
    const [upper,middle,end]=names.map(name=>slot.bones.getBoneByName(name));
    const start=upper.getWorldPosition(new MidnightThree.Vector3());
    const joint=middle.getWorldPosition(new MidnightThree.Vector3());
    const tip=end.getWorldPosition(new MidnightThree.Vector3());
    const a=start.distanceTo(joint),b=joint.distanceTo(tip);
    const direction=target.clone().sub(start);
    const distance=clamp(direction.length(),Math.abs(a-b)+.001,a+b-.001);
    direction.normalize();
    const bend=hint.clone().sub(start);
    bend.addScaledVector(direction,-bend.dot(direction)).normalize();
    const along=(a*a-b*b+distance*distance)/(2*distance);
    const knee=start.clone().addScaledVector(direction,along).addScaledVector(bend,Math.sqrt(Math.max(0,a*a-along*along)));
    aimRiderBone(upper,middle,knee);
    aimRiderBone(middle,end,target);
  }
  // Đặt hông của rig đúng vào ghế trong hệ tọa độ của xe.
  function mountSeatedRig(vehicle,look,isPlayer,seatX,seatY,seatZ){
    const pool=isPlayer?npcDriverPool:(look.outfit===1||look.outfit===3)?npcWorkerPool:npcPassengerPool;
    if(!placeNpc(pool,0,0,0,0,look.scale,look.build??1,false,false,0,look,0,null)) return null;
    const slot=pool.slots[pool.used-1];
    const hip=slot.bones.getBoneByName('Hips').getWorldPosition(new MidnightThree.Vector3());
    const riderMatrix=slot.wrapper.matrix;
    riderMatrix.elements[12]+=seatX-hip.x;
    riderMatrix.elements[13]+=(vehicle.fitHeight?.(seatY)??seatY)-hip.y;
    riderMatrix.elements[14]+=seatZ-hip.z;
    riderMatrix.premultiply(vehicle.wrapper.matrix);
    slot.wrapper.matrixWorldNeedsUpdate=true;
    slot.wrapper.updateWorldMatrix(true,true);
    // Đặt lại góc xương từ clip khi bản sao được dùng ở khung tiếp theo.
    slot.customPose=true;
    return slot;
  }
  // Gắn rig lên yên và dùng cùng ma trận với xe để người nghiêng theo xe lúc ôm cua.
  function placeBikeRider(bike,look,isPlayer,back=false){
    if(!look) return;
    const seat=back?-.69:-.25;
    const slot=mountSeatedRig(bike,look,isPlayer,0,back?1.07:1.01,seat);
    if(!slot) return;
    bendNpcBone(slot,'Spine02',back?.12:.28);
    // Chuyển điểm tiếp xúc trên xe sang cùng hệ tọa độ với các xương.
    const point=(x,y,z)=>new MidnightThree.Vector3(x,bike.fitHeight?.(y)??y,z).applyMatrix4(bike.wrapper.matrix);
    for(const [side,sign] of [['Left',1],['Right',-1]]){
      aimRiderLimb(slot,[side+'UpLeg',side+'Leg',side+'Foot'],
        point(sign*.27,back?.55:.50,back?-.61:-.34),point(sign*.40,.82,seat+.42));
      aimRiderLimb(slot,[side+'Arm',side+'ForeArm',side+'Hand'],
        back?point(sign*.19,1.12,-.31):point(sign*.36,1.31,.44),point(sign*.42,1.23,seat+.22));
    }
  }
  // Các mốc hông, hàng ghế, khoảng trống dưới mái, vô-lăng và sàn của từng GLB.
  const cabinSeats=[
    [.34,.34,.24,null,1.09,.68,.13,.78],
    [.36,.57,.29,-.77,1.36,1.04,.27,.91],
    [.36,.57,.29,-.77,1.36,1.04,.27,.91],
    [.41,.95,.33,-.83,1.75,1.48,.48,.94],
    null,
    [.48,1.54,2.00,null,2.93,1.94,.93,.76]
  ];
  // Hạ cả rig theo điểm bao tóc cao nhất tại mái thật của từng mẫu xe.
  function keepRiderBelowRoof(vehicle,slot,ceiling,weight=1){
    const head=slot.bones.getBoneByName('Head');
    if(!head) return;
    const forward=vehicle.wrapper.matrix.elements;
    head.updateWorldMatrix(true,false);
    const toVehicle=vehicle.wrapper.matrix.clone().invert().multiply(head.matrixWorld);
    const local=new MidnightThree.Vector3();
    let excess=0;
    for(const sample of slot.headSamples){
      local.copy(sample).applyMatrix4(toVehicle);
      const roof=vehicle.cabinRoof?.(local.x,local.z);
      const limit=roof!==null&&roof!==undefined&&roof>ceiling-.42?Math.min(roof,ceiling+.10):ceiling;
      excess=Math.max(excess,local.y+.045-limit);
    }
    const drop=excess*weight;
    if(!drop) return;
    const matrix=slot.wrapper.matrix.elements;
    matrix[12]-=forward[4]*drop;
    matrix[13]-=forward[5]*drop;
    matrix[14]-=forward[6]*drop;
    slot.wrapper.matrixWorldNeedsUpdate=true;
    slot.wrapper.updateWorldMatrix(true,true);
  }
  // Gập chân nhân vật xuống sàn và đặt tay tài xế lên vị trí vô-lăng.
  function placeCabinRider(vehicle,model,look,isPlayer,seat){
    if(!look) return;
    const [offset,y,front,rear,ceiling,wheelY,floor,reach]=cabinSeats[model];
    const back=seat>1;
    if(back&&rear===null) return;
    const x=(seat%2===0?-offset:offset)*.9,z=(back?rear:front)-(model===0?.11:.065);
    const slot=mountSeatedRig(vehicle,look,isPlayer,x,y,z);
    if(!slot) return;
    bendNpcBone(slot,'Spine02',model===0?-.37:-.16);
    keepRiderBelowRoof(vehicle,slot,ceiling-(back?.06:0));
    // Chuyển các điểm đích từ cabin sang hệ tọa độ dùng cho rig.
    const point=(a,b,c)=>new MidnightThree.Vector3(a,vehicle.fitHeight?.(b)??b,c).applyMatrix4(vehicle.wrapper.matrix);
    for(const [side,sign] of [['Left',1],['Right',-1]]){
      aimRiderLimb(slot,[side+'UpLeg',side+'Leg',side+'Foot'],
        point(x+sign*.13,floor,z+reach*.61),point(x+sign*.18,y+.09,z+.38));
      aimRiderLimb(slot,[side+'Arm',side+'ForeArm',side+'Hand'],
        point(x+sign*.15,seat===0?wheelY:y+.12,z+reach*(seat===0?.56:.27)),
        point(x+sign*.28,y+.26,z+.16));
    }
  }
  // Đưa điểm thấp nhất của cụm lốp tới mặt đường thực ở vị trí từng bánh.
  function seatVehicleOnRoad(slot){
    let clearance=Infinity;
    const m=slot.wrapper.matrix.elements;
    for(const wheel of slot.wheels){
      const [x,y,z]=wheel.userData.wheelContact;
      const wx=runtime.originX+m[0]*x+m[4]*y+m[8]*z+m[12];
      const wz=runtime.origin+m[2]*x+m[6]*y+m[10]*z+m[14];
      const wy=m[1]*x+m[5]*y+m[9]*z+m[13];
      const road=terrainHeight(wz,wx-center(wz))+passSample(wz,passHeights);
      clearance=Math.min(clearance,wy-road);
    }
    if(Number.isFinite(clearance)) m[13]-=clamp(clearance,-.24,.24);
  }
  // Đặt model xe theo cao độ mặt đường và giữ góc nghiêng do mô phỏng tạo ra.
  function placeGlbCar(z,x,angle,roll,wreck,crash,travel,model,steer=0){
    const pool=vehicleGlbPools[model];
    if(!pool?.ready) return false;
    const slot=pool.slots[pool.used]??pool.addSlot();
    pool.used++;
    const mid=center(z)+x;
    const ground=terrainHeight(z,x);
    const lift=wreck?.y??crash?.hop??0;
    const cos=Math.cos(angle),sin=Math.sin(angle);
    // passHeights là cao độ dùng để vẽ đường; slope(z) chỉ đo hướng cong ngang.
    const roadSlope=passSample(z+.5,passHeights)-passSample(z-.5,passHeights);
    const forwardSlope=roadSlope*cos;
    const lean=(wreck?.roll??roll)-Math.atan2(roadSlope*sin,Math.hypot(1,forwardSlope));
    const pitch=(wreck?.pitch??crash?.pitch??0)-Math.atan(forwardSlope);
    const leanCos=Math.cos(lean),leanSin=Math.sin(lean);
    const pitchCos=Math.cos(pitch),pitchSin=Math.sin(pitch);
    const wx=mid-runtime.originX;
    // Bù độ cao trục xoay để đáy bánh vẫn nằm trên mặt dốc sau khi xoay xe.
    const wy=ground+lift+0.35*Math.hypot(1,roadSlope)+passSample(z,passHeights);
    const wz=z-runtime.origin;
    // Exact basis matching carMesh p() transform around pivot (0, 0.35, 0)
    const ex=[leanCos*cos+leanSin*pitchSin*sin, leanSin*pitchCos, -leanCos*sin+leanSin*pitchSin*cos];
    const ey=[-leanSin*cos+leanCos*pitchSin*sin, leanCos*pitchCos, leanSin*sin+leanCos*pitchSin*cos];
    const ez=[pitchCos*sin, -pitchSin, pitchCos*cos];
    const m=slot.wrapper.matrix;
    m.set(
      ex[0], ey[0], ez[0], wx - ey[0]*0.35,
      ex[1], ey[1], ez[1], wy - ey[1]*0.35,
      ex[2], ey[2], ez[2], wz - ey[2]*0.35,
      0, 0, 0, 1
    );
    if(!wreck&&!crash?.hop) seatVehicleOnRoad(slot);
    slot.wrapper.matrixWorldNeedsUpdate=true;
    for(const wheel of slot.wheels){
      wheel.rotation.z=mod(travel/wheel.userData.wheelRadius,TAU);
      const steering=wheel.userData.frontWheel?steer*.28:0;
      // Vành và lốp quay quanh trục ngang, cả cụm trước rẽ qua khớp cha.
      if(wheel.parent.userData.motorcycleSteering) wheel.parent.rotation.y=steering;
      else wheel.rotation.y=steering;
    }
    slot.wrapper.visible=true;
    glbUsed++;
    return slot;
  }
  const screenScene=new MidnightThree.Scene();
  const target=new MidnightThree.WebGLRenderTarget(1,1);
  const material=new MidnightThree.RawShaderMaterial({
    glslVersion:MidnightThree.GLSL3,
    vertexShader:vertexSource,
    fragmentShader:fragmentSource,
    uniforms,
    side:MidnightThree.DoubleSide,
    depthFunc:MidnightThree.LessDepth,
    blending:MidnightThree.NoBlending
  });
  const postUniforms={scene:{value:target.texture},speed:{value:0},steering:{value:0}};
  const screenGeometry=new MidnightThree.BufferGeometry();
  // Ba đỉnh giữ số lượng cần vẽ. Shader đặt vị trí bằng gl_VertexID.
  screenGeometry.setAttribute('position',new MidnightThree.BufferAttribute(new Float32Array(9),3));
  const screen=new MidnightThree.Mesh(screenGeometry,new MidnightThree.RawShaderMaterial({
    glslVersion:MidnightThree.GLSL3,
    vertexShader:screenVertex,
    fragmentShader:screenFragment,
    uniforms:postUniforms,
    depthTest:false,
    depthWrite:false,
    blending:MidnightThree.NoBlending
  }));
  screen.frustumCulled=false;
  screenScene.add(screen);

  const mesh=new MidnightThree.Mesh(new MidnightThree.BufferGeometry(),material);
  mesh.frustumCulled=false;
  scene.add(mesh);
  let values=new Float32Array(900000);
  let vertices;
  const colors=new Map();
  let used=0, forward=0, back=0;
  let roadLamps=0;
  const lampGlows=[];
  function drawBatch(blended=false,depthWrite=true){
    if(!used) return;
    if(vertices?.array!==values){
      mesh.geometry.dispose();
      mesh.geometry=new MidnightThree.BufferGeometry();
      vertices=new MidnightThree.InterleavedBuffer(values,8);
      vertices.setUsage(MidnightThree.DynamicDrawUsage);
      for(const [name,size,offset] of [['position',3,0],['tint',4,3],['finish',1,7]]){
        mesh.geometry.setAttribute(name,new MidnightThree.InterleavedBufferAttribute(vertices,size,offset));
      }
    }
    vertices.clearUpdateRanges();
    vertices.addUpdateRange(0,used);
    vertices.needsUpdate=true;
    mesh.geometry.setDrawRange(0,used/8);
    material.blending=blended?MidnightThree.CustomBlending:MidnightThree.NoBlending;
    material.blendSrc=MidnightThree.SrcAlphaFactor;
    material.blendDst=MidnightThree.OneMinusSrcAlphaFactor;
    material.blendSrcAlpha=MidnightThree.OneFactor;
    material.blendDstAlpha=MidnightThree.OneMinusSrcAlphaFactor;
    material.depthWrite=depthWrite;
    material.uniformsNeedUpdate=true;
    renderer.render(scene,camera);
  }

  function finishEffects(){
    renderer.setRenderTarget(null);
    postUniforms.speed.value=clamp((state.v-8)/36,0,1);
    postUniforms.steering.value=state.steer;
    screen.material.uniformsNeedUpdate=true;
    renderer.render(screenScene,camera);
  }

  // Chuyển màu HEX sang màu đỉnh và lưu để dùng qua nhiều khung hình.
  function rgb(hex) {
    if(!colors.has(hex)){
      const n=Number.parseInt(hex.slice(1),16);
      colors.set(hex,[(n>>16)/255,((n>>8)&255)/255,(n&255)/255]);
    }
    return colors.get(hex);
  }
  // Thêm một đỉnh trong hệ tọa độ tương đối của camera.
  let scratchVerts=new Float32Array(12288);
  function ensureScratch(needed){
    if(needed>scratchVerts.length) scratchVerts=new Float32Array(Math.ceil(needed*1.5));
  }
  function pointXYZ(px,py,pz,color,alpha,finish) {
    if(used+8>values.length){
      const next=new Float32Array(Math.ceil(values.length*1.5));
      next.set(values);values=next;
    }
    values[used++]=px-runtime.originX;values[used++]=py+passSample(pz,passHeights);values[used++]=pz-runtime.origin;
    values[used++]=color[0];values[used++]=color[1];values[used++]=color[2];values[used++]=alpha;
    values[used++]=finish;
  }
  function point(p,color,alpha,finish) {
    pointXYZ(p[0],p[1],p[2],color,alpha,finish);
  }
  // Chia một mặt tứ giác thành hai tam giác có màu phẳng.
  function quad(a,b,c,d,hex,alpha=1,finish=0) {
    const color=rgb(hex);
    point(a,color,alpha,finish);point(b,color,alpha,finish);point(c,color,alpha,finish);
    point(a,color,alpha,finish);point(c,color,alpha,finish);point(d,color,alpha,finish);
  }
  const shadowCasters=[];
  // Thu thập vật thể đổ bóng trong khung hình hiện tại.
  function markShadow(x,y,z,dx,dy,dz,yaw=0){
    if(world.sunStrength>.04&&world.sun[1]>.025&&dy>.35
      &&Math.abs(z-runtime.origin)<160&&Math.abs(x-runtime.originX)<125
      &&shadowCasters.length<150) shadowCasters.push([x,y,z,dx,dy,dz,yaw]);
  }
  function shadowGround(x,z){
    const side=x-center(z),area=district(z);
    if(area===4&&Math.abs(side)>6.15) return -3.075;
    if(area===3&&side>22) return -.634;
    return terrainHeight(z,side)+.034;
  }
  function clipShadow(polygon,distance){
    if(!polygon.length) return polygon;
    const clipped=[];
    let last=polygon.at(-1),lastDistance=distance(last);
    for(const point of polygon){
      const next=distance(point);
      if((lastDistance>=0)!==(next>=0)){
        const t=lastDistance/(lastDistance-next);
        clipped.push([lerp(last[0],point[0],t),lerp(last[1],point[1],t)]);
      }
      if(next>=0) clipped.push(point);
      last=point;
      lastDistance=next;
    }
    return clipped;
  }
  // Chiếu bóng theo độ dốc và biên của từng dải mặt đường.
  function shadowOnTerrain(hull,tint,opacity){
    if(hull.length<3) return;
    let low=Infinity,high=-Infinity;
    for(const [,z] of hull){low=Math.min(low,z);high=Math.max(high,z);}
    for(let z=Math.floor(low/3)*3;z<high;z+=3){
      if(inTunnel(z+1.5)) continue;
      const end=z+3;
      const strip=clipShadow(clipShadow(hull,p=>p[1]-z),p=>end-p[1]);
      if(strip.length<3) continue;
      const startCenter=center(z),endCenter=center(end);
      const across=p=>p[0]-lerp(startCenter,endCenter,(p[1]-z)/3);
      const edge=(p,side)=>6.1+lerp(exitWidth(z,side),exitWidth(end,side),(p[1]-z)/3);
      const left=p=>across(p)+edge(p,-1),right=p=>edge(p,1)-across(p);
      const slopeStart=passSample(z,passHeights),slopeEnd=passSample(end,passHeights);
      const area=district(z+1.5);
      const below=clipShadow(strip,p=>-left(p));
      let above=clipShadow(strip,p=>-right(p));
      if(area===3){
        const shoreStart=coastShore(z).edge,shoreEnd=coastShore(end).edge;
        above=clipShadow(above,p=>lerp(shoreStart,shoreEnd,(p[1]-z)/3)-across(p));
      }
      const surfaces=[
        [clipShadow(clipShadow(strip,left),right),true],
        [below,false],[above,false]
      ];
      for(const [polygon,road] of surfaces){
        if(polygon.length<3) continue;
        if(!road&&area===4) continue;
        const vertices=polygon.map(([x,at])=>{
          const correction=lerp(slopeStart,slopeEnd,(at-z)/3)-passSample(at,passHeights);
          const ground=road?.034:area===3?terrainHeight(at,x-center(at))+.028:-.151;
          return [x,correction+ground,at];
        });
        for(let i=1;i<vertices.length-1;i++){
          point(vertices[0],tint,opacity,-1);
          point(vertices[i],tint,opacity,-1);
          point(vertices[i+1],tint,opacity,-1);
        }
      }
    }
  }
  // Tính và vẽ bóng mặt trời theo vị trí vật thể ở khung hình hiện tại.
  function drawSunShadows(){
    const opacity=clamp(world.sunStrength*.34,0,.31);
    const stretch=1/Math.max(.22,world.sun[1]);
    const tint=rgb('#141922');
    const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    for(const [x,y,z,width,height,length,yaw] of shadowCasters){
      if(inTunnel(z)) continue;
      const c=Math.cos(yaw),s=Math.sin(yaw),floor=shadowGround(x,z);
      const points=[];
      for(const top of [y,y+height]){
        const cast=clamp((top-floor)*stretch,0,82);
        for(const a of [-width/2,width/2]) for(const b of [-length/2,length/2]){
          points.push([x+a*c+b*s-world.sun[0]*cast,z-a*s+b*c-world.sun[2]*cast]);
        }
      }
      points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
      const hull=[];
      for(const p of points){
        while(hull.length>1&&cross(hull.at(-2),hull.at(-1),p)<=0) hull.pop();
        hull.push(p);
      }
      const lower=hull.length;
      for(let i=points.length-2;i>=0;i--){
        const p=points[i];
        while(hull.length>lower&&cross(hull.at(-2),hull.at(-1),p)<=0) hull.pop();
        hull.push(p);
      }
      hull.pop();
      shadowOnTerrain(hull,tint,opacity);
    }
  }
  function box(x,y,z,dx,dy,dz,palette,finish=0) {
    if(y<.95&&dx>=.19&&dy>=.62&&dz>=.16) markShadow(x,y,z,dx,dy,dz);
    const l=x-dx/2,r=x+dx/2,b=y,t=y+dy,n=z-dz/2,f=z+dz/2;
    const a=[l,b,n],c=[r,b,n],d=[r,b,f],e=[l,b,f];
    const A=[l,t,n],C=[r,t,n],D=[r,t,f],E=[l,t,f];
    quad(a,c,C,A,palette[0],1,finish);quad(c,d,D,C,palette[1],1,finish);quad(d,e,E,D,palette[0],1,finish);
    quad(e,a,A,E,palette[1],1,finish);quad(A,C,D,E,palette[2],1,finish);quad(e,d,c,a,palette[1],1,finish);
  }
  // Vẽ mặt đục và chuyển thuộc tính vật liệu đúng vị trí tham số của quad.
  function solidFace(a,b,c,d,color,finish){
    quad(a,b,c,d,color,1,finish);
  }
  // Nối các tiết diện thành mặt bên và đóng mặt trên của mô hình.
  function loft(face,x,z,sections,palette,finish=0){
    const rings=sections.map(([y,width,depth,shift=0,cut=.16])=>{
      const a=width*.5,b=depth*.5,c=cut*Math.min(a,b),d=z+shift;
      return [[-a+c,-b],[a-c,-b],[a,-b+c],[a,b-c],[a-c,b],[-a+c,b],[-a,b-c],[-a,-b+c]]
        .map(([u,v])=>[x+u,y,d+v]);
    });
    for(let i=1;i<rings.length;i++){
      const lower=rings[i-1],upper=rings[i];
      for(let j=0;j<8;j++){
        const next=(j+1)%8,color=palette[j%2?1:j%4===0?0:1];
        face(lower[j],lower[next],upper[next],upper[j],color,finish);
      }
    }
    const top=rings.at(-1);
    for(let i=1;i<7;i++) face(top[0],top[i],top[i+1],top[i+1],palette[2],finish);
  }

  // Lấy một điểm trên lát cắt đường cong theo độ lệch ngang.
  function roadPoint(z,x,y) {
    return [center(z)+x,y,z];
  }
  // Kết nối hai lát cắt đường bằng một dải mặt phẳng hoặc mặt đứng.
  function roadStrip(z,end,left,right,y1,y2,color,finish=0) {
    quad(roadPoint(z,left,y1),roadPoint(z,right,y2),roadPoint(end,right,y2),roadPoint(end,left,y1),color,1,finish);
  }
  // Vẽ đoạn mặt đường thay đổi bề rộng giữa hai lát cắt của ngã rẽ.
  function taper(z,end,a,b,c,d,y,color,finish=0) {
    quad(roadPoint(z,a,y),roadPoint(z,b,y),roadPoint(end,d,y),roadPoint(end,c,y),color,1,finish);
  }
  // Dựng các dải mặt đường, vạch phản quang và hàng rào theo biên cong.
  // Chia mặt biển gần bờ đủ dày để đỉnh sóng thay đổi cả hình học.
  const coastBands=[22,24,26,28,30,32,34,36,38,40,43,46,49,53,58,64,72,84,104,136,185,246,328,420,490];
  const bayBands=[-185,-88,-56,-39,-26,-16,-8,0,8,16,26,39,56,88,185];
  // Tăng mật độ đô thị dần từ ngoại ô, theo vị trí cố định trên tuyến.

  // Chọn màu nền và nội suy từ sườn hầm sang mặt đất khu phố.
  function groundTint(z,area=district(z)){
    if(area===0){
      const phase=mod(z-runtime.cityStart,LOOP);
      const boundary=runtime.cityStart+(phase<routeLengths[0]*.5?-.01:routeLengths[0]+.01);
      const adjacent=district(boundary);
      const approach=groundTint(boundary,adjacent);
      const urban=rgb('#262938'),blend=cityBlend(z);
      return urban.map((value,index)=>lerp(approach[index],value,blend));
    }
    return rgb(area===1?(mod(z,120)<60?'#384a2c':'#414831'):area===2?'#30443c':
      area===6?'#273d2e':area===5?'#59674f':area===3?'#353044':'#262938');
  }
  // Vẽ dải đất ngoài hầm và ở rìa thành phố với màu nội suy giữa hai đầu.
  function approachGround(z,end){
    const a=roadPoint(z,-185,-.18),b=roadPoint(z,185,-.18);
    const c=roadPoint(end,185,-.18),d=roadPoint(end,-185,-.18);
    const near=groundTint(z),far=groundTint(end);
    point(a,near,1,3);point(b,near,1,3);point(c,far,1,3);
    point(a,near,1,3);point(c,far,1,3);point(d,far,1,3);
  }
  function oceanStrip(z,end,coast){
    const bands=coast?coastBands:bayBands,mid=(z+end)*.5;
    const y=coast?-.66:-3.1,finish=coast?-4:-3,color=coast?'#1e5362':'#173c54';
    const near=Math.abs(mid-runtime.origin)<76;
    const segment=(from,to,a,b)=>{
      if(!coast){roadStrip(from,to,a,b,y,y,color,finish);return;}
      const start=coastShore(from).edge,end=coastShore(to).edge;
      const across=(shore,band)=>band<=185?lerp(shore,185,(band-22)/163)
        :185+(band-185)*clamp((185-shore)/163,0,1);
      quad(roadPoint(from,across(start,a),y),roadPoint(from,across(start,b),y),
        roadPoint(to,across(end,b),y),roadPoint(to,across(end,a),y),color,1,finish);
    };
    for(let k=1;k<bands.length;k++){
      if(near){segment(z,mid,bands[k-1],bands[k]);segment(mid,end,bands[k-1],bands[k]);}
      else segment(z,end,bands[k-1],bands[k]);
    }
  }
  function roadMesh() {
    const animated=usesAnimatedTheme();
    const first=Math.floor((back-8)/3)*3;
    for(let z=first;z<forward;z+=3){
      const end=z+3;
      const area=district(z+1.5);
      if(area===4){
        oceanStrip(z,end,false);
        roadStrip(z,end,-6.2,6.2,-.55,-.55,'#584b65');
      }
      else if(area===3){
        roadStrip(z,end,-185,10,-.18,-.18,'#353044',3);
        const a=coastShore(z),b=coastShore(end);
        quad(roadPoint(z,10,-.18),roadPoint(z,a.edge,a.height),roadPoint(end,b.edge,b.height),
          roadPoint(end,10,-.18),sceneryAt(z).style==='dunes'?'#a87754':'#8b795b',1,3);
        oceanStrip(z,end,true);
      }else if(area===0||area===5){
        approachGround(z,end);
      }else{
        const land=area===1?(mod(z,120)<60?'#384a2c':'#414831'):area===2?'#30443c':area===6?'#273d2e':'#262938';
        if(animated&&area===2&&mod(z+1.5-runtime.passStart,LOOP)>PASS_LENGTH*(723/900)){
          roadStrip(z,end,-185,36,-.18,-.18,land,3);
          const edge=at=>Math.min(-.18,13.7-passSample(at,passHeights));
          quad(roadPoint(z,36,-.18),roadPoint(z,185,edge(z)),
            roadPoint(end,185,edge(end)),roadPoint(end,36,-.18),land,1,3);
        }else roadStrip(z,end,-185,185,-.18,-.18,land,3);
      }
      roadStrip(z,end,-6.1,6.1,0,0,'#303a48',2);
      roadStrip(z,end,-ROAD/2,ROAD/2,.012,.012,'#202733',2);
      for(const side of [-1,1]){
        const branch=exitWidth(z,side),next=exitWidth(end,side);
        const rail=side*(6+branch),farRail=side*(6+next);
        if(branch+next>0){
          taper(z,end,side*5.64,side*(5.85+branch),side*5.64,side*(5.85+next),.013,'#202741',2);
          if(branch>1.25&&mod(z,9)<3) roadStrip(z,end,side*5.45,side*5.56,.025,.025,'#c1c9d8');
          // Đánh dấu hướng nhánh khi đủ bề rộng cho vạch mũi tên.
          if(branch>3.8&&next>3.8&&!localMergeAt(z+1.5,side)&&mod(z,54)===0){
            const x=side*(5.5+branch*.49),tip=x+side*.72;
            taper(z,z+2.1,x-.098,x+.098,tip-.098,tip+.098,.029,'#d0d9e4');
            taper(z+1.8,end,tip-.45,tip+.45,tip,tip,.029,'#d0d9e4');
          }
        }
        if(!localMergeAt(z+1.5,side)) taper(z,end,side*(5.48+branch),side*(5.57+branch),side*(5.48+next),side*(5.57+next),.024,'#bbc4d6');
        if(!railPresent(z+1.5)||localMergeAt(z+1.5,side)) continue;
        taper(z,end,rail-.081,rail+.081,farRail-.081,farRail+.081,.59,'#78868d');
        quad(roadPoint(z,rail-side*.075,.48),roadPoint(z,rail-side*.075,.59),
          roadPoint(end,farRail-side*.075,.59),roadPoint(end,farRail-side*.075,.48),'#657582');
        quad(roadPoint(z,rail,.40),roadPoint(z,rail-side*.075,.48),
          roadPoint(end,farRail-side*.075,.48),roadPoint(end,farRail,.40),'#45535f');
        if(mod(z,6)===0){
          box(center(z)+rail,.02,z,.105,.56,.14,['#818d8d','#455460','#b2bcb4']);
          if(mod(z,12)===0) roadStrip(z,z+.19,rail-side*.089,rail-side*.089,.446,.515,'#e5bd83',-1);
        }
      }
      if(mod(z,12)<6) for(const x of [-1.9,1.9]){
        roadStrip(z,end,x-.055,x+.055,.024,.024,'#cdcee0');
      }
    }
  }
  // Dựng cột đèn xanh neon có lõi cyan.
  function renderLocalRoads(){
    for(let z=Math.floor((back-3)/3)*3;z<forward;z+=3){
      const road=localRoadAt(z+1.5);
      if(!road) continue;
      const end=z+3,p=mod(z+1.5-road.start,LOOP);
      const a=localOffset(road,road.start+clamp(p-1.5,0,LOCAL_LENGTH-.001));
      const b=localOffset(road,road.start+clamp(p+1.5,0,LOCAL_LENGTH-.001));
      const side=road.side;
      const clipA=Math.max(6.1,5.85+exitWidth(z,side)),clipB=Math.max(6.1,5.85+exitWidth(end,side));
      // Chỉ vẽ phần nhánh nằm ngoài mép mặt đường hiện hữu, kể cả đoạn hình tam giác ở điểm nhập.
      const strip=(inner,outer,y,color,finish=2)=>{
        const farA=Math.max(clipA,side*a+outer),farB=Math.max(clipB,side*b+outer);
        const nearA=clamp(side*a+inner,clipA,farA),nearB=clamp(side*b+inner,clipB,farB);
        if(farA>nearA+.001||farB>nearB+.001)
          taper(z,end,side*nearA,side*farA,side*nearB,side*farB,y,color,finish);
      };
      strip(-3.85,3.85,.012,'#414d63');
      strip(-3.15,3.15,.017,'#202940');
      if(mod(z,12)<6) strip(-.045,.045,.028,'#dcca9c',0);
      if(Math.abs(p-LOCAL_JUNCTION)<4.2) strip(3.15,9.7,.017,'#202940');
    }
    for(const road of localRoads){
      const intersection=runtime.origin+relativeDistance(runtime.origin,road.start+LOCAL_JUNCTION);
      if(intersection<back-8||intersection>forward+8) continue;
      const x=localOffset(road,intersection),side=road.side;
      for(let i=-3;i<3;i++)
        roadStrip(intersection-3,intersection+3,x+i*.96,x+i*.96+.37,.033,.033,'#cccfda');
      roadStrip(intersection-5.2,intersection-4.92,x-3.05,x+3.05,.032,.032,'#e4e4e3');
      const post=center(intersection)+x-side*3.55;
      const lampX=post+side*2.62;
      // Chỉ vẽ bóng đèn giao lộ khi cột đèn còn trong tầm render.
      if(!placeRouteModel(streetlightPool,post+side*1.31,0,intersection,side===1?Math.PI:0,2.8,4.30,.26)) continue;
      const selected=localSignal(road);
      for(const [color,y,lit,dim] of [['red',4.05,'#ff4549','#683039'],['amber',3.76,'#ffd25e','#635235'],['green',3.47,'#62fcb6','#305747']]){
        quad([lampX-.16,y-.10,intersection-.137],[lampX+.16,y-.10,intersection-.137],
          [lampX+.16,y+.10,intersection-.137],[lampX-.16,y+.10,intersection-.137],color===selected?lit:dim,1,-1);
      }
    }
  }
  // Dựng thân cột, tay đỡ và chụp đèn với bề mặt đục.
  // Dùng GLB cho thân đèn và giữ nguồn sáng tại vị trí mặt đường.
  function lightMesh(z,side){
    const x=center(z)+side*(6.72+exitWidth(z,side));
    const bulb=x-side*1.42;
    const placed=placeRouteModel(streetlightPool,x-side*.71,0,z,side===1?0:Math.PI,...modelMeters.streetlight);
    if(placed&&roadLamps>.05) lampGlows.push([bulb,6.28,z]);
  }
  // Đặt quầng cyan và vệt lóe tại bóng đèn, để vật thể trước đèn che chúng theo chiều sâu.
  function drawLampGlows(){
    const haze=rgb('#279dff'), streak=rgb('#89ddff');
    for(const [x,y,z] of lampGlows){
      const depth=(x-runtime.originX)*runtime.yawSin+(z-runtime.origin)*runtime.yawCos;
      if(depth<2||depth>300) continue;
      const mid=[x-.25*runtime.yawSin,y,z-.25*runtime.yawCos];
      for(const [width,height,color,alpha] of [[1.22,.76,haze,.60],[1.68,.105,streak,.35]]){
        let previous=[mid[0]+runtime.yawCos*width,mid[1],mid[2]-runtime.yawSin*width];
        for(let i=1;i<=10;i++){
          const angle=i*TAU/10, right=Math.cos(angle)*width;
          const next=[mid[0]+runtime.yawCos*right,mid[1]+Math.sin(angle)*height,mid[2]-runtime.yawSin*right];
          point(mid,color,roadLamps*alpha,-1);
          point(previous,color,0,-1);
          point(next,color,0,-1);
          previous=next;
        }
      }
    }
  }
  // Dựng sàn cầu có mặt dưới, dầm chịu lực và biển chỉ đường có chiều dày.
  // Vẽ cầu vượt từ GLB và dùng hình học tuyến đường cho lối đi bên dưới.
  function structure(z){
    const x=center(z),left=exitWidth(z,-1),right=exitWidth(z,1);
    placeRouteModel(overpassPool,x+(right-left)*.5,0,z,0,34+left+right,7.1,6.2);
  }
  // Giữ khoảng nạp cảnh quan đối xứng theo tuyến khi camera xoay.
  function sceneryBounds(){
    const range=Math.min(runtime.graphics.scenery,runtime.objectDistance+100);
    return [runtime.origin-range,runtime.origin+range];
  }
  // Chỉ loại nhà chắc chắn khuất phía sau, kể cả khi nó nằm sát mép camera.
  function cityBuildingVisible(x,z,width,depth){
    const front=(x-runtime.originX)*runtime.yawSin+(z-runtime.origin)*runtime.yawCos;
    return front>=-Math.hypot(width,depth)*.5-14;
  }
  // Dùng chung vị trí nhà với bộ chọn quỹ đạo máy bay.
  function drawCityBuildings(){
    const [near,far]=sceneryBounds();
    const pools={town:townPool,office:officePool,apartment:apartmentPool,house:housePool};
    const paints=[0xf7e0b5,0xf1c5ab,0xc8ded0,0xc7dbe8,0xe8d4b8,0xf0e9dd,0xe6c4bf];
    eachCityBuilding(near-24,far+16,(x,z,width,height,depth,yaw,kind,local)=>{
      if(!cityBuildingVisible(x,z,width,depth)) return;
      const pool=pools[kind];
      if(!placeRouteModel(pool,x,-.18,z,yaw,width,height,depth)) return;
      const slot=pool.slots[pool.used-1];
      const paint=paints[Math.floor(hash(mod(z,LOOP)*17+x*29)*paints.length)];
      if(slot.paint!==paint){
        slot.paint=paint;
        // Giữ texture và lớp đèn cửa sổ, chỉ nhuộm màu sơn của từng nhà.
        slot.wrapper.traverse(obj=>{if(obj.isMesh) obj.material.color.setHex(paint);});
      }
      if(local) markShadow(x,-.18,z,depth,height,width);
    });
  }
  // Tạo sườn núi và ngọn cây từ cùng một lưới mặt tam giác.
  function roundedRings(layers,top,bottom,finish=0){
    const sides=layers[0].length;
    const vertex=({p,color})=>point(p,color,1,finish);
    for(let i=0;i<sides;i++){
      const j=(i+1)%sides;
      if(bottom){vertex(layers[0][j]);vertex(layers[0][i]);vertex(bottom);}
      for(let row=1;row<layers.length;row++){
        const a=layers[row-1][i],b=layers[row-1][j],c=layers[row][j],d=layers[row][i];
        vertex(a);vertex(b);vertex(c);vertex(a);vertex(c);vertex(d);
      }
      vertex(layers.at(-1)[i]);vertex(layers.at(-1)[j]);vertex(top);
    }
  }
  const hillPlants=[];
  const grassInstances=[];
  const sceneryTrees=[];
  // Giữ cây theo chiều nhìn thực tế, chừa biên cho cả tán cây.
  function queueSceneryTree(pool,x,y,z,yaw,size){
    const dx=x-runtime.originX,dz=z-runtime.origin;
    const dy=y+passSample(z,passHeights)+size*.5-runtime.eye;
    const depth=(dx*runtime.yawSin+dz*runtime.yawCos)*runtime.pitchCos+dy*runtime.pitchSin;
    if(depth < -size) return;
    sceneryTrees.push({pool,x,y,z,yaw,size,distance:dx*dx+dz*dz});
  }
  // Dùng các bản sao GLB cho cây gần trước khi chạm giới hạn mỗi loại.
  function drawSceneryTrees(){
    sceneryTrees.sort((a,b)=>a.distance-b.distance);
    for(const {pool,x,y,z,yaw,size} of sceneryTrees){
      placeRouteModel(pool,x,y,z,yaw,size,size,size);
    }
  }
  // Chọn điểm rải cỏ trên mặt đồi, tránh mặt đá quá dốc hoặc thấp sát nước.
  function queueHillPlant(a,b,c,key,minY=-Infinity){
    const u=Math.sqrt(hash(key+11)),v=hash(key+13);
    const p=a.map((value,k)=>value*(1-u)+b[k]*u*(1-v)+c[k]*u*v);
    if(p[1]<minY) return;
    const ab=b.map((value,k)=>value-a[k]),ac=c.map((value,k)=>value-a[k]);
    const vertical=Math.abs(ab[2]*ac[0]-ab[0]*ac[2]);
    const area=Math.hypot(ab[1]*ac[2]-ab[2]*ac[1],vertical,ab[0]*ac[1]-ab[1]*ac[0]);
    if(!area||vertical/area<.24) return;
    const size=.76+hash(key+23)*1.50;
    hillPlants.push({p,size,yaw:hash(key+27)*TAU});
  }

  // Rải cỏ bằng hạt cố định và nội suy trên đúng tam giác của sườn đồi.
  function scatterHillPlants(layers,seed){
    const count=Math.max(14,Math.round(runtime.graphics.grass*9*runtime.treeDensity));
    const sides=layers[0].length;
    for(let i=0;i<count;i++){
      const key=seed*117+i*83;
      const ring=Math.min(layers.length-2,Math.floor(hash(key+5)**1.12*(layers.length-1)));
      const side=Math.floor(hash(key+7)*sides),next=(side+1)%sides;
      const a=layers[ring][side].p,c=layers[ring+1][next].p;
      const b=hash(key+9)>.5?layers[ring][next].p:layers[ring+1][side].p;
      queueHillPlant(a,b,c,key);
    }
  }
  // Chỉ vẽ cỏ trên đồi và ưu tiên các cụm gần camera.
  function drawHillPlants(){
    for(const plant of hillPlants) plant.distance=Math.hypot(plant.p[0]-runtime.originX,plant.p[2]-runtime.origin);
    hillPlants.sort((a,b)=>a.distance-b.distance);
    const limit=runtime.graphics.grass*28;
    for(let i=0;i<Math.min(hillPlants.length,limit);i++){
      const {p:[x,y,z],size,yaw}=hillPlants[i];
      if(hillPlants[i].distance>grassRenderDistance()) break;
      queueGrass(x,y-.055,z,yaw,size,size,size);
    }
  }
  // Dựng sườn đồi và chọn các điểm có thể phủ cỏ.
  function mountainRidge(x,y,z,width,length,height,seed,palette){
    const form=Math.floor(hash(seed+56)*3);
    const detail=Math.abs(z-runtime.origin)<Math.min(runtime.graphics.detail,205);
    const sides=detail?(runtime.graphics===graphicsPresets.highest?22:16):10;
    const rings=detail?[1,.91,.79,.66,.51,.34,.18,.06]:[1,.82,.60,.36,.12];
    const tint=palette.map(rgb);
    const phase=hash(seed+17)*TAU;
    const layers=rings.map((radius,index)=>Array.from({length:sides},(_,i)=>{
      const angle=i*TAU/sides;
      const ridge=Math.sin(angle*3+phase)*.075+Math.cos(angle*5-phase)*.035;
      const undulate=.89+ridge;
      const crown=Math.cos(radius*Math.PI/2)**(form===0?1.95:form===1?1.45:1.65);
      const lift=height*crown*(.94+radius*(.14*Math.sin(angle+phase)+ridge*1.3));
      const sway=(1-radius)**2;
      const p=[x+width*(Math.cos(angle)*radius*undulate+sway*.17*Math.sin(phase)),
        y+lift,z+length*(Math.sin(angle)*radius*undulate+sway*.16*Math.cos(phase))];
      const shade=.5+.5*Math.cos(angle-.7);
      const color=tint[0].map((value,c)=>lerp(lerp(tint[1][c],value,shade),tint[2][c],index*.07));
      return {p,color};
    }));
    const summit={p:[x+width*.17*Math.sin(phase),y+height*.94,z+length*.16*Math.cos(phase)],
      color:tint[0].map((c,i)=>lerp(c,tint[2][i],.4))};
    roundedRings(layers,summit,null,6);
    if(detail&&district(z)===2&&Math.abs(z-runtime.origin)<grassRenderDistance()+length) scatterHillPlants(layers,seed);
  }


  function sceneryMesh(model,x,y,z,width,height,depth,angle,palette,leanX=0,leanZ=0,finish=0){
    const cos=Math.cos(angle),sin=Math.sin(angle),positions=model.positions;
    ensureScratch(positions.length);
    for(let i=0;i<positions.length;i+=3){
      const a=positions[i]/1024,b=positions[i+1]/1024,c=positions[i+2]/1024,bb=b*b;
      scratchVerts[i]=x+(a*cos+c*sin)*width+leanX*bb;
      scratchVerts[i+1]=y+b*height;
      scratchVerts[i+2]=z+(c*cos-a*sin)*depth+leanZ*bb;
    }
    for(const [material,indices] of model.surfaces){
      const color=rgb(palette?.[material]??material);
      for(let j=0;j<indices.length;j++){
        const k=indices[j]*3;
        pointXYZ(scratchVerts[k],scratchVerts[k+1],scratchVerts[k+2],color,1,finish);
      }
    }
  }
  function mountainAsset(model,x,y,z,width,height,depth,angle,palette,finish=6){
    const [stone,soil,crest=stone]=palette;
    sceneryMesh(model,x,y,z,width,height,depth,angle,{stone,soil,crest},0,0,finish);
    if(model===terrainModels.hill&&Math.abs(z-runtime.origin)<grassRenderDistance()+depth){
      const count=Math.round(runtime.graphics.grass*7*runtime.treeDensity);
      const seed=mod(z,LOOP)*119+Math.round(x)*17;
      const triangles=model.surfaces.flatMap(([,faces])=>faces);
      // Các đỉnh đã qua cùng phép đổi tỉ lệ với đồi đang nằm trong bộ đệm dựng cảnh.
      const vertex=id=>Array.from(scratchVerts.subarray(id*3,id*3+3));
      for(let i=0;i<count;i++){
        const key=seed+i*71,k=Math.floor(hash(key+29)*(triangles.length/3))*3;
        queueHillPlant(vertex(triangles[k]),vertex(triangles[k+1]),vertex(triangles[k+2]),key,y+1.3);
      }
    }
  }
  // Đặt nhà nông thôn bằng GLB tại đúng giới hạn va chạm có sẵn.
  function countryHouse(x,z,seed){
    const {width,depth}=countryHouseSize(seed);
    const base=-.13,height=3.25+hash(seed+13)*.65;
    const angle=x>center(z)?-Math.PI/2:Math.PI/2;
    if(placeRouteModel(housePool,x,base,z,angle,depth,height,width))
      markShadow(x,base,z,width,height,depth);
  }
  const treeHeights=[1,.9,1.20,1,1.09];
  // Chọn cây thường hoặc dừa theo vùng cảnh quan.
  function foliage(x,z,seed,area,extra=false){
    if(!extra&&hash(seed+103)>runtime.treeDensity/1.6) return;
    const size=area===6?5.4+hash(seed+4)*5.3:area===1?4.6+hash(seed+4)*4.1:4.2+hash(seed+4)*3.9;
    const form=hash(seed+47), palm=area===3&&form<.28;
    const height=palm?size+2.6:size*treeHeights[Math.floor(form*5)];
    queueSceneryTree(palm?palmPool:treePool,x,-.18,z,hash(seed+67)*TAU,height);
  }
  function terraces(z,side){
    for(let row=0;row<6;row++){
      const a=side*(23+row*4.1),b=a+side*4.1,y=.08+row*.45;
      roadStrip(z-8,z+8,a,b,y,y,row%2?'#787844':'#5d783f');
      roadStrip(z-8,z+8,a,a,y-.43,y,'#555846');
    }
  }
  function field(z,side,seed){
    const style=sceneryAt(z).style;
    const color=style==='lotus'?'#466b60':hash(seed)>.55?'#78804b':'#556d43';
    const start=Math.max(z-8,Math.ceil((z-8)/4)*4);
    for(let at=start;at<z+8;at+=4){
      if(district(at+2)!==1) continue;
      roadStrip(at,at+4,side*30,side*82,-.167,-.167,color);
      for(let row=33;row<82;row+=Math.abs(at-runtime.origin)>205?10:5){
        const a=side*row,b=side*(row+1.6);
        roadStrip(at,at+4,a,b,-.151,-.151,style==='lotus'&&mod(row+at,7)<2?'#a47281':row%3===0?'#989358':'#657947');
      }
    }
  }
  const walkerLooks=new Map();
  function roadsideLook(seed){
    if(!walkerLooks.has(seed)){
      let n=seed;
      walkerLooks.set(seed,newCharacter(()=>hash(++n)));
    }
    return walkerLooks.get(seed);
  }
  // Đặt nhóm NPC ngoài làn xe và kiểm tra từng chỗ đứng với công trình.
  function roadsideGroup(z,side,seed,city=false,shoreOffset=null){
    const baseCount=2+Math.floor(hash(seed+25)*(city?3:2));
    const count=Math.floor(baseCount*runtime.pedestrianDensity+hash(seed+117));
    if(!count) return;
    const radius=count>1?Math.max(.87,count*.18):0;
    const x=shoreOffset??side*(city?9.4+exitWidth(z,side):13.2);
    const people=Array.from({length:count},(_,index)=>{
      const angle=index*TAU/count;
      const at=z+Math.cos(angle)*radius,px=center(z)+x+Math.sin(angle)*radius;
      return {at,px,angle:angle+Math.PI};
    });
    people.forEach(({at,px,angle},index)=>{
      // Thành viên cuối rời vòng trò chuyện, đi dọc lề rồi quay lại sau khi nghỉ.
      const cycle=mod(world.time+hash(seed+36)*54,54);
      let departure=count>1&&index===count-1?clamp(Math.min(cycle-15,51-cycle),0,12):0;
      let direction=hash(seed+51)<.5?-1:1;
      // Chỉ tách nhóm khi lề đủ dài và không có công trình trên đoạn đi.
      const offsetAtStart=px-center(at);
      const pathClear=sign=>[3,6,9,12].every(distance=>{
        const checkZ=at+sign*distance;
        return (shoreOffset===null||district(checkZ)===3)
          &&roadsidePlacement(checkZ,center(checkZ)+offsetAtStart,.36,.32)
          &&!solidScenery(checkZ,offsetAtStart,.36);
      });
      if(departure&&!pathClear(direction)){
        if(pathClear(-direction)) direction=-direction;
        else departure=0;
      }
      const moving=departure>0&&departure<12;
      const start=at;
      at+=direction*departure;
      px+=center(at)-center(start);
      if(shoreOffset!==null&&district(at)!==3) return;
      if(departure) angle=(direction*(cycle<33?1:-1)>0?0:Math.PI)+Math.atan(slope(at));
      const offset=px-center(at);
      if(!roadsidePlacement(at,px,.36,.32)||solidScenery(at,offset,.36)) return;
      const turn=mod(world.time*.46+hash(seed+65),count);
      const beat=turn-index;
      const gesture=count>1&&!departure&&beat>=0&&beat<1?{
        hand:hash(seed+index*3)<.5?'Left':'Right',
        amount:Math.sin(Math.PI*beat)*(.68+.23*Math.sin(beat*TAU*3))
      }:null;
      personMesh({x:offset,y:terrainHeight(at,offset),look:roadsideLook(seed+index*3),
        angle,grounded:true,moving,stride:departure/1.22,gesture},at);
    });
  }
  // Giữ chó cảnh đi cạnh người đi bộ bằng cùng quỹ đạo lề đường.
  function walkingDog(z,x,angle,phase,side,moving){
    const cos=Math.cos(angle),sin=Math.sin(angle);
    const at=z-side*sin*.89+cos*.40,px=center(z)+x+side*cos*.89+sin*.40;
    if(!roadsidePlacement(at,px,.41,.54)||solidScenery(at,px-center(at),.40)) return;
    const y=terrainHeight(at,px-center(at))+(moving?.013*Math.abs(Math.sin(phase*TAU*2)):0);
    if(!placeRouteModel(dogPool,px,y,at,angle,...modelMeters.dog)) return;
    const slot=dogPool.slots[dogPool.used-1];
    // Dùng cặp chân chéo pha và vẫy đuôi nhẹ khi đứng hoặc đi.
    slot.dogJoints??=['LeftFront','RightFront','LeftBack','RightBack','Tail'].map(name=>slot.wrapper.getObjectByName(name));
    const swing=moving?Math.sin(phase*TAU*1.8)*.28:0;
    const [leftFront,rightFront,leftBack,rightBack,tail]=slot.dogJoints;
    leftFront.rotation.x=rightBack.rotation.x=swing;
    rightFront.rotation.x=leftBack.rotation.x=-swing;
    tail.rotation.y=Math.sin(world.time*5+z)*.22;
  }
  // Cho NPC đi bộ dọc lề, điều chỉnh theo bề rộng làn rẽ ở thành phố.
  function walker(z,side,seed,city=false,shoreOffset=null,running=false){
    if(hash(seed+191)>=runtime.pedestrianDensity) return;
    const phase=mod((world.time*(.86+hash(seed)*.31)*(running?2.55:1)+hash(seed+9)*12)*.155,TAU);
    const at=z+Math.sin(phase)*4;
    if(shoreOffset!==null&&district(at)!==3) return;
    const x=shoreOffset??side*(city?8.4+exitWidth(at,side):10.6);
    if(!roadsidePlacement(at,center(at)+x,.52,.48)||solidScenery(at,x,.35)) return;
    const speed=Math.abs(Math.cos(phase));
    const angle=(Math.cos(phase)>=0?0:Math.PI)+Math.atan(slope(at));
    const stride=mod(Math.asin(Math.sin(phase))*4/1.22,1);
    const y=terrainHeight(at,x);
    personMesh({x,y,look:roadsideLook(seed),angle,grounded:true,moving:speed>.10,running,stride},at);
    if(!city&&!running&&hash(seed+22)<.64) walkingDog(at,x,angle,stride,side,speed>.10);
  }
  // Rải người đi bộ và nhóm trò chuyện trên dải cát, có khoảng lùi với mép nước.
  function beachVisitors(z,seed,index){
    if(!runtime.pedestrianDensity||Math.abs(z-runtime.origin)>runtime.graphics.person*1.7||index%2!==0) return;
    const edge=coastShore(z).edge;
    const across=clamp(18+hash(seed+77)*29,16,edge-8);
    if(index%4===0) beachWalker(z,seed+723,across);
    else roadsideGroup(z,1,seed+311,false,across);
    if(index%8===2) beachWalker(z+5,seed+91,Math.max(16,across-8),true);
    if(index%8===4&&hash(seed+197)<runtime.pedestrianDensity){
      const x=edge-5;
      if(roadsidePlacement(z,center(z)+x,.36)&&!solidScenery(z,x,.36))
        personMesh({x,y:terrainHeight(z,x),look:roadsideLook(seed+52),angle:Math.PI*.5,grounded:true,moving:false},z);
    }
  }
  // Cho NPC đi thành vòng dài trên cát, lấy hướng từ quỹ đạo để quay đầu mượt.
  function beachWalker(z,seed,across,running=false){
    if(hash(seed+191)>=runtime.pedestrianDensity) return;
    const speed=(running?.22:.077)*(1+hash(seed+9)*.3);
    const phase=world.time*speed+hash(seed+11)*TAU;
    // Bám theo độ cong của bờ và giữ khoảng cách với mặt nước suốt vòng đi.
    const position=angle=>{
      const at=z+Math.sin(angle)*(running?16:12);
      const x=Math.min(across+Math.cos(angle)*2.8,coastShore(at).edge-3);
      return {at,x,px:center(at)+x};
    };
    const {at,x,px}=position(phase),ahead=position(phase+.025);
    if(district(at)!==3||!roadsidePlacement(at,px,.45,.45)||solidScenery(at,x,.36)) return;
    const angle=Math.atan2(ahead.px-px,ahead.at-at);
    const stride=(phase*.64+Math.sin(2*phase)*.13)*(running?8:10);
    personMesh({x,y:terrainHeight(at,x),look:roadsideLook(seed),angle,grounded:true,moving:true,running,stride},at);
    if(!running&&hash(seed+22)<.55) walkingDog(at,x,angle,stride,1,true);
  }
  // Thu hẹp tầm cỏ cùng thanh render, theo giới hạn của mức đồ họa hiện tại.
  function grassRenderDistance(){
    return runtime.graphics.grassRange*(.2+.8*runtime.objectDistance/750);
  }
  // Gom cỏ ven đường và trên đồi để ưu tiên cụm gần trong cùng ngân sách vẽ.
  function queueGrass(x,y,z,yaw,width,height,depth){
    const dx=x-runtime.originX,dz=z-runtime.origin;
    const distance=Math.hypot(dx,dz);
    if(distance>grassRenderDistance()||dx*runtime.yawSin+dz*runtime.yawCos < -8) return;
    grassInstances.push({x,y,z,yaw,width,height,depth,distance});
  }
  // Vẽ các cụm cỏ gần nhất trước khi hết bản sao GLB.
  function drawSceneryGrass(){
    grassInstances.sort((a,b)=>a.distance-b.distance);
    for(const {x,y,z,yaw,width,height,depth} of grassInstances){
      if(!placeRouteModel(grassPool,x,y,z,yaw,width,height,depth)) break;
    }
  }
  // Đưa một cụm cỏ ven đường vào danh sách vẽ.
  function grassTuft(z,x,seed,animated){
    const size=.48+hash(seed+31)*.46;
    queueGrass(x,-.17,z,hash(seed)*TAU,size*1.18,size*(animated?1.27:1.14),size*1.18);
  }
  // Cảnh xa đặt ngoài vùng lái. Mặt hồ giữ cao độ tuyệt đối khi đường xuống dốc.
  function mountainVista(){
    const pass=runtime.passStart+Math.round((runtime.origin-runtime.passStart)/LOOP)*LOOP;
    if(runtime.origin<pass+PASS_LENGTH*(310/900)||runtime.origin>pass+PASS_LENGTH+20) return;
    const lakeX=center(pass+PASS_LENGTH*(765/900))+153,lakeZ=pass+PASS_LENGTH*(830/900),lakeHeight=14;
    const atHeight=(x,y,z)=>[x,y-passSample(z,passHeights),z];
    for(let i=0;i<18;i++){
      const a=i*TAU/18,b=(i+1)*TAU/18;
      const shore=angle=>atHeight(lakeX+Math.cos(angle)*91,lakeHeight,lakeZ+Math.sin(angle)*105);
      const middle=atHeight(lakeX,lakeHeight,lakeZ);
      quad(middle,shore(a),shore(b),shore(b),i<8?'#535c80':'#667492',1,-1);
    }
    const sunset=world.twilight>.55&&world.sunStrength>.20;
    for(let i=0;i<16;i++){
      const z=lakeZ-66+i*8,width=5+hash(i+98)*15;
      const x=lakeX+91+Math.abs(z-lakeZ)*.10+hash(i+74)*22;
      const height=i%7===0?28+hash(i+27)*16:4+hash(i+86)*12;
      const base=lakeHeight-passSample(z,passHeights);
      const pool=i%7===0?officePool:apartmentPool;
      placeRouteModel(pool,x,base,z,0,width,height,6);
      if(sunset){
        const strip=lakeZ-53+i*6,span=5+hash(i+177)*19,offset=hash(i+65)*13;
        quad(atHeight(lakeX+offset-span,lakeHeight+.03,strip),atHeight(lakeX+offset+span,lakeHeight+.03,strip),
          atHeight(lakeX+offset+span*.85,lakeHeight+.03,strip+1.1),atHeight(lakeX+offset-span*.6,lakeHeight+.03,strip+1.1),'#b58a91',1,-1);
      }
    }
  }
  // Dùng độ cao sóng tại thân tàu để đặt GLB nổi trên mặt nước.
  function boat(z,area,seed){
    const phase=world.time*.094+hash(seed)*TAU;
    const crossing=area===4;
    const at=z+(crossing?0:Math.sin(phase)*22);
    if(district(at)!==area||district(z-26)!==area||district(z+26)!==area) return;
    const offshore=Math.max(39,coastShore(at).edge+14)+hash(seed+2)*25;
    if(!crossing&&offshore>165) return;
    const x=center(at)+(crossing?Math.sin(phase)*40:offshore);
    const worldZ=mod(at,LOOP),time=world.time;
    const a=x*.52+worldZ*.14137167+time*1.36;
    const b=x*.28-worldZ*.17933258+time*.91;
    const c=x*.94+worldZ*.35866516+time*1.96;
    const water=(crossing?-3.1:-.66)+.29*Math.sin(a)+.17*Math.sin(b)+.074*Math.sin(c)+.035*Math.sin(a*2);
    const heading=Math.cos(phase)>0?0:Math.PI;
    const size=crossing?1:hash(seed+18)>.62?1.72:.91;
    placeRouteModel(boatPool,x,water-.16,at,heading+(crossing?Math.PI/2:0),...modelMeters.boat.map(value=>value*size));
  }
  // Bố trí hàng cây trên khoảng trống dọc phố và tránh đè lên công trình.
  function cityRoadsideTrees(z,seed){
    const phase=mod(z-runtime.cityStart,LOOP);
    if(phase<16||phase>routeLengths[0]-16) return;
    for(const side of [-1,1]){
      const x=center(z)+side*(9.1+exitWidth(z,side)+hash(seed+side)*2.3);
      if(roadsidePlacement(z,x,1.3)&&!solidScenery(z,x-center(z),1.3))
        foliage(x,z,seed+side,1);
    }
  }
  // Dựng cảnh vật theo từng khu vực, với cây chuyển tiếp ở rìa đô thị.
  function landscapes(){
    const animated=usesAnimatedTheme();
    if(animated) mountainVista();
    const [nearZ,farZ]=sceneryBounds();
    const first=Math.floor((nearZ-32)/16);
    for(let i=first;i*16<farZ;i++){
      const seed=mod(i,LOOP/16)*29,z=i*16+4;
      const area=district(z);
      if(area===0){
        cityRoadsideTrees(z,seed);
        if(runtime.pedestrianDensity&&Math.abs(z-runtime.origin)<runtime.graphics.person*1.35){
          const side=i%2===0?-1:1;
          walker(z,side,seed,true);
          if(i%3!==1) roadsideGroup(z,-side,seed+13,true);
          if(hash(seed+227)<runtime.pedestrianDensity-1) walker(z+6,-side,seed+331,true);
        }
        continue;
      }
      if(area===5) continue;
      if(area===3) beachVisitors(z,seed,i);
      const mid=center(z),far=Math.abs(z-runtime.origin)>runtime.graphics.road;
      if(far&&(area===1||area===4)) continue;
      if(!far&&area===3&&i%8===0) boat(z,area,seed);
      if(area===4&&i%8===2) boat(z,area,seed);
      if(runtime.pedestrianDensity&&Math.abs(z-runtime.origin)<155&&i%3===0&&(area===1||area===3||area===6)){
        const side=area===3||i%2===0?-1:1;
        if(i%6===0) walker(z,side,seed);
        else roadsideGroup(z,side,seed);
      }
      if(area===4){
        const steel=({white:['#aeb6ba','#686d80','#d5c1b6'],gold:['#b49662','#79654a','#d9bb84'],blue:['#537f9c','#44566d','#92bdcf']})[sceneryAt(z).style];
        for(const side of [-1,1]){
          roadStrip(z-4,z+12,side*6.0,side*6.0,-.55,.80,steel[1]);
          if(i%4===0){
            loft(solidFace,mid+side*6.4,z,[[-3.18,.92,1.21],[-.61,.58,.81],[1,.43,.52]],steel);
            if(i%12===0) loft(solidFace,mid+side*6.91,z,[[-3.2,1.22,1.48],[-.55,1.4,1.56],
              [11.16,1.09,1.30],[13.4,.82,1.06]],steel);
          }
          const cableHeight=at=>1.28+11.3*(2*mod(at-4,192)/192-1)**2;
          const a=roadPoint(z,side*6.7,cableHeight(z));
          const b=roadPoint(z+16,side*6.7,cableHeight(z+16));
          quad(a,b,[b[0],b[1]-.3,b[2]],[a[0],a[1]-.3,a[2]],steel[2]);
          const edge=.085*side;
          quad([a[0]+edge,a[1]-.19,a[2]],[b[0]+edge,b[1]-.19,b[2]],
            [b[0]+edge,b[1]-.34,b[2]],[a[0]+edge,a[1]-.34,a[2]],steel[1]);
          seatLimb(quad,[mid+side*6.06,.76,z],[a[0],a[1]-.18,z],.068,steel);
          if(i%2===0) box(mid+side*6.06,.70,z,.18,.21,.20,steel);
        }
        if(i%12===0){
          loft(solidFace,mid,z,[[11.58,14.01,.74],[12.11,14.82,1.14],[12.64,14.23,.89]],steel);
          loft(solidFace,mid,z,[[6.69,13.82,.50],[7.16,14.08,.69]],steel);
        }
        continue;
      }
      for(const side of [-1,1]){
        const n=seed+side*7,x=mid+side*(12+hash(n)*14);
        if(area===3&&side===1){
          if(sceneryAt(z).style==='bay'&&i%5===0)
            mountainAsset(terrainModels.hill,mid+55+hash(n)*42,-.65,z,11+hash(n)*15,18,15+hash(n+4)*22,
              hash(n+34)*TAU,['#627a6c','#4e6d60','#788b76']);
          for(const distance of [31,52,87]){
            const edge=mid+distance+hash(n+distance)*13;
            quad([edge,-.63,z],[edge+.29,-.63,z],[edge+1,-.63,z+9],[edge+.74,-.63,z+9],'#43617a');
          }
          continue;
        }

        if(!far&&area===2&&sceneryAt(z).style==='terraces'&&side===1) terraces(z,side);
        if(area===2&&i%3===0){
          // Tính khoảng lùi theo toàn bộ bán kính chân núi và độ cong tối đa của đường.
          const width=24+hash(n)*25,length=31+hash(n+4)*29;
          const mountainX=mountainCenter(z,side,width,length,15+hash(n+2)*15);
          mountainRidge(mountainX,-.23,z,width,length,21+hash(n+11)*(sceneryAt(z).style==='karst'?59:43),n,
            animated?['#7c755b','#455943','#6b7058','#87836b']:['#526954','#3f5850','#506459','#61745b']);
          if(i%12===0){
            const farZ=z+18, farWidth=47, farLength=65;
            const farX=mountainCenter(farZ,side,farWidth,farLength,39);
            mountainAsset(terrainModels.ridge,farX,-.23,farZ,farWidth,55+hash(n+4)*39,farLength,
              (hash(n+11)-.5)*.9,['#5d6a72','#4c615e','#727e83']);
          }else if(!far&&i%9===3&&side===1){
            const foothill=mountainCenter(z,side,14,21,25);
            mountainAsset(terrainModels.hill,foothill,-.22,z,14,9+hash(n+31)*7,21,
              hash(n+33)*TAU,['#697a65','#50654e','#84907a']);
          }
        }
        const house=area===1&&i%5===0;
        if(house){
          const {width,depth}=countryHouseSize(n);
          if(roadsidePlacement(z,x,width*.5,depth*.5)) countryHouse(x,z,n);
        }else if((i%3!==0||area===2||area===6||area===3&&i%2===0)&&roadsidePlacement(z,x,1.65)){
          foliage(x,z,n,area);
        }
        if(Math.abs(z-runtime.origin)<runtime.graphics.detail||area===6&&!far)
          {
            const repeats=Math.max(1,Math.ceil(runtime.treeDensity));
            for(let copy=0;copy<repeats;copy++){
              if(hash(n+copy*97)>runtime.treeDensity-copy) continue;
              // Giữ vị trí cây bổ sung ổn định khi đổi góc nhìn.
              eachExtraTree(z,side,n+copy*131,area,(at,treeX,treeSeed)=>foliage(treeX+(copy?hash(treeSeed+9)-.5:0)*3.2,at,treeSeed+copy*17,area,true));
            }
          }
        if(!far&&area===1) field(z,side,n);
        if(Math.abs(z-runtime.origin)<grassRenderDistance()+16&&(area===1||area===2||area===6||area===3&&runtime.graphics===graphicsPresets.highest)){
          const grassCount=Math.max(1,Math.round(runtime.graphics.grass*runtime.treeDensity));
          for(let tuft=0;tuft<grassCount;tuft++){
            const at=z+(tuft+hash(n+tuft+57))*15.2/grassCount;
            const grassX=center(at)+side*(7.6+hash(n+tuft)*(tuft>2?7:2));
            if(Math.hypot(grassX-x,at-z)>(house?5:2.2)&&roadsidePlacement(at,grassX,.40,.30))
              grassTuft(at,grassX,n+tuft,animated);
          }
        }
        if(runtime.graphics===graphicsPresets.highest&&Math.abs(z-runtime.origin)<grassRenderDistance()+7&&i%3===1){
          const at=z+7,detailX=center(at)+side*(11+hash(n+8)*5);
          if(roadsidePlacement(at,detailX,.58,.48)){
            if(i%2!==0) grassTuft(at,detailX,n+43,animated);
          }
        }

      }
    }
  }
  // Thêm cụm nhà thấp, tháp kỹ thuật và nhà ga với các mặt vuông tô phẳng.
  // Dựng hầm theo đường cong với vách, mái và viền gia cường ở hai cửa.
  let turbinePhase=0,turbineTime=0;
  // Tích lũy góc theo thời gian để cánh quay liên tục dù tốc độ gió thay đổi.
  function windFarm(){
    if(world.time<turbineTime) turbinePhase=0;
    turbinePhase=mod(turbinePhase+Math.max(0,world.time-turbineTime)*(.45+wind.strength*.43),TAU);
    turbineTime=world.time;
    eachWindTurbine(runtime.origin,(x,z,row,i)=>{
      if(z<back-115||z>forward+185) return;
      if(placeRouteModel(turbinePool,x,-1,z,Math.PI/2,...modelMeters.turbine)){
        const {rotor}=turbinePool.slots[turbinePool.used-1];
        const direction=row===0?1:-1;
        rotor.rotation.z=mod(direction*(turbinePhase+row*.09*world.time)+hash(i+118)*TAU,TAU);
      }
    });
  }
  // Đặt ba tháp Chăm từ cùng model với kích thước riêng.
  function chamLandmark(){
    const z=runtime.origin+relativeDistance(mod(runtime.origin,LOOP),runtime.chamStart),x=center(z);
    if(z<back-100||z>forward+110) return;
    mountainRidge(x-75,-.18,z,28,40,13,129,['#67764f','#49583d','#89905d']);
    for(const [dx,dz,width,height] of [[-43,0,11,22],[-42,-17,8,15],[-48,20,7,13]])
      placeRouteModel(chamPool,x+dx,-.18,z+dz,Math.PI/2,width,height,width);
  }
  function tunnelElevation(start,end,z){
    const t=clamp(1+Math.min(z-start,end-z)/66,0,1);
    const along=clamp((z-start)/(end-start),0,1);
    const crest=Math.sin(along*Math.PI)**2;
    const shoulder=Math.sin(along*TAU)**2;
    return t*t*(3-2*t)*(10.6+20*crest+7.5*shoulder);
  }
  function tunnelRidgeHeight(start,end,z,offset){
    const width=56+10*Math.sin(clamp((z-start)/(end-start),0,1)*Math.PI);
    const round=Math.cos(clamp(Math.abs(offset)/width,0,1)*Math.PI/2);
    const surface=round**1.48;
    const erosion=.070*Math.sin(z*.031+offset*.10)*Math.sin(Math.PI*surface)**2;
    return -.18+tunnelElevation(start,end,z)*Math.max(0,surface+erosion);
  }
  function tunnelMountain(start,end){
    const rock=['#626e5d','#65725f','#697660','#6d7963','#707961','#63705b','#59674f'];
    const flank=[0,7.95,16,24,33,44,55,70];
    const at=(z,x)=>roadPoint(z,x,tunnelRidgeHeight(start,end,z,x));
    // Dùng cùng mặt cắt bo tròn cho mái và hai sườn, giữ nguyên khoảng thông xe.
    for(const [begin,finish,portal] of [[start-66,start,true],[start,end,false],[end,end+66,true]]){
      const first=Math.max(begin,Math.floor((back-14-begin)/6)*6+begin);
      for(let z=first;z<Math.min(finish,forward+12);z+=6){
        const next=Math.min(z+6,finish);
        const slope=(atZ,side,offset)=>{
          const approach=portal?clamp(Math.max(start-atZ,atZ-end)/56,0,1):0;
          const flare=17*approach*approach*(3-2*approach)*clamp((70-offset)/62.05,0,1);
          return at(atZ,side*(offset+flare));
        };
        for(const side of [-1,1]) for(let i=portal?1:0;i<flank.length-1;i++){
          const inner=flank[i],outer=flank[i+1];
          quad(slope(z,side,inner),slope(z,side,outer),slope(next,side,outer),slope(next,side,inner),rock[i],1,6);
        }
        if(portal) for(const side of [-1,1]){
          const shoulder=z0=>roadPoint(z0,side*7.35,-.14);
          quad(shoulder(z),slope(z,side,7.95),slope(next,side,7.95),shoulder(next),rock[2],1,6);
        }
      }
    }
  }
  function tunnels() {
    const first=Math.floor((back-runtime.tunnelStart-TUNNEL_LENGTH)/LOOP);
    for(let start=first*LOOP+runtime.tunnelStart;start<forward;start+=LOOP){
      const end=start+TUNNEL_LENGTH;
      if(end<back-48) continue;
      tunnelMountain(start,end);
      for(let z=Math.max(start,Math.floor((back-12-start)/6)*6+start);z<end;z+=6){
        const f=Math.min(end,z+6);
        const warm=sceneryAt(z).style==='warm';
        roadStrip(z,f,-4.9,4.9,5.35,5.35,warm?'#575750':'#3c4c57');
        for(const side of [-1,1]){
          roadStrip(z,f,side*6.75,side*6.75,-.1,4.75,warm?'#766c57':'#4e626c');
          roadStrip(z,f,side*6.75,side*4.90,4.75,5.35,warm?'#6c6356':'#465764');
          roadStrip(z,f,side*6.70,side*6.70,.92,1.12,'#8b9389');
          roadStrip(z,f,side*6.67,side*6.67,.84,.91,'#c49a61');
          if(mod(z-start,12)===0){
            const x=center(z)+side*6.63;
            box(x,.02,z,.18,4.56,.35,['#627277','#414c54','#8c9a93']);
            roadStrip(z,z+.30,side*6.65,side*4.83,4.68,5.26,'#627174');
            const tint=warm?'#ffd9a7':'#b3def4';
            roadStrip(z,Math.min(z+1.5,end),side*5.10,side*5.59,5.02,5.02,tint,-1);
            lampGlows.push([center(z)+side*5.33,4.99,z]);
          }
        }
      }
      for(const portal of [start,end]){
        const x=center(portal);
        const crest=offset=>tunnelRidgeHeight(start,end,portal,offset);
        loft(solidFace,x,portal,[[5.35,15.30,1.48],[5.62,15.8,1.62],[6.42,15.25,1.12]],
          ['#939b92','#67747a','#b4bdb1']);
        for(let i=0;i<5;i++){
          const left=-8.1+i*3.24,right=left+3.24;
          const rock='#626e5d';
          quad(roadPoint(portal,left,6.34),roadPoint(portal,right,6.34),
            roadPoint(portal,right,crest(right)),roadPoint(portal,left,crest(left)),rock,1,3);
        }
        for(const side of [-1,1]){
          const palette=['#87978f','#5e7375','#a5afa2'];
          loft(solidFace,x+side*7.15,portal,[[0,1.19,1.62],[.64,1.17,1.67],[4.72,1.01,1.48],[5.42,1.21,1.60]],palette);
          seatLimb(quad,[x+side*6.68,4.68,portal-.78],[x+side*4.91,5.40,portal-.78],.21,palette);
        }
      }
    }
  }
  // Bốn dáng xe dùng cùng chiều dài cơ sở để giữ đồng nhất va chạm và vị trí đèn pha.
  const fleetProfiles=[
    {hood:.70,tail:.74,glass:.62,rear:-1.31,roofRear:-.63,roofFront:.51,windshield:1.28},
    {hood:.58,tail:.63,glass:.58,rear:-1.87,roofRear:-.59,roofFront:.27,windshield:1.39},
    {hood:.68,tail:.81,glass:.68,rear:-1.93,roofRear:-1.49,roofFront:.54,windshield:1.39},
    {hood:.89,tail:.95,glass:.74,rear:-1.96,roofRear:-1.80,roofFront:.81,windshield:1.48}
  ];

  // Nối hai điểm hạ tầng bằng dải mặt hẹp theo bố cục cầu hoặc hầm.
  function seatLimb(face,a,b,width,palette){
    const offset=(point,side)=>[point[0]+side*width*.5,point[1],point[2]];
    face(offset(a,-1),offset(a,1),offset(b,1),offset(b,-1),palette[0]);
  }

  // Đặt đúng một xe GLB và gắn rig lên các ghế đang có người.
  function carMesh(z,car,angle,driver,player=false){
    const {x,model=0,roll=0,wreck,crash,wheelTravel=0,passenger,steer=0}=car;
    const profile=vehicleProfile(model),mid=center(z)+x;
    if(!player&&outsideObjectDistance(mid,z,profile.halfLength)) return;
    const lift=wreck?.y??crash?.hop??0;
    markShadow(mid,terrainHeight(z,x)+lift,z,profile.halfWidth*1.75,wreck?.y!==undefined?.72:profile.roof,profile.halfLength*1.9,angle);
    const vehicle=placeGlbCar(z,x,angle,roll,wreck,crash,wheelTravel,model,steer);
    if(vehicle&&!wreck&&cabinSeats[model]&&runtime.vehicleTakeover?.car===car)
      transitionCabin={vehicle,model,halfWidth:profile.halfWidth};
    if(vehicle?.stand) vehicle.stand.rotation.z=driver||Math.abs(car.v)>.15||wreck?Math.PI*.45:0;
    if(vehicle?.signals){
      const braking=car.brake||(player&&active('brake')&&car.v>=0),reversing=car.v<-.18;
      const values=vehicle.signals.value;
      values[0]=wreck?0:.18+roadLamps*1.02;
      values[1]=wreck?0:braking?1.17:reversing?.92:.20+roadLamps*.62;
      values[2]=Number(reversing);
    }
    if(vehicle&&vehicle.lamps.length&&!wreck&&Math.abs(z-runtime.origin)<170){
      vehicleLights.push({vehicle,player});
    }
    if(vehicle&&model===4&&!wreck){
      placeBikeRider(vehicle,driver,player);
      placeBikeRider(vehicle,passenger,false,true);
    }else if(vehicle&&cabinSeats[model]&&!wreck&&(player||Math.abs(z-runtime.origin)<runtime.graphics.person)){
      placeCabinRider(vehicle,model,driver,player,0);
      for(let i=0;i<(car.occupants?.length??0);i++) placeCabinRider(vehicle,model,car.occupants[i],false,i+1);
    }
  }
  let transitionCabin=null;
  // Khi bước qua cửa thấp, hạ dần tư thế trong phạm vi cabin rồi trả lại ở ngoài xe.
  function keepDoorActorBelowRoof(slot){
    const {vehicle,model,halfWidth}=transitionCabin;
    const hips=slot.bones.getBoneByName('Hips').getWorldPosition(new MidnightThree.Vector3())
      .applyMatrix4(vehicle.wrapper.matrix.clone().invert());
    const blend=clamp((halfWidth+.12-Math.abs(hips.x))/.38,0,1);
    if(blend>0) keepRiderBelowRoof(vehicle,slot,cabinSeats[model][4],blend*blend*(3-2*blend));
  }
  const vehicleLights=[];
  const lampVertex=new MidnightThree.Vector3();
  // Chiếu chùm sáng NPC từ tâm lens đã đo trên từng GLB.
  function trafficHeadlights(vehicle) {
    const tint=rgb('#a5ccff');
    const matrix=vehicle.wrapper.matrix,axis=matrix.elements;
    const heading=Math.hypot(axis[8],axis[10]);
    if(heading<.1) return;
    const sin=axis[8]/heading,cos=axis[10]/heading;
    for(const {center,front} of vehicle.lamps){
      if(!front) continue;
      lampVertex.copy(center).applyMatrix4(matrix);
      const x=runtime.originX+lampVertex.x,z=runtime.origin+lampVertex.z;
      // Lấy vị trí chùm sáng ở một khoảng cách và độ lệch ngang đã cho.
      const spot=(distance,offset)=>[x+offset*cos+sin*distance,.038,z-offset*sin+cos*distance];
      const ranges=[0,3.9,13.9,29.9], levels=[.04,.20,.09,0];
      for(let band=0;band<3;band++){
        const steps=Math.ceil((ranges[band+1]-ranges[band])/3);
        for(let i=0;i<steps;i++){
          const t0=i/steps,t1=(i+1)/steps;
          const n=lerp(ranges[band],ranges[band+1],t0);
          const f=lerp(ranges[band],ranges[band+1],t1);
          const nearAlpha=lerp(levels[band],levels[band+1],t0)*roadLamps;
          const farAlpha=lerp(levels[band],levels[band+1],t1)*roadLamps;
          for(const edge of [-1,1]){
            const a=spot(n,0),b=spot(n,edge*(.3+n*.075)),c=spot(f,edge*(.3+f*.075)),d=spot(f,0);
            point(a,tint,nearAlpha,-6);point(b,tint,0,-6);point(c,tint,0,-6);
            point(a,tint,nearAlpha,-6);point(c,tint,0,-6);point(d,tint,farAlpha,-6);
          }
        }
      }
    }
  }
  // Nối các tiết diện elip để tạo bề mặt đầu và tóc.
  // Giữ cùng model có rig khi nhân vật đứng, chạy hoặc ngã.
  function personMesh(person,z,fall=null,shadowOnly=false){
    const x=center(z)+person.x;
    if(person!==foot&&outsideObjectDistance(x,z,1)) return;
    const look=person.look??foot.look,scale=look.scale,build=look.build??1;
    const lift=fall?.y??person.y;
    const recovery=fall?.recover;
    const kneel=person.actionCrouch||(recovery===undefined?0:Math.sin(Math.PI*recovery));
    const walking=person.moving&&person.grounded&&!fall;
    markShadow(x,Math.max(0,lift-.3),z,fall?.contacts?.82:.48,(fall?.contacts?.85:1.66)*scale,fall?.contacts?1.3:.33,person.angle);
    if(shadowOnly||(!fall&&Math.abs(z-runtime.origin)>=runtime.graphics.person*2)) return;
    const pool=person===foot?npcDriverPool:(look.outfit===1||look.outfit===3)?npcWorkerPool:npcPassengerPool;
    const y=lift-kneel*.25*scale;
    const placed=placeNpc(pool,x-runtime.originX,y+passSample(z,passHeights),z-runtime.origin,person.angle,scale,build,walking,walking&&person.running,person.stride??0,person,kneel,fall);
    if(placed&&person===foot&&transitionCabin&&!fall) keepDoorActorBelowRoof(pool.slots[pool.used-1]);
  }
  function drawSandFootprints(){
    for(const print of sandFootprints){
      const z=runtime.origin+relativeDistance(runtime.origin,print.z);
      if(Math.abs(z-runtime.origin)>75) continue;
      const x=center(z)+print.x, sin=Math.sin(print.angle),cos=Math.cos(print.angle);
      const at=(side,along)=>{
        const dz=(along*cos-side*sin)*print.scale;
        const dx=(side*cos+along*sin)*print.scale;
        return [x+dx,terrainHeight(z+dz,x+dx-center(z+dz))+.018,z+dz];
      };
      const opacity=.53*clamp((36-(world.time-print.time))/12,0,1);
      quad(at(-.047,-.13),at(.047,-.13),at(.041,-.035),at(-.041,-.035),'#70533d',opacity,-1);
      quad(at(-.045,-.018),at(.045,-.018),at(.064,.123),at(-.054,.132),'#70533d',opacity,-1);
    }
  }
  function drawVehicleDamage(){
    for(const part of crashDebris){
      const z=runtime.origin+relativeDistance(runtime.origin,part.z);
      if(Math.abs(z-runtime.origin)>165) continue;
      const x=center(z)+part.x, y=part.y;
      const a=Math.cos(part.angle)*part.size, b=Math.sin(part.angle)*part.size;
      quad([x-a,y-b,z-part.size*.34],[x+a,y+b,z-part.size*.34],
        [x+a,y+b,z+part.size*.34],[x-a,y-b,z+part.size*.34],
        part.color,clamp((part.life-part.age)*3,0,1),.65);
    }
    for(const car of [state,...traffic]){
      const z=runtime.origin+relativeDistance(runtime.origin,car.z);
      if(Math.abs(z-runtime.origin)>165) continue;
      damageParticles(car,z,(x,y,z,radius,color,alpha)=>{
        if(alpha<.01) return;
        const tint=rgb(color),mid=[x,y,z];
        for(let i=0;i<8;i++){
          const a=i*TAU/8,b=(i+1)*TAU/8;
          const vertex=t=>[x+runtime.yawCos*Math.cos(t)*radius,y+Math.sin(t)*radius*.94,z-runtime.yawSin*Math.cos(t)*radius];
          point(mid,tint,alpha,-1);point(vertex(a),tint,0,-1);point(vertex(b),tint,0,-1);
        }
      });
    }
  }
  function draw() {
    if(gl.isContextLost()) return false;
    if(canvas.width!==runtime.w||canvas.height!==runtime.h){
      renderer.setSize(runtime.w,runtime.h,false);
      target.setSize(runtime.w,runtime.h);
    }
    const usePost=state.v>8&&runtime.graphics!==graphicsPresets.low;
    renderer.setRenderTarget(usePost?target:null);
    renderer.clear(true,true,false);
    // Điều chỉnh tỷ lệ phối cảnh theo góc ngắm của tiếp tuyến.
    uniforms.cameraYaw.value=[runtime.yawCos,runtime.yawSin];
    uniforms.cameraPitch.value=[runtime.pitchCos,runtime.pitchSin];
    uniforms.viewport.value=[runtime.w,runtime.h];uniforms.vanishing.value=[runtime.cx,runtime.horizon];
    uniforms.lens.value=runtime.focal;uniforms.altitude.value=runtime.eye;
    const drivingView=!foot.active&&state.camera<.24&&!state.wreck&&!wreckExpired(state);
    uniforms.clipOffset.value=drivingView?.07:.6;
    uniforms.roadPhase.value=mod(runtime.origin,LAMP);
    uniforms.mountainPassStart.value=runtime.passStart;
    const angle=carYaw(state), sin=Math.sin(angle), forwardZ=Math.cos(angle);
    const frontLamps=vehicleGlbPools[state.model]?.slots[0]?.lamps.filter(lamp=>lamp.front)??[];
    const front=frontLamps[0]?.center,other=frontLamps[1]?.center??front;
    const nose=front?(front.z+other.z)*.5:vehicleProfile(state.model).halfLength;
    const playerZ=runtime.origin+relativeDistance(runtime.origin,state.z);
    uniforms.headlampOrigin.value=[center(playerZ)+state.x-runtime.originX+nose*sin,playerZ-runtime.origin+nose*forwardZ];
    uniforms.headlampHeight.value=terrainHeight(playerZ,state.x)+(front?(front.y+other.y)*.5:.65);
    uniforms.headlampSpread.value=front?Math.abs(front.x-other.x)*.5:0;
    uniforms.headlampDirection.value=[wreckExpired(state)?0:sin,wreckExpired(state)?0:forwardZ];
    uniforms.daylight.value=world.daylight;
    uniforms.season.value=world.weather;
    uniforms.sunDirection.value=world.sun;
    uniforms.sunStrength.value=world.sunStrength;
    uniforms.waterTime.value=world.time;
    uniforms.textureDetail.value=runtime.graphics===graphicsPresets.highest?2:runtime.graphics===graphicsPresets.medium?1:0;
    uniforms.coastJoin.value=[runtime.coastStart,runtime.coastLandBefore,runtime.coastLandAfter];
    uniforms.worldOrigin.value=[runtime.originX,mod(runtime.origin,LOOP)];
    roadLamps=streetPower();
    uniforms.streetIntensity.value=roadLamps;
    uniforms.tunnelPhase.value=tunnelOffset(runtime.origin);
    uniforms.tunnelLength.value=TUNNEL_LENGTH;
    uniforms.fog.value=world.fog;
    uniforms.animatedTheme.value=Number(usesAnimatedTheme());
    uniforms.twilight.value=world.twilight;
    used=0;
    glbUsed=0;
    for(const pool of glbPools){
      pool.used=0;
      for(const slot of pool.slots) slot.wrapper.visible=false;
    }
    glbCarUniforms.uUsePost.value=usePost?1:0;
    glbSun.position.set(world.sun[0],Math.max(.25,world.sun[1]),world.sun[2]);
    glbSun.intensity=.75+world.sunStrength*1.2;
    glbAmbient.intensity=.18+world.daylight*.20;
    glbHemi.intensity=.28+world.daylight*.28;
    glbScene.environmentIntensity=.45+world.daylight*.50;
    shadowCasters.length=0;
    vehicleLights.length=0;
    transitionCabin=null;
    back=runtime.origin-runtime.graphics.road*clamp(1-runtime.yawCos,.06,1);
    forward=runtime.origin+runtime.graphics.road*clamp(1+runtime.yawCos,.06,1);
    uniforms.seaHorizon.value=distantSeaColor();
    uniforms.oceanRange.value=[back-runtime.origin,forward-runtime.origin];
    lampGlows.length=0;
    hillPlants.length=0;
    grassInstances.length=0;
    sceneryTrees.length=0;
    roadMesh();renderLocalRoads();drawCityBuildings();tunnels();landscapes();drawHillPlants();drawSceneryGrass();drawSceneryTrees();windFarm();chamLandmark();
    const glbSky={
      // Tạo biến thể kích thước theo từng cụm mây để đường viền ít lặp lại.
      drawCloud:(cx,cy,cz,cell)=>{
        const [width,height,depth]=modelMeters.cloud;
        const scale=.74+hash(cell+107)*.52;
        return placeGlbAligned(cloudPool,cx-runtime.originX,cy+12+passSample(cz,passHeights),cz-runtime.origin,
          hash(cell+7)*TAU,width*scale,height*(.80+hash(cell+211)*.40),depth*scale);
      },
      drawPlane:(px,py,pz,yaw,scale)=>placeGlbAligned(airlinerPool,px-runtime.originX,py,pz-runtime.origin,yaw,modelMeters.airliner*scale),
      // Gán pha riêng mỗi con để đàn không đập cánh đồng loạt.
      drawBird:(bx,by,bz,yaw,size,flap)=>{
        if(placeGlbAligned(birdPool,bx-runtime.originX,by+flap*.10*size,bz-runtime.origin,yaw,modelMeters.bird*size))
          birdPool.slots[birdPool.used-1].flap.value=flap;
      }
    };
    drawSkyTraffic3D(runtime.origin,runtime.originX,foot.active?foot.z:state.z,world.time,LOOP,state.started,glbSky);
    for(let z=Math.ceil((back-5)/LAMP)*LAMP;z<forward;z+=LAMP){
      const area=district(z);
      if(inTunnel(z)||(area!==0&&area!==4&&mod(z,4*LAMP)!==0)) continue;
      lightMesh(z,1);
      if(mod(z,2*LAMP)===0) lightMesh(z,-1);
    }
    for(let i=Math.ceil((back-30)/240);i*240+25<forward;i++){
      const z=i*240+25;
      if(i%2===0&&district(z)===0&&!inTunnel(z)) structure(z);
    }
    // Dùng cùng loại phương tiện với mô phỏng để mẫu xe, đèn và kích thước khớp nhau.
    for(const car of traffic){
      if(car===state) continue;
      const d=relativeDistance(runtime.origin,car.z);
      if(runtime.origin+d<back-6||runtime.origin+d>forward) continue;
      const takeover=runtime.vehicleTakeover;
      const driver=car.parked||takeover?.car===car&&takeover.mode==='take'&&takeover.elapsed>=.63?null:drivingLook(car);
      carMesh(runtime.origin+d,car,carYaw(car),driver);
    }
    const parkedDepth=relativeDistance(runtime.origin,state.z);
    const carZ=runtime.origin+parkedDepth;
    // Chỉ hiện vỏ xe khi camera đã lùi ra ngoài, tránh nhìn xuyên qua các lớp thân xe.
    const exteriorVisible=!wreckExpired(state)&&(foot.active?Math.abs(parkedDepth)<FAR:state.camera>=.48);
    for(const rider of sceneRiders()){
      const z=runtime.origin+relativeDistance(runtime.origin,rider.z);
      if(z>=back-6&&z<=forward) personMesh(rider,z,riderFallPose(rider));
    }
    if(exteriorVisible) carMesh(carZ,state,angle,foot.active?null:drivingLook(state),true);
    if(foot.active) personMesh(foot,foot.z,foot.fall,foot.firstPerson);
    drawBatch();
    if(glbUsed>0) renderer.render(glbScene,camera);
    // Vẽ ánh đèn sau vật thể đặc để thân xe và lan can che sáng đúng theo chiều sâu.
    used=0;
    drawSunShadows();
    if(roadLamps>0) for(const {vehicle,player} of vehicleLights)
      if(!player) trafficHeadlights(vehicle);
    for(const plane of skyFlightClock.planes) drawSkyContrail(quad,plane,world.time,foot.active?foot.z:state.z,LOOP);
    drawLampGlows();
    drawSandFootprints();
    drawVehicleDamage();
    drawBatch(true,false);
    if(usePost) finishEffects();
    return true;
  }
  // Chờ mọi lượt tải kết thúc để có thể dọn bộ dựng cảnh an toàn nếu một tệp lỗi.
  const assetsReady=Promise.allSettled(startupAssets);
  // Biên dịch shader của các model trước khi mở cảnh chơi.
  async function prepare(onCompile){
    const failed=(await assetsReady).find(result=>result.status==='rejected');
    if(failed) throw failed.reason;
    onCompile?.();
    await renderer.compileAsync(glbScene,camera);
    if(gl.isContextLost()) throw new Error('Mất kết nối WebGL khi chuẩn bị cảnh');
  }
  // Giải phóng GPU khi lượt khởi động thất bại và người chơi cần thử lại.
  function dispose(){
    target.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  }
  canvas.dataset.renderer='threejs';
  return {canvas,draw,prepare,dispose};
}
