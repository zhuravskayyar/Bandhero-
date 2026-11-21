// Minimal SoundFont 2 (.sf2) reader: renders one note of a preset into a mono Float32Array.
// Used for the A320U bank (assets/soundfonts/, GPL v2, Milton Paredes; see CREDITS.txt).
// Pure function, no Web Audio: the game wraps the result in an AudioBuffer, tests run it in Node.
(function(root){
'use strict';
// generator numbers from the SF2 2.01 spec
const G={start:0,end:1,loopStart:2,loopEnd:3,startCoarse:4,endCoarse:12,attack:34,hold:35,decay:36,sustain:37,
  instrument:41,keyRange:43,velRange:44,loopStartCoarse:45,attenuation:48,loopEndCoarse:50,coarseTune:51,fineTune:52,
  sampleID:53,sampleModes:54,scaleTuning:56,rootKey:58};
const DEFAULTS={[G.attack]:-12000,[G.hold]:-12000,[G.decay]:-12000,[G.scaleTuning]:100,[G.rootKey]:-1};
// these are replaced, never summed, when the preset level is added on top of the instrument level
const NOT_ADDITIVE=new Set([G.start,G.end,G.loopStart,G.loopEnd,G.startCoarse,G.endCoarse,G.loopStartCoarse,G.loopEndCoarse,
  G.keyRange,G.velRange,G.sampleID,G.sampleModes,G.rootKey,G.instrument]);
const str=(dv,o,n)=>{let s='';for(let i=0;i<n;i++){const c=dv.getUint8(o+i);if(!c)break;s+=String.fromCharCode(c);}return s;};

function parse(ab){
  const dv=new DataView(ab),chunks={};
  if(str(dv,0,4)!=='RIFF'||str(dv,8,4)!=='sfbk')throw new Error('not an SF2 file');
  (function walk(o,end){
    while(o+8<=end){
      const id=str(dv,o,4),size=dv.getUint32(o+4,true);
      if(id==='LIST')walk(o+12,o+8+size);else chunks[id]={o:o+8,size};
      o+=8+size+(size&1);
    }
  })(12,ab.byteLength);
  if(!chunks.smpl||!chunks.phdr||!chunks.shdr)throw new Error('SF2 without samples or presets');
  const smpl=chunks.smpl.o%2===0?new Int16Array(ab,chunks.smpl.o,chunks.smpl.size>>1):new Int16Array(ab.slice(chunks.smpl.o,chunks.smpl.o+chunks.smpl.size));
  const rec=(id,size,fn)=>{const c=chunks[id],out=[];for(let o=c.o;o+size<=c.o+c.size;o+=size)out.push(fn(o));return out;};
  const phdr=rec('phdr',38,o=>({name:str(dv,o,20),preset:dv.getUint16(o+20,true),bank:dv.getUint16(o+22,true),bag:dv.getUint16(o+24,true)}));
  const bag=id=>rec(id,4,o=>dv.getUint16(o,true));
  const gen=id=>rec(id,4,o=>{const op=dv.getUint16(o,true);
    return op===G.keyRange||op===G.velRange?[op,[dv.getUint8(o+2),dv.getUint8(o+3)]]:[op,op===G.instrument||op===G.sampleID||op===G.sampleModes?dv.getUint16(o+2,true):dv.getInt16(o+2,true)];});
  const inst=rec('inst',22,o=>({name:str(dv,o,20),bag:dv.getUint16(o+20,true)}));
  const shdr=rec('shdr',46,o=>({name:str(dv,o,20),start:dv.getUint32(o+20,true),end:dv.getUint32(o+24,true),loopStart:dv.getUint32(o+28,true),
    loopEnd:dv.getUint32(o+32,true),rate:dv.getUint32(o+36,true),pitch:dv.getUint8(o+40),correction:dv.getInt8(o+41),type:dv.getUint16(o+44,true)}));
  // zones of each header: [{gens:Map}], the leading zone without its terminal generator is the global zone
  const zones=(headers,bags,gens,terminal)=>headers.slice(0,-1).map((h,i)=>{
    const list=[];for(let b=h.bag;b<headers[i+1].bag;b++){const m=new Map(gens.slice(bags[b],bags[b+1]).map(([k,v])=>[k,v]));list.push(m);}
    const global=list.length&&!list[0].has(terminal)?list.shift():new Map();
    return {...h,global,zones:list.filter(z=>z.has(terminal))};
  });
  const presets=zones(phdr,bag('pbag'),gen('pgen'),G.instrument),instruments=zones(inst,bag('ibag'),gen('igen'),G.sampleID);
  return new Bank(presets,instruments,shdr,smpl);
}

const inRange=(zone,global,op,v)=>{const r=zone.get(op)||global.get(op);return !r||(v>=r[0]&&v<=r[1]);};
const seconds=tc=>Math.pow(2,tc/1200);

class Bank{
  constructor(presets,instruments,samples,smpl){this.presets=presets;this.instruments=instruments;this.samples=samples;this.smpl=smpl;}
  list(){return this.presets.map(p=>({bank:p.bank,preset:p.preset,name:p.name}));}
  find(bank,preset){return this.presets.find(p=>p.bank===bank&&p.preset===preset)||null;}
  has(bank,preset){return !!this.find(bank,preset);}
  // every sample zone that sounds for this key and velocity, with its merged generators
  voices(bank,preset,key,vel){
    const p=this.find(bank,preset),out=[];if(!p)return out;
    for(const pz of p.zones){
      if(!inRange(pz,p.global,G.keyRange,key)||!inRange(pz,p.global,G.velRange,vel))continue;
      const ins=this.instruments[pz.get(G.instrument)];if(!ins)continue;
      for(const iz of ins.zones){
        if(!inRange(iz,ins.global,G.keyRange,key)||!inRange(iz,ins.global,G.velRange,vel))continue;
        const g={...DEFAULTS};
        for(const [k,v] of ins.global)g[k]=v;for(const [k,v] of iz)g[k]=v;
        for(const src of [p.global,pz])for(const [k,v] of src)if(!NOT_ADDITIVE.has(k))g[k]=(g[k]||0)+v;
        const sample=this.samples[g[G.sampleID]];if(sample&&sample.type<0x8000)out.push({sample,g});
      }
    }
    return out;
  }
  // One note: loop unrolled, pitch shifted, SF2 volume envelope (attack/hold/decay to sustain).
  // Returns a mono Float32Array at `sampleRate`, peak-normalised to `peak`, or null if the preset has no sound there.
  render(bank,preset,key,opt={}){
    const sr=opt.sampleRate||44100,len=Math.floor(sr*(opt.seconds||3)),vel=opt.vel||100,voices=this.voices(bank,preset,key,vel);
    if(!voices.length)return null;
    const out=new Float32Array(len),smpl=this.smpl;let last=0;
    for(const {sample:s,g} of voices){
      const v=k=>g[k]||0;
      const start=s.start+v(G.start)+32768*v(G.startCoarse),end=Math.min(smpl.length,s.end+v(G.end)+32768*v(G.endCoarse));
      const ls=s.loopStart+v(G.loopStart)+32768*v(G.loopStartCoarse),le=s.loopEnd+v(G.loopEnd)+32768*v(G.loopEndCoarse);
      const loop=(v(G.sampleModes)&1)===1&&le>ls+1&&le<=end;
      const root=g[G.rootKey]>=0?g[G.rootKey]:s.pitch>127?60:s.pitch;
      const cents=(key-root)*g[G.scaleTuning]+100*v(G.coarseTune)+v(G.fineTune)+s.correction;
      const step=Math.pow(2,cents/1200)*s.rate/sr,amp=Math.pow(10,-Math.max(0,v(G.attenuation))*.4/200)/32768;
      const attack=seconds(g[G.attack]),hold=seconds(g[G.hold]),decay=seconds(g[G.decay]),sustainDb=Math.min(144,Math.max(0,v(G.sustain))/10);
      let pos=start;
      for(let n=0;n<len;n++){
        if(loop){while(pos>=le)pos-=le-ls;}else if(pos>=end-1)break;
        const i=pos|0,f=pos-i,x=smpl[i]+(smpl[i+1]-smpl[i])*f,t=n/sr;
        const db=t<attack+hold?0:Math.min(sustainDb,100*(t-attack-hold)/decay);
        if(db>=96)break; // silent from here on
        out[n]+=x*amp*(t<attack?t/attack:1)*Math.pow(10,-db/20);
        pos+=step;if(n>last)last=n;
      }
    }
    const used=Math.min(len,last+1),fade=Math.min(used,Math.floor(sr*.03));
    let peak=1e-9;for(let n=0;n<used;n++)peak=Math.max(peak,Math.abs(out[n]));
    const k=(opt.peak||.9)/peak;for(let n=0;n<used;n++)out[n]*=k*(n>=used-fade?(used-n)/fade:1);
    return used<len?out.slice(0,used):out;
  }
}
root.SF2Bank={parse};
})(typeof window!=='undefined'?window:globalThis);
