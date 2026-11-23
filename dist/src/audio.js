import { clamp } from './constants.js';
import { closedCabinView } from './render2d.js';
import { coastShore, district, inTunnel, relativeDistance } from './route.js';
import { foot, get, labelControl, runtime, state, wind, world } from './runtime.js';
import { engineBlocked } from './traffic.js';

// Khởi tạo tiếng động cơ và các lớp tiếng gió, lốp, xe đi ngang.
export function tone(ac,destination,hz,endHz,volume,seconds,type,time=ac.currentTime){
  const osc=ac.createOscillator(),gain=ac.createGain();
  osc.type=type;osc.frequency.setValueAtTime(hz,time);osc.frequency.exponentialRampToValueAtTime(endHz,time+seconds);
  gain.gain.setValueAtTime(.001,time);gain.gain.linearRampToValueAtTime(volume,time+.012);
  gain.gain.exponentialRampToValueAtTime(.001,time+seconds);
  osc.connect(gain).connect(destination);osc.start(time);osc.stop(time+seconds+.02);
  osc.onended=()=>{osc.disconnect();gain.disconnect();};
}

export function crashSound(force){
  if(!runtime.audio||!runtime.audio.effectsOn||runtime.audio.ac.currentTime<runtime.audio.nextCrash) return;
  runtime.audio.nextCrash=runtime.audio.ac.currentTime+.12;
  tone(runtime.audio.ac,runtime.audio.master,175,36,Math.min(.5,force*.017),.27,'sawtooth');
}

export function createAudio() {
  const ac=new AudioContext(), master=ac.createGain();
  const effectsLimiter=ac.createDynamicsCompressor();
  effectsLimiter.threshold.value=-10;
  effectsLimiter.ratio.value=14;
  effectsLimiter.attack.value=.003;
  effectsLimiter.release.value=.13;
  master.gain.value=0;master.connect(effectsLimiter).connect(ac.destination);
  const engine=ac.createOscillator(), volume=ac.createGain();
  engine.type='triangle';engine.connect(volume).connect(master);engine.start();
  const buffer=ac.createBuffer(1,ac.sampleRate*2,ac.sampleRate), data=buffer.getChannelData(0);
  for(let i=0;i<data.length;i++) data[i]=Math.random()*2-1;
  const noise=ac.createBufferSource();
  noise.buffer=buffer;noise.loop=true;
  function ambience(type,frequency,q=.7){
    const filter=ac.createBiquadFilter(),gain=ac.createGain();
    filter.type=type;filter.frequency.value=frequency;filter.Q.value=q;gain.gain.value=0;
    noise.connect(filter).connect(gain).connect(master);
    return {filter,gain:gain.gain};
  }
  const air=ambience('lowpass',620),road=ambience('bandpass',210);
  const leaves=ambience('bandpass',1750),rain=ambience('highpass',2400),surf=ambience('lowpass',790);
  const passNoise=ac.createBiquadFilter(),passRoad=ac.createGain(),pass=ac.createOscillator();
  const passGain=ac.createGain(),pan=ac.createStereoPanner();
  pass.type='triangle';passNoise.type='bandpass';passNoise.frequency.value=390;
  passGain.gain.value=0;passRoad.gain.value=0;volume.gain.value=0;
  pass.connect(passGain).connect(pan).connect(master);
  noise.connect(passNoise).connect(passRoad).connect(pan);
  pass.start();noise.start();
  return {nextCrash:0,ac,master,engine,volume,air,road,leaves,rain,surf,pass,passGain,passRoad,pan};
}

// Âm môi trường theo địa hình, thời tiết và vị trí người nghe.
export function updateAudio(gas,car,distance,panning) {
  if(!runtime.audio) return;
  const {ac,engine,volume,air,road,leaves,rain,surf,pass,passGain,passRoad,pan}=runtime.audio;
  const listener=foot.active?foot:state,t=ac.currentTime,v=foot.active?0:Math.abs(state.v);
  const area=district(listener.z),indoors=inTunnel(listener.z),open=indoors?.07:foot.active||state.model===4?1:.58;
  const vegetation=area===6?1.35:area>=1&&area<=3?1:.22;
  const treeDistance=Math.abs(Math.abs(listener.x)-13);
  const waterDistance=area===3?Math.max(0,coastShore(listener.z).edge-listener.x)
    :area===4?10:area===2?Math.abs(listener.x+21):Infinity;
  const wave=.42+.58*(.5+.5*Math.sin(world.time*(area===2?1.8:1.23)))**2;
  const slip=clamp(Math.abs(state.slide??0)/5+Math.abs(state.steer)*v/30,0,1);
  road.filter.frequency.setTargetAtTime(210+slip*860,t,.07);
  engine.frequency.setTargetAtTime(37+v*1.7+(gas?15:0),t,.13);
  volume.gain.setTargetAtTime(foot.active||engineBlocked(state)?0:gas?.25:.15,t,.12);
  air.filter.frequency.setTargetAtTime(340+wind.strength*450+v*15,t,.14);
  air.gain.setTargetAtTime(closedCabinView()?0:.018+open*wind.strength*.15+v*.0035,t,.15);
  road.gain.setTargetAtTime(v*.0038+(foot.active?0:slip*.21),t,.15);
  leaves.gain.setTargetAtTime(closedCabinView()?0:open*vegetation*wind.strength*.16/(1+treeDistance/12),t,.20);
  rain.gain.setTargetAtTime(open*world.weather[0]*.075,t,.20);
  surf.gain.setTargetAtTime(open*wave*(area===2?.11:.17)*Math.max(0,1-waterDistance/43)**2,t,.24);
  const proximity=car?1/(1+(distance/10)**2):0;
  const passSpeed=Math.abs(car?.v??0);
  const shift=car&&relativeDistance(listener.z,car.z)>0?.93:1.07;
  pass.frequency.setTargetAtTime((car?.model===5?40:car?.model===4?78:54)*shift+passSpeed*2.3,t,.12);
  passGain.gain.setTargetAtTime(proximity*(car?.parked||car?.wreck?0:.035+passSpeed*.005),t,.10);
  passRoad.gain.setTargetAtTime(proximity*passSpeed*.004,t,.10);
  pan.pan.setTargetAtTime(panning,t,.12);
}

// Bật hoặc tắt âm thanh sau thao tác người chơi.
export async function toggleSound() {
  const button=get('sound'), enabled=button.getAttribute('aria-pressed')!=='true';
  try{
    runtime.audio??=createAudio();
    if(enabled) await runtime.audio.ac.resume();
    runtime.audio.effectsOn=enabled;
    if(!enabled&&typeof window!=='undefined') window.speechSynthesis?.cancel();
    runtime.audio.master.gain.setTargetAtTime(enabled?runtime.effectsLevel:0,runtime.audio.ac.currentTime,.07);
    button.setAttribute('aria-pressed',String(enabled));
    labelControl(button,enabled?'Tắt hiệu ứng âm thanh':'Bật hiệu ứng âm thanh');
  }catch{labelControl(button,'Âm thanh không khả dụng');}
}
