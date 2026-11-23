// Tạo mặt nạ phát sáng cố định theo UV để mipmap lọc ổn định khi camera di chuyển.
export function bakeSurfaceLightMask(Three, geometry, map, classify, size=768){
  const image=map?.image,uv=geometry.attributes.uv,position=geometry.attributes.position;
  if(!image||!uv||!geometry.index) return null;
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(image,0,0,size,size);
  const source=ctx.getImageData(0,0,size,size).data;
  const result=new Uint8Array(size*size*4);
  const indices=geometry.index.array;
  // Đọc tọa độ model và UV của một đỉnh.
  const vertex=id=>[position.getX(id),position.getY(id),position.getZ(id),uv.getX(id)*size,uv.getY(id)*size];
  for(let i=0;i<indices.length;i+=3){
    const a=vertex(indices[i]),b=vertex(indices[i+1]),c=vertex(indices[i+2]);
    const paint=classify(a,b,c);
    if(!paint) continue;
    const u1=b[3]-a[3],v1=b[4]-a[4],u2=c[3]-a[3],v2=c[4]-a[4];
    const area=u1*v2-v1*u2;
    if(Math.abs(area)<1e-6) continue;
    const firstX=Math.max(0,Math.floor(Math.min(a[3],b[3],c[3])));
    const lastX=Math.min(size-1,Math.ceil(Math.max(a[3],b[3],c[3])));
    const firstY=Math.max(0,Math.floor(Math.min(a[4],b[4],c[4])));
    const lastY=Math.min(size-1,Math.ceil(Math.max(a[4],b[4],c[4])));
    for(let y=firstY;y<=lastY;y++) for(let x=firstX;x<=lastX;x++){
      const u=x+.5-a[3],v=y+.5-a[4];
      const w1=(u*v2-v*u2)/area,w2=(u1*v-v1*u)/area,w0=1-w1-w2;
      if(Math.min(w0,w1,w2)<-.025) continue;
      const pixel=(y*size+x)*4;
      paint(result,source,pixel,w0,w1,w2);
    }
  }
  const texture=new Three.DataTexture(result,size,size);
  texture.generateMipmaps=true;
  texture.minFilter=map.minFilter;
  texture.magFilter=Three.LinearFilter;
  texture.needsUpdate=true;
  return texture;
}

// Chuyển dải giá trị kẹp thành độ sáng mượt, tránh viền bật tắt theo từng pixel.
function ramp(from,to,value){
  const t=Math.min(1,Math.max(0,(value-from)/(to-from)));
  return t*t*(3-2*t);
}

// Lấy các vùng kính tối trên mặt đứng từ texture gốc, loại mái và tầng sát đất.
export function windowMaskForFace(a,b,c){
  const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2];
  const vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
  const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
  const length=Math.hypot(nx,ny,nz);
  if(!length||Math.abs(ny)>.54*length||Math.max(a[1],b[1],c[1])<-.33) return null;
  const wall=1-ramp(.18,.54,Math.abs(ny)/length);
  // Ghi ánh sáng vào texel có màu và cao độ phù hợp trên mặt đứng.
  return (output,source,i,u,v,w)=>{
    const y=a[1]*u+b[1]*v+c[1]*w;
    const r=source[i],g=source[i+1],blue=source[i+2];
    const brightness=.38*r+.45*g+.17*blue-Math.min(18,Math.max(0,blue-r-12)*.42);
    const level=(1-ramp(58,119,brightness))*ramp(-.37,-.28,y)*wall;
    output[i]=Math.max(output[i],Math.round(level*255));
  };
}

// Tạo kênh đèn pha và đèn hậu trên đúng phần lens của texture xe.
export function vehicleMaskForFace(lamps,a,b,c){
  const candidates=lamps.filter(({local:[x,y,z],width,height,tilt})=>
    Math.min(a[0],b[0],c[0])<x+.12&&Math.max(a[0],b[0],c[0])>x-.12
    &&Math.min(a[1],b[1],c[1])<y+height+width*Math.abs(tilt)
    &&Math.max(a[1],b[1],c[1])>y-height-width*Math.abs(tilt)
    &&Math.min(a[2],b[2],c[2])<z+width&&Math.max(a[2],b[2],c[2])>z-width);
  if(!candidates.length) return null;
  // Lọc màu vỏ xe ra khỏi lens và bám đúng chiều sâu của cụm đèn.
  return (output,source,i,u,v,w)=>{
    const x=a[0]*u+b[0]*v+c[0]*w,y=a[1]*u+b[1]*v+c[1]*w,z=a[2]*u+b[2]*v+c[2]*w;
    const r=source[i],g=source[i+1],blue=source[i+2];
    for(const {local:[lx,ly,lz],front,width,height,tilt} of candidates){
      const dz=z-lz,dy=y-ly-dz*Math.sign(lz)*tilt;
      const shape=1-ramp(.54,1,Math.hypot(dz/width,dy/height));
      const depth=1-ramp(.035,.095,Math.abs(x-lx));
      const bright=Math.max(r,g,blue);
      const lens=front
        ? ramp(28,102,bright)*ramp(.37,.75,Math.min(r,g,blue)/Math.max(1,bright))
        : Math.max(ramp(7,42,r-Math.min(g,blue)),.18*(1-ramp(.10,.56,Math.hypot(dz/width,dy/height))));
      const index=i+(front?0:1);
      output[index]=Math.max(output[index],Math.round(255*shape*depth*lens));
    }
  };
}
