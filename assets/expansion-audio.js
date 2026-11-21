// Offline voices for the living woodwind, bowed string and reed instruments.
// Pure rendering function: also runs in the existing synthesis Web Worker.
(function(root){
'use strict';
function render(inst,f,len,sr){
  const out=new Float32Array(len),seconds=len/sr;
  const partials=inst==='synthbass'?[1,.35,.22,.15,.1,.07]:inst==='synthkeys'?[1,.5,.33,.25,.2,.16,.14,.12]:inst==='clavinet'?[1,.55,.36,.18,.15,.09]:inst==='flute'?[1,.16,.055,.025]:inst==='violin'?
    [1,.65,.48,.38,.29,.22,.18,.14,.1,.07,.04,.025]:inst==='sax'?
    [1,.48,.72,.3,.4,.17,.19,.08,.08,.035]:[1,.38,.45,.2,.21,.12,.1,.055];
  const voices=inst==='accordion'?[[.9987,.48],[1.0013,.48]]:inst==='synthkeys'?[[.998,.48],[1.002,.48]]:[[1,1]];
  for(const [detune,weight] of voices)for(let h=1;h<=partials.length;h++){
    const hz=f*h*detune;if(hz>=sr*.46)break;
    const w=2*Math.PI*hz/sr,sw=Math.sin(w),cw=Math.cos(w);
    let sn=0,cs=1;const amp=partials[h-1]*weight;
    for(let n=0;n<len;n++){out[n]+=sn*amp;const ns=sn*cw+cs*sw;cs=cs*cw-sn*sw;sn=ns;}
  }
  let peak=1e-9,breath=0;
  const attack=inst==='violin'?.075:inst==='accordion'?.04:inst==='synthbass'||inst==='clavinet'?.006:.028;
  const release=inst==='violin'?.24:inst==='flute'?.19:.14;
  for(let n=0;n<len;n++){
    const t=n/sr,a=Math.min(1,t/attack),r=Math.min(1,(seconds-t)/release);
    // An intentional held note with a rounded attack/release; no automatic pitch scoop.
    const body=inst==='clavinet'?Math.exp(-t*7):.8+.2*Math.exp(-t*3);
    if(inst==='flute'){breath=.7*breath+.3*(Math.random()*2-1);out[n]+=breath*.025;}
    out[n]*=a*Math.max(0,r)*body;peak=Math.max(peak,Math.abs(out[n]));
  }
  for(let n=0;n<len;n++)out[n]/=peak;
  return {data:out,rate:1};
}
function levelTrim(buffer){
  // Match the held body, not the very different attack peaks of flute/reeds/strings.
  const sr=buffer.sampleRate,start=Math.min(Math.floor(sr*.08),Math.floor(buffer.length/4)),end=Math.min(buffer.length,Math.floor(sr*.65));
  let energy=0,peak=0,count=0;
  for(let c=0;c<(buffer.numberOfChannels||1);c++){
    const data=buffer.getChannelData(c);
    for(let i=0;i<data.length;i++)peak=Math.max(peak,Math.abs(data[i]));
    for(let i=start;i<end;i++){energy+=data[i]*data[i];count++;}
  }
  const rms=Math.sqrt(energy/Math.max(1,count));
  if(rms<1e-5||!Number.isFinite(rms))return 1;
  return Math.min(8,.14/rms,.8/Math.max(peak,1e-5));
}
function reedLoop(ctx,source){
  const sr=source.sampleRate,n=source.length,channels=source.numberOfChannels||1;
  if(n<32)return {buffer:source,start:0,end:n/sr};
  const start=Math.max(4,Math.min(Math.floor(sr*.35),Math.floor(n*.2)));
  const end=Math.min(n,Math.max(start+8,Math.min(n-Math.floor(sr*.08),start+Math.floor(sr*1.5))));
  const fade=Math.max(2,Math.min(Math.floor(sr*.025),Math.floor(start/2),Math.floor((end-start)/4)));
  const buffer=ctx.createBuffer(channels,end,sr);
  for(let c=0;c<channels;c++){
    const data=source.getChannelData(c),out=buffer.getChannelData(c);out.set(data.subarray(0,end));
    // End on the samples immediately preceding the loop start: no hard splice.
    for(let i=0;i<fade;i++){const t=i/(fade-1),w=t*t*(3-2*t);out[end-fade+i]=data[end-fade+i]*(1-w)+data[start-fade+i]*w;}
  }
  return {buffer,start:start/sr,end:end/sr};
}
root.ExpansionAudio={render,levelTrim,reedLoop,instruments:['flute','violin','sax','accordion']};
})(typeof window!=='undefined'?window:globalThis);
