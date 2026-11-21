'use strict';

// The game supplies its world and existing damage helpers. No second combat loop
// or audio scheduler is created here; notes are still dispatched by doPlayerStep.
function buildInstrumentExpansion(api) {
  const {T,E,tones,up,lv}=api;
  const colors={flute:'#a9e6a0',violin:'#efad78',sax:'#f5d36d',accordion:'#f18fab'};
  const ranks=(a,b,c)=>[T(a),T(b),T(c)];
  const strength=ranks('Та сама фраза; базова сила','Та сама фраза; сильніша атака','Та сама фраза; ще більше сили');
  const note=(ch,index=0,low=67,vel=.55,seconds=.42)=>E(tones(ch,low,4)[index%4],vel,4,{seconds});
  // Starter parts follow the current unlocked chord. Beat/bar numbers set timing,
  // never an automatic arpeggio; melodic embellishments belong to chosen layers.
  const events=(ch,s,_bar,positions,low=67,seconds=.42)=>positions.includes(s)?[E(up(ch.root,low),.55,4,{seconds})]:[];
  function reeds(ch,s,positions,voice,vel=.3,bass=false){
    if(!positions.includes(s))return[];
    const holdSteps=(positions.find(p=>p>s)??16)-s,root=up(ch.root,bass?43:55);
    const intervals=(ch.pcs||[ch.root,(ch.root+4)%12,(ch.root+7)%12]).map(pc=>(pc-ch.root+12)%12).sort((a,b)=>a-b);
    const pitches=bass?[root]:intervals.slice(0,3).map(i=>root+i);
    return pitches.map(m=>E(m,vel,holdSteps,{holdSteps,voice:'accordion-'+voice,harmony:ch.root+':'+(ch.q||intervals.join(',')),fixedRegister:true}));
  }
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
    (w.instrumentFX||(w.instrumentFX=[])).push(f);return f;
  }
  function heading(offset=0){return api.aim(api.nearest(1)[0])+offset;}
  function boom(L,offset=0,damage=12,range=230,life=1.25) {
    const p=state().p,q=pd(),dir=heading(offset),reach=range*(1+.12*(q.wind||0));
    return add('boomerang',{x:p.x,y:p.y,ox:p.x,oy:p.y,dir,range:reach,life,r:11+2*(q.return||0),dmg:damage*lv(L)*(1+.1*(q.return||0)),col:colors.flute});
  }
  function thread(L,offset=0,length=205,life=1.55,damage=3.6,across=false) {
    const p=state().p,q=pd(),dir=heading(offset),range=length*(1+.12*(q.bridge||0)),cx=p.x+Math.cos(dir)*range*.55,cy=p.y+Math.sin(dir)*range*.55;
    const dx=Math.cos(dir+(across?Math.PI/2:0))*range/2,dy=Math.sin(dir+(across?Math.PI/2:0))*range/2;
    return add('thread',{x:cx-dx,y:cy-dy,x2:cx+dx,y2:cy+dy,r:8,life:life*(1+.15*(q.bridge||0)),tick:.3,dmg:damage*lv(L)*(1+.12*(q.resin||0)),slow:.12+.08*(q.silk||0),col:colors.violin});
  }
  function beam(L,offset=0,length=285,life=.78,damage=3.9,width=.34) {
    const p=state().p,q=pd();return add('beam',{x:p.x,y:p.y,dir:heading(offset),range:length,life:life*(1+.12*(q.mouthpiece||0)),tick:.16,w:width+.035*(q.bell||0),dmg:damage*lv(L)*(1+.12*(q.bell||0)),kb:35+18*(q.pressure||0),col:colors.sax});
  }
  function pulse(L,radius=195,damage=9,delay=.34) {
    const p=state().p,q=pd();return add('bellows',{x:p.x,y:p.y,r:0,maxR:radius*(1+.12*(q.folds||0)),life:delay+.34,delay,dmg:damage*lv(L)*(1+.12*(q.reeds||0)),kb:230,col:colors.accordion});
  }
  const layers={
    flute:[
      {id:'melody',icon:'boomerang',name:T('Пташина мелодія'),lv:strength,desc:T('Нота летить уперед і повертається до тебе. Вражає ворога один раз на кожному шляху.'),steps:(ch,s,b)=>events(ch,s,b,[0,6,10,14],72,.5),atk:(e,L)=>boom(L)},
      {id:'flutter',icon:'flutter',name:T('Помах крил'),lv:strength,desc:T('Дві короткі ноти розходяться крильцями та повертаються.'),steps:(ch,s,b)=>events(ch,s,b,[4,12],74,.24),atk:(e,L)=>{boom(L,-.27,7,165,.95);boom(L,.27,7,165,.95);}},
      {id:'spiral',icon:'spiral',name:T('Листяний вир'),lv:strength,desc:T('Три ноти-бумеранги прикривають перед і боки.'),steps:(ch,s,b)=>b%2===0&&s===8?[note(ch,2,72,.45,.65)]:[],atk:(e,L)=>{for(const d of [-1.05,0,1.05])boom(L,d,9,205,1.45);}},
      {id:'call',icon:'call',name:T('Поклик гаю'),lv:strength,desc:T('Далека протяжна нота проходить крізь натовп і повертається.'),steps:(ch,s,b)=>s===0&&b%2===1?[note(ch,3,72,.55,.9)]:[],atk:(e,L)=>boom(L,0,20,355,1.8)}
    ],
    violin:[
      {id:'bow',icon:'thread',name:T('Звукова струна'),lv:strength,desc:T('Смичок натягує між двома точками звукову нитку. Вороги на ній отримують періодичну шкоду.'),steps:(ch,s,b)=>events(ch,s,b,[0,8],67,.85),atk:(e,L)=>thread(L)},
      {id:'pizz',icon:'pizz',name:T('Піцикато'),lv:strength,desc:T('Короткий щипок ставить поперечну нитку перед тобою.'),steps:(ch,s,b)=>events(ch,s,b,[6,14],67,.2).map(e=>({...e,art:'pizzicato'})),atk:(e,L)=>thread(L,0,150,.7,5.5,true)},
      {id:'web',icon:'web',name:T('Нотна павутина'),lv:strength,desc:T('Три звукові нитки розходяться віялом і сповільнюють ворогів.'),steps:(ch,s,b)=>s===0&&b%2===1?tones(ch,67,3).map((m,i)=>E(m,.26,6,{seconds:.8,off:i*.02})):[],atk:(e,L)=>{for(const d of [-.9,0,.9])thread(L,d,165,1.8,2.8);}},
      {id:'harmonics',icon:'harmonics',name:T('Срібна нитка'),lv:strength,desc:T('Висока дзвінка нота натягує довгу тонку струну крізь ряди ворогів.'),steps:(ch,s,b)=>s===8&&b%2===0?[{...note(ch,2,79,.35,.9),art:'violin_harmonic'}]:[],atk:(e,L)=>thread(L,0,355,1.4,5)}
    ],
    sax:[
      {id:'breath',icon:'beam',name:T('Довгий видих'),lv:strength,desc:T('Тримай дистанцію: тривалий потік звуку б’є ворогів у вузькому секторі.'),steps:(ch,s,b)=>events(ch,s,b,[2,10],60,.78),atk:(e,L)=>beam(L)},
      {id:'stab',icon:'stab',name:T('Латунний акцент'),lv:strength,desc:T('Короткий широкий акцент швидко відштовхує ворогів перед собою.'),steps:(ch,s,b)=>events(ch,s,b,[6,14],64,.22),atk:(e,L)=>beam(L,0,160,.25,8,.9)},
      {id:'growl',icon:'growl',name:T('Драконяче бурчання'),lv:strength,desc:T('Низька нота створює широкий звуковий потік поруч із драконом.'),steps:(ch,s,b)=>s===4&&b%2===0?[note(ch,0,55,.55,.9)]:[],atk:(e,L)=>beam(L,0,195,.95,4.5,.78)},
      {id:'fanfare',icon:'fanfare',name:T('Фанфара'),lv:strength,desc:T('Три спрямовані струмені розходяться віялом на початку фрази.'),steps:(ch,s,b)=>s===0&&b%4===0?tones(ch,64,3).map((m,i)=>E(m,.3,4,{seconds:.55,off:i*.025})):[],atk:(e,L)=>{for(const d of [-.45,0,.45])beam(L,d,325,.55,3.7,.24);}}
    ],
    accordion:[
      {id:'bellows',icon:'bellows',name:T('Вдих і видих'),lv:strength,desc:T('Міхи тримають поточний акорд; хвилі притягують ворогів і відштовхують на видиху.'),steps:(ch,s)=>reeds(ch,s,[0,12],'bellows'),atk:(e,L)=>pulse(L)},
      {id:'chords',icon:'chordwave',name:T('Кнопковий акорд'),lv:strength,desc:T('Одночасні голоси поточного акорду додають протяжне звучання та широку хвилю.'),steps:(ch,s)=>reeds(ch,s,[4,12],'chords',.2),atk:(e,L)=>pulse(L,235,6,.22)},
      {id:'bass',icon:'basswave',name:T('Ліва рука'),lv:strength,desc:T('Басова кнопка тримає основу поточного акорду й різко відкидає ворогів.'),steps:(ch,s,b)=>b%2===1?reeds(ch,s,[0],'bass',.32,true):[],atk:(e,L)=>pulse(L,130,15,.48)},
      {id:'dance',icon:'dance',name:T('Жаб’ячий танок'),lv:strength,desc:T('Протяжний поточний акорд розгортає далеку пару хвиль навколо жабки.'),steps:(ch,s,b)=>b%2===0?reeds(ch,s,[10],'dance',.2):[],atk:(e,L)=>pulse(L,295,8,.3)}
    ]
  };
  const gear={
    flute:[
      {key:'wind',name:T('Різьблений мундштук'),ic:'♧',type:'спорядження',fx:{wind:1},lv:ranks('Політ нот +12%','Політ нот +24%','Політ нот +36%')},
      {key:'feather',name:T('Легке пір’я'),ic:'➶',type:'спорядження',fx:{haste:1},lv:ranks('Швидкість руху +5%','Швидкість руху +10%','Швидкість руху +15%')},
      {key:'return',name:T('Листяний хвіст'),ic:'↶',type:'спорядження',fx:{return:1},lv:ranks('Шкода нот +10%; ширина +2','Шкода нот +20%; ширина +4','Шкода нот +30%; ширина +6')},
      {key:'nest',name:T('Гніздечко'),ic:'♥',type:'помічник',fx:{heal:1,magnet:1},lv:ranks('Вбивство лікує 1 HP; підбір +30','Лікує 2 HP; підбір +60','Лікує 3 HP; підбір +90')}
    ],
    violin:[
      {key:'resin',name:T('Бурштинова каніфоль'),ic:'◆',type:'спорядження',fx:{resin:1},lv:ranks('Шкода ниток +12%','Шкода ниток +24%','Шкода ниток +36%')},
      {key:'bridge',name:T('Резонансна підставка'),ic:'⌁',type:'спорядження',fx:{bridge:1},lv:ranks('Довжина ниток +12%; тривалість +15%','Довжина +24%; тривалість +30%','Довжина +36%; тривалість +45%')},
      {key:'silk',name:T('Шовкові струни'),ic:'≋',type:'спорядження',fx:{silk:1},lv:ranks('Нитки сповільнюють на 20%','Нитки сповільнюють на 28%','Нитки сповільнюють на 36%')},
      {key:'keeper',name:T('Павучок-майстер'),ic:'♥',type:'помічник',fx:{heal:1,guard:1},lv:ranks('Вбивство лікує 1 HP; вхідна шкода −8%','Лікує 2 HP; вхідна шкода −16%','Лікує 3 HP; вхідна шкода −24%')}
    ],
    sax:[
      {key:'mouthpiece',name:T('Довга тростина'),ic:'∞',type:'спорядження',fx:{mouthpiece:1},lv:ranks('Тривалість потоків +12%','Тривалість потоків +24%','Тривалість потоків +36%')},
      {key:'bell',name:T('Золотий розтруб'),ic:'◁',type:'спорядження',fx:{bell:1},lv:ranks('Шкода +12%; ширший потік','Шкода +24%; ще ширший потік','Шкода +36%; широкий потік')},
      {key:'pressure',name:T('Запас повітря'),ic:'≪',type:'спорядження',fx:{pressure:1},lv:ranks('Потоки відштовхують сильніше','Подвійний тиск потоків','Потрійний тиск потоків')},
      {key:'harness',name:T('М’яка перев’язь'),ic:'♢',type:'спорядження',fx:{guard:1,haste:1},lv:ranks('Вхідна шкода −8%; рух +5%','Вхідна шкода −16%; рух +10%','Вхідна шкода −24%; рух +15%')}
    ],
    accordion:[
      {key:'folds',name:T('Широкі міхи'),ic:'≋',type:'спорядження',fx:{folds:1},lv:ranks('Радіус хвиль +12%','Радіус хвиль +24%','Радіус хвиль +36%')},
      {key:'reeds',name:T('Сталеві язички'),ic:'♬',type:'спорядження',fx:{reeds:1},lv:ranks('Шкода хвиль +12%','Шкода хвиль +24%','Шкода хвиль +36%')},
      {key:'strap',name:T('Зручні ремені'),ic:'➶',type:'спорядження',fx:{haste:1},lv:ranks('Швидкість руху +5%','Швидкість руху +10%','Швидкість руху +15%')},
      {key:'tuner',name:T('Жабеня-настроювач'),ic:'♥',type:'помічник',fx:{heal:1,guard:1},lv:ranks('Вбивство лікує 1 HP; вхідна шкода −8%','Лікує 2 HP; вхідна шкода −16%','Лікує 3 HP; вхідна шкода −24%')}
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
    else if(f.kind==='bellows')f.r=f.maxR*Math.min(1,(f.age<f.delay?f.age:f.age-f.delay)/.22);
  }
  function damage(f,m,kx=0,ky=0) {api.withAttack(f,()=>api.hurtMob(m,f.dmg,kx,ky));}
  function update(dt) {
    const w=state();if(!w)return;
    for(const f of w.instrumentFX||[]){
      advance(f,dt);if(f.age>=f.life)continue;
      for(const m of w.mobs){
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
          damage(f,m,Math.cos(f.dir)*f.kb,Math.sin(f.dir)*f.kb);f.hit.set(m,f.age);
        } else if(f.kind==='bellows'){
          const phase=f.age<f.delay?1:2,mask=last||0;
          if(!(mask&phase)&&d<=f.r+m.r){const push=phase===1?-f.kb*.7:f.kb;damage(f,m,dx/d*push,dy/d*push);f.hit.set(m,mask|phase);}
        }
      }
      // Like the original attacks, a new instrument may parry notes. Each
      // effect has a small budget, so a long beam/thread cannot be a shield.
      if(api.reflectNote&&(f.reflected||0)<2)for(const e of w.eshots||[]){
        if(e.fr||e.age>=e.life)continue;
        const dx=e.x-f.x,dy=e.y-f.y,d=Math.hypot(dx,dy)||1;
        let contact=false;
        if(f.kind==='boomerang')contact=d<f.r+e.r;
        else if(f.kind==='thread')contact=segmentDistance(e.x,e.y,f.x,f.y,f.x2,f.y2)<f.r+e.r;
        else if(f.kind==='beam'){
          const a=Math.abs(((Math.atan2(dy,dx)-f.dir+Math.PI*3)%(Math.PI*2))-Math.PI);
          contact=d<f.range+e.r&&(d<e.r||a<f.w/2+Math.asin(Math.min(1,e.r/d)));
        }else if(f.kind==='bellows')contact=Math.abs(d-f.r)<e.r+8;
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
      } else if(f.kind==='bellows'){
        const inward=f.age<f.delay,r=f.r;g.lineWidth=4;g.beginPath();g.arc(f.x,f.y,r,0,Math.PI*2);g.stroke();
        for(let k=0;k<8;k++){const a=k*Math.PI/4,tip=inward?r-11:r+11;g.beginPath();g.moveTo(f.x+Math.cos(a-.05)*r,f.y+Math.sin(a-.05)*r);g.lineTo(f.x+Math.cos(a)*tip,f.y+Math.sin(a)*tip);g.lineTo(f.x+Math.cos(a+.05)*r,f.y+Math.sin(a+.05)*r);g.stroke();}
      }
      g.restore();
    }
  }
  return {chars,layers,gear,update,draw,interpolate,segmentDistance};
}
if(typeof module!=='undefined'&&module.exports)module.exports={buildInstrumentExpansion};
