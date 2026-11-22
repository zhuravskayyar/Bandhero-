'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const PI=require('./pixel-icons.js');

/* Дані партій і пасивів беремо з тих самих джерел, що й гра: розширення інструментів + таблиці з game.html. */
const expansion=(()=>{const mod={};new Function('module',fs.readFileSync(__dirname+'/assets/expansion-instruments.js','utf8')+';module.exports={buildInstrumentExpansion}')(mod);
  const T=x=>x;return mod.exports.buildInstrumentExpansion({T,E:()=>({}),tones:()=>[60,64,67,72],up:()=>0,lv:()=>1,SONG:{}});})();
const html=fs.readFileSync(__dirname+'/game.html','utf8');
function idsFrom(head,tail,re){const seg=html.slice(html.indexOf(head),html.indexOf(tail)),out={};let cur;
  for(const line of seg.split('\n')){const h=line.match(/^  (\w+):\[$/);if(h){cur=h[1];out[cur]=[];continue;}const m=cur&&line.match(re);if(m)out[cur].push(m.slice(1));}return out;}
const baseLayers=idsFrom('const LAYERS={','const GEAR={',/^    \{id:'(\w+)'/);
const baseGear=idsFrom('const GEAR={','const PEDALS=',/^    \{key:'(\w+)'.*?type:'(\S+?)'/);
const LAYERS={},GEAR={};
for(const k in baseLayers)LAYERS[k]=baseLayers[k].map(a=>a[0]);
for(const k in expansion.layers)LAYERS[k]=expansion.layers[k].map(l=>l.id);
for(const k in baseGear)GEAR[k]=baseGear[k].map(([key,type])=>({inst:k,key,type}));
for(const k in expansion.gear)GEAR[k]=expansion.gear[k].map(p=>({inst:k,key:p.key,type:p.type}));
const CHARS=['guitar','drums','bass','piano','flute','violin','sax','accordion'];
const sig=b=>b.join(',');

test('every layer of all 8 characters has a pixel icon',()=>{
  assert.deepEqual(Object.keys(LAYERS).sort(),[...CHARS].sort());
  for(const inst of CHARS){assert.ok(LAYERS[inst].length>=9,inst+' has its layers');
    for(const id of LAYERS[inst]){assert.ok(PI.has(inst,id),inst+'-'+id+' has a drawing');
      const svg=PI.part(inst,id);assert.match(svg,/^<svg /);assert.ok(svg.includes('<path'),inst+'-'+id+' draws pixels');}}
});
test('every pedal / gear item has a pixel icon of its own type',()=>{
  for(const inst of CHARS){assert.ok(GEAR[inst].length>=10);
    for(const p of GEAR[inst]){assert.ok(PI.hasGear(p.inst==='bass'&&p.key==='roadie'?'magnet':p.key),inst+'_'+p.key+' has a drawing');
      assert.ok(PI.gear(p).includes('<path'));}}
});
test('icons inside one character are all different (compared by pixel data)',()=>{
  for(const inst of CHARS){
    const parts=new Map();for(const id of LAYERS[inst]){const s=sig(PI.partPixels(inst,id));assert.ok(!parts.has(s),`${inst}-${id} equals ${parts.get(s)}`);parts.set(s,id);}
    const gear=new Map();for(const p of GEAR[inst]){const s=sig(PI.gearPixels(p));assert.ok(!gear.has(s),`${inst}_${p.key} equals ${gear.get(s)}`);gear.set(s,p.key);}
  }
});
test('output is a pure pixel grid: integer rects, no curves, no blur',()=>{
  const samples=[PI.part('guitar','strum'),PI.part('sax','falloff'),PI.gear({inst:'piano',key:'arp',type:'модуль'}),PI.chord(true),PI.voicing('sev'),PI.rhythm('push','kick',[1,2]),PI.heal()];
  for(const svg of samples){
    assert.match(svg,/shape-rendering="crispEdges"/);
    assert.ok(!/<(circle|ellipse|line|polygon|text|image|filter)/.test(svg));
    for(const d of svg.match(/ d="([^"]*)"/g))assert.match(d,/^ d="(M\d+ \d+h\d+v1h-\d+z)+"$/,'integer pixel runs only');
    assert.ok(!/\d\.\d/.test(svg.replace(/#[0-9a-f]{6}/g,'')),'no fractional coordinates');
  }
  for(const b of [PI.partPixels('drums','kick'),PI.gearPixels({inst:'bass',key:'sub',type:'спорядження'})]){assert.equal(b.w,PI.N);assert.equal(b.h,PI.N);
    assert.ok(b.some(c=>c==='#120a18'),'has the hard dark outline colour');}
});
test('attack-shape badges exist for the new flute and sax kinds and show up in the icons',()=>{
  for(const k of ['cone','ring','shot','zap','homing','boomerang','thread','beam','bellows','noteRing','orbit','feather','twister','gust','blast','fireball','smokering','bounce','puddle'])assert.ok(PI.BADGE_KINDS.includes(k),k);
  assert.notEqual(sig(PI.partPixels('flute','melody')),sig(PI.partPixels('flute','scale')));
  assert.equal(PI.partKind('sax','falloff'),'puddle');assert.equal(PI.partKind('flute','scale'),'twister');
});
test('chord, voicing, rhythm and heal cards have icons and differ from each other',()=>{
  assert.notEqual(sig(PI.chordPixels(true)),sig(PI.chordPixels(false)));
  const v=new Set(['sev','sus','add9','third','fifth','tonic','sixth','picardy','blue','octbass'].map(id=>sig(PI.voicingPixels(id))));assert.equal(v.size,10);
  const figs={crash:[0],push:[1,2],open:[1,2],bomb:[2],fill:[3],stop:[3],sync:[1,2],shuffle:[0,3]},r=new Set(Object.entries(figs).map(([f,h])=>sig(PI.rhythmPixels(f,'kick',h))));assert.equal(r.size,8);
  assert.match(PI.heal(),/<path/);
});
test('an unknown skill id still gets a distinct fallback icon',()=>{
  assert.notEqual(sig(PI.partPixels('guitar','zzz1')),sig(PI.partPixels('guitar','zzz2')));
  assert.notEqual(sig(PI.gearPixels({inst:'bass',key:'qq1',type:'педаль'})),sig(PI.gearPixels({inst:'bass',key:'qq2',type:'педаль'})));
});
test('starter parts reuse the replaced part icon with a beat-dots row',()=>{
  PI.alias('guitar','down','strum',true);assert.ok(PI.has('guitar','down'));
  assert.notEqual(sig(PI.partPixels('guitar','down',{starter:true})),sig(PI.partPixels('guitar','strum')));
  assert.notEqual(sig(PI.partPixels('guitar','down',{starter:true})),sig(PI.partPixels('guitar','chuck')));
});
