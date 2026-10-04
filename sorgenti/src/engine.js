/* ===== Motore di calcolo ===== */
const MESI_BREVI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const MESI_LUNGHI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

function pad2(n) { return String(n).padStart(2, "0"); }
function monthKey(y, m) { return y + "-" + pad2(m); }
function addMonths(key, n) {
  const y = +key.slice(0, 4), m = +key.slice(5, 7) - 1 + n;
  return monthKey(y + Math.floor(m / 12), ((m % 12) + 12) % 12 + 1);
}
function todayISO() { const d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function nextMonthKey() { const d = new Date(); return addMonths(monthKey(d.getFullYear(), d.getMonth() + 1), 1); }

/* --- Fasce orarie ARERA (delibera 181/06) e festività nazionali --- */
function easterUTC(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, mo - 1, da));
}
const _holCache = {};
function holidaySet(y) {
  if (_holCache[y]) return _holCache[y];
  const s = new Set(["01-01", "01-06", "04-25", "05-01", "06-02", "08-15", "11-01", "12-08", "12-25", "12-26"]);
  const em = new Date(easterUTC(y).getTime() + 86400000);
  s.add(pad2(em.getUTCMonth() + 1) + "-" + pad2(em.getUTCDate()));
  return (_holCache[y] = s);
}
function isHoliday(y, m, d) { return holidaySet(y).has(pad2(m) + "-" + pad2(d)); }
/* dow: 0=domenica ... 6=sabato. Restituisce 1, 2 o 3. */
function fasciaOf(dow, hour, holiday) {
  if (holiday || dow === 0) return 3;
  if (dow === 6) return hour >= 7 && hour < 23 ? 2 : 3;
  if (hour >= 8 && hour < 19) return 1;
  if (hour === 7 || (hour >= 19 && hour < 23)) return 2;
  return 3;
}
function fasciaHours(key) {
  const y = +key.slice(0, 4), m = +key.slice(5, 7);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const c = [0, 0, 0, 0];
  for (let d = 1; d <= days; d++) {
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(), hol = isHoliday(y, m, d);
    for (let h = 0; h < 24; h++) c[fasciaOf(dow, h, hol)]++;
  }
  return { f1: c[1], f2: c[2], f3: c[3] };
}

/* --- Prezzo all'ingrosso (PUN) per mese e fascia --- */
function punMonoFor(key, market, mult) {
  const fw = (market.forward && market.forward.mesi) || [];
  const hit = fw.find(x => x.mese === key);
  if (hit) return (hit.v / 1000) * mult;
  const st = (market.pun && market.pun.storico) || [];
  const h = st.find(x => x.mese === key);
  if (h) return h.mono * mult;
  if (fw.length) {
    // oltre l'ultimo contratto quotato: stesso mese dell'ultimo anno disponibile
    const sameMonth = fw.filter(x => x.mese.slice(5) === key.slice(5));
    const ref = sameMonth.length ? sameMonth[sameMonth.length - 1] : fw[fw.length - 1];
    return (ref.v / 1000) * mult;
  }
  const last = st[st.length - 1];
  return last ? last.mono * mult : 0.15 * mult;
}
function punFasce(key, market, mult) {
  const mono = punMonoFor(key, market, mult);
  const r = (market.rapportiFasce && market.rapportiFasce[key.slice(5)]) || { f1: 1, f2: 1, f3: 1 };
  const H = fasciaHours(key);
  const tot = H.f1 + H.f2 + H.f3;
  // normalizzo i rapporti perché la media pesata sulle ore torni al mono
  const norm = (r.f1 * H.f1 + r.f2 * H.f2 + r.f3 * H.f3) / tot;
  const f1 = mono * r.f1 / norm, f2 = mono * r.f2 / norm, f3 = mono * r.f3 / norm;
  const f23 = (f2 * H.f2 + f3 * H.f3) / (H.f2 + H.f3);
  return { mono, f1, f2, f3, f23 };
}

/* --- Accise: abitazione di residenza fino a 3 kW con franchigia mensile --- */
function acciseKWhTassati(kwhMese, residente, potenzaKW, reg) {
  const a = reg.accise;
  if (!residente || potenzaKW > a.potenzaMaxKW + 1e-9) return kwhMese;
  const fr = a.franchigiaMeseKWh, s1 = a.soglia1MeseKWh;
  if (kwhMese <= fr) return 0;
  if (kwhMese <= s1) return kwhMese - fr;
  const esente = Math.max(0, fr - (kwhMese - s1));
  return kwhMese - esente;
}

/* --- Profilo mensile standard di una famiglia (quote dell'anno) --- */
const PROFILO_MENSILE_STD = [0.095, 0.085, 0.083, 0.074, 0.070, 0.076, 0.092, 0.088, 0.076, 0.076, 0.085, 0.100];

function normSplit(s) {
  const a = Math.max(0, +s.f1 || 0), b = Math.max(0, +s.f2 || 0), c = Math.max(0, +s.f3 || 0);
  const t = a + b + c;
  return t > 0 ? { f1: a / t, f2: b / t, f3: c / t } : { f1: 0.33, f2: 0.31, f3: 0.36 };
}
function normProfile(p) {
  const arr = (Array.isArray(p) && p.length === 12) ? p.map(x => Math.max(0, +x || 0)) : PROFILO_MENSILE_STD.slice();
  const t = arr.reduce((s, x) => s + x, 0);
  return t > 0 ? arr.map(x => x / t) : PROFILO_MENSILE_STD.slice();
}

/* --- Idoneità e avvisi per il consumatore --- */
function offerEligibility(offer, profile) {
  const motivi = [];
  const req = offer.requisiti || [];
  const pref = profile.preferenze || {};
  if (req.includes("domiciliazione") && pref.domiciliazione === false) motivi.push("Richiede l'addebito su conto corrente");
  if (req.includes("bolletta_web") && pref.bollettaWeb === false) motivi.push("Richiede la bolletta solo via email");
  if (offer.solo === "vulnerabili" && !profile.vulnerabile) motivi.push("Riservata ai clienti vulnerabili");
  if (offer.solo === "nonResidenti" && profile.residente) motivi.push("Solo per seconde case");
  return motivi;
}
function isExpired(offer) {
  return !!offer.validoFino && offer.validoFino < todayISO();
}

/* --- Calcolo del costo di un'offerta su 12 mesi --- */
function computeOffer(offer, profile, market, opts) {
  opts = opts || {};
  const reg = market.regolato;
  const mult = opts.mult == null ? 1 : opts.mult;
  const start = opts.start || nextMonthKey();
  const kwhAnno = Math.max(0, +profile.kwhAnno || 0);
  const kW = +profile.potenzaKW || 3;
  const residente = profile.residente !== false;
  const split = normSplit(profile.split || {});
  const prof = normProfile(profile.profiloMensile);
  const pref = profile.preferenze || {};
  const perditeOn = offer.perdite !== "incluse";
  const dispOn = offer.dispacciamento !== "incluso";
  const oneri = residente ? reg.oneri.residente : reg.oneri.nonResidente;
  const disp = reg.dispacciamento || { energiaKWh: 0, capacitaKWh: 0, dispBTAnno: 0 };
  const dispKWh = (disp.energiaKWh || 0) + (disp.capacitaKWh || 0);

  // quota di consumo soggetta allo spread maggiorato (es. oltre 2.200 kWh/anno)
  const quotaOltre = offer.spreadOltre && kwhAnno > offer.spreadOltre.sogliaAnnoKWh
    ? (kwhAnno - offer.spreadOltre.sogliaAnnoKWh) / kwhAnno : 0;

  const scPct = offer.scontoEnergiaPct && (offer.scontoEnergiaPct.condizione !== "domiciliazione" || pref.domiciliazione !== false)
    ? offer.scontoEnergiaPct.pct / 100 : 0;
  const scontiAnno = (offer.sconti || []).reduce((s, x) => {
    if (x.condizione === "domiciliazione" && pref.domiciliazione === false) return s;
    if (x.condizione === "bolletta_web" && pref.bollettaWeb === false) return s;
    return s + (+x.euroAnno || 0);
  }, 0);

  const tot = { energia: 0, perdite: 0, dispacciamento: 0, commercializzazione: 0, trasporto: 0, oneri: 0, sconti: 0, accise: 0, iva: 0, totale: 0 };
  const mesi = [];

  for (let i = 0; i < 12; i++) {
    const key = addMonths(start, i);
    const cal = +key.slice(5, 7) - 1;
    const kwh = kwhAnno * prof[cal];
    const k1 = kwh * split.f1, k2 = kwh * split.f2, k3 = kwh * split.f3;
    let energia = 0;

    if (offer.tipo === "indicizzato") {
      const p = punFasce(key, market, mult);
      const sp = offer.spread || {};
      const extra = quotaOltre * ((offer.spreadOltre ? offer.spreadOltre.spread : 0) - (sp.mono != null ? sp.mono : (sp.f1 || 0)));
      if (offer.fasce === "tri") {
        energia = k1 * (p.f1 + (sp.f1 ?? sp.mono ?? 0)) + k2 * (p.f2 + (sp.f2 ?? sp.mono ?? 0)) + k3 * (p.f3 + (sp.f3 ?? sp.mono ?? 0));
      } else if (offer.fasce === "bi") {
        energia = k1 * (p.f1 + (sp.f1 ?? sp.mono ?? 0)) + (k2 + k3) * (p.f23 + (sp.f23 ?? sp.mono ?? 0));
      } else {
        energia = kwh * (p.mono + (sp.mono || 0));
      }
      energia += kwh * extra;
      if (offer.tetto && offer.tetto.prezzoKWh) {
        // tetto massimo sul prezzo medio (perdite comprese se indicato)
        const fattore = offer.tetto.perditeComprese && perditeOn ? 1 + reg.perdite : 1;
        const maxE = kwh * offer.tetto.prezzoKWh / fattore;
        energia = Math.min(energia, maxE);
      }
    } else {
      const pz = offer.prezzo || {};
      if (offer.fasce === "tri") energia = k1 * (pz.f1 ?? pz.mono) + k2 * (pz.f2 ?? pz.f23 ?? pz.mono) + k3 * (pz.f3 ?? pz.f23 ?? pz.mono);
      else if (offer.fasce === "bi") energia = k1 * (pz.f1 ?? pz.mono) + (k2 + k3) * (pz.f23 ?? pz.mono);
      else energia = kwh * (pz.mono ?? pz.f1 ?? 0);
    }
    energia += kwh * (+offer.altriCostiKWh || 0);
    const scontoE = energia * scPct;
    energia -= scontoE;
    const perdite = perditeOn ? energia * reg.perdite : 0;
    const dispacc = dispOn ? kwh * (1 + reg.perdite) * dispKWh + (disp.dispBTAnno || 0) / 12 : 0;
    const comm = (+offer.quotaFissaMese || 0);
    const trasporto = (reg.trasporto.quotaFissaAnno + reg.trasporto.quotaPotenzaKWAnno * kW) / 12 + kwh * reg.trasporto.quotaEnergiaKWh;
    const on = oneri.quotaFissaAnno / 12 + kwh * oneri.quotaEnergiaKWh;
    const sconti = scontiAnno / 12 + (i === 0 ? (+offer.bonusUnaTantum || 0) : 0);
    const accise = acciseKWhTassati(kwh, residente, kW, reg) * reg.accise.aliquotaKWh;
    const imponibile = energia + perdite + dispacc + comm + trasporto + on - sconti + accise;
    const iva = Math.max(0, imponibile) * reg.iva;
    const totale = imponibile + iva;
    mesi.push({ mese: key, kwh, totale });
    tot.energia += energia; tot.perdite += perdite; tot.dispacciamento += dispacc; tot.commercializzazione += comm;
    tot.trasporto += trasporto; tot.oneri += on; tot.sconti += sconti; tot.accise += accise; tot.iva += iva; tot.totale += totale;
  }
  if (opts.canoneRai && residente) tot.totale += reg.canoneRaiAnno || 0;
  tot.cKWh = kwhAnno > 0 ? tot.totale / kwhAnno : 0;
  tot.materia = tot.energia + tot.perdite + tot.dispacciamento + tot.commercializzazione - tot.sconti;
  tot.mesi = mesi;
  return tot;
}

/* Classifica completa: costo atteso, forchetta per le variabili, avvisi */
function rankOffers(offers, profile, market, opts) {
  opts = opts || {};
  const base = opts.mult || 1;
  const rows = offers.map(o => {
    const r = computeOffer(o, profile, market, { mult: base, start: opts.start, canoneRai: opts.canoneRai });
    let basso = r.totale, alto = r.totale;
    if (o.tipo === "indicizzato") {
      basso = computeOffer(o, profile, market, { mult: base * 0.75, start: opts.start, canoneRai: opts.canoneRai }).totale;
      alto = computeOffer(o, profile, market, { mult: base * 1.35, start: opts.start, canoneRai: opts.canoneRai }).totale;
    }
    const esclusa = offerEligibility(o, profile);
    return { offer: o, calc: r, basso, alto, esclusa, scaduta: isExpired(o) };
  });
  const key = opts.ordina === "prudente" ? (x => x.alto) : (x => x.calc.totale);
  rows.sort((a, b) => key(a) - key(b));
  return rows;
}

/* Punti di attenzione in parole semplici, per ogni offerta */
function consumerNotes(row, best, profile) {
  const o = row.offer, n = [];
  if (o.tipo === "fisso") {
    n.push({ t: "ok", s: "Prezzo bloccato per " + (o.durataMesi || 12) + " mesi: la spesa non dipende dalla borsa." });
    if ((o.durataMesi || 12) <= 12) n.push({ t: "info", s: "Alla scadenza il fornitore proporrà un nuovo prezzo: segna la data e rifai il confronto." });
  } else if (o.tipo === "indicizzato") {
    n.push({ t: "warn", s: "Prezzo variabile ogni mese: se il mercato sale si paga di più. Nell'anno la spesa può andare da " + euro(row.basso) + " a " + euro(row.alto) + "." });
  } else if (o.tipo === "regolato") {
    n.push({ t: "info", s: "Prezzo fissato da ARERA ogni tre mesi." });
  }
  if (o.quotaFissaMese >= 12) n.push({ t: "warn", s: "Quota fissa alta (" + euro2(o.quotaFissaMese) + " al mese, " + euro(o.quotaFissaMese * 12) + " l'anno anche con consumi bassi)." });
  (o.requisiti || []).forEach(r => {
    if (r === "domiciliazione") n.push({ t: "info", s: "Serve l'addebito automatico su conto corrente." });
    if (r === "bolletta_web") n.push({ t: "info", s: "Bolletta solo in formato digitale." });
    if (r === "online") n.push({ t: "info", s: "Si attiva e si gestisce online o da app." });
  });
  if (o.bonusUnaTantum) n.push({ t: "info", s: "Bonus di " + euro(o.bonusUnaTantum) + " solo il primo anno: dal secondo anno costa di più." });
  if (row.scaduta) n.push({ t: "bad", s: "Il prezzo pubblicato era valido fino al " + dataIt(o.validoFino) + ": in attesa di verifica con il prossimo aggiornamento." });
  if (o.note) n.push({ t: /recesso/i.test(o.note) ? "warn" : "info", s: o.note });
  row.esclusa.forEach(m => n.push({ t: "bad", s: m + "." }));
  return n;
}

/* Formattazione */
function euro(v) { return (v < 0 ? "−" : "") + Math.round(Math.abs(v)).toLocaleString("it-IT") + " €"; }
function euro2(v) { return v.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; }
function cent(v) { return (v * 100).toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " c€/kWh"; }
function kwhPrice(v, dec) { return v.toLocaleString("it-IT", { minimumFractionDigits: dec || 4, maximumFractionDigits: dec || 4 }); }
function numIt(v, dec) { return (+v).toLocaleString("it-IT", { maximumFractionDigits: dec == null ? 0 : dec }); }
function dataIt(iso) { if (!iso) return ""; const p = iso.slice(0, 10).split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }
function meseIt(key) { return MESI_BREVI[+key.slice(5, 7) - 1] + " " + key.slice(2, 4); }

if (typeof module !== "undefined") module.exports = { computeOffer, rankOffers, punFasce, fasciaHours, acciseKWhTassati, fasciaOf, isHoliday, addMonths, consumerNotes, normSplit };
