// Піксельні герої, намальовані кодом (без PNG-листів): сітка 40×40, ручна палітра, контур, шахове змішування тонів.
// Кожен кадр складається з частин із цілими зсувами, печеться один раз в офскрін-канвас і далі лише drawImage.
(function(root){
'use strict';
const GW=40,GH=40,FOOT=36,OUT='#120a18';
const mk=()=>new Array(GW*GH).fill(0);
const P=(b,x,y,c)=>{x=Math.round(x);y=Math.round(y);if(c&&x>=0&&y>=0&&x<GW&&y<GH)b[y*GW+x]=c;};
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
  blob(b,19.5,28.5+y+s*.5,10.4,7.6-s*.5,Wd);
  for(const [gx,gy] of [[12,27],[13,28],[26,25],[27,26],[12,31],[27,31],[25,32],[14,22]])P(b,gx,gy+y,'#d97e28');
  // гриф і голова з кілками
  rect(b,16+nk,7+up,7,7,'#6e3c1f');rect(b,16+nk,7+up,1,7,'#8e5430');rect(b,22+nk,7+up,1,7,'#4e2a14');
  for(const fy of [9,12])rect(b,16+nk,fy+up,7,1,'#c9b48a');
  rect(b,16+nk,1+up,8,6,'#c3622a');rect(b,16+nk,1+up,8,1,'#e8954e');rect(b,16+nk,6+up,8,1,'#8a3e18');rect(b,17+nk,2+up,1,3,'#e8954e');
  for(const [kx,ky] of [[15,2],[15,4],[24,2],[24,4]]){P(b,kx+nk,ky+up,'#e3e8f0');P(b,kx+nk+(kx<20?-1:1),ky+up,'#9aa3b4');}
  // паща-розетка
  mouthGuitar(b,28+y+s,q.mouth);
  // бридж
  rect(b,14,33+y,12,2,'#5a2a12');rect(b,14,33+y,12,1,'#7e4622');
  // три струни з темними проміжками (на ударі тремтять зиґзаґом)
  for(let k=0;k<3;k++)for(let yy=7+up;yy<=33+y;yy++){
    let xx=17+k*2+(yy<=13+up?nk:0);
    if(q.vib&&yy>14+up&&(Math.floor(yy/3)+k+q.f)%2)xx+=k===1?1:-1;
    P(b,xx,yy,k===1?'#fff6e4':'#e6d6b4');
  }
  eyes(b,10,23,16+up,q.eyes,{R:'#3a1406',W:'#f4fbff',I:'#36d6e0',K:'#06222a',H:'#ffffff'});
  // лапки
  const f=q.step,LL=[0,1,2,1,0,0,0,0],RL=[0,0,0,0,0,1,2,1],DX=[-1,0,1,1,1,0,-1,-1];
  const foot=(x,yy)=>{rect(b,x,yy,4,2,'#d4893a');rect(b,x,yy+1,4,1,'#8f4e1e');P(b,x+1,yy,'#f5c27a');P(b,x+4,yy+1,'#f3e2c0');};
  foot(13+(f>=0?DX[f]:0),35-(f>=0?LL[f]:0));foot(23-(f>=0?DX[f]:0),35-(f>=0?RL[f]:0));
}
function mouthGuitar(b,cy,m){
  const M='#3a0c18',Md='#22050c',T='#fff4dc';
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
  rect(b,12,footY,5,2,'#2a1824');P(b,16,footY,'#55405a');
  rect(b,24,footY-stomp,5,2,'#2a1824');P(b,28,footY-stomp,'#55405a');
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
    if(q.phase==='hit'&&d>.18&&d<.34)c='#fff7c0';
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
  if(ph==='ant'&&q.L!==0){hl=[8,13+y];hr=[31,13+y];tl=[11,4+y];tr=[28,4+y];}
  else if(ph==='hit'&&q.L!==0){
    hl=[6,12+y];hr=[33,12+y];tl=[15,top];tr=[24,top];
    if(q.L===2)tl=[7,8+y],hl=[8,15+y];                       // хет — одна паличка
    if(q.L===3){tl=[14,1+y];tr=[25,1+y];hl=[10,11+y];hr=[29,11+y];} // тарілка — схрещені вгорі
  }
  else{const w=q.step>=0?[0,1,1,0,0,-1,-1,0][q.step]:(f%4<2?0:1);hl=[7,21+y+w];hr=[32,21+y-w];tl=[3,14+y+w];tr=[36,14+y-w];}
  const arm=(sx,h)=>{line(b,sx,20+y,h[0],h[1],'#d24a3a');line(b,sx,21+y,h[0],h[1]+1,'#7a1418');rect(b,h[0]-1,h[1]-1,2,2,'#ffb08f');};
  const stick=(h,t)=>{line(b,h[0],h[1],t[0],t[1],'#b8742c');line(b,h[0],h[1]-1,t[0],t[1]-1,'#f0c878');P(b,t[0],t[1],'#fff3c8');P(b,t[0],t[1]-1,'#fff3c8');};
  arm(9,hl);arm(30,hr);stick(hl,tl);stick(hr,tr);
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
      let yy=Math.round(cy-ry*Math.sqrt(1-nx*nx)*fk);if(q.vib&&(x+k+q.f)%2)yy+=1;if(yy>clip)continue;P(b,x,yy,k<2?'#e2f0ff':'#a8c8f0');}}
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
  const pk=q.phase==='hit'||q.phase==='rec'?(q.f+q.L*2)%6:-1;
  for(let i=0;i<6;i++){const kx=11+i*3,d=i===pk?1:0;rect(b,kx,mt+d,2,3-d,'#fdf9ee');P(b,kx,mt+d,'#ffffff');}
  for(const i of [0,1,3,4])rect(b,11+i*3+1,mt,2,2,'#1a0f24');
  if(!m){rect(b,12,mt+3,16,1,'#2a0a4a');P(b,11,mt+2,'#2a0a4a');P(b,28,mt+2,'#2a0a4a');}
  else{rect(b,11,mt+3,18,h,'#2a0a4a');rect(b,12,mt+3+Math.max(1,h-2),16,Math.min(2,h),'#14051f');if(h>2)rect(b,16,mt+2+h,7,1,'#ff6fa8');}
  // ноти-плювки
  if(q.phase==='hit'){const nx=31+(q.f-2)*3,ny=Math.round(cy)-2;rect(b,nx,ny+2,2,2,'#ffe6ff');rect(b,nx+1,ny-1,1,3,'#ffe6ff');P(b,nx+2,ny-1,'#ffe6ff');}
}

const HEROES={
  guitar:{draw:drawGuitar,death:'side',walk:{bob:[0,-1,-1,0,0,-1,-1,0]}},
  drums:{draw:drawDrums,death:'side',walk:{bob:[0,-2,-4,-5,-4,-2,0,0],sq:[1,-1,-1,0,0,-1,0,1]}},
  bass:{draw:drawBass,death:'flip',walk:{bob:[0,0,-1,0,0,0,-1,0]}},
  piano:{draw:drawPiano,death:'puddle',walk:{bob:[0,0,-2,-4,-4,-2,0,0],sq:[2,1,-1,-2,-1,0,1,2]}}
};

// Поза → параметри малювання.
function params(ch,po){
  const H=HEROES[ch],f=po.f|0,q={bob:0,sq:0,mouth:0,eyes:'open',lean:0,step:-1,vib:0,f,L:po.L|0,phase:'',tw:f*.8,nk:0,shell:0};
  if(po.s==='idle'){
    q.sq=po.beat?1:0;q.tw=f*.8;
    if(po.blink)q.eyes='blink';else if(f===5||f===6)q.eyes='look';
    if(ch==='bass'&&(f===2||f===3))q.vib=1;
    if(ch==='piano'){q.sq=po.beat?1:[0,0,1,1,0,0,-1,-1][f];}
  }else if(po.s==='walk'){
    q.step=f;q.bob=H.walk.bob[f];q.sq=H.walk.sq?H.walk.sq[f]:0;q.lean=ch==='bass'?0:.05;q.tw=f*1.1;
  }else if(po.s==='atk'){
    q.phase=f<2?'ant':f<4?'hit':'rec';
    if(q.phase==='ant'){q.sq=1;q.lean=-.04;q.eyes='half';q.nk=-1;}
    else if(q.phase==='hit'){q.sq=-1;q.lean=.1;q.eyes=q.L%2?'angry':'wide';q.mouth=3;q.vib=1;q.nk=1;q.shell=2;}
    else{q.lean=.03;q.mouth=1;q.vib=f===4?1:0;q.shell=f===4?1:0;}
    if(ch==='bass')q.lean=0;
  }else if(po.s==='hurt'){q.eyes='hurt';q.mouth=1;q.lean=-.08;q.sq=f?0:1;}
  return q;
}

function shear(b,k){if(!k)return b;const o=mk();for(let y=0;y<GH;y++){const dx=Math.round((FOOT-y)*k);for(let x=0;x<GW;x++){const c=b[y*GW+x];if(c)P(o,x+dx,y,c);}}return o;}
function rot90(b){const o=mk();for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){const c=b[y*GW+x];if(c)P(o,GH-1-y,x,c);}return o;}
function flipV(b){const o=mk();for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){const c=b[y*GW+x];if(c)P(o,x,GH-1-y,c);}return o;}
function bbox(b){let x0=GW,x1=-1,y0=GH,y1=-1;for(let y=0;y<GH;y++)for(let x=0;x<GW;x++)if(b[y*GW+x]){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}return {x0,x1,y0,y1};}
function settle(b,lift=0){const r=bbox(b);if(r.x1<0)return b;const dx=Math.round(19.5-(r.x0+r.x1)/2),dy=FOOT-r.y1-lift,o=mk();
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){const c=b[y*GW+x];if(c)P(o,x+dx,y+dy,c);}return o;}
function outline(b){const o=b.slice();for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){const i=y*GW+x;if(b[i])continue;
  if((x>0&&b[i-1])||(x<GW-1&&b[i+1])||(y>0&&b[i-GW])||(y<GH-1&&b[i+GW]))o[i]=OUT;}return o;}
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
  const q=params(ch,po);let b=mk();HEROES[ch].draw(b,q);b=shear(b,q.lean);return outline(b);
}

const rgbCache=new Map();
const rgb=h=>{let v=rgbCache.get(h);if(!v){v=[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];rgbCache.set(h,v);}return v;};
function toCanvas(b,flash,scale=1){
  const cv=document.createElement('canvas');cv.width=GW;cv.height=GH;const g=cv.getContext('2d'),im=g.createImageData(GW,GH),d=im.data;
  for(let i=0;i<b.length;i++){const c=b[i];if(!c)continue;let [r,gg,bb]=rgb(c);
    if(flash&&c!==OUT){r+=(255-r)*.72;gg+=(255-gg)*.72;bb+=(255-bb)*.72;}
    d[i*4]=r;d[i*4+1]=gg;d[i*4+2]=bb;d[i*4+3]=255;}
  g.putImageData(im,0,0);
  if(scale===1)return cv;
  const big=document.createElement('canvas');big.width=GW*scale;big.height=GH*scale;const bg=big.getContext('2d');bg.imageSmoothingEnabled=false;bg.drawImage(cv,0,0,big.width,big.height);return big;
}

const cache=new Map();
function keyOf(ch,po){return ch+'|'+po.s+'|'+(po.f|0)+'|'+(po.L|0)+'|'+(po.blink?1:0)+(po.beat?1:0)+(po.flash?1:0);}
function frame(ch,po){
  if(typeof document==='undefined'||!HEROES[ch])return null;
  const k=keyOf(ch,po);let cv=cache.get(k);
  if(!cv){if(cache.size>800)cache.clear();cv=toCanvas(build(ch,po),po.flash);cache.set(k,cv);}
  return cv;
}
// Стан героя → поза. Час у секундах.
function pose(i){
  // Гість: G.t із пакета може на мить відступити назад, тому час падіння не буває від'ємним.
  if(i.dead){const d=Math.max(0,i.deadFor||0);if(d<.6)return {s:'fall',f:Math.min(5,Math.floor(d/.1))};return {s:'down',f:Math.floor(i.t*4)%4};}
  if(i.riseFor>=0&&i.riseFor<.5)return {s:'rise',f:Math.min(4,Math.floor(i.riseFor/.1))};
  // Удар — рівно в момент ноти (кадри 2–3), потім відкат (4–5). Замах (0–1) — лише якщо наступна нота вже в черзі за ≤0.1 с.
  if(i.atkSince>=0&&i.atkSince<.24)return {s:'atk',f:2+Math.min(3,Math.floor(i.atkSince/.06)),L:Math.abs(i.atkL|0)%5};
  if(i.nextAtk>0&&i.nextAtk<=.1)return {s:'atk',f:i.nextAtk>.05?0:1,L:Math.abs(i.nextL|0)%5};
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

root.PixelHeroes={draw,frame,pose,portrait,build,GW,GH,FOOT,chars:Object.keys(HEROES)};
})(typeof window!=='undefined'?window:globalThis);
