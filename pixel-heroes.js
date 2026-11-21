// Піксельні герої, намальовані кодом (без PNG-листів): сітка 40×40, ручна палітра, контур, шахове змішування тонів.
// Кожен кадр складається з частин із цілими зсувами, печеться один раз в офскрін-канвас і далі лише drawImage.
(function(root){
'use strict';
const GW=40,GH=40,FOOT=36,OUT='#120a18';
const mk=(w=GW,h=GH)=>{const a=new Array(w*h).fill(0);a.w=w;a.h=h;return a;}; // буфер знає свій розмір: герої 40×40, вороги й боси — свої
const P=(b,x,y,c)=>{x=Math.round(x);y=Math.round(y);if(c&&x>=0&&y>=0&&x<b.w&&y<b.h)b[y*b.w+x]=c;};
const rect=(b,x,y,w,h,c)=>{for(let j=0;j<h;j++)for(let i=0;i<w;i++)P(b,x+i,y+j,c);};
function line(b,x0,y0,x1,y1,c){
  x0=Math.round(x0);y0=Math.round(y0);x1=Math.round(x1);y1=Math.round(y1);
  const dx=Math.abs(x1-x0),dy=-Math.abs(y1-y0),sx=x0<x1?1:-1,sy=y0<y1?1:-1;let e=dx+dy;
  for(let n=0;n<200;n++){P(b,x0,y0,c);if(x0===x1&&y0===y1)break;const e2=2*e;if(e2>=dy){e+=dy;x0+=sx;}if(e2<=dx){e+=dx;y0+=sy;}}
}
// Овал зі світлом зверху-зліва: світлий / середній / темний тон, між ними шахове змішування.
function blob(b,cx,cy,rx,ry,pal,clipY=99){
  for(let y=Math.floor(cy-ry);y<=Math.ceil(cy+ry);y++){
    if(y>clipY)break;
    for(let x=Math.floor(cx-rx);x<=Math.ceil(cx+rx);x++){
      const nx=(x+.5-cx)/rx,ny=(y+.5-cy)/ry,d=nx*nx+ny*ny;if(d>1)continue;
      const s=nx*.6+ny*.8;let c=pal[1];
      if(s<-.5)c=pal[0];else if(s<-.3)c=(x+y)%2?pal[0]:pal[1];
      else if(s>.6&&d>.4)c=pal[2];else if(s>.42&&d>.4)c=(x+y)%2?pal[2]:pal[1];
      P(b,x,y,c);
    }
  }
}
function stamp(b,rows,x,y,pal){for(let j=0;j<rows.length;j++){const r=rows[j];for(let i=0;i<r.length;i++){const c=pal[r[i]];if(c)P(b,x+i,y+j,c);}}}

// Очі 6×6: R — обвідка/повіка, W — білок, I — райдужка, K — зіниця, H — відблиск. Дивляться вправо.
const EYES={
  open:  ['.RRRR.','RWWWWR','RWWHIR','RWWIKR','RWWWWR','.RRRR.'],
  look:  ['.RRRR.','RWWWWR','RWWWHI','RWWWIK','RWWWWR','.RRRR.'],
  half:  ['......','.RRRR.','RRRRRR','RWWHIR','RWWIKR','.RRRR.'],
  wide:  ['.RRRR.','RWWWWR','RWWWHR','RWWWKR','RWWWWR','.RRRR.'],
  blink: ['......','......','......','RRRRRR','.RRRR.','......'],
  happy: ['......','.RRRR.','RR..RR','R....R','......','......'],
  angryL:['......','RR....','RRRR..','RWWRRR','RWWIKR','.RRRR.'],
  angryR:['......','....RR','..RRRR','RRRHIR','RWWIKR','.RRRR.'],
  hurtL: ['R.....','.RR...','...RR.','.RR...','R.....','......'],
  hurtR: ['.....R','...RR.','.RR...','...RR.','.....R','......'],
  x:     ['R....R','.R..R.','..RR..','..RR..','.R..R.','R....R']
};
function eyes(b,xl,xr,y,mode,ep){stamp(b,EYES[mode+'L']||EYES[mode]||EYES.open,xl,y,ep);stamp(b,EYES[mode+'R']||EYES[mode]||EYES.open,xr,y,ep);}

// ---------- ГІТАРА-КУСАЙКА: дерев'яний корпус, паща-розетка зі струнами, кабель-хвіст ----------
function drawGuitar(b,q){
  const y=q.bob,s=q.sq,up=y+s,nk=q.nk||0;
  // кабель-хвіст (позаду), хвилею
  let px=10,py=31;
  for(let i=0;i<11;i++){const x=10-i,yy=31+y+Math.round(i*.4+Math.sin(q.tw-i*.8)*1.6*(i/10));P(b,x,yy,'#4c4766');P(b,x,yy+1,'#24202f');px=x;py=yy;}
  rect(b,px-3,py-1,3,3,'#8e97a8');P(b,px-3,py-1,'#eef2f8');P(b,px-2,py-1,'#c9d0dc');P(b,px-4,py,'#eef2f8');P(b,px-5,py,'#c9d0dc');
  // корпус: верхня й нижня деки
  const Wd=['#ffd27a','#f2983a','#b55a1a'];
  blob(b,19.5,19.5+up,9.2,6.6,Wd);
  blob(b,19.5,28.5+y+s*.5,10.4+(q.breath||0)*.6,7.6-s*.5,Wd);
  for(const [gx,gy] of [[12,27],[13,28],[26,25],[27,26],[12,31],[27,31],[25,32],[14,22]])P(b,gx,gy+y,'#d97e28');
  // гриф і голова з кілками
  rect(b,16+nk,7+up,7,7,'#6e3c1f');rect(b,16+nk,7+up,1,7,'#8e5430');rect(b,22+nk,7+up,1,7,'#4e2a14');
  for(const fy of [9,12])rect(b,16+nk,fy+up,7,1,'#c9b48a');
  rect(b,16+nk,1+up,8,6,'#c3622a');rect(b,16+nk,1+up,8,1,'#e8954e');rect(b,16+nk,6+up,8,1,'#8a3e18');rect(b,17+nk,2+up,1,3,'#e8954e');
  for(const [kx,ky] of [[15,2],[15,4],[24,2],[24,4]]){const tw=q.peg&&kx===24&&ky===2;P(b,kx+nk,ky+up,tw?'#ffffff':'#e3e8f0');P(b,kx+nk+(kx<20?-1:1),ky+up,tw?'#e3e8f0':'#9aa3b4');}
  // бридж
  rect(b,14,33+y,12,2,'#5a2a12');rect(b,14,33+y,12,1,'#7e4622');
  // три струни з темними проміжками (на ударі тремтять зиґзаґом)
  const strings=()=>{for(let k=0;k<3;k++){const on=q.vib&&((q.vibS??7)>>k&1),glow=q.glow===k||q.glow===9;
    for(let yy=7+up;yy<=33+y;yy++){
      let xx=17+k*2+(yy<=13+up?nk:0);
      if(on&&yy>14+up&&(Math.floor(yy/3)+k+q.f)%2)xx+=(k===1?1:-1)*(q.vibW||1);
      P(b,xx,yy,q.mute?'#9a8a6a':glow?'#ffffff':on&&q.vibS!==7?'#fffbe0':k===1?'#fff6e4':'#e6d6b4');
      if(glow&&yy%4===0)P(b,xx+(k===2?1:-1),yy,'#fff7c0');}}};
  // паща-розетка: закрита — струни поверх оскалу; відкрита — паща поверх струн (видно язик і зуби)
  if(q.mouth){strings();mouthGuitar(b,28+y+s,q.mouth);}else{mouthGuitar(b,28+y+s,0,q.clench);strings();}
  // клац! — іскра укусу перед пащею
  if(q.chomp){const cx=33,cy=28+y,k=q.chomp>1?2:1;for(const [a,c] of [[0,0],[-1,0],[1,0],[0,-1],[0,1],[-2,-2],[2,-2],[-2,2],[2,2],[3,0],[-3,0]])P(b,cx+a*k-(k-1),cy+c*k,Math.abs(a)+Math.abs(c)>2?'#ffd27a':'#ffffff');}
  // бій: медіатор проводить по всіх струнах (світлий слід навскіс)
  if(q.sweep){const o=q.sweep===1?0:6;line(b,13,16+o+up,26,21+o+up,'#ffffff');line(b,13,17+o+up,26,22+o+up,'#ffe6a0');rect(b,26,20+o+up,2,2,'#5a2a12');}
  // глушіння: глухий пил перед пащею
  if(q.mute&&q.phase==='hit')for(const [a,c] of [[31,25],[33,27],[32,30],[34,24],[35,29],[31,32]])P(b,a+(q.f-2),c+y,q.f===2?'#d8ccb8':'#a89c88');
  // бас пальцем: курява від тупоту
  if(q.stomp)for(const [a,c] of [[9,36],[11,35],[29,36],[27,35],[7,36],[31,36]])P(b,a+(q.f===2?0:a<20?-1:1),c,q.f===2?'#c8b898':'#8a7a60');
  // нотка, що вилітає (перебір — від струни, мелодія — угору від голови)
  if(q.note>=0){const nx=q.noteX||27,ny=(q.noteY||5)+up-q.note*2;rect(b,nx,ny+2,2,2,'#fff6c0');rect(b,nx+1,ny-1,1,3,'#fff6c0');P(b,nx+2,ny-1,'#fff6c0');P(b,nx+3,ny,'#fff6c0');}
  // соло (L3) — блиск на голові грифа; флажолети (L4) — ромбики навколо
  if(q.phase==='hit'&&q.L===3)for(const [a,c] of [[26,0],[27,1],[26,2],[28,1],[25,1]])P(b,a+nk,c+up,'#fff7c0');
  if(q.phase==='hit'&&q.L===4)for(const [a,c] of [[7,14],[31,12],[6,22],[33,20]]){P(b,a,c+up,'#bff8ff');P(b,a+1,c+1+up,'#bff8ff');P(b,a-1,c+1+up,'#bff8ff');P(b,a,c+2+up,'#bff8ff');}
  eyes(b,10,23,16+up,q.eyes,{R:'#3a1406',W:'#f4fbff',I:'#36d6e0',K:'#06222a',H:'#ffffff'});
  // лапки
  const f=q.step,LL=[0,2,3,1,0,0,0,0],RL=[0,0,0,0,0,2,3,1],DX=[-1,0,1,2,1,0,-1,-2];
  const foot=(x,yy)=>{rect(b,x,yy,4,2,'#d4893a');rect(b,x,yy+1,4,1,'#8f4e1e');P(b,x+1,yy,'#f5c27a');P(b,x+4,yy+1,'#f3e2c0');};
  foot(13+(f>=0?DX[f]:0),35-(f>=0?LL[f]:0));foot(23-(f>=0?DX[f]:0),35-(f>=0?RL[f]:0));
}
function mouthGuitar(b,cy,m,clench){
  const M='#3a0c18',Md='#22050c',T='#fff4dc';
  if(clench){rect(b,12,cy-1,16,3,M);for(let x=12;x<28;x+=2){P(b,x,cy-1,T);P(b,x+1,cy+1,T);}for(let x=13;x<28;x+=2)P(b,x,cy,T);return;} // зуби зімкнуті
  if(!m){rect(b,13,cy,14,1,M);for(let x=13;x<27;x+=2)P(b,x,cy-1,T);for(let x=14;x<27;x+=2)P(b,x,cy+1,T);return;}
  const h=[0,2,3,5][m],top=cy-(h>>1);
  for(let r=0;r<=h;r++){const e=r===0||r===h?2:0;rect(b,12+e,top+r,15-e*2,1,r>h/2?Md:M);}
  if(m>=2)rect(b,16,top+h-1,7,1,'#ff5c7a');
  for(let x=14;x<26;x+=2)P(b,x,top,T);P(b,15,top+1,T);P(b,24,top+1,T);
  for(let x=15;x<25;x+=2)P(b,x,top+h,T);
}

// ---------- БУМ-БАРАБАН: лакована обичайка, пластик зверху, палички в руках ----------
function drawDrums(b,q){
  const y=q.bob,s=q.sq,top=12+y+s,bot=31+y;
  // ноги й черевики
  const air=y<=-2,footY=air?Math.min(35,bot+3):35;
  const stomp=q.L===0&&q.phase==='ant'?3:0;
  rect(b,13,bot,2,footY-bot,'#7a1c1a');rect(b,25,bot,2,footY-stomp-bot,'#7a1c1a');
  const spread=!air&&s>0?1:0; // приземлення — ступні розходяться
  rect(b,12-spread,footY,5,2,'#2a1824');P(b,16-spread,footY,'#55405a');
  rect(b,24+spread,footY-stomp,5,2,'#2a1824');P(b,28+spread,footY-stomp,'#55405a');
  if(q.L===0&&q.phase==='hit')for(const [dx,dy] of [[21,35],[31,35],[20,36],[32,36],[10,36]])P(b,dx,dy,'#c9b8a0');
  // обичайка
  for(let yy=top;yy<=bot;yy++)for(let x=9;x<=30;x++){
    let c='#e4483a';
    if(x<=10)c='#ff8a68';else if(x<=12)c=(x+yy)%2?'#ff8a68':'#e4483a';else if(x>=29)c='#9a2222';else if(x>=27)c=(x+yy)%2?'#9a2222':'#e4483a';
    P(b,x,yy,c);
  }
  rect(b,11,top+3,1,6,'#ffc2aa');P(b,11,top+11,'#ffc2aa');
  // нижній обід
  for(let x=9;x<=30;x++){const nx=(x+.5-19.5)/10.5,ey=bot+Math.round(2*Math.sqrt(Math.max(0,1-nx*nx)));for(let yy=bot;yy<ey;yy++)P(b,x,yy,'#8a1c1a');P(b,x,ey,'#aeb6c4');}
  // натяжні гвинти
  for(const [lx,ly] of [[9,top+5],[9,bot-4],[29,top+5],[29,bot-4]]){rect(b,lx,ly,2,2,'#cfd6e0');P(b,lx,ly,'#ffffff');}
  // пластик + обід зверху
  for(let yy=Math.floor(top-3.5);yy<=Math.ceil(top+3.5);yy++)for(let x=9;x<=30;x++){
    const nx=(x+.5-19.5)/10.8,ny=(yy+.5-top)/3.6,d=nx*nx+ny*ny;if(d>1)continue;
    let c=ny>.25?'#ddd0b0':'#f6eedb';if(d>.62)c=ny<0?'#ffffff':'#b8c0cc';
    if(q.phase==='hit'&&q.f===2&&d<.3)c=d<.1?'#c9bb98':'#fff7c0'; // вм'ятина від удару
    else if(q.phase==='hit'&&d>.3&&d<.5)c='#fff7c0';
    P(b,x,yy,c);
  }
  // обличчя
  eyes(b,12,22,top+5,q.eyes,{R:'#3a0808',W:'#fff7f0',I:'#ffb020',K:'#2a1000',H:'#ffffff'});
  const my=top+13,M='#3a0808';
  if(!q.mouth){rect(b,15,my,10,1,M);P(b,14,my-1,M);P(b,25,my-1,M);P(b,17,my+1,'#ffd0c0');}
  else{const h=[0,2,3,4][q.mouth];for(let r=0;r<h;r++){const e=r===h-1?1:0;rect(b,14+e,my+r,12-e*2,1,r?'#24040a':M);}
    for(let x=15;x<25;x+=2)P(b,x,my,'#fff4e8');if(h>2)rect(b,17,my+h-2,6,1,'#ff5c6a');}
  // руки й палички
  const f=q.f,ph=q.phase;let hl,hr,tl,tr;
  if(ph==='ant'&&q.L!==0){hl=[6,9+y];hr=[33,9+y];tl=[4,1+y];tr=[35,1+y];}
  else if(ph==='hit'&&q.L!==0){
    hl=[8,top-5];hr=[31,top-5];tl=[15,top];tr=[24,top];
    if(q.L===2){hl=[6,9+y];tl=[4,1+y];}                        // хет — б'є лише права
    if(q.L===3){tl=[13,1+y];tr=[26,1+y];hl=[8,9+y];hr=[31,9+y];} // тарілка — палички схрещені вгорі
    if(q.L===4&&q.f===3){hl=[6,9+y];tl=[4,1+y];hr=[31,top-5];}  // дріб — по черзі
  }
  else{const w=q.step>=0?[0,1,1,0,0,-1,-1,0][q.step]:(f%4<2?0:1);hl=[6,21+y+w];hr=[33,21+y-w];tl=[2,14+y+w];tr=[37,14+y-w];
    if(q.twirl>=0){const a=q.twirl*Math.PI/2-Math.PI/2;tr=[hr[0]+Math.round(Math.cos(a)*6),hr[1]+Math.round(Math.sin(a)*6)];}} // крутить паличку
  const arm=(sx,h)=>{line(b,sx,20+y,h[0],h[1],'#d24a3a');line(b,sx,21+y,h[0],h[1]+1,'#7a1418');rect(b,h[0]-1,h[1]-1,2,2,'#ffb08f');};
  const stick=(h,t)=>{line(b,h[0],h[1],t[0],t[1],'#7a3e14');line(b,h[0]+1,h[1],t[0]+1,t[1],'#e0a858');P(b,t[0],t[1],'#fff3c8');P(b,t[0]+1,t[1],'#fff3c8');};
  arm(8,hl);arm(31,hr);stick(hl,tl);stick(hr,tr);
  if(ph==='hit'&&q.L!==0)for(const [sx,sy] of [[13,top-4],[17,top-5],[22,top-5],[26,top-4],[19,top-6]])P(b,sx,sy,'#fff7a0');
}

// ---------- БАСОЖУК: панцир-дека зі струнами, шість лап, ріг-гриф ----------
function drawBass(b,q){
  const y=q.bob,s=q.sq,lift=q.shell||0,hx=q.nk||0,O=-2;
  const f=q.step;
  const gait=(g)=>{if(f<0)return [0,0];const k=(f+(g?4:0))%8;return [[0,1,2,1,0,0,0,0][k],[-2,-1,0,1,2,1,0,-1][k]];};
  const leg=(rx,ry,spread,g,near)=>{
    const [lf,dx]=gait(g),kx=Math.round(rx+spread*4+dx*.5),ky=ry-3-lf,fx=Math.round(rx+spread*7+dx),fy=FOOT-lf;
    const c=near?'#2a7f8e':'#164650',cd=near?'#185462':'#0e2e36';
    line(b,rx,ry,kx,ky,c);line(b,kx,ky,fx,fy,c);line(b,kx+1,ky+1,fx+1,fy,cd);
    P(b,kx,ky,near?'#7ff0ff':'#2a6a78');rect(b,fx,fy,2,1,near?'#a8f6ff':'#2a6a78');
  };
  // далекі лапи
  leg(13+O,28+y,-1.1,1,false);leg(20+O,28+y,-.3,0,false);leg(27+O,28+y,1,1,false);
  // ріг-гриф
  const hy=q.phase==='hit'?-1:0;
  line(b,35+O+hx,25+y,38+O+hx,12+y+hy,'#2a6a78');line(b,34+O+hx,25+y,37+O+hx,12+y+hy,'#184450');
  for(const t of [.3,.55,.8]){const fx=35+O+hx+3*t,fy=25+y+(12+hy-25)*t;P(b,fx,fy,'#9fd8e0');}
  rect(b,35+O+hx,7+y+hy,4,6,'#262a40');rect(b,35+O+hx,7+y+hy,4,1,'#3e4462');
  for(const ky of [8,10])for(const kx of [34,39])P(b,kx+O+hx,ky+y+hy,'#d6deea');
  P(b,36+O+hx,6+y+hy,'#ff7ad9');P(b,37+O+hx,6+y+hy,'#ff7ad9');
  // звукове кільце від грифа на ударі
  if(q.phase==='hit'){const R=q.f===2?4:6,cx=36.5+O+hx,cy0=9.5+y+hy;for(let a=0;a<16;a++){const t=a/16*Math.PI*2;P(b,cx+Math.cos(t)*R,cy0+Math.sin(t)*R*.8,q.f===2?'#bffcff':'#58e0f0');}}
  // голова
  blob(b,31.5+O+hx,28+y,5,4.2,['#4fa0b0','#1f6070','#0f3038']);
  P(b,37+O+hx,31+y,'#9fd8e0');P(b,36+O+hx,32+y,'#9fd8e0');
  // черевце
  rect(b,7+O,28+y,23,3,'#123a44');for(let x=9+O;x<29+O;x+=4)P(b,x,29+y,'#2a6a78');
  // світло з-під піднятого панцира
  if(lift)for(let x=6+O;x<31+O;x++)for(let k=0;k<lift;k++)P(b,x,28+y-k,(x+k)%2?'#58f0ff':'#b8fbff');
  // панцир
  const cy=27+y-lift+s*.5,ry=11-s,clip=28+y-lift;
  blob(b,17.5+O,cy,13,ry,['#5872dc','#3a4fc0','#1d2a78'],clip);
  for(let x=9+O;x<=20+O;x++){const nx=(x+.5-17.5-O)/13;P(b,x,Math.round(cy-ry*Math.sqrt(1-nx*nx))+1,'#9fb6ff');}
  for(let yy=Math.ceil(cy-ry)+1;yy<=clip;yy++){const x=17+O+Math.round((yy-(cy-ry))*.18);P(b,x,yy,'#141c58');}
  for(let k=0;k<4;k++){const fk=.8-k*.17;
    for(let x=6+O;x<=29+O;x++){const nx=(x+.5-17.5-O)/13;if(Math.abs(nx)>=.93)continue;
      let yy=Math.round(cy-ry*Math.sqrt(1-nx*nx)*fk);if(q.vib&&(Math.floor(x/3)+k+q.f)%2)yy+=1;if(yy>clip)continue;
      P(b,x,yy,q.spark>=0&&k===q.spark%2&&x===6+O+((q.spark*4)%24)?'#ffffff':k<2?'#e2f0ff':'#a8c8f0');}}
  rect(b,6+O,cy-ry*.55,2,ry*.75,'#c8d0e0');
  P(b,12+O,cy-ry+3,'#e8f0ff');P(b,13+O,cy-ry+2,'#e8f0ff');P(b,14+O,cy-ry+2,'#e8f0ff');
  // ближні лапи
  leg(10+O,29+y,-1.2,0,true);leg(18+O,30+y,-.4,1,true);leg(25+O,29+y,1.1,0,true);
  // очі, що світяться
  const ex=33+O+hx,ey=26+y,E=q.eyes;
  if(E==='x'){for(const [a,c] of [[0,0],[2,0],[1,1],[0,2],[2,2]])P(b,ex+a,ey-1+c,'#bffcff');}
  else if(E==='hurt'||E==='hurtL'){P(b,ex,ey-1,'#ff9ab0');P(b,ex+1,ey,'#ff9ab0');P(b,ex,ey+1,'#ff9ab0');}
  else if(E==='blink'||E==='half'){rect(b,ex,ey+1,2,1,'#7ff0ff');P(b,ex+3,ey+1,'#7ff0ff');}
  else{const big=E==='wide'||E==='angry';rect(b,ex,ey,2,2,'#bffcff');P(b,ex+1,ey,'#ffffff');rect(b,ex+3,ey+1,1,2,'#7ff0ff');
    if(big){P(b,ex-1,ey,'#3fd8ea');P(b,ex,ey-1,'#3fd8ea');P(b,ex+2,ey-1,'#3fd8ea');}}
}

// ---------- КЛАВІСЛИЗ: фіолетовий слиз, клавіші замість зубів, нотка-антенка ----------
function drawPiano(b,q){
  const y=q.bob,s=q.sq,rx=13.5+s*.8,ry=11.5-s,cy=36.4-ry+y,topY=Math.round(cy-ry);
  // антенка-нота
  const sw=Math.round(Math.sin(q.tw)*1.2);
  line(b,20,topY+1,21+sw,topY-5,'#4a1f8a');rect(b,21+sw,topY-6,1,2,'#4a1f8a');P(b,22+sw,topY-6,'#4a1f8a');P(b,23+sw,topY-5,'#4a1f8a');
  rect(b,18+(sw>>1),topY-1,3,2,'#ffd6ff');P(b,18+(sw>>1),topY-1,'#ffffff');
  // тіло
  blob(b,19.5,cy,rx,ry,['#e6c8ff','#a874f2','#6a3cc4']);
  for(let x=Math.ceil(19.5-rx);x<19.5+rx;x++)if(Math.abs(x+.5-19.5)<rx*.85)P(b,x,Math.round(cy+ry)-1+0,'#5a2ea8');
  P(b,Math.round(19.5-rx*.75),Math.round(cy+ry*.55),'#6a3cc4');P(b,Math.round(19.5+rx*.7),Math.round(cy+ry*.6)+1,'#6a3cc4');
  P(b,13,topY+3,'#fbf0ff');P(b,14,topY+2,'#fbf0ff');P(b,15,topY+2,'#fbf0ff');P(b,12,topY+5,'#fbf0ff');
  // очі
  eyes(b,12,22,Math.round(cy)-6,q.eyes,{R:'#2a0a4a',W:'#ffffff',I:'#ff5fc8',K:'#1a0630',H:'#ffffff'});
  // рот-клавіатура
  const mt=Math.round(cy)+1,m=q.mouth,h=[0,2,3,5][m];
  rect(b,11,mt,18,3,'#2a0a4a');
  const pk=q.phase==='hit'||q.phase==='rec'?(q.f+q.L*2)%6:q.key>=0?q.key:-1;
  for(let i=0;i<6;i++){const kx=11+i*3,d=i===pk?1:0;rect(b,kx,mt+d,2,3-d,'#fdf9ee');P(b,kx,mt+d,'#ffffff');}
  for(const i of [0,1,3,4])rect(b,11+i*3+1,mt,2,2,'#1a0f24');
  if(!m){rect(b,12,mt+3,16,1,'#2a0a4a');P(b,11,mt+2,'#2a0a4a');P(b,28,mt+2,'#2a0a4a');}
  else{rect(b,11,mt+3,18,h,'#2a0a4a');rect(b,12,mt+3+Math.max(1,h-2),16,Math.min(2,h),'#14051f');if(h>2)rect(b,16,mt+2+h,7,1,'#ff6fa8');}
  // ноти-плювки
  if(q.phase==='hit'){const nx=30+(q.f-2)*4,ny=Math.round(cy)-2-(q.f-2);rect(b,nx,ny+2,3,2,'#ffe6ff');rect(b,nx+2,ny-2,1,4,'#ffe6ff');P(b,nx+3,ny-2,'#ffe6ff');P(b,nx+4,ny-1,'#ffe6ff');}
  if(q.step===0||q.step===7)P(b,4,36,'#a874f2'); // крапля-слід на кроці
}

const HEROES={
  guitar:{draw:drawGuitar,death:'side',walk:{bob:[0,-1,-1,0,0,-1,-1,0]}},
  drums:{draw:drawDrums,death:'side',walk:{bob:[0,-2,-4,-5,-4,-2,0,0],sq:[1,-1,-1,0,0,-1,0,1]}},
  bass:{draw:drawBass,death:'flip',walk:{bob:[0,0,-1,0,0,0,-1,0]}},
  piano:{draw:drawPiano,death:'puddle',walk:{bob:[0,0,-2,-4,-4,-2,0,0],sq:[2,1,-1,-2,-1,0,1,2]}}
};

// Поза → параметри малювання.
function params(ch,po){
  const H=HEROES[ch],f=po.f|0,q={bob:0,sq:0,mouth:0,eyes:'open',lean:0,step:-1,vib:0,f,L:ch==='guitar'?(po.L|0)%10:(po.L|0)%5,phase:'',tw:f*.8,nk:0,shell:0,breath:0,twirl:-1,spark:-1,key:-1,push:0};
  if(po.s==='idle'){
    q.sq=po.beat?1:0;q.tw=f*.8;q.breath=f>=3&&f<=5?1:0;
    if(po.blink)q.eyes='blink';else if(f===5||f===6)q.eyes='look';
    if(ch==='guitar')q.peg=f===2;
    if(ch==='drums')q.twirl=f>=4?f-4:-1;
    if(ch==='bass')q.spark=f;
    if(ch==='piano'){q.sq=po.beat?1:[0,0,1,1,0,0,-1,-1][f];q.key=f%4===1?(f>>1)%6:-1;}
  }else if(po.s==='walk'){
    q.step=f;q.bob=H.walk.bob[f];q.sq=H.walk.sq?H.walk.sq[f]:0;q.lean=ch==='bass'?0:.05;q.tw=f*1.4;
    if(ch==='guitar')q.nk=[0,0,1,1,0,0,-1,-1][f]; // гриф гойдається із запізненням
  }else if(po.s==='atk'){
    q.phase=f<2?'ant':f<4?'hit':'rec';
    if(q.phase==='ant'){q.sq=1;q.lean=-.04;q.eyes='half';q.nk=-1;}
    else if(q.phase==='hit'){q.sq=-1;q.lean=.1;q.eyes=q.L%2?'angry':'wide';q.mouth=3;q.vib=1;q.nk=1;q.shell=3;
      if(ch==='drums')q.sq=f===2?1:0;}                                             // барабан стискається від удару
    else{q.lean=.03;q.mouth=1;q.vib=f===4?1:0;q.shell=f===4?1:0;}
    if(ch==='bass')q.lean=0;
    if(ch==='guitar')guitarPart(q,f);
  }else if(po.s==='hurt'){q.eyes='hurt';q.mouth=1;q.lean=-.08;q.sq=f?0:1;q.push=f?-1:-2;}
  return q;
}

// Партії гітари (порядок як у LAYERS.guitar): 0 бій, 1 глушіння, 2 перебір, 3 мелодія, 4 флажолети,
// 5 бас пальцем, 6 дабл-стоп, 7 тремоло, 8 арпеджіо, 9 акцент. f 0–1 замах, 2–3 удар (на ноті), 4–5 відкат.
function guitarPart(q,f){
  const ant=f<2,hit=f===2||f===3,rec=f>3;q.vibS=7;q.vibW=1;q.note=-1;
  switch(q.L){
    case 0: // бій: медіатор униз по всіх струнах, широко роззявлена паща — і клац
      if(hit){q.sweep=f===2?1:2;q.vibW=f===2?1:2;if(f===3){q.mouth=0;q.clench=1;q.chomp=1;q.nk=2;q.lean=.13;}}
      break;
    case 1: // глушіння: стискається, зуби зімкнуті, струни глухі
      if(ant){q.sq=0;q.eyes='half';}
      if(hit||f===4){q.sq=f===2?2:1;q.lean=.05;q.mouth=0;q.clench=1;q.mute=1;q.vib=0;q.eyes='angry';q.nk=0;}
      break;
    case 2: // перебір: смикає одну струну, потім другу; з-під пальця вистрибує нотка
      q.vibS=f===2?4:f===3?2:1;q.eyes=hit?'look':q.eyes;q.lean=hit?.04:q.lean;q.sq=hit?0:q.sq;q.mouth=hit?1:q.mouth;q.nk=hit?0:q.nk;
      if(f>=3){q.note=f-3;q.noteX=26;q.noteY=20;}
      break;
    case 3: // мелодія: закидає голову, співає, тремтить верхня струна, нота летить угору
      if(!ant){q.eyes='happy';q.mouth=2;q.nk=-1;q.lean=-.03;q.sq=-1;q.vibS=4;q.note=f-2;q.noteX=26;q.noteY=4;q.vib=1;}
      break;
    case 4: // флажолети: заплющені очі, струни світяться, навколо дзвенять ромбики
      if(!ant){q.eyes='happy';q.mouth=0;q.clench=0;q.vib=0;q.glow=9;q.lean=0;q.sq=0;q.nk=0;}
      break;
    case 5: // бас пальцем: тупає, гуде товста (ліва) струна
      if(ant){q.bob=-2;q.sq=-1;}
      if(hit){q.stomp=1;q.sq=f===2?2:1;q.bob=0;q.vibS=1;q.vibW=2;q.mouth=0;q.clench=1;q.eyes='angry';q.lean=.02;}
      break;
    case 6: // дабл-стоп: дві верхні струни разом, вилкою
      if(hit){q.vibS=6;q.mouth=2;q.eyes='wide';q.lean=.08;}
      break;
    case 7: // тремоло: дрібно трусить усім тілом, верхня струна розмита
      q.push=f%2?1:-1;q.vibS=4;q.vibW=f%2?1:2;q.vib=1;q.eyes='angry';q.mouth=1;q.lean=.02;q.sq=0;
      break;
    case 8: // арпеджіо: світло біжить по струнах по черзі
      q.glow=[0,1,2,1,0,1][f];q.vibS=1<<q.glow;q.vib=1;q.mouth=ant?0:2;q.eyes=ant?'half':'open';q.lean=.03;q.sq=0;
      break;
    case 9: // акцент: найсильніший укус, велика іскра
      if(f===2){q.mouth=0;q.clench=1;q.chomp=2;q.nk=2;q.lean=.15;q.sq=1;q.vibW=2;}
      if(f===3){q.mouth=3;q.lean=.08;q.vibW=2;}
      break;
  }
  if(rec&&q.L!==7&&q.L!==8){q.vib=f===4&&q.L!==1&&q.L!==4?1:0;}
}
function shear(b,k,foot=FOOT){if(!k)return b;const o=mk(b.w,b.h);for(let y=0;y<b.h;y++){const dx=Math.round((foot-y)*k);for(let x=0;x<b.w;x++){const c=b[y*b.w+x];if(c)P(o,x+dx,y,c);}}return o;}
function shift(b,dx,dy=0){const o=mk(b.w,b.h);for(let y=0;y<b.h;y++)for(let x=0;x<b.w;x++){const c=b[y*b.w+x];if(c)P(o,x+dx,y+dy,c);}return o;} // віддача від удару
function rot90(b){const o=mk();for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){const c=b[y*GW+x];if(c)P(o,GH-1-y,x,c);}return o;}
function flipV(b){const o=mk();for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){const c=b[y*GW+x];if(c)P(o,x,GH-1-y,c);}return o;}
function bbox(b){let x0=b.w,x1=-1,y0=b.h,y1=-1;for(let y=0;y<b.h;y++)for(let x=0;x<b.w;x++)if(b[y*b.w+x]){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}return {x0,x1,y0,y1};}
function settle(b,lift=0){const r=bbox(b);if(r.x1<0)return b;const dx=Math.round(19.5-(r.x0+r.x1)/2),dy=FOOT-r.y1-lift,o=mk();
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){const c=b[y*GW+x];if(c)P(o,x+dx,y+dy,c);}return o;}
function outline(b,col=OUT){const W=b.w,H=b.h,o=b.slice();o.w=W;o.h=H;for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;if(b[i])continue;
  if((x>0&&b[i-1])||(x<W-1&&b[i+1])||(y>0&&b[i-W])||(y<H-1&&b[i+W]))o[i]=col;}return o;}
function stars(b,f){const r=bbox(b),cx=(r.x0+r.x1)/2;for(let k=0;k<3;k++){const a=f*Math.PI/2+k*2.094,x=cx+Math.cos(a)*7,y=r.y0-3+Math.sin(a)*1.6;
  P(b,x,y,'#ffe066');if(k===0){P(b,x-1,y,'#ffe066');P(b,x+1,y,'#ffe066');P(b,x,y-1,'#ffe066');P(b,x,y+1,'#ffe066');}}}

// Падіння (f 0..5), лежання (down, f 0..3 по колу), підйом (rise, f 0..4).
function deathFrame(ch,po){
  const H=HEROES[ch],s=po.s,f=po.f|0;
  const prog=s==='fall'?[0,.3,.6,1,1,1][f]:s==='down'?1:[1,.6,.3,0,0][f];
  const lift=s==='fall'?[0,0,0,3,0,0][f]:s==='rise'?[0,0,0,3,0][f]:0;
  const q=params(ch,{s:'idle',f:0});q.eyes=s==='rise'?(prog>0?'half':'happy'):'x';q.mouth=s==='rise'?0:1;
  if(s==='rise'&&f===3)q.sq=-1;if(s==='rise'&&f===4)q.sq=1;
  let b=mk();
  if(H.death==='puddle'){q.sq=Math.round(prog*6);q.bob=-lift;if(s==='down'){q.tw=f;q.eyes='x';}H.draw(b,q);}
  else if(H.death==='flip'){
    if(s==='down')q.step=f*2;
    H.draw(b,q);
    if(prog>=1)b=settle(flipV(b),lift);else if(prog>=.6)b=settle(rot90(b),1);else if(prog>0)b=settle(b,3);
  }else{
    if(prog<1){q.bob=-lift;H.draw(b,q);b=shear(b,prog*.5);}
    else{H.draw(b,q);b=settle(rot90(b),lift);}
  }
  if(s==='down')stars(b,f);
  return b;
}

function build(ch,po){
  if(po.s==='fall'||po.s==='down'||po.s==='rise')return outline(deathFrame(ch,po));
  const q=params(ch,po);let b=mk();HEROES[ch].draw(b,q);b=shear(b,q.lean);if(q.push)b=shift(b,q.push);return outline(b);
}

const rgbCache=new Map();
const rgb=h=>{let v=rgbCache.get(h);if(!v){v=[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];rgbCache.set(h,v);}return v;};
function toCanvas(b,flash,scale=1){
  const W=b.w||GW,H=b.h||GH,cv=document.createElement('canvas');cv.width=W;cv.height=H;const g=cv.getContext('2d'),im=g.createImageData(W,H),d=im.data;
  for(let i=0;i<b.length;i++){const c=b[i];if(!c)continue;let [r,gg,bb]=rgb(c);
    if(flash&&c!==OUT){r+=(255-r)*.72;gg+=(255-gg)*.72;bb+=(255-bb)*.72;}
    d[i*4]=r;d[i*4+1]=gg;d[i*4+2]=bb;d[i*4+3]=255;}
  g.putImageData(im,0,0);
  if(scale===1)return cv;
  const big=document.createElement('canvas');big.width=W*scale;big.height=H*scale;const bg=big.getContext('2d');bg.imageSmoothingEnabled=false;bg.drawImage(cv,0,0,big.width,big.height);return big;
}

const cache=new Map();
function keyOf(ch,po){return ch+'|'+po.s+'|'+(po.f|0)+'|'+(po.L|0)+'|'+(po.blink?1:0)+(po.beat?1:0)+(po.flash?1:0);}
function frame(ch,po){
  if(typeof document==='undefined'||!HEROES[ch])return null;
  const k=keyOf(ch,po);let cv=cache.get(k);
  if(!cv){cv=toCanvas(build(ch,po),po.flash);cache.set(k,cv);}
  return cv;
}
// Стан героя → поза. Час у секундах.
function pose(i){
  // Гість: G.t із пакета може на мить відступити назад, тому час падіння не буває від'ємним.
  if(i.dead){const d=Math.max(0,i.deadFor||0);if(d<.6)return {s:'fall',f:Math.min(5,Math.floor(d/.1))};return {s:'down',f:Math.floor(i.t*4)%4};}
  if(i.riseFor>=0&&i.riseFor<.5)return {s:'rise',f:Math.min(4,Math.floor(i.riseFor/.1))};
  // Удар — рівно в момент ноти (кадри 2–3), потім відкат (4–5). Замах (0–1) — лише якщо наступна нота вже в черзі за ≤0.1 с.
  if(i.atkSince>=0&&i.atkSince<.24)return {s:'atk',f:2+Math.min(3,Math.floor(i.atkSince/.06)),L:Math.abs(i.atkL|0)%10};
  if(i.nextAtk>0&&i.nextAtk<=.1)return {s:'atk',f:i.nextAtk>.05?0:1,L:Math.abs(i.nextL|0)%10};
  if(i.hurt>0)return {s:'hurt',f:i.hurt>.09?0:1,flash:i.hurt>.09};
  if(i.moving)return {s:'walk',f:Math.floor(Math.max(0,i.dist||0)/8)%8};
  const fr=Math.max(0,Math.floor((i.t||0)*6)+(i.seed|0));
  return {s:'idle',f:fr%8,blink:fr%26===0,beat:i.beat>.5};
}
// Ноги героя стоять у точці (x,y); size — розмір усієї клітинки 40×40 у світових пікселях.
function draw(ctx,ch,po,x,y,size,flip){
  const cv=frame(ch,po);if(!cv)return false;
  ctx.save();ctx.translate(x,y);if(flip)ctx.scale(-1,1);ctx.imageSmoothingEnabled=false;
  ctx.drawImage(cv,-size/2,-size*(FOOT+1)/GH,size,size); // FOOT+1: ступні рівно на y
  ctx.restore();return true;
}
function portrait(ch,scale=4){if(typeof document==='undefined'||!HEROES[ch])return '';return toCanvas(build(ch,{s:'idle',f:0}),false,scale).toDataURL();}


// =====================================================================
// ВОРОГИ, БОСИ, ЇХНІ СНАРЯДИ Й ЛІНІЯ РИВКА — той самий рушій, свої сітки.
// Кадри печуться один раз (скінченний набір: тип × стан × кадр × спалах × лють).
// =====================================================================
const hexN=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
const toHex=a=>'#'+a.map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
const mix=(a,b,t)=>{const A=hexN(a),B=hexN(b);return toHex(A.map((v,i)=>v+(B[i]-v)*t));};
const tones=c=>[mix(c,'#ffffff',.38),c,mix(c,'#000000',.38),mix(c,'#000000',.62)]; // світлий, основний, тінь, глибока тінь
function ell(b,cx,cy,rx,ry,c){for(let y=Math.floor(cy-ry);y<=Math.ceil(cy+ry);y++)for(let x=Math.floor(cx-rx);x<=Math.ceil(cx+rx);x++){const nx=(x+.5-cx)/rx,ny=(y+.5-cy)/ry;if(nx*nx+ny*ny<=1)P(b,x,y,c);}}
function ring(b,cx,cy,rx,ry,c,n){n=n||Math.max(12,Math.round((rx+ry)*3.2));for(let i=0;i<n;i++){const a=i/n*Math.PI*2;P(b,cx+Math.cos(a)*rx-.5,cy+Math.sin(a)*ry-.5,c);}}
function tri(b,x0,y0,x1,y1,x2,y2,c){
  const minX=Math.floor(Math.min(x0,x1,x2)),maxX=Math.ceil(Math.max(x0,x1,x2)),minY=Math.floor(Math.min(y0,y1,y2)),maxY=Math.ceil(Math.max(y0,y1,y2));
  const ar=(x1-x0)*(y2-y0)-(x2-x0)*(y1-y0);if(!ar)return;
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){const px=x+.5,py=y+.5;
    const w0=((x1-px)*(y2-py)-(x2-px)*(y1-py))/ar,w1=((x2-px)*(y0-py)-(x0-px)*(y2-py))/ar,w2=1-w0-w1;
    if(w0>=0&&w1>=0&&w2>=0)P(b,x,y,c);}
}
const thick=(b,x0,y0,x1,y1,c,c2)=>{line(b,x0,y0,x1,y1,c);line(b,x0+1,y0,x1+1,y1,c2||c);};
// Прозорість без альфи: напівпрозора копія — шахове сито.
function ghostCopy(dst,src,col){for(let y=0;y<src.h;y++)for(let x=0;x<src.w;x++)if(src[y*src.w+x]&&(x+y)%2===0)P(dst,x,y,col);}

// ---------- ФАЛЬШИВКА: бісеня-восьма нота з одним жовтим оком ----------
function mFal(b,q){
  const T=tones('#7a5cc4'),f=q.f,w=q.s==='walk',y=w&&f%2?-1:0,sw=[0,1,0,-1][f];
  const lL=w?[1,0,0,0][f]:0,lR=w?[0,0,1,0][f]:0;
  // ніжки й черевики
  rect(b,9,21+y,2,4-lL,T[2]);rect(b,15,21+y,2,4-lR,T[3]);
  rect(b,8+(lL?1:0),24-lL,4,2,'#5a3a2a');P(b,11+(lL?1:0),24-lL,'#8a5a3e');
  rect(b,14+(lR?1:0),24-lR,4,2,'#4a2e22');P(b,17+(lR?1:0),24-lR,'#7a4e36');
  // хвостик-прапорець ноти (позаду голови)
  rect(b,18,3+y,2,10,T[1]);rect(b,18,3+y,1,10,T[0]);
  line(b,20,3+y,24,6+y+sw,T[1]);line(b,20,4+y,23,7+y+sw,T[2]);line(b,24,6+y+sw,23,9+y+sw,T[1]);
  // тіло-голова
  blob(b,12.5,15+y,7.6,7.2,[T[0],T[1],T[2]]);
  // роги
  thick(b,7,10+y,4,6+y,'#e8d8b8','#b8a888');P(b,4,5+y,'#fff6e0');
  thick(b,15,9+y,16,5+y,'#e8d8b8','#b8a888');
  // лапи з пазурами
  const atk=q.s==='atk';
  if(atk&&f===0){ // замах: обидві лапи вгору
    line(b,6,16+y,4,9+y,T[2]);for(const [a,c] of [[3,8],[4,7],[5,8]])P(b,a,c+y,'#e8d8b8');
    line(b,19,15+y,22,8+y,T[2]);for(const [a,c] of [[21,7],[22,6],[23,7]])P(b,a,c+y,'#e8d8b8');}
  else if(atk){ // удар: права лапа вперед, сліди пазурів
    line(b,6,16+y,4,20+y,T[2]);for(const [a,c] of [[3,21],[4,22]])P(b,a,c+y,'#e8d8b8');
    line(b,19,15+y,23,15+y,T[2]);for(const [a,c] of [[24,14],[25,15],[24,16]])P(b,a,c+y,'#e8d8b8');
    for(let k=0;k<3;k++)line(b,22+k,8+k*3,25,10+k*3,'#fff0d8');}
  else{
  line(b,6,16+y,3,19+y+sw,T[2]);for(const [a,c] of [[2,20],[3,21],[4,21]])P(b,a,c+y+sw,'#e8d8b8');
  line(b,19,16+y,22,18+y-sw,T[2]);for(const [a,c] of [[23,19],[22,20],[24,18]])P(b,a,c+y-sw,'#e8d8b8');}
  // око-циклоп
  ell(b,13.5,13.5+y,3.4,3.2,'#2a1030');
  if(q.flash||q.blink){rect(b,11,13+y,6,1,'#ffc83a');}
  else if(atk){ell(b,13.5,13.5+y,2.6,2.6,'#ffe070');P(b,14,13+y,'#2a1030');P(b,15,14+y,'#2a1030');}
  else{ell(b,13.5,13.5+y,2.5,2.3,'#ffc83a');rect(b,14,12+y,1,3,'#2a1030');P(b,12,12+y,'#fff6c0');}
  // оскал (на ударі — розкрита паща)
  if(atk){rect(b,9,17+y,8,3,'#2a1030');for(let x=9;x<17;x+=2){P(b,x,17+y,'#fff0d8');P(b,x+1,19+y,'#fff0d8');}P(b,12,19+y,'#ff6a8a');}
  else{rect(b,9,18+y,8,1,'#2a1030');for(let x=9;x<17;x+=2)P(b,x,17+y,'#fff0d8');P(b,10,19+y,'#fff0d8');P(b,15,19+y,'#fff0d8');}
}

// ---------- ШУМОК: маска з червоними очима, крила-хвилі, рваний плащ ----------
function mShum(b,q){
  const f=q.f,atk=q.s==='atk',y=atk?[-2,2][f]:[0,-1,0,1][f],up=atk?[-7,4][f]:[-6,-2,3,-2][f];
  for(let i=0;i<8;i++){const x=8-i,yy=13+y+Math.round(Math.sin(f*1.6+i*.9)*1.3)+(i>>2);P(b,x,yy,'#9a2c44');P(b,x,yy+1,'#5a1428');if(i%3===2)P(b,x,yy+2,'#5a1428');}
  const wing=(x,dir,c,cd)=>{const tx=x+dir*9,ty=11+y+up;tri(b,x,11+y,tx,ty,x+dir*6,15+y,c);
    for(let i=1;i<=3;i++){const bx=x+dir*(i*2);P(b,bx,13+y+Math.round(up*i/6),cd);P(b,bx+dir,14+y+Math.round(up*i/6),cd);}};
  wing(10,-1,'#a8324a','#5a1428');wing(16,1,'#e0506a','#8a1c34');
  ell(b,13,12+y,5.6,5.6,'#3a1430');P(b,9,7+y,'#3a1430');P(b,17,7+y,'#3a1430');P(b,8,6+y,'#3a1430');P(b,18,6+y,'#3a1430');
  ell(b,13.5,13+y,4,4.2,'#f4ece4');rect(b,15,10+y,2,7,'#d8ccc4');
  if(q.flash){rect(b,11,12+y,2,1,'#3a1430');rect(b,15,12+y,2,1,'#3a1430');}
  else{rect(b,11,12+y,2,2,'#ff3a3a');P(b,11,12+y,'#ffd0d0');rect(b,15,12+y,2,2,'#ff3a3a');P(b,15,12+y,'#ffd0d0');}
  P(b,10,11+y,'#3a1430');P(b,17,11+y,'#3a1430');
  if(atk&&f){rect(b,12,15+y,4,3,'#3a1430');P(b,12,15+y,'#fff');P(b,15,15+y,'#fff');P(b,13,17+y,'#fff');P(b,14,16+y,'#ff6a8a');}
  else{rect(b,12,15+y,4,1,'#3a1430');P(b,13,16+y,'#fff');P(b,15,16+y,'#fff');}
  P(b,11,18+y,'#5a1428');P(b,15,18+y,'#5a1428');P(b,10,19+y,'#e8d8b8');P(b,16,19+y,'#e8d8b8');
}

// ---------- РІЙ ПЕРЕШКОД: жовта мушка-глюк ----------
function mRoi(b,q){
  const f=q.f,y=[0,-1,0,1][f];
  // глюк-хвіст: кольорові зсуви
  P(b,2+(f*3)%5,6+y,'#40f0ff');P(b,3+(f*2)%4,8+y,'#ff40c0');P(b,1+(f%3),7+y,'#40f0ff');
  if(f%2){rect(b,5,3+y,3,2,'#fffbe0');P(b,8,3+y,'#fffbe0');}else{rect(b,4,5+y,4,1,'#fffbe0');}
  ell(b,7,8+y,3,2.3,'#e8c84a');P(b,6,7+y,'#fff4b0');P(b,6,8+y,'#2a2010');P(b,8,8+y,'#2a2010');
  ell(b,10.5,7.5+y,1.6,1.6,'#2a2010');P(b,11,7+y,'#ff3030');
  P(b,6,10+y,'#2a2010');P(b,8,10+y,'#2a2010');
  if(q.s==='atk'){P(b,12,9+y,'#2a2010');P(b,13,10+y,f?'#ff3030':'#2a2010');}
}

// ---------- ФАЛЬЦЕТ: співочий привид, стріляє нотами ----------
function mStrel(b,q){
  const T=tones('#5fc4d9'),f=q.f,cast=q.s==='cast',y=[0,-1,-1,0][f]-(cast?1:0),k=cast?1:0;
  for(let yy=18;yy<=25;yy++){const half=Math.max(1,Math.round((7+k)*(1-(yy-18)/9))),cx=13+Math.round(Math.sin(f*1.57+yy*.8)*1.4);
    rect(b,cx-half,yy+y,half*2,1,T[1]);P(b,cx+half-1,yy+y,T[2]);if(yy>21)P(b,cx-half,yy+y,T[0]);}
  blob(b,13,12+y,7+k,8+k,[T[0],T[1],T[2]]);
  P(b,9,6+y,'#e8fbff');P(b,10,5+y,'#e8fbff');P(b,8,8+y,'#e8fbff');
  if(cast||q.flash){rect(b,9,10+y,2,2,'#123a44');rect(b,15,10+y,2,2,'#123a44');P(b,9,10+y,'#fff');P(b,15,10+y,'#fff');}
  else if(q.blink){rect(b,8,11+y,3,1,'#123a44');rect(b,15,11+y,3,1,'#123a44');}
  else{P(b,8,11+y,'#123a44');P(b,9,10+y,'#123a44');P(b,10,11+y,'#123a44');P(b,15,11+y,'#123a44');P(b,16,10+y,'#123a44');P(b,17,11+y,'#123a44');}
  P(b,7,13+y,'#ff9ec0');P(b,18,13+y,'#ff9ec0');
  ell(b,13,15.5+y,1.8+k*1.2,2+k*1.2,'#123a44');P(b,13,17+y+k,'#0a1e26');
  if(cast)for(const r of [3,5]){for(let a=-3;a<=3;a++)P(b,19+r,15+y+a,a===0?'#ffffff':'#bff6ff');}
  else{const nx=20,ny=2+f;rect(b,nx,ny+3,2,2,'#bff6ff');rect(b,nx+1,ny,1,3,'#bff6ff');P(b,nx+2,ny,'#bff6ff');}
}

// ---------- ВІДЛУННЯ: зелений слиз, за ним напівпрозора луна ----------
function dilkaBody(b,q,ox){
  const T=tones('#6fbf73'),sq=[0,1,0,-1][q.f],rx=9+sq*.7,ry=8-sq*.7,cy=27-ry;
  blob(b,16+ox,cy,rx,ry,[T[0],T[1],T[2]]);
  rect(b,16+ox,Math.round(cy-ry)+1,1,4,'#3a6a3c');P(b,15+ox,Math.round(cy-ry)+3,'#3a6a3c'); // тріщина: ділиться навпіл
  for(const ex of [12,18]){rect(b,ex+ox,Math.round(cy)-3,3,3,'#f4fff0');P(b,ex+2+ox,Math.round(cy)-2,'#123018');}
  if(q.flash||q.blink){rect(b,12+ox,Math.round(cy)-3,3,3,T[1]);rect(b,18+ox,Math.round(cy)-3,3,3,T[1]);rect(b,12+ox,Math.round(cy)-2,3,1,'#123018');rect(b,18+ox,Math.round(cy)-2,3,1,'#123018');}
  if(q.s==='atk'&&!q.f){ell(b,16.5+ox,cy+3,3.4,2.8,'#123018');for(let x=14;x<20;x+=2)P(b,x+ox,Math.round(cy)+1,'#f4fff0');P(b,16+ox,Math.round(cy)+4,'#ff6a8a');}
  else if(q.s==='atk'){rect(b,13+ox,Math.round(cy)+3,8,1,'#123018');for(let x=13;x<21;x+=2)P(b,x+ox,Math.round(cy)+2,'#f4fff0');}
  else ell(b,16.5+ox,cy+3,1.4,1.2,'#123018');
}
function mDilka(b,q){
  const e=mk(b.w,b.h);dilkaBody(e,{f:(q.f+2)%4},-5-[0,1,2,1][q.f]-(q.s==='atk'?2:0));ghostCopy(b,outline(e,'#2a4a2c'),'#4a8a4e');
  dilkaBody(b,q,0);
}

// ---------- ФІДБЕК: комбік-носоріг з джеком-рогом, бере розгін ----------
function mTaran(b,q){
  const f=q.f,s=q.s,wind=s==='wind',dash=s==='dash',w=s==='walk',atk=s==='atk',y=w&&f%2?-1:0,sh=wind?(f?1:-1):atk?(f?2:-1):0;
  // ноги
  const leg=(x,lift,dx,c)=>{rect(b,x+dx,26+y,4,6-lift,c);rect(b,x+dx-1,31-lift,5,2,'#1a0e10');};
  const g=w?[[1,0],[0,1],[0,0],[1,0]][f]:[0,0];
  const paw=wind&&f===1?2:0,stretch=dash?2:0;
  leg(9,g[1],-stretch,'#4a1614');leg(24,g[0],stretch,'#4a1614');leg(13,g[0],-stretch,'#7a2420');leg(28,g[1]+paw,stretch,'#7a2420');
  // кабель-хвіст
  line(b,6+sh,20+y,2+sh,24+y+(f%2),'#2a2638');line(b,2+sh,24+y+(f%2),1+sh,27+y,'#2a2638');
  // корпус-комбік
  rect(b,6+sh,10+y,26,17,'#7a2420');rect(b,6+sh,10+y,26,1,'#a8403a');rect(b,6+sh,26+y,26,1,'#3a0e0c');rect(b,31+sh,11+y,1,15,'#4a1614');
  for(const [cx,cy] of [[6,10],[30,10],[6,25],[30,25]])rect(b,cx+sh,cy+y,2,2,'#c0c8d0');
  // пульт зверху з ручками й очима-діодами
  rect(b,8+sh,11+y,22,3,'#d8c8a0');for(let x=10;x<22;x+=3)P(b,x+sh,12+y,'#3a2a20');
  const eye=wind?'#ffff80':dash?'#ffffff':'#ff3030';rect(b,24+sh,12+y,2,1,eye);rect(b,27+sh,12+y,2,1,eye);
  // решітка з хвилею
  rect(b,9+sh,15+y,20,10,'#2a1014');for(let yy=15;yy<25;yy++)for(let x=9;x<29;x++)if((x+yy)%3===0)P(b,x+sh,yy+y,'#3a1a1c');
  const amp=wind||atk&&f?4:dash?3:2,wc=wind||atk&&f?'#ffd040':'#ff5a3a';
  for(let x=10;x<28;x++){const yy=20+Math.round(Math.sin(x*.9+f*2)*amp*((x%4)/3));P(b,x+sh,yy+y,wc);if(wind)P(b,x+sh,yy+y+1,'#ff8a3a');}
  // джек-ріг
  rect(b,32+sh,17+y,2,4,'#9aa3b4');rect(b,34+sh,18+y,2,2,'#e3e8f0');P(b,33+sh,18+y,'#3a3a44');P(b,35+sh,18+y,'#ffffff');
  if(wind){for(const [a,c] of [[8,7],[10,5],[12,7],[9,3]])P(b,a+f*2,c+y,'#c8c8d0');P(b,36,20+y,'#ffd040');}
  if(dash)for(const [yy,len] of [[12,5],[16,7],[20,4],[24,6]])for(let x=0;x<len-(f?1:0);x++)P(b,x+(f?1:0),yy,x%2?'#ff8a7a':'#ffffff');
  if(q.flash)rect(b,24+sh,12+y,5,1,'#3a2a20');
}

// ---------- ГЛУШНЯК: моховий голем із колонкою в грудях ----------
function mGlush(b,q){
  const T=tones('#56743d'),f=q.f,w=q.s==='walk',atk=q.s==='atk',y=w&&f%2?1:0,sw=w?[0,2,0,-2][f]:0;
  const lift=w?[[2,0],[0,0],[0,2],[0,0]][f]:[0,0];
  rect(b,15,37,6,8-lift[0],T[3]);rect(b,13,44-lift[0],9,3,'#2a3a1c');
  rect(b,28,37,6,8-lift[1],T[2]);rect(b,27,44-lift[1],9,3,'#34461f');
  blob(b,24,26+y,16.5,14,[T[0],T[1],T[2]]);
  // руки-кулаки
  blob(b,8,28+y+sw,5,8,[T[0],T[1],T[2]]);ell(b,7,37+y+sw,4.6,4,T[2]);P(b,5,35+y+sw,T[0]);P(b,7,35+y+sw,T[0]);
  if(atk&&f){blob(b,38,26+y,7,4.5,[T[0],T[1],T[2]]);ell(b,42,26+y,4.4,4.4,T[3]);P(b,41,24+y,T[1]);P(b,43,24+y,T[1]);
    for(const [a,c] of [[44,19],[44,33],[42,18],[42,34]])P(b,a,c+y,'#ffe080');}            // кулак уперед
  else if(atk){blob(b,39,22+y,5,7,[T[0],T[1],T[2]]);ell(b,37,15+y,4.6,4,T[3]);P(b,36,13+y,T[1]);} // замах угору
  else{blob(b,40,28+y-sw,5,8,[T[0],T[1],T[2]]);ell(b,41,37+y-sw,4.6,4,T[3]);P(b,40,35+y-sw,T[1]);P(b,42,35+y-sw,T[1]);}
  // мох і листя
  for(const [cx,cy,r] of [[14,15,4],[22,12,4.5],[31,13,4],[37,18,3.5],[9,20,3]]){ell(b,cx,cy+y,r,r*.8,'#8aac4a');P(b,cx-1,cy-1+y,'#c8e070');P(b,cx+1,cy-2+y,'#b8d860');}
  // колонка
  rect(b,16,18+y,17,20,'#3a3c40');rect(b,16,18+y,17,1,'#6a6e76');rect(b,16,18+y,1,20,'#55585e');rect(b,32,19+y,1,19,'#22242a');rect(b,17,37+y,16,1,'#22242a');
  for(const [sx,sy] of [[17,19],[31,19],[17,36],[31,36]])P(b,sx,sy+y,'#9aa0a8');
  ell(b,24.5,22.5+y,2.5,2,'#16181c');ring(b,24.5,22.5+y,3,2.5,'#7a7e86',14);
  ell(b,24.5,30.5+y,6,6,'#16181c');ring(b,24.5,30.5+y,6.6,6.6,'#7a7e86',30);
  const big=atk&&f?2:1;
  for(let x=19;x<31;x++){const a=Math.max(-5,Math.min(5,Math.round(Math.sin(x*1.3+f*1.9)*((x%3)+1)*big*(q.flash?0:1))));P(b,x,30+y+a,'#ffb03a');if(Math.abs(a)<2)P(b,x,30+y,'#ffe080');}
  if(!q.blink){rect(b,20,15+y,2,1,atk?'#ff8040':'#ffd080');rect(b,27,15+y,2,1,atk?'#ff8040':'#ffd080');}
}

// ---------- БОС 1 · ФОНОГРАМА: золота касета, котушки-очі, язик зі стрічки ----------
function mBoss1(b,q){
  const f=q.f,s=q.s,w=s==='walk',cast=s==='cast',sum=s==='summon',rage=q.rage,y=w&&f%2?1:cast?-2:0;
  const G=rage?tones('#d8963a'):tones('#f2b84b');
  // ноги й кеди
  const lift=w?[[3,0],[0,0],[0,3],[0,0]][f]:[0,0];
  for(const [x,l] of [[25,lift[0]],[49,lift[1]]]){rect(b,x,58+y,10,18-l,G[2]);rect(b,x,58+y,3,18-l,G[1]);rect(b,x-2,74-l,14,5,'#2a1a20');rect(b,x-2,78-l,14,1,'#f4f0e8');rect(b,x+8,75-l,3,1,'#5a4a60');}
  // руки
  const armY=cast||sum?-18:0,swA=w?[0,2,0,-2][f]:0;
  thick(b,11,40+y,3,50+y+armY+swA,G[2],G[3]);ell(b,3,51+y+armY+swA,3.5,3.2,'#ffffff');
  thick(b,72,40+y,80,50+y+armY-swA,G[2],G[3]);ell(b,80,51+y+armY-swA,3.5,3.2,'#ffffff');
  // корпус касети
  rect(b,10,18+y,64,41,G[1]);rect(b,10,18+y,64,2,G[0]);rect(b,10,18+y,2,41,G[0]);rect(b,72,20+y,2,39,G[2]);rect(b,12,57+y,62,2,G[2]);
  for(const [sx,sy] of [[13,21],[69,21],[13,54],[69,54]]){rect(b,sx,sy+y,2,2,'#8a6a3a');P(b,sx,sy+y,'#fff0c0');}
  // наліпка
  rect(b,16,22+y,52,22,'#fff1d0');rect(b,16,24+y,52,3,rage?'#3a3a44':'#e0505a');
  for(let x=19;x<64;x+=6)rect(b,x,29+y,4,1,'#8a6a4a');
  if(rage){line(b,30,22+y,40,44+y,'#5a3a20');line(b,31,22+y,41,44+y,'#3a2410');}
  // віконце й котушки-очі (спиці крутяться; на касті — швидко, з розмиттям)
  rect(b,23,32+y,38,11,'#2a1a10');rect(b,24,37+y,36,2,'#5a3a20');
  const spin=(cx,cy)=>{ell(b,cx,cy+y,7,7,'#f8f0e0');ring(b,cx,cy+y,7.4,7.4,'#b89a6a',44);
    if(cast)ring(b,cx,cy+y,5,5,'#d8c8a8',30);
    for(let k=0;k<3;k++){const a=(f*(cast?2:1))*Math.PI/6+k*Math.PI*2/3;line(b,cx-.5,cy-.5+y,cx-.5+Math.cos(a)*5,cy-.5+y+Math.sin(a)*5,'#8a6a4a');}
    ell(b,cx,cy+y,2.4,2.4,rage?'#ff3030':'#1a0f08');P(b,cx-1,cy-1+y,'#ffffff');};
  spin(32,37.5);spin(53,37.5);
  // брови
  thick(b,24,28+y-(cast?2:0),36,31+y,'#3a2410');thick(b,48,31+y,60,28+y-(cast?2:0),'#3a2410');
  // паща-трапеція з зубами
  const mh=cast||sum?9:4;
  for(let r=0;r<mh;r++){const e=Math.round(r*.6);rect(b,24+e,47+y+r,36-e*2,1,r?'#1a0c06':'#3a2410');}
  for(let x=25;x<59;x+=3)P(b,x,47+y,'#ffffff');
  for(let x=27;x<57;x+=3)P(b,x,46+y+mh,'#ffffff');
  // язик-стрічка, що звисає й тріпоче
  for(let i=0;i<(cast||sum?26:14);i++){const xx=42-i*.9,yy=48+y+mh+i*.8+Math.sin(f*1.4+i*.5)*2;P(b,xx,yy,'#5a3a20');P(b,xx+1,yy,'#7a5030');}
  if(cast)for(let k=0;k<12;k++){const a=k/12*Math.PI*2;P(b,42+Math.cos(a)*40,40+y+Math.sin(a)*36,k%2?'#fff0c0':'#f2b84b');}
}

// ---------- БОС 2 · АВТОТЮН: хромова сфера-діва з візором-еквалайзером ----------
function mBoss2(b,q){
  const f=q.f,s=q.s,rage=q.rage,wind=s==='wind',dash=s==='dash',spiral=s==='spiral',y=[0,-1,-2,-1][f%4]+(dash?2:0);
  const pink=rage?'#ff3a6a':'#ff7ad9';
  // реактивний струмінь
  const jl=dash||wind?12:6+(f%2)*2;
  for(let i=0;i<jl;i++){const hw=Math.max(0,3-Math.floor(i/3));rect(b,38-hw,61+y+i,hw*2+1,1,i<2?'#ffffff':i%2?pink:'#ffd0f0');}
  // антена з колесом висоти тону
  line(b,38,16+y,38,7+y,'#6a7180');ring(b,38,5+y,3,3,pink,12);P(b,38+Math.round(Math.cos(f*1.6)*3),5+y+Math.round(Math.sin(f*1.6)*3),'#ffffff');
  // мікрофон
  thick(b,58,44+y,66,52+y,'#6a7180','#4a5060');ell(b,68,54+y,3.5,3.5,'#3a3a44');P(b,67,53+y,'#9aa0b0');P(b,69,53+y,'#9aa0b0');P(b,68,55+y,'#9aa0b0');
  // сфера
  blob(b,38,38+y,24,22,['#f4f6fb','#b9c0cc','#6a7180']);
  for(let x=15;x<=61;x++){const nx=(x+.5-38)/24;if(Math.abs(nx)<1)P(b,x,42+y+Math.round(Math.sqrt(1-nx*nx)*5),pink);}
  P(b,24,24+y,'#ffffff');P(b,25,23+y,'#ffffff');P(b,26,23+y,'#ffffff');P(b,23,26+y,'#ffffff');
  // візор-еквалайзер (це її обличчя)
  rect(b,20,28+y,38,12,'#1a1022');rect(b,19,30+y,1,8,'#1a1022');rect(b,58,30+y,1,8,'#1a1022');rect(b,20,28+y,38,1,'#3a2a44');
  for(let i=0;i<9;i++){const h=q.flash?1:Math.max(1,Math.round((spiral?8:5)+Math.sin(i*1.3+f*1.7)*(spiral?3:3)*(i%2?1:.6)));
    const col=wind?'#ff3030':pink;for(let k=0;k<h;k++)P(b,22+i*4,38+y-k,k===h-1?'#ffffff':col),P(b,23+i*4,38+y-k,k===h-1?'#ffd0f0':col);}
  // орбіта нот на спіралі
  if(spiral)for(let k=0;k<10;k++){const a=k/10*Math.PI*2+f*.31,x=37+Math.cos(a)*34,yy=41+y+Math.sin(a)*11;rect(b,x,yy,2,2,k%2?pink:'#ffffff');P(b,x-Math.sin(a)*2,yy+Math.cos(a)*1,'#ffd0f0');}
  if(dash)for(const [yy,len] of [[26,9],[34,13],[42,11],[50,8]])for(let x=0;x<len-(f%2);x++)P(b,x+(f%2),yy+y,x%2?pink:'#ffffff');
  if(wind)for(let k=0;k<8;k++){const a=k/8*Math.PI*2;P(b,38+Math.cos(a)*(28+f*2),38+y+Math.sin(a)*(26+f*2),'#ff3030');}
  if(s==='summon')for(const r of [5,7])ring(b,38,9+y,r+2,r,'#ffd0f0',24);
}

// ---------- БОС 3 · ДИРИГЕНТ ТИШІ: маска із зашитим ротом, фрак, диригентська паличка ----------
function mBoss3(b,q){
  const f=q.f,s=q.s,rage=q.rage,cast=s==='cast',spiral=s==='spiral',sum=s==='summon',w=s==='walk',y=w&&f%2?1:0;
  const L='#b9a6ff',Ld='#7a6ac0',K='#1e1830',Kd='#0e0c14';
  // нотний стан-шарф, що в'ється за спиною
  for(let i=0;i<5;i++)for(let x=4;x<97;x++){const yy=46+i*2+Math.round(Math.sin(x*.13+f*1.2+i*.3)*(sum?6:3));if((x+i)%7)P(b,x,yy+y,i%2?Ld:L);}
  // фалди фрака
  const ts=w||s==='wind'?[0,2,4,2][f]:s==='dash'?6:0;
  tri(b,36,66+y,30-ts,90,40,72+y,Kd);tri(b,44,68+y,36-ts,92,46,74+y,K);
  // ноги
  const lift=w?[[3,0],[0,0],[0,3],[0,0]][f]:[0,0];
  rect(b,42,72+y,5,21-lift[0],Kd);rect(b,53,72+y,5,21-lift[1],K);
  rect(b,40,92-lift[0],8,3,'#05040a');P(b,46,92-lift[0],'#6a6a80');rect(b,52,92-lift[1],9,3,'#05040a');P(b,59,92-lift[1],'#6a6a80');
  // тулуб-фрак
  tri(b,34,34+y,66,34+y,60,72+y,K);tri(b,34,34+y,60,72+y,40,72+y,K);
  ell(b,35,37+y,5,4,K);ell(b,65,37+y,5,4,K);P(b,32,35+y,'#3a3060');P(b,33,34+y,'#3a3060');
  for(let yy=38;yy<70;yy++)P(b,35+Math.round((yy-38)*.16),yy+y,'#2e2648');
  tri(b,45,34+y,55,34+y,50,54+y,'#f0ecff');
  line(b,44,34+y,50,54+y,L);line(b,56,34+y,50,54+y,L);line(b,43,35+y,49,55+y,Ld);
  rect(b,47,35+y,7,3,L);P(b,50,36+y,Ld);
  for(const by of [58,63])P(b,50,by+y,L);
  // ліва рука: палець до вуст «тсс» (на виклику — руки вгору)
  const S='#3a3060',cuff=(x,yy)=>{rect(b,x-1,yy-1,3,2,L);};
  if(sum||cast){thick(b,32,38+y,22,16+y,S,K);cuff(22,17+y);ell(b,21,13+y,3,3,'#ffffff');}
  else{thick(b,32,40+y,36,48+y,S,K);thick(b,36,48+y,41,34+y,S,K);cuff(41,34+y);ell(b,42,31+y,2.6,2.6,'#ffffff');rect(b,43,25+y,1,5,'#ffffff');}
  // права рука з паличкою
  let hx=72,hy=44+y,tx=86,ty=34+y;
  if(cast){hx=76;hy=22+y;tx=84;ty=8+y;}
  else if(spiral){hx=76;hy=34+y;const a=f*Math.PI/2-Math.PI/2;tx=hx+Math.round(Math.cos(a)*14);ty=hy+Math.round(Math.sin(a)*14);}
  else if(sum){hx=78;hy=14+y;tx=90;ty=6+y;}
  thick(b,68,38+y,hx,hy,S,K);cuff(hx-1,hy+1);ell(b,hx,hy,2.8,2.8,'#ffffff');
  line(b,hx,hy,tx,ty,'#ffffff');P(b,tx,ty,'#e8dcff');
  const glow=cast||spiral?3:1;for(let k=0;k<8;k++){const a=k/8*Math.PI*2;P(b,tx+Math.cos(a)*glow,ty+Math.sin(a)*glow,k%2?L:'#ffffff');}
  if(cast)for(let k=0;k<16;k++){const a=k/16*Math.PI*2;P(b,tx+Math.cos(a)*7,ty+Math.sin(a)*7,k%2?L:'#e8dcff');}
  // голова-маска і циліндр
  ell(b,50,22+y,10,12,'#f4f0ff');for(let yy=13;yy<33;yy++)P(b,57+Math.round(Math.sin(yy*.3)),yy+y,'#d8d0ec');P(b,44,16+y,'#ffffff');P(b,45,15+y,'#ffffff');
  rect(b,42,1+y,16,11,Kd);rect(b,42,1+y,2,11,'#2e2648');rect(b,39,11+y,22,2,Kd);rect(b,42,8+y,16,2,rage?'#ff4a6a':L);
  const ec=rage?'#ff4a6a':L;rect(b,44,20+y,4,2,ec);rect(b,53,20+y,4,2,ec);P(b,45,20+y,'#ffffff');P(b,54,20+y,'#ffffff');
  if(q.flash){rect(b,44,20+y,4,1,Kd);rect(b,53,20+y,4,1,Kd);}
  // зашитий рот (у люті шви рвуться)
  if(rage){for(let x=45;x<56;x++)P(b,x,28+y+((x%2)?1:0),Kd);rect(b,47,29+y,6,2,Kd);line(b,48,12+y,52,24+y,'#5a4a80');}
  else{rect(b,45,28+y,11,1,Kd);for(let x=46;x<56;x+=2){P(b,x,27+y,Kd);P(b,x,29+y,Kd);}}
}

// Присід: стискає фігуру на amt пікселів над лінією ніг і трохи розширює (найближчий сусід, без розмиття).
function squash(b,foot,amt){
  const r=bbox(b);if(r.x1<0||!amt)return b;const W=b.w,H=b.h,h=foot-r.y0;if(h<4)return b;
  const nh=h-amt,cx=(r.x0+r.x1+1)/2,sx=1+amt/h*.8,o=mk(W,H);
  for(let y=Math.max(0,foot-nh);y<=Math.min(H-1,r.y1);y++){const sy=y<=foot?Math.round(foot-(foot-y)*h/nh):y;if(sy<0||sy>=H)continue;
    for(let x=0;x<W;x++){const s2=Math.round(cx+(x+.5-cx)/sx-.5);if(s2<0||s2>=W)continue;const c=b[sy*W+s2];if(c)o[y*W+x]=c;}}
  return o;
}
// Поява боса: виростає з-під землі (f 0..5), довкола курява.
function riseUp(b,foot,f){
  const r=bbox(b);if(r.x1<0)return b;const d=Math.round((foot-r.y0)*(1-(f+1)/6)),o=mk(b.w,b.h);
  for(let y=0;y<b.h;y++)for(let x=0;x<b.w;x++){const c=b[y*b.w+x];if(c&&y+d<=foot)P(o,x,y+d,c);}
  const span=r.x1-r.x0+9;for(let k=0;k<14;k++){const x=r.x0-4+((k*37+f*11)%span);P(o,x,foot-(k+f)%3,k%2?'#8a7a60':'#c8b898');P(o,x+1,foot-1-(k%2),'#6a5a48');}
  rect(o,r.x0,foot,r.x1-r.x0+1,1,'#3a2a20');
  return o;
}
const MOBGFX={
  fal:{g:28,draw:mFal,melee:1},shum:{g:26,draw:mShum,fly:1,melee:1},roi:{g:14,draw:mRoi,fly:1,melee:1},strel:{g:26,draw:mStrel,fly:1},
  dilka:{g:32,draw:mDilka,melee:1},taran:{g:38,draw:mTaran,melee:1},glush:{g:48,draw:mGlush,melee:1},
  boss1:{g:84,draw:mBoss1},boss2:{g:76,draw:mBoss2,fly:1},boss3:{g:100,draw:mBoss3}
};
const mobCache=new Map();
// Стан ворога → поза: хода по m.wob, ривок (wind/dash), каст боса/стрільця (m.cast: 1 залп, 2 спіраль, 3 виклик), спалах, лють (<50% HP).
function mobPose(type,m,near){
  const w=Math.max(0,m.wob||0),f8=Math.floor(w/.8)%8,fw=Math.floor(w/1.3);let s='walk',f=f8>>1;
  if(type.startsWith('boss')&&(m.age??9)<1.2)return {s:'spawn',f:Math.min(5,Math.floor(Math.max(0,m.age)/.2)),flash:0,rage:0};
  if(m.mode==='wind'){s='wind';f=Math.floor(w*1.5)%2;}
  else if(m.mode==='dash'){s='dash';f=fw%2;}
  else if(m.cast===1){s='cast';f=fw%2;}
  else if(m.cast===2){s='spiral';f=fw%4;}
  else if(m.cast===3){s='summon';f=fw%2;}
  else if(near&&MOBGFX[type]&&MOBGFX[type].melee){s='atk';f=Math.floor(w*.9)%2;}
  return {s,f,sq:s==='walk'&&f8%4===0?1:0,blink:Math.floor(w/.8)%23===0?1:0,flash:m.flash>.05?1:0,rage:m.max&&type.startsWith('boss')&&m.hp<m.max*.5?1:0};
}
function mobBuild(type,po){
  const G=MOBGFX[type],foot=Math.round(G.g*.9),spawn=po.s==='spawn';let b=mk(G.g,G.g);
  G.draw(b,spawn?{s:'walk',f:0}:po);
  if(spawn)return riseUp(b,foot,po.f|0);
  if(po.s==='walk'&&!G.fly){b=shear(b,.05,foot);if(po.sq)b=squash(b,foot,Math.max(1,Math.round(G.g/28)));} // нахил уперед і присід на кроці
  if(po.s==='atk')b=shear(b,po.f?.06:-.05,foot);                                                              // замах назад, удар уперед
  if(po.flash){b=shift(b,-Math.max(1,Math.round(G.g/20)));b=squash(b,foot,Math.max(1,Math.round(G.g/24)));}   // віддача від удару
  return b;
}
function mobFrame(type,po){
  const G=MOBGFX[type];if(typeof document==='undefined'||!G)return null;
  const k=type+'|'+po.s+'|'+(po.f|0)+'|'+(po.flash?1:0)+(po.rage?1:0)+(po.sq?1:0)+(po.blink?1:0);let cv=mobCache.get(k);
  if(!cv){cv=toCanvas(outline(mobBuild(type,po)),po.flash);mobCache.set(k,cv);}
  return cv;
}
// Квадрат size×size стоїть так само, як старий спрайт: верх на y-0.82·size.
function drawMob(ctx,type,po,x,y,size,flip){
  const cv=mobFrame(type,po);if(!cv)return false;
  ctx.save();ctx.translate(x,y);if(flip)ctx.scale(-1,1);ctx.imageSmoothingEnabled=false;
  ctx.drawImage(cv,-size/2,-size*.82,size,size);
  ctx.restore();return true;
}

// ---------- СНАРЯДИ ВОРОГІВ: темне ядро, кольоровий обідок і «сяйво» решіткою ----------
// kind: note (Фальцет), reel (Фонограма), pitch (Автотюн), rest (Диригент). fr — відбита гравцем (світла).
function shotBuild(kind,col,f,fr){
  const b=mk(15,15),rim=col,core=fr?'#ffe9a0':'#1a0f24',c=7;
  for(let y=0;y<15;y++)for(let x=0;x<15;x++){const d=Math.hypot(x-c,y-c);if(d>5.2&&d<7.2&&(x+y+f)%2===0)P(b,x,y,fr?'#fff0c0':col);} // сяйво
  if(kind==='reel'){ell(b,7.5,7.5,4.6,4.6,core);ring(b,7.5,7.5,4.6,4.6,rim,26);
    for(let k=0;k<3;k++){const a=f*Math.PI/6+k*Math.PI*2/3;line(b,7,7,7+Math.round(Math.cos(a)*3),7+Math.round(Math.sin(a)*3),rim);}P(b,7,7,'#ffffff');}
  else if(kind==='pitch'){const R=f%2?4:5;for(let y=0;y<15;y++)for(let x=0;x<15;x++){const d=Math.abs(x-7)+Math.abs(y-7);if(d<=R)P(b,x,y,d===R?rim:d<=1?'#ffffff':core);}}
  else if(kind==='rest'){ell(b,7.5,7.5,4.4,4.4,fr?core:'#2a2440');
    const z=[[8,3],[6,5],[8,7],[6,9],[7,10],[8,11]];for(const [x,y] of z){P(b,x,y,fr?'#3a2a10':'#0e0c14');P(b,x+1,y,fr?'#3a2a10':'#0e0c14');}ring(b,7.5,7.5,4.8,4.8,rim,26);}
  else{ell(b,6.5,9,3.4,2.7,core);ring(b,6.5,9,3.6,2.9,rim,20);rect(b,9,2,1,7,rim);P(b,10,3,rim);P(b,11,4,rim);P(b,5,8,'#ffffff');}
  return b;
}
const shotCache=new Map();
function shotFrame(kind,col,f,fr){
  if(typeof document==='undefined')return null;
  const k=kind+'|'+col+'|'+f+'|'+(fr?1:0);let cv=shotCache.get(k);
  if(!cv){cv=toCanvas(outline(shotBuild(kind,col,f,fr),'#08060c'));shotCache.set(k,cv);}
  return cv;
}
// Центр снаряда в (x,y); size — бік квадрата 15×15 у світових пікселях.
function drawShot(ctx,kind,col,f,fr,x,y,size){
  const cv=shotFrame(kind,col,f,fr);if(!cv)return false;
  ctx.imageSmoothingEnabled=false;ctx.drawImage(cv,x-size/2,y-size/2,size,size);return true;
}

// ---------- ЛІНІЯ РИВКА: шеврони «>» у 16 напрямках, запечені піксель у піксель ----------
const chevCache=new Map();
function chevFrame(dir16,hot){
  if(typeof document==='undefined')return null;
  const k=dir16+'|'+hot;let cv=chevCache.get(k);
  if(!cv){const b=mk(13,13),a=dir16/16*Math.PI*2,ca=Math.cos(a),sa=Math.sin(a),pt=(u,v)=>[6+u*ca-v*sa,6+u*sa+v*ca];
    const c1=hot?'#ffd0a0':'#ff6b5a',c2=hot?'#ffffff':'#c83a30';
    for(const [u0,v0,u1,v1] of [[-3,-4.5,2.5,0],[-3,4.5,2.5,0]]){const [x0,y0]=pt(u0,v0),[x1,y1]=pt(u1,v1);line(b,x0,y0,x1,y1,c1);const [x2,y2]=pt(u0-1.2,v0),[x3,y3]=pt(u1-1.2,v1);line(b,x2,y2,x3,y3,c2);}
    cv=toCanvas(outline(b,'#2a0808'));chevCache.set(k,cv);}
  return cv;
}
// Від ворога по напрямку (ax,ay) на довжину len: шеврони біжать уперед; t — час для бігу й блимання.
function drawCharge(ctx,x,y,ax,ay,len,halfW,t,px){
  const dir16=((Math.round(Math.atan2(ay,ax)/(Math.PI*2)*16)%16)+16)%16,step=px*9,run=(t*90)%step,sz=px*13;
  ctx.imageSmoothingEnabled=false;
  for(let d=halfW+run;d<len;d+=step){const k=1-d/len,hot=Math.floor(t*8+d/step)%3===0;
    const cv=chevFrame(dir16,hot);if(!cv)return false;ctx.globalAlpha=.35+.65*k;ctx.drawImage(cv,x+ax*d-sz/2,y+ay*d-sz/2,sz,sz);}
  // краї смуги — пунктир пікселями
  const nx=-ay,ny=ax;ctx.fillStyle='#ff6b5a';
  for(let d=halfW;d<len;d+=px*4){ctx.globalAlpha=.55*(1-d/len)+.15;
    for(const sgn of [-1,1]){const ex=x+ax*d+nx*halfW*sgn,ey=y+ay*d+ny*halfW*sgn;ctx.fillRect(Math.round(ex/px)*px,Math.round(ey/px)*px,px*2,px);}}
  ctx.globalAlpha=1;return true;
}


// =====================================================================
// КОНУСИ АТАКИ ГІТАРИ — кожна партія має свій малюнок (вершина зліва на героєві, удар іде вправо).
// Кадр f 0..5: фронт біжить від героя до краю (як зона удару, ~0.24 с), останні кадри розсипаються.
// =====================================================================
const GC={hot:'#fff6d8',y:'#ffd27a',o:'#ffa640',r:'#e8702a',d:'#a8401a',w:'#ffffff'};
// Точка в секторі: u — відстань від вершини (0..W), v — поперек (-1..1 від осі до краю конуса на цій відстані).
function sector(b,fn){const W=b.w,H=b.h,cy=(H-1)/2;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const half=Math.max(.5,(x+.5)*(H/2)/W),v=(y-cy)/half;if(Math.abs(v)<=1){const c=fn(x,v,y);if(c)b[y*W+x]=c;}}}
const hash2=(x,y)=>{const n=Math.sin(x*12.9898+y*78.233)*43758.5453;return n-Math.floor(n);};
const frontOf=(f,speed=1)=>Math.min(1,(f+1)/5*speed);
// Тіло конуса: напівпрозоре сито, густіше біля фронту; fade — на останніх кадрах рідшає.
const BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
function body(b,F,cols,dens,fade){sector(b,(x,v,y)=>{if(x>=F)return 0;const t=Math.pow(x/F,1.3)*dens*(fade?.5:1)*(1-.35*v*v),th=(BAYER[(y&3)*4+(x&3)]+.5)/16;
  if(t<=th)return 0;return t-th>.45?cols[0]:t-th>.2?cols[1]:cols[2];});}
function note8(b,x,y,c){rect(b,x,y+3,3,2,c);rect(b,x+2,y,1,4,c);P(b,x+3,y,c);P(b,x+4,y+1,c);}
function star4(b,x,y,c,c2,r=2){P(b,x,y,c);for(let k=1;k<=r;k++){P(b,x+k,y,k<r?c:c2);P(b,x-k,y,k<r?c:c2);P(b,x,y+k,k<r?c:c2);P(b,x,y-k,k<r?c:c2);}}
function diamond(b,cx,cy,r,c){for(let k=0;k<=r;k++){P(b,cx+k,cy-(r-k),c);P(b,cx-k,cy-(r-k),c);P(b,cx+k,cy+(r-k),c);P(b,cx-k,cy+(r-k),c);}}

// БІЙ: три дугові хвилі одна за одною + шість струн-променів позаду фронту
function cStrum(b,f){const W=b.w,F=frontOf(f)*W,fade=f>=4;body(b,F,[GC.y,GC.o,GC.r],.9,fade);
  sector(b,(x,v,y)=>{
    for(const [k,c] of [[0,GC.hot],[1,GC.y],[2,GC.o]]){const r=F-k*W*.17,d=Math.hypot(x,(y-(b.h-1)/2))-r;
      if(d>-2&&d<=0&&r>4){if(fade&&(x+y+f)%3===0)return 0;return d>-1?c:k?GC.r:GC.y;}}
    if(x<F-2&&x>4){for(const s of [-.8,-.48,-.16,.16,.48,.8])if(Math.abs(v-s)<.06&&(x+f)%3)return fade?((x+y)%2?GC.d:0):GC.r;}
    return 0;});
  if(!fade)for(const s of [-.55,0,.55]){const x=Math.round(F)-1;star4(b,x,Math.round((b.h-1)/2+s*x*(b.h/2)/W),GC.w,GC.y,1);}
}
// ГЛУШІННЯ: короткий тупий удар — товстий рваний фронт, позаду хрестики-шкряби, потім пил
function cChuck(b,f){const W=b.w,F=frontOf(f,1.7)*W,dust=f>=3;if(!dust)body(b,F,['#e0a060','#c8642a','#8a4a22'],.8,false);
  sector(b,(x,v,y)=>{const r=Math.hypot(x,y-(b.h-1)/2),n=hash2(x,y);
    if(dust){return r<F&&n<.08*(6-f)?(n<.03?GC.o:'#8a5a3a'):0;}
    if(r<=F&&r>F-4-n*2)return r>F-1.5?'#f0b070':n<.5?'#c8642a':'#8a4a22';
    if(r<F-5&&((x+y)%5===0||(x-y)%5===0)&&n<.35)return '#a8601e';
    return 0;});
}
// ПЕРЕБІР: одна струна-синусоїда вздовж осі, на кінці іскра медіатора й нотки
function cPick(b,f){const W=b.w,H=b.h,cy=(H-1)/2,F=frontOf(f)*W,fade=f>=5;body(b,F,[GC.y,GC.o,GC.r],.55,fade);
  for(let x=2;x<Math.min(W,F);x++){const a=Math.min(H/2-2,x*(H/2)/W*.75),yy=cy+Math.sin(x*.42-f*1.6)*a;
    if(fade&&x%2)continue;P(b,x,yy,GC.w);P(b,x,yy+1,GC.hot);P(b,x,yy-1,GC.y);P(b,x,yy+2,x%2?GC.o:0);}
  if(!fade){const x=Math.round(Math.min(W-3,F)),yy=cy+Math.sin(x*.42-f*1.6)*Math.min(H/2-1,x*(H/2)/W*.6);star4(b,x,Math.round(yy),GC.w,GC.y,2);}
  if(f>=2&&F>14)note8(b,Math.round(F*.55),Math.round(cy-H*.32)-(f-2),GC.y);
}
// МЕЛОДІЯ: вузький промінь із гарячим ядром, по ньому біжать ноти, на кінці зірка
const y0=x=>Math.floor(x/3);
function cLead(b,f){const W=b.w,H=b.h,cy=Math.round((H-1)/2),F=frontOf(f)*W,fade=f>=5;
  body(b,F,[GC.y,GC.o,GC.r],.35,fade);
  for(let x=1;x<Math.min(W,F);x++){if(fade&&(x+f)%2)continue;const w=x<6?0:1;P(b,x,cy,GC.w);P(b,x,cy+1,GC.w);
    P(b,x,cy-1,GC.hot);P(b,x,cy+2,GC.hot);if(w){P(b,x,cy-2,GC.y);P(b,x,cy+3,GC.y);if((x+y0(x))%2){P(b,x,cy-3,GC.o);P(b,x,cy+4,GC.o);}}}
  for(let k=0;k<3;k++){const x=Math.round(((k*.33+f*.09)%1)*F);if(x>6&&x<W-6)note8(b,x,cy-6-(k%2)*2,k%2?GC.hot:GC.y);}
  if(!fade)star4(b,Math.round(Math.min(W-4,F)),cy,GC.w,GC.hot,3);
}
// ФЛАЖОЛЕТИ: дзвіночки-ромби на фронті, блискітки, тонкий слід
function cHarm(b,f){const W=b.w,H=b.h,cy=Math.round((H-1)/2),F=frontOf(f)*W,ice='#bff8ff';body(b,F,['#e8fdff',ice,'#6ad0e0'],.6,f>=5);
  for(let x=2;x<Math.min(W,F);x+=3)if(hash2(x,f)<.7)P(b,x,cy+Math.round((hash2(x,7)-.5)*H*.5*x/W),x%2?ice:GC.y);
  const x=Math.round(Math.min(W-8,F));if(f<5){diamond(b,x,cy,6,GC.w);diamond(b,x,cy,5,ice);diamond(b,x,cy,2,GC.w);P(b,x,cy,GC.w);}
  if(f>=1&&f<5){diamond(b,x-10,cy-Math.round(H*.22),3,ice);diamond(b,x-10,cy+Math.round(H*.22),3,ice);}
  for(let k=0;k<5;k++){const sx=Math.round(hash2(k,f)*F),sy=Math.round(cy+(hash2(f,k)-.5)*H*.7*sx/W);if(sx>4)star4(b,sx,sy,GC.w,ice,1);}
}
// ДАБЛ-СТОП: дві паралельні струни-хвилі, на фронті з'єднані «скобою»
function cDstop(b,f){const W=b.w,H=b.h,cy=(H-1)/2,F=frontOf(f)*W,fade=f>=5;body(b,F,[GC.y,GC.o,GC.r],.5,fade);
  for(const s of [-1,1])for(let x=2;x<Math.min(W,F);x++){if(fade&&x%2)continue;const off=s*x*(H/2)/W*.45,yy=cy+off+Math.sin(x*.5-f*1.4+s)*1.2;P(b,x,yy,GC.hot);P(b,x,yy+s,x%2?GC.o:0);}
  if(!fade){const x=Math.round(Math.min(W-2,F)),h=Math.round(x*(H/2)/W*.45);for(let yy=-h;yy<=h;yy++)P(b,x,cy+yy,Math.abs(yy)===h?GC.w:GC.y);star4(b,x+1,Math.round(cy-h),GC.w,GC.y,1);star4(b,x+1,Math.round(cy+h),GC.w,GC.y,1);}
}
// АКЦЕНТ: товстий серп-фронт червоно-жовтий, на фронті вибух-зірка, позаду смуги швидкості
function cAccent(b,f){const W=b.w,H=b.h,cy=(H-1)/2,F=frontOf(f,1.2)*W,fade=f>=4;body(b,F,['#ffb040','#ff5a2a','#a8301a'],.9,fade);
  sector(b,(x,v,y)=>{const r=Math.hypot(x,y-cy),d=r-F;
    if(d<=0&&d>-5){if(fade&&(x+y)%2)return 0;return d>-1.5?GC.w:d>-3?'#ffb040':'#ff5a2a';}
    if(r<F-6&&Math.abs((v*6)%2)<.15&&(x+f)%3===0)return '#e8502a';
    return 0;});
  if(!fade){const x=Math.round(Math.min(W-6,F)-2),c=Math.round(cy);star4(b,x,c,GC.w,'#ffb040',5);for(const [a,e] of [[-3,-3],[3,-3],[-3,3],[3,3]])P(b,x+a,c+e,'#ffe080');}
}
const CONES={strum:{W:72,draw:cStrum},chuck:{W:48,draw:cChuck},pick:{W:56,draw:cPick},lead:{W:128,draw:cLead},harm:{W:84,draw:cHarm},dstop:{W:72,draw:cDstop},accent:{W:92,draw:cAccent}};
const coneCache=new Map();
function coneFrame(part,deg,f){
  if(typeof document==='undefined')return null;const C=CONES[part];if(!C)return null;
  const d=Math.round(Math.max(8,Math.min(90,deg))/5)*5,k=part+'|'+d+'|'+f;let cv=coneCache.get(k);
  if(!cv){const H=Math.max(7,Math.round(C.W*2*Math.tan(d*Math.PI/360)))|1,b=mk(C.W,H);C.draw(b,f);cv=toCanvas(b);coneCache.set(k,cv);}
  return cv;
}
// Вершина в (x,y), напрям dir, довжина len (зона удару), повна ширина конуса deg градусів.
function drawCone(ctx,part,deg,f,x,y,dir,len,alpha){
  deg=Math.max(8,Math.min(90,deg||30));
  const cv=coneFrame(part,deg,Math.max(0,Math.min(5,f|0)));if(!cv)return false;
  const h=2*len*Math.tan(Math.max(8,deg)*Math.PI/360);
  ctx.save();ctx.translate(x,y);ctx.rotate(dir);ctx.globalAlpha=alpha;ctx.imageSmoothingEnabled=false;
  ctx.drawImage(cv,0,-h/2,len,h);ctx.restore();return true;
}


// =====================================================================
// ЕФЕКТИ УДАРІВ УСІХ ІНСТРУМЕНТІВ: кільця, блискавки, снаряди, конуси баса й клавіш, іскри влучань.
// Кільця й блискавки малюються «пером» прямо на сітці пікселів арту (квадрати px×px, вирівняні по світу),
// снаряди й іскри — запечені спрайти. Кожна партія має свій малюнок, кожен інструмент — свою палітру.
// =====================================================================
const INSTC={ // [біле ядро, світлий, основний, темний]
  guitar:['#fff6d8','#ffd27a','#ffa640','#a8401a'],
  drums:['#fff0ea','#ff9a7a','#e0503a','#7a1c1a'],
  bass:['#eaf8ff','#a9d3f5','#4aa3df','#1d4a7a'],
  piano:['#fbf0ff','#d8c0ff','#9b7fe0','#4a2a8a']};
const GOLD=['#fffbe0','#ffe2b0','#e0b050','#8a6020'];
// Ліміт клітинок на кадр (fxFrame() скидає на початку кадру): при масових вибухах решта просто не домальовується.
let cellBudget=9000;
function fxFrame(n=9000){cellBudget=n;}
function pen(ctx,px){const ops=new Map(),seen=new Set();return {px,
  p(x,y,c){if(!c||cellBudget<=0)return;const gx=Math.round(x/px),gy=Math.round(y/px),k=(gx+40000)*80000+gy+40000;if(seen.has(k))return;seen.add(k);cellBudget--;
    let a=ops.get(c);if(!a)ops.set(c,a=[]);a.push(gx,gy);},
  // один шлях і один fill на колір — у рази дешевше за тисячі окремих fillRect
  flush(){for(const [c,a] of ops){ctx.fillStyle=c;ctx.beginPath();for(let i=0;i<a.length;i+=2)ctx.rect(a[i]*px,a[i+1]*px,px,px);ctx.fill();}}};}
// Кільце: th рядків пікселів усередину, кольори по рядках; gap(кут,індекс) — пропуски.
function circ(pn,x,y,r,c,o={}){const px=pn.px,th=o.th||1;
  for(let k=0;k<th;k++){const rr=r-k*px;if(rr<=px)break;const cc=Array.isArray(c)?c[Math.min(k,c.length-1)]:c,n=Math.max(12,Math.ceil(2*Math.PI*rr/px*1.1));
    for(let i=0;i<n;i++){const a=i/n*Math.PI*2;if(o.gap&&o.gap(a,i,k))continue;pn.p(x+Math.cos(a)*rr,y+Math.sin(a)*rr,cc);}}}
function pline(pn,x0,y0,x1,y1,c){const n=Math.max(1,Math.ceil(Math.hypot(x1-x0,y1-y0)/pn.px));for(let i=0;i<=n;i++)pn.p(x0+(x1-x0)*i/n,y0+(y1-y0)*i/n,c);}
function pstar(pn,x,y,c,c2,len){const px=pn.px;pn.p(x,y,c);for(let k=1;k<=len;k++){const cc=k<len?c:c2;pn.p(x+k*px,y,cc);pn.p(x-k*px,y,cc);pn.p(x,y+k*px,cc);pn.p(x,y-k*px,cc);}}
function pnote(pn,x,y,c){const px=pn.px;for(const [a,b] of [[0,3],[1,3],[2,3],[0,4],[1,4],[2,4],[2,0],[2,1],[2,2],[3,0],[4,1]])pn.p(x+a*px,y+b*px,c);}

// ---------- КІЛЬЦЯ (бочка, малий, тарілки, бас-педаль, ліва рука, педи, арпеджіо гітари, вибухи) ----------
const RINGS={
  kick(pn,x,y,r,t,C){circ(pn,x,y,r,[C[0],C[1],C[2]],{th:3});circ(pn,x,y,r*.72,C[3],{gap:(a,i)=>i%2});
    if(t<.75)for(let k=0;k<12;k++){const a=k/12*6.283+.26,d=r+pn.px*(2+k%3);pn.p(x+Math.cos(a)*d,y+Math.sin(a)*d,k%2?C[1]:'#c8b898');}},
  snare(pn,x,y,r,t,C){circ(pn,x,y,r,[C[0],C[1]],{th:2});circ(pn,x,y,r-pn.px*4,C[2]);
    const n=Math.ceil(r/3);for(let k=0;k<n;k++){const a=(k*2.399)%6.283,d=r-pn.px*(1+(k*7)%6);pn.p(x+Math.cos(a)*d,y+Math.sin(a)*d,k%2?C[0]:C[1]);}},
  crash(pn,x,y,r,t,C){circ(pn,x,y,r,[GOLD[0],GOLD[1]],{th:2,gap:(a,i)=>(i+Math.floor(t*20))%4===0});circ(pn,x,y,r-pn.px*5,GOLD[2],{gap:(a,i)=>i%3});
    for(let k=0;k<8;k++){const a=k/8*6.283+t*2;pstar(pn,x+Math.cos(a)*r,y+Math.sin(a)*r,'#ffffff',GOLD[1],k%2?2:3);}},
  ride(pn,x,y,r,t,C){circ(pn,x,y,r,GOLD[1]);pstar(pn,x,y-r,'#ffffff',GOLD[1],3);pstar(pn,x+r*.7,y+r*.7,GOLD[0],GOLD[2],1);},
  fill(pn,x,y,r,t,C){circ(pn,x,y,r,[C[0],C[1],C[2]],{th:3,gap:a=>((a+t*5)%(Math.PI/3))<.38});
    for(let k=0;k<6;k++){const a=k*Math.PI/3+t*5+.2;pn.p(x+Math.cos(a)*(r+pn.px*2),y+Math.sin(a)*(r+pn.px*2),C[0]);}},
  flam(pn,x,y,r,t,C){circ(pn,x,y,r,[C[0],C[1]],{th:2});circ(pn,x,y,r*.84,[C[2],C[3]],{th:2,gap:(a,i)=>i%5===0});},
  toms(pn,x,y,r,t,C){RINGS.fill(pn,x,y,r,t,C);},
  garp(pn,x,y,r,t,C){circ(pn,x,y,r,C[2],{gap:(a,i)=>i%3});for(let k=0;k<8;k++){const a=k/8*6.283+t*3;pnote(pn,x+Math.cos(a)*r-2*pn.px,y+Math.sin(a)*r-3*pn.px,k%2?C[0]:C[1]);}},
  pedal(pn,x,y,r,t,C){circ(pn,x,y,r,[C[0],C[1],C[2],C[3]],{th:4});
    for(let k=1;k<4;k++)circ(pn,x,y,r*(1-k*.18),C[k===1?2:3],{gap:(a,i)=>(i+k)%2});},
  left(pn,x,y,r,t,C){circ(pn,x,y,r,C[2]);
    circ(pn,x,y,r-pn.px,'#fdf9ee',{th:3,gap:(a,i)=>i%3===2});
    circ(pn,x,y,r-pn.px,'#1a0f24',{th:2,gap:(a,i)=>{const key=Math.floor(i/3)%7;return !([0,1,3,4,5].includes(key)&&i%3===2);}});
    circ(pn,x,y,r-pn.px*4,C[3]);},
  pad(pn,x,y,r,t,C){for(let k=0;k<6;k++)circ(pn,x,y,r-k*pn.px,k<2?C[1]:C[2],{gap:(a,i)=>(i+k)%2===0||(k>3&&i%3)});},
  boom(pn,x,y,r,t,C){circ(pn,x,y,r,[C[0],C[1]],{th:2});const n=Math.ceil(r*r/40);
    for(let k=0;k<n;k++){const a=(k*2.399)%6.283,d=Math.sqrt((k+.5)/n)*r*.92;if((k+Math.floor(t*12))%3)pn.p(x+Math.cos(a)*d,y+Math.sin(a)*d,k%4?C[2]:C[0]);}},
  def(pn,x,y,r,t,C){circ(pn,x,y,r,[C[0],C[1],C[2]],{th:3});}
};

// ---------- БЛИСКАВКИ / ПРОМЕНІ (хет, римшот, тремоло гітари, синкопа баса, дзвіночок клавіш) ----------
function zagPts(x1,y1,x2,y2,seg,amp,seed){const L=Math.hypot(x2-x1,y2-y1)||1,n=Math.max(2,Math.round(L/seg)),nx=-(y2-y1)/L,ny=(x2-x1)/L,pts=[];
  for(let i=0;i<=n;i++){const t=i/n,j=i===0||i===n?0:(hash2(i,seed)-.5)*2*amp;pts.push([x1+(x2-x1)*t+nx*j,y1+(y2-y1)*t+ny*j]);}return pts;}
function zagDraw(pn,pts,c,c2){for(let i=1;i<pts.length;i++){pline(pn,pts[i-1][0],pts[i-1][1],pts[i][0],pts[i][1],c);if(c2)pline(pn,pts[i-1][0]+pn.px,pts[i-1][1],pts[i][0]+pn.px,pts[i][1],c2);}}
const ZAPS={
  hat(pn,a,C,t,seed){const z=zagPts(a.x1,a.y1,a.x2,a.y2,14,8,seed);zagDraw(pn,z,GOLD[0],GOLD[1]);zagDraw(pn,z.map(([x,y])=>[x,y+pn.px]),GOLD[2]);
    for(let k=0;k<5;k++){const u=hash2(k,seed);pn.p(a.x1+(a.x2-a.x1)*u+(hash2(seed,k)-.5)*18,a.y1+(a.y2-a.y1)*u+(hash2(k+9,seed)-.5)*18,GOLD[1]);}
    pstar(pn,a.x2,a.y2,'#ffffff',GOLD[1],t<.5?4:2);},
  rim(pn,a,C,t,seed){pline(pn,a.x1,a.y1,a.x2,a.y2,'#ffffff');const L=Math.hypot(a.x2-a.x1,a.y2-a.y1)||1,nx=-(a.y2-a.y1)/L,ny=(a.x2-a.x1)/L;
    for(let d=12;d<L;d+=16){const x=a.x1+(a.x2-a.x1)*d/L,y=a.y1+(a.y2-a.y1)*d/L;pline(pn,x-nx*5,y-ny*5,x+nx*5,y+ny*5,C[1]);}
    pstar(pn,a.x2,a.y2,'#ffffff',C[0],t<.5?5:2);},
  trem(pn,a,C,t,seed){const L=Math.hypot(a.x2-a.x1,a.y2-a.y1)||1,step=pn.px*4,off=(t*60)%step;
    for(let d=off;d<L;d+=step){const u=d/L,v=Math.min(1,(d+pn.px*2)/L),x0=a.x1+(a.x2-a.x1)*u,y0=a.y1+(a.y2-a.y1)*u,x1=a.x1+(a.x2-a.x1)*v,y1=a.y1+(a.y2-a.y1)*v;pline(pn,x0,y0,x1,y1,C[0]);pline(pn,x0,y0+pn.px,x1,y1+pn.px,C[2]);}
    pstar(pn,a.x2,a.y2,C[0],C[2],3);},
  sync(pn,a,C,t,seed){const pts=zagPts(a.x1,a.y1,a.x2,a.y2,10,10,seed);zagDraw(pn,pts,C[0],C[1]);
    for(const [x,y] of pts){pn.p(x,y-pn.px,C[2]);pn.p(x,y+pn.px*2,C[2]);}pstar(pn,a.x2,a.y2,'#ffffff',C[1],4);},
  bell(pn,a,C,t,seed){pline(pn,a.x1,a.y1,a.x2,a.y2,C[1]);pline(pn,a.x1,a.y1+pn.px,a.x2,a.y2+pn.px,C[2]);
    const px=pn.px,bx=a.x2,by=a.y2;for(const [u,v] of [[-1,-3],[0,-3],[1,-3],[-2,-2],[2,-2],[-2,-1],[2,-1],[-2,0],[2,0],[-3,1],[3,1],[-3,2],[-2,2],[-1,2],[0,2],[1,2],[2,2],[3,2],[0,3]])pn.p(bx+u*px,by+v*px,v===2?C[0]:C[1]);
    circ(pn,bx,by,px*(4+t*10),C[1],{gap:(q,i)=>i%2});},
  def(pn,a,C,t,seed){zagDraw(pn,zagPts(a.x1,a.y1,a.x2,a.y2,12,8,seed),C[0],C[2]);pstar(pn,a.x2,a.y2,'#ffffff',C[1],3);}
};

// ---------- СНАРЯДИ (хвилі баса, томи й привиди барабана, бас пальцем гітари, ноти й октави клавіш) ----------
function shotSprite(style,C,f){
  const b=mk(20,20),cx=10,cy=10;
  const cres=(rs,cols,th=1)=>{for(let y=0;y<20;y++)for(let x=0;x<20;x++){const d=Math.hypot(x+.5-3,y+.5-cy);
    for(let i=0;i<rs.length;i++)if(d>=rs[i]-th&&d<rs[i]&&x+.5>3+rs[i]*.35&&Math.abs(y+.5-cy)<rs[i]*.92)P(b,x,y,cols[i]);}};
  if(style==='toms'){ell(b,cx,cy+1,6,4.5,C[3]);ell(b,cx,cy,6,4.5,C[2]);ell(b,cx,cy-2,6,3,'#f6eedb');ring(b,cx,cy-2,6,3,'#cfd6e0',30);P(b,cx-3+f*2,cy-3,'#ffffff');
    for(let k=0;k<3;k++)P(b,1+k,cy+(k%2),C[1]);}
  else if(style==='ghost'){cres([7,10,13],[C[1],C[2],C[2]],2);for(let y=0;y<20;y++)for(let x=0;x<20;x++)if((x+y+f)%2&&b[y*20+x])b[y*20+x]=0;}
  else if(style==='thumb'){cres([8,12,16],[C[0],C[1],C[2]],2);for(let x=2;x<14;x++){P(b,x,cy-1,(x+f)%3?C[3]:0);P(b,x,cy+1,(x+f+1)%3?C[3]:0);}}
  else if(style==='note'){ell(b,7.5,13,3.4,2.6,C[2]);P(b,6,12,C[0]);rect(b,10,3,1,10,C[2]);rect(b,11,3,1,2,C[2]);P(b,12,4+(f%2),C[2]);P(b,13,5+(f%2),C[2]);
    for(const [x,y] of [[3,3],[15,9],[4,8]])if((x+f)%2)P(b,x,y,C[0]);}
  else if(style==='loct'){cres([9,13],[C[1],C[2]],2);for(let k=0;k<4;k++)rect(b,12+(k%2),5+k*3,2,1,'#fdf9ee');}
  else if(style==='drone'){cres([5,8,11,14,17],[C[0],C[1],C[2],C[2],C[3]],2);}
  else{cres([7,11,15],[C[0],C[1],C[2]],2);if(f%2)for(let y=0;y<20;y++)for(let x=0;x<20;x++)if(b[y*20+x]===C[2]&&(x+y)%3===0)b[y*20+x]=C[3];}
  return b;
}
const fxShotCache=new Map();
function shotFx(style,inst,f){const k=style+'|'+inst+'|'+f;let cv=fxShotCache.get(k);
  if(!cv){cv=toCanvas(outline(shotSprite(style,INSTC[inst]||INSTC.bass,f),'#0a0610'));fxShotCache.set(k,cv);}return cv;}

// ---------- ІСКРИ ВЛУЧАНЬ (по одній на інструмент, 6 кадрів) ----------
function sparkSprite(inst,f){const b=mk(17,17),C=INSTC[inst]||INSTC.guitar,c=8;
  if(inst==='guitar'){const L=[2,5,7,7,6,4][f];for(let k=1;k<=L;k++){const cc=k<L-1?C[0]:C[2];P(b,c+k,c,cc);P(b,c-k,c,cc);P(b,c,c+k,cc);P(b,c,c-k,cc);}
    if(f>1)for(const [a,d] of [[1,1],[-1,1],[1,-1],[-1,-1]])for(let k=1;k<=Math.min(3,f);k++)P(b,c+a*k,c+d*k,C[1]);if(f>3)rect(b,c-1,c-1,3,3,0);P(b,c,c,f<4?'#ffffff':0);}
  else if(inst==='drums'){const R=[2,4,6,7,8,8][f];for(let k=0;k<8;k++){const a=k/8*Math.PI*2+.2;for(let s=Math.max(1,R-3);s<=R;s++)P(b,c+Math.cos(a)*s,c+Math.sin(a)*s,s===R?C[0]:C[2]);}
    if(f<3)ell(b,c+.5,c+.5,2-f*.5+1,2-f*.5+1,C[0]);}
  else if(inst==='bass'){const R=[1.5,3,4.5,6,7,7.6][f];ring(b,c+.5,c+.5,R,R,f<3?C[0]:C[1],28);if(f<4)ring(b,c+.5,c+.5,R*.55,R*.55,C[2],16);if(f<2)rect(b,c-1,c-1,3,3,'#ffffff');}
  else{for(let k=0;k<5;k++){const a=k/5*Math.PI*2+f*.3,d=1+f*1.3;const x=c+Math.cos(a)*d,y=c+Math.sin(a)*d;P(b,x,y,C[0]);if(f<4){P(b,x+1,y,C[1]);P(b,x,y+1,C[1]);}}
    if(f<2){P(b,c,c,'#ffffff');P(b,c+1,c,C[0]);P(b,c-1,c,C[0]);P(b,c,c+1,C[0]);P(b,c,c-1,C[0]);}}
  return b;}
const sparkCache=new Map();
function drawSpark(ctx,inst,f,x,y,size){if(typeof document==='undefined')return false;f=Math.max(0,Math.min(5,f|0));const k=inst+'|'+f;let cv=sparkCache.get(k);
  if(!cv){cv=toCanvas(outline(sparkSprite(inst,f),'#0a0610'));sparkCache.set(k,cv);}
  ctx.imageSmoothingEnabled=false;ctx.drawImage(cv,x-size/2,y-size/2,size,size);return true;}

// ---------- КОНУСИ БАСА Й КЛАВІШ ----------
function cSlap(b,f){const W=b.w,H=b.h,cy=(H-1)/2,F=frontOf(f,1.3)*W,fade=f>=4,C=INSTC.bass;body(b,F,[C[1],C[2],C[3]],.85,fade);
  sector(b,(x,v,y)=>{const r=Math.hypot(x,y-cy),d=r-F;if(d<=0&&d>-3)return fade&&(x+y)%2?0:d>-1?C[0]:C[1];
    if(r<F-4&&Math.abs(v)<.9&&((x*3+y*5)%17===0))return '#ffffff';return 0;});
  if(!fade)for(const s of [-.5,.5]){let x=Math.round(F*.6),y=Math.round(cy+s*x*(H/2)/W);for(let k=0;k<5;k++){P(b,x,y,C[0]);x+=1;y+=k%2?1:-1;}}}
function cStab(b,f){const W=b.w,H=b.h,cy=(H-1)/2,F=frontOf(f,1.2)*W,fade=f>=4,C=INSTC.piano;body(b,F,[C[1],C[2],C[3]],.7,fade);
  if(!fade)for(const s of [-.55,0,.55]){const x=Math.round(Math.min(W-5,F)-4),y=Math.round(cy+s*x*(H/2)/W);rect(b,x,y-1,4,3,'#fdf9ee');rect(b,x,y-1,4,1,C[0]);rect(b,x+4,y-1,1,3,C[3]);P(b,x+1,y-2,'#1a0f24');P(b,x+2,y-2,'#1a0f24');}}
function cTrill(b,f){const W=b.w,H=b.h,cy=Math.round((H-1)/2),F=frontOf(f)*W,fade=f>=5,C=INSTC.piano;body(b,F,[C[1],C[2],C[3]],.3,fade);
  for(let x=1;x<Math.min(W,F);x++){if(fade&&x%2)continue;const yy=cy+((Math.floor(x/2)+f)%2?2:-2);P(b,x,yy,C[0]);P(b,x,yy+1,C[1]);}
  if(!fade)star4(b,Math.round(Math.min(W-4,F)),cy,'#ffffff',C[1],3);}
Object.assign(CONES,{slap:{W:68,draw:cSlap},stab:{W:76,draw:cStab},trill:{W:116,draw:cTrill}});

// ---------- ГОЛОВНИЙ ВХІД: малює удар власним піксель-артом або повертає false (тоді — старий пакет) ----------
const ZAP_STYLE={hat:'hat',rim:'rim',trem:'trem',sync:'sync',bell:'bell'};
const SHOT_STYLE={toms:'toms',ghost:'ghost',thumb:'thumb',loct:'loct',drone:'drone'};
function drawFx(ctx,kind,o,inst,age,dur,alpha,px){
  if(typeof document==='undefined')return false;
  const C=INSTC[inst]||INSTC.guitar,t=Math.max(0,Math.min(1,age/dur)),f=Math.min(5,Math.floor(t*6));
  if(kind==='cone'){if(!CONES[o.layer])return false;const w=(o.w||.52)*180/Math.PI;return drawCone(ctx,o.layer,w,f,o.x,o.y,o.dir,o.maxR,alpha);}
  ctx.save();ctx.globalAlpha=alpha;
  if(kind==='ring'){const r=8+(o.maxR-8)*Math.min(1,age/.22),st=o.boom?'boom':RINGS[o.layer]?o.layer:'def',pn=pen(ctx,px);
    RINGS[st](pn,o.x,o.y,r,t,o.boom?INSTC.piano:C);pn.flush();}
  else if(kind==='zap'){const pn=pen(ctx,px);(ZAPS[ZAP_STYLE[o.layer]]||ZAPS.def)(pn,o,C,t,(o.visualId||1)*7+Math.floor(age*30));pn.flush();}
  else if(kind==='shot'){const st=o.kind==='note'?'note':SHOT_STYLE[o.layer]||'wave',ang=Math.atan2(o.vy,o.vx),s=Math.max(26,o.r*3.2),fr=Math.floor(age*12)%4;
    if(st==='note'){const pn=pen(ctx,px);for(let k=1;k<=4;k++)if((k+fr)%2)pn.p(o.x-Math.cos(ang)*k*7,o.y-Math.sin(ang)*k*7,k<3?C[1]:C[2]);pn.flush();}
    const cv=shotFx(st,inst,fr);ctx.translate(o.x,o.y);if(st!=='note')ctx.rotate(ang);ctx.imageSmoothingEnabled=false;ctx.drawImage(cv,-s/2,-s/2,s,s);}
  else{ctx.restore();return false;}
  ctx.restore();return true;
}

root.PixelHeroes={draw,frame,pose,portrait,build,GW,GH,FOOT,chars:Object.keys(HEROES),
  drawFx,drawSpark,fxFrame,
  drawCone,coneFrame,coneParts:Object.keys(CONES),
  mobPose,mobFrame,drawMob,drawShot,drawCharge,mobTypes:Object.keys(MOBGFX),mobGrid:t=>MOBGFX[t]&&MOBGFX[t].g};
})(typeof window!=='undefined'?window:globalThis);
