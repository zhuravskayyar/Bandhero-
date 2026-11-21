'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildInstrumentExpansion}=require('./assets/expansion-instruments.js');

function fixture(inst='flute',gear={}){
  const w={p:{x:0,y:0,fx:1,fy:0,hp:100},mobs:[],eshots:[],t:0};
  const hits=[],parries=[];let active=null,id=0;
  const api={T:x=>x,E:(midi,vel,dur,o)=>({midi,vel,dur,...o}),up:(pc,low)=>low+((pc-low)%12+12)%12,
    tones:(ch,low,n)=>Array.from({length:n},(_,i)=>low+[0,4,7,12][i]),lv:L=>1+.3*(L-1),
    nearest:()=>w.mobs.filter(m=>m.hp>0).slice(0,1),aim:m=>m?Math.atan2(m.y-w.p.y,m.x-w.p.x):0,
    pedalEffects:()=>gear,meta:()=>({owner:null,inst,layer:'test',visualId:++id}),
    withAttack:(f,fn)=>{active=f;try{return fn();}finally{active=null;}},
    hurtMob:(m,dmg,kx,ky)=>{if(m.boss){kx=ky=0;m.slow=0;}m.hp-=dmg;hits.push({m,dmg,kx,ky,time:w.t,inst:active.inst,owner:active.owner});},
    reflectNote:(e,f)=>{e.fr=true;parries.push(f);},get G(){return w;},get SONG(){return {genre:'lofi'};},get ATK_SCALE(){return 1;}};
  const module=buildInstrumentExpansion(api),mob=(x,y=0)=>{const m={x,y,r:8,hp:10000};w.mobs.push(m);return m;};
  function run(seconds,visual=false){const n=Math.ceil(seconds/.01);for(let i=0;i<n;i++){w.t+=.01;(visual?module.interpolate:module.update)(.01);}}
  return {w,hits,parries,module,mob,run};
}

test('new instrument parts keep exactly the same notes and times at every upgrade rank',()=>{
  const f=fixture(),ch={root:0};
  for(const [inst,layers] of Object.entries(f.module.layers)){
    assert.equal(layers.length,4);assert.equal(f.module.gear[inst].length,4);
    for(const layer of layers){
      const notes=L=>JSON.stringify(Array.from({length:128},(_,step)=>layer.steps(ch,step%16,step>>4,L)));
      assert.notEqual(notes(1),JSON.stringify(Array.from({length:128},()=>[])),inst+'/'+layer.id+' plays');
      for(let rank=2;rank<=5;rank++)assert.equal(notes(rank),notes(1),inst+'/'+layer.id+' keeps rhythm and notes');
      assert.ok(layer.icon);assert.equal(layer.lv.length,3);
    }
  }
});

test('starter parts hold a fixed note or simultaneous chord without rotating between hits or bars',()=>{
  const f=fixture();
  for(const root of [0,3,7,11])for(const [inst,layers] of Object.entries(f.module.layers)){
    const part=layers[0],ch={root},barNotes=[];
    for(let bar=0;bar<12;bar++){
      const notes=[];for(let step=0;step<16;step++)notes.push(...part.steps(ch,step,bar,1).map(e=>e.midi));
      assert.ok(notes.length>0,inst+' keeps its rhythm');
      const allowed=inst==='accordion'?[root,(root+4)%12,(root+7)%12]:[root];
      assert.equal(new Set(notes).size,allowed.length,inst+' holds a fixed voicing');
      assert.ok(notes.every(m=>allowed.includes(m%12)),inst+' follows the actual chord');barNotes.push(notes);
    }
    for(const notes of barNotes)assert.deepEqual(notes,barNotes[0],inst+' repeats the same starter part');
  }
});

test('all accordion parts hold the same chord together without arpeggios or register changes',()=>{
  const f=fixture('accordion'),ch={root:0,q:'m',pcs:[0,3,7]},block=[60,63,67];
  for(const layer of f.module.layers.accordion)for(let bar=0;bar<12;bar++)for(let step=0;step<16;step++){
    const evs=layer.steps(ch,step,bar,1);if(!evs.length)continue;
    if(layer.id==='bass')assert.ok(evs.every(e=>e.midi%12===0));else assert.deepEqual(evs.map(e=>e.midi),block);
    for(const e of evs){assert.ok(e.holdSteps>0&&e.holdSteps<=16-step);assert.equal(e.fixedRegister,true);assert.equal(e.harmony,'0:m');assert.ok(!e.off&&!e.seconds,'all chord voices start together and use the bellows gate');}
  }
});

test('new instruments have distinct starter rhythms without adding hits or changing the held chord',()=>{
  const f=fixture(),rhythms=new Set(),counts={flute:4,violin:2,sax:2,accordion:2};
  for(const [inst,layers] of Object.entries(f.module.layers)){
    const beats=[];for(let step=0;step<16;step++)if(layers[0].steps({root:0},step,0,1).length)beats.push(step);
    assert.equal(beats.length,counts[inst],inst+' keeps its note density');rhythms.add(JSON.stringify(beats));
  }
  assert.equal(rhythms.size,4,'flute, violin, sax and accordion each phrase their own part');
});

test('flute notes hit once outbound and once returning, with opposite knockback',()=>{
  const f=fixture();const m=f.mob(150);
  f.module.layers.flute[0].atk([],1);f.run(1.4);
  assert.equal(f.hits.filter(h=>h.m===m).length,2);
  assert.ok(f.hits[0].kx>0);assert.ok(f.hits[1].kx<0);
  assert.equal(f.w.instrumentFX.length,0);
});

test('violin strings damage only their line, at bounded intervals, and expire',()=>{
  const f=fixture('violin'),m=f.mob(100),off=f.mob(100,80);
  f.module.layers.violin[0].atk([],1);f.run(1.8);
  const hits=f.hits.filter(h=>h.m===m);assert.ok(hits.length>=4&&hits.length<=6);
  for(let i=1;i<hits.length;i++)assert.ok(hits[i].time-hits[i-1].time>=.299);
  assert.equal(f.hits.filter(h=>h.m===off).length,0);assert.equal(m.slowAmt,.12);
  assert.equal(f.w.instrumentFX.length,0);const total=f.hits.length;f.run(.5);assert.equal(f.hits.length,total);
});

test('sax sustained cone ticks without hitting outside its sector',()=>{
  const f=fixture('sax'),m=f.mob(100),side=f.mob(100,90),far=f.mob(500);
  f.module.layers.sax[0].atk([],1);f.run(1);
  assert.ok(f.hits.filter(h=>h.m===m).length>=4);
  assert.equal(f.hits.filter(h=>h.m===side||h.m===far).length,0);
  assert.equal(f.w.instrumentFX.length,0);
});

test('accordion pulls then pushes once per phase; bosses use the normal immunity path',()=>{
  const f=fixture('accordion'),m=f.mob(100),boss=f.mob(100);boss.boss=true;
  f.module.layers.accordion[0].atk([],1);f.run(.9);
  const hits=f.hits.filter(h=>h.m===m);assert.equal(hits.length,2);assert.ok(hits[0].kx<0);assert.ok(hits[1].kx>0);
  assert.ok(f.hits.filter(h=>h.m===boss).every(h=>h.kx===0&&h.ky===0));
});

test('long custom effects parry at most two notes and guest interpolation causes no damage',()=>{
  const f=fixture('sax');f.mob(100);
  f.w.eshots=Array.from({length:4},()=>({x:100,y:0,r:5,age:0,life:3}));
  f.module.layers.sax[0].atk([],1);f.run(.5);
  assert.equal(f.parries.length,2);assert.equal(f.w.eshots.filter(e=>e.fr).length,2);
  const copied=JSON.parse(JSON.stringify(f.w.instrumentFX,(k,v)=>k==='hit'?undefined:v));
  f.w.instrumentFX=copied;const before=f.hits.length,parries=f.parries.length;
  f.run(.5,true);assert.equal(f.hits.length,before);assert.equal(f.parries.length,parries);
});

test('new gear changes its advertised geometry and damage without changing note density',()=>{
  const a=fixture('flute'),b=fixture('flute',{wind:2,return:2});
  a.module.layers.flute[0].atk([],1);b.module.layers.flute[0].atk([],1);
  assert.ok(b.w.instrumentFX[0].range>a.w.instrumentFX[0].range);
  assert.ok(b.w.instrumentFX[0].dmg>a.w.instrumentFX[0].dmg);
  assert.equal(b.w.instrumentFX.length,a.w.instrumentFX.length);
});

test('returning notes follow their network owner and vanish if that owner leaves',()=>{
  const f=fixture(),shooter=f.w.p;
  f.module.layers.flute[0].atk([],1);const effect=f.w.instrumentFX[0];effect.owner='bird';
  f.w.players=[{id:'bird',p:shooter},{id:'other',p:{x:900,y:900,hp:100}}];
  f.w.p=f.w.players[1].p;f.run(.8);shooter.x=45;shooter.y=60;
  const before=f.hits.length;f.run(.4);
  assert.ok(Math.hypot(effect.x-shooter.x,effect.y-shooter.y)<30,'return follows the shooting actor, not the locally selected actor');
  assert.equal(f.hits.length,before);
  f.w.players=f.w.players.filter(a=>a.id!=='bird');f.run(.01);assert.equal(f.w.instrumentFX.length,0);
});

test('real offline voice buffers are finite, pitched, distinct and fade without a click',()=>{
  const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
  const context=vm.createContext({Float32Array,Math});vm.runInContext(fs.readFileSync(path.join(__dirname,'assets/expansion-audio.js'),'utf8'),context);
  const render=context.ExpansionAudio.render,sr=8000,f=200,spectra={};
  for(const inst of ['flute','violin','sax','accordion','synthbass','synthkeys','clavinet']){
    const {data,rate}=render(inst,f,4000,sr);assert.equal(rate,1);let energy=0;
    for(const sample of data){assert.ok(Number.isFinite(sample)&&Math.abs(sample)<=1.00001);energy+=sample*sample;}
    assert.ok(Math.sqrt(energy/data.length)>.05,inst+' produces audible energy');
    assert.equal(Math.abs(data[0]),0);assert.ok(Math.abs(data[data.length-1])<.01,inst+' releases smoothly');
    const harmonics=[];for(let h=1;h<=3;h++){let re=0,im=0;for(let n=0;n<data.length;n++){const a=2*Math.PI*f*h*n/sr;re+=data[n]*Math.cos(a);im+=data[n]*Math.sin(a);}harmonics.push(Math.hypot(re,im)/data.length);}
    assert.ok(harmonics[0]>.01,inst+' keeps the requested fundamental');spectra[inst]=harmonics;
  }
  assert.ok(spectra.flute[1]/spectra.flute[0]<.25,'flute is close to a pure tone');
  assert.ok(spectra.violin[1]/spectra.violin[0]>.45,'bowed strings have richer harmonics');
  assert.ok(spectra.sax[2]/spectra.sax[0]>.5,'sax has a strong reed-like third harmonic');
});

test('new sample loudness is matched by body energy with bounded gain and peak headroom',()=>{
  const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
  const context=vm.createContext({Float32Array,Math});vm.runInContext(fs.readFileSync(path.join(__dirname,'assets/expansion-audio.js'),'utf8'),context);
  const sr=8000,trim=context.ExpansionAudio.levelTrim;
  for(const amplitude of [.03,.06,.4,.9]){
    const data=Float32Array.from({length:8000},(_,n)=>amplitude*Math.sin(2*Math.PI*440*n/sr));
    const gain=trim({sampleRate:sr,length:data.length,numberOfChannels:1,getChannelData:()=>data});
    let energy=0;for(let n=640;n<5200;n++)energy+=(data[n]*gain)**2;
    assert.ok(Math.abs(Math.sqrt(energy/4560)-.14)<.001,'quiet samples and loud synths reach the same body level');
    assert.ok(gain<=8&&Math.max(...data)*gain<=.8);
  }
  const silence=new Float32Array(1000);assert.equal(trim({sampleRate:sr,length:silence.length,getChannelData:()=>silence}),1);
});

test('reed sustain loop preserves the sample attack and joins the body without a hard splice',()=>{
  const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');const context=vm.createContext({Float32Array,Math});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'assets/expansion-audio.js'),'utf8'),context);
  const make=(channels,length,sampleRate)=>{const data=Array.from({length:channels},()=>new Float32Array(length));return{length,sampleRate,numberOfChannels:channels,duration:length/sampleRate,getChannelData:c=>data[c]};};
  const source=make(2,24000,8000),original=[];
  for(let c=0;c<2;c++){const d=source.getChannelData(c);for(let n=0;n<d.length;n++)d[n]=.3*Math.sin(n*(c?.153:.157))+.04*Math.cos(n*.381);original.push(d.slice());}
  const loop=context.ExpansionAudio.reedLoop({createBuffer:make},source),a=Math.round(loop.start*8000),b=Math.round(loop.end*8000);
  assert.ok(loop.start>.1&&loop.end>loop.start+.5);assert.equal(loop.buffer.length,b);
  for(let c=0;c<2;c++){
    const data=loop.buffer.getChannelData(c);assert.ok(source.getChannelData(c).every((v,i)=>v===original[c][i]),'shared original sample is unchanged');
    assert.ok(data.subarray(0,a).every((v,i)=>v===original[c][i]),'the real attack remains intact');
    assert.equal(data[b-1],original[c][a-1],'loop end reaches the exact preceding sample of its start');
  }
});
