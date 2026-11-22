// Піксельні іконки скілів у стилі pixel-heroes.js: сітка 24×24, жорсткий 1-px темний контур, палітра інструмента (INSTC),
// жодного згладжування. Іконка — SVG з прямокутників-пікселів (shape-rendering:crispEdges), тож працює й без canvas (тести, сервер).
// Партії: рамка → символ скіла (контур навколо) → позначка форми атаки в кутку. Пасиви: рамка за типом (педаль / спорядження /
// помічник / модуль) + символ у кольорі інструмента. Акорди, нюанси акордів, ритми ударних і «перепочинок» — теж тут.
(function(root){
'use strict';
const N=24,OUT='#120a18',CR='#f3e4c7';
// палітри [біле ядро, світлий, основний, темний] — ті самі, що в pixel-heroes.js (INSTC); там вони не експортуються
const INSTC={
  guitar:['#fff6d8','#ffd27a','#ffa640','#a8401a'],drums:['#fff0ea','#ff9a7a','#e0503a','#7a1c1a'],
  bass:['#eaf8ff','#a9d3f5','#4aa3df','#1d4a7a'],piano:['#fbf0ff','#d8c0ff','#9b7fe0','#4a2a8a'],
  flute:['#f3ffd8','#c2ef9a','#69bd77','#2b7154'],violin:['#fff2e1','#efb4b5','#c178a4','#693d70'],
  sax:['#fff9d8','#ffe18c','#dfa83c','#8a5820'],accordion:['#f2ffe2','#a8e0b6','#62b99a','#2c715f']};
const GOLD=['#fffbe0','#ffe2b0','#e0b050','#8a6020'],STEEL=['#f0fbff','#b8e4ff','#6cb4ec','#2a5a8a'],LEAF=['#f2ffe8','#b6f0b0','#5cc27a','#1f6a44'];
const INSTS=Object.keys(INSTC);

const mk=(w=N,h=N)=>{const a=new Array(w*h).fill(0);a.w=w;a.h=h;return a;};
const P=(b,x,y,c)=>{x=Math.round(x);y=Math.round(y);if(c&&x>=0&&y>=0&&x<b.w&&y<b.h)b[y*b.w+x]=c;};
const rect=(b,x,y,w,h,c)=>{for(let j=0;j<h;j++)for(let i=0;i<w;i++)P(b,x+i,y+j,c);};
function line(b,x0,y0,x1,y1,c){x0=Math.round(x0);y0=Math.round(y0);x1=Math.round(x1);y1=Math.round(y1);
  const dx=Math.abs(x1-x0),dy=-Math.abs(y1-y0),sx=x0<x1?1:-1,sy=y0<y1?1:-1;let e=dx+dy;
  for(let n=0;n<100;n++){P(b,x0,y0,c);if(x0===x1&&y0===y1)break;const e2=2*e;if(e2>=dy){e+=dy;x0+=sx;}if(e2<=dx){e+=dx;y0+=sy;}}}
function outline(b,col=OUT){const W=b.w,H=b.h,o=b.slice();o.w=W;o.h=H;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(b[y*W+x])continue;
    if((x>0&&b[y*W+x-1])||(x<W-1&&b[y*W+x+1])||(y>0&&b[(y-1)*W+x])||(y<H-1&&b[(y+1)*W+x]))o[y*W+x]=col;}return o;}
function blit(dst,src,ox,oy){for(let y=0;y<src.h;y++)for(let x=0;x<src.w;x++){const c=src[y*src.w+x];if(c)P(dst,x+ox,y+oy,c);}}
const hexN=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const mix=(a,b,t)=>{const A=hexN(a),B=hexN(b);return '#'+A.map((v,i)=>Math.round(v+(B[i]-v)*t).toString(16).padStart(2,'0')).join('');};

// ---------- «перо» символів: d.* малює в буфері b кольорами палітри C (число 0..3 — індекс, рядок — свій колір) ----------
function pen(b,C){
  const col=c=>typeof c==='number'?C[c]:c==='r'?CR:c==='k'?OUT:c;
  const d={b,C,col,
    p:(x,y,c=1)=>P(b,x,y,col(c)),
    rect:(x,y,w,h,c=1)=>rect(b,x,y,w,h,col(c)),
    line:(x0,y0,x1,y1,c=1)=>line(b,x0,y0,x1,y1,col(c)),
    dash:(x0,y0,x1,y1,c=1)=>{const n=Math.max(Math.abs(x1-x0),Math.abs(y1-y0));for(let i=0;i<=n;i+=2)P(b,x0+(x1-x0)*i/n,y0+(y1-y0)*i/n,col(c));},
    ring:(cx,cy,r,c=1)=>{const n=Math.max(16,Math.round(r*8));for(let i=0;i<n;i++){const a=i/n*Math.PI*2;P(b,cx+Math.cos(a)*r,cy+Math.sin(a)*r,col(c));}},
    disc:(cx,cy,r,c=2)=>{for(let y=Math.floor(cy-r);y<=Math.ceil(cy+r);y++)for(let x=Math.floor(cx-r);x<=Math.ceil(cx+r);x++)if((x-cx)*(x-cx)+(y-cy)*(y-cy)<=r*r+.3)P(b,x,y,col(c));},
    // стамп: рядки з літер (w l m d — палітра, r — крем, k — контур)
    st:(rows,x,y,flip)=>{rows.forEach((r,j)=>{for(let i=0;i<r.length;i++){const ch=r[i];if(ch==='.'||ch===' ')continue;
      const c=ch==='w'?C[0]:ch==='l'?C[1]:ch==='m'?C[2]:ch==='d'?C[3]:ch==='r'?CR:ch==='k'?OUT:null;if(c)P(b,flip?x+r.length-1-i:x+i,y+j,c);}});},
    // нота: голівка 3×2 + штиль угору + прапорець
    note:(x,y,c=1,flag=true,h=5,dark=3)=>{rect(b,x,y,3,2,col(c));P(b,x,y,0);P(b,x+2,y+1,col(dark));rect(b,x+2,y-h,1,h,col(c));if(flag){P(b,x+3,y-h,col(c));P(b,x+4,y-h+1,col(c));P(b,x+4,y-h+2,col(c));}},
    head:(x,y,c=1)=>{rect(b,x,y,3,2,col(c));P(b,x,y,0);P(b,x+2,y+1,col(3));},
    strings:(x,y,w,k,gap,c='r')=>{for(let i=0;i<k;i++)rect(b,x,y+i*gap,w,1,col(c));},
    wave:(x,y,w,amp,c=1,per=6)=>{for(let i=0;i<w;i++)P(b,x+i,y+Math.sin(i/per*Math.PI*2)*amp,col(c));},
    burst:(cx,cy,r,c=0,c2=1)=>{P(b,cx,cy,col(c));for(let k=1;k<=r;k++){const cc=col(k<r?c:c2);P(b,cx+k,cy,cc);P(b,cx-k,cy,cc);P(b,cx,cy+k,cc);P(b,cx,cy-k,cc);}
      if(r>=3)for(const [a,e] of [[-1,-1],[1,-1],[-1,1],[1,1]])P(b,cx+a*2,cy+e*2,col(c2));},
    arrow:(x0,y0,x1,y1,c=1)=>{line(b,x0,y0,x1,y1,col(c));const a=Math.atan2(y1-y0,x1-x0);
      for(const s of [-.8,.8])line(b,x1,y1,x1-Math.cos(a+s)*2.6,y1-Math.sin(a+s)*2.6,col(c));},
    drum:(x,y,w,h,top=0)=>{ /* барабан: світлий верх-еліпс, тіло, нижній обід, затискачі */
      rect(b,x+1,y,w-2,1,C[top]);rect(b,x,y+1,w,1,C[1]);rect(b,x,y+2,w,h,C[2]);rect(b,x+1,y+2+h,w-2,1,C[3]);
      P(b,x,y+1,C[0]);for(let i=2;i<w-1;i+=3)rect(b,x+i,y+3,1,Math.max(1,h-2),C[3]);rect(b,x,y+2,1,h,C[1]);},
    cym:(x,y,w,c=1)=>{rect(b,x+1,y,w-2,1,C[0]);rect(b,x,y+1,w,1,col(c));P(b,x+(w>>1),y-1,C[2]);rect(b,x+2,y+2,w-4,1,C[3]);},
    keys:(x,y,w,h,hi=[])=>{rect(b,x,y,w,h,C[0]);for(let i=3;i<w;i+=3)rect(b,x+i,y,1,h,C[3]);
      for(let i=2;i<w-2;i+=3)if((i/3|0)!==2)rect(b,x+i,y,2,h-3,C[3]);for(const k of hi)rect(b,x+k*3,y+h-3,3,3,C[2]);},
    heart:(x,y,c=2)=>d.st(['.cc.cc.','ccccccc','ccccccc','.ccccc.','..ccc..','...c...'].map(r=>r.replace(/c/g,typeof c==='number'?'wlmd'[c]:'m')),x,y),
    flame:(x,y)=>d.st(['...l...','...ll..','..lll.l','.llmmll','.lmmmml','.lmwwml','..mwwm.','...mm..'],x,y),
    bolt:(x,y,c='l')=>d.st(['..cc','.cc.','cccc','.cc.','cc..'].map(r=>r.replace(/c/g,c)),x,y),
    star:(x,y,c=1)=>{P(b,x,y,col(c));P(b,x+1,y,col(c));P(b,x-1,y,col(c));P(b,x,y+1,col(c));P(b,x,y-1,col(c));},
    dots:(list,c=1,s=1)=>{for(const [x,y] of list)rect(b,x,y,s,s,col(c));},
    digit:(ch,x,y,c=1)=>{const g=SYM[ch];if(!g)return;g.forEach((r,j)=>{for(let i=0;i<r.length;i++)if(r[i]==='#')P(b,x+i,y+j,col(c));});}
  };
  return d;
}
// символи 3×5 (цифри) та кілька 5×5-позначок — для акордів і октав
const SYM={
 '1':['.#.','##.','.#.','.#.','###'],'3':['###','..#','.##','..#','###'],'4':['#.#','#.#','###','..#','..#'],'5':['###','#..','###','..#','###'],
 '6':['###','#..','###','#.#','###'],'7':['###','..#','.#.','.#.','.#.'],'8':['###','#.#','###','#.#','###'],'9':['###','#.#','###','..#','###'],
 '→':['..#..','...#.','#####','...#.','..#..'],'↑':['..#..','.###.','#.#.#','..#..','..#..'],'↕':['..#..','.###.','..#..','.###.','..#..'],
 'III':['#.#.#','#.#.#','#.#.#','#.#.#','#.#.#'],'V':['#...#','#...#','.#.#.','.#.#.','..#..'],'I':['.###.','..#..','..#..','..#..','.###.'],
 '♮':['#....','#.##.','###..','.##.#','....#'],'♭':['#....','#....','###..','#..#.','###..'],'♯':['.#.#.','#####','.#.#.','#####','.#.#.']
};

// ---------- позначки форми атаки 6×6: a — світлий, c — основний, b — біле ядро ----------
const BADGE={
  cone:['....aa','..aaaa','bbaaac','bbaaac','..aaaa','....aa'],
  ring:['.aaaa.','a....a','a.bb.a','a.bb.a','a....a','.aaaa.'],
  shot:['...a..','...aa.','aaaaaa','bbbbbb','...aa.','...a..'],
  zap:['...aa.','..aa..','.aaaa.','...aa.','..aa..','.aa...'],
  homing:['.aaa..','a...a.','a..aaa','....a.','...a..','......'],
  boomerang:['aa....','aaa...','.aaa..','..aaa.','.aaa..','aa.aa.'],
  thread:['a.....','.a..a.','..aa..','..aa..','.a..a.','a.....'],
  beam:['......','aaaaaa','bbbbbb','bbbbbb','aaaaaa','......'],
  bellows:['a.a.a.','a.a.a.','aaaaaa','aaaaaa','a.a.a.','a.a.a.'],
  noteRing:['.aaa..','a...a.','a.b.a.','a.bba.','.aaabb','....b.'],
  orbit:['..aaa.','.a...a','a.bb.a','a.bb.a','.a...a','..aaa.'],
  feather:['....aa','...aaa','..aaa.','.aaa..','aa....','a.....'],
  twister:['aaaaaa','.aaaa.','..aaa.','..aa..','...a..','...a..'],
  gust:['.aaaa.','a....a','.aaa.a','.....a','aaaaa.','......'],
  blast:['a.a.a.','.aaa.a','aabaa.','.aaa.a','a.a.a.','......'],
  fireball:['..a...','.aaa.a','aabaaa','aabaa.','.aaa..','..a...'],
  smokering:['.aa...','a..a.a','a..a..','.aa.a.','..a...','.a.a..'],
  bounce:['.a....','a.a..a','...a.a','....a.','.aaaa.','......'],
  puddle:['..a...','.aaa..','......','.aaaa.','aaaaaa','.aaaa.']
};
/* знак інструмента 6×6 у лівому нижньому куті: за ним видно, чия це партія, навіть у малій іконці HUD */
const PIP={
  guitar:['.....r','....r.','..lr..','.lml..','.mmm..','..m...'],drums:['r....r','.r..r.','llllll','mmmmmm','mmmmmm','.dddd.'],
  bass:['.....r','....r.','...r..','..lm..','.lmm..','..m...'],piano:['llllll','lwlwll','lwlwll','lwwwwl','lwwwwl','llllll'],
  flute:['.....l','....lw','...lm.','..lm..','.lm...','lm....'],violin:['...r..','...r..','..lml.','...m..','..lml.','...d..'],
  sax:['.ll...','.m....','.m....','.m....','.mm.l.','..mml.'],accordion:['dllllm','l.lm.l','l.mm.l','l.lm.l','l.mm.l','dllllm']};
function pip(b,inst,C){rect(b,2,14,8,8,OUT);rect(b,3,15,6,6,mix(C[3],OUT,.45));pen(b,C).st(PIP[inst]||PIP.guitar,3,15);}
function badge(b,kind,C){const rows=BADGE[kind]||BADGE.ring;
  rect(b,14,14,8,8,OUT);rect(b,15,15,6,6,mix(C[3],OUT,.45));
  rows.forEach((r,j)=>{for(let i=0;i<6;i++){const ch=r[i];if(ch==='.')continue;P(b,15+i,15+j,ch==='a'?C[1]:ch==='b'?C[0]:C[2]);}});}

// ---------- символи партій. Малюються в буфері 20×17 (потім контур і перенесення в рамку); правий нижній кут x≥12,y≥12 зайнятий позначкою ----------
const strum=d=>{d.strings(0,1,19,4,3,'r');d.line(15,0,8,13,1);d.line(16,0,9,13,2);d.p(8,13,0);};
const ART={
 'guitar-strum':[strum,'cone'],
 'guitar-chuck':[d=>{d.strings(0,2,19,4,3,'r');d.line(4,0,14,11,1);d.line(14,0,4,11,1);d.line(5,0,15,11,2);d.line(15,0,5,11,2);d.p(9,5,0);},'cone'],
 'guitar-pick':[d=>{d.strings(0,3,19,3,4,'r');d.st(['.lllllll.','.lwmmmml.','..lmmmmd.','..lmmmd..','...lmmd..','....md...'],5,1);},'cone'],
 'guitar-lead':[d=>{d.note(3,13,1,false);d.note(11,7,1,true,6);d.dash(5,9,9,6,2);d.p(10,3,0);},'cone'],
 'guitar-harm':[d=>{d.st(['..l..','.l.l.','l...l','.l.l.','..l..'],1,7);d.st(['..l..','.l.l.','l...l','.l.l.','..l..'],8,3);d.line(6,9,6,4,1);d.line(13,5,13,0,1);d.burst(16,2,2);},'cone'],
 'guitar-thumb':[d=>{d.strings(0,2,19,3,3,'r');d.rect(0,10,19,2,2);d.rect(0,10,19,1,1);d.disc(9,11,3,0);d.disc(9,11,2,1);},'shot'],
 'guitar-dstop':[d=>{d.head(4,12,1);d.head(4,8,1);d.rect(6,1,1,11,1);d.p(7,1);d.p(8,2);d.p(8,3);d.line(1,14,3,12,'r');d.line(9,12,11,14,'r');},'cone'],
 'guitar-trem':[d=>{d.note(3,12,1,false,7);d.line(8,2,16,0,1);d.line(8,5,16,3,2);d.line(8,8,16,6,1);d.line(8,11,11,10,2);},'zap'],
 'guitar-garp':[d=>{[[1,12],[5,9],[9,6],[13,3]].forEach(([x,y])=>{d.rect(x,y,3,3,2);d.p(x,y,0);d.p(x+1,y,1);});d.arrow(0,3,5,0,1);},'ring'],
 'guitar-accent':[d=>{d.line(2,0,10,6,1);d.line(10,6,2,12,1);d.line(3,0,11,6,2);d.line(11,6,3,12,2);d.burst(15,3,2);d.rect(0,14,3,2,2);},'cone'],
 'drums-kick':[d=>{d.disc(8,7,7,3);d.disc(8,7,6,2);d.disc(8,7,4,3);d.disc(8,7,2,1);d.p(8,7,0);d.line(8,14,4,16,'r');d.rect(2,16,3,1,1);},'ring'],
 'drums-snare':[d=>{d.drum(2,6,14,5);d.line(2,10,16,10,3);d.line(1,0,7,5,'r');d.line(17,0,11,5,'r');d.p(1,0,0);d.p(17,0,0);},'ring'],
 'drums-hat':[d=>{d.cym(2,3,13);d.cym(2,6,13);d.line(8,9,8,16,3);d.rect(5,16,7,1,2);},'zap'],
 'drums-crash':[d=>{d.cym(1,6,15,1);d.line(8,9,8,16,3);d.burst(8,2,2);d.burst(1,3,1);d.burst(15,3,1);},'ring'],
 'drums-fill':[d=>{d.drum(0,7,6,4);d.drum(6,4,7,5);d.drum(13,8,6,4);d.dash(1,2,16,1,1);d.dash(3,0,13,0,2);},'ring'],
 'drums-rim':[d=>{d.drum(1,6,15,5);d.rect(1,6,15,1,0);d.line(2,0,8,5,'r');d.burst(15,3,2);d.p(0,5,1);},'zap'],
 'drums-toms':[d=>{d.drum(0,2,9,5);d.drum(8,5,9,6);d.line(3,10,3,15,3);d.line(12,13,12,16,3);},'shot'],
 'drums-ride':[d=>{d.cym(0,4,18,1);d.rect(8,3,3,1,0);d.line(9,7,9,16,3);d.dots([[2,10],[5,12],[13,10],[16,12]],2,2);},'ring'],
 'drums-ghost':[d=>{d.line(2,3,1,6,1);d.line(1,6,2,9,1);d.line(15,3,16,6,1);d.line(16,6,15,9,1);d.note(6,9,1,false,6);d.drum(3,12,10,2);},'shot'],
 'drums-flam':[d=>{d.note(2,8,2,false,4);d.note(9,11,1,false,8);d.line(3,13,8,13,3);d.burst(14,3,2);},'ring'],
 'bass-root':[d=>{d.rect(0,11,19,3,2);d.rect(0,11,19,1,1);d.note(7,8,1,false,7);d.wave(1,16,17,1,2,4);},'shot'],
 'bass-walk':[d=>{[[1,13],[5,10],[9,7],[13,4]].forEach(([x,y])=>d.note(x,y,1,false,4));d.dash(2,2,16,0,2);},'shot'],
 'bass-octave':[d=>{d.note(2,13,1,false,5);d.note(9,6,1,false,5);d.digit('8',14,0,2);d.line(1,10,1,3,3);d.line(1,3,4,3,3);},'shot'],
 'bass-groove':[d=>{d.wave(0,6,19,4,1,9);d.wave(0,7,19,4,2,9);d.dots([[3,13],[8,13],[13,12]],1,2);},'shot'],
 'bass-slap':[d=>{d.rect(0,12,19,2,2);d.st(['..ll','.l..','l...','l...','ll..','.lm.'],3,2);d.burst(11,10,3);},'cone'],
 'bass-pedal':[d=>{d.rect(0,11,19,2,2);d.dots([[1,6],[5,6],[9,6],[13,6]],1,3);d.dash(0,2,18,2,'r');},'ring'],
 'bass-fifths':[d=>{d.head(3,12,1);d.head(3,6,1);d.rect(5,0,1,12,1);d.digit('5',10,3,1);},'shot'],
 'bass-approach':[d=>{d.st(['.........lll','......lll...','...lll......','lll.........'].map(r=>r.slice(0,12)),0,8);d.ring(14,3,3,1);d.p(14,3,0);d.arrow(8,8,11,5,2);},'shot'],
 'bass-drone':[d=>{d.disc(4,8,3,2);d.disc(4,8,2,1);d.rect(8,7,11,3,2);d.rect(8,7,11,1,1);d.wave(8,13,11,1,2,4);},'shot'],
 'bass-sync':[d=>{d.note(6,10,1,false,6);d.line(1,14,3,16,2);d.line(3,16,10,16,2);d.rect(1,1,3,1,2);d.rect(12,1,3,1,2);d.rect(6,1,3,1,1);},'zap'],
 'piano-chords':[d=>{d.head(4,12,1);d.head(4,8,1);d.head(4,4,1);d.rect(6,0,1,12,1);d.line(9,3,12,2,2);d.line(9,6,12,6,2);},'homing'],
 'piano-mel':[d=>{d.wave(0,7,19,4,2,12);d.note(3,10,1,false,5);d.note(10,5,1,false,5);},'homing'],
 'piano-arp':[d=>{[[0,13],[4,10],[8,7],[12,4],[16,2]].forEach(([x,y])=>d.rect(x,y,2,2,1));d.dash(1,15,17,1,3);},'homing'],
 'piano-left':[d=>{d.keys(0,2,19,12,[0,1]);d.rect(1,15,6,1,2);},'ring'],
 'piano-stab':[d=>{d.head(2,10,1);d.head(2,6,1);d.rect(4,0,1,10,1);d.p(3,14,2);d.burst(12,4,3);},'cone'],
 'piano-bell':[d=>{d.st(['...ll...','..lwlm..','..lmlm..','.llmmmd.','.lmmmmmd','llllllll'],4,2);d.p(8,9,2);d.p(7,9,2);d.burst(2,2,1);d.burst(16,2,1);},'zap'],
 'piano-run':[d=>{[[1,13],[4,11],[7,9],[10,7],[13,5],[16,3]].forEach(([x,y])=>d.rect(x,y,2,2,1));d.rect(0,2,6,1,2);d.rect(2,5,4,1,2);},'homing'],
 'piano-loct':[d=>{d.keys(0,5,19,10,[0,5]);d.line(1,16,1,17,3);d.digit('8',7,-1,1);},'shot'],
 'piano-pad':[d=>{d.st(['..lllll....','.lwmmmml.l.','lwmmmmmmll.','lmmmmmmmmml','.lddddddd..'],1,1);d.line(2,10,15,10,2);d.line(5,13,9,13,1);},'ring'],
 'piano-trill':[d=>{d.st(['.##','###','.#.','.#.','.#.','##.'].map(r=>r.replace(/#/g,'l')),0,0);d.wave(5,3,14,2,1,3);d.head(3,13,1);d.rect(5,8,1,5,1);},'cone'],
 /* додаткові партії гітари/баса для стартових замін (art посилаються на ці ж) */
 'flute-melody':[d=>{d.arrow(1,11,9,3,1);d.note(6,12,1,true,6);d.line(2,14,10,14,3);d.wave(10,5,8,1,2,4);},'boomerang'],
 'flute-flutter':[d=>{d.wave(0,3,14,2,1,5);d.wave(0,7,14,2,2,5);d.wave(0,11,14,2,1,5);d.p(17,7,0);},'gust'],
 'flute-spiral':[d=>{d.ring(8,7,6,3);d.disc(8,7,2,0);d.disc(8,7,1,1);d.rect(7,0,3,2,1);d.rect(13,9,3,2,1);d.rect(1,9,3,2,2);},'orbit'],
 'flute-call':[d=>{d.note(1,12,1,true,7);d.arrow(7,6,16,6,2);d.arrow(16,9,7,9,1);d.dash(7,3,14,3,3);},'boomerang'],
 'flute-trill':[d=>{d.note(1,12,1,false,5);d.note(7,12,2,false,5);d.wave(0,2,18,1,1,2);d.ring(14,6,2,1);},'orbit'],
 'flute-stacc':[d=>{d.st(['....ll','...lll','..lll.','.lll..','lmm...','ml....'],3,1);d.dots([[1,13],[5,14],[9,15]],1,2);d.p(12,2,0);},'feather'],
 'flute-legato':[d=>{d.note(1,12,1,false,5);d.note(11,9,1,false,5);d.st(['.lllllll.','l.......l'],3,2);d.line(4,13,10,10,2);},'boomerang'],
 'flute-scale':[d=>{d.rect(0,14,19,1,3);[[1,12],[4,10],[7,8],[10,6],[13,4]].forEach(([x,y])=>d.rect(x,y,2,2,1));d.wave(0,1,12,1,2,6);},'twister'],
 'flute-high':[d=>{d.note(2,12,1,true,5);d.arrow(10,12,10,1,1);d.wave(13,3,6,1,2,3);d.dash(5,15,14,15,3);},'boomerang'],
 'flute-duet':[d=>{d.st(['...ll','..lll','.lll.','lm...'],0,5);d.st(['...ll','..lll','.lll.','lm...'],6,0);d.st(['..lm','.lmm','lmm.','m...'],5,9);d.p(11,6,0);},'feather'],
 'violin-bow':[d=>{d.line(1,13,16,2,'r');d.disc(1,13,1,1);d.disc(16,2,1,1);d.line(0,15,15,4,2);d.p(8,8,0);d.rect(2,14,4,1,3);},'thread'],
 'violin-pizz':[d=>{d.line(1,6,17,6,'r');d.line(6,6,8,2,1);d.line(8,2,10,6,1);d.line(11,6,12,10,2);d.disc(12,11,1,1);},'shot'],
 'violin-web':[d=>{d.line(9,1,1,13,1);d.line(9,1,9,14,1);d.line(9,1,17,13,1);d.line(3,8,15,8,2);d.line(5,5,13,5,2);d.p(9,1,0);},'zap'],
 'violin-harmonics':[d=>{d.line(0,10,18,5,'r');d.burst(9,7,2);d.dots([[3,2],[14,12]],1,1);d.rect(1,13,6,1,3);},'beam'],
 'violin-tremolo':[d=>{d.line(2,2,2,14,2);d.line(5,2,5,14,2);d.line(8,2,8,14,2);d.line(11,2,11,14,1);d.wave(0,8,10,3,1,3);},'zap'],
 'violin-spicc':[d=>{d.dots([[1,12],[4,8],[7,12],[10,8]],1,2);d.line(0,15,10,15,3);d.arrow(2,5,12,3,2);},'shot'],
 'violin-double':[d=>{d.line(1,13,9,2,1);d.line(1,13,16,6,1);d.line(3,14,10,3,2);d.disc(1,13,1,0);d.p(9,2,0);d.p(16,6,0);},'thread'],
 'violin-gliss':[d=>{d.arrow(1,14,15,1,1);d.dots([[2,9],[6,10],[9,6]],2,1);d.wave(4,13,6,1,2,3);},'homing'],
 'violin-col':[d=>{d.strings(0,3,19,4,3,'r');d.line(4,0,15,13,1);d.line(5,0,16,13,2);d.burst(2,13,1);},'cone'],
 'violin-sing':[d=>{d.st(['.lll.','l...l','l.l..','l.ll.','.lll.'],6,1);d.wave(0,13,12,1,1,4);d.note(1,9,2,false,6);},'noteRing'],
 'sax-breath':[d=>{d.rect(0,5,12,4,2);d.rect(0,5,12,1,1);d.rect(0,8,12,1,3);d.rect(2,6,8,1,0);d.line(13,3,18,1,1);d.line(13,10,18,12,1);},'beam'],
 'sax-stab':[d=>{d.st(['.mm.','mmmm','.mm.'],1,1);d.burst(9,6,4);d.dash(2,14,9,14,2);},'blast'],
 'sax-growl':[d=>{d.rect(0,3,4,9,2);d.wave(4,4,15,2,1,5);d.wave(4,8,15,2,2,5);d.wave(4,12,10,2,1,5);},'beam'],
 'sax-fanfare':[d=>{d.disc(2,10,2,2);d.disc(7,6,2,2);d.disc(12,2,2,2);d.disc(2,10,1,1);d.disc(7,6,1,1);d.disc(12,2,1,1);d.rect(0,14,8,1,3);d.p(16,8,1);d.p(16,9,2);},'fireball'],
 'sax-riff':[d=>{d.line(1,12,5,6,1);d.line(5,6,9,12,1);d.line(9,12,13,4,2);d.disc(14,3,2,1);d.p(14,3,0);},'fireball'],
 'sax-subtone':[d=>{d.disc(5,8,3,3);d.disc(5,8,2,2);d.ring(11,6,2,1);d.ring(14,5,3,2);d.rect(0,14,10,1,3);},'smokering'],
 'sax-growline':[d=>{d.disc(2,12,2,2);d.disc(8,5,2,2);d.disc(14,10,2,2);d.dash(3,10,7,7,1);d.dash(9,6,13,9,1);d.p(8,5,0);},'bounce'],
 'sax-falloff':[d=>{d.note(1,3,1,true,2);d.arrow(7,3,12,12,2);d.st(['..l..','.lml.','lmmml'],8,13);},'puddle'],
 'sax-tongue':[d=>{d.st(['.ll.','llll','.ll.'],0,2);d.line(5,5,8,1,1);d.line(5,6,10,9,1);d.burst(10,5,3);},'blast'],
 'sax-improv':[d=>{d.note(1,12,1,false,6);d.note(8,8,2,false,6);d.note(14,3,1,false,2);d.arrow(2,15,16,14,3);d.p(4,2,0);d.p(5,2,1);},'bounce'],
 'accordion-bellows':[d=>{d.rect(0,2,3,12,2);d.rect(16,2,3,12,2);for(let x=4;x<16;x+=3){d.rect(x,3,1,10,1);d.rect(x+1,4,1,8,3);}d.rect(3,2,13,1,3);},'bellows'],
 'accordion-chords':[d=>{d.rect(0,2,4,12,2);[3,6,9].forEach(y=>d.rect(1,y,2,2,0));d.head(8,12,1);d.head(8,8,1);d.head(8,4,1);d.rect(10,0,1,12,1);},'ring'],
 'accordion-bass':[d=>{d.rect(0,1,5,14,3);d.disc(2,4,1,1);d.disc(2,8,1,1);d.disc(2,12,1,1);d.rect(6,9,11,3,2);d.rect(6,9,11,1,1);d.arrow(8,6,15,6,2);},'ring'],
 'accordion-dance':[d=>{d.st(['..mm.mm..','.mwm.mwm.','.mmmmmmm.','mmmmmmmmm','m.m...m.m','l.l...l.l'],1,2);d.note(13,10,1,false,3);d.p(2,1,0);},'noteRing'],
 'accordion-oompah':[d=>{d.rect(0,8,6,6,2);d.rect(0,8,6,1,1);d.rect(9,3,3,3,1);d.rect(14,3,3,3,1);d.rect(9,9,3,2,3);d.rect(14,9,3,2,3);d.dash(0,1,17,1,3);},'ring'],
 'accordion-right':[d=>{d.rect(0,1,6,13,3);d.dots([[2,3],[2,7],[2,11]],1,2);d.note(9,11,1,true,6);d.arrow(10,2,17,2,2);},'shot'],
 'accordion-under':[d=>{d.rect(0,1,6,13,3);d.dots([[2,3],[2,7],[2,11]],1,2);d.note(9,6,2,false,4);d.arrow(10,14,17,14,1);d.rect(8,10,9,1,3);},'shot'],
 'accordion-gliss':[d=>{d.rect(0,2,4,12,3);[[6,12],[8,9],[10,6],[12,3]].forEach(([x,y])=>d.rect(x,y,2,2,1));d.arrow(5,13,14,1,2);},'zap'],
 'accordion-trem':[d=>{d.rect(0,2,3,12,2);d.rect(16,2,3,12,2);d.line(4,3,4,13,1);d.line(7,3,7,13,2);d.line(10,3,10,13,1);d.line(13,3,13,13,2);d.wave(3,0,13,1,1,2);},'bellows']
};
// гітарна «Щипок»: підміна/варіації стартових партій додаються нижче
ART['guitar-pinch']=[d=>{ART['guitar-thumb'][0](d);d.line(12,0,16,0,1);d.line(14,2,18,2,1);d.p(16,4,0);},'shot'];

// ---------- символи пасивів: малюються у квадраті 14×14 (рамка типу дає контур і фон) ----------
const GEAR_ART={
 drive:d=>d.flame(3,2),
 overdrive:d=>{d.st(['..mmmm..','.mwllmm.','.mwllmm.','.mllllm.','.mllllm.','.mmmmmm.','..d..d..','..d..d..'],3,2);},
 delay:d=>{d.ring(3,7,3,1);d.ring(7,7,3,2);d.dash(11,7,13,7,2);d.disc(11,7,1,3);},
 chorus:d=>{d.wave(1,4,12,2,1,6);d.wave(1,8,12,2,2,6);d.wave(1,11,12,1,3,6);},
 wah:d=>{d.st(['....ll','...lml','..lmmd','.lmmd.','lmmd..','ddd...'],2,4);d.bolt(6,1);},
 pick:d=>d.st(['.lllllll.','.lwmmmml.','..lmmmmd.','..lmmmd..','...lmmd..','....md...'],2,3),
 roadie:d=>{d.heart(3,2);d.rect(6,10,1,4,0);d.rect(4,11,5,1,0);},
 sharpStrings:d=>{[2,5,8,11].forEach(x=>d.rect(x,2,1,10,'r'));d.burst(7,7,3,0,1);},
 sparks:d=>{d.burst(5,8,4);d.burst(10,3,2);d.p(11,9,2);d.p(8,12,2);},
 fuzzHit:d=>{d.wave(0,4,14,3,1,5);d.burst(7,10,2);},
 sticks:d=>{d.line(2,12,10,3,'r');d.line(12,12,4,3,'r');d.disc(10,3,1,1);d.disc(4,3,1,1);},
 double:d=>{d.disc(4,5,2,2);d.disc(10,5,2,2);d.line(4,8,3,12,1);d.line(10,8,11,12,1);d.rect(1,12,12,1,2);},
 shells:d=>d.drum(2,2,10,8),
 rim:d=>{d.ring(7,7,5,2);d.ring(7,7,4,1);d.burst(11,3,2);},
 bronze:d=>{d.cym(1,5,12,1);d.burst(7,1,2);d.line(7,8,7,13,3);},
 crew:d=>{d.line(3,12,9,6,1);d.ring(10,4,3,2);d.p(11,3,3);d.p(12,2,3);},
 comp:d=>{d.arrow(0,7,5,7,1);d.arrow(13,7,8,7,1);d.rect(6,3,2,8,2);},
 octave:d=>{d.note(1,10,1,false,5);d.note(7,5,2,false,4);d.digit('8',10,8,1);},
 slides:d=>{d.rect(1,10,12,1,3);d.rect(1,6,12,1,3);d.arrow(2,12,12,3,1);},
 sub:d=>{d.rect(2,1,10,12,3);d.disc(7,8,3,2);d.disc(7,8,1,0);d.disc(7,3,1,1);},
 magnet:d=>d.st(['llllllll.','lm....ml','lm....ml','lm....ml','lm....ml','ld....dl','rr....rr'].map(r=>r.slice(0,8)),3,3),
 sustain:d=>{d.st(['.lll...lll.','l...l.l...l','.lll...lll.'],1,5);d.p(6,7,0);},
 arp:d=>{d.st(['..........l','.......lll.','....lll....','.lll.......'],1,4);d.disc(11,3,1,0);},
 reverb:d=>{d.ring(7,10,2,1);d.ring(7,10,4,2);d.ring(7,10,6,3);d.p(7,10,0);},
 ensemble:d=>{d.ring(5,5,3,1);d.ring(9,5,3,2);d.ring(7,9,3,1);},
 hammers:d=>{d.rect(2,1,8,4,2);d.rect(2,1,8,1,1);d.rect(5,5,2,8,'r');d.p(5,12,3);},
 familiar:d=>{d.note(3,10,1,true,7);d.p(3,10,'k');d.p(4,10,'k');d.p(8,4,0);d.p(9,3,1);},
 homingPlus:d=>{d.note(1,11,1,true,6);d.arrow(6,9,13,2,2);},
 split:d=>{d.disc(3,7,2,1);d.arrow(5,7,12,2,2);d.arrow(5,7,12,12,2);},
 crit:d=>{d.keys(0,4,9,8,[1]);d.burst(11,3,2);},
 slow:d=>{d.note(2,11,1,true,6);d.ring(9,9,3,2);d.ring(9,9,5,3);},
 wind:d=>{d.wave(0,4,13,2,1,5);d.wave(2,9,11,2,2,5);},
 feather:d=>d.st(['.......ll','.....llll','...lllll.','..llmml..','.lmmm....','lmm......','l........'],2,3),
 return:d=>{d.st(['.lllll.','l.....l','l.....l','......l','..l...l','..ll.l.','..lll..'],2,2);d.arrow(5,11,3,9,2);},
 nest:d=>{d.st(['..mm..','.mwwm.','.mmmm.'],5,2);d.st(['lmmmmmml','.lmmmml.','..ldddl.'],3,7);d.heart(1,10,1);},
 resin:d=>{d.st(['..lllll.','.lwmmml.','lmmmmmd.','.lmmmd..','..ddd...'],2,4);d.burst(10,4,2);},
 bridge:d=>{d.st(['l.......l','ll.lll.ll','lmlllllml','lmm...mml'],2,3);d.rect(2,8,10,1,0);},
 silk:d=>{[0,1,2,3].forEach(i=>d.line(1,2+i*3,13,11-i*3,i%2?1:2));},
 keeper:d=>{d.heart(1,2,1);d.line(3,12,12,3,'r');d.disc(12,3,1,0);},
 mouthpiece:d=>{d.st(['....lll','..llmmd','.lmmmd.','lmmd...','lmd....'],2,3);d.rect(3,9,4,1,0);d.line(2,10,9,5,2);},
 bell:d=>d.st(['...ll...','...mm...','..lmml..','..lmmd..','.lmmmmd.','.lmmmmd.','lmmmmmmd','dddddddd'],3,2),
 pressure:d=>{d.ring(7,7,5,1);d.line(7,7,10,4,0);d.line(7,7,10,5,1);d.dots([[7,1],[7,12],[1,7],[12,7]],2,1);},
 harness:d=>{d.line(2,1,6,6,2);d.line(11,1,7,6,2);d.rect(4,7,6,5,1);d.rect(4,7,6,1,0);d.rect(6,9,2,2,3);},
 heat:d=>{d.flame(3,4);d.burst(7,1,1);},
 subtone:d=>{d.note(1,10,1,false,5);d.wave(5,9,9,2,2,4);},
 folds:d=>{for(let i=0;i<5;i++){d.rect(1+i*2,2+i%2,1,9,i%2?1:3);d.rect(2+i*2,3,1,8,2);}},
 reeds:d=>{[0,1,2].forEach(i=>{d.rect(2+i*4,2+i,3,9-i,2);d.rect(2+i*4,2+i,1,9-i,1);d.rect(3+i*4,4+i,1,4,3);});},
 strap:d=>{d.line(2,1,2,10,2);d.line(2,10,11,10,2);d.line(11,10,11,1,2);d.rect(5,6,4,3,1);d.rect(5,6,4,1,0);},
 tuner:d=>{d.rect(1,2,12,10,3);d.rect(1,2,12,1,1);d.line(7,5,7,10,0);d.line(4,8,10,8,2);d.p(11,4,1);},
 tongue:d=>{d.st(['.lllll.','l.....l','.....ll','..lll.l','..l..l.','...ll..'],3,3);d.disc(10,10,1,1);},
 poison:d=>{d.disc(3,4,2,2);d.disc(9,4,2,2);d.disc(6,8,2,3);d.p(3,3,0);d.p(9,3,0);d.wave(2,12,10,1,1,5);},
 heavy:d=>{d.rect(1,2,12,10,2);d.rect(1,2,12,1,1);d.rect(1,11,12,1,3);d.line(3,5,5,9,0);d.line(5,9,7,5,0);d.line(7,5,9,9,0);d.line(9,9,11,5,0);},
 musette:d=>{d.wave(0,4,13,2,1,3);d.wave(0,8,13,2,2,3);d.wave(0,12,13,1,1,3);},
 bandoneon:d=>{d.rect(1,1,3,12,3);d.rect(10,1,3,12,3);for(let x=4;x<10;x+=2)d.rect(x,2,1,10,x%4?1:2);d.p(2,5,0);d.p(11,8,0);},
 piccolo:d=>{d.note(2,10,1,true,6);d.arrow(10,12,10,1,2);},
 cassotto:d=>d.st(['..mmmmmm..','.mwlllllm.','mwlllllllm','mllllllllm','mllllllllm','mmddddddmm','..........'].map(r=>r.slice(0,10)),2,3),
 shake:d=>{d.line(2,2,4,5,1);d.line(4,5,2,8,1);d.line(2,8,4,11,1);d.line(11,2,9,5,1);d.line(9,5,11,8,1);d.line(11,8,9,11,1);d.disc(7,7,2,0);},
 vibrato:d=>{d.wave(0,6,14,3,1,4);d.note(5,12,2,false,3);},
 breath:d=>{d.wave(0,4,13,2,1,5);d.wave(1,8,12,1,2,5);d.ring(11,11,1,1);},
 echo:d=>{d.ring(4,7,3,1);d.ring(8,7,3,2);d.ring(12,7,2,3);},
 flutter:d=>{d.wave(0,3,14,1,1,3);d.wave(0,7,14,2,2,3);d.wave(0,11,14,3,1,3);},
 sharp:d=>{d.burst(7,7,5);d.arrow(1,13,6,9,2);},
 tension:d=>{d.line(1,12,13,3,1);d.line(1,13,13,4,2);d.burst(11,10,2);},
 mute:d=>d.st(['..llll..','.lmmmml.','.lmmmmd.','..lmmd..','..lmmd..','.lmmmmd.','.dddddd.'],3,3),
 hall:d=>{[0,1,2].forEach(i=>d.st(['lllllll'.slice(0,7-i*2)],1+i,2+i*3));d.line(1,13,13,13,3);},
 alto:d=>{d.note(2,7,1,true,4);d.note(8,12,2,true,4);d.arrow(11,1,11,5,1);},
 orchestra:d=>{[3,7,11].forEach((x,i)=>d.note(x-2,10-(i%2)*4,1,false,4));d.wave(0,13,14,1,2,6);},
 stun:d=>{d.burst(7,7,5);d.disc(7,7,1,0);},
 wave:d=>{d.ring(7,7,2,0);d.ring(7,7,4,1);d.ring(7,7,6,2);},
 room:d=>{d.st(['...lll...','.ll...ll.','l.......l'],2,6);d.st(['..l...l..','.l.....l.'].map(r=>r.slice(0,9)),2,9);},
 beatCrit:d=>{d.drum(1,5,8,5);d.burst(11,3,2);},
 heavyLow:d=>{d.wave(0,4,14,3,2,7);d.arrow(7,6,7,13,1);},
 subHit:d=>{d.disc(7,7,5,3);d.disc(7,7,3,2);d.disc(7,7,1,0);d.burst(7,7,6,3,3);},
 pierce:d=>{d.arrow(0,7,13,7,1);d.ring(4,7,3,2);d.ring(9,7,3,2);},
 vibration:d=>{d.wave(0,4,14,2,1,3);d.wave(0,10,14,2,2,3);}
};
// «поступалка» для невідомого ключа: візерунок із хешу, щоб іконка завжди була й різнилася
function hashRows(key){let h=7;for(const ch of String(key))h=(h*31+ch.charCodeAt(0))>>>0;const rows=[];for(let y=0;y<6;y++){let r='';for(let x=0;x<3;x++){h=(h*1103515245+12345)>>>0;r+=(h>>>16)&1?'m':'.';}rows.push(r+r.split('').reverse().join(''));}return rows;}
const fallbackGlyph=key=>d=>{d.st(hashRows(key),4,4);d.rect(2,12,10,1,3);};

// ---------- рамки ----------
function framePart(C,bgOverride){
  const f=mk(),bg=bgOverride||mix(C[3],OUT,.58);
  rect(f,0,0,N,N,OUT);rect(f,1,1,N-2,N-2,C[3]);rect(f,2,2,N-4,N-4,bg);rect(f,2,2,N-4,1,mix(bg,C[1],.22));rect(f,2,3,1,N-6,mix(bg,C[1],.12));
  for(const [x,y] of [[0,0],[N-1,0],[0,N-1],[N-1,N-1]])f[y*N+x]=0;
  for(const [x,y] of [[1,1],[N-2,1],[1,N-2],[N-2,N-2]])f[y*N+x]=OUT;
  return f;}
// рамки пасивів: педаль / спорядження / помічник / модуль. Повертає {buf, ox, oy} — де ставити символ 14×14
function frameGear(type,C){
  const f=mk(),bg=mix(STEEL[3],OUT,.55);
  if(type==='педаль'){ /* педаль-«коробочка»: два вертушки зверху, перемикач знизу */
    rect(f,4,0,16,N,OUT);rect(f,5,1,14,N-2,STEEL[3]);rect(f,6,2,12,N-4,bg);rect(f,6,2,12,1,mix(bg,STEEL[1],.25));
    for(const x of [7,16]){rect(f,x,3,2,2,STEEL[1]);}
    rect(f,9,19,6,3,OUT);rect(f,10,19,4,2,STEEL[2]);rect(f,10,19,4,1,STEEL[0]);
    for(const [x,y] of [[4,0],[19,0],[4,23],[19,23]])f[y*N+x]=0;return {buf:f,ox:5,oy:4,sc:0};}
  if(type==='помічник'){ /* круглий жетон */
    const cx=11.5,cy=11.5;for(let y=0;y<N;y++)for(let x=0;x<N;x++){const r=Math.hypot(x-cx,y-cy);if(r<=11.7)f[y*N+x]=OUT;if(r<=10.7)f[y*N+x]=STEEL[3];if(r<=9.7)f[y*N+x]=bg;if(r<=9.7&&y<=7&&r>8.4)f[y*N+x]=mix(bg,STEEL[1],.25);}
    return {buf:f,ox:5,oy:5};}
  if(type==='модуль'){ /* плата з гвинтами */
    rect(f,0,3,N,18,OUT);rect(f,1,4,N-2,16,STEEL[3]);rect(f,2,5,N-4,14,bg);rect(f,2,5,N-4,1,mix(bg,STEEL[1],.25));
    for(const [x,y] of [[3,6],[19,6],[3,17],[19,17]]){f[y*N+x]=STEEL[1];}
    for(const [x,y] of [[0,3],[N-1,3],[0,20],[N-1,20]])f[y*N+x]=0;return {buf:f,ox:5,oy:5,sh:1};}
  // спорядження: восьмикутний щит
  rect(f,0,3,N,18,OUT);rect(f,3,0,18,N,OUT);rect(f,1,2,N-2,20,OUT);rect(f,2,1,N-4,22,OUT);
  rect(f,1,4,N-2,16,STEEL[3]);rect(f,4,1,16,22,STEEL[3]);rect(f,2,3,20,18,STEEL[3]);rect(f,3,2,18,20,STEEL[3]);
  rect(f,2,4,20,16,bg);rect(f,4,2,16,20,bg);rect(f,3,3,18,18,bg);rect(f,4,2,16,1,mix(bg,STEEL[1],.25));
  return {buf:f,ox:5,oy:5};}

// ---------- збирання ----------
const cache=new Map();
const hasPart=(inst,id)=>!!ART[inst+'-'+id];
function partGlyph(inst,id){const a=ART[inst+'-'+id];return a?a:[fallbackGlyph(inst+id),'ring'];}
function partLayers(inst,id,opts={}){
  const key='p|'+inst+'|'+id+'|'+(opts.starter?1:0)+'|'+(opts.art||'');
  if(cache.has(key))return cache.get(key);
  const C=INSTC[inst]||INSTC.guitar,[fn,kind]=partGlyph(inst,opts.art||id),b=framePart(C);
  const g=mk(20,17);fn(pen(g,C));
  blit(b,outline(g),2,2);
  if(opts.starter)for(let i=0;i<4;i++){rect(b,11,15+i*2,2,1,OUT);rect(b,11,i?15+i*2:15,2,1,i?C[1]:C[0]);}
  badge(b,opts.kind||kind,C);
  const pp=mk();pip(pp,inst,C);const out={base:b,pip:pp};
  const all=b.slice();all.w=N;all.h=N;blit(all,pp,0,0);out.all=all;
  cache.set(key,out);return out;
}
const partPixels=(inst,id,opts)=>partLayers(inst,id,opts).all;
function gearKey(pd){return pd.inst==='bass'&&pd.key==='roadie'?'magnet':pd.key;}
function gearPixels(pd){
  const key='g|'+pd.inst+'|'+pd.key+'|'+pd.type;if(cache.has(key))return cache.get(key);
  const C=INSTC[pd.inst]||INSTC.guitar,fr=frameGear(pd.type,C),b=fr.buf;
  const g=mk(14,14);(GEAR_ART[gearKey(pd)]||fallbackGlyph(pd.inst+pd.key))(pen(g,C));
  blit(b,outline(g,mix(OUT,C[3],.0)),fr.ox-0,fr.oy);
  cache.set(key,b);return b;
}
// золота рамка для акордів, їх нюансів і ритмів ударних
function goldFrame(){const f=framePart(GOLD,mix(GOLD[3],OUT,.7));return f;}
function chordPixels(add){
  const key='c|'+(add?1:0);if(cache.has(key))return cache.get(key);
  const C=GOLD,b=goldFrame(),g=mk(20,17),d=pen(g,C);
  for(const y of [3,6,9,12])d.rect(0,y,19,1,3);
  d.head(4,12,1);d.head(4,8,1);d.head(4,4,1);d.rect(6,0,1,12,1);d.p(7,0,1);d.p(8,1,1);
  if(add){d.rect(13,10,5,1,0);d.rect(15,8,1,5,0);}else{d.st(['..l..','.lll.','l.l.l'],12,3);d.st(['l.l.l','.lll.','..l..'],12,9);}
  blit(b,outline(g),2,2);cache.set(key,b);return b;
}
const VMARK={sev:'7',sus:'4',add9:'9',close:'↕',octbass:'8',third:'3',fifth:'5',passing:'→',tonic:'1',thirds:'III',sixth:'6',fifths:'V',picardy:'♮',blue:'♭',power:'5',barre:'↑',chromatic:'♯',fifthbass:'V',tonicpedal:'I',cluster:'♭'};
function voicingPixels(id){
  const key='v|'+id;if(cache.has(key))return cache.get(key);
  const C=GOLD,b=goldFrame(),g=mk(20,17),d=pen(g,C);
  d.head(2,12,1);d.rect(4,3,1,9,1);d.p(5,3,1);d.p(6,4,1);d.p(6,5,1);
  const m=VMARK[id];if(m&&SYM[m]){const w=SYM[m][0].length;d.digit(m,9+((8-w)>>1),3,0);}else{const r=hashRows(id);d.st(r.map(s=>s.replace(/m/g,'w')),9,3);}
  d.rect(9,11,8,1,3);
  blit(b,outline(g),2,2);cache.set(key,b);return b;
}
// ритми ударних: золота рамка, символ фігури, смужка з чотирьох тактів (ті, куди фігура «дома», світяться)
const FIG_ART={
  crash:['drums-crash'],push:['drums-kick',d=>d.arrow(11,1,16,1,0)],open:['drums-hat',d=>{d.ring(15,2,2,0);}],bomb:['drums-kick',d=>d.burst(15,3,2)],
  fill:['drums-fill'],stop:['drums-flam',d=>d.rect(14,0,4,4,0)],sync:['drums-kick',d=>d.wave(10,1,8,1,0,4)],shuffle:['drums-snare',d=>d.dots([[13,1],[16,2]],0,2)]
};
function rhythmPixels(fig,icon,home){
  const key='r|'+fig+'|'+(home||[]).join('');if(cache.has(key))return cache.get(key);
  const b=goldFrame(),spec=FIG_ART[fig]||[ 'drums-'+(icon||'kick')],art=ART[spec[0]]||ART['drums-kick'],g=mk(20,17),d=pen(g,GOLD),dr=pen(g,INSTC.drums);
  art[0](dr);if(spec[1])spec[1](d);
  blit(b,outline(g),2,2);
  for(let i=0;i<4;i++){const on=(home||[]).includes(i);rect(b,3+i*4,19,3,3,OUT);rect(b,4+i*4,20,1,1,on?GOLD[0]:GOLD[3]);rect(b,3+i*4,19,3,1,0);rect(b,3+i*4,19,3,3,0);rect(b,3+i*4,19,3,3,on?GOLD[1]:GOLD[3]);rect(b,3+i*4,19,3,1,on?GOLD[0]:GOLD[2]);}
  rect(b,15,19,1,1,0);
  cache.set(key,b);return b;
}
function healPixels(){const key='h';if(cache.has(key))return cache.get(key);
  const C=LEAF,b=framePart(C,mix(C[3],OUT,.6)),g=mk(20,17),d=pen(g,C);
  d.st(['.mm..mm.','mwlmmlmm','mlllllmm','mllllllm','.mlllmm.','..mllm..','...mm...'].map(r=>r.replace(/./g,c=>c==='.'?'.':c)),5,2);d.rect(8,5,3,1,'r');d.rect(9,4,1,3,'r');
  d.rect(2,14,16,1,3);
  blit(b,outline(g),2,2);cache.set(key,b);return b;}

// ---------- SVG: по одному <path> на колір, горизонтальні відрізки пікселів ----------
function toSVG(b,extra){
  const runs=new Map();
  for(let y=0;y<b.h;y++){let x=0;while(x<b.w){const c=b[y*b.w+x];if(!c){x++;continue;}let e=x+1;while(e<b.w&&b[y*b.w+e]===c)e++;
    let a=runs.get(c);if(!a)runs.set(c,a=[]);a.push('M'+x+' '+y+'h'+(e-x)+'v1h-'+(e-x)+'z');x=e;}}
  let s='';for(const [c,a] of runs)s+=`<path fill="${c}" d="${a.join('')}"/>`;
  return `<svg class="px" viewBox="0 0 ${b.w} ${b.h}" width="${b.w}" height="${b.h}" shape-rendering="crispEdges" aria-hidden="true" focusable="false"${extra||''}>${s}</svg>`;
}
const api={
  N,INSTC,BADGE_KINDS:Object.keys(BADGE),
  has:(inst,id)=>hasPart(inst,id),hasGear:key=>!!GEAR_ART[key],
  // «пікселі» — для тестів і порівнянь: масив кольорів 24×24 (0 — порожньо)
  partPixels,gearPixels,chordPixels,voicingPixels,rhythmPixels,healPixels,
  partKind:(inst,id)=>(ART[inst+'-'+id]||[])[1],
  // додати/підмінити малюнок партії (старти копіюють символ партії, яку заміняють)
  alias(inst,id,from,starter){const a=ART[inst+'-'+from];if(a){ART[inst+'-'+id]=a;if(starter)STARTER_IDS.add(inst+'-'+id);}},
  part:(inst,id)=>{const l=partLayers(inst,id,{starter:STARTER_IDS.has(inst+'-'+id)});
    return toSVG(l.base).replace('</svg>','<g class="instrument-symbol">'+toSVG(l.pip).replace(/^<svg[^>]*>|<\/svg>$/g,'')+'</g></svg>');},
  gear:pd=>toSVG(gearPixels(pd)),
  chord:add=>toSVG(chordPixels(add)),
  voicing:id=>toSVG(voicingPixels(id)),
  rhythm:(fig,icon,home)=>toSVG(rhythmPixels(fig,icon,home)),
  heal:()=>toSVG(healPixels()),
  toSVG
};
const STARTER_IDS=new Set();
root.PixelIcons=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
