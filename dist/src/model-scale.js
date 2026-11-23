import { hash } from './constants.js';

// Kích thước World 3D tính bằng mét, theo thứ tự ngang, cao và dọc.
export const modelMeters={
  dog:[.30,.61,1.02],
  boat:[2.8,2.35,8.4],
  streetlight:[1.7,6.49,.32],
  turbine:[54.8,121,12],
  cloud:[90,30,66],
  airliner:36,
  bird:1.08
};

// Chọn số tầng và mặt bằng phù hợp với mẫu nhà đang dùng.
export function cityModelSize(seed,urbanity,style,street=false){
  const shape=hash(seed+4);
  if(street||urbanity<.39||shape<.30){
    const height=10.3+hash(seed+8)*2.2;
    return {kind:'town',width:height*.52,height,depth:height*.95};
  }
  if(shape>.72&&style!=='hue'&&urbanity>.65){
    const height=39+hash(seed+8)*12;
    return {kind:'office',width:height*.46,height,depth:height*.36};
  }
  const height=26+hash(seed+8)*9;
  return {kind:'apartment',width:height*.48,height,depth:height*.51};
}
