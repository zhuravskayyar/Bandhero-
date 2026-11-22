'use strict';

// The game supplies its world and existing damage helpers. No second combat loop
// or audio scheduler is created here; notes are still dispatched by doPlayerStep.
function buildInstrumentExpansion(api) {
  const {T,E,tones,up,lv}=api;
  const colors={flute:'#a9e6a0',violin:'#efad78',sax:'#f5d36d',accordion:'#f18fab'};
  const ranks=(a,b,c)=>[T(a),T(b),T(c)];
  const strength=ranks('Та сама фраза; базова сила','Та сама фраза; сильніша атака','Та сама фраза; ще більше сили');
  const note=(ch,index=0,low=67,vel=.55,seconds=.42)=>{const base=tones(ch,low,4)[index%4];return E(api.personalPitch?.(ch,index*4,low,base)??base,vel,4,{seconds});};
  const songNote=(ch,s,b,low=67)=>{
    const melody=api.SONG?.mel||{},positions=Object.keys(melody).map(Number),p=((b%2)*16+s+32)%32;
    let nearest=positions[0],distance=99;for(const at of positions){const gap=Math.abs(at-p),d=Math.min(gap,32-gap);if(d<distance){nearest=at;distance=d;}}
    const target=nearest===undefined?up(ch.root,low):melody[nearest],candidates=tones(ch,low-12,12);
    return candidates.reduce((a,m)=>Math.abs(m-target)<Math.abs(a-target)?m:a,candidates[0]);
  };
  const melodyBeats=(under=false)=>{const mood=api.SONG?.hook?.mood;return mood==='fierce'?(under?[2,6,10,14]:[0,3,8,11]):mood==='playful'?(under?[0,4,8,12]:[2,6,10,14]):under?[2,6,10,14]:[0,4,8,12];};
  const melodyLength=()=>api.SONG?.hook?.mood==='fierce'?.2:api.SONG?.hook?.mood==='playful'?.17:.45;
  // Starter parts follow the current unlocked chord. Beat/bar numbers set timing,
  // never an automatic arpeggio; melodic embellishments belong to chosen layers.
  const events=(ch,s,_bar,positions,low=67,seconds=.42)=>positions.includes(s)?[E(api.personalPitch?.(ch,s,low)??up(ch.root,low),.55,4,{seconds})]:[];
  function reeds(ch,s,positions,voice,vel=.3,bass=false){
    if(!positions.includes(s))return[];
    const holdSteps=(positions.find(p=>p>s)??16)-s,root=up(ch.root,bass?43:55);
    const intervals=(ch.pcs||[ch.root,(ch.root+4)%12,(ch.root+7)%12]).map(pc=>(pc-ch.root+12)%12).sort((a,b)=>a-b);
    const pitches=bass?[root,...(ch.octaveBass?[root+12]:[])]:intervals.slice(0,4).map((i,j)=>root+i+(ch.close&&j===0?12:0));
    return pitches.map(m=>E(m,vel,holdSteps,{holdSteps,voice:'accordion-'+voice,harmony:ch.root+':'+intervals.join(',')+(ch.close?':close':''),fixedRegister:true}));
  }
  // ===== Музика сопілки й сакса: спільні фрази (див. docs/skills-plan.md §5–6) =====
  // Масив подій одного кроку = ОДИН виклик atk (doPlayerStep: hits.push({Ly,evs}); atk(evs,L) б'є раз на крок),
  // тому прикраси (форшлаги, мордент, трель) — додаткові події {orn:true} зі зсувом off усередині кроку: нових атак вони не дають.
  const stepSec=()=>60/(api.SONG?.bpm||120)/4;
  // i-й тон акорду від low: i може виходити за октаву (вгору) чи бути від'ємним (вниз) — завжди тон акорду
  const cn=(ch,i,low)=>{const n=(ch.pcs&&ch.pcs.length)||3,a=tones(ch,low,n);if(!a.length)return low;return a[((i%n)+n)%n]+12*Math.floor(i/n);};
  // гама пісні (мінор — гармонічний із піднятою 7-ю, фольклорний колір)
  const scalePcs=()=>{const k=(((api.SONG?.key||0)%12)+12)%12,iv=api.SONG?.mode==='minor'?[0,2,3,5,7,8,11]:[0,2,4,5,7,9,11];return iv.map(x=>(k+x)%12);};
  const nbr=(m,dir=1)=>{const sc=scalePcs();for(const d of [dir,-dir])for(const k of [1,2]){const c=m+d*k;if(sc.includes(((c%12)+12)%12))return c;}return null;};
  const ORN_SEC=.05; /* прикраса ≤ 60 мс і одразу веде в тон акорду */
  const orn=(m,vel,off,dir=1)=>{const n=nbr(m,dir);return n===null?null:E(n,vel,1,{seconds:ORN_SEC,off,orn:true});};
  const graced=(m,vel,sec,dur=2)=>{const g=orn(m,vel*.7,0,1);return g?[g,E(m,vel,dur,{seconds:sec,off:.045})]:[E(m,vel,dur,{seconds:sec})];};

  /* ===== Техніка ноти: що саме героя «грає» цією нотою =====
     Кожна нота — окрема атака (perNote-партії), а вид атаки обирає technique(e). Порядок: прикраса, акцент, довга, спад, стрибок, коротка.
     trill — основні ноти трелі (дрібне листя на орбіті). Вага — частка «повної» шкоди ноти для балансу (hitsPerSec/balanceK). */
  const technique=e=>!e?'short':e.orn?'orn':e.trill?'trill':(e.accent||e.vel>=.6)?'accent':(e.seconds||0)>=.35?'long':e.fall?'fall':e.leap?'leap':'short';
  const TECH_W={orn:.2,trill:.6,short:1,long:1.5,accent:1.5,fall:1,leap:1};
  const noteWeight=e=>TECH_W[technique(e)];
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const keyOf=(m,center)=>clamp(((m===undefined?center:m)-center)/12,-1,1); /* -1..1: вища нота — далі й трохи вбік */

  /* Пісенна мелодія (SONG.mel на позиціях SONG.phrases.mel): ту саму лінію грає герой. Без пісні (тести) — запасна лінія. */
  const FALLBACK_POS=[0,4,8,12,18,22,26,30],FALLBACK_DEG=[2,3,2,1,2,3,1,0];
  const snapTo=(m,ch)=>{if(!ch.pcs)return m;let best=m,bd=99;for(let d=-3;d<=3;d++){if(ch.pcs.includes((((m+d)%12)+12)%12)&&Math.abs(d)<bd){bd=Math.abs(d);best=m+d;}}return best;};
  const fold=(m,lo,hi)=>{while(m<lo)m+=12;while(m>hi)m-=12;return m;};
  function melodyAt(ch,s,b,lo,hi){
    const S=api.SONG||{},real=Array.isArray(S.phrases?.mel)&&S.phrases.mel.length&&S.mel;
    const sorted=(real?S.phrases.mel.filter(p=>p<32):FALLBACK_POS).slice().sort((a,c)=>a-c),p=(b%2)*16+s;
    const i=sorted.indexOf(p);if(i<0)return null;
    const next=sorted[i+1]??sorted[0]+32,prev=sorted[i-1]??sorted[sorted.length-1];
    const m=real?fold(snapTo(S.mel[p],ch),lo,hi):cn(ch,FALLBACK_DEG[i%FALLBACK_DEG.length],lo+(hi-lo>14?5:0));
    const leap=real?Math.abs(S.mel[p]-S.mel[prev])>=7:false;
    return {m,gap:next-p,last:i===sorted.length-1,leap};
  }
  /* Картки акордів гравця (ch.fluteThird, saxBlue, close…) — через personalPitch, але з поправкою на регістр: ноти лишаються поруч зі своєю мелодією */
  const chordPcs=ch=>ch.pcs&&ch.pcs.length?ch.pcs:[ch.root,(ch.root+4)%12,(ch.root+7)%12];
  function pp(ch,s,m,low){
    if(!api.personalPitch)return m;
    const beat=(s>>2<<2)%16; /* ноти між долями належать долі, що їх веде */
    let r=api.personalPitch(ch,beat,low,m);
    r-=12*Math.round((r-m)/12);
    if(ch.fluteTonic&&beat===0)r-=12;
    if(ch.close){const pcs=chordPcs(ch);for(let d=1;d<=12;d++)if(pcs.includes((((r+d)%12)+12)%12)){r+=d;break;}}
    return r;
  }
  const below=(ch,m)=>{const pcs=chordPcs(ch);for(let d=1;d<=12;d++)if(pcs.includes((((m-d)%12)+12)%12))return m-d;return m-3;};
  /* Сопілка: проста лінія пісні з форшлагом перед сильною нотою; full — ще й довгі ноти в паузах і акцент на початку такту */
  function fluteSong(ch,s,b,full){
    const n=melodyAt(ch,s,b,67,86);if(!n)return[];
    const m=pp(ch,s,n.m,72),held=full&&n.gap>=6,sec=held?Math.min(.9,n.gap*stepSec()*.8):.18,strong=s%4===0,vel=s===0&&full?.62:strong?.56:.5;
    const out=strong?graced(m,vel,sec,held?6:2):[E(m,vel,held?6:2,{seconds:sec})];
    return out.map(e=>e.orn||!(s===0&&full)?e:{...e,accent:true});
  }
  /* Сакс: та сама лінія в манері данс-хуку — стакато, акценти на «і» (слабкі частки); full — стрибок і спад із вигином мелодії */
  function saxSong(ch,s,b,full){
    const n=melodyAt(ch,s,b,58,76);if(!n)return[];
    const m=pp(ch,s,n.m,64),acc=s%4===2;
    let e=E(m,acc?.68:.42,1,{seconds:.075});if(acc)e.accent=true;
    if(full&&n.last){e={...e,vel:.5,accent:false,seconds:.12,fall:true};}
    else if(full&&n.leap){e={...e,vel:.5,accent:false,seconds:.1,leap:true};}
    const out=[e];
    if(full&&slowBpm())out.push(E(below(ch,m),e.vel*.75,1,{seconds:.075,off:stepSec()/2}));
    return out;
  }

  // САКС — «данс-поп хук»: [крок, номер тону акорду від C4, акцент]; акценти на «і» (кроки 2,6,10), стакато
  const HOOK=[
    [[0,0,0],[2,2,1],[3,1,0],[6,3,1],[7,2,0],[10,2,1],[14,1,0]], /* такти 0–1: мотив */
    [[2,3,1],[3,4,0],[6,5,1],[7,4,0],[10,3,1],[11,2,0],[14,3,0]], /* такт 2: відповідь вище */
    [[2,5,1],[4,4,0],[6,3,0],[8,2,0],[10,1,0],[12,0,0],[14,-1,0]] /* такт 3: спадне «падіння» */
  ];
  const hookRow=(s,f)=>HOOK[f<2?0:f===2?1:2].find(r=>r[0]===s);
  function saxHook(ch,s,b,form){
    const f=form??b%4,r=hookRow(s,f);if(!r)return null;
    return {midi:cn(ch,r[1],60),i:r[1],vel:r[2]?.68:.42,accent:!!r[2],form:f,last:f===3&&s===14};
  }
  const slowBpm=()=>(api.SONG?.bpm||120)<95; /* повільна пісня: хук удвічі швидший (друга нота на пів-кроку) */
  function hookEvents(ch,s,b,o={}){
    const h=saxHook(ch,s,b,o.form);if(!h||(o.accent&&!h.accent&&!(o.also||[]).includes(s)))return[];
    const i=o.map?o.map(h.i,b):h.i,sh=o.shift||0,vel=Math.min(1,h.vel*(o.vk||1)),sec=h.last?Math.max(o.sec||.075,.3):(o.sec||.075);
    const out=[E(cn(ch,i,60)+sh,vel,1,{seconds:sec})];
    if(o.double!==false&&slowBpm())out.push(E(cn(ch,i-1,60)+sh,vel*.75,1,{seconds:Math.min(sec,.075),off:stepSec()/2}));
    return out;
  }
  const saxTongue=(ch,s,b)=>{if(s%4!==2)return[];const h=saxHook(ch,s,b);return[E(h?h.midi:cn(ch,0,60),.4,1,{seconds:.035})];};
  const saxImprov=(ch,s,b)=>hookEvents(ch,s,b,{form:b%4===3?0:b%4,map:(i,bar)=>(i+1+bar%4)%6,accent:true,also:[0,14],double:false});

  // СОПІЛКА — фольклор у хіп-хопі: форшлаги, спадні групи по три, повтори «та-та», довга висока нота; пауза в кінці такту — «відповідь» голосу
  // рядок: [крок, номер тону від G4, форшлаг, відповідь(для дуету)]
  const FL_EVEN=[[0,3,1,0],[3,2,0,1],[6,1,1,0],[8,2,0,1]],FL_ODD=[[0,1,0,0],[2,2,1,0],[4,3,0,1],[6,4,1,0],[8,3,0,1]];
  function sopilkaLine(ch,s,b){
    const r=(b%2?FL_ODD:FL_EVEN).find(x=>x[0]===s);if(!r)return null;
    const held=b%2===1&&s===8;
    return {midi:cn(ch,r[1],67),i:r[1],vel:r[3]?.56:.5,grace:!!r[2],ans:!!r[3],held,sec:held?Math.min(.9,stepSec()*7):.18};
  }
  const fluteMelody=(ch,s,b)=>{const l=sopilkaLine(ch,s,b);if(!l)return[];return l.grace?graced(l.midi,l.vel,l.sec):[E(l.midi,l.vel,l.held?6:2,{seconds:l.sec})];};
  const fluteFlutter=(ch,s,b)=>{
    if(s!==4&&s!==12)return[];const m=songNote(ch,s,b,72);
    return s===4?graced(m,.42,.18):[E(m,.4,1,{seconds:.055}),orn(m,.3,.055,1),E(m,.4,2,{seconds:.2,off:.11})].filter(Boolean);
  };
  const fluteSpiral=(ch,s,b)=>{if(s!==8)return[];const i0=[4,3,2][b%3];return[0,1,2].map(k=>E(cn(ch,i0-k,72),.42-.05*k,1,{seconds:.1,off:k*.075}));};
  const fluteTrill=(ch,s,b)=>{
    if(b%2!==1)return[];const m=pp(ch,12,cn(ch,2,72),72);
    if(s===14)return[E(pp(ch,12,cn(ch,3,72),72),.45,3,{seconds:.5})];
    if(s!==12)return[];const gap=Math.min(.055,stepSec()*1.8/5);
    return[0,1,2,3,4].map(k=>k%2?orn(m,.28,k*gap,1):E(m,.34,1,{seconds:k===4?.1:.05,off:k*gap,trill:true})).filter(Boolean);
  };
  const fluteStacc=(ch,s,b)=>{
    if(![2,3,6,7,10,11].includes(s))return[];const deg=(b%2?[3,2,1]:[2,3,2])[s>>2];
    return[E(cn(ch,deg,72),s%2?.26:.38,1,{seconds:.09})];
  };
  const fluteScale=(ch,s,b)=>{
    if(b%4!==3)return[];
    if(s===14)return[E(cn(ch,5,72),.45,4,{seconds:.55})];
    if(s!==10)return[];const sp=Math.min(.065,stepSec()*3.4/5);
    return[0,1,2,3,4].map(k=>E(cn(ch,k,72),.26+.03*k,1,{seconds:.07,off:k*sp}));
  };
  const fluteDuet=(ch,s,b)=>{
    const l=s>=2?sopilkaLine(ch,s-2,b):null;if(!l||!l.ans)return[];
    return[E(cn(ch,l.i-1,67),.34,3,{seconds:.3}),E(cn(ch,l.i-2,67),.24,3,{seconds:.3,off:.03})];
  };
  const pd=()=>api.pedalEffects();
  const state=()=>api.G;
  function actor(f) {
    const w=state();if(!w)return null;
    if(f.owner!==null&&f.owner!==undefined)return (w.players||[]).find(a=>a.id===f.owner)?.p||null;
    return w.p;
  }
  function add(kind,o) {
    const w=state();if(!w)return null;
    const f={...api.meta(),kind,age:0,...o};
    f.dmg=(f.dmg||0)*(api.ATK_SCALE||1);f.hit=new Map();
    const list=w.instrumentFX||(w.instrumentFX=[]);if(list.length>=220)list.shift(); /* стеля ефектів: найстаріший зникає, а нова атака завжди завдає шкоди */
    list.push(f);return f;
  }
  function heading(offset=0){return api.aim(api.nearest(1)[0])+offset;}
  function boom(L,offset=0,damage=12,range=230,life=1.25) {
    const p=state().p,q=pd(),dir=heading(offset),reach=range*(1+.12*(q.wind||0));
    return add('boomerang',{x:p.x,y:p.y,ox:p.x,oy:p.y,dir,range:reach,life,r:11+2*(q.return||0),dmg:damage*lv(L)*(1+.1*(q.return||0))*(q.sharp&&Math.random()<.1*q.sharp?1.8:1),col:colors.flute});
  }
  function thread(L,offset=0,length=205,life=1.55,damage=3.6,across=false) {
    const p=state().p,q=pd(),dir=heading(offset),range=length*(1+.12*(q.bridge||0)),cx=p.x+Math.cos(dir)*range*.55,cy=p.y+Math.sin(dir)*range*.55;
    const dx=Math.cos(dir+(across?Math.PI/2:0))*range/2,dy=Math.sin(dir+(across?Math.PI/2:0))*range/2;
    return add('thread',{x:cx-dx,y:cy-dy,x2:cx+dx,y2:cy+dy,r:8,life:life*(1+.15*(q.bridge||0)),tick:.3,dmg:damage*lv(L)*(1+.12*(q.resin||0))*(q.tension&&Math.random()<.1*q.tension?1.8:1),slow:.12+.08*(q.silk||0),col:colors.violin});
  }
  function beam(L,offset=0,length=285,life=.78,damage=3.9,width=.34) {
    const p=state().p,q=pd();return add('beam',{x:p.x,y:p.y,dir:heading(offset),range:length,life:life*(1+.12*(q.mouthpiece||0)),tick:.16,w:width+.035*(q.bell||0),dmg:damage*lv(L)*(1+.12*(q.bell||0)),kb:35+18*(q.pressure||0),heat:q.heat||0,col:colors.sax});
  }
  function pulse(L,radius=195,damage=9,delay=.34) {
    const p=state().p,q=pd();return add('bellows',{x:p.x,y:p.y,r:0,maxR:radius*(1+.12*(q.folds||0)),life:delay+.34,delay,dmg:damage*lv(L)*(1+.12*(q.reeds||0)),kb:230,col:colors.accordion});
  }
  // ---- нові види атак флейти й сакса: орбіта, перо, смерч, порив; вибух-кільце, вогняна куля, димове кільце, джазова нота, жарина ----
  const fluteQ=()=>{const q=pd();return {reach:1+.12*(q.wind||0),dmg:(1+.1*(q.return||0))*(q.sharp&&Math.random()<.1*q.sharp?1.8:1),size:2*(q.return||0)};};
  const saxQ=()=>{const q=pd();return {life:1+.12*(q.mouthpiece||0),dmg:1+.12*(q.bell||0),size:1+.12*(q.bell||0),kb:1+.5*(q.pressure||0),heat:q.heat||0};};
  const angDiff=(a,b)=>Math.abs(((a-b+Math.PI*3)%(Math.PI*2))-Math.PI);
  /* ціль для пера й джазової ноти: найближчий ворог, кут уперед трохи штрафується; skip — Map/Set уже вражених */
  function pickTarget(x,y,dir,maxD,skip) {
    let best=null,score=1e9;
    for(const m of state().mobs){
      if(m.hp<=0||skip&&skip.has(m))continue;
      const d=Math.hypot(m.x-x,m.y-y);if(d>maxD)continue;
      const s=dir===undefined?d:d*(1+angDiff(Math.atan2(m.y-y,m.x-x),dir));
      if(s<score){score=s;best=m;}
    }
    return best;
  }
  function orbit(L,o={}) {
    const p=state().p,c=fluteQ(),ring=(o.ring||62)*c.reach,r=(o.r||9)+c.size;
    return add('orbit',{x:p.x,y:p.y,n:o.n||3,ring,r,a0:heading(),spin:o.spin||4,range:ring+r+14,life:o.life||1.6,tick:o.tick||.4,kb:o.kb||70,dmg:(o.dmg||4.5)*lv(L)*c.dmg,col:colors.flute});
  }
  function feather(L,offset=0,o={}) {
    const p=state().p,c=fluteQ(),dir=heading(offset),sp=(o.speed||340)*c.reach,life=o.life||.9;
    return add('feather',{x:p.x,y:p.y,dir,vx:Math.cos(dir)*sp,vy:Math.sin(dir)*sp,speed:sp,turn:o.turn||5,range:sp*life,life,acq:0,r:o.tiny?3:6+c.size/2,kb:o.tiny?15:60,tiny:!!o.tiny,dmg:(o.dmg||5)*lv(L)*c.dmg,col:colors.flute});
  }
  function twister(L,o={}) {
    const p=state().p,c=fluteQ(),t=api.nearest(1)[0],dir=heading(),near=t&&Math.hypot(t.x-p.x,t.y-p.y)<=430,r=(o.r||50)*c.reach;
    return add('twister',{x:near?t.x:p.x+Math.cos(dir)*130,y:near?t.y:p.y+Math.sin(dir)*130,r,range:r*1.8,pull:o.pull||85,life:o.life||1.2,tick:.3,kb:25,dmg:(o.dmg||2.8)*lv(L)*c.dmg,col:colors.flute});
  }
  function gust(L,o={}) {
    const p=state().p,c=fluteQ(),range=(o.range||150)*c.reach;
    return add('gust',{x:p.x,y:p.y,dir:heading(),split:o.split||0,w:o.w||1.2,range,r:0,life:o.life||.4,kb:o.kb||260,dmg:(o.dmg||8)*lv(L)*c.dmg,col:colors.flute});
  }
  function blast(L,o={}) {
    const p=state().p,s=saxQ();
    return add('blast',{x:p.x,y:p.y,r:0,maxR:(o.r||110)*s.size,life:(o.life||.4)*s.life,kb:(o.kb||300)*s.kb,dmg:(o.dmg||6)*lv(L)*s.dmg,heat:s.heat,col:colors.sax});
  }
  function fireball(L,offset=0,o={}) {
    const p=state().p,s=saxQ(),dir=heading(offset),sp=o.speed||330,range=(o.range||300)*s.life;
    return add('fireball',{x:p.x,y:p.y,ox:p.x,oy:p.y,dir,vx:Math.cos(dir)*sp,vy:Math.sin(dir)*sp,speed:sp,range,r:o.r||8,aoe:(o.aoe||60)*s.size,ex:-1,dealt:0,life:range/sp+.6,kb:(o.kb||170)*s.kb,dmg:(o.dmg||7)*lv(L)*s.dmg,heat:s.heat,col:colors.sax});
  }
  function smokering(L,o={}) {
    const p=state().p,s=saxQ(),dir=heading(),sp=o.speed||85;
    return add('smokering',{x:p.x,y:p.y,dir,vx:Math.cos(dir)*sp,vy:Math.sin(dir)*sp,r0:16,r:16,maxR:(o.r||85)*s.size,range:(o.r||85)*s.size+20,life:(o.life||1.7)*s.life,kb:(o.kb||40)*s.kb,dmg:(o.dmg||16)*lv(L)*s.dmg,heat:s.heat,col:colors.sax});
  }
  function bounce(L,o={}) {
    const p=state().p,s=saxQ(),dir=heading(),sp=o.speed||440,hops=o.hops||3;
    return add('bounce',{x:p.x,y:p.y,px:p.x,py:p.y,dir,vx:Math.cos(dir)*sp,vy:Math.sin(dir)*sp,speed:sp,turn:18,hops,left:hops,jump:160,r:8,range:420,acq:0,life:.9*s.life,kb:70*s.kb,dmg:(o.dmg||5)*lv(L)*s.dmg,heat:s.heat,col:colors.sax});
  }
  function puddle(L,o={}) {
    const p=state().p,s=saxQ(),t=api.nearest(1)[0],dir=heading(),near=t&&Math.hypot(t.x-p.x,t.y-p.y)<=300,r=(o.r||46)*s.size;
    return add('puddle',{x:near?t.x:p.x+Math.cos(dir)*150,y:near?t.y:p.y+Math.sin(dir)*150,r,range:r*2,life:(o.life||1.5)*s.life,tick:.3,dmg:(o.dmg||2.2)*lv(L)*s.dmg,heat:s.heat,col:colors.sax});
  }
  // Кільце від однієї ноти перебору: мале, лише штовхає назовні, не притягує і не відбиває снаряди.
  function noteRing(L,o={}) {
    const p=state().p,q=pd();return add('noteRing',{x:p.x,y:p.y,r:0,maxR:(o.r||100)*(1+.12*(q.folds||0)),life:o.down?.38:.3,dmg:(o.dmg||6)*lv(L)*(1+.12*(q.reeds||0))*(o.down?1+.5*(q.heavy||0):1),kb:o.kb||40,col:colors.accordion,down:!!o.down,slow:q.tongue||0,poison:q.poison||0});
  }
  /* ---- техніка кожної ноти: evs[0] — нота, що саме грає; D — шкода ноти ваги 1 (як стара атака партії), решта — D×TECH_W.
     balanceK ділить на суму ваг, тому шкода за такт лишається на рівні старої, скільки б нот не було ---- */
  const beamNote=(L,k,life,total)=>beam(L,k*.14,285*(1+.3*k),life,total/Math.ceil(life/.16),.34);
  function fluteNote(e,L,o={}) {
    const t=technique(e),D=o.D||11,k=keyOf(e.midi,76);
    if(t==='orn')return feather(L,0,{tiny:true,dmg:D*.2,life:.3,speed:300});
    if(t==='trill')return orbit(L,{n:2,life:.5,ring:40,r:5,spin:9,tick:.25,dmg:D*.3});
    if(t==='accent')return gust(L,{split:.45,w:1.2,range:150*(1+.3*k),dmg:D*1.5});
    if(t==='long')return boom(L,k*.1,D*1.5,(o.range||240)*(1+.35*k),clamp(e.seconds,.5,1.8));
    return feather(L,k*.14,{life:.5*(1+.35*k),speed:420,dmg:D,turn:6});
  }
  function saxNote(e,L,o={}) {
    const t=technique(e),D=o.D||6,k=keyOf(e.midi,66);
    if(t==='orn')return blast(L,{r:28,dmg:D*.2,life:.2,kb:60});
    if(t==='accent')return blast(L,{r:110*(1+.15*k),dmg:D*1.5,life:.4});
    if(t==='fall')return puddle(L,{dmg:D/5,r:46*(1+.15*k)});
    if(t==='leap')return bounce(L,{hops:2,dmg:D/2});
    if(t==='long')return beamNote(L,k,clamp(e.seconds,.3,1.8),D*1.5);
    return blast(L,{r:70*(1+.2*k),dmg:D,life:.3});
  }
  /* Нічого не зіграно (атака без ноти) — стара атака партії */
  const starterAtk={flute:(e,L)=>e&&e.length?fluteNote(e[0],L,{D:12}):boom(L),sax:(e,L)=>e&&e.length?saxNote(e[0],L,{D:16}):beam(L)};
  const starterSteps={flute:(ch,s,b)=>fluteSong(ch,s,b,false),sax:(ch,s,b)=>saxSong(ch,s,b,false)};
  const layers={
    flute:[
      {id:'melody',icon:'boomerang',name:T('Пташина мелодія'),lv:strength,desc:T('Нота летить уперед і повертається до тебе. Вражає ворога один раз на кожному шляху.'),perNote:true,steps:(ch,s,b)=>fluteSong(ch,s,b,true),atk:(e,L)=>e.length?fluteNote(e[0],L,{D:12}):boom(L)},
      {id:'flutter',icon:'flutter',name:T('Помах крил'),lv:strength,desc:T('Помах крил здіймає короткий широкий порив вітру, що відштовхує ворогів перед пташкою.'),steps:(ch,s,b)=>fluteFlutter(ch,s,b),atk:(e,L)=>gust(L,{split:.45,w:1.2,range:150,dmg:9})},
      {id:'spiral',icon:'spiral',name:T('Листяний вир'),lv:strength,desc:T('Три листки кружляють навколо пташки та січуть усіх, хто підійшов упритул.'),steps:(ch,s,b)=>fluteSpiral(ch,s,b),atk:(e,L)=>orbit(L,{n:3,life:1.6,ring:64,r:9,spin:4,dmg:4.5})},
      {id:'call',icon:'call',name:T('Поклик гаю'),lv:strength,desc:T('Далека протяжна нота проходить крізь натовп і повертається.'),steps:(ch,s,b)=>s===0&&b%2===1?[E(cn(ch,3,72),.55,14,{seconds:1})]:[],atk:(e,L)=>boom(L,0,20,355,1.8)},
      {id:'trill',icon:'trill',name:T('Трель сопілки'),lv:strength,desc:T('Наприкінці кожної другої фрази два дрібні листки швидко кружляють навколо пташки.'),perNote:true,steps:(ch,s,b)=>fluteTrill(ch,s,b),atk:(e,L)=>e.length?fluteNote(e[0],L,{D:8.4}):orbit(L,{n:2,life:.7,ring:48,r:6,spin:9,tick:.25,dmg:2.8})},
      {id:'stacc',icon:'stacc',name:T('Стакато крил'),lv:strength,desc:T('Кожна коротка нота випускає невелику пір’їнку, що сама наводиться на найближчого ворога.'),steps:(ch,s,b)=>fluteStacc(ch,s,b),atk:(e,L)=>feather(L,0,{life:.9,dmg:4.5,speed:360})},
      {id:'legato',icon:'legato',name:T('Легато гаю'),lv:strength,desc:T('Одна довга нота за такт проходить крізь натовп і повертається.'),perNote:true,steps:(ch,s,b)=>s===0?[E(pp(ch,0,songNote(ch,s,b,72),72),.58,15,{seconds:Math.min(1.2,stepSec()*12)})]:[],atk:(e,L)=>e.length?fluteNote(e[0],L,{D:15,range:315}):boom(L,0,15,315,1.8)},
      {id:'scale',icon:'scale',name:T('Гамма листя'),lv:strength,desc:T('Нотна гамма скликає невеликий смерч на ворогах: він затягує їх до центру та січе.'),steps:(ch,s,b)=>fluteScale(ch,s,b),atk:(e,L)=>twister(L)},
      {id:'high',icon:'high',name:T('Високий флажолет'),lv:strength,desc:T('Раз на два такти висока нота летить далеко вперед.'),steps:(ch,s,b)=>b%2===0&&s===8?[E(cn(ch,2,84),.32,6,{seconds:.8})]:[],atk:(e,L)=>boom(L,0,18,370,1.4)},
      {id:'duet',icon:'duet',name:T('Дует пташок'),lv:strength,desc:T('Друга сопілка відповідає мелодії: дві пір’їнки розлітаються й самі шукають ворогів.'),steps:(ch,s,b)=>fluteDuet(ch,s,b),atk:(e,L)=>{feather(L,-.3,{dmg:6,life:1.1});feather(L,.3,{dmg:6,life:1.1});}}
    ],
    violin:[
      {id:'bow',icon:'thread',name:T('Звукова струна'),lv:strength,desc:T('Смичок натягує між двома точками звукову нитку. Вороги на ній отримують періодичну шкоду.'),steps:(ch,s,b)=>events(ch,s,b,[0,8],67,.85),atk:(e,L)=>thread(L)},
      {id:'pizz',icon:'pizz',name:T('Піцикато'),lv:strength,desc:T('Короткий щипок ставить поперечну нитку перед тобою.'),steps:(ch,s,b)=>events(ch,s,b,[6,14],67,.2).map(e=>({...e,art:'pizzicato'})),atk:(e,L)=>thread(L,0,150,.7,5.5,true)},
      {id:'web',icon:'web',name:T('Нотна павутина'),lv:strength,desc:T('Три звукові нитки розходяться віялом і сповільнюють ворогів.'),steps:(ch,s,b)=>s===0&&b%2===1?tones(ch,67,3).map((m,i)=>E(m,.26,6,{seconds:.8,off:i*.02})):[],atk:(e,L)=>{for(const d of [-.9,0,.9])thread(L,d,165,1.8,2.8);}},
      {id:'harmonics',icon:'harmonics',name:T('Срібна нитка'),lv:strength,desc:T('Висока дзвінка нота натягує довгу тонку струну крізь ряди ворогів.'),steps:(ch,s,b)=>s===8&&b%2===0?[{...note(ch,2,79,.35,.9),art:'violin_harmonic'}]:[],atk:(e,L)=>thread(L,0,355,1.4,5)},
      {id:'tremolo',icon:'tremolo',name:T('Тремоло смичка'),lv:strength,desc:T('Швидкі повтори однієї ноти змушують нитку тремтіти.'),steps:(ch,s,b)=>b%2===0&&s<4?[note(ch,1,67,.28,.16)]:[],atk:(e,L)=>thread(L,0,155,.75,2.5)},
      {id:'spicc',icon:'spicc',name:T('Спіккато'),lv:strength,desc:T('Смичок підскакує короткими нотами на слабких долях.'),steps:(ch,s,b)=>[2,6,10,14].includes(s)?[note(ch,s%3,67,.34,.18)]:[],atk:(e,L)=>thread(L,0,125,.7,3.5,true)},
      {id:'double',icon:'double',name:T('Подвійні ноти'),lv:strength,desc:T('Дві струни беруть ноти поточного акорду й розходяться вилкою.'),steps:(ch,s,b)=>s===0||s===8?[note(ch,0,67,.4,.55),note(ch,2,67,.3,.55)]:[],atk:(e,L)=>{thread(L,-.3,175,1.1,3);thread(L,.3,175,1.1,3);}},
      {id:'gliss',icon:'gliss',name:T('Глісандо скрипки'),lv:strength,desc:T('Ноти акорду пробігають угору в кінці кожної другої фрази.'),steps:(ch,s,b)=>b%2===1&&s>=12?[note(ch,s-12,67,.3,.21)]:[],atk:(e,L)=>thread(L,0,200,1,3.5)},
      {id:'col',icon:'col',name:T('Колленьо'),lv:strength,desc:T('Дерево смичка коротко б’є по струнах на другу й четверту долю.'),steps:(ch,s,b)=>s===4||s===12?[note(ch,1,67,.36,.13)]:[],atk:(e,L)=>thread(L,0,150,.5,5,true)},
      {id:'sing',icon:'sing',name:T('Наспів скрипки'),lv:strength,desc:T('Довга мелодія поточного акорду тягне нитку крізь ворогів.'),steps:(ch,s,b)=>s===0||s===8?[E(songNote(ch,s,b,67),.47,7,{seconds:.85})]:[],atk:(e,L)=>thread(L,0,330,1.6,4)}
    ],
    sax:[
      {id:'breath',icon:'beam',name:T('Довгий видих'),lv:strength,desc:T('Тримай дистанцію: тривалий потік звуку б’є ворогів у вузькому секторі.'),perNote:true,steps:(ch,s)=>[2,10].includes(s)?[E(cn(ch,0,60),.55,4,{seconds:.62})]:[], /* заготовка: у грі steps підміняє game.html (SAX_BREATH_CARDS) */
      atk:(e,L)=>e.length?saxNote(e[0],L,{D:19.5}):beam(L)},
      {id:'stab',icon:'stab',name:T('Латунний акцент'),lv:strength,desc:T('Короткий латунний акцент створює ударне кільце навколо дракона та розкидає ворогів.'),perNote:true,steps:(ch,s)=>s===4||s===12?[E(cn(ch,0,60),.55,2,{seconds:.22,accent:true})]:[], /* заготовка: у грі steps підміняє game.html (SAX_STAB_CARDS) */
      atk:(e,L)=>e.length?saxNote(e[0],L,{D:7}):blast(L,{r:120,dmg:7,life:.4})},
      {id:'growl',icon:'growl',name:T('Драконяче бурчання'),lv:strength,desc:T('Низька нота створює широкий звуковий потік поруч із драконом.'),steps:(ch,s,b)=>s===0&&b%2===0?[E(cn(ch,0,43),.55,3,{seconds:.28})]:[],atk:(e,L)=>beam(L,0,195,.95,4.5,.78)},
      {id:'fanfare',icon:'fanfare',name:T('Фанфара'),lv:strength,desc:T('Три вогняні кулі розлітаються віялом і вибухають, підпалюючи ворогів.'),steps:(ch,s,b)=>s===0&&b%4===0?tones(ch,69,3).map((m,i)=>E(m,.34,4,{seconds:.55,off:i*.025})):[],atk:(e,L)=>{for(const d of [-.35,0,.35])fireball(L,d,{dmg:7,aoe:62});}},
      {id:'riff',icon:'riff',name:T('Риф сакса'),lv:strength,desc:T('Гостра синкопа випускає малу вогняну кульку, що вибухає при влучанні.'),perNote:true,steps:(ch,s,b)=>saxSong(ch,s,b,true),atk:(e,L)=>e.length?saxNote(e[0],L,{D:5.5}):fireball(L,0,{dmg:5,aoe:44,r:6,speed:400,range:260})},
      {id:'subtone',icon:'subtone',name:T('Субтон-балада'),lv:strength,desc:T('Тиха довга нота пускає повільне димове кільце, що росте й сповільнює ворогів.'),steps:(ch,s,b)=>s===0&&b%2===0?[E(cn(ch,0,48),.32,8,{seconds:1.1})]:[],atk:(e,L)=>smokering(L,{dmg:16})},
      {id:'growline',icon:'growline',name:T('Гроул-лінія'),lv:strength,desc:T('Хрипка нота стрибає з ворога на ворога, вражаючи кількох поспіль.'),steps:(ch,s,b)=>hookEvents(ch,s,b,{shift:-12,vk:1.25,sec:.11,accent:true,double:false}),atk:(e,L)=>bounce(L,{hops:3,dmg:5})},
      {id:'falloff',icon:'falloff',name:T('Фол-оф'),lv:strength,desc:T('Спадна нота лишає на землі палаючу калюжу, що пече ворогів, які стали в неї.'),steps:(ch,s,b)=>b%4===3&&s>=8?hookEvents(ch,s,b,{sec:.12,double:false}):[],atk:(e,L)=>puddle(L,{dmg:2.2,r:46})},
      {id:'tongue',icon:'tongue',name:T('Слеп-язик сакса'),lv:strength,desc:T('Перкусійний удар язиком створює мале ударне кільце дзвінкої латуні.'),steps:(ch,s,b)=>saxTongue(ch,s,b),atk:(e,L)=>blast(L,{r:80,dmg:4,life:.3})},
      {id:'improv',icon:'improv',name:T('Імпровізація сакса'),lv:strength,desc:T('Імпровізована нота двічі стрибає між найближчими ворогами.'),steps:(ch,s,b)=>saxImprov(ch,s,b),atk:(e,L)=>bounce(L,{hops:2,dmg:4.5})}
    ],
    accordion:[
      {id:'bellows',icon:'bellows',name:T('Вдих і видих'),lv:strength,desc:T('Міхи тримають поточний акорд; хвилі притягують ворогів і відштовхують на видиху.'),steps:(ch,s)=>reeds(ch,s,[0,12],'bellows'),atk:(e,L)=>pulse(L)},
      {id:'chords',icon:'chordwave',name:T('Кнопковий акорд'),lv:strength,desc:T('Одночасні голоси поточного акорду додають протяжне звучання та широку хвилю.'),steps:(ch,s)=>reeds(ch,s,[4,12],'chords',.2),atk:(e,L)=>pulse(L,235,6,.22)},
      {id:'bass',icon:'basswave',name:T('Ліва рука'),lv:strength,desc:T('Басова кнопка тримає основу поточного акорду й різко відкидає ворогів.'),steps:(ch,s,b)=>b%2===1?reeds(ch,s,[0],'bass',.32,true):[],atk:(e,L)=>pulse(L,130,15,.48)},
      {id:'dance',icon:'dance',name:T('Жаб’ячий танок'),lv:strength,desc:T('Протяжний поточний акорд розгортає далеку пару хвиль навколо жабки.'),steps:(ch,s,b)=>b%2===0?reeds(ch,s,[10],'dance',.2):[],atk:(e,L)=>pulse(L,295,8,.3)},
      {id:'oompah',icon:'oompah',name:T('Умпа'),lv:strength,desc:T('Бас на першу долю, легкий кнопковий акорд на решту долей.'),steps:(ch,s)=>s===0?reeds(ch,s,[0,4,8,12],'oom-bass',.36,true):s%4===0?reeds(ch,s,[0,4,8,12],'oom-chord',.2):[],atk:(e,L)=>noteRing(L,{r:e[0]?.midi<55?125:92,dmg:e[0]?.midi<55?9:5,kb:55,down:e[0]?.midi<55})},
      {id:'right',icon:'right',name:T('Мелодія правої руки'),lv:strength,desc:T('Права рука грає ноти поточного акорду й посилає нотки до ворога.'),steps:(ch,s,b)=>melodyBeats().includes(s)?[E(songNote(ch,s,b),api.SONG?.hook?.mood==='fierce'?.6:.48,4,{seconds:melodyLength()})]:[],atk:(e,L)=>noteRing(L,{r:105,dmg:7,kb:35})},
      {id:'under',icon:'under',name:T('Підголосок'),lv:strength,desc:T('Нижчий голос відповідає мелодії нотами цього ж акорду.'),steps:(ch,s,b)=>melodyBeats(true).includes(s)?[E(songNote(ch,s-2,b,55)-12,.3,3,{seconds:Math.min(.34,melodyLength())})]:[],atk:(e,L)=>noteRing(L,{r:83,dmg:4,kb:25})},
      {id:'gliss',icon:'gliss',name:T('Глісандо по кнопках'),lv:strength,desc:T('Наприкінці такту ноти акорду пробігають угору віялом.'),steps:(ch,s)=>s>=12?[note(ch,s-12,67,.3,.18)]:[],atk:(e,L)=>noteRing(L,{r:95,dmg:5,kb:30})},
      {id:'trem',icon:'trem',name:T('Тремоло міхами'),lv:strength,desc:T('Чотири швидкі поштовхи акорду на початку фрази.'),steps:(ch,s,b)=>b%4===0&&s<4?reeds(ch,s,[0,1,2,3],'trem',.17):[],atk:(e,L)=>noteRing(L,{r:72,dmg:3,kb:25})}
    ]
  };
  /* картки акордів гравця (терція, квінта, тоніка, обернення…) мають чутно міняти й інші партії флейти й сакса; партії зрізу вже користуються pp самі */
  const OWN_PITCH=new Set(['flute/melody','flute/legato','flute/trill','sax/riff']);
  for(const [inst,low] of [['flute',72],['sax',60]])for(const l of layers[inst]){
    if(OWN_PITCH.has(inst+'/'+l.id))continue;const steps=l.steps;
    l.steps=(ch,s,b,L)=>steps(ch,s,b,L).map(e=>e.orn||e.midi===undefined?e:{...e,midi:pp(ch,s,e.midi,low)});
  }
  const gear={
    flute:[
      {key:'wind',name:T('Різьблений мундштук'),ic:'♧',type:'спорядження',fx:{wind:1},lv:ranks('Політ нот +12%','Політ нот +24%','Політ нот +36%')},
      {key:'feather',name:T('Легке пір’я'),ic:'➶',type:'спорядження',fx:{haste:1},lv:ranks('Швидкість руху +5%','Швидкість руху +10%','Швидкість руху +15%')},
      {key:'return',name:T('Листяний хвіст'),ic:'↶',type:'спорядження',fx:{return:1},lv:ranks('Шкода нот +10%; ширина +2','Шкода нот +20%; ширина +4','Шкода нот +30%; ширина +6')},
      {key:'nest',name:T('Гніздечко'),ic:'♥',type:'помічник',fx:{heal:1,magnet:1},lv:ranks('Вбивство лікує 1 HP; підбір +30','Лікує 2 HP; підбір +60','Лікує 3 HP; підбір +90')},
      {key:'sharp',name:T('Гострий вітер'),ic:'✦',type:'спорядження',fx:{sharp:1},lv:ranks('Шанс сильного пориву 10%','Шанс сильного пориву 20%','Шанс сильного пориву 30%')},
      {key:'vibrato',name:T('Вібрато сопілки'),ic:'≈',type:'педаль',fx:{vibrato:1},lv:ranks('Легке коливання висоти','Глибше коливання висоти','Виразне коливання висоти')},
      {key:'breath',name:T('Подих сопілки'),ic:'◌',type:'педаль',fx:{breath:1},lv:ranks('Чутний подих на початку ноти','Більше повітря в атаці','Широкий подих в атаці')},
      {key:'echo',name:T('Ехо гаю'),ic:'↝',type:'педаль',fx:{echo:1},lv:ranks('Тихе відлуння ноти','Помітне відлуння ноти','Глибоке відлуння ноти')},
      {key:'octave',name:T('Верхня октава сопілки'),ic:'↑',type:'педаль',fx:{octave:1},lv:ranks('Тиха нота октавою вище','Сильніша верхня октава','Яскрава верхня октава')},
      {key:'flutter',name:T('Флатер-язик'),ic:'≋',type:'педаль',fx:{flutter:1},lv:ranks('Легке тремоло звуку','Глибше тремоло звуку','Швидке виразне тремоло')}
    ],
    violin:[
      {key:'resin',name:T('Бурштинова каніфоль'),ic:'◆',type:'спорядження',fx:{resin:1},lv:ranks('Шкода ниток +12%','Шкода ниток +24%','Шкода ниток +36%')},
      {key:'bridge',name:T('Резонансна підставка'),ic:'⌁',type:'спорядження',fx:{bridge:1},lv:ranks('Довжина ниток +12%; тривалість +15%','Довжина +24%; тривалість +30%','Довжина +36%; тривалість +45%')},
      {key:'silk',name:T('Шовкові струни'),ic:'≋',type:'спорядження',fx:{silk:1},lv:ranks('Нитки сповільнюють на 20%','Нитки сповільнюють на 28%','Нитки сповільнюють на 36%')},
      {key:'keeper',name:T('Павучок-майстер'),ic:'♥',type:'помічник',fx:{heal:1,guard:1},lv:ranks('Вбивство лікує 1 HP; вхідна шкода −8%','Лікує 2 HP; вхідна шкода −16%','Лікує 3 HP; вхідна шкода −24%')},
      {key:'tension',name:T('Натяг струни'),ic:'✦',type:'спорядження',fx:{tension:1},lv:ranks('Шанс гострої нитки 10%','Шанс гострої нитки 20%','Шанс гострої нитки 30%')},
      {key:'vibrato',name:T('Вібрато скрипки'),ic:'≈',type:'педаль',fx:{vibrato:1},lv:ranks('Легке коливання висоти','Глибше коливання висоти','Виразне коливання висоти')},
      {key:'mute',name:T('Сурдина'),ic:'◒',type:'педаль',fx:{mute:1},lv:ranks('Темніший тон скрипки','М’який приглушений тон','Глибокий камерний тон')},
      {key:'hall',name:T('Зал скрипки'),ic:'⌒',type:'педаль',fx:{hall:1},lv:ranks('Легкий хвіст зали','Помітний хвіст зали','Довгий хвіст зали')},
      {key:'alto',name:T('Альтова струна'),ic:'↓',type:'педаль',fx:{alto:1},lv:ranks('Тихий голос октавою нижче','Сильніший нижній голос','Густий альтовий голос')},
      {key:'orchestra',name:T('Малий оркестр'),ic:'◈',type:'педаль',fx:{orchestra:1},lv:ranks('Легке ансамблеве подвоєння','Ширший ансамбль','Повний ансамблевий тон')}
    ],
    sax:[
      {key:'mouthpiece',name:T('Довга тростина'),ic:'∞',type:'спорядження',fx:{mouthpiece:1},lv:ranks('Тривалість потоків +12%','Тривалість потоків +24%','Тривалість потоків +36%')},
      {key:'bell',name:T('Золотий розтруб'),ic:'◁',type:'спорядження',fx:{bell:1},lv:ranks('Шкода +12%; ширший потік','Шкода +24%; ще ширший потік','Шкода +36%; широкий потік')},
      {key:'pressure',name:T('Запас повітря'),ic:'≪',type:'спорядження',fx:{pressure:1},lv:ranks('Потоки відштовхують сильніше','Подвійний тиск потоків','Потрійний тиск потоків')},
      {key:'harness',name:T('М’яка перев’язь'),ic:'♢',type:'спорядження',fx:{guard:1,haste:1},lv:ranks('Вхідна шкода −8%; рух +5%','Вхідна шкода −16%; рух +10%','Вхідна шкода −24%; рух +15%')},
      {key:'heat',name:T('Жар розтруба'),ic:'♨',type:'спорядження',fx:{heat:1},lv:ranks('Потік залишає короткий жар','Жар тримається довше','Гарячий потік підпалює сильніше')},
      {key:'subtone',name:T('Субтон сакса'),ic:'◌',type:'педаль',fx:{subtone:1},lv:ranks('М’якший тон із подихом','Темніший подих сакса','Глибокий субтон')},
      {key:'echo',name:T('Ехо клубу'),ic:'↝',type:'педаль',fx:{echo:1},lv:ranks('Коротке клубне відлуння','Помітне клубне відлуння','Глибоке клубне відлуння')},
      {key:'octave',name:T('Нижня октава сакса'),ic:'↓',type:'педаль',fx:{octave:1},lv:ranks('Тихий голос октавою нижче','Сильніший нижній голос','Густий нижній голос')},
      {key:'chorus',name:T('Хорус сакса'),ic:'≋',type:'педаль',fx:{chorus:1},lv:ranks('Легке подвоєння звуку','Ширше подвоєння звуку','Густий хорус')},
      {key:'vibrato',name:T('Вібрато сакса'),ic:'≈',type:'педаль',fx:{vibrato:1},lv:ranks('Легке коливання висоти','Глибше коливання висоти','Виразне коливання висоти')}
    ],
    accordion:[
      {key:'folds',name:T('Широкі міхи'),ic:'≋',type:'спорядження',fx:{folds:1},lv:ranks('Радіус хвиль +12%','Радіус хвиль +24%','Радіус хвиль +36%')},
      {key:'reeds',name:T('Сталеві язички'),ic:'♬',type:'спорядження',fx:{reeds:1},lv:ranks('Шкода хвиль +12%','Шкода хвиль +24%','Шкода хвиль +36%')},
      {key:'strap',name:T('Зручні ремені'),ic:'➶',type:'спорядження',fx:{haste:1},lv:ranks('Швидкість руху +5%','Швидкість руху +10%','Швидкість руху +15%')},
      {key:'tuner',name:T('Жабеня-настроювач'),ic:'♥',type:'помічник',fx:{heal:1,guard:1},lv:ranks('Вбивство лікує 1 HP; вхідна шкода −8%','Лікує 2 HP; вхідна шкода −16%','Лікує 3 HP; вхідна шкода −24%')},
      {key:'tongue',name:T('Липкий язик'),ic:'◔',type:'спорядження',fx:{tongue:1},lv:ranks('Кільця сповільнюють на 15%','Кільця сповільнюють на 25%','Кільця сповільнюють на 35%')},
      {key:'poison',name:T('Отруйна шкіра'),ic:'✿',type:'спорядження',fx:{poison:1},lv:ranks('Кільця отруюють на 1,5 с','Кільця отруюють на 2 с','Кільця отруюють на 2,5 с')},
      {key:'heavy',name:T('Важкі міхи'),ic:'▣',type:'спорядження',fx:{heavy:1},lv:ranks('Сильна доля: шкода +50%','Сильна доля: шкода +100%','Сильна доля: шкода +150%')},
      {key:'musette',name:T('Мокрий мюзет'),ic:'♒',type:'педаль',fx:{musette:1},lv:ranks('Помітніше биття двох язичків','Ширше биття язичків','Насичений мюзетний тембр')},
      {key:'bandoneon',name:T('Бандонеон 16′'),ic:'♭',type:'педаль',fx:{bandoneon:1},lv:ranks('Тихий язичок октавою нижче','Гучніший нижній язичок','Глибокий нижній язичок')},
      {key:'piccolo',name:T('Пікколо 4′'),ic:'♯',type:'педаль',fx:{piccolo:1},lv:ranks('Тихий язичок октавою вище','Гучніший верхній язичок','Яскравий верхній язичок')},
      {key:'cassotto',name:T('Касото'),ic:'◌',type:'педаль',fx:{cassotto:1},lv:ranks('М’якший закритий тембр','Теплий тембр','Дуже м’який тембр')},
      {key:'shake',name:T('Струс міхів'),ic:'≈',type:'педаль',fx:{shake:1},lv:ranks('Тремоло міхів 6 Гц','Глибше тремоло міхів','Сильне тремоло міхів')}
    ]
  };
  const chars={
    flute:{name:T('Сопілка-пташка'),inst:'flute',col:colors.flute,hp:85,spd:175,glyph:'♬',role:T('Сопілка · повернення нот'),desc:T('Дерев’яна пташка з крилами-листочками. Її ноти повертаються бумерангом.')},
    violin:{name:T('Скрипавук'),inst:'violin',col:colors.violin,hp:95,spd:155,glyph:'♮',role:T('Скрипка · звукові нитки'),desc:T('Скрипка на тонких лапках зі смичком-хвостом. Натягує небезпечну нотну павутину.')},
    sax:{name:T('Саксодракончик'),inst:'sax',col:colors.sax,hp:115,spd:135,glyph:'♭',role:T('Саксофон · потоки звуку'),desc:T('Малий латунний дракон із розтрубом-пащею. Видихає тривалі спрямовані потоки звуку.')},
    accordion:{name:T('Акордеон-жабка'),inst:'accordion',col:colors.accordion,hp:125,spd:135,glyph:'▥',role:T('Акордеон · контроль натовпу'),desc:T('Жабка з міхами замість животика. На вдиху притягує ворогів, на видиху розкидає.')}
  };
  function segmentDistance(x,y,x1,y1,x2,y2) {
    const dx=x2-x1,dy=y2-y1,k=Math.max(0,Math.min(1,((x-x1)*dx+(y-y1)*dy)/(dx*dx+dy*dy||1)));
    return Math.hypot(x-x1-dx*k,y-y1-dy*k);
  }
  function advance(f,dt) {
    f.age+=dt;const p=actor(f);
    if(!p||p.hp<=0){f.age=f.life;return;}
    if(f.kind==='boomerang'){
      const t=Math.min(1,f.age/f.life),k=t<.5?t*2:2-t*2;
      const endX=f.ox+Math.cos(f.dir)*f.range,endY=f.oy+Math.sin(f.dir)*f.range;
      f.x=t<.5?f.ox+(endX-f.ox)*k:p.x+(endX-p.x)*k;
      f.y=t<.5?f.oy+(endY-f.oy)*k:p.y+(endY-p.y)*k;
    } else if(f.kind==='beam'){f.x=p.x;f.y=p.y;}
    // хвилі жаби закріплені за нею: центр кільця йде разом із жабою, а не лишається там, де пролунала нота
    else if(f.kind==='bellows'){f.x=p.x;f.y=p.y;f.r=f.maxR*Math.min(1,(f.age<f.delay?f.age:f.age-f.delay)/.22);}
    else if(f.kind==='noteRing'){f.x=p.x;f.y=p.y;f.r=f.maxR*Math.min(1,f.age/.2);}
    /* нові види: лише числа (x,y,vx,vy,r...), щоб гість міг рухати їх за снапшотом без цілі */
    else if(f.kind==='orbit'){f.x=p.x;f.y=p.y;}
    else if(f.kind==='feather'||f.kind==='bounce'){
      const t=f.target;
      if(t&&t.hp>0){const want=Math.atan2(t.y-f.y,t.x-f.x),turn=f.turn*dt;f.dir+=Math.max(-turn,Math.min(turn,((want-f.dir+Math.PI*3)%(Math.PI*2))-Math.PI));f.vx=Math.cos(f.dir)*f.speed;f.vy=Math.sin(f.dir)*f.speed;}
      f.x+=f.vx*dt;f.y+=f.vy*dt;
    }
    else if(f.kind==='gust'){f.x=p.x;f.y=p.y;f.r=f.range*Math.min(1,f.age/.22);}
    else if(f.kind==='blast'){f.x=p.x;f.y=p.y;f.r=f.maxR*Math.min(1,f.age/.18);}
    else if(f.kind==='fireball'){
      if(f.ex<0){f.x+=f.vx*dt;f.y+=f.vy*dt;if(Math.hypot(f.x-f.ox,f.y-f.oy)>=f.range){f.ex=f.age;f.life=f.age+.35;}}
    }
    else if(f.kind==='smokering'){f.x+=f.vx*dt;f.y+=f.vy*dt;f.r=f.r0+(f.maxR-f.r0)*Math.min(1,f.age/f.life);}
  }
  function damage(f,m,kx=0,ky=0) {api.withAttack(f,()=>api.hurtMob(m,f.dmg,kx,ky));}
  function burn(f,m,secs,k) {
    if(!(m.burn>0))m.burnDmg=0; /* попередній підпал скінчився: не успадковуємо чужу (гітарну) шкоду й заслугу */
    m.burn=Math.max(m.burn||0,secs+.3*f.heat);m.burnOwner=f.owner;m.burnDmg=Math.max(m.burnDmg||0,(k+.3*f.heat)*f.dmg);
  }
  /* бойова логіка нових видів; true — вид оброблено тут, класичний цикл по ворогах пропускається */
  function stepNew(f,w,dt) {
    const k=f.kind,mobs=w.mobs;
    if(k==='orbit'){
      for(const m of mobs){
        if(m.hp<=0)continue;const last=f.hit.get(m);if(last!==undefined&&f.age-last<f.tick)continue;
        for(let i=0;i<f.n;i++){
          const a=f.a0+f.spin*f.age+i*Math.PI*2/f.n;
          if(Math.hypot(m.x-f.x-Math.cos(a)*f.ring,m.y-f.y-Math.sin(a)*f.ring)<m.r+f.r){
            const d=Math.hypot(m.x-f.x,m.y-f.y)||1;damage(f,m,(m.x-f.x)/d*f.kb,(m.y-f.y)/d*f.kb);f.hit.set(m,f.age);break;
          }
        }
      }
    } else if(k==='feather'){
      if((!f.target||f.target.hp<=0)&&f.age>=f.acq){f.target=pickTarget(f.x,f.y,f.dir,420);f.acq=f.age+.12;}
      for(const m of mobs){
        if(m.hp<=0||Math.hypot(m.x-f.x,m.y-f.y)>=m.r+f.r)continue;
        damage(f,m,Math.cos(f.dir)*f.kb,Math.sin(f.dir)*f.kb);f.hit.set(m,1);f.age=f.life;break;
      }
    } else if(k==='twister'){
      for(const m of mobs){
        if(m.hp<=0)continue;
        const dx=f.x-m.x,dy=f.y-m.y,d=Math.hypot(dx,dy)||1;
        if(d<f.range&&!api.isBoss?.(m)){const s=Math.min(d,f.pull*dt);m.x+=dx/d*s;m.y+=dy/d*s;}
        const last=f.hit.get(m);
        if(d<=f.r+m.r&&(last===undefined||f.age-last>=f.tick)){damage(f,m,dx/d*f.kb,dy/d*f.kb);f.hit.set(m,f.age);}
      }
    } else if(k==='gust'){
      const centers=f.split?[f.dir-f.split,f.dir+f.split]:[f.dir];
      for(const m of mobs){
        if(m.hp<=0||f.hit.has(m))continue;
        const dx=m.x-f.x,dy=m.y-f.y,d=Math.hypot(dx,dy)||1;if(d>f.r+m.r)continue;
        const a=Math.atan2(dy,dx),margin=Math.asin(Math.min(1,m.r/d));
        if(centers.some(c=>angDiff(a,c)<=f.w/2+margin)){damage(f,m,dx/d*f.kb,dy/d*f.kb);f.hit.set(m,1);}
      }
    } else if(k==='blast'){
      for(const m of mobs){
        if(m.hp<=0||f.hit.has(m))continue;
        const dx=m.x-f.x,dy=m.y-f.y,d=Math.hypot(dx,dy)||1;
        if(d<=f.r+m.r){damage(f,m,dx/d*f.kb,dy/d*f.kb);if(f.heat)burn(f,m,1,.3);f.hit.set(m,1);}
      }
    } else if(k==='fireball'){
      if(f.ex<0)for(const m of mobs){if(m.hp>0&&Math.hypot(m.x-f.x,m.y-f.y)<m.r+f.r){f.ex=f.age;f.life=f.age+.35;break;}}
      if(f.ex>=0&&!f.dealt){
        f.dealt=1;
        for(const m of mobs){
          if(m.hp<=0)continue;
          const dx=m.x-f.x,dy=m.y-f.y,d=Math.hypot(dx,dy)||1;
          if(d<=f.aoe+m.r){damage(f,m,dx/d*f.kb,dy/d*f.kb);burn(f,m,1.6,.4);f.hit.set(m,1);}
        }
      }
    } else if(k==='smokering'){
      for(const m of mobs){
        if(m.hp<=0||f.hit.has(m))continue;
        const dx=m.x-f.x,dy=m.y-f.y,d=Math.hypot(dx,dy)||1;
        if(Math.abs(d-f.r)<=m.r+9){
          damage(f,m,dx/d*f.kb,dy/d*f.kb);
          if(!api.isBoss?.(m)){m.slow=Math.max(m.slow||0,1.2);m.slowAmt=Math.max(m.slowAmt||0,.35);}
          if(f.heat)burn(f,m,1,.3);f.hit.set(m,1);
        }
      }
    } else if(k==='bounce'){
      if(f.left<=0)return true;
      if((!f.target||f.target.hp<=0)&&f.age>=f.acq){f.target=pickTarget(f.x,f.y,f.left===f.hops?f.dir:undefined,f.left===f.hops?420:f.jump,f.hit);f.acq=f.age+.1;}
      for(const m of mobs){
        if(m.hp<=0||f.hit.has(m)||Math.hypot(m.x-f.x,m.y-f.y)>=m.r+f.r)continue;
        damage(f,m,Math.cos(f.dir)*f.kb,Math.sin(f.dir)*f.kb);if(f.heat)burn(f,m,1,.3);
        f.hit.set(m,1);f.left--;f.px=m.x;f.py=m.y;
        const next=f.left>0?pickTarget(m.x,m.y,undefined,f.jump,f.hit):null;
        if(next){f.target=next;f.dir=Math.atan2(next.y-m.y,next.x-m.x);f.vx=Math.cos(f.dir)*f.speed;f.vy=Math.sin(f.dir)*f.speed;f.life=Math.max(f.life,f.age+.6);}
        else{f.left=0;f.life=f.age+.15;}
        break;
      }
    } else if(k==='puddle'){
      for(const m of mobs){
        if(m.hp<=0||Math.hypot(m.x-f.x,m.y-f.y)>f.r+m.r)continue;
        const last=f.hit.get(m);if(last!==undefined&&f.age-last<f.tick)continue;
        damage(f,m);burn(f,m,.8,.25);f.hit.set(m,f.age);
      }
    } else return false;
    return true;
  }
  function update(dt) {
    const w=state();if(!w)return;
    for(const f of w.instrumentFX||[]){
      advance(f,dt);if(f.age>=f.life)continue;
      const classic=!stepNew(f,w,dt);
      for(const m of classic?w.mobs:[]){
        if(m.hp<=0)continue;
        const dx=m.x-f.x,dy=m.y-f.y,d=Math.hypot(dx,dy)||1,last=f.hit.get(m);
        if(f.kind==='boomerang'){
          const leg=f.age<f.life/2?1:2,mask=last||0;
          if(!(mask&leg)&&d<m.r+f.r){const dir=f.age<f.life/2?f.dir:f.dir+Math.PI;damage(f,m,Math.cos(dir)*85,Math.sin(dir)*85);f.hit.set(m,mask|leg);}
        } else if(f.kind==='thread'){
          if(segmentDistance(m.x,m.y,f.x,f.y,f.x2,f.y2)>m.r+f.r||last!==undefined&&f.age-last<f.tick)continue;
          m.slow=Math.max(m.slow||0,.45);m.slowAmt=f.slow;damage(f,m);f.hit.set(m,f.age);
        } else if(f.kind==='beam'){
          const a=Math.abs(((Math.atan2(dy,dx)-f.dir+Math.PI*3)%(Math.PI*2))-Math.PI);
          if(d>f.range+m.r||d>m.r&&a>f.w/2+Math.asin(Math.min(1,m.r/d))||last!==undefined&&f.age-last<f.tick)continue;
          damage(f,m,Math.cos(f.dir)*f.kb,Math.sin(f.dir)*f.kb);if(f.heat){if(!(m.burn>0))m.burnDmg=0;m.burn=Math.max(m.burn||0,1+.3*f.heat);m.burnOwner=f.owner;m.burnDmg=Math.max(m.burnDmg||0,.3*f.heat*f.dmg);}f.hit.set(m,f.age);
        } else if(f.kind==='noteRing'){
          if(last===undefined&&d<=f.r+m.r){damage(f,m,dx/d*f.kb,dy/d*f.kb);if(f.slow&&!api.isBoss?.(m)){m.slow=Math.max(m.slow||0,.5);m.slowAmt=Math.max(m.slowAmt||0,.05+.1*f.slow);}if(f.poison){if(!(m.burn>0))m.burnDmg=0;m.burn=Math.max(m.burn||0,1+.5*f.poison);m.burnOwner=f.owner;m.burnDmg=Math.max(m.burnDmg||0,.7*f.poison*f.dmg);}f.hit.set(m,1);}
        } else if(f.kind==='bellows'){
          const phase=f.age<f.delay?1:2,mask=last||0;
          if(!(mask&phase)&&d<=f.r+m.r){const push=phase===1?-f.kb*.7:f.kb;damage(f,m,dx/d*push,dy/d*push);f.hit.set(m,mask|phase);}
        }
      }
      // Like the original attacks, a new instrument may parry notes. Each
      // effect has a small budget, so a long beam/thread cannot be a shield.
      if(api.reflectNote&&f.kind!=='noteRing'&&f.kind!=='orbit'&&f.kind!=='twister'&&f.kind!=='puddle'&&(f.reflected||0)<2)for(const e of w.eshots||[]){
        if(e.fr||e.age>=e.life)continue;
        const dx=e.x-f.x,dy=e.y-f.y,d=Math.hypot(dx,dy)||1;
        let contact=false;
        if(f.kind==='boomerang')contact=d<f.r+e.r;
        else if(f.kind==='thread')contact=segmentDistance(e.x,e.y,f.x,f.y,f.x2,f.y2)<f.r+e.r;
        else if(f.kind==='beam'){
          const a=Math.abs(((Math.atan2(dy,dx)-f.dir+Math.PI*3)%(Math.PI*2))-Math.PI);
          contact=d<f.range+e.r&&(d<e.r||a<f.w/2+Math.asin(Math.min(1,e.r/d)));
        }else if(f.kind==='bellows'||f.kind==='blast'||f.kind==='smokering')contact=Math.abs(d-f.r)<e.r+8;
        else if(f.kind==='feather'||f.kind==='bounce')contact=d<f.r+e.r;
        else if(f.kind==='fireball')contact=f.ex<0&&d<f.r+e.r;
        else if(f.kind==='gust')contact=Math.abs(d-f.r)<e.r+8&&(f.split?[f.dir-f.split,f.dir+f.split]:[f.dir]).some(c=>angDiff(Math.atan2(dy,dx),c)<=f.w/2);
        if(contact){api.reflectNote(e,f);f.reflected=(f.reflected||0)+1;if(f.reflected>=2)break;}
      }
    }
    w.instrumentFX=(w.instrumentFX||[]).filter(f=>f.age<f.life);
  }
  function interpolate(dt) {
    const w=state();if(!w)return;for(const f of w.instrumentFX||[])advance(f,dt);
    w.instrumentFX=(w.instrumentFX||[]).filter(f=>f.age<f.life);
  }
  function draw(g,visible) {
    const w=state();if(!w)return;
    for(const f of w.instrumentFX||[]){
      if(visible&&!visible(f.x,f.y,f.range||f.maxR||400))continue;
      if(api.drawPixelFX&&api.drawPixelFX(g,f))continue;
      g.save();g.globalAlpha=Math.min(1,(f.life-f.age)*5);g.strokeStyle=f.col;g.fillStyle=f.col;g.lineWidth=3;
      if(f.kind==='boomerang'){
        g.translate(f.x,f.y);g.rotate(f.dir+f.age*9);g.beginPath();g.moveTo(-11,-7);g.lineTo(2,0);g.lineTo(-11,7);g.lineTo(-2,0);g.closePath();g.fill();
        g.fillRect(4,-2,5,4);
      } else if(f.kind==='thread'){
        g.lineWidth=5;g.globalAlpha*=.3;g.beginPath();g.moveTo(f.x,f.y);g.lineTo(f.x2,f.y2);g.stroke();
        g.lineWidth=2;g.globalAlpha*=2.5;g.beginPath();g.moveTo(f.x,f.y);g.lineTo(f.x2,f.y2);g.stroke();
        for(let k=0;k<=4;k++){const t=k/4,x=f.x+(f.x2-f.x)*t,y=f.y+(f.y2-f.y)*t;g.fillRect(x-2,y-2,4,4);}
      } else if(f.kind==='beam'){
        const a=f.dir,spread=f.w/2,len=f.range*(.88+.08*Math.sin(f.age*31));
        g.globalAlpha*=.24;g.beginPath();g.moveTo(f.x,f.y);g.lineTo(f.x+Math.cos(a-spread)*len,f.y+Math.sin(a-spread)*len);g.lineTo(f.x+Math.cos(a+spread)*len,f.y+Math.sin(a+spread)*len);g.closePath();g.fill();
        g.globalAlpha*=3;for(let j=0;j<4;j++){const r=((f.age*240+j*len/4)%len);g.beginPath();g.arc(f.x,f.y,r,a-spread,a+spread);g.stroke();}
      } else if(f.kind==='noteRing'){
        g.lineWidth=2;g.beginPath();g.arc(f.x,f.y,f.r,0,Math.PI*2);g.stroke();
      } else if(f.kind==='orbit'){
        g.lineWidth=1;g.globalAlpha*=.4;g.beginPath();g.arc(f.x,f.y,f.ring,0,Math.PI*2);g.stroke();g.globalAlpha*=2.5;
        for(let i=0;i<f.n;i++){const a=f.a0+f.spin*f.age+i*Math.PI*2/f.n;g.beginPath();g.arc(f.x+Math.cos(a)*f.ring,f.y+Math.sin(a)*f.ring,f.r,0,Math.PI*2);g.fill();}
      } else if(f.kind==='feather'){
        const a=Math.atan2(f.vy,f.vx);g.translate(f.x,f.y);g.rotate(a);g.beginPath();g.moveTo(-12,0);g.lineTo(8,0);g.stroke();g.fillRect(2,-3,6,6);
      } else if(f.kind==='twister'){
        g.lineWidth=2;for(let j=0;j<5;j++){const h=f.r*(.3+.7*j/4);g.beginPath();g.ellipse(f.x,f.y-30+j*15,h,h*.3,0,0,Math.PI*2);g.stroke();}
      } else if(f.kind==='gust'){
        g.lineWidth=3;for(const c of f.split?[f.dir-f.split,f.dir+f.split]:[f.dir]){g.beginPath();g.arc(f.x,f.y,f.r,c-f.w/2,c+f.w/2);g.stroke();}
      } else if(f.kind==='blast'||f.kind==='smokering'){
        g.lineWidth=f.kind==='blast'?5:8;g.beginPath();g.arc(f.x,f.y,f.r,0,Math.PI*2);g.stroke();
      } else if(f.kind==='fireball'){
        g.beginPath();g.arc(f.x,f.y,f.ex<0?f.r:f.aoe*Math.min(1,(f.age-f.ex)*3),0,Math.PI*2);if(f.ex<0)g.fill();else g.stroke();
      } else if(f.kind==='bounce'){
        g.lineWidth=2;g.beginPath();g.moveTo(f.px,f.py);g.lineTo(f.x,f.y);g.stroke();g.beginPath();g.arc(f.x,f.y,f.r,0,Math.PI*2);g.fill();
      } else if(f.kind==='puddle'){
        g.globalAlpha*=.5;g.beginPath();g.ellipse(f.x,f.y,f.r,f.r*.65,0,0,Math.PI*2);g.fill();
      } else if(f.kind==='bellows'){
        const inward=f.age<f.delay,r=f.r;g.lineWidth=4;g.beginPath();g.arc(f.x,f.y,r,0,Math.PI*2);g.stroke();
        for(let k=0;k<8;k++){const a=k*Math.PI/4,tip=inward?r-11:r+11;g.beginPath();g.moveTo(f.x+Math.cos(a-.05)*r,f.y+Math.sin(a-.05)*r);g.lineTo(f.x+Math.cos(a)*tip,f.y+Math.sin(a)*tip);g.lineTo(f.x+Math.cos(a+.05)*r,f.y+Math.sin(a+.05)*r);g.stroke();}
      }
      g.restore();
    }
  }
  return {chars,layers,gear,update,draw,interpolate,segmentDistance,noteRing,technique,noteWeight,starterSteps,starterAtk};
}
if(typeof module!=='undefined'&&module.exports)module.exports={buildInstrumentExpansion};
