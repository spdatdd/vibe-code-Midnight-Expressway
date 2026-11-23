// Lập bảng cao độ bề mặt cabin theo X/Z từ đúng lưới thân và kính xe.
export function buildCabinRoof(Three,template,body){
  const step=.04,side=1.40,depth=3.8;
  const cols=Math.round(2*side/step),rows=Math.round(2*depth/step);
  const height=new Float32Array(cols*rows).fill(-Infinity);
  const points=Array.from({length:3},()=>new Three.Vector3());
  template.updateMatrixWorld(true);
  const meshes=[body,...body.children.filter(mesh=>mesh.isMesh&&mesh.material.name.startsWith('vehicle-glass-'))];
  for(const mesh of meshes){
    const {position}=mesh.geometry.attributes,index=mesh.geometry.index.array;
    for(let i=0;i<index.length;i+=3){
      for(let k=0;k<3;k++)points[k].fromBufferAttribute(position,index[i+k]).applyMatrix4(mesh.matrixWorld);
      const [a,b,c]=points,ux=b.x-a.x,uz=b.z-a.z,vx=c.x-a.x,vz=c.z-a.z;
      const area=ux*vz-uz*vx;
      if(Math.abs(area)<1e-6) continue;
      const x0=Math.max(0,Math.floor((Math.min(a.x,b.x,c.x)+side)/step));
      const x1=Math.min(cols-1,Math.floor((Math.max(a.x,b.x,c.x)+side)/step));
      const z0=Math.max(0,Math.floor((Math.min(a.z,b.z,c.z)+depth)/step));
      const z1=Math.min(rows-1,Math.floor((Math.max(a.z,b.z,c.z)+depth)/step));
      for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
        const dx=(x+.5)*step-side-a.x,dz=(z+.5)*step-depth-a.z;
        const v=(dx*vz-dz*vx)/area,w=(ux*dz-uz*dx)/area,u=1-v-w;
        if(Math.min(u,v,w)<-.035) continue;
        const index=z*cols+x;
        height[index]=Math.max(height[index],a.y*u+b.y*v+c.y*w);
      }
    }
  }
  // Tra quanh một ô để tránh một điểm lỗi ở đường nối lưới hoặc mép kính.
  return (x,z)=>{
    const i=Math.floor((x+side)/step),j=Math.floor((z+depth)/step);
    if(i<1||i>=cols-1||j<1||j>=rows-1) return null;
    const samples=[];
    for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
      const y=height[(j+dz)*cols+i+dx];
      if(Number.isFinite(y)) samples.push(y);
    }
    if(!samples.length) return null;
    samples.sort((a,b)=>a-b);
    return samples[Math.floor((samples.length-1)*.35)];
  };
}

// Lấy các điểm bao đầu từ chính các đỉnh được gắn trọng số vào xương đầu.
export function measureRigHead(Three,root){
  const mesh=root.getObjectByProperty('isSkinnedMesh',true);
  const bone=mesh?.skeleton.getBoneByName('Head');
  if(!bone) return [];
  root.updateMatrixWorld(true);
  const inverse=bone.matrixWorld.clone().invert(),bounds=new Three.Box3();
  const {skinIndex,skinWeight,position}=mesh.geometry.attributes;
  const head=mesh.skeleton.bones.indexOf(bone);
  const headJoints=new Set([head,...bone.children.map(joint=>mesh.skeleton.bones.indexOf(joint))]);
  const point=new Three.Vector3();
  for(let i=0;i<position.count;i++){
    let influence=0;
    for(let k=0;k<4;k++) if(headJoints.has(skinIndex.getComponent(i,k))) influence+=skinWeight.getComponent(i,k);
    if(influence<.52) continue;
    bounds.expandByPoint(mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse));
  }
  if(bounds.isEmpty()) return [];
  // Kiểm tra đỉnh đầu, gáy, trán và hai mép tóc mà không cần duyệt cả mesh mỗi khung.
  const center=bounds.getCenter(new Three.Vector3()),samples=[];
  for(const x of [bounds.min.x,center.x,bounds.max.x])for(const z of [bounds.min.z,center.z,bounds.max.z])
    samples.push(new Three.Vector3(x,bounds.max.y,z));
  samples.push(bounds.min.clone(),bounds.max.clone());
  return samples;
}
