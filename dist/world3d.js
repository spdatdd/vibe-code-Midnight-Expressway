'use strict';

// Three.js quản lý bộ đệm và lượt vẽ, còn shader giữ phép chiếu của game.
function createWorld3D() {
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
      return mix(22.0,185.0,join);
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
        *max(0.0,1.0-abs(lampOffset-0.66)/headWidth);
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
      if(terrainDetailReady&&textureDetail>0.0&&(gloss==6.0||gloss==7.0)&&depth<240.0){
        vec3 at=world+vec3(worldOrigin.x,0.0,worldOrigin.y);
        vec3 normal=abs(cross(dFdx(world),dFdy(world)));
        normal/=max(.000001,normal.x+normal.y+normal.z);
        vec3 weights=normal*normal;
        weights/=max(.000001,weights.x+weights.y+weights.z);
        vec3 tiles=texture(terrainDetail,at.zy*.22).rgb*weights.x
          +texture(terrainDetail,at.xz*.21).rgb*weights.y
          +texture(terrainDetail,at.xy*.22).rgb*weights.z;
        float slope=smoothstep(.22,.74,normal.y);
        float textureValue=gloss==7.0?mix(tiles.b,tiles.g,slope):mix(tiles.g,tiles.r,slope);
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
  new MidnightThree.TextureLoader().load('terrain/land-detail.webp',texture=>{
    texture.wrapS=texture.wrapT=MidnightThree.RepeatWrapping;
    texture.needsUpdate=true;
    uniforms.terrainDetail.value=texture;
    uniforms.terrainDetailReady.value=true;
  });
  const camera=new MidnightThree.Camera();
  const scene=new MidnightThree.Scene();
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
  function point(p,color,alpha,finish) {
    if(used+8>values.length){
      const next=new Float32Array(Math.ceil(values.length*1.5));
      next.set(values);values=next;
    }
    values[used++]=p[0]-originX;values[used++]=p[1]+passSample(p[2],passHeights);values[used++]=p[2]-origin;
    values[used++]=color[0];values[used++]=color[1];values[used++]=color[2];values[used++]=alpha;
    values[used++]=finish;
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
      &&Math.abs(z-origin)<160&&Math.abs(x-originX)<125
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
  function finishedProp(x,y,z,width,height,depth,palette,finish=0){
    if(y<.95&&Math.abs(z-origin)<145) markShadow(x,y,z,width,height,depth);
    loft(solidFace,x,z,[[y,width*.93,depth*.93],[y+height*.09,width,depth],
      [y+height*.86,width*.97,depth*.96],[y+height,width*.84,depth*.85]],palette,finish);
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
  function cityBlend(z){
    const progress=mod(z-cityStart,LOOP);
    const t=clamp(Math.min(progress,routeLengths[0]-progress)/155,0,1);
    return t*t*(3-2*t);
  }
  // Chọn màu nền và nội suy từ sườn hầm sang mặt đất khu phố.
  function groundTint(z,area=district(z)){
    if(area===0){
      const phase=mod(z-cityStart,LOOP);
      const boundary=cityStart+(phase<routeLengths[0]*.5?-.01:routeLengths[0]+.01);
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
    const near=Math.abs(mid-origin)<76;
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
        if(animated&&area===2&&mod(z+1.5-passStart,LOOP)>PASS_LENGTH*(723/900)){
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
      if(p>103&&p<283&&Math.abs(p-LOCAL_JUNCTION)>18&&mod(z,21)<3){
        const x=center(z)+a+side*8.1;
        const height=road.side===1?4.2+hash(z)*9:3.2;
        const variant=roadsideModels.houses[road.side===1?1:2];
        const mesh=Math.abs(z-origin)<100?variant.near:variant.far;
        sceneryMesh(mesh,x,-.18,z,5.4,height,8.7,a<0?Math.PI/2:-Math.PI/2);
        markShadow(x,-.18,z,5.4,height,8.7);
      }
    }
    for(const road of localRoads){
      const exit=origin+relativeDistance(origin,road.start+23);
      if(exit>=back&&exit<=forward){
        const post=center(exit)+road.side*10.6;
        box(post,-.15,exit,.14,4.8,.15,['#53647b','#364256','#768197']);
        box(post,3.9,exit,3.4,1.05,.16,['#32695e','#254d4d','#588b78']);
        const d=road.side;
        quad([post-d*.74,4.36,exit-.088],[post+d*.32,4.36,exit-.088],
          [post+d*.32,4.49,exit-.088],[post-d*.74,4.49,exit-.088],'#f0e6c8');
        quad([post+d*.26,4.17,exit-.089],[post+d*.72,4.42,exit-.089],
          [post+d*.26,4.68,exit-.089],[post+d*.26,4.68,exit-.089],'#f0e6c8');
      }
      const intersection=origin+relativeDistance(origin,road.start+LOCAL_JUNCTION);
      if(intersection<back-8||intersection>forward+8) continue;
      const x=localOffset(road,intersection),side=road.side;
      for(let i=-3;i<3;i++)
        roadStrip(intersection-3,intersection+3,x+i*.96,x+i*.96+.37,.033,.033,'#cccfda');
      roadStrip(intersection-5.2,intersection-4.92,x-3.05,x+3.05,.032,.032,'#e4e4e3');
      const post=center(intersection)+x-side*3.55;
      box(post,0,intersection,.14,4.2,.14,['#53647b','#3d4863','#728198']);
      box(post+side*1.42,3.92,intersection,2.8,.12,.12,['#53647b','#3d4863','#728198']);
      const lampX=post+side*2.62;
      box(lampX,3.23,intersection,.52,1.04,.25,['#242739','#141b2d','#586178']);
      const selected=localSignal(road);
      for(const [color,y,lit,dim] of [['red',4.05,'#ff4549','#683039'],['amber',3.76,'#ffd25e','#635235'],['green',3.47,'#62fcb6','#305747']]){
        quad([lampX-.16,y-.10,intersection-.137],[lampX+.16,y-.10,intersection-.137],
          [lampX+.16,y+.10,intersection-.137],[lampX-.16,y+.10,intersection-.137],color===selected?lit:dim,1,-1);
      }
    }
  }
  // Dựng thân cột, tay đỡ và chụp đèn với bề mặt đục.
  function lightMesh(z,side) {
    const x=center(z)+side*(6.72+exitWidth(z,side));
    const live=roadLamps>.05;
    const pole=['#70838b','#4a5f70','#adb7b5'];
    loft(solidFace,x,z,[[0,.23,.23],[.88,.192,.192],[6.08,.157,.157]],pole);
    seatLimb(quad,[x,6.00,z],[x-side*.48,6.41,z],.12,pole);
    seatLimb(quad,[x-side*.48,6.41,z],[x-side*1.42,6.43,z],.10,pole);
    loft(solidFace,x-side*1.42,z,[[6.31,.53,.31],[6.37,.69,.36],[6.49,.45,.23]],
      live?['#7fbdcb','#397fa1','#9ebcc6']:['#5f6b76','#42535e','#909e9f']);
    if(live){
      const bulb=x-side*1.42;
      quad([bulb-.23,6.302,z-.22],[bulb+.23,6.302,z-.22],
        [bulb+.23,6.302,z+.22],[bulb-.23,6.302,z+.22],'#a1efff',1,-1);
      lampGlows.push([bulb,6.28,z]);
    }
  }
  // Đặt quầng cyan và vệt lóe tại bóng đèn, để vật thể trước đèn che chúng theo chiều sâu.
  function drawLampGlows(){
    const haze=rgb('#279dff'), streak=rgb('#89ddff');
    for(const [x,y,z] of lampGlows){
      const depth=(x-originX)*yawSin+(z-origin)*yawCos;
      if(depth<2||depth>300) continue;
      const mid=[x-.25*yawSin,y,z-.25*yawCos];
      for(const [width,height,color,alpha] of [[1.22,.76,haze,.60],[1.68,.105,streak,.35]]){
        let previous=[mid[0]+yawCos*width,mid[1],mid[2]-yawSin*width];
        for(let i=1;i<=10;i++){
          const angle=i*TAU/10, right=Math.cos(angle)*width;
          const next=[mid[0]+yawCos*right,mid[1]+Math.sin(angle)*height,mid[2]-yawSin*right];
          point(mid,color,roadLamps*alpha,-1);
          point(previous,color,0,-1);
          point(next,color,0,-1);
          previous=next;
        }
      }
    }
  }
  // Dựng sàn cầu có mặt dưới, dầm chịu lực và biển chỉ đường có chiều dày.
  function structure(z,isBridge) {
    const x=center(z);
    const left=exitWidth(z,-1),right=exitWidth(z,1);
    const span=left+right,middle=x+(right-left)*.5;
    const concrete=['#727e83','#48575f','#a0a7a0'];
    for(const side of [-1,1]){
      const post=x+side*(7.7+exitWidth(z,side));
      if(isBridge) loft(solidFace,post,z,[[0,1.16,1.71],[.38,.93,1.48],[5.42,.76,1.15],[5.86,1.48,1.67]],concrete);
      else box(post,0,z,.21,5.85,.23,concrete);
    }
    if(isBridge){
      loft(solidFace,middle,z,[[5.72,31+span,4.78],[6.19,34+span,6.18],[6.59,34+span,6.20]],concrete);
      for(const dz of [-2.93,2.93]){
        box(middle,6.57,z+dz,33.9+span,.43,.13,concrete);
        box(middle,7.00,z+dz,33.9+span,.10,.18,['#83969b','#526771','#aeb9b8']);
      }
    }else{
      box(middle,5.6,z,15.4+span,.22,.24,concrete);
      box(x+1.75,4.86,z-.2,5.1,1.22,.15,['#256463','#183a43','#6caaa1']);
      // Các vệt sáng và mũi tên trên biển được đặt nổi phía trước mặt biển.
      for(const [dx,dy,width] of [[-.68,.78,2.56],[-.94,.53,2.04],[-1.23,.31,1.45]]){
        box(x+1.75+dx,4.86+dy,z-.29,width,.055,.015,['#b9ddd7','#b9ddd7','#b9ddd7']);
      }
      quad([x+3.25,5.44,z-.306],[x+2.8,5.11,z-.306],[x+3.7,5.11,z-.306],
        [x+3.42,5.11,z-.306],'#d3e7df');
      box(x+3.25,4.99,z-.30,.22,.20,.02,['#d3e7df','#d3e7df','#d3e7df']);
    }
  }
  // Dựng các khối nhà ven tuyến và mặt cửa sổ sáng có thị sai thực.
  function sceneryBounds(){
    return [origin-graphics.scenery*clamp(1-yawCos,.11,1),origin+graphics.scenery*clamp(1+yawCos,.11,1)];
  }
  function scenery() {
    const [nearZ,farZ]=sceneryBounds();
    const first=Math.floor((nearZ-34)/32);
    for(let i=first;i*32<farZ;i++){
      for(const side of [-1,1]){
        const seed=mod(i,LOOP/32)*13+side*17;
        const z=i*32+hash(seed+3)*12;
        if(district(z)!==0) continue;
        const x=center(z)+side*(25+hash(seed)*31+exitWidth(z,side));
        const style=sceneryAt(z).style;
        const width=style==='saigon'?9+hash(seed+8)*14:8+hash(seed+8)*9;
        const height=lerp(5.5,8+hash(seed+4)**1.3*(style==='saigon'?46:style==='hanoi'?29:18),cityBlend(z));
        if(!tallCityClear(z,x,width)) continue;
        const palettes=[['#435771','#303d57','#657b89'],['#837265','#595260','#aa9880'],
          ['#557473','#394e56','#7a9184'],['#77606b','#514253','#997e82']];
        const styleIndex=Math.floor(hash(seed+12)*palettes.length);
        const walls=palettes[styleIndex];
        const podium=styleIndex===2?Math.min(5,height*.25):0;
        const roof=height-.2;
        loft(solidFace,x,z,[[-.2,width,12],[roof*.68,width,12],[roof,width*.78,9.8]],walls,4);
        if(Math.abs(z-origin)>graphics.detail) continue;
        if(podium) finishedProp(x,-.2,z,width+.48,podium,12.4,walls,4);
        if(styleIndex===1) tileRoof(x,roof,z,width*.83,10.3,1.8);
        else{
          box(x,roof-.10,z,width*.80,.20,10.0,walls);
          if(styleIndex===0||hash(seed+1)>.68) box(x,roof+.10,z,width*.46,1.55,5,walls);
          if(styleIndex===0) box(x+width*.12,roof+1.65,z,.095,2.1,.095,walls);
        }
        const rich=graphics===graphicsPresets.highest&&Math.abs(z-origin)<190;
        for(let row=2.35;row<height-1.35;row+=2.5){
          const taper=clamp((row-roof*.68)/(roof*.32),0,1);
          const front=z-lerp(6,4.9,taper)-.023;
          for(let col=-width*.34;col<width*.35;col+=styleIndex===0?2.35:2.75){
            const light=hash(seed*19+row*17+col*10);
            const shade=world.daylight<.45&&light>.76?'#dcc29a':light>.65?'#86a0b1':'#43556d';
            const half=styleIndex===0?.81:.66,a=x+col-half,b=x+col+half;
            const tall=styleIndex===0?1.35:.95;
            const top=front+Math.max(0,row+tall-roof*.68)*1.1/(roof*.32)-taper*1.1;
            quad([a,row,front],[b,row,front],[b,row+tall,top],[a,row+tall,top],shade);
            if(rich&&styleIndex!==0&&light>.60)
              box(x+col,row-.2,front-.22,half*2+.24,.20,.54,walls);
          }
        }
      }
    }
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
  function mountainRidge(x,y,z,width,length,height,seed,palette){
    const form=Math.floor(hash(seed+56)*3);
    const detail=Math.abs(z-origin)<Math.min(graphics.detail,205);
    const sides=detail?(graphics===graphicsPresets.highest?22:16):10;
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
  }

  function tileRoof(x,y,z,width,length,rise){
    const l=x-width/2,r=x+width/2,a=z-length/2,b=z+length/2;
    const roof=[[l,y,a],[r,y,a],[r,y,b],[l,y,b]];
    const ridge=[[x,y+rise,a+length*.19],[x,y+rise,b-length*.19]];
    quad(roof[0],roof[1],ridge[0],ridge[0],'#a36350');
    quad(roof[1],roof[2],ridge[1],ridge[0],'#8b493c');
    quad(roof[2],roof[3],ridge[1],ridge[1],'#824c3d');
    quad(roof[3],roof[0],ridge[0],ridge[1],'#b16b51');
  }
  function sceneryMesh(model,x,y,z,width,height,depth,angle,palette,leanX=0,leanZ=0,finish=0){
    const cos=Math.cos(angle),sin=Math.sin(angle),positions=model.positions,vertices=[];
    for(let i=0;i<positions.length;i+=3){
      const a=positions[i]/1024,b=positions[i+1]/1024,c=positions[i+2]/1024;
      vertices.push([x+(a*cos+c*sin)*width+leanX*b*b,y+b*height,
        z+(c*cos-a*sin)*depth+leanZ*b*b]);
    }
    for(const [material,indices] of model.surfaces){
      const color=rgb(palette?.[material]??material);
      for(const i of indices) point(vertices[i],color,1,finish);
    }
  }
  function mountainAsset(model,x,y,z,width,height,depth,angle,palette,finish=6){
    const [stone,soil,crest=stone]=palette;
    sceneryMesh(model,x,y,z,width,height,depth,angle,{stone,soil,crest},0,0,finish);
  }
  function countryHouse(x,z,seed){
    const {width,depth}=countryHouseSize(seed),style=sceneryAt(z).style;
    const base=style==='delta'?.85:-.13,height=2.45+hash(seed+13)*.7;
    if(base>0) for(const side of [-1,1]) for(const end of [-1,1])
      finishedProp(x+side*width*.31,-.18,z+end*depth*.32,.28,1.1,.29,['#5a4938','#3e3830','#79624a']);
    const models=roadsideModels.houses,model=models[Math.floor(hash(seed+45)*models.length)];
    const angle=x>center(z)?-Math.PI/2:Math.PI/2;
    const mesh=Math.abs(z-origin)<graphics.house?model.near:model.far;
    sceneryMesh(mesh,x,base,z,width,height+1.5,depth,angle);
    markShadow(x,base,z,width,height+1,depth);
  }
  const treeHeights=[1,.9,1.20,1,1.09];
  const treeColors=[
    ['#385f43','#263f37','#648557'],['#507447','#3a5540','#83a15d'],
    ['#3d6955','#314c44','#6a936f'],['#738447','#505e3c','#9da95c'],
    ['#797149','#555339','#9a8f5c']
  ];
  function treeCrown(x,y,z,w,h,d,seed,palette,sides){
    const tint=palette.map(rgb);
    const rings=sides>6?[-.76,-.32,.32,.76]:[-.52,.52];
    const phase=hash(seed)*TAU;
    const layers=rings.map(level=>Array.from({length:sides},(_,i)=>{
      const a=phase+i*TAU/sides;
      const shape=.93+.07*Math.cos(a*3+phase);
      const radius=Math.sqrt(1-level*level)*shape;
      const light=.5+.5*Math.cos(a-.65);
      const p=[x+Math.cos(a)*w*radius+w*.065*level,y+h*level,z+Math.sin(a)*d*radius];
      const color=tint[0].map((c,k)=>lerp(lerp(tint[1][k],c,.43+light*.55),tint[2][k],Math.max(0,level)*.63));
      return {p,color};
    }));
    roundedRings(layers,{p:[x+w*.065,y+h,z],color:tint[2]},{p:[x-w*.065,y-h,z],color:tint[1]});
  }
  function foliage(x,z,seed,area,simple){
    const size=(area===6?4.1+hash(seed+4)*5:area===1?3.2+hash(seed+4)*3.8:2.4+hash(seed+4)*3.5);
    const form=hash(seed+47),type=form>.95?5:Math.floor(form*5);
    const sway=wind.strength*(.055+.035*Math.sin(mod(z,LOOP)*Math.PI/150-world.time*1.7))*Math.sqrt(size);
    const leanX=wind.x*sway,leanZ=wind.z*sway;
    const coastalPalm=area===3&&form<.28;
    const tint=treeColors[Math.floor(hash(seed+81)*(area===6?4:5))];
    const twist=hash(seed+67)*TAU;
    if(type!==5){
      const tree=roadsideModels.trees[coastalPalm?3:type===1||type===3?1:type===2||type===4?2:0];
      const height=coastalPalm?size+1.1:size*treeHeights[type];
      const [leaves,leafShade,leafLight]=coastalPalm?['#497959','#345c4c','#77a873']:tint;
      sceneryMesh(simple?tree.far:tree.near,x,-.18,z,height,height,height,twist,
        {bark:'#77614a',barkShade:'#554638',barkLight:'#9d825c',leaves,leafShade,leafLight},leanX,leanZ);
      return;
    }

    const scale=size*.86,cos=Math.cos(twist),sin=Math.sin(twist);
    const trunk=['#56483c','#3a3530','#745944'];
    const branchFace=(a,b,c,d,color)=>quad(a,b,c,d,color);
    const slant=(hash(seed+12)-.5)*.05;
    const at=(u,y,v)=>[x+scale*((u+slant*y)*cos-v*sin)+leanX*y,y*scale-.18,
      z+scale*((u+slant*y)*sin+v*cos)+leanZ*y];
    const fork=at(0,.42,0);
    seatLimb(branchFace,[x,-.18,z],fork,.26,trunk);
    seatLimb(branchFace,fork,at(0,.89,0),.17,trunk,!simple);
    for(let i=0;i<(simple?3:6);i++){
      const u=Math.cos(i*2.4)*.25,y=.57+i*.058,v=Math.sin(i*2.4)*.25;
      const p=at(u,y,v);
      seatLimb(branchFace,at(0,Math.max(.33,y-.26),0),p,.071,trunk);
      if(!simple) seatLimb(branchFace,p,at(u*.82,y+.17,v*1.3),.041,trunk);
    }
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
      for(let row=33;row<82;row+=Math.abs(at-origin)>205?10:5){
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
  function roadsideGroup(z,side,seed){
    const count=hash(seed+25)<.5?2:3;
    const x=side*13.2;
    const people=Array.from({length:count},(_,index)=>{
      const angle=index*TAU/count;
      const at=z+Math.cos(angle)*.87,px=center(z)+x+Math.sin(angle)*.87;
      return {at,px,angle:angle+Math.PI};
    });
    if(people.some(({at,px})=>!roadsidePlacement(at,px,.36,.32)
      ||solidScenery(at,px-center(at),.36))) return;
    people.forEach(({at,px,angle},index)=>{
      const offset=px-center(at);
      personMesh({x:offset,y:terrainHeight(at,offset),look:roadsideLook(seed+index*3),
        angle,grounded:true,moving:false,talking:mod(world.time*.54+index/count,1)<.29},at);
    });
  }
  function walkingDog(z,x,angle,phase,side,personY){
    const cos=Math.cos(angle),sin=Math.sin(angle),base=center(z)+x;
    const at=z-side*sin*.89+cos*.40,px=base+side*cos*.89+sin*.40;
    if(!roadsidePlacement(at,px,.41,.54)||solidScenery(at,px-center(at),.40)) return;
    const y=terrainHeight(at,px-center(at));
    const colors=['#a87850','#6c4a35','#bc8f61'];
    const point=([a,b,c])=>[px+a*cos+c*sin,y+b,at-a*sin+c*cos];
    const face=(a,b,c,d,color)=>quad(point(a),point(b),point(c),point(d),color);
    loft(face,0,0,[[.30,.17,.54],[.42,.28,.68],[.57,.25,.58,.011],[.60,.15,.43,.026]],colors);
    loft(face,0,.36,[[.43,.14,.195],[.53,.25,.26],[.65,.21,.19,-.027]],colors);
    loft(face,0,.485,[[.47,.095,.145],[.53,.152,.183],[.58,.101,.13,-.025]],
      ['#79543f','#533a34','#a87858']);
    const swing=Math.sin(phase*TAU)*.10;
    for(const side of [-1,1]){
      face([side*.045,.625,.31],[side*.124,.604,.30],[side*.126,.78,.24],[side*.126,.78,.24],colors[1]);
      for(const end of [-1,1]){
        const lift=.018+Math.max(0,side*end*swing);
        seatLimb(face,[side*.105,.37,end*.217],[side*.108,lift+.02,end*.225+side*end*swing],.078,colors);
      }
    }
    const wag=Math.sin(phase*TAU*2)*.10;
    seatLimb(face,[0,.49,-.29],[wag,.59,-.49],.067,colors);
    seatLimb(face,[wag,.59,-.49],[wag*1.45,.68,-.54],.046,colors);
    const hand=[base+side*cos*.28,personY+.88,z-side*sin*.28],collar=point([0,.53,.29]);
    quad(hand,collar,[collar[0],collar[1]+.025,collar[2]],[hand[0],hand[1]+.025,hand[2]],'#665b52');
  }
  function walker(z,side,seed){
    const phase=mod((world.time*(.86+hash(seed)*.31)+hash(seed+9)*12)*.155,TAU);
    const at=z+Math.sin(phase)*4;
    const x=side*10.6;
    if(!roadsidePlacement(at,center(at)+x,.52,.48)||solidScenery(at,x,.35)) return;
    const speed=Math.abs(Math.cos(phase));
    const angle=(Math.cos(phase)>=0?0:Math.PI)+Math.atan(slope(at));
    const stride=mod(Math.asin(Math.sin(phase))*4/1.22,1);
    const y=terrainHeight(at,x);
    personMesh({x,y,look:roadsideLook(seed),angle,grounded:true,moving:speed>.10,stride},at);
    if(hash(seed+22)<.64) walkingDog(at,x,angle,stride,side,y);
  }
  function grassTuft(z,x,seed,animated){
    for(let blade=0;blade<4;blade++){
      const angle=hash(seed)*TAU+blade*2.21;
      const cos=Math.cos(angle),sin=Math.sin(angle),height=.21+hash(seed+blade)*.33;
      const sway=height*wind.strength*(.49+.45*Math.sin(mod(z,LOOP)*Math.PI/25-world.time*2.6+blade*.65));
      const at=(t,w)=>[x+cos*t*.32-sin*w+wind.x*sway*t*t,-.17+height*(animated?1.35:1.17)*Math.sin(1.8*t),
        z+sin*t*.32+cos*w+wind.z*sway*t*t];
      quad(at(0,-.035),at(0,.026),at(.57,.031),at(.57,-.027),blade%2?'#728448':'#4b7048');
      quad(at(.57,-.027),at(.57,.031),at(1,0),at(1,0),blade%2?'#a3ab61':'#689365');
    }
  }
  // Cảnh xa đặt ngoài vùng lái. Mặt hồ giữ cao độ tuyệt đối khi đường xuống dốc.
  function mountainVista(){
    const pass=passStart+Math.round((origin-passStart)/LOOP)*LOOP;
    if(origin<pass+PASS_LENGTH*(310/900)||origin>pass+PASS_LENGTH+20) return;
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
      const colors=i%2?['#777289','#52516b','#a099a1']:['#666782','#464962','#9290a0'];
      box(x,base,z,width,height,6,colors,4);
      if(world.daylight<.55){
        for(let row=2.1;row<height-1;row+=3.2){
          const [a,b]=[x-width*.35,x+width*.35];
          quad([a,base+row,z-3.03],[b,base+row,z-3.03],
            [b,base+row+.40,z-3.03],[a,base+row+.40,z-3.03],
            row%2<1?'#c19269':'#f2c994',1,-1);
        }
      }
      if(sunset){
        const strip=lakeZ-53+i*6,span=5+hash(i+177)*19,offset=hash(i+65)*13;
        quad(atHeight(lakeX+offset-span,lakeHeight+.03,strip),atHeight(lakeX+offset+span,lakeHeight+.03,strip),
          atHeight(lakeX+offset+span*.85,lakeHeight+.03,strip+1.1),atHeight(lakeX+offset-span*.6,lakeHeight+.03,strip+1.1),'#b58a91',1,-1);
      }
    }
  }
  function streamOffset(z){
    const at=mod(z,LOOP);
    return -21+3.1*Math.sin(at*.034)+1.2*Math.sin(at*.10);
  }
  function mountainWaterfall(mist=false){
    const anchor=waterfallAnchor();
    const z=origin+relativeDistance(mod(origin,LOOP),anchor);
    if(z<back-28||z>forward+42) return;
    const x=center(z)-39,height=18.5;
    const profile=t=>{
      if(t<0) return [x+t*10.4,height-.85*t,z+.38*t*t];
      return [x+1.25*t+5.1*t*t,height-(height+.136)*t,z+.97*t-.58*Math.sin(t*Math.PI)];
    };
    const width=t=>1.23+.77*Math.max(t,0)+.19*Math.sin(t*Math.PI);
    const [footX,footY,footZ]=profile(1);
    if(mist){
      for(let i=0;i<10;i++){
        const t=mod(world.time*(.58+hash(i+559)*.35)+hash(i+570),1);
        const radius=.46+t*2.6,at=footZ+(hash(i+34)-.5)*3.8+t*1.8;
        const mid=[footX+t*3.4,.24+t*2.8,at];
        const edge=angle=>[mid[0]+Math.cos(angle)*radius*yawCos,
          mid[1]+Math.sin(angle)*radius*.68,mid[2]-Math.cos(angle)*radius*yawSin];
        const tint=rgb('#d7edf1');
        for(let j=0;j<6;j++){
          point(mid,tint,.18*(1-t),-1);
          point(edge(j*TAU/6),tint,0,-1);
          point(edge((j+1)*TAU/6),tint,0,-1);
        }
      }
      return;
    }
    // Mép nước là một đường đỉnh của sườn núi, từ hồ nguồn đến chân thác.
    const rows=[-1.55,-1.26,-.98,-.78,-.55,-.30,-.14,0,.075,.17,.28,.40,.53,.66,.78,.89,1,1.11];
    const cuts=[-9,-7.5,-6,-4.8,-3.6,-2.7,-1.9,-1.42,-1,-.36,.36,1,1.42,1.9,2.7,3.6,4.8,6,7.5,9];
    const sheet=(t,u)=>{
      const [a,y,b]=profile(t);
      return [a,y,b+u*width(t)];
    };
    const bank=(t,u)=>{
      const side=Math.sign(u),across=Math.abs(u);
      const reach=clamp((across-1)/8,0,1),bulge=Math.sin(Math.PI*reach)**1.15;
      const [a,y,b]=sheet(t,side);
      const lip=1-Math.exp(-(across-1)*1.5);
      const ridgePeak=side<0?-.94:-1.11;
      const ridge=10.0*Math.exp(-((t-ridgePeak)**2)/.087-((reach-.26)**2)/.071)*lip;
      const relief=bulge*(2.35+1.85*Math.sin((t+.62)*2.6+side*.7)
        +.42*Math.sin(reach*17+side*1.65+t*9));
      const landFalloff=reach**.93;
      const earth=lerp(y+ridge+relief+1.25*lip,-.18,landFalloff);
      const bottom=clamp(Math.max((t-1)/.11,(-1.26-t)/.29),0,1);
      return [a-(2.4*lip+20.5*reach**.91)*(1-.27*Math.sin(t*2.3)),
        lerp(earth,-.18,bottom),b+side*(reach*29+bulge*.85*Math.sin(t*7.2+side))];
    };
    const facePoint=(t,u)=>{
      if(Math.abs(u)>=1) return bank(t,u);
      const point=sheet(t,u);
      if(t<-.78) point[1]=bank(t,1)[1]+.20*Math.cos(u*Math.PI/2)*clamp((-.78-t)*4,0,1);
      if(t>1) point[1]=bank(t,1)[1];
      return point;
    };
    const earth=[rgb('#687063'),rgb('#7e8070'),rgb('#5c685a')];
    const tones=(p,u,t)=>{
      const weathered=.44+.22*Math.sin(p[1]*.47+p[2]*.24)+.14*Math.sin(t*18+u*2.1);
      const moss=clamp((Math.abs(u)-2.2)*.12,0,.72);
      return earth[0].map((c,i)=>lerp(lerp(c,earth[1][i],weathered),earth[2][i],moss));
    };
    for(let i=1;i<rows.length;i++){
      const a=rows[i-1],b=rows[i];
      for(let j=1;j<cuts.length;j++){
        const l=cuts[j-1],r=cuts[j];
        const water=l>=-1&&r<=1&&a>=-.78&&b<=1;
        const cell=[[a,l],[a,r],[b,r],[b,l]];
        if(water){
          const tint=j===10?'#8bbcc4':j===11?'#9ccbd0':'#7daeb8';
          quad(...cell.map(([t,u])=>sheet(t,u)),a<0?'#659da8':tint,1,-1);
        }else{
          const vertices=cell.map(([t,u])=>{
            const p=facePoint(t,u);
            return [p,tones(p,u,t),1,7];
          });
          for(const k of [0,1,2,0,2,3]) point(...vertices[k]);
        }
      }
    }
    const textureRange=Math.abs(z-origin)<graphics.detail;
    if(textureRange) for(const [t,u,span,high] of [[-.06,-3.1,2.95,2.25],[.18,2.35,1.83,1.80],
      [.51,-2.72,1.92,1.47],[.82,2.75,2.31,1.45],[.94,-3.53,2.48,1.80]]){
      const [a,y,b]=bank(t,u);
      mountainAsset(terrainModels.boulder,a-1.43,y-high*.79,b,span,high,span*.67,t*4,
        ['#72796a','#697468'],7);
    }
    // Nội suy vệt nước theo cùng các hàng lưới để vệt luôn nằm trên mặt thác.
    function foamPoint(t,u){
      const next=rows.findIndex(row=>row>=t);
      const high=rows[next],low=rows[next-1];
      const a=sheet(low,u),b=sheet(high,u),f=(t-low)/(high-low);
      return [lerp(a[0],b[0],f)+.026,lerp(a[1],b[1],f)+.028,lerp(a[2],b[2],f)];
    }
    for(let i=0;i<18;i++){
      const a=mod(world.time*(.54+hash(i+103)*.35)+hash(i+288),1);
      const b=Math.min(1,a+.056+hash(i+73)*.09),u=(hash(i+321)-.5)*1.78;
      const ticks=[a,...rows.filter(t=>t>a&&t<b),b];
      for(let k=1;k<ticks.length;k++){
        const from=ticks[k-1],to=ticks[k];
        quad(foamPoint(from,u),foamPoint(from,u+.052),foamPoint(to,u+.062),foamPoint(to,u),'#c2e0e2',1,-1);
      }
    }
    // Đầu máng dưới trùng mép chân thác; đầu còn lại hòa vào lòng suối.
    const outflow=(t,u)=>{
      const across=width(1)+.56*Math.sin(t*Math.PI);
      const at=footZ+u*across+t*1.5;
      const streamX=center(at)+streamOffset(at)-.38;
      return [lerp(footX,streamX,t),lerp(footY,-.138,t),at];
    };
    const startTint=rgb('#89bdc2'),endTint=rgb('#376e81');
    const vertex=(t,u)=>{
      const color=startTint.map((channel,i)=>lerp(channel,endTint[i],t));
      point(outflow(t,u),color,1,-1);
    };
    for(let i=0;i<8;i++){
      const a=i/8,b=(i+1)/8;
      vertex(a,-1);vertex(a,1);vertex(b,1);
      vertex(a,-1);vertex(b,1);vertex(b,-1);
    }
    for(let i=0;i<7;i++){
      const t=mod(world.time*1.35+hash(i+200),1),end=Math.min(1,t+.075);
      const u=(hash(i+73)-.5)*1.65;
      const foam=(t,u)=>{const point=outflow(t,u);point[1]+=.012;return point;};
      quad(foam(t,u),foam(t,u+.12),foam(end,u+.18),foam(end,u+.045),'#bbdce0',1,-1);
    }
  }
  function stream(z){
    const offset=streamOffset;
    for(let at=z-4;at<z+12;at+=4){
      if(district(at+2)!==2) continue;
      const left=offset(at),right=offset(at+4);
      taper(at,at+4,left-3.0,left+3.0,right-3.0,right+3.0,-.168,'#716d59');
      taper(at,at+4,left-2.4,left+2.4,right-2.4,right+2.4,-.15,'#2a6273',-5);
    }
    const wave=z+mod(world.time*2+z,11);
    if(district(wave)===2) roadStrip(wave,wave+.38,offset(wave)-1.4,offset(wave)+1.45,-.143,-.143,'#649399');
  }
  function boat(z,area,seed){
    const phase=world.time*.094+hash(seed)*TAU;
    const at=z+(area===4?0:Math.sin(phase)*22);
    if(district(at)!==area||district(z-26)!==area||district(z+26)!==area) return;
    const crossing=area===4;
    const offshore=Math.max(39,coastShore(at).edge+14)+hash(seed+2)*25;
    if(!crossing&&offshore>165) return;
    const x=center(at)+(crossing?Math.sin(phase)*40:offshore);
    const worldZ=mod(at,LOOP), time=world.time;
    const phaseA=x*.52+worldZ*.14137167+time*1.36;
    const phaseB=x*.28-worldZ*.17933258+time*.91;
    const phaseC=x*.94+worldZ*.35866516+time*1.96;
    const water=(crossing?-3.1:-.66)+.29*Math.sin(phaseA)+.17*Math.sin(phaseB)
      +.074*Math.sin(phaseC)+.035*Math.sin(phaseA*2);
    const y=water+.035;
    const heading=Math.cos(phase)>0?1:-1;
    // Trên vịnh, tàu thấp đi ngang dưới mặt cầu và giữa các trụ.
    const p=(side,height,along)=>crossing
      ?[x+along*heading,y+height,at+side]
      :[x+side,y+height,at+along*heading];
    // Kích thước theo mét: thúng 2,3 m, ghe cá 8,5 m, tàu du lịch 18 m.
    const kind=crossing?1:Math.floor(hash(seed+18)*3);
    if(kind===0){
      for(let i=0;i<12;i++){
        const a=i*TAU/12,b=(i+1)*TAU/12;
        const ring=(theta,r,height)=>p(Math.cos(theta)*r,height,Math.sin(theta)*r);
        quad(ring(a,.50,-.27),ring(b,.50,-.27),ring(b,1.06,.13),ring(a,1.06,.13),i%2?'#9e7750':'#b38a59');
        quad(ring(a,1.06,.13),ring(b,1.06,.13),ring(b,1.15,.35),ring(a,1.15,.35),'#685342');
        quad(ring(a,1.15,.35),ring(b,1.15,.35),p(0,.02,0),p(0,.02,0),'#77583d');
      }
      box(...p(0,.08,0),1.3,.11,.20,['#a98158','#7e5d47','#b68f66']);
      return;
    }
    const ferry=kind===2,length=ferry?18:8.5,width=ferry?4.7:2.8;
    const bow=length*.5,stern=-bow,beam=width*.5,deck=ferry?.95:.43;
    const colors=ferry?['#235565','#297282','#d4d6ce']:['#864b49','#a15d50','#b1b5b3'];
    const a=p(-beam*.82,deck,stern),b=p(beam*.82,deck,stern),nose=p(0,deck+.32,bow);
    const port=p(-beam,deck,bow*.56),starboard=p(beam,deck,bow*.56);
    quad(a,b,starboard,port,colors[2]);quad(port,starboard,nose,nose,colors[2]);
    for(const side of [-1,1]){
      const shell=(rim,back,low)=>p(side*beam*rim,low,back);
      quad(shell(.82,stern,deck),shell(1,bow*.56,deck),shell(.93,bow*.49,deck-.18),shell(.77,stern,deck-.18),colors[1]);
      quad(shell(.77,stern,deck-.18),shell(.93,bow*.49,deck-.18),shell(.62,bow*.45,-.40),shell(.64,stern,-.40),colors[0]);
      quad(shell(1,bow*.56,deck),nose,p(0,-.40,bow*.87),shell(.62,bow*.45,-.40),colors[1]);
    }
    quad(a,b,p(beam*.64,-.40,stern),p(-beam*.64,-.40,stern),colors[0]);
    const boatFace=(a,b,c,d,tint)=>quad(p(...a),p(...b),p(...c),p(...d),tint);
    const roof=['#a9bab9','#74929e','#e0ddd1'];
    const cabinHeight=ferry?1.85:.87,cabinDepth=ferry?7.5:2.45;
    loft(boatFace,0,-.70,[[deck,width*.68,cabinDepth],[deck+cabinHeight*.45,width*.67,cabinDepth],
      [deck+cabinHeight,width*.57,cabinDepth*.74,-.16]],roof);
    if(ferry){
      box(...p(0,deck+1.85,-.85),3.48,.20,8.4,roof);
      for(const side of [-1,1]) for(let i=-3;i<=2;i++){
        const window=p(side*(width*.335+.015),deck+.78,i*1.04);
        box(...window,.035,.67,.69,['#446577','#345368','#7693a0']);
      }
      loft(boatFace,0,-1.20,[[deck+2.05,2.32,3.5],[deck+2.83,2.16,3.3],[deck+3.43,1.81,2.5,-.19]],roof);
    }
    if(Math.abs(at-origin)<230){
      box(...p(0,deck+(ferry?3.43:.87),-.85),.1,crossing?.68:1.38,.1,roof);
      seatLimb(boatFace,[-beam*.56,deck+.32,bow*.68],[beam*.56,deck+.32,bow*.68],.045,roof);
      for(const side of [-1,1]){
        seatLimb(boatFace,[side*beam*.79,deck,0],[side*beam*.79,deck+.33,0],.05,roof);
        seatLimb(boatFace,[side*beam*.79,deck+.33,0],[side*beam*.56,deck+.33,bow*.68],.045,roof);
      }
      const surface=water+.018-y;
      quad(p(-.35,surface,stern-.5),p(.35,surface,stern-.5),p(beam,surface,stern-9),p(-beam,surface,stern-9),'#487586');
    }
  }
  // Bố trí cây thấp giữa các cụm nhà đầu phố để nối cảnh với vùng ngoài đô thị.
  function cityApproachTrees(z,seed){
    const phase=mod(z-cityStart,LOOP);
    if(cityBlend(z)>.72||phase<30||phase>routeLengths[0]-30) return;
    for(const side of [-1,1]){
      const x=center(z)+side*(9.1+exitWidth(z,side)+hash(seed+side)*2.3);
      if(roadsidePlacement(z,x,1.3))
        foliage(x,z,seed+side,1,Math.abs(z-origin)>graphics.tree);
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
        if(i%2===0) cityApproachTrees(z,seed);
        if(Math.abs(z-origin)<130&&i%7===0) roadsideGroup(z,i%2===0?-1:1,seed);
        continue;
      }
      if(area===5) continue;
      const mid=center(z),far=Math.abs(z-origin)>graphics.road;
      if(far&&(area===1||area===4)) continue;
      if(!far&&area===3&&i%8===0) boat(z,area,seed);
      if(area===4&&i%8===2) boat(z,area,seed);
      if(!far&&area===2) stream(z);
      if(Math.abs(z-origin)<155&&i%5===0&&(area===1||area===3)){
        const side=area===3||i%2===0?-1:1;
        if(i%10===0) walker(z,side,seed);
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
          foliage(x,z,n,area,far||Math.abs(z-origin)>graphics.tree);
        }
        if(Math.abs(z-origin)<graphics.detail||area===6&&!far)
          eachExtraTree(z,side,n,area,(at,treeX,treeSeed)=>foliage(treeX,at,treeSeed,area,Math.abs(at-origin)>graphics.extraTree));
        if(!far&&area===1) field(z,side,n);
        if(Math.abs(z-origin)<graphics.grassRange&&(area===1||area===2||area===6||area===3&&graphics===graphicsPresets.highest)){
          for(let tuft=0;tuft<graphics.grass;tuft++){
            const at=z+tuft*2.4,grassX=center(at)+side*(7.6+hash(n+tuft)*(tuft>2?7:2));
            if(Math.hypot(grassX-x,at-z)>(house?5:2.2)&&roadsidePlacement(at,grassX,.40,.30))
              grassTuft(at,grassX,n+tuft,animated);
          }
        }
        if(graphics===graphicsPresets.highest&&Math.abs(z-origin)<graphics.detail&&i%3===1){
          const at=z+7,detailX=center(at)+side*(11+hash(n+8)*5);
          if(roadsidePlacement(at,detailX,.58,.48)){
            if(i%2===0) treeCrown(detailX,-.055,at,.52,.32,.44,n,['#626a70','#454c58','#92999b'],8);
            else grassTuft(at,detailX,n+43,animated);
          }
        }
        if(!far&&area===2&&i%3===1&&side===-1){
          const rock=center(z)-26+hash(n)*2;
          if(Math.abs(rock-x)>3&&roadsidePlacement(z,rock,1.65))
            treeCrown(rock,.16,z,1.5,.53,1.9,n,['#777e77','#555d60','#888d85'],Math.abs(z-origin)<165?9:6);
        }
      }
    }
  }
  // Thêm cụm nhà thấp, tháp kỹ thuật và nhà ga với các mặt vuông tô phẳng.
  function streetDistricts() {
    const [nearZ,farZ]=sceneryBounds();
    const first=Math.floor((nearZ-28)/46);
    for(let i=first;i*46<farZ;i++){
      const z=i*46+12;
      if(district(z)!==0) continue;
      for(const side of [-1,1]){
        const seed=mod(Math.round(z),LOOP)+side*19;
        const x=center(z)+side*(14+hash(seed)*8+exitWidth(z,side));
        if(!roadsidePlacement(z,x,4.35,6.5)) continue;
        const height=3.7+hash(seed+4)*lerp(2.8,9,cityBlend(z));
        const style=sceneryAt(z).style;
        const plaster=style==='hue'?['#b89d70','#8f7458','#c9ae83']:style==='hanoi'?['#ae9581','#816e63','#baaa92']:['#8e9b9a','#61737c','#a4aaa0'];
        const base=-.17,top=base+height;
        loft(solidFace,x,z,[[base,8.6,13],[base+height*.72,8.6,13],[top-.18,8.15,12.9],[top,8.15,12.8]],plaster);
        if(style!=='saigon') tileRoof(x,height-.17,z,9.4,13.6,1.12);
        if(Math.abs(z-origin)>245) continue;
        if(Math.abs(z-origin)<130){
          box(x,.06,z-6.53,1.7,2,.08,['#466d66','#37514e','#758878']);
          loft(solidFace,x,z-6.51,[[2.26,5.7,.96],[2.45,5.62,1.04],[2.78,5.1,.61]],
            ['#587d79','#3c5a62','#8fa29a']);
        }
        if(style==='saigon') box(x,height-.18,z,8.9,.26,13.3,['#728b90','#506772','#91a4a6']);
        const window='#6886a4';
        for(let row=1.1;row<height-.5;row+=1.65){
          for(const off of [-2.5,-.8,.9,2.6]){
            if(hash(seed+row*18+off*9)<.23) continue;
            quad([x+off,row,z-6.52],[x+off+.92,row,z-6.52],[x+off+.92,row+.68,z-6.52],[x+off,row+.68,z-6.52],window);
            if(Math.abs(z-origin)<115) box(x+off+.45,row-.10,z-6.58,1.05,.09,.13,plaster);
          }
        }
        if(i%5===0&&cityBlend(z)>.65){
          loft(solidFace,x+side*7,z-7,[[-.03,2.9,2.9],[10.2,1.8,1.8],[11.72,3.76,3.76],
            [13.7,3.9,3.9],[14.12,3.24,3.24]],['#4e6575','#36465c','#84978f']);
        }
      }
    }
  }
  // Dựng hầm theo đường cong với vách, mái và viền gia cường ở hai cửa.
  function windFarm(){
    const nearest=origin+relativeDistance(mod(origin,LOOP),coastStart);
    for(let i=0;i<14;i++){
      const row=i%2,z=nearest+126+Math.floor(i/2)*148+row*64;
      if(z<back-115||z>forward+185) continue;
      const x=center(z)+coastShore(z).edge+245+row*113;
      const height=80;
      const steel=['#dce5e5','#929fae','#f3eee8'];
      loft(solidFace,x,z,[[-1,8.1,8.6],[.42,7.8,8.1],[1.4,6.2,6.8]],['#a4a89f','#727e80','#c1c4b7']);
      const pivot=[x-3.50,height,z];
      for(let face=0;face<8;face++){
        const a=face*TAU/8,b=(face+1)*TAU/8;
        const at=(angle,y,r)=>[x+Math.cos(angle)*r,y,z+Math.sin(angle)*r];
        quad(at(a,1.2,2.12),at(b,1.2,2.12),at(b,35,1.62),at(a,35,1.62),steel[face%3]);
        quad(at(a,35,1.62),at(b,35,1.62),at(b,height,.95),at(a,height,.95),steel[face%3]);
      }
      loft(solidFace,x,z,[[height-1.45,5.55,2.25],[height-.68,6.6,2.85],
        [height+1.18,6.45,2.79],[height+1.45,5.27,2.36]],steel);
      const spin=world.time*(.56+row*.11)+hash(i+118)*TAU;
      for(let blade=0;blade<3;blade++){
        const angle=spin+blade*TAU/3;
        const spoke=(r,w,edge=0)=>[pivot[0]+edge+.36*r/42,height+Math.cos(angle)*r-Math.sin(angle)*w,
          z+Math.sin(angle)*r+Math.cos(angle)*w];
        const tip=42;
        quad(spoke(.65,-.52),spoke(9,-.81),spoke(9,1.61,.22),spoke(.65,.67,.20),'#e7e9e2');
        quad(spoke(9,-.81),spoke(34,-.36),spoke(34,.47,.13),spoke(9,1.61,.22),'#d2e1e0');
        quad(spoke(34,-.36),spoke(tip-.22,-.095),spoke(tip,.08),spoke(34,.47,.13),'#b86757');
      }
      finishedProp(pivot[0],height-.91,z,1.76,1.82,1.79,steel);
      if(world.daylight<.47&&mod(world.time+i*.21,1.65)<.29){
        const glow='#ff6961';
        quad([x-.5,height+1,z-.6],[x-.5,height+1,z+.6],[x-.5,height+1.85,z+.6],[x-.5,height+1.85,z-.6],glow,1,-1);
      }
    }
  }
  function chamLandmark(){
    const z=origin+relativeDistance(mod(origin,LOOP),chamStart),x=center(z);
    if(z<back-100||z>forward+110) return;
    const stone=['#b79b7b','#827260','#c8ad91'];
    const brick=['#a65743','#703b37','#cc7957'];
    const face=quad;
    mountainRidge(x-75,-.18,z,28,40,13,129,['#67764f','#49583d','#89905d']);
    loft(solidFace,x-43,z,[[-.16,34,76],[.04,34,76],[.37,33.4,75.4]],stone,4);
    for(const offset of [-82,-60,55,77]){
      const at=z+offset,side=center(at)-16;
      box(side,-.17,at,3.2,.27,2.8,stone,4);
      beveledBox(face,side,.10,at,1.48,1.92,1.47,brick[0],brick[1],brick[2],4);
      beveledBox(face,side,1.98,at,1.71,.42,1.69,brick[2],brick[1],brick[2],4);
    }
    for(let step=0;step<5;step++) box(x-22-step*.90,-.17,z,1.2,.07+step*.085,7.1,stone,4);
    const tower=(at,depth,size,height)=>{
      const y=.37;
      loft(face,at,depth,[[y,size,size],[y+height*.09,size,size],
        [y+height*.15,size*.94,size*.94],[y+height*.45,size,size],[y+height*.51,size,size]],brick,4);
      for(let i=0;i<4;i++){
        const band=y+height*(.51+i*.098),width=size*(1-i*.21);
        loft(face,at,depth,[[band,width,width],[band+height*.026,width,width],
          [band+height*.098,width*.81,width*.81]],brick,4);
        const trimWidth=width*.995;
        loft(face,at,depth,[[band+height*.019,trimWidth,trimWidth],[band+height*.026,width*1.01,width*1.01]],
          ['#875044','#683c3b','#c98563'],4);
      }
      loft(face,at,depth,[[y+height*.894,size*.29,size*.29],[y+height*.95,size*.22,size*.22],
        [y+height,size*.085,size*.085]],brick,4);
      // Hốc vòm và gờ gạch phía quay về mặt đường.
      const wall=at+size*.5+.014;
      const sill=.39,arch=height*.285,half=size*.105;
      quad([wall,sill,depth-half],[wall,sill,depth+half],[wall,arch,depth+half],[wall,arch,depth-half],'#412b30',1,-1);
      for(let i=0;i<6;i++){
        const a=i*Math.PI/6,b=(i+1)*Math.PI/6;
        quad([wall,arch,depth],[wall,arch+Math.sin(a)*half,depth+Math.cos(a)*half],
          [wall,arch+Math.sin(b)*half,depth+Math.cos(b)*half],[wall,arch,depth],'#412b30',1,-1);
      }
      for(const side of [-1,1]){
        finishedProp(wall,.37,depth+side*size*.29,.29,height*.49,.42,brick,4);
        const trim=depth+side*half*1.21;
        box(wall+.023,sill,trim,.18,arch-sill,.17,brick,4);
      }
    };
    tower(x-43,z,11,22);
    tower(x-42,z-17,8,15);
    tower(x-48,z+20,7,13);
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
    const first=Math.floor((back-tunnelStart-TUNNEL_LENGTH)/LOOP);
    for(let start=first*LOOP+tunnelStart;start<forward;start+=LOOP){
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

  // Dựng khối hộp trong hệ trục thân xe để vẽ cabin, thùng và các chi tiết nhỏ.
  function vehicleBox(face,x,y,z,width,height,length,paint,side,top,finish=0){
    const l=x-width*.5,r=x+width*.5,n=z-length*.5,f=z+length*.5,t=y+height;
    const a=[l,y,n],b=[r,y,n],c=[r,y,f],d=[l,y,f];
    const A=[l,t,n],B=[r,t,n],C=[r,t,f],D=[l,t,f];
    face(a,b,B,A,paint,finish);face(b,c,C,B,side,finish);
    face(c,d,D,C,paint,finish);face(d,a,A,D,side,finish);
    face(A,B,C,D,top,finish);face(d,c,b,a,side,finish);
  }
  function beveledBox(face,x,y,z,width,height,length,paint,side,top,finish=0){
    const w=width*.5,d=length*.5,r=Math.min(width,height,length)*.15;
    const ring=(level,inset)=>{
      const a=w-inset,b=d-inset,cut=r-inset*.7;
      return [[-a+cut,-b],[a-cut,-b],[a,-b+cut],[a,b-cut],[a-cut,b],[-a+cut,b],[-a,b-cut],[-a,-b+cut]]
        .map(([u,v])=>[x+u,level,z+v]);
    };
    const foot=ring(y,r*.55),low=ring(y+r,0),high=ring(y+height-r,0),cap=ring(y+height,r*.65);
    for(let i=0;i<8;i++){
      const j=(i+1)%8,color=i%4===0?paint:side;
      face(foot[i],foot[j],low[j],low[i],side,finish);
      face(low[i],low[j],high[j],high[i],color,finish);
      face(high[i],high[j],cap[j],cap[i],top,finish);
      face(cap[i],[x,y+height,z],cap[j],cap[j],top,finish);
      face(foot[i],foot[j],[x,y,z],foot[i],side,finish);
    }
  }
  // Dựng bánh xe dạng đa giác với mặt lốp, hông và moay-ơ.
  function vehicleWheel(face,x,axle,radius,width,near,travel){
    const count=near?12:8,l=x-width*.5,r=x+width*.5;
    for(let i=0;i<count;i++){
      const a=TAU*i/count,b=TAU*(i+1)/count;
      const y0=radius*(1+Math.sin(a)),y1=radius*(1+Math.sin(b));
      const z0=axle+radius*Math.cos(a),z1=axle+radius*Math.cos(b);
      face([l,y0,z0],[r,y0,z0],[r,y1,z1],[l,y1,z1],i%2?'#1c2130':'#141925');
      for(const edge of [l,r]){
        if(!near){
          face([edge,radius,axle],[edge,y0,z0],[edge,y1,z1],[edge,radius,axle],'#293241');
          continue;
        }
        const tire=(t,spread,at=edge)=>[at,radius+Math.sin(t)*radius*spread,axle+Math.cos(t)*radius*spread];
        face(tire(a,.58),[edge,y0,z0],[edge,y1,z1],tire(b,.58),i%2?'#303648':'#21283a');
        face([edge,radius,axle],tire(a,.59),tire(b,.59),[edge,radius,axle],'#4a566a');
        const rim=edge+Math.sign(edge-x)*.005;
        const spoke=a+travel/radius;
        face(tire(spoke,.19,rim),tire(spoke-.12,.54,rim),tire(spoke+.13,.54,rim),tire(spoke+.25,.19,rim),'#b6bdc2');
      }
    }
  }
  // Vẽ xe tải thùng kín, có cabin tách biệt, kính tối và đèn định vị.
  function truckMesh(face,paint,braking,near,travel,takeover,p,alpha){
    const n=-3.6,f=3.6;
    vehicleBox(face,0,.44,0,1.9,.29,6.97,'#2b3245','#252d3e','#49526a');
    loft(face,0,-1.39,[[.78,2.26,4.29],[.93,2.42,4.32],[2.76,2.42,4.32],[3.05,2.21,4.12]],
      [paint,'#566779','#a5b4b8'],.33);
    const openSide=takeover?.side??0;
    const cabFace=(a,b,c,d,color,finish)=>{
      if(openSide&&[a,b,c,d].every(point=>Math.abs(point[0]-openSide*1.125)<.0001)){
        const side=openSide,x=side*1.125;
        const panel=(from,to,y,top)=>face([x,y,from],[x,y,to],[x,top,to],[x,top,from],'#485771',.64);
        panel(1.269,1.65,.979,2.371);panel(3.14,3.231,.979,2.371);
        const hinge=[x,.979,3.14],rear=[x,.979,1.65],belt=1.78,top=2.371;
        const window=[[x,belt,1.65],[x,belt,3.14],[x,top,3.14],[x,top,1.65]];
        const glass=(vertices,tint,opacity)=>queueGlass(...vertices.map(p),alpha*opacity,tint);
        const recess=side*1.01;
        face([recess,.979,1.65],[recess,.979,3.14],[recess,top,3.14],[recess,top,1.65],'#283141');
        swingingDoor(face,glass,side,takeover.door,[rear,hinge,window[1],window[0]],window,'#75839d',1,point=>{takeover.grip=p(point);});
      }else face(a,b,c,d,color,finish);
    };
    beveledBox(cabFace,0,.68,2.25,2.25,1.99,2.58,'#75839d','#485771','#a5b3c5',.64);
    face([-1.02,1.77,f-.046],[1.02,1.77,f-.046],[.95,2.47,f-.046],[-.95,2.47,f-.046],'#27334e',.88);
    face([-.94,2.391,f-.043],[.94,2.391,f-.043],[.954,2.462,f-.043],[-.954,2.462,f-.043],'#465b79',.65);
    loft(face,0,f-.092,[[1.018,1.50,.17],[1.18,1.66,.22],[1.51,1.46,.17]],['#252b37','#4c5665','#7d8a95']);
    for(const height of [1.16,1.28,1.40]) face([-.58,height,f+.021],[.58,height,f+.021],
      [.56,height+.039,f+.021],[-.56,height+.039,f+.021],'#9da9ae');
    loft(face,0,2.19,[[2.47,2.10,2.25],[2.62,1.98,2.19],[2.69,1.64,1.85,-.07]],
      ['#78878d','#556d78','#aebbbc'],.38);
    for(const side of [-1,1]){
      const x=side*1.128;
      if(side!==openSide) face([x,1.79,1.91],[x,1.79,3.34],[x,2.46,3.38],[x,2.46,2.04],'#26334a',.76);
      face([side*.64,1.07,f-.049],[side*1.03,1.07,f-.049],[side*1.03,1.29,f-.049],[side*.64,1.29,f-.049],'#edf8ff',-1);
      face([side*.65,.57,n],[side*1.18,.57,n],[side*1.18,.78,n],[side*.65,.78,n],braking?'#ff5d41':'#ec2332',-1);
      face([side*.68,2.87,n],[side*1.15,2.87,n],[side*1.15,2.96,n],[side*.68,2.96,n],'#e59b59',-1);
      for(const axle of [-2.37,2.51]) vehicleWheel(face,side*.985,axle,.448,.39,near,travel);
    }
    face([-.032,.81,n], [.032,.81,n],[.032,3,n],[-.032,3,n],'#454b65');
    for(const side of [-1,1]){
      const x=side*.89;
      face([x-.20,.88,n+.043],[x+.20,.88,n+.043],[x+.16,2.73,n+.043],[x-.16,2.73,n+.043],'#768894');
      face([side*1.211,1.14,-3.35],[side*1.211,1.29,-.15],[side*1.211,1.42,-.15],[side*1.211,1.29,-3.35],'#91a8a6');
    }
    face([-.25,.524,n-.011],[.25,.524,n-.011],[.25,.65,n-.011],[-.25,.65,n-.011],'#98a8bf');
  }
  // Vẽ mô tô thân hẹp, hai bánh thẳng hàng và người đội mũ ngồi ngoài xe.
  function seatLimb(face,a,b,width,palette,rounded=false){
    const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],length=Math.hypot(dx,dy,dz);
    if(length<.001) return;
    const axis=[dx/length,dy/length,dz/length];
    const norm=Math.hypot(axis[1],axis[2]);
    const right=norm>.001?[0,axis[2]/norm,-axis[1]/norm]:[0,1,0];
    const out=[axis[1]*right[2]-axis[2]*right[1],axis[2]*right[0]-axis[0]*right[2],axis[0]*right[1]-axis[1]*right[0]];
    const p=([x,y,z])=>a.map((coordinate,k)=>coordinate+x*right[k]+y*axis[k]+z*out[k]);
    const faceLimb=(a,b,c,d,color)=>face(p(a),p(b),p(c),p(d),color);
    const limbBox=rounded?beveledBox:vehicleBox;
    limbBox(faceLimb,0,0,0,width,length,width,...palette);
  }
  function riderHelmet(face,look,y,z,near){
    if(!near){vehicleBox(face,0,y,z,.29,.26,.30,...look.hair);return;}
    const rings=[[.12,.02],[.174,.12],[.151,.247],[.086,.31]];
    const tip=[0,y+.328,z];
    for(let i=0;i<8;i++){
      const a=i*TAU/8,b=(i+1)*TAU/8;
      const point=(ring,angle)=>[Math.cos(angle)*ring[0],y+ring[1],z+Math.sin(angle)*ring[0]*1.07];
      for(let row=0;row<3;row++)
        face(point(rings[row],a),point(rings[row],b),point(rings[row+1],b),point(rings[row+1],a),look.hair[(i+row)%3],.45);
      face(point(rings[3],a),point(rings[3],b),tip,tip,look.hair[2],.45);
    }
    const glass=z+.188;
    face([-.116,y+.094,glass],[.116,y+.094,glass],[.118,y+.20,glass],[ -.118,y+.20,glass],'#293e50',.72);
    face([-.105,y+.159,glass+.003],[.107,y+.174,glass+.003],[.107,y+.189,glass+.003],[-.105,y+.178,glass+.003],'#6d8da1',.55);
  }
  function bikeOccupant(face,look,near,back=false){
    const seat=back?-.68:-.27,hip=back?1.035:.998,shoulder=back?1.44:1.36;
    const lean=back?.105:.25;
    const rear=[0,hip,seat],chest=[0,shoulder,seat+lean];
    seatLimb(face,rear,chest,.32,look.shirt,true);
    for(const side of [-1,1]){
      const thigh=[side*.162,hip,seat],knee=[side*(back?.31:.365),hip-.13,seat+(back?.20:.40)];
      const shoe=[side*(back?.30:.315),back?.65:.516,back?-.59:-.30];
      const pants=look.pants??['#46526d','#303950','#626e82'];
      seatLimb(face,thigh,knee,.116,pants);
      seatLimb(face,knee,shoe,.093,pants);
      vehicleBox(face,shoe[0],shoe[1]-.065,shoe[2]+.035,.129,.11,.235,'#272a3b','#171e29','#4d576b');
      const arm=[side*.166,shoulder-.035,seat+lean];
      const elbow=[side*.31,shoulder-.12,seat+(back?.18:.40)];
      const hand=back?[side*.237,.99,seat+.32]:[side*.36,1.018,.54];
      seatLimb(face,arm,elbow,.098,look.shirt);
      seatLimb(face,elbow,hand,.091,look.shirt);
      if(near) vehicleBox(face,hand[0],hand[1]-.042,hand[2],.093,.075,.105,...look.skin);
    }
    riderHelmet(face,look,shoulder+.032,seat+lean+.075,near);
  }
  function motorcycleMesh(face,paint,braking,near,driver,passenger,travel){
    vehicleWheel(face,0,-.88,.326,.23,near,travel);
    vehicleWheel(face,0,.88,.326,.20,near,travel);
    loft(face,0,-.055,[[.34,.30,.66,-.04],[.45,.47,.79],[.64,.35,.64,.07]],['#283b4b','#243040','#788793'],.3);
    loft(face,0,.235,[[.56,.39,.62],[.72,.55,.79],[.94,.44,.65,-.06],[1.01,.22,.42,-.08]],
      [paint,paint,'#a2b5a8'],.72);
    loft(face,0,-.59,[[.67,.22,.44,-.08],[.74,.37,.58],[.88,.41,.51,.02]],[paint,'#344356','#536574'],.35);
    loft(face,0,-.41,[[.813,.33,.81],[.859,.39,.90],[.923,.31,.80,-.04]],['#252a36','#212430','#49505e']);
    loft(face,0,.56,[[.86,.23,.24],[.96,.40,.27],[1.08,.32,.24,-.05]],[paint,'#374f5b','#83979d'],.42);
    vehicleBox(face,0,.992,.54,.76,.043,.056,'#677182','#343e50','#8b98aa');
    face([-.14,.932,.682],[.14,.932,.682],[.14,1.035,.682],[-.14,1.035,.682],'#edf8ff',-1);
    face([-.14,.726,-.864],[.14,.726,-.864],[.14,.825,-.864],[-.14,.825,-.864],braking?'#ff6746':'#f12b37',-1);
    for(const side of [-1,1]){
      const x=side*.139;
      face([x,.33,.904],[x+side*.055,.33,.904],[x+side*.032,.935,.472],[x,.935,.472],'#9eafc3',.48);
    }
    if(near) for(const side of [-1,1]){
      seatLimb(face,[side*.15,.44,-.59],[side*.23,.57,.30],.048,['#d5aa75','#986846','#edc696']);
      seatLimb(face,[side*.24,.45,-.78],[side*.22,.38,-.12],.078,['#88939a','#4d5e6f','#b1bcb9'],true);
    }
    for(const side of [-1,1]){
      vehicleBox(face,side*.283,.399,-.30,.14,.052,.095,'#606778','#353e4e','#8d98a6');
      vehicleBox(face,side*.277,.538,-.59,.124,.047,.090,'#606778','#353e4e','#8d98a6');
    }
    if(driver) bikeOccupant(face,driver,near);
    if(passenger) bikeOccupant(face,passenger,near,true);
  }
  // Vẽ kính sau các bề mặt đặc để nhìn xuyên vào cabin.
  const cabinGlass=[];
  function queueGlass(a,b,c,d,alpha,color){
    const centerX=(a[0]+b[0]+c[0]+d[0])*.25,centerZ=(a[2]+b[2]+c[2]+d[2])*.25;
    cabinGlass.push({points:[a,b,c,d],alpha,color,
      depth:(centerX-originX)*yawSin+(centerZ-origin)*yawCos});
  }
  function cabinSeat(face,base,roof,position,seatX){
    const y=base-.24,h=Math.min(.45,roof-base+.04);
    loft(face,seatX,position-.14,[[y,.33,.25],[y+h*.40,.32,.24],[y+h,.245,.16,-.045]],
      ['#3c414e','#292d39','#5b626a']);
  }
  // Đặt người ngồi theo chiều cao cabin và tư thế lái hoặc ngồi ghế phụ.
  function seatedDriver(face,look,base,top,position,seatX=-.32,driving=true){
    const span=top-base;
    const hips=[seatX,base-.13,position],shoulders=[seatX,base+span*.48,position+.065];
    seatLimb(face,hips,shoulders,.29,look.shirt,true);
    const wheelZ=position+.435,wheelY=base+span*.24;
    if(driving) for(let i=0;i<10;i++){
      const a=i*TAU/10,b=(i+1)*TAU/10;
      const spoke=t=>[seatX+Math.cos(t)*.15,wheelY+Math.sin(t)*.15,wheelZ];
      seatLimb(face,spoke(a),spoke(b),.025,['#282833','#191e2a','#464955']);
    }
    for(const side of [-1,1]){
      const knee=[seatX+side*.096,base-.115,position+.29],ankle=[knee[0],base-.39,position+.42];
      const pants=look.pants??['#474b60','#33384a','#595d70'];
      seatLimb(face,[seatX+side*.09,hips[1],hips[2]],knee,.106,pants);
      seatLimb(face,knee,ankle,.098,pants);
      const elbow=[seatX+side*.197,base+span*.20,position+.20];
      const hand=driving?[seatX+side*.132,wheelY+.07,wheelZ]:[seatX+side*.09,base-.06,position+.27];
      seatLimb(face,[seatX+side*.127,shoulders[1],shoulders[2]],elbow,.084,look.shirt);
      seatLimb(face,elbow,hand,.070,look.shirt);
      vehicleBox(face,hand[0],hand[1]-.026,hand[2],.057,.055,.059,...look.skin);
    }
    const headHeight=Math.min(.21,span*.35);
    const head=Math.min(base+span*.49,top-headHeight*1.12-.048);
    const headWidth=(look.faceWidth??.25)*.76*look.scale;
    const headDepth=(look.faceDepth??.25)*.66;
    actorHead(face,seatX,head,position+.06,headWidth,headHeight,headDepth,look);
    if(look.longHair) vehicleBox(face,seatX,head-.035,position-.03,.17,headHeight,.048,...look.hair);
  }
  function driverArm(face,look,elbow,hand){
    const wrist=[lerp(elbow[0],hand[0],.83),lerp(elbow[1],hand[1],.83),lerp(elbow[2],hand[2],.83)];
    seatLimb(face,elbow,wrist,.085,look.shirt,true);
    seatLimb(face,wrist,hand,.067,look.skin);
    vehicleBox(face,hand[0],hand[1]-.04,hand[2],.084,.082,.09,...look.skin);
  }
  function bikeControls(face,view){
    const turn=state.steer*.34,c=Math.cos(turn),s=Math.sin(turn);
    const control=([x,y,z])=>[x*c+(z-.54)*s,y,.54+(z-.54)*c-x*s];
    const steel=['#58687b','#30384a','#758697'],rubber=['#293141','#171d2a','#424c5c'];
    const look=drivingLook(state);
    loft(face,0,.235,[[.56,.39,.62],[.72,.55,.79],[.94,.44,.65,-.06],[1.01,.22,.42,-.08]],
      [state.color,state.color,'#a2b5a8'],.45);
    loft(face,0,.545,[[1.025,.197,.133],[1.081,.245,.162],[1.126,.203,.147,-.021]],rubber);
    vehicleBox(face,0,1.125,.515,.127,.012,.066,'#6bbabb','#337779','#9ee7e4',-1);
    for(const side of [-1,1]){
      const hand=control([side*.34,1.065,.54]);
      seatLimb(face,control([0,1.02,.54]),hand,.037,steel);
      seatLimb(face,control([side*.26,1.065,.54]),control([side*.42,1.065,.54]),.061,rubber);
      const mirror=control([side*.47,1.23,.63]);
      seatLimb(face,hand,mirror,.023,steel);
      loft(face,mirror[0],mirror[2],[[mirror[1],.126,.035],[mirror[1]+.038,.186,.054],
        [mirror[1]+.091,.14,.046,-.005]],['#617587','#303b4e','#7f97aa']);
      driverArm(face,look,[side*.29,.82,view.z-.09],hand);
    }
  }
  function playerCabin(z,angle){
    const model=state.model,profile=vehicleProfile(model),view=cabinViewProfile(model);
    const truck=model===5,cos=Math.cos(angle),sin=Math.sin(angle);
    const x=center(z)+state.x,y=terrainHeight(z,state.x);
    const point=([a,b,c])=>[x+cos*a+sin*c,y+b,z-sin*a+cos*c];
    const face=(a,b,c,d,color,finish=0)=>quad(point(a),point(b),point(c),point(d),color,1,finish);
    if(model===4){
      bikeControls(face,view);
      return;
    }
    const trim=['#323641','#232530','#474956'],seat=['#545462','#3d3d4a','#666777'];
    const floor=truck?.83:.39,roof=truck?2.61:profile.roof-.028;
    const width=truck?1.10:profile.halfWidth-.11,front=truck?3.30:1.29,back=truck?.96:-1.63;
    const middle=(front+back)*.5,depth=front-back;
    const dash=truck?1.61:Math.min(.83,roof-.32);
    vehicleBox(face,0,floor-.12,middle,width*2,.12,depth,...trim);
    vehicleBox(face,0,roof,middle,(width+.06)*2,.075,depth+.12,...trim);
    loft(face,0,front-.22,[[dash-.24,width*1.78,.42],[dash-.063,width*2,.48],
      [dash+.017,width*1.88,.35,.032]],trim);
    if(!truck) loft(face,view.x,front-.33,[[dash-.065,.40,.29],[dash+.036,.39,.26],[dash+.075,.30,.17,.036]],
      ['#44515a','#303c49','#647275']);
    vehicleBox(face,0,floor,dash>.9?view.z+.55:.48,.27,dash-floor,.64,...trim);
    for(const side of [-1,1]){
      vehicleBox(face,side*(width+.018),floor,middle,.095,dash-floor,depth,...trim);
      vehicleBox(face,side*(width-.06),dash-.078,middle,.17,.095,depth*.60,...trim);
      vehicleBox(face,side*(width-.13),dash+.025,view.z-.17,.035,.055,.15,'#9aa1ab','#686e7a','#b8bac1');
      for(const pillar of [back+.11,front-.13]){
        seatLimb(face,[side*(width-.04),dash,pillar],[side*(width-.07),roof,pillar-(pillar>middle?.20:-.10)],.087,trim);
      }
      const seatX=side*(truck?.49:.36),seatBase=floor+.13,seatZ=view.z-.24;
      loft(face,seatX,seatZ,[[seatBase,.37,.39],[seatBase+.06,.46,.48],[seatBase+.128,.405,.44]],seat);
      loft(face,seatX,seatZ-.25,[[seatBase+.09,.42,.14],[seatBase+.35,.45,.16,-.025],
        [seatBase+.57,.33,.12,-.060],[seatBase+.73,.23,.107,-.087]],seat);
      if(!truck){
        vehicleBox(face,seatX,seatBase-.025,-1.00,.57,.16,.45,...seat);
        vehicleBox(face,seatX,seatBase+.09,-1.24,.57,.45,.15,...seat);
        vehicleBox(face,seatX,seatBase+.52,-1.24,.22,.16,.13,...seat);
      }
    }
    // Đặt giọt và lưỡi gạt trên cùng mặt kính; nội thất che chúng bằng bộ đệm độ sâu.
    const glass=(u,v,inset=0)=>point([(u-.5)*(width-.09)*2,lerp(dash+.035,roof-.045,v),
      front-lerp(.145,.345,v)-inset]);
    windshieldWeather((u,v,du,dv,alpha,color)=>{
      queueGlass(glass(u-du,v),glass(u,v-dv),glass(u+du,v),glass(u,v+dv),alpha,color);
    },(u,v,toU,toV)=>{
      const armU=lerp(u,toU,.54),armV=lerp(v,toV,.54);
      const strip=(a,b,c,d,halfWidth,color)=>{
        const length=Math.hypot(c-a,d-b);
        const dx=(d-b)/length*halfWidth,dy=(a-c)/length*halfWidth;
        quad(glass(a-dx,b-dy,.012),glass(a+dx,b+dy,.012),
          glass(c+dx,d+dy,.012),glass(c-dx,d-dy,.012),color,1,-1);
      };
      strip(u,v,armU,armV,.006,'#303944');
      strip(armU,armV,toU,toV,.010,'#121923');
    });
    if(truck) vehicleBox(face,0,floor,back,width*2,roof-floor,.09,...trim);
    else vehicleBox(face,0,dash-.04,back+.04,width*2,.09,.23,...trim);
    const wheelZ=view.z+.48,wheelY=dash+.095,wheelR=truck?.207:.165;
    const wheelTurn=-state.steer*.46;
    for(let i=0;i<12;i++){
      const angle=i*TAU/12+wheelTurn,next=angle+TAU/12;
      const spoke=t=>[view.x+Math.cos(t)*wheelR,wheelY+Math.sin(t)*wheelR,wheelZ];
      seatLimb(face,spoke(angle),spoke(next),.033,trim);
      if(i%4===0) seatLimb(face,[view.x,wheelY,wheelZ],spoke(angle),.025,trim);
    }
    const look=drivingLook(state);
    for(const side of [-1,1]){
      const grip=side===1?.45:Math.PI-.45;
      const hand=[view.x+Math.cos(grip+wheelTurn)*wheelR,wheelY+Math.sin(grip+wheelTurn)*wheelR,wheelZ-.026];
      driverArm(face,look,[view.x+side*.25,floor+.18,view.z-.04],hand);
    }
    vehicleBox(face,view.x,wheelY-.045,wheelZ,.091,.09,.035,...trim);
    vehicleBox(face,view.x,dash+.024,front-.43,.43,.10,.085,'#213b49','#1c2636','#324f60',-1);
    for(let i=0;i<7;i++) vehicleBox(face,view.x-.15+i*.05,dash+.060,front-.478,.018,.038,.012,
      '#9fd9cc','#63a99c','#d4ffe9',-1);
    vehicleBox(face,.05,dash+.003,front-.39,.28,.145,.055,'#26414b','#1d303d','#55787c',-1);
    vehicleBox(face,0,roof-.10,front-.29,.25,.060,.031,'#78909d','#2c3542','#354454',-1);
  }
  const scorchedColors=new Map();
  function scorchedColor(color,strength){
    const step=Math.ceil(strength*9);
    if(!step) return color;
    const key=color+':'+step;
    if(!scorchedColors.has(key)){
      const blend=step/9,original=rgb(color),target=[.045,.040,.046];
      const channels=original.map((value,i)=>Math.round(lerp(value,target[i],blend)*255).toString(16).padStart(2,'0'));
      scorchedColors.set(key,'#'+channels.join(''));
    }
    return scorchedColors.get(key);
  }
  // Xoay cả tấm cửa và kính quanh trục bản lề trước, theo đúng hình cắt trên thân.
  function swingingDoor(face,glassFace,side,amount,panel,window,paint,lengthScale=1,onHandle=null){
    const turn=side*amount*1.02;
    const cos=Math.cos(turn),sin=Math.sin(turn);
    const [hingeX,,hingeZ]=panel[1];
    const rotate=([x,y,z])=>{
      const dx=x-hingeX,dz=(z-hingeZ)*lengthScale;
      return [hingeX+dx*cos-dz*sin,y,hingeZ+(dx*sin+dz*cos)/lengthScale];
    };
    face(...panel.map(rotate),paint,.58);
    const doorPoint=(u,v)=>panel[0].map((_,i)=>lerp(lerp(panel[0][i],panel[1][i],u),
      lerp(panel[3][i],panel[2][i],u),v)+(i===0?side*.004:0));
    face(rotate(doorPoint(.04,.42)),rotate(doorPoint(.96,.63)),rotate(doorPoint(.96,.69)),rotate(doorPoint(.04,.50)),paint,.93);
    glassFace(window.map(rotate),'#455d78',.44);
    const [a,b,c,d]=window;
    const inset=(u,v)=>a.map((value,i)=>lerp(lerp(value,b[i],u),lerp(d[i],c[i],u),v));
    for(const [u,v,U,V] of [[0,0,1,.055],[0,.94,1,1],[0,0,.048,1],[.952,0,1,1]]){
      face(rotate(inset(u,v)),rotate(inset(U,v)),rotate(inset(U,V)),rotate(inset(u,V)),'#2a303b');
    }
    const handle=(u,y)=>rotate(panel[0].map((value,i)=>i===1?y:
      lerp(value,panel[1][i],u)+(i===0?side*.012:0)));
    const y=lerp(panel[3][1],panel[2][1],.20)-.08;
    face(handle(.13,y),handle(.27,y),handle(.27,y+.037),handle(.13,y+.037),'#aeb8bf');
    if(onHandle) onHandle(handle(.20,y+.018));
  }
  // Vẽ thân sedan nhập, quay bánh theo quãng đường và xếp kính vào lượt vẽ trong suốt.
  function drawImportedSedan(transform,paint,braking,reversing,alpha,travel,soot){
    const colors=['#a1aab0','#777f86','#1c2024','#383b42','#262b31',paint,
      reversing?'#edf7ff':'#c7d6da',braking?'#ff6354':'#ad3441','#d5d4cf','#546b7e'];
    const angle=travel/.325;
    const cos=Math.cos(angle),sin=Math.sin(angle);
    for(const [material,wheel,positions,indices] of importedSedan){
      const axle=wheel<2?1.4016:-1.4016;
      const hub=wheel<2?.329:.333;
      const points=[];
      for(let i=0;i<positions.length;i+=3){
        const x=positions[i],y=positions[i+1],z=positions[i+2];
        const dy=y-hub,dz=z-axle;
        points.push(transform([x,wheel<0?y:hub+dy*cos+dz*sin,
          (wheel<0?z:axle+dz*cos-dy*sin)*2.04/2.43]));
      }
      const color=scorchedColor(colors[material],soot);
      const tint=rgb(color);
      const finish=material===5&&soot<.5?8.42:material===7&&braking?-1:0;
      for(let i=0;i<indices.length;i+=3){
        const a=points[indices[i]],b=points[indices[i+1]],c=points[indices[i+2]];
        if(material===9) queueGlass(a,b,c,c,alpha*.43,color);
        else{
          point(a,tint,alpha,finish);
          point(b,tint,alpha,finish);
          point(c,tint,alpha,finish);
        }
      }
    }
  }
  // Vẽ phương tiện bằng cùng biến đổi vị trí, hướng và va chạm của mô phỏng.
  function carMesh(z,x,paint,braking,angle,alpha=1,player=false,model=0,roll=0,wreck=null,reversing=false,driver=null,passenger=null,occupants=null,crash=null,travel=0,soot=0,takeover=null){
    const cos=Math.cos(angle),sin=Math.sin(angle),mid=center(z)+x;
    const near=player||Math.abs(z-origin)<graphics.vehicle;
    const profile=vehicleProfile(model);
    const ground=terrainHeight(z,x);
    const lift=wreck?.y??crash?.hop??0;
    markShadow(mid,ground+lift,z,profile.halfWidth*1.75,wreck?.y!==undefined?.72:profile.roof,profile.halfLength*1.9,angle);
    // Chuyển điểm từ hệ tọa độ xe ra thế giới, xoay bánh và thân theo cùng hướng xe.
    const lean=wreck?.roll??roll;
    const leanCos=Math.cos(lean),leanSin=Math.sin(lean);
    const pitch=wreck?.pitch??crash?.pitch??0;
    const pitchCos=Math.cos(pitch),pitchSin=Math.sin(pitch);
    const lengthScale=model<4?profile.halfLength/2.04:1;
    const p=([a,b,c])=>{
      c*=lengthScale;
      if(crash&&b>=.30&&model!==4){
        const end=clamp((Math.abs(c)/profile.halfLength-.33)/.68,0,1);
        const edge=clamp((Math.abs(a)/profile.halfWidth-.26)/.74,0,1);
        const crumple=(c>0?crash.front:crash.rear)*end*end;
        const pinch=(a>0?crash.right:crash.left)*edge*edge;
        c-=Math.sign(c)*crumple*(.78+a*.16);
        a-=Math.sign(a)*pinch*(.58+.15*Math.cos(c*2));
        b+=crumple*(.31+Math.sin(a*5)*.24)+pinch*Math.cos(c*3)*.35;
      }
      const across=a*leanCos-(b-.35)*leanSin;
      const height=a*leanSin+(b-.35)*leanCos;
      const along=c*pitchCos+height*pitchSin;
      return [mid+across*cos+along*sin,ground+lift+.35+height*pitchCos-c*pitchSin,z-across*sin+along*cos];
    };
    // Vẽ mặt của riêng xe với độ trong suốt chung ở lúc chuyển camera.
    const face=(a,b,c,d,color,finish=0)=>quad(p(a),p(b),p(c),p(d),scorchedColor(color,soot),alpha,soot>.88?-1:soot>.5?0:color===paint&&finish>=0&&finish<=1?finish+8:finish);
    if(model===0&&!takeover&&(player||Math.abs(z-origin)<48)){
      drawImportedSedan(p,paint,braking,reversing,alpha,travel,soot);
      for(const seat of [[driver,-.32,.43,true],[occupants?.[0],.32,.43,false],
        [occupants?.[1],-.32,-.65,false],[occupants?.[2],.32,-.65,false]]){
        const [person,side,row,driving]=seat;
        if(person) seatedDriver(face,person,.76,profile.roof,row,side,driving);
      }
      return;
    }
    if(model!==4&&(near||wreck)){
      const {halfWidth,halfLength}=profile;
      const metal=['#222734','#303847','#424954'];
      vehicleBox(face,0,.23,0,halfWidth*1.65,.12,halfLength*1.76/lengthScale,...metal);
      for(const axle of [-1,1])
        vehicleBox(face,0,.18,axle*halfLength*.63/lengthScale,halfWidth*1.9,.09,.17,...metal);
      vehicleBox(face,0,.17,0,.15,.12,halfLength*1.28/lengthScale,...metal);
      vehicleBox(face,halfWidth*.46,.18,-halfLength*.19/lengthScale,.077,.078,halfLength*1.49/lengthScale,'#555b61','#414750','#646c73');
      vehicleBox(face,halfWidth*.46,.16,-halfLength*.62/lengthScale,.28,.13,.55,'#444b53','#515961','#686f77');
    }
    if(reversing&&!wreck&&model!==4){
      const rear=model===5?-3.63:-2.057;
      for(const side of [-1,1]){
        const lens=side*(model===5?.82:.51);
        face([lens-.095,.51,rear],[lens+.095,.51,rear],[lens+.095,.61,rear],[lens-.095,.61,rear],'#f5f8ff',-1);
      }
    }
    if(model===4){
      if(takeover) takeover.grips={[-1]:p([-.35,1.035,.54]),[1]:p([.35,1.035,.54])};
      motorcycleMesh(face,paint,braking,near,wreck?null:driver,wreck?null:passenger,travel);
      return;
    }
    if(model===5){
      truckMesh(face,paint,braking,near,travel,takeover,p,alpha);
      return;
    }
    const {hood,tail,glass,rear,roofRear,roofFront,windshield}=fleetProfiles[model];
    const {roof,halfWidth}=profile;
    const w=halfWidth-.035;
    const n=-2.03,f=2.02;
    const bumper=['#293341','#232938','#586674'];
    // Bo cong nắp ca-pô và cốp, đưa bề mặt về mép thân và hai đầu cản.
    const bodyAt=(x,z)=>{
      const t=(z-n)/(f-n);
      const across=x/w;
      const crown=Math.sin(Math.PI*t)*(.055+.013*model)*(1-across*across);
      return [x,lerp(tail,hood,t)+crown,z];
    };
    const bodyStations=near?[n,rear,roofRear,0,roofFront,windshield,f]:[n,0,f];
    for(const side of [-1,1]){
      const edge=side*w,shoulder=edge*(model===1?.47:.64);
      for(let i=1;i<bodyStations.length;i++){
        const back=bodyStations[i-1],front=bodyStations[i];
        face(bodyAt(0,back),bodyAt(shoulder,back),bodyAt(shoulder,front),bodyAt(0,front),paint,.58);
        face(bodyAt(shoulder,back),bodyAt(edge,back),bodyAt(edge,front),bodyAt(shoulder,front),paint,.43);
      }
    }
    for(const [end,high,dir] of [[n,tail,-1],[f,hood,1]]){
      face([-w,.31,end-dir*.083],[w,.31,end-dir*.083],[w,high,end],[-w,high,end],paint,.55);
      const width=w*(model===3?.88:.96);
      loft(face,0,end-dir*.024,[[.275,width*1.66,.09],[.36,width*2,.142],[.43,width*1.84,.12]],bumper,.42);
      const inset=end+dir*.024;
      face([-w*.34,.48,inset],[w*.34,.48,inset],[w*.29,high-.078,inset],[-w*.29,high-.078,inset],
        dir===1?'#273844':'#495163',.55);
      if(dir===1&&near&&high>.6)
        face([-w*.30,high-.145,inset+.003],[w*.30,high-.145,inset+.003],
          [w*.28,high-.13,inset+.003],[-w*.28,high-.13,inset+.003],'#81909a');
    }
    const wind=[[-glass,roof,roofFront],[glass,roof,roofFront],[w,hood+.028,windshield],[-w,hood+.028,windshield]];
    const backWindow=[[-w,tail+.035,rear],[w,tail+.035,rear],[glass,roof,roofRear],[-glass,roof,roofRear]];
    const glassFace=(vertices,color,tint)=>{
      queueGlass(...vertices.map(p),alpha*lerp(tint,.78,soot),scorchedColor(color,soot));
    };
    glassFace(wind,'#4d6787',.31);
    const roofSpan=roofFront-roofRear;
    loft(face,0,(roofRear+roofFront)*.5,[[roof-.054,glass*1.98,roofSpan],
      [roof-.014,glass*2,roofSpan],[roof+.038,glass*1.72,roofSpan*.86,-.025]],[paint,paint,paint],.45);
    if(model>=2) for(const rail of [-glass*.72,glass*.72]){
      const rails=model===3?['#29353c','#202835','#547076']:['#98a6a8','#707f87','#bac2bb'];
      const front=roofFront-.23,rear=roofRear+.25;
      vehicleBox(face,rail,roof+.036,(front+rear)*.5,.042,.056,front-rear,...rails);
      if(near&&model===3) for(const cross of [rear+.12,front-.12])
        vehicleBox(face,0,roof+.061,cross,glass*1.52,.033,.086,...rails);
    }
    if(model===1&&near)
      loft(face,0,n+.14,[[tail+.013,w*1.36,.15],[tail+.081,w*1.45,.13,-.038]],
        [paint,paint,paint],.63);
    glassFace(backWindow,'#496584',.34);
    for(const side of [-1,1]){
      seatLimb(face,[side*glass,roof-.031,roofRear],[side*w,tail+.038,rear],.058,[paint,paint,paint]);
      seatLimb(face,[side*glass,roof-.031,roofFront],[side*w,hood+.030,windshield],.052,[paint,paint,paint]);
    }
    if(near){
      const base=Math.max(tail,hood)+.02;
      const front=lerp(roofRear,roofFront,.65),rear=lerp(roofRear,roofFront,.16);
      for(const side of [-.32,.32]){
        cabinSeat(face,base,roof,front,side);
        cabinSeat(face,base,roof,rear,side);
      }
      if(driver) seatedDriver(face,driver,base,roof,front);
      if(occupants?.[0]) seatedDriver(face,occupants[0],base,roof,front,.32,false);
      if(occupants?.[1]) seatedDriver(face,occupants[1],base,roof,rear,-.32,false);
      if(occupants?.[2]) seatedDriver(face,occupants[2],base,roof,rear,.32,false);
      face([-glass,.58,roofRear],[glass,.58,roofRear],[glass,tail+.018,roofRear],[-glass,tail+.018,roofRear],'#252833');
    }
    for(const side of [-1,1]){
      const s=side*w, g=side*glass, edge=side*(w+.025);
      const skirt=paint;
      const amount=takeover?.side===side?takeover.door:0;
      const sideWindow=[[s,tail+.035,rear],[s,hood+.028,windshield],[g,roof,roofFront],[g,roof,roofRear]];
      const [a,b,c,d]=sideWindow;
      const split=[.50,.57,.54,.52][model];
      const line=(x,y,t)=>x.map((coord,i)=>lerp(coord,y[i],t));
      const mid=line(a,b,split),top=line(d,c,split);
      face([s,.27,n],[s,.27,f],[s,.38,f],[s,.38,n],skirt,.53);
      if(model===3) face([s+side*.004,.29,n+.10],[s+side*.004,.29,f-.05],
        [s+side*.004,.37,f-.018],[s+side*.004,.38,n+.036],'#344852');
      face([s,.38,n],[s,.38,mid[2]],mid,[s,tail,n],skirt,.53);
      face([s,.38,b[2]],[s,.38,f],[s,hood,f],b,skirt,.53);
      const window=[mid,b,c,top];
      if(model===1){
        const corner=line(a,d,.42);
        face(a,mid,top,corner,paint,.63);
        glassFace([corner,top,d,d],'#34465f',.28);
      }else glassFace([a,mid,top,d],'#34465f',.28);
      swingingDoor(face,glassFace,side,amount,[[s,.38,mid[2]],[s,.38,b[2]],b,mid],window,skirt,lengthScale,takeover?.side===side?point=>{takeover.grip=p(point);}:null);
      if(near&&amount<.02){
        const mount=bodyAt(s,windshield-.12);
        seatLimb(face,[s,mount[1]+.05,mount[2]],[s+side*.14,mount[1]+.115,mount[2]],.041,bumper);
        loft(face,s+side*.157,mount[2],[[mount[1]+.076,.16,.12],[mount[1]+.105,.22,.18],
          [mount[1]+.169,.19,.15],[mount[1]+.191,.12,.10]],[paint,'#283440',paint],.34);
      }
      if(near) face(line(a,mid,.96),mid,top,line(d,top,.96),'#242739');
      face([s,tail+.016,rear],[s*.81,tail+.087,rear+.095],[g*.82,roof,roofRear],[g,roof,roofRear],paint,.68);
      const wheelR=model===3?.292:.252;
      for(const axle of [-1.28,1.28]){
        const width=model===3?.265:.225;
        const wheelPoint=([a,b,c])=>[a,b+.002,axle+(c-axle)/lengthScale];
        const wheelFace=(a,b,c,d,color)=>face(wheelPoint(a),wheelPoint(b),wheelPoint(c),wheelPoint(d),color);
        vehicleWheel(wheelFace,edge-side*width*.5,axle,wheelR,width,near,travel);
      }
      // Tạo cụm đèn hậu riêng cho từng mẫu, cùng tâm đèn pha ở hai bên mũi xe.
      const outside=side*(w-.045),inside=side*(model===3?.64:model===1?.29:.44);
      const bottom=model===1?tail-.155:tail-.24;
      face([inside,bottom+.04,n-.022],[outside,bottom,n-.022],[outside,tail-.069,n-.022],
        [inside,tail-.101,n-.022],braking?'#ff684d':'#c62642',-1);
      face([inside,tail-.133,n-.025],[outside,tail-.10,n-.025],[outside,tail-.071,n-.025],
        [inside,tail-.102,n-.025],braking?'#ffe0ab':'#ff706a',-1);
      const lens=w*.94;
      face([side*.42,hood-.132,f+.016],[side*lens,hood-.166,f+.016],[side*lens,hood-.052,f+.016],
        [side*.42,hood-.073,f+.016],'#e1f4ed',-1);
      if(near) face([side*.60,hood-.173,f+.018],[side*lens,hood-.19,f+.018],
        [side*lens,hood-.171,f+.018],[side*.60,hood-.156,f+.018],'#ffc184',-1);
      if(model===3) face([side*(w-.11),tail-.075,n-.026],[outside,tail-.075,n-.026],
        [outside,tail+.035,n-.026],[side*(w-.10),tail+.028,n-.026],braking?'#ff8162':'#ea434c',-1);
    }
    if(model===1){
      face([-.31,tail-.133,n-.018],[.31,tail-.133,n-.018],[.31,tail-.104,n-.018],[-.31,tail-.104,n-.018],braking?'#ff7159':'#c83243',-1);
    }
    face([-.177,.448,n-.025],[.177,.448,n-.025],[.177,.543,n-.025],[-.177,.543,n-.025],'#a8b6cd');
  }
  // Dựng chùm sáng của từng đèn pha trên mặt đường, mờ dần từ tâm ra rìa và theo khoảng cách.
  function trafficHeadlights(z,x,angle,model=0) {
    const tint=rgb('#a5ccff');
    const sin=Math.sin(angle), cos=Math.cos(angle), centerX=center(z)+x;
    const lamps=model===4?[0]:model===5?[-.84,.84]:[-.64,.64];
    const nose=model===4?.70:vehicleProfile(model).halfLength;
    for(const lamp of lamps){
      // Lấy vị trí chùm sáng ở một khoảng cách và độ lệch ngang đã cho.
      const spot=(distance,offset)=>[centerX+(lamp+offset)*cos+sin*distance,.038,
        z-(lamp+offset)*sin+cos*distance];
      const ranges=[0,3.9,13.9,29.9], levels=[.04,.20,.09,0];
      for(let band=0;band<3;band++){
        const steps=Math.ceil((ranges[band+1]-ranges[band])/3);
        for(let i=0;i<steps;i++){
          const t0=i/steps,t1=(i+1)/steps;
          const n=nose+lerp(ranges[band],ranges[band+1],t0);
          const f=nose+lerp(ranges[band],ranges[band+1],t1);
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
  function headRings(face,x,y,z,width,height,depth,rings,palette){
    const steps=12;
    // Lấy điểm trên tiết diện, theo trục ngang và chiều sâu của khuôn mặt.
    const at=([level,wide,deep,shift],i)=>{
      const angle=i*TAU/steps;
      return [x+Math.sin(angle)*width*.5*wide,y+height*level,z+depth*(shift+Math.cos(angle)*.5*deep)];
    };
    for(let row=1;row<rings.length;row++){
      for(let i=0;i<steps;i++){
        const shade=i===2||i===3||i===8||i===9?palette[1]:palette[0];
        face(at(rings[row-1],i),at(rings[row-1],i+1),at(rings[row],i+1),at(rings[row],i),shade);
      }
    }
  }
  // Ghép lưới đầu MakeHuman với màu da, tóc và trạng thái chớp mắt trong game.
  function actorHead(face,x,y,z,width,height,depth,look,blink=false){
    const [positions,indices]=importedHead;
    const points=[];
    for(let i=0;i<positions.length;i+=3)
      points.push([x+positions[i]*width,y+positions[i+1]*height,z+positions[i+2]*depth]);
    for(let i=0;i<indices.length;i+=3){
      const a=points[indices[i]],b=points[indices[i+1]],c=points[indices[i+2]];
      face(a,b,c,c,look.skin[0]);
    }
    for(const side of [-1,1]){
      const eyeX=x+side*width*.175,eyeY=y+height*.465,eyeZ=z+depth*.388;
      const halfWidth=width*.065,halfHeight=height*(blink?.004:.020);
      face([eyeX-halfWidth,eyeY,eyeZ],[eyeX,eyeY-halfHeight,eyeZ],
        [eyeX+halfWidth,eyeY,eyeZ],[eyeX,eyeY+halfHeight,eyeZ],blink?look.skin[1]:'#e5dcd1');
      if(!blink) vehicleBox(face,eyeX,eyeY-halfHeight*.75,eyeZ+.001,width*.032,halfHeight*1.5,.002,
        '#35302e','#35302e','#35302e');
    }
    const crown=look.hairStyle===4?1.18:1.09;
    headRings(face,x,y,z,width,height,depth,[
      [.81,1.01,1,-.042],[.94,.93,.93,-.045],[crown-.04,.61,.71,-.05],[crown,0,0,-.055]
    ],look.hair);
  }
  // Dựng người đi bộ theo tư thế và trạng thái chuyển động hiện tại.
  function personMesh(person,z,fall=null,shadowOnly=false){
    const x=center(z)+person.x;
    const look=person.look??foot.look, scale=look.scale,build=look.build??1;
    const sin=Math.sin(person.angle),cos=Math.cos(person.angle);
    const bodyAngle=fall?.tilt??person.actionLean??(person.running&&person.moving?.18:0);
    const lean=Math.sin(bodyAngle),upright=Math.cos(bodyAngle);
    const lift=fall?.y??person.y;
    const recovery=fall?.recover;
    const kneel=person.actionCrouch||(recovery===undefined?0:Math.sin(Math.PI*recovery));
    const plant=recovery===undefined?0:Math.sin(Math.PI*clamp(recovery/.56,0,1));
    const airborne=Boolean(fall&&!fall.low&&!fall.contacts);
    const impact=fall?.impact??0;
    const brace=airborne?clamp(fall.age*(4+impact*.075),0,1):0;
    const roll=fall?.contacts&&recovery===undefined?.45+.31*Math.sin(fall.age*7):0;
    const stumble=fall?.low&&recovery===undefined?Math.sin(fall.age*15)*.55:0;
    const walking=person.moving&&person.grounded&&!fall;
    const running=walking&&person.running;
    const onSand=walking&&district(z)===3&&person.x>10&&person.x<22;
    const stepCycle=person.stride??0;
    const pulse=walking?Math.cos(stepCycle*TAU*2):0;
    const bob=walking?(running?-.047-.031*pulse:-.052-.015*pulse):-kneel*.25;
    const transform=([across,y,along])=>{
      const height=(fall&&!fall.low?y-.82:y)*scale;
      const front=along*scale*upright+height*lean;
      const px=x+across*scale*build*cos+front*sin, pz=z-across*scale*build*sin+front*cos;
      let py=lift+height*upright-along*scale*lean;
      if(fall){
        const surface=Math.max(terrainHeight(pz,px-center(pz)),fall.support??-Infinity);
        py=Math.max(py,surface+.009);
      }
      return [px,py,pz];
    };
    const face=(a,b,c,d,color)=>quad(transform(a),transform(b),transform(c),transform(d),color);
    const near=Math.abs(z-origin)<graphics.person;
    const shade=look.shirt;
    markShadow(x,Math.max(0,lift-.3),z,fall?.contacts?.82:.48,(fall?.contacts?.85:1.66)*scale,fall?.contacts?1.3:.33,person.angle);
    if(shadowOnly) return;
    loft(face,0,0,[[.70+bob,.33,.21],[.84+bob,.375,.255],[1.11+bob,.439,.29,.008],
      [1.235+bob,.432,.267],[1.317+bob,.205,.184,.013]],shade);
    loft(face,0,.012,[[1.257+bob,.146,.138],[1.342+bob,.120,.118]],look.skin);
    const headWidth=look.faceWidth??.255,headDepth=look.faceDepth??.25;
    const blink=near&&!(fall&&fall.age<.85)&&mod(world.time+hash(look.scale*739)*5,4.7)<.07;
    actorHead(face,0,1.32+bob,0,headWidth,.28,headDepth,look,blink);
    if(near){
      const faceZ=headDepth*.45;
      if(look.beard) vehicleBox(face,0,1.33+bob,faceZ-.018,headWidth*.76,.074,.038,...look.hair);
      if(look.glasses){
        for(const side of [-1,1])
          vehicleBox(face,side*.068,1.468+bob,faceZ+.009,.089,.056,.012,'#42505d','#363b4a','#8798a2');
        vehicleBox(face,0,1.493+bob,faceZ+.009,.055,.013,.012,'#393744','#252638','#59575f');
      }
      if(look.age>=60) for(const side of [-1,1])
        vehicleBox(face,side*.083,1.443+bob,faceZ+.004,.044,.008,.006,look.skin[1],look.skin[1],look.skin[2]);
      if(look.outfit===1||look.outfit===3){
        vehicleBox(face,0,.90+bob,.14,.29,.065,.018,shade[2],shade[1],shade[2]);
        vehicleBox(face,0,1.065+bob,.14,.32,.044,.018,shade[2],shade[1],shade[2]);
      }else if(look.outfit===2)
        vehicleBox(face,0,1.20+bob,.14,.24,.082,.026,'#b6a08d','#847460','#c4ac9a');
      if(look.hairStyle!==0) vehicleBox(face,look.hairStyle===2?.062:-.075,1.505+bob,.117,
        look.hairStyle===3?.168:.119,.083,.039,...look.hair);
      if(look.longHair)vehicleBox(face,0,1.23+bob,-.135,.25,.34,.11,...look.hair);
      const neckline='#d6b49a';
      face([-.087,1.28+bob,.106],[0,1.17+bob,.152],[0,1.25+bob,.13],[-.040,1.31+bob,.103],neckline);
      face([.085,1.28+bob,.106],[.040,1.31+bob,.103],[0,1.25+bob,.13],[0,1.17+bob,.152],neckline);
      if(look.trim) vehicleBox(face,.017,.84+bob,.134,.024,.32,.019,'#e0b28d','#734b42','#ead5b9');
      vehicleBox(face,-.12,.95+bob,.14,.087,.069,.022,shade[1],shade[1],shade[2]);
    }
    function limb(x,y,z,width,length,depth,angle,palette,visible=true){
      const c=Math.cos(angle),s=Math.sin(angle);
      const point=([a,b,d])=>[x+a,y+b*c+d*s,z-b*s+d*c];
      const surface=(a,b,c,d,color)=>face(point(a),point(b),point(c),point(d),color);
      if(visible) loft(surface,0,0,[[-length,width*.74,depth*.78],[-length*.34,width*.88,depth*.86],
        [0,width,depth]],palette);
      return [x,y-length*c,z+length*s];
    }
    const pants=look.pants??['#414b66','#30384e','#566078'];
    const shoes=['#262738','#171a27','#4b4956'];
    for(const side of [-1,1]){
      const phase=stepCycle+(side===1?0:.5);
      const gait=walking?gaitSample(phase,running):null;
      const lunge=brace*(side===1?.58:.90)+roll+stumble*side+kneel*(side===1?.95:.64);
      const hip=[side*.112,.73+bob,0];
      const liftStep=person.actionStepSide===side?(person.actionStep??0):0;
      let thigh=lunge+liftStep*.90,shin=lunge-kneel*1.44-roll*.83-liftStep*.59;
      if(gait){
        const stepZ=z+gait.along*cos*scale,stepX=x+gait.along*sin*scale;
        const slopeLift=onSand?(terrainHeight(stepZ,stepX-center(stepZ))-terrainHeight(z,person.x))/scale:0;
        const down=hip[1]-(.101+gait.lift+slopeLift);
        const distance=clamp(Math.hypot(down,gait.along),.06,.638);
        thigh=Math.atan2(gait.along,down)+Math.acos(clamp((.33**2+distance**2-.31**2)/(.66*distance),-1,1));
        shin=thigh-Math.acos(clamp((distance**2-.33**2-.31**2)/(.62*.33),-1,1));
      }
      const planted=person.actionFeet?.[side]??(side!==person.actionStepSide&&person.actionPlant);
      const knee=limb(...hip,.169,.33,.18,thigh,pants,!planted);
      const ankle=limb(...knee,.154,.31,.163,shin,pants,!planted);
      const pitch=gait?.pitch??0,c=Math.cos(pitch),s=Math.sin(pitch);
      const shoePoint=([x,y,z])=>[ankle[0]+x,ankle[1]+y*c-z*s,ankle[2]+y*s+z*c];
      const shoeVertex=point=>{
        const p=transform(shoePoint(point));
        if(onSand) p[1]=Math.max(p[1],terrainHeight(p[2],p[0]-center(p[2]))+.008);
        return p;
      };
      let shoeFace=(a,b,c,d,color)=>quad(shoeVertex(a),shoeVertex(b),shoeVertex(c),shoeVertex(d),color);
      if(planted){
        const plantZ=z+relativeDistance(person.z,planted.z);
        const plant=[center(plantZ)+planted.x,planted.y+.095*scale,plantZ];
        const hipWorld=transform(hip),normalAnkle=transform(ankle);
        const fixed=normalAnkle.map((value,i)=>lerp(value,plant[i],planted.weight));
        const joint=hipWorld.map((value,i)=>lerp(value,fixed[i],.51));
        const folded=.10*scale*Math.sin(planted.weight*Math.PI*.5);
        joint[0]+=Math.sin(planted.yaw)*folded;
        joint[2]+=Math.cos(planted.yaw)*folded;
        const surface=(a,b,c,d,color)=>quad(a,b,c,d,color);
        seatLimb(surface,hipWorld,joint,.166*scale,pants);
        seatLimb(surface,joint,fixed,.146*scale,pants);
        const yaw=person.angle+(mod(planted.yaw-person.angle+Math.PI,TAU)-Math.PI)*planted.weight;
        const c=Math.cos(yaw),s=Math.sin(yaw);
        const plantedShoe=([x,y,z])=>[fixed[0]+(x*c+z*s)*scale,fixed[1]+y*scale,fixed[2]+(z*c-x*s)*scale];
        shoeFace=(a,b,c,d,color)=>quad(plantedShoe(a),plantedShoe(b),plantedShoe(c),plantedShoe(d),color);
      }
      loft(shoeFace,0,.044,[[-.082,.177,.246],[-.040,.177,.251],[.025,.135,.185,-.035]],shoes);
      if(near)vehicleBox(shoeFace,0,-.091,.047,.188,.025,.265,'#bcb4ac','#8d8b93','#ddcbbb');
      const reach=(person.actionReach??0)*1.22+brace*(side===1?1.19:.87)+roll*.64+kneel*.35+plant*(side===1?.76:.43);
      const swing=walking?-(running?.66:.29)*Math.cos(phase*TAU):person.talking&&side===1?.56+.16*Math.sin(world.time*7):stumble*side*.88;
      const grip=person===foot&&(vehicleTakeover?.grips?.[side]
        ??(side===foot.actionStepSide?vehicleTakeover?.grip:null));
      if(grip&&foot.actionGrip>.015){
        const shoulder=transform([side*.255,1.22+bob,0]);
        const restHand=transform([side*.257,.76+bob,.05]);
        const target=restHand.map((coordinate,i)=>lerp(coordinate,grip[i],clamp(foot.actionGrip,0,1)));
        const delta=target.map((coordinate,i)=>coordinate-shoulder[i]);
        const length=Math.hypot(...delta),reachLimit=.48*scale;
        const wrist=delta.map((coordinate,i)=>shoulder[i]+coordinate*Math.min(1,reachLimit/Math.max(.001,length)));
        const elbow=shoulder.map((coordinate,i)=>lerp(coordinate,wrist[i],.53));
        elbow[1]-=.075*scale;
        const surface=(a,b,c,d,color)=>quad(a,b,c,d,color);
        seatLimb(surface,shoulder,elbow,.111*scale,shade);
        seatLimb(surface,elbow,wrist,.099*scale,shade);
        vehicleBox(surface,wrist[0],wrist[1]-.033*scale,wrist[2],.090*scale,.068*scale,.085*scale,...look.skin);
        continue;
      }
      const elbow=limb(side*.255,1.22+bob,0,.116,.25,.143,reach+swing,shade);
      const wrist=limb(...elbow,.103,.20,.125,reach+swing+brace*.43+kneel*.44-plant*.39+(running?.59:walking?.14:0),shade);
      if(near) beveledBox(face,wrist[0],wrist[1]-.055,wrist[2],.101,.102,.105,...look.skin);
    }
  }
  function drawSandFootprints(){
    for(const print of sandFootprints){
      const z=origin+relativeDistance(origin,print.z);
      if(Math.abs(z-origin)>75) continue;
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
      const z=origin+relativeDistance(origin,part.z);
      if(Math.abs(z-origin)>165) continue;
      const x=center(z)+part.x, y=part.y;
      const a=Math.cos(part.angle)*part.size, b=Math.sin(part.angle)*part.size;
      quad([x-a,y-b,z-part.size*.34],[x+a,y+b,z-part.size*.34],
        [x+a,y+b,z+part.size*.34],[x-a,y-b,z+part.size*.34],
        part.color,clamp((part.life-part.age)*3,0,1),.65);
    }
    for(const car of [state,...traffic]){
      const z=origin+relativeDistance(origin,car.z);
      if(Math.abs(z-origin)>165) continue;
      damageParticles(car,z,(x,y,z,radius,color,alpha)=>{
        if(alpha<.01) return;
        const tint=rgb(color),mid=[x,y,z];
        for(let i=0;i<8;i++){
          const a=i*TAU/8,b=(i+1)*TAU/8;
          const vertex=t=>[x+yawCos*Math.cos(t)*radius,y+Math.sin(t)*radius*.94,z-yawSin*Math.cos(t)*radius];
          point(mid,tint,alpha,-1);point(vertex(a),tint,0,-1);point(vertex(b),tint,0,-1);
        }
      });
    }
  }
  function draw() {
    if(gl.isContextLost()) return false;
    if(canvas.width!==w||canvas.height!==h){
      renderer.setSize(w,h,false);
      target.setSize(w,h);
    }
    renderer.setRenderTarget(target);
    renderer.clear(true,true,false);
    // Điều chỉnh tỷ lệ phối cảnh theo góc ngắm của tiếp tuyến.
    uniforms.cameraYaw.value=[yawCos,yawSin];
    uniforms.cameraPitch.value=[pitchCos,pitchSin];
    uniforms.viewport.value=[w,h];uniforms.vanishing.value=[cx,horizon];
    uniforms.lens.value=focal;uniforms.altitude.value=eye;
    const drivingView=!foot.active&&state.camera<.24&&!state.wreck&&!wreckExpired(state);
    uniforms.clipOffset.value=drivingView?.07:.6;
    uniforms.roadPhase.value=mod(origin,LAMP);
    uniforms.mountainPassStart.value=passStart;
    const angle=carYaw(state), sin=Math.sin(angle), forwardZ=Math.cos(angle);
    const nose=state.model===4?.70:vehicleProfile(state.model).halfLength;
    const playerZ=origin+relativeDistance(origin,state.z);
    uniforms.headlampOrigin.value=[center(playerZ)+state.x-originX+nose*sin,playerZ-origin+nose*forwardZ];
    uniforms.headlampHeight.value=terrainHeight(playerZ,state.x)+.65;
    uniforms.headlampDirection.value=[wreckExpired(state)?0:sin,wreckExpired(state)?0:forwardZ];
    uniforms.daylight.value=world.daylight;
    uniforms.season.value=world.weather;
    uniforms.sunDirection.value=world.sun;
    uniforms.sunStrength.value=world.sunStrength;
    uniforms.waterTime.value=world.time;
    uniforms.textureDetail.value=graphics===graphicsPresets.highest?2:graphics===graphicsPresets.medium?1:0;
    uniforms.coastJoin.value=[coastStart,coastLandBefore,coastLandAfter];
    uniforms.worldOrigin.value=[originX,mod(origin,LOOP)];
    roadLamps=streetPower();
    uniforms.streetIntensity.value=roadLamps;
    uniforms.tunnelPhase.value=tunnelOffset(origin);
    uniforms.tunnelLength.value=TUNNEL_LENGTH;
    uniforms.fog.value=world.fog;
    uniforms.animatedTheme.value=Number(usesAnimatedTheme());
    uniforms.twilight.value=world.twilight;
    used=0;
    shadowCasters.length=0;
    cabinGlass.length=0;
    back=origin-graphics.road*clamp(1-yawCos,.06,1);
    forward=origin+graphics.road*clamp(1+yawCos,.06,1);
    uniforms.seaHorizon.value=distantSeaColor();
    uniforms.oceanRange.value=[back-origin,forward-origin];
    lampGlows.length=0;
    roadMesh();renderLocalRoads();scenery();streetDistricts();tunnels();landscapes();windFarm();chamLandmark();mountainWaterfall();
    eachTrailProp(back-4,forward,(x,z,y,width,height,length,area)=>{
      const colors=area===2?['#727b72','#535d62','#8b9080']:['#937d61','#625543','#ac9472'];
      if(Math.abs(z-origin)<148) finishedProp(x,y,z,width,height,length,colors);
      else loft(solidFace,x,z,[[y,width,length],[y+height,width*.79,length*.76]],colors);
    });
    drawSkyTraffic3D(quad,origin,originX,foot.active?foot.z:state.z,world.time,LOOP,state.started);
    for(let z=Math.ceil((back-5)/LAMP)*LAMP;z<forward;z+=LAMP){
      const area=district(z);
      if(inTunnel(z)||(area!==0&&area!==4&&mod(z,4*LAMP)!==0)) continue;
      lightMesh(z,1);
      if(mod(z,2*LAMP)===0) lightMesh(z,-1);
    }
    for(let i=Math.ceil((back-30)/240);i*240+25<forward;i++){
      const z=i*240+25;
      if(district(z)===0&&!inTunnel(z)) structure(z,i%2===0);
    }
    // Dùng cùng loại phương tiện với mô phỏng để mẫu xe, đèn và kích thước khớp nhau.
    for(const car of traffic){
      const d=relativeDistance(origin,car.z);
      if(origin+d<back-6||origin+d>forward) continue;
      const takeover=vehicleTakeover?.car===car?vehicleTakeover:null;
      const driver=car.parked||takeover?.mode==='take'&&takeover.elapsed>=.63?null:drivingLook(car);
      carMesh(origin+d,car.x,car.color,car.brake,carYaw(car),1,false,car.model??0,car.roll??0,car.wreck,false,driver,car.passenger,car.occupants,car.crash,car.wheelTravel,scorchAmount(car),takeover);
    }
    const parkedDepth=relativeDistance(origin,state.z);
    const carZ=origin+parkedDepth;
    const opacity=wreckExpired(state)?0:foot.active?Number(Math.abs(parkedDepth)<FAR):clamp((state.camera-.29)*3,0,1);
    for(const rider of sceneRiders()){
      const z=origin+relativeDistance(origin,rider.z);
      if(z>=back-6&&z<=forward) personMesh(rider,z,riderFallPose(rider));
    }
    if(drivingView) playerCabin(carZ,angle);
    const playerDoor=vehicleTakeover?.car===state?vehicleTakeover:null;
    if(opacity===1) carMesh(carZ,state.x,state.color,(state.v>=0&&active('brake'))||auto.brake,angle,1,true,state.model,state.roll??0,state.wreck,state.v<0,foot.active?null:drivingLook(state),null,state.occupants,state.crash,state.wheelTravel,scorchAmount(state),playerDoor);
    if(foot.active) personMesh(foot,foot.z,foot.fall,foot.firstPerson);
    drawBatch();
    if(opacity>0&&opacity<1){
      used=0;carMesh(carZ,state.x,state.color,(state.v>=0&&active('brake'))||auto.brake,angle,opacity,true,state.model,state.roll??0,state.wreck,state.v<0,foot.active?null:drivingLook(state),null,state.occupants,state.crash,state.wheelTravel,scorchAmount(state),playerDoor);
      drawBatch(true);
    }
    // Vẽ ánh đèn sau vật thể đặc để thân xe và lan can che sáng đúng theo chiều sâu.
    used=0;
    drawSunShadows();
    mountainWaterfall(true);
    if(roadLamps>0) for(const car of traffic){
      const distance=relativeDistance(origin,car.z);
      if(!car.wreck&&Math.abs(distance)<145&&origin+distance>=back-6) trafficHeadlights(origin+distance,car.x,carYaw(car),car.model??0);
    }
    drawSkyContrail(quad,skyFlightClock.plane,world.time,foot.active?foot.z:state.z,LOOP);
    drawLampGlows();
    drawSandFootprints();
    drawVehicleDamage();
    cabinGlass.sort((a,b)=>b.depth-a.depth);
    for(const glass of cabinGlass) quad(...glass.points,glass.color,glass.alpha,-1);
    drawBatch(true,false);
    finishEffects();
    return true;
  }
  canvas.dataset.renderer='threejs';
  return {canvas,draw};
}
