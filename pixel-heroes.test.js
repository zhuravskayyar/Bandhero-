'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

// Canvas records pixels and draw operations; no browser or graphics dependency.
function harness(){
  const calls=[];
  function context(canvas){
    const c={canvas,createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),
      putImageData(im){canvas.pixels=im.data;},drawImage(...args){calls.push({name:'drawImage',args,color:c.fillStyle});}};
    for(const name of ['save','restore','translate','rotate','scale','beginPath','closePath','fill','stroke','rect','fillRect','moveTo','lineTo','arc'])c[name]=(...args)=>{
      for(const n of args)if(typeof n==='number')assert.ok(Number.isFinite(n),name+' received a finite coordinate');
      calls.push({name,args,color:c.fillStyle});
    };
    return c;
  }
  const document={createElement(name){assert.equal(name,'canvas');const canvas={width:0,height:0,toDataURL:()=> 'data:image/png;base64,canvas'};canvas.getContext=()=>canvas.ctx||(canvas.ctx=context(canvas));return canvas;}};
  const box={document};vm.runInNewContext(fs.readFileSync(__dirname+'/pixel-heroes.js','utf8'),box);
  return {ph:box.PixelHeroes,calls,ctx:context({})};
}
const STATES={idle:8,walk:8,atk:6,hurt:2,fall:6,down:4,rise:5};
const NEW=['flute','violin','sax','accordion'];

test('all eight procedural heroes build complete colored frames for every native state',()=>{
  const {ph}=harness();assert.deepEqual(Array.from(ph.chars),['guitar','drums','bass','piano',...NEW]);
  const idleSignatures=new Set();
  for(const ch of ph.chars){
    idleSignatures.add(ph.build(ch,{s:'idle',f:0}).join(','));
    for(const [s,n] of Object.entries(STATES))for(let f=0;f<n;f++)for(const L of s==='atk'?[0,1,2,3]:[0]){
      const b=ph.build(ch,{s,f,L});assert.equal(b.length,1600,ch+'/'+s+' stays in the 40×40 sprite buffer');
      let painted=0;for(const c of b){if(c){assert.match(c,/^#[0-9a-f]{6}$/i,ch+'/'+s+' uses valid pixel colors');painted++;}}
      assert.ok(painted>60,ch+'/'+s+' has a complete visible creature');
      assert.equal(Object.keys(b).filter(k=>!['w','h'].includes(k)).length,1600,'drawing never creates out-of-range buffer properties');
    }
  }
  assert.equal(idleSignatures.size,8,'each instrument has its own silhouette and palette');
});

test('new creatures animate locomotion, four skill poses, hurt and recovery',()=>{
  const {ph}=harness();
  for(const ch of NEW){
    const sign=(s,f,L=0)=>ph.build(ch,{s,f,L}).join(',');
    assert.ok(new Set(Array.from({length:8},(_,f)=>sign('walk',f))).size>=4,ch+' has real leg/wing movement');
    assert.equal(new Set(Array.from({length:4},(_,L)=>sign('atk',2,L))).size,4,ch+' has a distinct attack pose per skill');
    assert.notEqual(sign('hurt',0),sign('idle',0));assert.notEqual(sign('down',1),sign('idle',0));
    assert.notEqual(sign('rise',2),sign('down',1));
    const a=ph.frame(ch,{s:'idle',f:0});assert.equal(a.width,40);assert.equal(a.height,40);
    assert.equal(a,ph.frame(ch,{s:'idle',f:0}),'same pose reuses its baked canvas');
    assert.ok(a.pixels.some((v,i)=>i%4===3&&v===255),'portrait frame contains opaque art pixels');
  }
});

test('four persistent skill effects follow finite collision geometry and the shared pixel budget',()=>{
  const {ph,calls,ctx}=harness();
  const effects=[
    {kind:'boomerang',x:30,y:50,dir:.7,r:11},
    {kind:'thread',x:-40,y:15,x2:270,y2:85},
    {kind:'beam',x:20,y:30,dir:1.1,w:.34,range:285},
    {kind:'bellows',x:20,y:30,r:120,maxR:150,delay:.4}
  ];
  for(const effect of effects){
    calls.length=0;ph.fxFrame();assert.equal(ph.drawInstrumentFx(ctx,{...effect,age:.25,life:1},2),true);
    assert.ok(calls.some(c=>c.name==='drawImage'||c.name==='rect'),effect.kind+' paints pixels');
    assert.equal(calls.filter(c=>c.name==='save').length,calls.filter(c=>c.name==='restore').length,'canvas transform restored');
  }
  calls.length=0;ph.fxFrame(24);ph.drawInstrumentFx(ctx,{...effects[1],age:.2,life:1},2);
  assert.ok(calls.filter(c=>c.name==='rect').length<=24,'long threads respect shared per-frame cell budget');
  assert.equal(ph.drawInstrumentFx(ctx,{kind:'unknown'},2),false);
});

test('each new instrument has its own hit-spark palette and all ordinary attack shapes render',()=>{
  const {ph,calls,ctx}=harness();const palettes=[];
  for(const inst of NEW){
    calls.length=0;assert.equal(ph.drawSpark(ctx,inst,2,0,0,34),true);
    const canvas=calls.find(c=>c.name==='drawImage').args[0];
    const palette=new Set();for(let i=0;i<canvas.pixels.length;i+=4)if(canvas.pixels[i+3])palette.add(Array.from(canvas.pixels.slice(i,i+3)).join(','));
    palettes.push(Array.from(palette).sort().join('|'));
    for(const kind of ['shot','zap','ring','cone']){
      ph.fxFrame();assert.equal(ph.drawFx(ctx,kind,{x:0,y:0,x1:0,y1:0,x2:120,y2:30,vx:120,vy:30,r:8,maxR:100,w:.5,dir:.5,layer:'melody'},inst,.1,.4,1,2),true);
    }
  }
  assert.equal(new Set(palettes).size,4,'hit attribution stays visible through distinct colors');
});

test('new flute and sax skill kinds each draw their own pixel art, not the accordion fallback',()=>{
  const samples={
    orbit:{x:10,y:20,n:3,ring:60,spin:4,a0:.4,r:9},feather:{x:10,y:20,vx:200,vy:50},twister:{x:10,y:20,r:50,range:90},
    gust:{x:10,y:20,dir:.2,split:.45,w:1.2,r:100},blast:{x:10,y:20,r:80},fireball:{x:10,y:20,vx:300,vy:20,aoe:60,ex:-1},
    smokering:{x:10,y:20,r:50},bounce:{x:10,y:20,px:-60,py:-30,left:2},puddle:{x:10,y:20,r:46}};
  const render=(f)=>{const {ph,calls,ctx}=harness();ph.fxFrame();assert.equal(ph.drawInstrumentFx(ctx,{...f,age:.2,life:1},2),true);
    assert.equal(calls.filter(c=>c.name==='save').length,calls.filter(c=>c.name==='restore').length);return JSON.stringify(calls.map(c=>[c.name,c.args.filter(n=>typeof n==='number'),c.color]));};
  const bellows=render({kind:'bellows',x:10,y:20,r:80,maxR:100,delay:.4}),seen=new Set();
  for(const [kind,o] of Object.entries(samples)){
    const out=render({kind,...o});assert.ok(out.length>50,kind+' paints');assert.notEqual(out,bellows,kind+' is not bellows');seen.add(out);
  }
  assert.equal(seen.size,Object.keys(samples).length);
  const {ph,ctx}=harness();ph.fxFrame();assert.equal(ph.drawInstrumentFx(ctx,{kind:'fireball',x:0,y:0,vx:1,vy:0,aoe:60,ex:.1,age:.3,life:.6},2),true);
});
