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
  // Кільце від однієї ноти перебору: мале, лише штовхає назовні, не притягує і не відбиває снаряди.
  function noteRing(L,o={}) {
    const p=state().p,q=pd();return add('noteRing',{x:p.x,y:p.y,r:0,maxR:(o.r||100)*(1+.12*(q.folds||0)),life:o.down?.38:.3,dmg:(o.dmg||6)*lv(L)*(1+.12*(q.reeds||0))*(o.down?1+.5*(q.heavy||0):1),kb:o.kb||40,col:colors.accordion,down:!!o.down,slow:q.tongue||0,poison:q.poison||0});
  }
  const layers={
    flute:[
      {id:'melody',icon:'boomerang',name:T('Пташина мелодія'),lv:strength,desc:T('Нота летить уперед і повертається до тебе. Вражає ворога один раз на кожному шляху.'),steps:(ch,s,b)=>events(ch,s,b,[0,6,10,14],72,.5),atk:(e,L)=>boom(L)},
      {id:'flutter',icon:'flutter',name:T('Помах крил'),lv:strength,desc:T('Дві короткі ноти розходяться крильцями та повертаються.'),steps:(ch,s,b)=>events(ch,s,b,[4,12],74,.24),atk:(e,L)=>{boom(L,-.27,7,165,.95);boom(L,.27,7,165,.95);}},
      {id:'spiral',icon:'spiral',name:T('Листяний вир'),lv:strength,desc:T('Три ноти-бумеранги прикривають перед і боки.'),steps:(ch,s,b)=>b%2===0&&s===8?[note(ch,2,72,.45,.65)]:[],atk:(e,L)=>{for(const d of [-1.05,0,1.05])boom(L,d,9,205,1.45);}},
      {id:'call',icon:'call',name:T('Поклик гаю'),lv:strength,desc:T('Далека протяжна нота проходить крізь натовп і повертається.'),steps:(ch,s,b)=>s===0&&b%2===1?[note(ch,3,72,.55,.9)]:[],atk:(e,L)=>boom(L,0,20,355,1.8)},
      {id:'trill',icon:'trill',name:T('Трель сопілки'),lv:strength,desc:T('Наприкінці кожної другої фрази дві ноти акорду швидко чергуються.'),steps:(ch,s,b)=>b%2===1&&s>=12?[note(ch,s%2,76,.36,.13)]:[],atk:(e,L)=>boom(L,0,4,145,.7)},
      {id:'stacc',icon:'stacc',name:T('Стакато крил'),lv:strength,desc:T('Короткі ноти кожну восьму запускають маленькі листочки.'),steps:(ch,s,b)=>s%2===0?[note(ch,(s>>1)%3,72,.3,.14)]:[],atk:(e,L)=>boom(L,0,3.5,135,.62)},
      {id:'legato',icon:'legato',name:T('Легато гаю'),lv:strength,desc:T('Одна довга нота за такт проходить крізь натовп і повертається.'),steps:(ch,s,b)=>s===0?[note(ch,b%3,72,.58,.95)]:[],atk:(e,L)=>boom(L,0,15,315,1.8)},
      {id:'scale',icon:'scale',name:T('Гамма листя'),lv:strength,desc:T('П’ять нот акорду пробігають угору в кінці фрази.'),steps:(ch,s,b)=>b%4===3&&s>=11?[note(ch,s-11,72,.3,.17)]:[],atk:(e,L)=>{for(const a of [-.3,0,.3])boom(L,a,2.5,155,.8);}},
      {id:'high',icon:'high',name:T('Високий флажолет'),lv:strength,desc:T('Раз на два такти висока нота летить далеко вперед.'),steps:(ch,s,b)=>b%2===0&&s===8?[note(ch,2,84,.32,.7)]:[],atk:(e,L)=>boom(L,0,18,370,1.4)},
      {id:'duet',icon:'duet',name:T('Дует пташок'),lv:strength,desc:T('Друга сопілка відповідає мелодії нижчим голосом того ж акорду.'),steps:(ch,s,b)=>s===2||s===10?[E(songNote(ch,s,b,72),.35,3,{seconds:.36}),E(songNote(ch,s,b,60),.24,3,{seconds:.36,off:.05})]:[],atk:(e,L)=>{boom(L,-.12,5,175,.9);boom(L,.12,5,175,.9);}}
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
      {id:'breath',icon:'beam',name:T('Довгий видих'),lv:strength,desc:T('Тримай дистанцію: тривалий потік звуку б’є ворогів у вузькому секторі.'),steps:(ch,s,b)=>events(ch,s,b,[2,10],60,.78),atk:(e,L)=>beam(L)},
      {id:'stab',icon:'stab',name:T('Латунний акцент'),lv:strength,desc:T('Короткий широкий акцент швидко відштовхує ворогів перед собою.'),steps:(ch,s,b)=>events(ch,s,b,[6,14],64,.22),atk:(e,L)=>beam(L,0,160,.25,8,.9)},
      {id:'growl',icon:'growl',name:T('Драконяче бурчання'),lv:strength,desc:T('Низька нота створює широкий звуковий потік поруч із драконом.'),steps:(ch,s,b)=>s===4&&b%2===0?[note(ch,0,55,.55,.9)]:[],atk:(e,L)=>beam(L,0,195,.95,4.5,.78)},
      {id:'fanfare',icon:'fanfare',name:T('Фанфара'),lv:strength,desc:T('Три спрямовані струмені розходяться віялом на початку фрази.'),steps:(ch,s,b)=>s===0&&b%4===0?tones(ch,64,3).map((m,i)=>E(m,.3,4,{seconds:.55,off:i*.025})):[],atk:(e,L)=>{for(const d of [-.45,0,.45])beam(L,d,325,.55,3.7,.24);}},
      {id:'riff',icon:'riff',name:T('Риф сакса'),lv:strength,desc:T('Три ноти акорду повторюються гострою синкопованою фразою.'),steps:(ch,s,b)=>[0,3,6,10,14].includes(s)?[note(ch,[0,2,1,2,0][[0,3,6,10,14].indexOf(s)],60,.48,.22)]:[],atk:(e,L)=>beam(L,0,245,.32,3.2,.35)},
      {id:'subtone',icon:'subtone',name:T('Субтон-балада'),lv:strength,desc:T('Тиха довга нота поточного акорду наповнює широкий простір.'),steps:(ch,s,b)=>s===0&&b%2===0?[note(ch,0,55,.32,1.1)]:[],atk:(e,L)=>beam(L,0,330,1.25,6,.55)},
      {id:'growline',icon:'growline',name:T('Гроул-лінія'),lv:strength,desc:T('Хрипка мелодія відповідає бочці на кожну сильну долю.'),steps:(ch,s,b)=>s%4===0?[E(songNote(ch,s,b,60),.53,3,{seconds:.31})]:[],atk:(e,L)=>beam(L,0,205,.44,3.3,.5)},
      {id:'falloff',icon:'falloff',name:T('Фол-оф'),lv:strength,desc:T('Нота акорду спадає в кінці фрази й залишає короткий потік.'),steps:(ch,s,b)=>b%2===1&&s>=12?[note(ch,15-s,60,.32,.16)]:[],atk:(e,L)=>beam(L,-.12,230,.3,3,.4)},
      {id:'tongue',icon:'tongue',name:T('Слеп-язик сакса'),lv:strength,desc:T('Перкусійні удари язиком ставлять короткі латунні акценти.'),steps:(ch,s,b)=>[2,6,10,14].includes(s)?[note(ch,0,60,.45,.12)]:[],atk:(e,L)=>beam(L,0,140,.2,4,.8)},
      {id:'improv',icon:'improv',name:T('Імпровізація сакса'),lv:strength,desc:T('Щотакту інший порядок нот поточного акорду, без зміни спільної пісні.'),steps:(ch,s,b)=>[0,4,7,10,14].includes(s)?[note(ch,(b*3+s)%4,60,.35,.22)]:[],atk:(e,L)=>beam(L,0,205,.33,3.2,.38)}
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
          damage(f,m,Math.cos(f.dir)*f.kb,Math.sin(f.dir)*f.kb);if(f.heat){m.burn=Math.max(m.burn||0,1+.3*f.heat);m.burnOwner=f.owner;m.burnDmg=Math.max(m.burnDmg||0,.3*f.heat*f.dmg);}f.hit.set(m,f.age);
        } else if(f.kind==='noteRing'){
          if(last===undefined&&d<=f.r+m.r){damage(f,m,dx/d*f.kb,dy/d*f.kb);if(f.slow&&!api.isBoss?.(m)){m.slow=Math.max(m.slow||0,.5);m.slowAmt=Math.max(m.slowAmt||0,.05+.1*f.slow);}if(f.poison){m.burn=Math.max(m.burn||0,1+.5*f.poison);m.burnOwner=f.owner;m.burnDmg=Math.max(m.burnDmg||0,.7*f.poison*f.dmg);}f.hit.set(m,1);}
        } else if(f.kind==='bellows'){
          const phase=f.age<f.delay?1:2,mask=last||0;
          if(!(mask&phase)&&d<=f.r+m.r){const push=phase===1?-f.kb*.7:f.kb;damage(f,m,dx/d*push,dy/d*push);f.hit.set(m,mask|phase);}
        }
      }
      // Like the original attacks, a new instrument may parry notes. Each
      // effect has a small budget, so a long beam/thread cannot be a shield.
      if(api.reflectNote&&f.kind!=='noteRing'&&(f.reflected||0)<2)for(const e of w.eshots||[]){
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
      } else if(f.kind==='noteRing'){
        g.lineWidth=2;g.beginPath();g.arc(f.x,f.y,f.r,0,Math.PI*2);g.stroke();
      } else if(f.kind==='bellows'){
        const inward=f.age<f.delay,r=f.r;g.lineWidth=4;g.beginPath();g.arc(f.x,f.y,r,0,Math.PI*2);g.stroke();
        for(let k=0;k<8;k++){const a=k*Math.PI/4,tip=inward?r-11:r+11;g.beginPath();g.moveTo(f.x+Math.cos(a-.05)*r,f.y+Math.sin(a-.05)*r);g.lineTo(f.x+Math.cos(a)*tip,f.y+Math.sin(a)*tip);g.lineTo(f.x+Math.cos(a+.05)*r,f.y+Math.sin(a+.05)*r);g.stroke();}
      }
      g.restore();
    }
  }
  return {chars,layers,gear,update,draw,interpolate,segmentDistance,noteRing};
}
if(typeof module!=='undefined'&&module.exports)module.exports={buildInstrumentExpansion};
