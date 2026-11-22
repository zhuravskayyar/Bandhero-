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
    reflectNote:(e,f)=>{e.fr=true;parries.push(f);},isBoss:m=>!!m.boss,get G(){return w;},get SONG(){return {genre:'lofi'};},get ATK_SCALE(){return 1;}};
  const module=buildInstrumentExpansion(api),mob=(x,y=0)=>{const m={x,y,r:8,hp:10000};w.mobs.push(m);return m;};
  function run(seconds,visual=false){const n=Math.ceil(seconds/.01);for(let i=0;i<n;i++){w.t+=.01;(visual?module.interpolate:module.update)(.01);}}
  return {w,hits,parries,module,mob,run};
}

test('new instrument parts keep exactly the same notes and times at every upgrade rank',()=>{
  const f=fixture(),ch={root:0};
  for(const [inst,layers] of Object.entries(f.module.layers)){
    assert.equal(layers.length,inst==='accordion'?9:10);assert.equal(f.module.gear[inst].length,inst==='accordion'?12:10);
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
    if(inst==='flute'||inst==='sax')continue; // їхні перші партії — фрази зі стилем (тести сопілки/сакса нижче)
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

test('accordion chord layers play short staccato chords: one attack per chord, no held voices',()=>{
  const f=fixture('accordion'),ch={root:0,q:'m',pcs:[0,3,7]},block=[60,63,67];
  for(const id of ['bellows','chords','trem'])for(let bar=0;bar<4;bar++)for(let step=0;step<16;step++){
    const evs=f.module.layers.accordion.find(l=>l.id===id).steps(ch,step,bar,1);if(!evs.length)continue;
    assert.deepEqual(evs.map(e=>e.midi),block);
    assert.equal(evs.filter(e=>!e.noAtk).length,1,id+': a chord is one attack');
    for(const e of evs){assert.equal(e.holdSteps,1);assert.ok(e.seconds>0&&e.seconds<=.2,'staccato gate');assert.equal(e.fixedRegister,true);assert.ok(!e.voice&&!e.harmony,'no voice to carry over into the next note');}
  }
});

test('violin and accordion never hold a note: every note is short and every bar has at least two attacks at level 1',()=>{
  for(const inst of ['violin','accordion']){
    const f=fixture(inst),ch={root:0,q:'m',pcs:[0,3,7]};
    for(const layer of f.module.layers[inst])for(let bar=0;bar<4;bar++){
      const steps=[];let attacks=0;
      for(let s=0;s<16;s++){const evs=layer.steps(ch,s,bar,1);
        for(const e of evs){assert.ok(e.dur<=6,inst+'/'+layer.id+' note is not longer than 6 steps');assert.ok(!(e.seconds>.5),inst+'/'+layer.id+' gate is short');assert.ok(!(e.holdSteps>2),inst+'/'+layer.id+' no held reeds');}
        steps.push(evs);
        attacks+=layer.perNote?evs.filter(e=>!e.noAtk&&!e.orn).length:(evs.length?1:0);}
      assert.ok(attacks>=2,inst+'/'+layer.id+' bar '+bar+' has '+attacks+' attacks');
    }
  }
});

test('tarantella 6/8: bass on eighths 1 and 4, short chords on 3 and 6, triplet offsets stay inside the step',()=>{
  const f=fixture('accordion'),ch={root:0,q:'m',pcs:[0,3,7]},oom=f.module.layers.accordion.find(l=>l.id==='oompah'),sd=60/120/4;
  const hits=[];for(let s=0;s<16;s++)for(const e of oom.steps(ch,s,0,1))if(!e.noAtk)hits.push({at:(s+(e.off||0)/sd)*1,bass:e.midi<55});
  assert.equal(hits.length,8);
  assert.deepEqual(hits.filter(h=>h.bass).map(h=>Math.round(h.at*3)/3),[0,4,8,12],'bass on the 1st and 4th eighth of each 6/8 bar');
  assert.deepEqual(hits.filter(h=>!h.bass).map(h=>+h.at.toFixed(2)),[2.67,6.67,10.67,14.67],'chords on the 3rd and 6th eighth');
  for(const e of oom.steps(ch,2,0,1))assert.ok(e.off>0&&e.off<sd);
});

test('new instruments have distinct starter rhythms without adding hits or changing the held chord',()=>{
  const f=fixture(),rhythms=new Set(),counts={flute:4,violin:4,sax:2,accordion:2};
  for(const [inst,layers] of Object.entries(f.module.layers)){
    const beats=[],shape=[];for(let step=0;step<16;step++){const evs=layers[0].steps({root:0},step,0,1);if(evs.length){beats.push(step);shape.push([step,evs[0].vel]);}}
    assert.equal(beats.length,counts[inst],inst+' keeps its note density');rhythms.add(JSON.stringify(shape));
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

test('frog ring gear boosts strong beats and applies bounded slow and poison',()=>{
  const plain=fixture('accordion'),armed=fixture('accordion',{heavy:1,tongue:1,poison:1});
  plain.module.noteRing(1,{down:true});armed.module.noteRing(1,{down:true});
  assert.ok(Math.abs(armed.w.instrumentFX[0].dmg/plain.w.instrumentFX[0].dmg-1.5)<1e-9);
  const target=armed.mob(60),boss=armed.mob(60);boss.boss=true;armed.run(.25);
  assert.ok(target.slow>0&&Math.abs(target.slowAmt-.15)<1e-9);assert.ok(target.burn>0&&target.burnDmg>0);
  assert.ok(!boss.slow,'boss cannot be slowed');
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

// ---- нові види атак сопілки й сакса ----
const layerOf=(f,inst,id)=>f.module.layers[inst].find(l=>l.id===id);
const shotsOf=(f,m)=>f.hits.filter(h=>h.m===m);

test('flute leaves orbit the bird, tick damage at bounded intervals and push outward',()=>{
  const f=fixture('flute'),m=f.mob(62),far=f.mob(400);
  layerOf(f,'flute','spiral').atk([],1);assert.equal(f.w.instrumentFX[0].kind,'orbit');f.run(1.7);
  const hits=shotsOf(f,m);assert.ok(hits.length>=1&&hits.length<=5);assert.ok(hits.every(h=>h.kx>0));
  for(let i=1;i<hits.length;i++)assert.ok(hits[i].time-hits[i-1].time>=.399);
  assert.equal(shotsOf(f,far).length,0);assert.equal(f.w.instrumentFX.length,0);
  const t=fixture('flute');layerOf(t,'flute','trill').atk([],1);assert.equal(t.w.instrumentFX[0].n,2);assert.ok(t.w.instrumentFX[0].life<.8);
});

test('orbit follows the bird and never parries notes',()=>{
  const f=fixture('flute');f.w.eshots=[{x:64,y:0,r:5,age:0,life:3}];
  layerOf(f,'flute','spiral').atk([],1);f.w.p.x=300;f.w.p.y=100;f.run(.3);
  assert.equal(f.w.instrumentFX[0].x,300);assert.equal(f.parries.length,0);
});

test('feather steers onto an off-axis mob, hits once and dies; guests extrapolate without a target',()=>{
  const f=fixture('flute'),m=f.mob(200,0);
  layerOf(f,'flute','stacc').atk([],1);const e=f.w.instrumentFX[0];assert.equal(e.kind,'feather');
  const turn=.8;e.dir=turn;e.vx=Math.cos(turn)*e.speed;e.vy=Math.sin(turn)*e.speed;
  f.run(1);assert.equal(shotsOf(f,m).length,1);assert.equal(f.w.instrumentFX.length,0);
  const g=fixture('flute');g.mob(200,0);layerOf(g,'flute','stacc').atk([],1);
  const copy=JSON.parse(JSON.stringify(g.w.instrumentFX,(k,v)=>k==='hit'||k==='target'?undefined:v));
  g.w.instrumentFX=copy;const x0=copy[0].x;g.run(.2,true);assert.ok(copy[0].x>x0+20);assert.equal(g.hits.length,0);
  const d=fixture('flute');d.mob(200,0);layerOf(d,'flute','duet').atk([],1);assert.equal(d.w.instrumentFX.length,2);
  assert.ok(Math.abs(d.w.instrumentFX[1].dir-d.w.instrumentFX[0].dir-.6)<1e-9);
});

test('twister spawns at the nearest enemy, pulls normal mobs inward but not bosses, and ticks damage',()=>{
  const f=fixture('flute'),m=f.mob(200),pulled=f.mob(240),boss=f.mob(240,10);boss.boss=true;
  layerOf(f,'flute','scale').atk([],1);const e=f.w.instrumentFX[0];assert.equal(e.kind,'twister');assert.equal(e.x,200);
  f.run(1.4);assert.ok(pulled.x<225,'pulled toward the centre');assert.equal(boss.x,240);
  assert.ok(shotsOf(f,m).length>=2&&shotsOf(f,m).length<=5);assert.equal(f.w.instrumentFX.length,0);
  const empty=fixture('flute');layerOf(empty,'flute','scale').atk([],1);assert.ok(empty.w.instrumentFX[0].x>100,'ahead of the bird when nobody is near');
});

test('gust pushes mobs in front once, ignores those behind, and flutter keeps a two-wing arc',()=>{
  const f=fixture('flute'),front=f.mob(80),behind=f.mob(-80),wing=f.mob(70,45);
  layerOf(f,'flute','flutter').atk([],1);assert.equal(f.w.instrumentFX[0].kind,'gust');f.run(.6);
  assert.equal(shotsOf(f,front).length,1);assert.ok(shotsOf(f,front)[0].kx>0);assert.equal(shotsOf(f,behind).length,0);
  assert.equal(shotsOf(f,wing).length,1);assert.equal(f.w.instrumentFX.length,0);
});

test('sax blast ring pushes every side outward exactly once',()=>{
  const f=fixture('sax'),a=f.mob(90),b=f.mob(-90),c=f.mob(0,90),far=f.mob(400);
  layerOf(f,'sax','stab').atk([],1);assert.equal(f.w.instrumentFX[0].kind,'blast');f.run(.6);
  for(const m of [a,b,c])assert.equal(shotsOf(f,m).length,1);
  assert.ok(shotsOf(f,a)[0].kx>0&&shotsOf(f,b)[0].kx<0&&shotsOf(f,c)[0].ky>0);assert.equal(shotsOf(f,far).length,0);
  const small=fixture('sax');layerOf(small,'sax','tongue').atk([],1);assert.ok(small.w.instrumentFX[0].maxR<80+1);
});

test('fireball explodes on contact, damages and burns clustered mobs once',()=>{
  const f=fixture('sax'),a=f.mob(150),b=f.mob(168,6),far=f.mob(420);
  layerOf(f,'sax','riff').atk([],1);assert.equal(f.w.instrumentFX[0].kind,'fireball');f.run(1);
  assert.equal(shotsOf(f,a).length,1);assert.equal(shotsOf(f,b).length,1);assert.equal(shotsOf(f,far).length,0);
  assert.ok(a.burn>0&&b.burn>0&&a.burnDmg>0);assert.equal(f.w.instrumentFX.length,0);
  const fan=fixture('sax');fan.mob(200);layerOf(fan,'sax','fanfare').atk([],1);assert.equal(fan.w.instrumentFX.length,3);
});

test('fireball that touches nobody explodes at maximum range',()=>{
  const f=fixture('sax'),m=f.mob(0,200);f.w.p.x=0;
  layerOf(f,'sax','riff').atk([],1);const e=f.w.instrumentFX[0];e.dir=0;e.vx=e.speed;e.vy=0;
  m.x=e.range-10;m.y=30;f.run(1);assert.equal(shotsOf(f,m).length,1,'range-end explosion still burns and hurts');assert.ok(m.burn>0);
});

test('smoke ring expands, slows normal mobs once and cannot slow bosses',()=>{
  const f=fixture('sax'),m=f.mob(60),boss=f.mob(60,4);boss.boss=true;
  layerOf(f,'sax','subtone').atk([],1);assert.equal(f.w.instrumentFX[0].kind,'smokering');f.run(2);
  assert.equal(shotsOf(f,m).length,1);assert.ok(m.slow>0&&m.slowAmt>=.3);assert.ok(!boss.slow);assert.equal(f.w.instrumentFX.length,0);
});

test('bounce note chains through separate mobs and respects its hop count',()=>{
  const f=fixture('sax'),a=f.mob(100),b=f.mob(200),c=f.mob(280),d=f.mob(380),far=f.mob(900);
  layerOf(f,'sax','growline').atk([],1);assert.equal(f.w.instrumentFX[0].kind,'bounce');f.run(2);
  for(const m of [a,b,c])assert.equal(shotsOf(f,m).length,1);assert.equal(shotsOf(f,d).length,0);assert.equal(shotsOf(f,far).length,0);
  const g=fixture('sax'),x=g.mob(100),y=g.mob(200),z=g.mob(280);
  layerOf(g,'sax','improv').atk([],1);g.run(2);assert.equal(shotsOf(g,x).length+shotsOf(g,y).length+shotsOf(g,z).length,2);
  const lone=fixture('sax'),only=lone.mob(100);layerOf(lone,'sax','growline').atk([],1);lone.run(2);assert.equal(shotsOf(lone,only).length,1);
});

test('puddle sits at the nearest enemy, ticks damage with a short burn and expires',()=>{
  const f=fixture('sax'),m=f.mob(150),far=f.mob(700);
  layerOf(f,'sax','falloff').atk([],1);const e=f.w.instrumentFX[0];assert.equal(e.kind,'puddle');assert.equal(e.x,150);
  f.run(1.7);const hits=shotsOf(f,m);assert.ok(hits.length>=4&&hits.length<=6);
  for(let i=1;i<hits.length;i++)assert.ok(hits[i].time-hits[i-1].time>=.299);
  assert.ok(m.burn>0&&m.burnDmg>0);assert.equal(shotsOf(f,far).length,0);assert.equal(f.w.instrumentFX.length,0);
});

test('shield-like kinds (orbit, twister, puddle) never parry; the others stay within the two-note budget',()=>{
  for(const [inst,id,kind,reflects] of [['flute','spiral','orbit',false],['flute','scale','twister',false],['sax','falloff','puddle',false],['sax','stab','blast',true],['sax','riff','fireball',true],['flute','stacc','feather',true]]){
    const f=fixture(inst);f.mob(60);f.w.eshots=Array.from({length:4},()=>({x:60,y:0,r:5,age:0,life:3}));
    layerOf(f,inst,id).atk([],1);assert.equal(f.w.instrumentFX[0].kind,kind);f.run(.3);
    assert.ok(f.parries.length<=2,kind+' parry budget');if(!reflects)assert.equal(f.parries.length,0,kind+' is not a shield');
  }
});

test('gear changes the new kinds: reach, damage, burn, knockback, duration',()=>{
  const a=fixture('flute'),b=fixture('flute',{wind:2,return:2});
  for(const id of ['spiral','stacc','scale','flutter']){layerOf(a,'flute',id).atk([],1);layerOf(b,'flute',id).atk([],1);}
  for(let i=0;i<4;i++)assert.ok(b.w.instrumentFX[i].dmg>a.w.instrumentFX[i].dmg,'return boosts damage');
  assert.ok(b.w.instrumentFX[0].ring>a.w.instrumentFX[0].ring);assert.ok(b.w.instrumentFX[0].r>a.w.instrumentFX[0].r);
  assert.ok(b.w.instrumentFX[1].r>a.w.instrumentFX[1].r);assert.ok(b.w.instrumentFX[3].range>a.w.instrumentFX[3].range);
  const crit=fixture('flute',{sharp:3}),orig=Math.random;Math.random=()=>0;try{layerOf(crit,'flute','spiral').atk([],1);}finally{Math.random=orig;}
  assert.ok(Math.abs(crit.w.instrumentFX[0].dmg/a.w.instrumentFX[0].dmg-1.8)<1e-9);
  const s=fixture('sax'),t=fixture('sax',{mouthpiece:2,bell:2,pressure:2,heat:2});
  for(const id of ['stab','riff','subtone','growline','falloff']){layerOf(s,'sax',id).atk([],1);layerOf(t,'sax',id).atk([],1);}
  for(let i=0;i<5;i++){const x=s.w.instrumentFX[i],y=t.w.instrumentFX[i];assert.ok(y.dmg>x.dmg,'bell damage');assert.ok(y.life>x.life,'mouthpiece duration');assert.ok(y.heat>0&&!x.heat,'heat');}
  assert.ok(t.w.instrumentFX[0].maxR>s.w.instrumentFX[0].maxR&&t.w.instrumentFX[0].kb>s.w.instrumentFX[0].kb);
  const burn=fixture('sax',{heat:2}),m=burn.mob(60);layerOf(burn,'sax','stab').atk([],1);burn.run(.4);assert.ok(m.burn>0&&m.burnDmg>0);
});

test('every flute and sax layer draws with a kind the pixel-art whitelist and kind map know',()=>{
  const fs=require('node:fs'),src=fs.readFileSync(require('node:path').join(__dirname,'pixel-heroes.js'),'utf8');
  const list=src.match(/function drawInstrumentFx[\s\S]*?\.includes\(f\.kind\)/)[0],map=src.match(/const inst=\{[^}]*\}\[f\.kind\]/)[0];
  for(const inst of ['flute','sax']){
    for(const {id} of fixture(inst).module.layers[inst]){
      const f=fixture(inst),layer=layerOf(f,inst,id);f.mob(100);layer.atk([],1);assert.ok(f.w.instrumentFX.length>0,id+' produces an effect');
      for(const e of f.w.instrumentFX){
        assert.ok(list.includes("'"+e.kind+"'"),inst+'/'+id+' kind '+e.kind+' is whitelisted');
        const owner=new RegExp('\\b'+e.kind+":'(\\w+)'").exec(map);assert.ok(owner&&owner[1]===inst,e.kind+' maps to '+inst);
      }
    }
  }
});

test('flute and sax attack kinds are varied rather than one repeated shape',()=>{
  const kinds=inst=>{const set=new Set();for(const {id} of fixture(inst).module.layers[inst]){const f=fixture(inst);f.mob(100);layerOf(f,inst,id).atk([],1);f.w.instrumentFX.forEach(e=>set.add(e.kind));}return set;};
  assert.ok(kinds('flute').size>=5,'flute: '+[...kinds('flute')]);assert.ok(kinds('sax').size>=6,'sax: '+[...kinds('sax')]);
});

/* ===== Музика сопілки й сакса: стиль, гармонія, прикраси ===== */
function liveModule(song){
  const w={p:{x:0,y:0,fx:1,fy:0,hp:100},mobs:[],eshots:[],t:0};
  const tones=(ch,low,n)=>{const out=[];let m=low-1;while(out.length<n&&m<low+96){m++;if(ch.pcs.includes(((m%12)+12)%12))out.push(m);}return out;};
  const api={T:x=>x,E:(midi,vel,dur,o)=>({midi,vel,dur,...o}),up:(pc,low)=>low+((pc-low)%12+12)%12,tones,lv:L=>1+.3*(L-1),
    nearest:()=>[],aim:()=>0,pedalEffects:()=>({}),meta:()=>({}),withAttack:(f,fn)=>fn(),hurtMob:()=>{},reflectNote:()=>{},isBoss:()=>false,
    get G(){return w;},get SONG(){return song;},get ATK_SCALE(){return 1;}};
  return buildInstrumentExpansion(api);
}
const liveMusic=song=>liveModule(song).layers;
const CHORDS=[{root:0,pcs:[0,4,7]},{root:9,pcs:[9,0,4]},{root:7,pcs:[7,11,2,5]},{root:2,pcs:[2,5,9]},{root:5,pcs:[5,8,0]}];
/* пісенна мелодія: позиції в двох тактах (0..31) → ноти; її й грають сопілка та сакс */
const MEL={phrases:{mel:[0,6,12,18,24,30]},mel:{0:76,6:74,12:72,18:79,24:77,30:67}};
const SONGS=[{key:0,mode:'major',bpm:127,...MEL},{key:9,mode:'minor',bpm:70,...MEL},{key:2,mode:'minor',bpm:100,...MEL},{key:7,mode:'major',bpm:88,...MEL}];
const scaleOf=s=>(s.mode==='minor'?[0,2,3,5,7,8,11]:[0,2,4,5,7,9,11]).map(x=>(s.key+x)%12);
const bars=(layer,ch,n=8)=>Array.from({length:n},(_,b)=>Array.from({length:16},(_,s)=>layer.steps(ch,s,b,1)));

test('sax and flute: main notes are chord tones, ornaments are short scale neighbours',()=>{
  for(const song of SONGS){const L=liveMusic(song),sc=scaleOf(song);
    for(const inst of ['flute','sax'])for(const layer of L[inst])for(const ch of CHORDS)for(const bar of bars(layer,ch))for(const evs of bar)for(const e of evs){
      const id=inst+'/'+layer.id;
      if(e.orn){assert.ok(e.seconds<=.06,id+' ornament <= 60 ms');assert.ok(sc.includes(((e.midi%12)+12)%12),id+' ornament in scale');}
      else assert.ok(ch.pcs.includes(((e.midi%12)+12)%12),id+' main note '+e.midi+' is a chord tone of '+ch.root);
    }
  }
});

/* ===== «Кожна нота — окрема атака з власною технікою» (зріз: сопілка melody/legato/trill + стартова, сакс riff/breath/stab + стартова) ===== */
const ev=o=>({midi:76,vel:.5,dur:2,seconds:.18,...o}),CH=CHORDS[0];

test('technique(e) names how a note is played and weighs it for balance',()=>{
  const {technique:t,noteWeight:w}=liveModule(SONGS[0]);
  assert.equal(t(ev({orn:true})),'orn');assert.equal(t(ev({accent:true})),'accent');assert.equal(t(ev({vel:.6})),'accent');
  assert.equal(t(ev({seconds:.35})),'long');assert.equal(t(ev({fall:true})),'fall');assert.equal(t(ev({leap:true})),'leap');assert.equal(t(ev()),'short');
  assert.equal(t(ev({orn:true,vel:.9,seconds:1})),'orn','an ornament stays an ornament');assert.equal(t(ev({trill:true})),'trill');
  assert.deepEqual([w(ev({orn:true})),w(ev()),w(ev({seconds:1})),w(ev({accent:true}))],[.2,1,1.5,1.5]);
});

test('the slice layers and both starters are per-note; every other flute and sax layer is untouched',()=>{
  const m=liveModule(SONGS[0]),per={flute:['melody','legato','trill'],sax:['riff','breath','stab']};
  for(const inst of ['flute','sax'])for(const l of m.layers[inst])assert.equal(!!l.perNote,per[inst].includes(l.id),inst+'/'+l.id);
});

test('flute and sax starters play the song melody at its own positions: chord tones only, and they follow it when it changes',()=>{
  for(const inst of ['flute','sax']){
    for(const song of SONGS){
      const fn=liveModule(song).starterSteps[inst];
      const at=[];for(let b=0;b<2;b++)for(let s=0;s<16;s++){const evs=fn(CH,s,b);if(!evs.length)continue;at.push(b*16+s);
        for(const e of evs.filter(e=>!e.orn)){assert.ok(CH.pcs.includes(e.midi%12),inst+' main note is a chord tone');
          const d=(((e.midi-song.mel[b*16+s])%12)+12)%12;assert.ok(d<=3||d>=9,inst+' stays within a chord-snap of the melody note');}}
      assert.deepEqual(at,song.phrases.mel,inst+' sounds exactly at the melody positions');
    }
    const play=song=>{const fn=liveModule(song).starterSteps[inst];return JSON.stringify(Array.from({length:32},(_,i)=>fn(CH,i%16,i>>4)));};
    const moved={...SONGS[0],mel:{0:72,6:79,12:77,18:67,24:74,30:76}};
    assert.notEqual(play(moved),play(SONGS[0]),inst+' starter changes pitch with the song melody');
  }
});

test('flute starter is a simple sopilka line (grace before strong notes); sax starter is staccato with accents on the off-beats',()=>{
  const m=liveModule(SONGS[0]),fl=m.starterSteps.flute,sx=m.starterSteps.sax;
  const g=fl(CH,0,0);assert.equal(g.length,2);assert.ok(g[0].orn&&g[0].off===0&&g[1].off>0&&!g[1].orn,'grace sounds before the strong note');
  assert.equal(fl(CH,6,0).length,1,'a weak-beat note has no grace');
  for(let b=0;b<2;b++)for(let s=0;s<16;s++)for(const e of sx(CH,s,b)){assert.ok(e.seconds<=.09,'staccato');assert.equal(!!e.accent,s%4===2,'accent exactly on the off-beats');assert.equal(e.orn,undefined);}
});

test('flute melody, legato and trill: sopilka ornaments and held notes on top of the song melody',()=>{
  const L=liveModule(SONGS[0]).layers.flute,by=id=>L.find(l=>l.id===id),mel=by('melody'),{technique:t}=liveModule(SONGS[0]);
  const all=[];for(let b=0;b<2;b++)for(let s=0;s<16;s++)all.push(...mel.steps(CH,s,b,1));
  assert.deepEqual(new Set(all.map(t)),new Set(['orn','short','accent','long']),'melody uses ornament, short, accent (bar downbeat) and held notes');
  assert.ok(all.filter(e=>t(e)==='long').every(e=>e.seconds>=.35&&e.seconds<=.9));
  const tr=by('trill').steps(CH,12,1,1);assert.ok(tr.length>=4&&tr[1].orn&&tr[3].orn&&tr[0].midi===tr[2].midi&&tr[0].trill&&!tr[1].trill,'trill alternates chord tone and neighbour');
  assert.ok(tr.every(e=>e.off+e.seconds<=60/127/4*3),'trill fits before the resolution');
  assert.equal(t(by('trill').steps(CH,14,1,1)[0]),'long','trill resolves into a held note');
  assert.equal(t(by('legato').steps(CH,0,0,1)[0]),'long');
});

test('sax riff: hook articulation on the song melody - accents on off-beats, leap, falling phrase end, double time on slow songs',()=>{
  const fastM=liveModule(SONGS[0]),slowM=liveModule(SONGS[1]),fast=fastM.layers.sax.find(l=>l.id==='riff'),slow=slowM.layers.sax.find(l=>l.id==='riff'),t=fastM.technique;
  const at=(layer,b,s)=>layer.steps(CH,s,b,1);
  assert.deepEqual([[0,0],[0,6],[0,12],[1,2],[1,8],[1,14]].map(([b,s])=>t(at(fast,b,s)[0])),['leap','accent','short','leap','short','fall']);
  for(let b=0;b<2;b++)for(let s=0;s<16;s++)for(const e of at(fast,b,s)){assert.ok(e.seconds<=.13,'staccato');if(t(e)==='accent')assert.equal(s%4,2,'accents sit on the off-beats');assert.ok(CH.pcs.includes(e.midi%12));}
  const fall=at(fast,1,14)[0];assert.ok(fall.vel<.6&&!fall.accent,'a fall or leap is not an accent');
  for(const [b,s] of [[0,0],[0,6],[1,8]]){const evs=at(slow,b,s);assert.equal(evs.length,2,'slow songs play double time');assert.ok(Math.abs(evs[1].off-60/70/8)<1e-9,'second note on the half step');assert.ok(!evs[1].orn);}
  assert.equal(at(fast,0,6).length,1);
});

test('flute notes fire their own attack: dart, boomerang, gust, spark, orbit - exactly one attack per note',()=>{
  const one=(id,e)=>{const f=fixture('flute');f.mob(100);layerOf(f,'flute',id).atk([e],1);assert.equal(f.w.instrumentFX.length,1,id+' '+JSON.stringify(e)+' fires one attack');return f.w.instrumentFX[0];};
  for(const id of ['melody','legato','trill']){
    const dart=one(id,ev()),spark=one(id,ev({orn:true,seconds:.05})),gust=one(id,ev({accent:true})),boom=one(id,ev({seconds:.9})),orb=one(id,ev({trill:true,seconds:.05}));
    assert.equal(dart.kind,'feather');assert.ok(dart.life<=.9&&!dart.tiny);
    assert.equal(spark.kind,'feather');assert.ok(spark.tiny&&spark.life<=.35&&spark.r<=3&&spark.dmg<=dart.dmg*.2+1e-9,'ornament spark is tiny');
    assert.equal(gust.kind,'gust');assert.equal(boom.kind,'boomerang');assert.equal(boom.life,.9,'boomerang flies as long as the note sounds');
    assert.equal(orb.kind,'orbit');assert.ok(orb.life<=.6&&orb.n===2,'trill leaves orbit briefly');
    assert.ok(Math.abs(boom.dmg/dart.dmg-1.5)<1e-9&&Math.abs(gust.dmg/dart.dmg-1.5)<1e-9,'damage follows the note weight');
    assert.equal(one(id,ev({seconds:3})).life,1.8);assert.equal(one(id,ev({seconds:.36})).life,.5,'boomerang life is clamped to .5..1.8');
    assert.ok(one(id,ev({seconds:.9,midi:88})).range>one(id,ev({seconds:.9,midi:64})).range,'a higher note flies farther');
    assert.ok(one(id,ev({midi:88})).life>one(id,ev({midi:64})).life,'a higher dart carries farther');
  }
  const f=fixture('flute');layerOf(f,'flute','melody').atk([],1);assert.equal(f.w.instrumentFX[0].kind,'boomerang','no note: the old default attack');
});

test('sax notes fire their own attack: ring, beam as long as the note, blast, puddle, bounce, tiny ring',()=>{
  const one=(id,e)=>{const f=fixture('sax');f.mob(100);layerOf(f,'sax',id).atk([e],1);assert.equal(f.w.instrumentFX.length,1,id+' '+JSON.stringify(e)+' fires one attack');return f.w.instrumentFX[0];};
  for(const id of ['riff','breath','stab']){
    const e0=o=>ev({midi:66,...o}),ring=one(id,e0()),beam=one(id,e0({seconds:.62})),blast=one(id,e0({accent:true})),pud=one(id,e0({fall:true})),bnc=one(id,e0({leap:true})),tiny=one(id,e0({orn:true,seconds:.05}));
    assert.equal(ring.kind,'blast');assert.ok(ring.maxR>=60&&ring.maxR<=80);
    assert.equal(beam.kind,'beam');assert.equal(beam.life,.62,'beam lasts as long as the note');
    assert.equal(blast.kind,'blast');assert.ok(Math.abs(blast.maxR-110)<1e-9);assert.ok(Math.abs(blast.dmg/ring.dmg-1.5)<1e-9);
    assert.equal(pud.kind,'puddle');assert.equal(bnc.kind,'bounce');
    assert.equal(tiny.kind,'blast');assert.ok(tiny.maxR<=30&&tiny.life<=.35&&tiny.dmg<=ring.dmg*.2+1e-9,'ornament ring is tiny');
    assert.ok(Math.abs(beam.dmg*Math.ceil(.62/.16)/ring.dmg-1.5)<1e-9,'a long note carries the long weight in total damage');
    assert.ok(one(id,e0({accent:true,midi:80})).maxR>blast.maxR,'a higher accent reaches farther');
  }
  const f=fixture('sax');layerOf(f,'sax','breath').atk([],1);assert.equal(f.w.instrumentFX[0].kind,'beam','no note: the old default attack');
});

test('improv and growline keep their old density instead of following every hook step',()=>{
  const L=liveMusic(SONGS[0]).sax,per=id=>{const l=L.find(x=>x.id===id);let n=0;for(let b=0;b<8;b++)for(let s=0;s<16;s++)n+=l.steps(CH,s,b,1).length>0;return n/8;};
  assert.ok(per('growline')<=4&&per('improv')<=5,'growline '+per('growline')+' improv '+per('improv')+' per bar');
  assert.ok(per('growl')<=.5,'growl is one low note per two bars again');
});

test('the effect cap drops the oldest visual effect, never the new attack, and the new attack still damages',()=>{
  const f=fixture('flute'),m=f.mob(60),melody=layerOf(f,'flute','melody');
  for(let i=0;i<230;i++)melody.atk([ev()],1);
  assert.equal(f.w.instrumentFX.length,220,'capped at 220');
  const last=f.w.instrumentFX.at(-1);assert.ok(last.dmg>0&&last.visualId===230,'the newest attack survives');
  f.run(.6);assert.ok(f.hits.some(h=>h.m===m),'attacks still deal damage under the cap');
});
