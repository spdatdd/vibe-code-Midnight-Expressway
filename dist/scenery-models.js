'use strict';

// Lưới nguyên bản, dùng chung kích thước và bảng màu cho cả hai mức chi tiết.
const roadsideModels=(()=>{
  function bake(draw,detail){
    const positions=[],surfaces=new Map(),vertices=new Map();
    const face=(a,b,c,d,color)=>{
      if(!surfaces.has(color)) surfaces.set(color,[]);
      const indices=surfaces.get(color);
      const [first,second,third,fourth]=(d?[a,b,c,d]:[a,b,c]).map(p=>{
        const vertex=p.map(v=>Math.round(v*1024)),key=vertex.join(',');
        if(!vertices.has(key)){
          vertices.set(key,positions.length/3);
          positions.push(...vertex);
        }
        return vertices.get(key);
      });
      if(first!==second&&second!==third&&third!==first) indices.push(first,second,third);
      if(d&&first!==third&&third!==fourth&&fourth!==first) indices.push(first,third,fourth);
    };
    draw(face,detail);
    return {positions,surfaces:[...surfaces]};
  }
  const model=draw=>({near:bake(draw,true),far:bake(draw,false)});
  function block(face,x,y,z,w,h,d,colors){
    const a=x-w/2,b=x+w/2,n=z-d/2,f=z+d/2,t=y+h;
    face([a,y,n],[b,y,n],[b,t,n],[a,t,n],colors[0]);
    face([a,y,f],[b,y,f],[b,t,f],[a,t,f],colors[0]);
    face([a,y,n],[a,y,f],[a,t,f],[a,t,n],colors[1]);
    face([b,y,n],[b,y,f],[b,t,f],[b,t,n],colors[1]);
    face([a,t,n],[b,t,n],[b,t,f],[a,t,f],colors[2]);
  }
  function roof(face,x,z,w,d,y,peak,tile,hip,detail){
    const a=x-w*.5,b=x+w*.5,n=z-d*.5,f=z+d*.5;
    const g=[a+w*hip,peak,z],h=[b-w*hip,peak,z];
    face([a,y,n],[b,y,n],h,g,tile[0]);
    face([b,y,f],[a,y,f],g,h,tile[1]);
    face([a,y,n],[a,y,f],g,null,hip?tile[2]:tile[3]);
    face([b,y,f],[b,y,n],h,null,hip?tile[2]:tile[3]);
    if(detail) for(const side of [-1,1]) for(const band of [.3,.58,.83]){
      const at=z+side*(1-band)*d*.5,high=y+(peak-y)*band+.003;
      const inset=w*hip*band;
      face([a+inset,high,at],[b-inset,high,at],[b-inset,high-.012,at+side*.013],
        [a+inset,high-.012,at+side*.013],tile[2]);
    }
  }
  function dwelling(form,face,detail){
    const walls=[['#e6bf8b','#ad8065','#f2d5a9'],['#b3c5b8','#779984','#d0d7b9'],['#ddd0b2','#ac986f','#ede0bd']][form];
    const tile=[['#a4533e','#743c36','#c67852',walls[1]],['#487774','#385559','#649491',walls[1]],
      ['#975644','#6b403d','#b77c53',walls[1]]][form];
    const plaster=form===1?.72:.61;
    block(face,0,0,0,.87,plaster,.81,walls);
    block(face,0,0,0,.91,.095,.85,['#6c665c','#585953','#998e76']);
    roof(face,0,0,1,1,plaster,1,tile,form===2?.04:.19,detail);
    const porch=form===2?-.19:form===1?.16:0;
    block(face,porch,.025,.434,.47,.055,.13,['#a1937b','#746c5d','#beb19a']);
    roof(face,porch,.40,.50,.19,.57,.65,tile,.19,detail);
    block(face,porch,.073,.407,.153,.37,.026,['#527773','#375653','#7da19a']);
    for(const side of [-1,1]){
      block(face,porch+side*.215,.068,.474,.039,.52,.04,walls);
      const wx=side*.297;
      block(face,wx,.277,.410,.154,.156,.016,['#2f4f57','#304a50','#9badab']);
      if(detail){
        block(face,wx,.263,.418,.180,.022,.031,['#e4cfa7','#c0a582','#ffe0b2']);
        block(face,wx,.28,.42,.018,.151,.011,['#a98568','#72543e','#d5b995']);
        block(face,side*.438,.26,.04,.015,.17,.20,['#426876','#395458','#aaa88f']);
      }
    }
    if(form===1) block(face,-.27,plaster,.13,.19,.18,.23,walls);
  }
  function crown(face,{x,y,z,width,depth,height,rings,sides,phase,colors}){
    let previous=null,previousSpread=0;
    for(const [level,spread] of rings){
      const ring=Array.from({length:sides},(_,i)=>{
        const angle=i*2*Math.PI/sides+phase;
        return [x+Math.cos(angle)*width*spread,y+height*level,z+Math.sin(angle)*depth*spread];
      });
      if(previous) for(let i=0;i<sides;i++){
        const j=(i+1)%sides;
        const shade=colors[(i+(level>.4?2:0))%colors.length];
        if(spread===0) face(previous[i],previous[j],ring[j],null,shade);
        else if(previousSpread===0) face(previous[i],ring[j],ring[i],null,shade);
        else face(previous[i],previous[j],ring[j],ring[i],shade);
      }
      previous=ring;
      previousSpread=spread;
    }
  }
  function tree(form,face,detail){
    const bark=['bark','barkShade','barkLight'];
    const leaves=['leaves','leafShade','leafLight'];
    const sides=detail?7:5;
    const trunk=(x,y,z,high,radius)=>crown(face,{x,y,z,width:radius,depth:radius,height:high,
      rings:[[0,1],[.73,.68],[1,.29]],sides:detail?5:4,phase:.5,colors:bark});
    if(form===3){
      const at=y=>[y*y*.15,y,y*.024];
      for(let row=0;row<4;row++){
        const a=at(row*.20),b=at((row+1)*.20);
        const size=.037-row*.005;
        for(let i=0;i<5;i++){
          const pa=i*2*Math.PI/5,pb=(i+1)*2*Math.PI/5;
          const p=(v,t)=>[v[0]+Math.cos(t)*size,v[1],v[2]+Math.sin(t)*size];
          face(p(a,pa),p(a,pb),p(b,pb),p(b,pa),bark[(i+row)%3]);
        }
      }
      const hub=at(.80);
      for(let i=0;i<(detail?8:6);i++){
        const angle=i*2*Math.PI/(detail?8:6),s=Math.sin(angle),c=Math.cos(angle);
        const p=(radius,y,w)=>[hub[0]+radius*c-w*s,y,hub[2]+radius*s+w*c];
        face(hub,p(.15,.94,-.05),p(.23,.91,0),p(.15,.94,.055),leaves[i%3]);
        face(p(.15,.94,-.05),p(.40,.74,0),p(.23,.91,0),null,leaves[0]);
        face(p(.15,.94,.055),p(.23,.91,0),p(.40,.74,0),null,leaves[2]);
        if(detail) face(p(.23,.91,-.012),p(.36,.80,-.058),p(.40,.74,0),null,leaves[1]);
      }
    }else{
      trunk(0,0,0,form===2?.81:.78,form===1?.060:.049);
      if(form===2){
        for(let tier=0;tier<3;tier++){
          const radius=.245-tier*.042;
          crown(face,{x:0,y:.25+tier*.16,z:0,width:radius,depth:radius,height:.43,
            rings:[[0,0],[.16,1],[.32,.81],[1,0]],sides,phase:tier*.38,colors:leaves});
        }
      }else{
        const clusters=form===1?[[-.18,.72,.01,.23],[.10,.72,-.04,.26],[.02,.82,.10,.23]]
          :[[-.095,.65,.03,.18],[.12,.73,-.045,.19],[0,.81,.02,.23]];
        for(const [x,y,z,radius] of clusters) crown(face,{x,y,z,width:radius,depth:radius*.85,height:form===1?.30:.35,
          rings:[[-.60,0],[-.39,.67],[.02,1],[.37,.76],[.58,0]],sides,phase:x*3,colors:leaves});
      }
    }
  }
  return {houses:[0,1,2].map(form=>model((face,detail)=>dwelling(form,face,detail))),
    trees:[0,1,2,3].map(form=>model((face,detail)=>tree(form,face,detail)))};
})();
