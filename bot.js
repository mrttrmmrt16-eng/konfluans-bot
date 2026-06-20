"use strict";
/* ============================================================
   KONFLUANS — BINANCE FUTURES TESTNET BOTU (ccxt)
   ------------------------------------------------------------
   • GERÇEK PARA YOK. setSandboxMode(true) ile yalnız testnet.
   • Sinyal + trail kararları MAINNET 4h mumlarından gelir
     (gerçek sistem, engine.js — backtest ile birebir).
   • Emirler TESTNET'e gönderilir. Testnet fiyatı gerçeğinden
     sapabilir; testnet'in amacı P&L değil EMİR MEKANİĞİDİR
     (market giriş, stop koy, stop'u iz sürerek iptal-değiştir,
     dolum yakala, boyut/precision). Edge'i forward-test doğrular.
   • "Gölge" pozisyon (mainnet fiyat uzayında) kararı verir;
     testnet stop'u = testnet giriş dolumu + (gölge_stop − gölge_giriş).
   • Anahtarlar ortam değişkeninden: API_KEY, API_SECRET.
   • Durdurma: ortamda KILL=1 ya da hosting panelinden servisi durdur.
   ============================================================ */

const ccxt = require("ccxt");
const fs = require("fs");
const path = require("path");
const E = require("./engine.js");

// ---------------- AYAR ----------------
const CONFIG = {
  // ccxt birleşik sembol → engine/kline sembolü
  pairs: [
    { ccxt: "BTC/USDT:USDT", bin: "BTCUSDT", risk: 0.02, momGate: false },
    { ccxt: "ETH/USDT:USDT", bin: "ETHUSDT", risk: 0.015, momGate: true  },
  ],
  leverage: 10,            // SADECE marjin verimi; risk stop mesafesiyle belirlenir
  esik: 4, volFactor: 0.7,
  tf: "4h", ustTf: "1d", klineLimit: 300, pencere: 260,
  feeRate: 0.0006,         // kayıt için
  boundaryBufferSec: 45,
  dir: __dirname,
};
const STATE_FILE = path.join(CONFIG.dir, "bot-state.json");
const LOG_FILE   = path.join(CONFIG.dir, "bot.log");
const TRADES_CSV = path.join(CONFIG.dir, "bot-trades.csv");
const FOURH_MS = 4 * 3600 * 1000;

// ---------------- yardımcılar ----------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ts() { return new Date().toISOString().replace("T", " ").slice(0, 19) + "Z"; }
function log(m) { const l = `[${ts()}] ${m}`; console.log(l); try { fs.appendFileSync(LOG_FILE, l + "\n"); } catch (e) {} }

async function mainnetKlines(sym, interval, limit) {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${interval}&limit=${limit}`;
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal }); clearTimeout(to);
    if (!r.ok) throw new Error("klines HTTP " + r.status);
    const raw = await r.json();
    return {
      time: raw.map(x => +x[0]), open: raw.map(x => +x[1]), high: raw.map(x => +x[2]),
      low: raw.map(x => +x[3]), close: raw.map(x => +x[4]), volume: raw.map(x => +x[5]), closeTime: raw.map(x => +x[6]),
    };
  } catch (e) { clearTimeout(to); throw e; }
}

// ---------------- gölge pozisyon (mainnet fiyat uzayı, backtest birebir) ----------------
function shadowOpen(side, plan) {
  const entry = plan.giris, stop = plan.stop, dist = Math.abs(entry - stop);
  return { side, entry, stop, dist, half: false, ext: entry,
    partialAt: side === "long" ? entry + 2 * dist : entry - 2 * dist };
}
function shadowManage(pos, c) {
  let exit = null, reason = null;
  if (pos.side === "long" && c.low <= pos.stop)  { exit = pos.stop; reason = pos.half ? "iz" : "stop"; }
  if (pos.side === "short" && c.high >= pos.stop) { exit = pos.stop; reason = pos.half ? "iz" : "stop"; }
  if (exit !== null) return { closed: true, exit, reason };
  if (!pos.half) { const hit = pos.side === "long" ? c.high >= pos.partialAt : c.low <= pos.partialAt;
    if (hit) { pos.half = true; pos.stop = pos.entry; pos.event = "2R→başabaş"; } }
  if (pos.side === "long") pos.ext = Math.max(pos.ext, c.high); else pos.ext = Math.min(pos.ext, c.low);
  if (pos.half) { if (pos.side === "long") { const ns = pos.ext - pos.dist * (0.8 / 1.5); if (ns > pos.stop) pos.stop = ns; }
    else { const ns = pos.ext + pos.dist * (0.8 / 1.5); if (ns < pos.stop) pos.stop = ns; } }
  return { closed: false };
}
// gölge stop'unu testnet fiyatına çevir (giriş dolumuna ofsetle bağlı)
function testnetStopFiyat(shadow, fill) { return fill + (shadow.stop - shadow.entry); }

// ---------------- durum ----------------
let state = { pairs: {}, lastClose: {}, tradeCount: 0, sumR: 0 };
function loadState() {
  try { if (fs.existsSync(STATE_FILE)) { state = Object.assign(state, JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))); log(`durum yüklendi · ${state.tradeCount} işlem`); } } catch (e) { log("durum okunamadı: " + e.message); }
}
function saveState() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch (e) {} }
function logTrade(bin, side, entry, exit, reason, R) {
  state.tradeCount++; state.sumR += R;
  if (!fs.existsSync(TRADES_CSV)) fs.writeFileSync(TRADES_CSV, "zaman,sembol,yon,golge_giris,golge_cikis,sebep,R\n");
  fs.appendFileSync(TRADES_CSV, [new Date().toISOString(), bin, side, entry.toFixed(2), exit.toFixed(2), reason, R.toFixed(3)].join(",") + "\n");
}

// ---------------- borsa ----------------
let ex;
async function initExchange() {
  if (!process.env.API_KEY || !process.env.API_SECRET) {
    log("⛔ API_KEY / API_SECRET ortam değişkenleri yok. Çıkılıyor."); process.exit(1);
  }
  ex = new ccxt.binance({
    apiKey: process.env.API_KEY,
    secret: process.env.API_SECRET,
    enableRateLimit: true,
    options: { defaultType: "future", adjustForTimeDifference: true },
  });
  ex.setSandboxMode(true); // ← TESTNET (gerçek para değil)
  await ex.loadMarkets();
  for (const p of CONFIG.pairs) { try { await ex.setLeverage(CONFIG.leverage, p.ccxt); } catch (e) { log(`${p.bin} kaldıraç ayarı: ${e.message}`); } }
  const bal = await ex.fetchBalance();
  log(`✓ TESTNET bağlı · bakiye ${(bal.total && bal.total.USDT ? bal.total.USDT.toFixed(2) : "?")} USDT`);
}
async function borsaPozisyon(ccxtSym) {
  try { const ps = await ex.fetchPositions([ccxtSym]); const p = ps.find(x => x.symbol === ccxtSym && Math.abs(+x.contracts || 0) > 0); return p || null; }
  catch (e) { log(`pozisyon okunamadı ${ccxtSym}: ${e.message}`); return undefined; }
}
async function stopEmriYenile(p, fill, shadow) {
  const ccxtSym = p.ccxt;
  const closeSide = shadow.side === "long" ? "sell" : "buy";
  const sp = +ex.priceToPrecision(ccxtSym, testnetStopFiyat(shadow, fill));
  try {
    const oo = await ex.fetchOpenOrders(ccxtSym);
    for (const o of oo) { if ((o.type || "").toLowerCase().includes("stop")) await ex.cancelOrder(o.id, ccxtSym); }
  } catch (e) { log(`${p.bin} eski stop iptal: ${e.message}`); }
  try {
    const amt = state.pairs[p.bin] ? state.pairs[p.bin].amount : undefined;
    await ex.createOrder(ccxtSym, "STOP_MARKET", closeSide, amt, undefined, { stopPrice: sp, reduceOnly: true });
    log(`${p.bin} stop → ${sp}`);
  } catch (e) { log(`${p.bin} stop koyulamadı: ${e.message}`); }
}
async function piyasaKapat(p, side, amount) {
  const closeSide = side === "long" ? "sell" : "buy";
  try { await ex.createOrder(p.ccxt, "market", closeSide, amount, undefined, { reduceOnly: true }); }
  catch (e) { log(`${p.bin} kapatılamadı: ${e.message}`); }
  try { const oo = await ex.fetchOpenOrders(p.ccxt); for (const o of oo) await ex.cancelOrder(o.id, p.ccxt); } catch (e) {}
}

// ---------------- tek tur ----------------
async function tick() {
  if (process.env.KILL === "1") { log("⛔ KILL=1 — bot duruyor."); process.exit(0); }
  let bal;
  try { bal = await ex.fetchBalance(); } catch (e) { log("bakiye okunamadı: " + e.message); return; }
  const usdt = (bal.total && bal.total.USDT) ? bal.total.USDT : 0;
  const now = Date.now();

  for (const p of CONFIG.pairs) {
    let main, upper;
    try { main = await mainnetKlines(p.bin, CONFIG.tf, CONFIG.klineLimit); upper = await mainnetKlines(p.bin, CONFIG.ustTf, CONFIG.klineLimit); }
    catch (e) { log(`${p.bin} mainnet veri yok: ${e.message}`); continue; }
    let nC = main.closeTime.length; while (nC > 0 && main.closeTime[nC - 1] > now) nC--;
    if (nC < 220) { log(`${p.bin} yetersiz mum`); continue; }
    const lastClose = main.closeTime[nC - 1];
    const ustFull = E.ustContextHizala(main, upper);

    const sym = p.bin;
    const sp = state.pairs[sym]; // {shadow, fill, amount}
    const borsaPos = await borsaPozisyon(p.ccxt);

    // --- senkron: yerel açık ama borsa flat → testnet stop dolmuş ---
    if (sp && sp.shadow && borsaPos === null) {
      log(`${sym} testnet pozisyonu kapanmış (stop dolmuş) — kayıt`);
      const R = sp.shadow.half ? 1.0 : -1.0; // kabaca; gölge tetiklenince gerçek R hesaplanır
      logTrade(sym, sp.shadow.side, sp.shadow.entry, sp.shadow.stop, "borsa-stop", R);
      state.pairs[sym] = null;
    }

    // --- yeni kapanmış mum yoksa atla ---
    if (state.lastClose[sym] && lastClose <= state.lastClose[sym]) { continue; }

    const c = { high: main.high[nC - 1], low: main.low[nC - 1], close: main.close[nC - 1], closeTime: lastClose };

    // --- açık gölge pozisyonu yönet ---
    if (state.pairs[sym] && state.pairs[sym].shadow) {
      const ps = state.pairs[sym];
      const res = shadowManage(ps.shadow, c);
      if (ps.shadow.event) { log(`${sym} » ${ps.shadow.event}`); ps.shadow.event = null; }
      if (res.closed) {
        // gölge R hesapla (mainnet)
        const dir = ps.shadow.side === "long" ? 1 : -1;
        const R = (res.exit - ps.shadow.entry) * dir / ps.shadow.dist - 2 * CONFIG.feeRate * (ps.shadow.entry / ps.shadow.dist);
        log(`${sym} ÇIKIŞ ${ps.shadow.side} · sebep ${res.reason} · ${R >= 0 ? "+" : ""}${R.toFixed(2)}R → testnet pozisyon kapatılıyor`);
        if (borsaPos) await piyasaKapat(p, ps.shadow.side, Math.abs(+borsaPos.contracts));
        logTrade(sym, ps.shadow.side, ps.shadow.entry, res.exit, res.reason, R);
        state.pairs[sym] = null;
      } else {
        // stop seviyesi değiştiyse testnet stop'unu güncelle
        await stopEmriYenile(p, ps.fill, ps.shadow);
      }
    }

    // --- flat ise yeni sinyal ---
    if (!state.pairs[sym] || !state.pairs[sym].shadow) {
      const from = Math.max(0, nC - 1 - (CONFIG.pencere - 1));
      const d = {}; for (const k in main) d[k] = main[k].slice(from, nC);
      const ust = ustFull.slice(from, nC);
      const s = E.sinyalUret(d, ust, { volFactor: CONFIG.volFactor, esik: CONFIG.esik, momGate: p.momGate });
      if ((s.karar === "LONG" || s.karar === "SHORT") && s.plan) {
        const side = s.karar === "LONG" ? "long" : "short";
        const shadow = shadowOpen(side, s.plan);
        const riskAmt = usdt * p.risk;
        let amount = shadow.dist > 0 ? riskAmt / shadow.dist : 0;
        amount = +ex.amountToPrecision(p.ccxt, amount);
        const mkt = ex.market(p.ccxt);
        const minAmt = (mkt.limits && mkt.limits.amount && mkt.limits.amount.min) || 0;
        const minCost = (mkt.limits && mkt.limits.cost && mkt.limits.cost.min) || 0;
        if (amount < minAmt || amount * s.plan.giris < minCost) {
          log(`${sym} sinyal var ama boyut min altı (amount ${amount}); testnet bakiyeni artır. Atlandı.`);
        } else {
          try {
            const ord = await ex.createOrder(p.ccxt, "market", side === "long" ? "buy" : "sell", amount);
            const fill = ord.average || ord.price || s.plan.giris;
            state.pairs[sym] = { shadow, fill, amount };
            log(`${sym} GİRİŞ ${side.toUpperCase()} · testnet dolum ${(+fill).toFixed(2)} · miktar ${amount} · risk %${p.risk * 100} ($${riskAmt.toFixed(2)}) · net ${s.net}`);
            await stopEmriYenile(p, fill, shadow); // ilk stop'u koy
          } catch (e) { log(`${sym} giriş emri hata: ${e.message}`); }
        }
      } else {
        log(`${sym} ${s.karar} (net ${s.net}) — giriş yok`);
      }
    }
    state.lastClose[sym] = lastClose;
  }

  saveState();
  const exp = state.tradeCount ? state.sumR / state.tradeCount : 0;
  log(`— tur bitti · bakiye ${usdt.toFixed(2)} USDT · ${state.tradeCount} işlem · beklenti ${exp >= 0 ? "+" : ""}${exp.toFixed(3)}R`);
}

// ---------------- zamanlayıcı ----------------
function msToNextBoundary() { const now = Date.now(); const next = Math.ceil(now / FOURH_MS) * FOURH_MS + CONFIG.boundaryBufferSec * 1000; return Math.max(3000, next - now); }
async function loop() {
  try { await tick(); } catch (e) { log("TUR HATASI: " + (e && e.stack ? e.stack : e)); }
  const w = msToNextBoundary();
  log(`sonraki kontrol ~${Math.round(w / 60000)} dk sonra`);
  setTimeout(loop, w);
}

(async function main() {
  log("══════════════════════════════════════════════");
  log("KONFLUANS TESTNET BOTU · setSandboxMode(true) · gerçek para YOK");
  log(`kaldıraç ${CONFIG.leverage}x · risk BTC %${CONFIG.pairs[0].risk * 100} / ETH %${CONFIG.pairs[1].risk * 100}`);
  log("══════════════════════════════════════════════");
  loadState();
  try { await initExchange(); } catch (e) { log("borsa başlatılamadı: " + e.message); process.exit(1); }
  loop();
})();
