export const TAU = Math.PI * 2;

// Một đơn vị tọa độ và khoảng cách tương ứng một mét.
export const LANE_WIDTH=3.8;

export const ROAD = 3*LANE_WIDTH, LOOP = 6400, FAR = 440, SCENERY_FAR = 635, LAMP = 32;

export const HORIZON_RATIO = .43;

export const vietnamScenes=[
  [{name:'Phố Sài Gòn',style:'saigon'},{name:'Phố Hà Nội',style:'hanoi'},{name:'Phố Huế',style:'hue'}],
  [{name:'Đồng Tháp Mười',style:'lotus'},{name:'Làng ven sông miền Tây',style:'delta'},{name:'Đồng quê Bắc Bộ',style:'rice'}],
  [{name:'Mù Cang Chải',style:'terraces'},{name:'Đèo Hải Vân',style:'pass'},{name:'Cao nguyên Hà Giang',style:'karst'}],
  [{name:'Vịnh Hạ Long',style:'bay'},{name:'Bờ biển Nha Trang',style:'beach'},{name:'Mũi Né',style:'dunes'}],
  [{name:'Cầu Nhật Tân',style:'white'},{name:'Cầu Cần Thơ',style:'gold'},{name:'Cầu Mỹ Thuận',style:'blue'}],
  [{name:'Hầm Hải Vân',style:'warm'},{name:'Hầm Đèo Cả',style:'cool'}],
  [{name:'Rừng Cúc Phương',style:'forest'},{name:'Rừng Cát Tiên',style:'forest'}]
];

export const routeLengths=[1120,1280,1280,1280,920,520];

export const PASS_LENGTH=routeLengths[2],COAST_LENGTH=routeLengths[3];
export const COAST_SHORE_DISTANCE=52;

export const FOREST_LENGTH=520;

export const TUNNEL_MARGIN=40;

export const TUNNEL_LENGTH=routeLengths[5]-TUNNEL_MARGIN*2;

export const graphicsPresets={
  low:{road:320,scenery:420,detail:145,grass:2,grassRange:75,resolution:.75,
    house:140,tree:92,extraTree:70,vehicle:105,person:48},
  medium:{road:FAR,scenery:SCENERY_FAR,detail:230,grass:5,grassRange:145,resolution:1,
    house:140,tree:92,extraTree:70,vehicle:105,person:48},
  highest:{road:625,scenery:895,detail:365,grass:9,grassRange:265,resolution:1.15,
    house:220,tree:150,extraTree:115,vehicle:160,person:75}
};

export const VILLAGE_INTRO_LENGTH=480;

export const chaseDefaults={height:1.90,distance:8.5,offset:0};

export const cameraFields=Object.keys(chaseDefaults);

export const DISTANT_GROUND = '#1d284b';

export const SEASON_SECONDS=60, DAY_SECONDS=240;

export const bindings = {KeyW:'gas',ArrowUp:'gas',KeyS:'brake',ArrowDown:'brake',KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right'};

export const carColors = ['#503746','#29465b','#666275','#653d40','#726b5e'];

export const trafficModels=[1,2,3,4,5,1,3,2,5,0,4,1,3,2,5,1];

export const carProfile={halfLength:2.24,halfWidth:.95,mass:1450,roof:1.44,cruise:1,shiftSpeed:2.8};

export const sedanVariants=[carProfile,{...carProfile,halfLength:2.10,halfWidth:.94,mass:1310,roof:1.29},{...carProfile,halfLength:2.29,halfWidth:.98,mass:1550,roof:1.54},{...carProfile,halfLength:2.36,halfWidth:1.01,mass:1850,roof:1.69}];

export const motorcycleProfile={halfLength:1.23,halfWidth:.47,mass:240,roof:.93,cruise:1.04,shiftSpeed:3.05};

export const truckProfile={halfLength:3.6,halfWidth:1.22,mass:5400,roof:3.05,cruise:.76,shiftSpeed:1.95};

export const skinTones=[['#d49b79','#a76d55','#e3ad8b'],['#b98766','#815641','#c99b7b'],
  ['#e0b094','#ac7865','#efc0a1'],['#996c52','#714633','#b08261']];

export const shirts=[['#b9644f','#804638','#da856a'],['#587f82','#3b565e','#7e9e9a'],
  ['#8c7252','#594a40','#af9873'],['#62759c','#414c73','#7e90ae'],
  ['#7e567b','#533c5b','#a17b9c'],['#ad8149','#745735','#c89f61'],['#6f7754','#49523c','#8d9670']];

export const hairTones=[['#303144','#202636','#45485b'],['#524038','#352927','#64504a'],
  ['#3a3237','#232630','#51454b']];

export function newCharacter(random=Math.random){
  const pick=list=>list[Math.floor(random()*list.length)];
  const female=random()<.5,age=18+Math.floor(random()*61);
  const hair=age>=56&&random()<.83?pick([['#aaa5a1','#777476','#c4beb8'],['#d1c7bb','#a69e99','#e0d8cc']]):pick(hairTones);
  const pants=pick([['#414b66','#30384e','#566078'],['#695747','#4e4037','#85715b'],
    ['#42443d','#2a302b','#5b6451'],['#6b6b73','#50535d','#8a8590']]);
  return {female,age,skin:pick(skinTones),shirt:pick(shirts),hair,pants,
    scale:(female?.93:.99)+random()*.13,build:.85+random()*.22,
    hairStyle:Math.floor(random()*6),faceWidth:.22+random()*.061,faceDepth:.208+random()*.054,
    longHair:random()<(female?.64:.17),trim:random()<.44,glasses:random()<(age>=50?.39:.14),
    beard:!female&&random()<.30,outfit:Math.floor(random()*4)};
}

export const MAX_TRAFFIC_VEHICLES=14;

export const RECLAIM_GRACE_SECONDS=4;

export const FOOT_RADIUS=.29;

export const SOLO_TOP_SPEED=250/3.6;

// Giới hạn và nội suy giá trị dùng trong mô phỏng và kết xuất.
export const clamp = (v,a,b) => Math.max(a,Math.min(b,v));

export const lerp = (a,b,t) => a+(b-a)*t;

// Đưa tọa độ về chu kỳ dương và tạo số giả ngẫu nhiên ổn định theo chỉ số.
export const mod = (v,n) => ((v%n)+n)%n;

export const hash = n => mod(Math.sin(n*127.1+39.7)*43758.5453,1);

export const LOCAL_LENGTH=385,LOCAL_JUNCTION=177;

// Tạo hạt thời tiết một lần để chuyển động lặp ổn định và nhẹ.
export const particles=Array.from({length:104},(_,i)=>[hash(i+900),hash(i+1300),hash(i+1500)]);
