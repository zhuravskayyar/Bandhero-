/* Original arrangements for the Band Hero genre expansion. Classic script; no audio dependencies. */
(function(root){
  'use strict';
  root.buildGenreExpansion=function(api){
    const T=api.T||((s)=>s),extra={flute:'flute',violin:'violin',sax:'tenor_sax',accordion:'accordion'};
    const genres={
      funk:{name:T('Фанк'),bpm:[100,116],swing:[0,.04],mode:'minor',st:'sev',palette:[0,3,5,7,10],kit:'acoustic',keys:T('клавінет'),sf:{guitar:'electric_guitar_clean',bass:'slap_bass_1',piano:'clavinet',...extra},famous:[[0,5,10,7],[0,10,5,7],[0,3,5,10]]},
      synthwave:{name:T('Синтвейв'),bpm:[100,120],swing:[0,0],mode:'minor',st:'tri',kit:'electro',keys:T('аналоговий синтезатор'),sf:{guitar:'electric_guitar_clean',bass:'synth_bass_1',piano:'lead_2_sawtooth',...extra},famous:[[0,8,10,5],[0,3,8,10],[0,10,8,7]]},
      folkrock:{name:T('Український фолк-рок'),bpm:[108,132],swing:[0,.02],mode:'minor',st:'tri',kit:'acoustic',keys:T('струнний ансамбль'),sf:{guitar:'acoustic_guitar_steel',bass:'electric_bass_finger',piano:'string_ensemble_1',...extra},famous:[[0,5,10,3],[0,10,5,7],[0,3,10,7]]},
      blues:{name:T('Блюз'),bpm:[76,96],swing:[.60,.67],mode:'major',st:'sev',palette:[0,5,7],kit:'acoustic',keys:T('блюзовий рояль'),sf:{guitar:'electric_guitar_jazz',bass:'acoustic_bass',piano:'acoustic_grand_piano',...extra},famous:[[0,5,7,0]]},
      dnb:{name:T('Драм-н-бейс'),bpm:[166,178],swing:[0,0],mode:'minor',st:'sev',kit:'electro',keys:T('електропіано й синтезатор'),sf:{guitar:'electric_guitar_clean',bass:'synth_bass_2',piano:'electric_piano_2',...extra},famous:[[0,8,3,10],[0,5,3,10],[0,10,8,5]]}
    };
    const plans={
      funk:{pattern:1,pick:[3,7,11,15],lead:[[0,3,6,14,19,22,27,30],[0,6,11,14,18,23,26,31]],mel:[[3,6,10,14,19,22,26,30],[2,7,10,15,18,23,26,31]],arp:[3,6,10,14],range:[57,76]},
      synthwave:{pattern:1,pick:[2,6,10,14],lead:[[0,6,12,18,24,30],[0,4,10,16,22,28]],mel:[[0,8,14,20,24,30],[0,6,12,18,24,28]],arp:[0,2,4,6,8,10,12,14],range:[60,79]},
      folkrock:{pattern:1,pick:[2,6,10,14],lead:[[0,2,4,6,8,12,16,18,20,22,26,30],[0,4,6,8,10,14,16,20,22,24,28,30]],mel:[[0,4,6,10,12,16,20,22,26,28],[0,2,6,8,12,16,18,22,24,28]],arp:[0,4,6,8,12,14],range:[62,81]},
      blues:{pattern:1,pick:[2,6,10,14],lead:[[0,6,8,14,18,22,28],[2,4,10,14,16,22,26]],mel:[[0,6,12,18,24,28],[2,8,14,20,26,30]],arp:[0,4,8,12],range:[57,76]},
      dnb:{pattern:1,pick:[6,14],lead:[[0,10,18,28],[4,14,20,30]],mel:[[0,6,10,16,22,28],[2,8,14,18,24,30]],arp:[0,6,8,14],range:[60,79]}
    };
    const grooves={funk:[3,6,10,15],synthwave:[2,6,10,14],folkrock:[2,6,10,14],blues:[2,6,10,14],dnb:[0,6,10,14]};
    const bluesForm=[0,0,0,0,1,1,0,0,2,1,3,2];
    const majorBlues=[0,3,5,6,7,10],minorScale=[0,2,3,5,7,8,10];
    const midi=(pc,low)=>low+((pc-low)%12+12)%12;
    const one=(n,v,d,extra)=>[api.E(n,v,d,extra)];
    const damp=(n,v,seconds,extra)=>one(n,v,seconds*4,{art:'staccato',seconds,...extra});
    const chordNotes=(ch,low,n)=>api.tones(ch,low,n);
    const eq=(s,arr)=>arr.includes(s);

    function chordQuality(gk,off){return gk==='blues'&&[0,5,7].includes(off)?'7':null;}
    function chordAt(song,bar){
      if(song.genre!=='blues')return null;
      const count=Math.max(1,Math.min(song.prog.length,song.have||song.prog.length));
      return song.prog[bluesForm[((bar%12)+12)%12]%count];
    }
    function decorateSong(song){
      if(!genres[song.genre])return song;
      // Form is deterministic and survives copying a song to the other devices.
      if(song.genre==='blues'){
        song.form='twelve-bar';
        const seq=[0,2,3,4,2,1,0,5],make=(positions,low)=>Object.fromEntries(positions.map((p,i)=>[p,midi(song.key,low)+majorBlues[seq[i%seq.length]]]));
        song.lead=make(song.phrases.lead,57);song.mel=make(song.phrases.mel,60);
      }
      if(song.genre==='folkrock'){
        const seq=[0,2,3,4,3,2,1,0,4,5,4,2];
        const make=(positions,low)=>Object.fromEntries(positions.map((p,i)=>[p,midi(song.key,low)+minorScale[seq[i%seq.length]]]));
        song.lead=make(song.phrases.lead,62);song.mel=make(song.phrases.mel,65);
      }
      return song;
    }
    function events(inst,id,rank,ch,s,bar){
      const song=api.getSong(),g=song&&song.genre;
      if(!genres[g])return null;
      const r=midi(ch.root,33),top=chordNotes(ch,60,4),phase=bar%4;
      if(inst==='guitar'){
        if(id==='strum'){
          const patterns={
            funk:[{0:'K',3:'K',6:'K',10:'K',14:'K'},{0:'K',6:'K',7:'K',11:'K',14:'K'},{0:'K',3:'K',6:'K',10:'K',14:'K'},{0:'K',6:'K',10:'K',13:'K'}],
            synthwave:[{0:'D',8:'U'}],folkrock:[{0:'D',4:'D',6:'U',8:'D',12:'D',14:'U'},{0:'D',4:'D',6:'U',10:'U',12:'D',14:'U'}],
            blues:[{0:'C',6:'C',8:'C',14:'C'},{0:'C',2:'C',8:'C',10:'C'}],dnb:[{0:'K',10:'K'},{6:'K',14:'K'}]
          };
          const patternsFor=patterns[g],dir=patternsFor[bar%patternsFor.length][s];
          if(!dir)return[];
          const ev=api.strum(ch,dir,g==='funk'?.64:g==='dnb'?.5:.75,g==='synthwave'?16:3,s);
          if(g==='funk'||g==='dnb')for(const e of ev){e.art='staccato';e.seconds=g==='funk'?.11:.13;e.jit=false;}
          if(g==='blues')for(const e of ev){e.art='staccato';e.seconds=.3;e.jit=false;}
          return ev;
        }
        if(id==='chuck'){
          const use={funk:[1,5,9,13],synthwave:[12],folkrock:[4,12],blues:[4,12],dnb:[12]}[g];
          return eq(s,use)?one(ch.vo[0].midi,g==='funk'?.35:.25,.5,{dir:'X',art:'dead'}):[];
        }
        if(id==='pick'){
          const use=plans[g].pick,k=use.indexOf(s);if(k<0)return[];
          const n=ch.vo[Math.max(0,ch.vo.length-1-(k%Math.min(3,ch.vo.length)))];
          return g==='funk'||g==='dnb'?damp(n.midi,.42,.15,{str:n.str}):one(n.midi,.46,6,{str:n.str});
        }
      }
      if(inst==='drums'){
        if(id==='kick'){
          const fe=api.figEvents&&api.figEvents(bar,s);if(fe==='mute')return[];if(fe)return fe;
          const use={funk:phase===3?[0,3,8,10,15]:[0,3,8,10],synthwave:[0,4,8,12],folkrock:bar%2?[0,6,8,14]:[0,8,10],blues:[0,8],dnb:bar%2?[0,7,10,15]:[0,6,10]}[g];
          return eq(s,use)?[api.D('kick',s===0?.95:g==='blues'?.55:.8)]:[];
        }
        if(id==='snare'){
          if(s===4||s===12)return[api.D('snare',g==='blues'?.7:.92)];
          const ghost={funk:[7,15],synthwave:[],folkrock:phase===3?[14]:[],blues:[],dnb:bar%2?[3,9,14]:[3,11]}[g];
          return eq(s,ghost)?[api.D(g==='folkrock'?'rim':'snare',g==='dnb'?.22:.25)]:[];
        }
        if(id==='hat'){
          if(g==='funk')return[api.D(s===14&&phase===3?'ohat':'hat',s%4===2?.48:s%2===0?.3:.14)];
          if(g==='blues')return s%2===0?[api.D('ride',s%4===0?.45:.28)]:[];
          if(s%2)return g==='dnb'&&eq(s,[5,13])?[api.D('hat',.12)]:[];
          return[api.D(s===14&&(g==='synthwave'||phase===3)?'ohat':'hat',s%4===0?.45:.3)];
        }
      }
      if(inst==='bass'){
        if(id==='root'){
          let map;
          if(g==='funk')map=bar%2?{0:[r,.88],3:[r,.55],6:[r+12,.65],10:[r+7,.7],15:[r+10,.5]}:{0:[r,.9],3:[r,.55],6:[r+12,.7],10:[r+7,.7],14:[r,.55]};
          if(g==='synthwave')map=Object.fromEntries([0,2,4,6,8,10,12,14].map((p,i)=>[p,[r+(i===3||i===7?12:0),i%2?.6:.75]]));
          if(g==='folkrock')map={0:[r,.85],6:[r,.58],8:[r+7,.75],14:[r+7,.6]};
          if(g==='blues')map={0:[r,.8],4:[r+4,.65],8:[r+7,.75],12:[r+9,.65]};
          if(g==='dnb')map=bar%2?{0:[r,.75],7:[r,.6],10:[r+12,.68]}:{0:[r,.78],6:[r,.62],10:[r+7,.65]};
          const n=map[s];if(!n)return[];
          return damp(n[0],n[1],g==='synthwave'?.18:g==='funk'?.18:g==='dnb'?.3:.38,{str:0});
        }
        if(id==='walk'){
          const use=g==='blues'?[2,6,10,14]:g==='funk'?[7,15]:[4,12];if(!eq(s,use))return[];
          const ns=g==='blues'?[r+7,r+9,r+10,r+9]:g==='funk'?[r+10,r+12]:[r+7,r+12];
          return damp(ns[use.indexOf(s)],.46,.2,{str:0});
        }
        if(id==='octave')return eq(s,g==='funk'?[6,14]:g==='dnb'?[14]:[6])?damp(r+12,.55,.14,{str:0}):[];
        if(id==='groove')return eq(s,grooves[g])?damp(r,.38,.12,{str:0}):[];
      }
      if(inst==='piano'){
        if(id==='chords'){
          const map={funk:{3:.13,6:.15,10:.15,14:.12},synthwave:{0:1.6,8:1.2},folkrock:{0:.65,8:.65},blues:{4:.3,12:.3},dnb:bar%2?{6:.5,14:.5}:{0:.6,10:.5}}[g];
          if(map[s]===undefined)return[];
          const ns=chordNotes(ch,g==='blues'?53:55,3);
          return ns.map((n,i)=>api.E(n,g==='funk'?.4:g==='dnb'?.35:.46,8,{off:i*.006,...(g==='synthwave'||g==='folkrock'?{}:{art:'staccato',seconds:map[s]})}));
        }
        if(id==='arp'){
          const use=plans[g].arp,k=use.indexOf(s);if(k<0)return[];
          return damp(top[[0,1,2,3,2,1,0,2][k%8]],g==='synthwave'?.3:.25,g==='synthwave'?.22:.15);
        }
      }
      return null;
    }
    function installLayers(layers){
      for(const inst of ['guitar','drums','bass','piano'])for(const layer of layers[inst]||[]){
        if(layer.expansionGenreWrapped)continue;
        const original=layer.steps;
        layer.steps=function(ch,s,bar,rank){const result=events(inst,layer.id,rank,ch,s,bar);return result===null?original(ch,s,bar,rank):result;};
        layer.expansionGenreWrapped=true;
      }
    }
    return{genres,plans,grooves,events,installLayers,chordQuality,chordAt,decorateSong};
  };
})(typeof window!=='undefined'?window:globalThis);
