import { mkdir, writeFile } from 'node:fs/promises';
import { Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

// Cung cấp thao tác đọc Blob cần cho trình xuất GLB trong Node.js.
globalThis.FileReader ??= class {
  async readAsArrayBuffer(blob) {
    this.result=await blob.arrayBuffer();
    this.onloadend?.();
  }
};

const dog=new Group();
dog.name='Vietnamese coastal dog';
const sphere=new SphereGeometry(1,12,8);
const tan=new MeshStandardMaterial({color:0xb66a35,roughness:.88});
const cream=new MeshStandardMaterial({color:0xe4c19b,roughness:.92});
const nose=new MeshStandardMaterial({color:0x261d1b,roughness:.55});
const collar=new MeshStandardMaterial({color:0x426864,roughness:.81});

// Dùng chung lưới đã làm mượt và tạo thể tích bằng tỉ lệ riêng của từng bộ phận.
function part(parent,name,material,x,y,z,width,height,length,tilt=0){
  const mesh=new Mesh(sphere,material);
  mesh.name=name;
  mesh.position.set(x,y,z);
  mesh.scale.set(width,height,length);
  mesh.rotation.x=tilt;
  parent.add(mesh);
  return mesh;
}

part(dog,'Body',tan,0,.40,-.045,.127,.125,.26);
part(dog,'Chest',cream,0,.40,.131,.109,.143,.13);
part(dog,'Neck',tan,0,.506,.168,.096,.126,.091,.4);
part(dog,'Head',tan,0,.60,.234,.106,.103,.113);
part(dog,'Muzzle',cream,0,.562,.313,.073,.051,.083);
part(dog,'Nose',nose,0,.574,.385,.038,.026,.029);
part(dog,'Collar',collar,0,.49,.154,.098,.026,.09,.25);

for(const [side,sign] of [['Left',-1],['Right',1]]){
  const ear=part(dog,side+'Ear',tan,sign*.071,.695,.198,.034,.084,.036,-.2);
  ear.rotation.z=-sign*.31;
  part(dog,side+'Eye',nose,sign*.073,.614,.299,.011,.013,.013);
  for(const [row,z] of [['Front',.139],['Back',-.215]]){
    // Các nhóm chân làm khớp để game áp pha bước riêng.
    const leg=new Group();
    leg.name=side+row;
    leg.position.set(sign*.083,.357,z);
    dog.add(leg);
    part(leg,'Upper',tan,0,-.084,0,.041,.112,.047);
    part(leg,'Lower',tan,0,-.204,-.011,.028,.102,.033,-.12);
    part(leg,'Paw',cream,0,-.323,.023,.034,.034,.053);
  }
}

const tail=new Group();
tail.name='Tail';
tail.position.set(0,.454,-.258);
dog.add(tail);
part(tail,'TailBase',tan,0,.066,-.061,.039,.13,.041,-.69);
part(tail,'TailCurl',tan,0,.158,-.082,.035,.083,.038,.80);
part(tail,'TailTip',cream,0,.187,-.032,.029,.051,.031,.96);

const output=new URL('../assets/models/coastal-dog.glb',import.meta.url);
await mkdir(new URL('.',output),{recursive:true});
const glb=await new GLTFExporter().parseAsync(dog,{binary:true});
await writeFile(output,Buffer.from(glb));
