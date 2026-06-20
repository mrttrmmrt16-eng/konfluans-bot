"use strict";
/* Konfluans motoru — terminalden BİREBİR çıkarıldı (saf mantık). Elle düzenleme; terminalle senkron tut. */

function ema(v, span){
  const k = 2/(span+1); const out=[]; let p;
  for(let i=0;i<v.length;i++){ p = i===0 ? v[0] : v[i]*k + p*(1-k); out.push(p); }
  return out;
}

function rsi(v, period=14){
  const out=new Array(v.length).fill(NaN); const a=1/period; let g,l;
  for(let i=1;i<v.length;i++){
    const ch=v[i]-v[i-1], gn=Math.max(ch,0), ls=Math.max(-ch,0);
    if(i===1){g=gn;l=ls;} else {g=gn*a+g*(1-a); l=ls*a+l*(1-a);}
    const rs = l===0 ? Infinity : g/l;
    out[i]=100-100/(1+rs);
  }
  return out;
}

function macd(v, fast=12, slow=26, sig=9){
  const ef=ema(v,fast), es=ema(v,slow);
  const line=v.map((_,i)=>ef[i]-es[i]);
  const signal=ema(line,sig);
  return {line, signal};
}

function atr(h,l,c,period=14){
  const tr=[]; for(let i=0;i<h.length;i++){
    tr.push(i===0 ? h[i]-l[i] : Math.max(h[i]-l[i], Math.abs(h[i]-c[i-1]), Math.abs(l[i]-c[i-1])));
  }
  const a=1/period, out=[]; let p;
  for(let i=0;i<tr.length;i++){ p = i===0 ? tr[0] : tr[i]*a+p*(1-a); out.push(p); }
  return out;
}

function rollingMean(v, n){
  const out=new Array(v.length).fill(NaN); let s=0;
  for(let i=0;i<v.length;i++){ s+=v[i]; if(i>=n) s-=v[i-n]; if(i>=n-1) out[i]=s/n; }
  return out;
}

function swingNoktalari(high, low, sol=3, sag=3){
  const highs=[], lows=[];
  for(let i=sol;i<high.length-sag;i++){
    const hw=high.slice(i-sol,i+sag+1), lw=low.slice(i-sol,i+sag+1);
    if(high[i]===Math.max(...hw)) highs.push([i,high[i]]);
    if(low[i]===Math.min(...lw)) lows.push([i,low[i]]);
  }
  return {highs, lows};
}

function fibonacci(sl, sh){
  const f=sh-sl;
  return {"0.5":sh-0.5*f, "0.618":sh-0.618*f};
}

function mumFormasyonu(o,h,l,c, po,pc){
  const govde=Math.abs(c-o), alt=Math.min(o,c)-l, ust=h-Math.max(o,c), aralik=(h-l)||1e-9;
  if(pc<po && c>o && c>=po && o<=pc) return ["bull","Bullish Engulfing"];
  if(pc>po && c<o && c<=po && o>=pc) return ["bear","Bearish Engulfing"];
  if(alt>2*govde && ust<govde) return ["bull","Hammer (cekic)"];
  if(ust>2*govde && alt<govde) return ["bear","Shooting Star"];
  if(govde<0.1*aralik) return [null,"Doji (kararsizlik)"];
  return [null,"Belirgin formasyon yok"];
}

function ustFlipler(upper){
  const sw=swingNoktalari(upper.high, upper.low), c=upper.close, flips=[];
  for(const [hi,price] of sw.highs){            // direnc kirildi -> destek (long retest)
    let birth=-1; for(let k=hi+1;k<c.length;k++){ if(c[k]>price){ birth=k; break; } }
    if(birth<0) continue;
    let death=c.length; for(let k=birth+1;k<c.length;k++){ if(c[k]<price){ death=k; break; } }
    flips.push({level:price, dir:"long", birth, death});
  }
  for(const [li,price] of sw.lows){             // destek kirildi -> direnc (short retest)
    let birth=-1; for(let k=li+1;k<c.length;k++){ if(c[k]<price){ birth=k; break; } }
    if(birth<0) continue;
    let death=c.length; for(let k=birth+1;k<c.length;k++){ if(c[k]>price){ death=k; break; } }
    flips.push({level:price, dir:"short", birth, death});
  }
  return flips;
}

function ustContextHizala(main, upper){
  const e50=ema(upper.close,50), e200=ema(upper.close,200);
  const ur=rsi(upper.close,14), um=macd(upper.close);
  const flips=ustFlipler(upper), sw=swingNoktalari(upper.high, upper.low);
  const out=new Array(main.close.length).fill(null);
  let j=0;
  for(let i=0;i<main.close.length;i++){
    while(j+1<upper.closeTime.length && upper.closeTime[j+1] <= main.closeTime[i]) j++;
    if(upper.closeTime[j] > main.closeTime[i]){ out[i]=null; continue; }
    const u=j;
    // u'ya kadar bilinen en guncel ust swing destek/direnc
    let supLevel=null, resLevel=null;
    for(const [hi,p] of sw.highs){ if(hi<=u) resLevel=p; }
    for(const [li,p] of sw.lows){ if(li<=u) supLevel=p; }
    out[i]={
      trend: e50[u]>e200[u] ? "long":"short",
      rsi: ur[u], macdUp: um.line[u]>um.signal[u],
      flips: flips.filter(f=> f.birth<=u && u<f.death).map(f=>({level:f.level, dir:f.dir})),
      supLevel, resLevel,
    };
  }
  return out;
}

function sinyalUret(d, ust, opts){
  // d: {open,high,low,close,volume} dizileri
  // ust: null | "long"/"short" | {trend, rsi, macdUp, flips:[{level,dir}], supLevel, resLevel}
  // opts: {volFactor} — hacim teyit esigi (vol/volMA orani >= volFactor ise teyit). Varsayilan 1.0
  const uc = (ust && typeof ust==="object") ? ust : (typeof ust==="string" ? {trend:ust} : {});
  const volFactor = (opts && typeof opts.volFactor==="number") ? opts.volFactor : 1.0;
  const n=d.close.length, i=n-1;
  const close=d.close, high=d.high, low=d.low, open=d.open, vol=d.volume;
  const e50=ema(close,50), e200=ema(close,200), e20=ema(close,20);
  const r=rsi(close,14), m=macd(close), a=atr(high,low,close,14);
  const volMa=rollingMean(vol,20);
  const fiyat=close[i];
  let longP=0, shortP=0; const notlar=[];
  let retest=null;   // capraz-TF kirilim-retest tetigi (plan stop'unu seviyeye baglar)

  // [1] TREND
  let trend;
  if(e50[i]>e200[i]){ trend="long"; longP+=2; notlar.push([1,"Trend YUKSELEN (EMA50>EMA200)","long",2]); }
  else if(e50[i]<e200[i]){ trend="short"; shortP+=2; notlar.push([1,"Trend DUSEN (EMA50<EMA200)","short",2]); }
  else { trend="notr"; notlar.push([1,"Trend NOTR","neu",0]); }
  if(fiyat>e20[i]){ longP+=0.5; notlar.push([1,"Fiyat EMA20 ustunde","long",0.5]); }
  else { shortP+=0.5; notlar.push([1,"Fiyat EMA20 altinda","short",0.5]); }

  // [2] COKLU ZAMAN DILIMI (trend yonu)
  if(uc.trend==="long"){ longP+=1.5; notlar.push([2,"Ust zaman dilimi trendi LONG","long",1.5]); }
  else if(uc.trend==="short"){ shortP+=1.5; notlar.push([2,"Ust zaman dilimi trendi SHORT","short",1.5]); }
  else { notlar.push([2,"Ust zaman dilimi: veri yok","neu",0]); }

  // [3] DESTEK/DIRENC + [9] FIBONACCI
  const sw=swingNoktalari(high,low);
  const destek = sw.lows.length ? sw.lows[sw.lows.length-1][1] : Math.min(...low);
  const direnc = sw.highs.length ? sw.highs[sw.highs.length-1][1] : Math.max(...high);
  const yakinlik=(direnc-destek)*0.25 || fiyat*0.01;
  if(Math.abs(fiyat-destek)<=yakinlik){ longP+=1.5; notlar.push([3,"Fiyat destege yakin ("+destek.toFixed(2)+")","long",1.5]); }
  if(Math.abs(fiyat-direnc)<=yakinlik){ shortP+=1.5; notlar.push([3,"Fiyat dirence yakin ("+direnc.toFixed(2)+")","short",1.5]); }
  if(sw.lows.length && sw.highs.length){
    const fib=fibonacci(sw.lows[sw.lows.length-1][1], sw.highs[sw.highs.length-1][1]);
    for(const lvl of ["0.5","0.618"]){
      if(Math.abs(fiyat-fib[lvl])<=fiyat*0.01){ longP+=1; notlar.push([9,"Fiyat Fib "+lvl+" bolgesinde","long",1]); }
    }
  }

  // [6] RSI
  const rv=r[i];
  if(rv<30){ longP+=1.5; notlar.push([6,"RSI asiri satim ("+rv.toFixed(1)+")","long",1.5]); }
  else if(rv>70){ shortP+=1.5; notlar.push([6,"RSI asiri alim ("+rv.toFixed(1)+")","short",1.5]); }
  else if(rv>=40 && rv<=60){ notlar.push([6,"RSI notr ("+rv.toFixed(1)+")","neu",0]); }
  else if(rv>=50){ longP+=0.5; notlar.push([6,"RSI 50 ustu ("+rv.toFixed(1)+")","long",0.5]); }
  else { shortP+=0.5; notlar.push([6,"RSI 50 alti ("+rv.toFixed(1)+")","short",0.5]); }

  // [7] MACD
  const mn=m.line[i], sn=m.signal[i], mp=m.line[i-1], sp=m.signal[i-1];
  if(mp<=sp && mn>sn){ longP+=1.5; notlar.push([7,"MACD yukari kesisim","long",1.5]); }
  else if(mp>=sp && mn<sn){ shortP+=1.5; notlar.push([7,"MACD asagi kesisim","short",1.5]); }
  else if(mn>sn){ longP+=0.5; notlar.push([7,"MACD sinyal ustunde","long",0.5]); }
  else { shortP+=0.5; notlar.push([7,"MACD sinyal altinda","short",0.5]); }

  // [3] MUM FORMASYONU
  const [my,mname]=mumFormasyonu(open[i],high[i],low[i],close[i], open[i-1],close[i-1]);
  if(my==="bull"){ longP+=1; notlar.push([3,mname,"long",1]); }
  else if(my==="bear"){ shortP+=1; notlar.push([3,mname,"short",1]); }
  else { notlar.push([3,"Mum: "+mname,"neu",0]); }

  // [4] GRAFIK FORMASYONU (basit kirilma) — kovalamak retest'ten zayif, dusuk agirlik
  if(fiyat>direnc){ longP+=0.5; notlar.push([4,"Direnc kirilimi (breakout, kovalama)","long",0.5]); }
  else if(fiyat<destek){ shortP+=0.5; notlar.push([4,"Destek kirilimi (breakdown, kovalama)","short",0.5]); }
  else { notlar.push([4,"Kirilma yok (bant ici)","neu",0]); }

  // ---- CAPRAZ ZAMAN DILIMI TEYITLERI ----
  const atrNow = a[i];

  // [10] Kirilim-retest: ust TF'de kirilan seviye karsi role doner; ana TF'de retest tutarsa guclu tetik
  if(uc.flips && uc.flips.length){
    let best=null, bestDist=Infinity;
    for(const f of uc.flips){ const dd=Math.abs(fiyat-f.level); if(dd<bestDist){ bestDist=dd; best=f; } }
    if(best && bestDist <= 1.2*atrNow){
      if(best.dir==="long"){            // kirilan direnc -> destek; ustten retest, bogasi reddi
        const degdi = low[i] <= best.level + 0.5*atrNow;
        const tuttu = close[i] > best.level && close[i] >= open[i];
        if(degdi && tuttu){ longP+=2.5; retest={dir:"long", level:best.level};
          notlar.push([10,"Capraz TF: kirilan direnc destege dondu, retest tutuyor → Long","long",2.5]); }
      } else {                          // kirilan destek -> direnc; alttan retest, ayisi reddi
        const degdi = high[i] >= best.level - 0.5*atrNow;
        const tuttu = close[i] < best.level && close[i] <= open[i];
        if(degdi && tuttu){ shortP+=2.5; retest={dir:"short", level:best.level};
          notlar.push([10,"Capraz TF: kirilan destek dirence dondu, retest tutuyor → Short","short",2.5]); }
      }
    }
  }

  // [3] Capraz teyit: ana giris bolgesi ust TF destek/direncine de denk geliyorsa
  if(uc.supLevel!=null && Math.abs(fiyat-uc.supLevel)<=atrNow){ longP+=0.5; notlar.push([3,"Capraz TF: ust zaman dilimi destegi yakininda","long",0.5]); }
  if(uc.resLevel!=null && Math.abs(fiyat-uc.resLevel)<=atrNow){ shortP+=0.5; notlar.push([3,"Capraz TF: ust zaman dilimi direnci yakininda","short",0.5]); }

  // [7] Capraz teyit: ust TF MACD yonu
  if(uc.macdUp===true){ longP+=0.5; notlar.push([7,"Capraz TF: ust zaman dilimi MACD pozitif","long",0.5]); }
  else if(uc.macdUp===false){ shortP+=0.5; notlar.push([7,"Capraz TF: ust zaman dilimi MACD negatif","short",0.5]); }

  // [8] HACIM — kapi degil, dereceli teyit. Esik ayarlanabilir (volFactor).
  const volRatio = vol[i] / (volMa[i] || vol[i] || 1);
  const hacimTeyit = volRatio >= volFactor;
  // Guclu hacim spike'i dominant konfluans yonunu guclendirir (+0.5)
  if(volRatio >= 1.2 && longP!==shortP){
    if(longP>shortP){ longP+=0.5; notlar.push([8,"Hacim spike ("+volRatio.toFixed(2)+"x) dominant yonu guclendiriyor","long",0.5]); }
    else { shortP+=0.5; notlar.push([8,"Hacim spike ("+volRatio.toFixed(2)+"x) dominant yonu guclendiriyor","short",0.5]); }
  } else {
    notlar.push([8, "Hacim/ortalama: "+volRatio.toFixed(2)+"x "+(hacimTeyit?"→ teyit VAR":"→ teyit YOK"), "neu", 0]);
  }

  // ---- GIRIS KALITE FILTRELERI (metrikler) — mum + konum (sabit) ----
  const bullCandle = close[i] >= open[i];             // giris mumu yonu
  let loc = 0.5;                                       // fiyatin son 20 mum araligindaki konumu
  if(i>=20){
    let rh=-Infinity, rl=Infinity;
    for(let k=i-19;k<=i;k++){ rh=Math.max(rh,high[k]); rl=Math.min(rl,low[k]); }
    loc = (fiyat-rl)/((rh-rl)||1);
  }

  // ---- [PA] PRICE ACTION — 10 yontemin uzerine kalici ek konfluans ----
  // Yapilar swing noktalarindan turetilir; skora puan ekler (mevcut 10 yontem aynen kalir).
  {
    const sH=sw.highs, sL=sw.lows;
    const lastH = sH.length ? sH[sH.length-1][1] : null;
    const prevH = sH.length>1 ? sH[sH.length-2][1] : null;
    const lastL = sL.length ? sL[sL.length-1][1] : null;
    const prevL = sL.length>1 ? sL[sL.length-2][1] : null;

    // 1) Piyasa yapisi: HH+HL (yukselis) / LH+LL (dusus)
    if(lastH!=null && prevH!=null && lastL!=null && prevL!=null){
      const hh=lastH>prevH, hl=lastL>prevL, lh=lastH<prevH, ll=lastL<prevL;
      if(hh && hl){ longP+=1.5; notlar.push(["PA","Piyasa yapisi: HH+HL (yukselis)","long",1.5]); }
      else if(lh && ll){ shortP+=1.5; notlar.push(["PA","Piyasa yapisi: LH+LL (dusus)","short",1.5]); }
      else notlar.push(["PA","Piyasa yapisi: karisik/yatay","neu",0]);
    }

    // 2) Yapi kirilimi (BOS) + 3) Likidite supurme (ayni seviye, birbirini dislar)
    if(lastH!=null){
      if(close[i] > lastH){ longP+=1.0; notlar.push(["PA","Yapi kirilimi: son swing tepe kirildi (BOS yukari)","long",1.0]); }
      else if(high[i] > lastH && close[i] < lastH){ shortP+=1.5; notlar.push(["PA","Likidite supurme: swing tepe ustune fitil + geri kapanis (ayi donus)","short",1.5]); }
    }
    if(lastL!=null){
      if(close[i] < lastL){ shortP+=1.0; notlar.push(["PA","Yapi kirilimi: son swing dip kirildi (BOS asagi)","short",1.0]); }
      else if(low[i] < lastL && close[i] > lastL){ longP+=1.5; notlar.push(["PA","Likidite supurme: swing dip altina fitil + geri kapanis (boga donus)","long",1.5]); }
    }
  }

  // KARAR
  const net=longP-shortP, ESIK=(opts&&typeof opts.esik==="number")?opts.esik:4.0;
  let karar="BEKLE", sinif="wait", altyazi="Yeterli konfluans yok";
  if(net>=ESIK && trend!=="short"){ karar="LONG"; sinif="long"; altyazi="Long yonunde guclu konfluans"; }
  else if(net<=-ESIK && trend!=="long"){ karar="SHORT"; sinif="short"; altyazi="Short yonunde guclu konfluans"; }
  if(sinif==="long" && trend==="short"){ karar="BEKLE"; sinif="wait"; altyazi="Trende karsi — pas"; }
  if(sinif==="short" && trend==="long"){ karar="BEKLE"; sinif="wait"; altyazi="Trende karsi — pas"; }

  if((karar==="LONG"||karar==="SHORT") && !hacimTeyit){ altyazi="Hacim teyidi zayif ("+volRatio.toFixed(2)+"x)"; }

  // ---- GIRIS KALITE FILTRELERI (veto) — mum + konum, her zaman aktif ----
  let vetoReason=null;
  if(karar==="LONG"){
    if(!bullCandle) vetoReason="mum teyidi yok (giris mumu kirmizi)";
    else if(loc>0.4 && loc<0.6) vetoReason="orta-aralik (chop, konum "+(loc*100).toFixed(0)+"%)";
  } else if(karar==="SHORT"){
    if(bullCandle) vetoReason="mum teyidi yok (giris mumu yesil)";
    else if(loc>0.4 && loc<0.6) vetoReason="orta-aralik (chop, konum "+(loc*100).toFixed(0)+"%)";
  }
  if(vetoReason){ karar="BEKLE"; sinif="wait"; altyazi="Filtre: "+vetoReason; notlar.push(["F","Filtre vetosu: "+vetoReason,"neu",0]); }

  // ---- ETH bacagi: mom>=1 kapisi (kilitli portfoy; sadece opts.momGate acikken) ----
  if(opts && opts.momGate && (karar==="LONG"||karar==="SHORT")){
    let momNet=0;
    for(const nt of notlar){ const ty=nt[0],dsc=nt[1],dir=nt[2],w=nt[3]; const sgn=dir==="long"?1:(dir==="short"?-1:0);
      if(ty===7||ty===4||ty===10||(ty==="PA"&&/Yapi kirilimi/.test(dsc))) momNet+=sgn*w; }
    const mo = karar==="LONG"?momNet:-momNet;
    if(mo<1){ karar="BEKLE"; sinif="wait"; altyazi="ETH mom-kapisi: momentum tetigi zayif (mom "+mo.toFixed(1)+" < 1)"; notlar.push(["F","ETH mom>=1 kapisi: elendi","neu",0]); }
  }

  // PLAN — sabit 1.5*ATR stop, 1:2 R:R
  const at=a[i]; let plan=null;
  if(karar==="LONG") plan={giris:fiyat, stop:fiyat-1.5*at, hedef:fiyat+3*at};
  else if(karar==="SHORT") plan={giris:fiyat, stop:fiyat+1.5*at, hedef:fiyat-3*at};

  // Retest tetiklendiyse stop'u kirilan seviyenin hemen otesine koy (daha dar, daha iyi R:R)
  if(retest && plan){
    const buf=0.5*at;
    if(retest.dir==="long" && karar==="LONG"){
      const stop=retest.level-buf, dist=fiyat-stop;
      if(dist>0) plan={giris:fiyat, stop, hedef:fiyat+2*dist};
    } else if(retest.dir==="short" && karar==="SHORT"){
      const stop=retest.level+buf, dist=stop-fiyat;
      if(dist>0) plan={giris:fiyat, stop, hedef:fiyat-2*dist};
    }
  }

  const hamYon = net>=ESIK ? "long" : (net<=-ESIK ? "short" : null);   // teshis: esigi gecen ham yon (trend/veto oncesi)
  return {fiyat,trend,longP:+longP.toFixed(2),shortP:+shortP.toFixed(2),net:+net.toFixed(2),
          karar,sinif,altyazi,destek,direnc,hacimTeyit,volRatio:+volRatio.toFixed(2),plan,notlar,retest,hamYon,veto:vetoReason};
}

module.exports={ema,rsi,macd,atr,rollingMean,swingNoktalari,fibonacci,mumFormasyonu,ustFlipler,ustContextHizala,sinyalUret};
