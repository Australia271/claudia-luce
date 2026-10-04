/* ===== App ===== */
const ANDROID = typeof window !== "undefined" && !!window.ClaudiaAndroid;
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function num(el) { const v = String(el.value || "").replace(",", "."); const n = parseFloat(v); return isFinite(n) ? n : null; }
function setNum(el, v, dec) { el.value = v == null || !isFinite(v) ? "" : (dec != null ? (+v).toFixed(dec) : v); }
function safeUrl(u) { return /^https:\/\//i.test(String(u || "")) ? String(u) : ""; }
let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 4200); }
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* non disponibile */ } }

/* ---------- Stato ---------- */
const ABITUDINI_STD = { persone: "3", presenza: "fuori", lavaggi: "sera", cucina: "gas", acqua: "gas", risc: "no", clima: "poco", auto: "no", fv: "no" };
function nuovaUtenza(nome, esempio) {
  const ab = clone(ABITUDINI_STD);
  const st = habitsModel(ab);
  return {
    id: esempio ? "esempio" : "u" + Date.now().toString(36),
    nome, esempio: !!esempio,
    kwhAnno: esempio ? 2700 : st.kwhAnno,
    potenzaKW: 3, residente: true,
    split: st.split, profiloMensile: st.profilo, fonteSplit: "abitudini",
    preferenze: { domiciliazione: true, bollettaWeb: true },
    vulnerabile: false, abitudini: ab, attuale: null
  };
}
const S = {
  market: FALLBACK.market, offers: FALLBACK.offers, status: FALLBACK.status,
  source: "fallback", dbState: "pending",
  user: { utenze: [nuovaUtenza("Esempio: famiglia di 3 persone", true)], attivaId: "esempio", offerteMie: [], vista: { tipo: "tutte", ordina: "previsto", scenario: "1", canone: false } },
  caps: { db: null, user: null, uid: null, sample: null, images: null, mcp: null, downloads: null },
  lastRows: [], chat: [], chatCtl: null, extracted: null
};
function U() { return S.user.utenze.find(u => u.id === S.user.attivaId) || S.user.utenze[0]; }

/* ---------- Salvataggio (database privato, altrimenti questo browser) ---------- */
let saveTimer = null, saveChain = Promise.resolve();
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const data = clone(S.user); data.updatedAt = new Date().toISOString();
    lsSet("wattgiusto.user", JSON.stringify(data));
    const db = S.caps.db, uid = S.caps.uid;
    if (db && uid) {
      saveChain = saveChain.then(() => db.doc("data/users/" + uid + "/watt").set(data)).then(() => { if (S.saveDenied) { S.saveDenied = false; renderStatus(); } }).catch(e => {
        if (e && e.code === "quota_exceeded") toast("Spazio del database esaurito: elimina qualche cliente o offerta aggiunta.");
        if (e && e.code === "invalid_argument") { S.saveDenied = true; renderStatus(); }
      });
    }
  }, 1200);
}
function adoptUser(data) {
  if (!data || !Array.isArray(data.utenze) || !data.utenze.length) return false;
  S.user = clone(data);
  S.user.offerteMie = S.user.offerteMie || [];
  S.user.vista = Object.assign({ tipo: "tutte", ordina: "previsto", scenario: "1", canone: false }, S.user.vista || {});
  if (!S.user.utenze.some(u => u.id === S.user.attivaId)) S.user.attivaId = S.user.utenze[0].id;
  return true;
}
function loadLocal() { const raw = lsGet("wattgiusto.user"); if (raw) { try { adoptUser(JSON.parse(raw)); } catch (e) { /* ignora */ } } }

/* ---------- Offerte considerate ---------- */
function allOffers() {
  const u = U();
  const list = S.offers.concat(S.user.offerteMie || []);
  if (u.attuale && u.attuale.tipo && !u.attuale.incompleta) list.push(Object.assign({ id: "attuale", attuale: true }, u.attuale, { fornitore: u.attuale.fornitore || "Fornitore attuale", nome: u.attuale.nome || "Offerta attuale" }));
  return list;
}

/* ---------- Stato dei dati in alto ---------- */
function renderStatus() {
  const pill = $("#dataPill"), txt = $("#dataPillText");
  const iso = (S.status && S.status.lastRun) || S.market.updatedAt;
  pill.className = "pill";
  if (S.source !== "db" && S.source !== "remote" && S.source !== "cache") {
    pill.classList.add("warn");
    txt.textContent = (ANDROID ? "Prezzi inclusi nell'app, " : "Dati salvati nella pagina, ") + dataIt(S.market.updatedAt);
  } else {
    const d = new Date(iso), ore = (Date.now() - d.getTime()) / 3.6e6;
    const hhmm = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    const oggi = new Date().toDateString() === d.toDateString();
    const ieri = new Date(Date.now() - 864e5).toDateString() === d.toDateString();
    pill.classList.add(ore < 30 ? "ok" : ore < 96 ? "warn" : "bad");
    txt.textContent = oggi ? "Dati aggiornati oggi alle " + hhmm : ieri ? "Dati aggiornati ieri alle " + hhmm : "Dati del " + d.toLocaleDateString("it-IT");
  }
  const b = $("#banner");
  if (ANDROID) {
    if (S.remoteState === "nourl") { b.hidden = false; b.textContent = "L'aggiornamento automatico dei prezzi non è ancora configurato: l'app usa i prezzi del " + dataIt(S.market.updatedAt) + ". Puoi impostarlo nella scheda Mercato."; }
    else if (S.remoteState === "offline") { b.hidden = false; b.textContent = "Non riesco a scaricare i prezzi nuovi (sei offline?). Uso quelli scaricati il " + dataIt(S.market.updatedAt) + "."; }
    else b.hidden = true;
  } else if (S.dbState === "absent") { b.hidden = false; b.textContent = "Il database dell'app non risponde in questa vista: stai vedendo i dati salvati nella pagina il " + dataIt(FALLBACK.market.updatedAt) + ". Riapri la pagina da Claude per avere i prezzi aggiornati."; }
  else if (S.saveDenied) { b.hidden = false; b.textContent = "I dati dei clienti restano solo su questo browser: con il permesso attuale non puoi salvarli nel tuo account. Chiedi a chi ti ha condiviso la pagina di darti il ruolo di Editor."; }
  else b.hidden = true;
  updateRefreshBtn();
}
function updateRefreshBtn() {
  const btn = $("#btnRefresh");
  if (ANDROID) { btn.hidden = false; btn.textContent = "Aggiorna prezzi"; return; }
  btn.hidden = !(S.caps.mcp && S.caps.isOwner && S.status && S.status.triggerId);
}

/* ---------- Classifica ---------- */
function prezzoTesto(o) {
  if (o.tipo === "indicizzato") {
    const s = o.spread || {};
    const v = s.mono != null ? s.mono : s.f1;
    return "PUN + " + kwhPrice(v || 0) + " €/kWh" + (o.spreadOltre ? " (" + kwhPrice(o.spreadOltre.spread) + " oltre " + numIt(o.spreadOltre.sogliaAnnoKWh) + " kWh)" : "");
  }
  const p = o.prezzo || {};
  if (o.fasce === "tri") return "F1 " + kwhPrice(p.f1) + " · F2 " + kwhPrice(p.f2 ?? p.f23) + " · F3 " + kwhPrice(p.f3 ?? p.f23) + " €/kWh";
  if (o.fasce === "bi") return "F1 " + kwhPrice(p.f1) + " · F23 " + kwhPrice(p.f23) + " €/kWh";
  return kwhPrice(p.mono ?? 0) + " €/kWh";
}
function tipoTag(o) {
  if (o.tipo === "fisso") return '<span class="tag fisso">Prezzo fisso' + (o.durataMesi ? " · " + o.durataMesi + " mesi" : "") + "</span>";
  if (o.tipo === "indicizzato") return '<span class="tag var">Prezzo variabile</span>';
  return '<span class="tag">Prezzo ARERA</span>';
}
function segs(c, canone) {
  const materia = Math.max(0, c.energia + c.perdite + c.dispacciamento - c.sconti);
  return [
    { k: "materia", v: materia, col: "var(--seg-materia)", t: "Energia" },
    { k: "fissa", v: c.commercializzazione, col: "var(--seg-fissa)", t: "Quota fissa" },
    { k: "rete", v: c.trasporto + c.oneri, col: "var(--seg-rete)", t: "Rete e oneri" },
    { k: "tasse", v: c.accise + c.iva + (canone || 0), col: "var(--seg-tasse)", t: "Imposte" }
  ];
}
function breakdownTable(c, o, canone) {
  const u = U();
  const r = (t, v, cls) => '<tr class="' + (cls || "") + '"><td>' + t + "</td><td>" + euro2(v) + "</td></tr>";
  return '<table class="bk">' +
    r("Energia consumata", c.energia) +
    (c.perdite ? r("Perdite di rete (10%)", c.perdite) : "") +
    (c.dispacciamento ? r("Dispacciamento", c.dispacciamento) : "") +
    r("Quota fissa del fornitore", c.commercializzazione) +
    (c.sconti ? r("Sconti e bonus", -c.sconti) : "") +
    r('<span class="same">Trasporto e contatore (' + numIt(u.potenzaKW, 1) + " kW)</span>", c.trasporto) +
    r('<span class="same">Oneri di sistema</span>', c.oneri) +
    r("Accise", c.accise) + r("IVA 10%", c.iva) +
    (canone ? r("Canone RAI", canone) : "") +
    r("Totale 12 mesi", c.totale, "tot") + "</table>";
}
function offerRow(row, pos, scale, best, cur, canone) {
  const o = row.offer, c = row.calc;
  const isBest = best && row === best, isCur = !!o.attuale;
  const tags = [tipoTag(o)];
  if (isCur) tags.unshift('<span class="tag cur">Offerta attuale</span>');
  if (o.mia) tags.push('<span class="tag cur">Aggiunta da te</span>');
  if (row.scaduta) tags.push('<span class="tag bad">Prezzo da verificare</span>');
  if (o.verde) tags.push('<span class="tag">Energia verde</span>');
  const sg = segs(c, canone);
  const bar = sg.filter(s => s.v > 0).map(s => '<span style="flex:' + s.v.toFixed(2) + ' 1 0;background:' + s.col + '" title="' + s.t + ": " + euro(s.v) + '"></span>').join("");
  let whisk = "";
  if (o.tipo === "indicizzato") whisk = '<div class="whisker" style="left:' + (row.basso / scale * 100).toFixed(2) + "%;width:" + ((row.alto - row.basso) / scale * 100).toFixed(2) + '%" title="Da ' + euro(row.basso) + " a " + euro(row.alto) + '"></div>';
  let delta = "";
  const ref = cur && !isCur ? cur : (best && !isBest ? best : null);
  if (ref) {
    const d = c.totale - ref.calc.totale;
    const lab = cur && !isCur ? (d < 0 ? "risparmia " + euro(-d) + " l'anno" : "spende " + euro(d) + " in più") : "+" + euro(d) + " rispetto alla prima";
    delta = '<div class="delta ' + (d < 0 ? "down" : "up") + '">' + lab + "</div>";
  }
  const notes = consumerNotes(row, best, U()).map(n => '<li class="' + n.t + '">' + esc(n.s) + "</li>").join("");
  const src = o.fonte ? '<p class="tiny">Dati: ' + (safeUrl(o.fonte.url) ? '<a href="' + esc(safeUrl(o.fonte.url)) + '" target="_blank" rel="noopener">' + esc(o.fonte.nome) + "</a>" : esc(o.fonte.nome)) + (o.fonte.data ? ", " + dataIt(o.fonte.data) : "") + (o.validoFino ? ". Prezzo valido fino al " + dataIt(o.validoFino) : "") + "</p>" : "";
  return '<li class="offer' + (isBest ? " is-best" : "") + (isCur ? " is-current" : "") + (row.scaduta || row.esclusa.length ? " is-dim" : "") + '">' +
    '<div class="offer-main"><div class="pos">' + (pos || "–") + "</div>" +
    '<div style="min-width:0"><div class="o-name">' + esc(o.nome) + '</div><div class="o-sup">' + esc(o.fornitore) + '</div><div class="o-tags">' + tags.join("") + '</div><div class="o-price">' + esc(prezzoTesto(o)) + " · quota fissa " + euro2(+o.quotaFissaMese || 0) + "/mese</div></div>" +
    '<div class="o-cost"><div class="tot">' + euro(c.totale) + '</div><div class="per">' + euro(c.totale / 12) + "/mese · " + cent(c.cKWh) + "</div>" + delta + "</div>" +
    '<div class="bar-wrap"><div class="bar" style="width:' + (c.totale / scale * 100).toFixed(2) + '%">' + bar + "</div>" + whisk + "</div></div>" +
    '<details class="more"><summary>Cosa sapere e dettaglio dei costi</summary><div class="more-body"><div class="stack"><ul class="notes">' + notes + "</ul>" + src + "</div>" + breakdownTable(c, o, canone) + "</div></details></li>";
}

function renderRanking() {
  const u = U(), v = S.user.vista;
  const mult = parseFloat(v.scenario) || 1;
  const start = nextMonthKey();
  const canone = v.canone && u.residente !== false ? (S.market.regolato.canoneRaiAnno || 0) : 0;
  let rows = rankOffers(allOffers(), u, S.market, { mult, start, canoneRai: v.canone, ordina: v.ordina });
  S.lastRows = rows;
  const tipoOk = r => v.tipo === "tutte" || r.offer.tipo === v.tipo || r.offer.attuale;
  const ok = rows.filter(r => !r.esclusa.length && tipoOk(r));
  const out = rows.filter(r => r.esclusa.length && tipoOk(r));
  const cur = rows.find(r => r.offer.attuale) || null;
  const best = ok.find(r => !r.scaduta && !r.offer.attuale) || null;
  // il giudizio sulla tariffa attuale guarda tutte le offerte attivabili, non solo quelle filtrate
  const key = v.ordina === "prudente" ? (r => r.alto) : (r => r.calc.totale);
  const alts = rows.filter(r => !r.esclusa.length && !r.scaduta && !r.offer.attuale);
  const judge = cur ? judgeCurrent(cur, alts, key) : null;
  const market = ok.filter(r => !r.offer.attuale);
  const scale = Math.max(1, ...ok.concat(out).map(r => Math.max(r.calc.totale, r.alto)));
  const end = addMonths(start, 11);
  $("#rankIntro").textContent = (cur ? "Le offerte di oggi, dalla più conveniente: spesa per " : "Spesa per ") + numIt(u.kwhAnno) + " kWh da " + MESI_LUNGHI[+start.slice(5) - 1] + " " + start.slice(0, 4) + " a " + MESI_LUNGHI[+end.slice(5) - 1] + " " + end.slice(0, 4) + ", tutto compreso. " + market.length + " offerte" + (cur ? "." : ", dalla più conveniente.");
  let pos = 0;
  $("#rankList").innerHTML = market.map(r => offerRow(r, ++pos, scale, best, cur, canone)).join("") || '<li class="panel">Nessuna offerta con questi filtri.</li>';
  renderCurrent(cur, judge, alts, canone);
  const box = $("#excludedBox");
  box.hidden = !out.length;
  if (out.length) {
    $("#excludedSum").textContent = out.length === 1 ? "1 offerta che non puoi attivare con le tue condizioni" : out.length + " offerte che non puoi attivare con le tue condizioni";
    $("#excludedList").innerHTML = out.map(r => offerRow(r, 0, scale, null, null, canone)).join("");
  }
  renderVerdict(best, cur, ok, canone, judge);
  $("#calcNote").textContent = "Mercato: " + (mult === 1 ? "futures del " + dataIt(S.market.forward.rilevatoAl) : (mult > 1 ? "+" : "−") + Math.round(Math.abs(mult - 1) * 100) + "% sui futures") + ". Tariffe di rete ARERA " + dataIt(S.market.regolato.validoDal) + ".";
}

function computeTips(best, cur, ok) {
  const tips = [];
  if (!best) return tips;
  const c = best.calc, o = best.offer;
  const fixed = ok.find(r => r.offer.tipo === "fisso" && !r.scaduta && !r.offer.attuale);
  const variab = ok.find(r => r.offer.tipo === "indicizzato" && !r.scaduta && !r.offer.attuale);
  if (o.tipo === "fisso" && variab) {
    tips.push({ t: "ok", s: "Oggi il prezzo fisso conviene: la migliore offerta variabile (" + variab.offer.fornitore + ") costerebbe " + euro(variab.calc.totale - c.totale) + " in più con i prezzi previsti, e fino a " + euro(variab.alto) + " se il mercato sale." });
  } else if (o.tipo === "indicizzato" && fixed) {
    const gap = fixed.calc.totale - c.totale;
    if (gap < c.totale * 0.04) tips.push({ t: "warn", s: "La variabile costa solo " + euro(gap) + " in meno del miglior prezzo fisso (" + fixed.offer.fornitore + "). Il fisso protegge dagli aumenti: per pochi euro conviene la tranquillità." });
    else tips.push({ t: "warn", s: "La variabile oggi costa meno, ma il prezzo cambia ogni mese: nell'anno la spesa può andare da " + euro(best.basso) + " a " + euro(best.alto) + ". Il miglior prezzo fisso costa " + euro(fixed.calc.totale) + "." });
  }
  const u = U();
  if (u.split && normSplit(u.split).f1 > 0.4) tips.push({ t: "info", s: "Il " + Math.round(normSplit(u.split).f1 * 100) + "% dei consumi è in F1, le ore feriali più care. Con una monoraria il prezzo è uguale a ogni ora: conviene." });
  if (u.potenzaKW > 3) tips.push({ t: "info", s: "Con " + numIt(u.potenzaKW, 1) + " kW si pagano " + euro(S.market.regolato.trasporto.quotaPotenzaKWAnno * (u.potenzaKW - 3) * 1.1) + " l'anno in più di quota potenza rispetto a 3 kW e si perde l'esenzione sulle accise. Se il contatore non salta mai, si può valutare di ridurla." });
  if (cur && cur.offer.scadenza) tips.push({ t: "info", k: "scad", s: "Il prezzo attuale è bloccato fino al " + dataIt(cur.offer.scadenza) + ". Cambiare fornitore è comunque gratuito: la disdetta la fa il nuovo fornitore." });
  return tips;
}
/* ---------- Tariffa attuale: conviene ancora? ---------- */
// Conviene se nessuna offerta attivabile di oggi costa meno di 20 € o del 2% l'anno.
function judgeCurrent(cur, alts, key) {
  const k = key || (r => r.calc.totale);
  const best = alts.slice().sort((a, b) => k(a) - k(b))[0] || null;
  const d = best ? k(cur) - k(best) : -Infinity;
  const soglia = Math.max(20, cur.calc.totale * 0.02);
  const tot = alts.map(r => r.calc.totale).sort((a, b) => a - b);
  return {
    best, d, conviene: d <= soglia, prima: d <= 0,
    pos: alts.filter(r => k(r) < k(cur)).length + 1, di: alts.length + 1,
    mediana: tot.length ? tot[Math.floor(tot.length / 2)] : null
  };
}
function currentReasons(cur, j) {
  const R = [], u = U(), o = cur.offer, c = cur.calc, b = j.best;
  const ivaF = 1 + (S.market.regolato.iva || 0.1), kwh = Math.max(1, +u.kwhAnno || 0);
  if (b) {
    const bc = b.calc, nb = b.offer.fornitore;
    const pe = x => x.energia / kwh;
    const dEn = ((c.energia + c.perdite + c.dispacciamento) - (bc.energia + bc.perdite + bc.dispacciamento)) * ivaF;
    const dQf = (c.commercializzazione - bc.commercializzazione) * ivaF;
    const dSc = (bc.sconti - c.sconti) * ivaF;
    const quanto = d => euro(Math.abs(d)) + " l'anno " + (d < 0 ? "in meno" : "in più");
    if (Math.abs(dEn) >= 1) R.push({ t: dEn < 0 ? "ok" : "bad", s: (dEn < 0 ? "Energia più economica: " : "Energia più cara: ") + "costa in media " + kwhPrice(pe(c)) + " €/kWh" + (o.tipo === "indicizzato" ? " (previsto)" : "") + " contro " + kwhPrice(pe(bc)) + " €/kWh di " + nb + ", " + quanto(dEn) + "." });
    if (Math.abs(dQf) >= 1) R.push({ t: dQf < 0 ? "ok" : "bad", s: (dQf < 0 ? "Quota fissa più bassa: " : "Quota fissa più alta: ") + euro2(c.commercializzazione / 12) + " al mese contro " + euro2(bc.commercializzazione / 12) + " di " + nb + ", " + quanto(dQf) + "." });
    if (Math.abs(dSc) >= 1) R.push({ t: dSc < 0 ? "ok" : "bad", s: "Sconti e bonus: " + euro(c.sconti * ivaF) + " l'anno contro " + euro(bc.sconti * ivaF) + " di " + nb + "." });
    if (!R.length) R.push({ t: "ok", s: "Energia e quota fissa costano quasi come la migliore alternativa (" + nb + ")." });
  }
  if (j.mediana != null) {
    const dm = j.mediana - c.totale;
    if (Math.abs(dm) >= 5) R.push({ t: dm > 0 ? "info" : "bad", s: dm > 0 ? "Rispetto a un'offerta nella media del mercato si spendono " + euro(dm) + " in meno l'anno." : "Costa " + euro(-dm) + " l'anno più di un'offerta nella media del mercato." });
  }
  if (o.tipo === "indicizzato") R.push({ t: "warn", s: "È a prezzo variabile: se il mercato cambia (da −25% a +35%), la spesa dei prossimi 12 mesi va da " + euro(cur.basso) + " a " + euro(cur.alto) + "." });
  if (o.scadenza) {
    if (o.scadenza < todayISO()) R.push({ t: "warn", s: "Il prezzo bloccato è scaduto il " + dataIt(o.scadenza) + ": controlla nella bolletta il prezzo nuovo e aggiornalo in Dati del cliente." });
    else R.push({ t: "info", s: "Prezzo bloccato fino al " + dataIt(o.scadenza) + ": verso quella data conviene rifare il controllo." });
  }
  if (!j.conviene) R.push({ t: "info", s: "Cambiare fornitore è gratuito e la luce non si interrompe: la disdetta la fa il nuovo fornitore." });
  return R;
}
function renderCurrent(cur, j, alts, canone) {
  const el = $("#current");
  if (!cur) {
    const u = U(), inc = u.attuale && u.attuale.incompleta;
    el.innerHTML = '<section class="current is-none" aria-label="Tariffa attuale"><div class="cur-band"><span>Tariffa attuale</span><span class="cur-badge">Da inserire</span></div>' +
      '<div class="cur-why"><p>' + (inc ? "Manca il prezzo dell'offerta attuale." : "Non conosco ancora l'offerta attuale del cliente.") + " Carica la bolletta o scrivi prezzo e quota fissa in <em>Dati del cliente</em>: qui comparirà subito, in verde se conviene ancora e in rosso se conviene cambiare.</p>" +
      '<div class="row" style="margin-top:10px"><button class="btn primary small" type="button" data-goto="consumi">Inserisci la tariffa attuale</button></div></div></section>';
    return;
  }
  const o = cur.offer, c = cur.calc, b = j.best, prud = S.user.vista.ordina === "prudente";
  const tipo = o.tipo === "fisso" ? "prezzo fisso" : "prezzo variabile";
  const altro = b ? esc(b.offer.fornitore + " " + b.offer.nome) : "";
  let head, text;
  if (!b) { head = "Nessuna alternativa da confrontare"; text = "Non ci sono offerte attivabili con le condizioni di questo cliente."; }
  else if (j.prima) { head = "Conviene: è la più economica"; text = "Nessuna delle " + (j.di - 1) + " offerte di oggi costa meno. La migliore alternativa, " + altro + ", costerebbe " + euro(b.calc.totale) + (j.d < -0.5 ? ", cioè " + euro(-j.d) + " in più" : "") + "."; }
  else if (j.conviene) { head = "Conviene ancora"; text = "La migliore alternativa, " + altro + ", costerebbe solo " + euro(j.d) + " in meno l'anno (" + euro(j.d / 12) + " al mese): la differenza è minima."; }
  else { head = "Non conviene: si possono risparmiare " + euro(j.d) + " l'anno"; text = "Con " + altro + " si spenderebbero " + euro(b.calc.totale) + " in 12 mesi, cioè " + euro(j.d / 12) + " in meno al mese. Le offerte più convenienti sono qui sotto, in ordine."; }
  if (prud && b) text += " Confronto fatto sulla spesa nel caso peggiore.";
  const fact = (t, v) => "<div><dt>" + t + "</dt><dd>" + v + "</dd></div>";
  const facts = fact("Posizione", j.pos + "ª su " + j.di + " offerte") +
    fact("Prezzo energia", esc(prezzoTesto(o))) +
    fact("Quota fissa", euro2(+o.quotaFissaMese || 0) + " al mese") +
    (b ? fact("Migliore alternativa", esc(b.offer.fornitore) + " · " + euro(b.calc.totale)) : "") +
    (o.scadenza ? fact("Prezzo bloccato fino al", dataIt(o.scadenza)) : "");
  const why = currentReasons(cur, j);
  el.innerHTML = '<section class="current ' + (j.conviene ? "is-ok" : "is-bad") + '" aria-label="Tariffa attuale">' +
    '<div class="cur-band"><span>Tariffa attuale</span><span class="cur-badge">' + (j.conviene ? "✓ Conviene" : "✗ Non conviene") + "</span></div>" +
    '<div class="cur-main"><div><div class="cur-who">' + esc(o.fornitore) + "<small>" + esc(o.nome) + " · " + tipo + "</small></div>" +
    '<div class="cur-digits">' + Math.round(c.totale).toLocaleString("it-IT") + '<span class="u">€ in 12 mesi</span></div>' +
    '<div class="cur-sub">' + euro(c.totale / 12) + " al mese · " + cent(c.cKWh) + " tutto compreso</div></div>" +
    '<div class="cur-verdict"><strong>' + head + "</strong><p>" + text + "</p></div></div>" +
    '<dl class="cur-facts">' + facts + "</dl>" +
    '<div class="cur-why"><div class="eyebrow">' + (j.conviene ? "Perché conviene" : "Perché non conviene") + '</div><ul class="notes">' + why.map(x => '<li class="' + x.t + '">' + esc(x.s) + "</li>").join("") + "</ul></div></section>";
}

function renderVerdict(best, cur, ok, canone, judge) {
  const el = $("#verdict"), adv = $("#advice");
  const tips = computeTips(best, cur, ok);
  S.lastPick = { best, cur, ok, tips, canone, judge };
  const advTips = cur ? tips.filter(x => x.k !== "scad") : tips;
  adv.innerHTML = advTips.length ? '<div class="panel"><div class="eyebrow" style="margin-bottom:8px">Il consiglio</div><ul class="notes">' + advTips.map(x => '<li class="' + x.t + '">' + esc(x.s) + "</li>").join("") + "</ul></div>" : "";
  // con la tariffa attuale inserita, il riquadro in cima è quello della tariffa attuale
  if (!best || cur) { el.innerHTML = ""; return; }
  const c = best.calc, o = best.offer, u = U();
  const second = ok.find(r => r !== best && !r.scaduta && !r.offer.attuale);
  const median = ok.map(r => r.calc.totale).sort((a, b) => a - b)[Math.floor(ok.length / 2)] || c.totale;
  const side = "<p>Rispetto a un'offerta nella media spende <strong>" + euro(median - c.totale) + "</strong> in meno l'anno." + (second ? " La seconda in classifica costa " + euro(second.calc.totale - c.totale) + " in più." : "") + "</p>";
  el.innerHTML = '<div class="meter" role="group" aria-label="Offerta più conveniente">' +
    '<div><div class="lbl">La più conveniente per ' + (u.esempio ? "questo cliente" : esc(u.nome)) + '</div><div class="who">' + esc(o.nome) + "<small>" + esc(o.fornitore) + " · " + (o.tipo === "fisso" ? "prezzo fisso" : o.tipo === "indicizzato" ? "prezzo variabile" : "prezzo ARERA") + '</small></div>' +
    '<div class="digits">' + Math.round(c.totale).toLocaleString("it-IT") + '<span class="u">€ in 12 mesi</span></div>' +
    '<div class="sub">' + euro(c.totale / 12) + " al mese · " + cent(c.cKWh) + " tutto compreso</div></div>" +
    '<div class="side">' + side + "</div></div>";
}

/* ---------- Proposta per il cliente (PDF) ---------- */
let jspdfPromise = null;
function loadJsPdf() { if (!jspdfPromise) jspdfPromise = loadScript(ANDROID ? "vendor/jspdf.umd.min.js" : "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js").then(() => window.jspdf.jsPDF); return jspdfPromise; }
function pdfSafe(s) { return String(s == null ? "" : s).replace(/\u2212/g, "-").replace(/\u2026/g, "...").replace(/[\u2013\u2014]/g, "-").replace(/\u00a0|\u202f/g, " ").replace(/[^\x20-\x7E\u00A0-\u00FF\u20AC\u2019\u201C\u201D\u2018]/g, ""); }
function reportData() {
  const u = U(), p = S.lastPick || {};
  const ok = (p.ok || []).filter(r => !r.scaduta && !r.offer.attuale);
  const top = ok.slice(0, 3);
  const cons = S.user.consulente || {};
  const sp = normSplit(u.split || {});
  return { u, cur: p.cur, top, tips: p.tips || [], cons, sp, oggi: new Date().toLocaleDateString("it-IT") };
}
function reportPlain(d) {
  const L = [];
  L.push("PROPOSTA OFFERTA LUCE");
  if (d.cons.nome) L.push("Preparata da " + d.cons.nome + (d.cons.recapiti ? " - " + d.cons.recapiti : ""));
  L.push("Cliente: " + d.u.nome + " - " + d.oggi, "");
  L.push("CONSUMI: " + numIt(d.u.kwhAnno) + " kWh l'anno, " + numIt(d.u.potenzaKW, 1) + " kW, " + (d.u.residente !== false ? "abitazione di residenza" : "seconda casa") + ". Fasce: F1 " + Math.round(d.sp.f1 * 100) + "%, F2 " + Math.round(d.sp.f2 * 100) + "%, F3 " + Math.round(d.sp.f3 * 100) + "%.");
  if (d.cur) L.push("OFFERTA ATTUALE: " + d.cur.offer.fornitore + " " + d.cur.offer.nome + ": spesa stimata " + euro(d.cur.calc.totale) + " in 12 mesi.");
  L.push("", "LE OFFERTE PIÙ CONVENIENTI");
  d.top.forEach((r, i) => {
    L.push((i + 1) + ". " + r.offer.fornitore + " - " + r.offer.nome + " (" + (r.offer.tipo === "fisso" ? "prezzo fisso" : "prezzo variabile") + ")");
    L.push("   " + prezzoTesto(r.offer) + ", quota fissa " + euro2(+r.offer.quotaFissaMese || 0) + "/mese");
    L.push("   Spesa stimata 12 mesi: " + euro(r.calc.totale) + " (" + euro(r.calc.totale / 12) + " al mese)" + (d.cur ? ", risparmio " + euro(d.cur.calc.totale - r.calc.totale) + " l'anno" : ""));
    consumerNotes(r, null, d.u).slice(0, 3).forEach(n => L.push("   - " + n.s));
  });
  if (d.tips.length) { L.push("", "IL CONSIGLIO"); d.tips.forEach(t => L.push("- " + t.s)); }
  L.push("", "MERCATO: " + (S.market.notaMercato || "") + " Dati aggiornati al " + dataIt(S.market.updatedAt) + ".");
  L.push("", "Stima su 12 mesi comprensiva di energia, perdite di rete, dispacciamento, quota fissa, trasporto, oneri, accise e IVA. Per le offerte variabili il prezzo futuro viene dai futures di borsa ed è una previsione. Prima di firmare verificare la scheda sintetica sul sito del fornitore. Cambiare fornitore è gratuito e la disdetta la fa il nuovo fornitore.");
  return L.join("\n");
}
async function makeReport() {
  const dl = S.caps.downloads; if (!dl) return;
  const d = reportData();
  if (!d.top.length) { toast("Non ci sono offerte valide da proporre con questi filtri."); return; }
  const btn = $("#btnReport"); btn.disabled = true;
  const fname = "proposta-luce-" + (d.u.nome || "cliente").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  try {
    const JsPDF = await loadJsPdf();
    const doc = new JsPDF({ unit: "mm", format: "a4" });
    const M = 18, W = 210 - 2 * M; let y = 20;
    const ink = [19, 33, 43], soft = [90, 104, 116], acc = [11, 92, 173], good = [29, 122, 76];
    const need = h => { if (y + h > 280) { doc.addPage(); y = 20; } };
    const text = (t, size, opt) => { opt = opt || {}; doc.setFont("helvetica", opt.bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor.apply(doc, opt.color || ink); const lines = doc.splitTextToSize(pdfSafe(t), opt.w || W); need(lines.length * size * 0.42 + 1); doc.text(lines, opt.x || M, y); y += lines.length * size * 0.42 + (opt.gap == null ? 2 : opt.gap); };
    text("Claudia Luce", 10, { bold: true, color: acc, gap: 6 });
    text("Proposta offerta luce", 20, { bold: true, gap: 3 });
    if (d.cons.nome) text("Preparata da " + d.cons.nome + (d.cons.recapiti ? " · " + d.cons.recapiti : ""), 10, { color: soft, gap: 1 });
    text("Per " + d.u.nome + " · " + d.oggi, 10, { color: soft, gap: 2 });
    doc.setDrawColor(212, 219, 224); doc.line(M, y, M + W, y); y += 8;
    text("I consumi considerati", 12, { bold: true });
    text(numIt(d.u.kwhAnno) + " kWh l'anno · potenza " + numIt(d.u.potenzaKW, 1) + " kW · " + (d.u.residente !== false ? "abitazione di residenza" : "seconda casa") + " · fasce F1 " + Math.round(d.sp.f1 * 100) + "%, F2 " + Math.round(d.sp.f2 * 100) + "%, F3 " + Math.round(d.sp.f3 * 100) + "%", 10, { gap: 2 });
    if (d.cur) text("Offerta attuale: " + d.cur.offer.fornitore + " " + d.cur.offer.nome + ". Spesa stimata nei prossimi 12 mesi: " + euro(d.cur.calc.totale) + ".", 10, { gap: 2 });
    y += 3;
    text("Le offerte più convenienti", 12, { bold: true, gap: 3 });
    d.top.forEach((r, i) => {
      need(34);
      const o = r.offer;
      doc.setFillColor(i === 0 ? 222 : 245, i === 0 ? 240 : 247, i === 0 ? 229 : 248); doc.roundedRect(M, y - 5, W, 15, 2, 2, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor.apply(doc, ink);
      doc.text(pdfSafe((i + 1) + ". " + o.fornitore + " · " + o.nome), M + 3, y);
      doc.setFontSize(14); doc.text(pdfSafe(euro(r.calc.totale)), M + W - 3, y, { align: "right" });
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor.apply(doc, soft);
      doc.text(pdfSafe((o.tipo === "fisso" ? "Prezzo fisso" + (o.durataMesi ? " " + o.durataMesi + " mesi" : "") : "Prezzo variabile") + " · " + prezzoTesto(o) + " · quota fissa " + euro2(+o.quotaFissaMese || 0) + "/mese"), M + 3, y + 6);
      doc.text(pdfSafe(euro(r.calc.totale / 12) + " al mese · 12 mesi"), M + W - 3, y + 6, { align: "right" });
      y += 15;
      if (d.cur) { const s = d.cur.calc.totale - r.calc.totale; text(s > 0 ? "Risparmio rispetto all'offerta attuale: " + euro(s) + " l'anno" : "Costa " + euro(-s) + " in più dell'offerta attuale", 10, { bold: true, color: s > 0 ? good : [178, 58, 46], gap: 1 }); }
      if (o.tipo === "indicizzato") text("Con il prezzo variabile la spesa può andare da " + euro(r.basso) + " a " + euro(r.alto) + ".", 9, { color: soft, gap: 1 });
      consumerNotes(r, null, d.u).filter(n => n.t !== "ok").slice(0, 3).forEach(n => text("- " + n.s, 9, { color: soft, gap: 0.5, x: M + 3, w: W - 3 }));
      y += 4;
    });
    if (d.tips.length) { text("Il consiglio", 12, { bold: true, gap: 2 }); d.tips.forEach(t => text("- " + t.s, 10, { gap: 1 })); y += 3; }
    text("Il mercato", 12, { bold: true, gap: 2 });
    text((S.market.notaMercato || "") + " Dati aggiornati al " + dataIt(S.market.updatedAt) + ".", 10, { gap: 5 });
    text("Come è fatta la stima: spesa dei prossimi 12 mesi comprensiva di energia, perdite di rete, dispacciamento, quota fissa, trasporto, oneri di sistema, accise e IVA. Per le offerte variabili il prezzo futuro dell'energia viene dai futures di borsa ed è una previsione. Prima di firmare verificare la scheda sintetica sul sito del fornitore. Per i clienti domestici cambiare fornitore è gratuito e la disdetta la fa il nuovo fornitore.", 8, { color: soft });
    await dl.save({ filename: fname + ".pdf", data: doc.output("blob") });
  } catch (e) {
    const c = e && e.code;
    if (c === "declined") { /* annullato */ }
    else if (c === "extension_not_enabled" || c === "rejected_extension" || !c) {
      try { await dl.save({ filename: fname + ".txt", data: reportPlain(d) }); toast("Il PDF non è disponibile qui: ho preparato la proposta come testo."); }
      catch (e2) { if (!e2 || e2.code !== "declined") toast("Non è stato possibile creare la proposta in questa vista."); }
    } else toast("Non è stato possibile creare la proposta in questa vista.");
  } finally { btn.disabled = false; }
}

function renderCtx() {
  const opts = S.user.utenze.map(u => '<option value="' + esc(u.id) + '"' + (u.id === S.user.attivaId ? " selected" : "") + ">" + esc(u.nome) + "</option>").join("");
  $("#selUtenza").innerHTML = opts; $("#selUtenza2").innerHTML = opts;
  const u = U(), sp = normSplit(u.split || {});
  $("#ctxFacts").innerHTML = (u.esempio ? '<span class="example-tag">Dati di esempio</span>' : "") +
    '<span class="fact">' + numIt(u.kwhAnno) + " kWh/anno</span>" + '<span class="fact">' + numIt(u.potenzaKW, 1) + " kW</span>" +
    '<span class="fact">' + (u.residente !== false ? "residente" : "seconda casa") + "</span>" +
    '<span class="fact">F1 ' + Math.round(sp.f1 * 100) + "% · F2 " + Math.round(sp.f2 * 100) + "% · F3 " + Math.round(sp.f3 * 100) + "%</span>";
}

function renderAll() {
  syncVistaControls(); renderStatus(); renderCtx(); renderRanking(); fillForm(); renderOffersTable(); renderMarket();
}

/* ---------- Esportazione ---------- */
async function exportCsv() {
  const d = S.caps.downloads; if (!d) return;
  const lines = [["Posizione", "Fornitore", "Offerta", "Tipo", "Prezzo", "Quota fissa €/mese", "Spesa 12 mesi €", "€/mese", "c€/kWh", "Minimo €", "Massimo €", "Fonte"].join(";")];
  let p = 0;
  S.lastRows.filter(r => !r.esclusa.length).forEach(r => {
    const o = r.offer;
    lines.push([++p, o.fornitore, o.nome, o.tipo, prezzoTesto(o), String(o.quotaFissaMese || 0).replace(".", ","), Math.round(r.calc.totale), Math.round(r.calc.totale / 12), (r.calc.cKWh * 100).toFixed(1).replace(".", ","), Math.round(r.basso), Math.round(r.alto), o.fonte ? o.fonte.url || o.fonte.nome : ""].map(x => '"' + String(x).replace(/"/g, '""') + '"').join(";"));
  });
  try { await d.save({ filename: "classifica-offerte-luce.csv", data: "﻿" + lines.join("\n") }); }
  catch (e) { if (e && e.code !== "declined") toast("Non è stato possibile scaricare il file in questa vista."); }
}

/* ---------- Consumi: modulo ---------- */
function fillForm() {
  const u = U();
  $("#inNome").value = u.nome;
  $("#inNote").value = u.noteCliente || "";
  const cons = S.user.consulente || {};
  if (document.activeElement !== $("#inConsNome")) $("#inConsNome").value = cons.nome || "";
  if (document.activeElement !== $("#inConsRec")) $("#inConsRec").value = cons.recapiti || "";
  setNum($("#inKwh"), Math.round(u.kwhAnno));
  $("#inKw").value = String(u.potenzaKW);
  $("#inRes").value = u.residente !== false ? "1" : "0";
  const sp = normSplit(u.split || {});
  setNum($("#inF1"), Math.round(sp.f1 * 100)); setNum($("#inF2"), Math.round(sp.f2 * 100)); setNum($("#inF3"), Math.round(sp.f3 * 100));
  $("#chkDom").checked = (u.preferenze || {}).domiciliazione !== false;
  $("#chkWeb").checked = (u.preferenze || {}).bollettaWeb !== false;
  $("#chkVul").checked = !!u.vulnerabile;
  const ab = Object.assign(clone(ABITUDINI_STD), u.abitudini || {});
  $("#hPersone").value = ab.persone; $("#hPresenza").value = ab.presenza; $("#hLavaggi").value = ab.lavaggi; $("#hCucina").value = ab.cucina;
  $("#hAcqua").value = ab.acqua; $("#hRisc").value = ab.risc; $("#hClima").value = ab.clima; $("#hAuto").value = ab.auto; $("#hFv").value = ab.fv;
  const a = u.attuale || {};
  $("#cFornitore").value = a.fornitore || ""; $("#cNome").value = a.nome || ""; $("#cTipo").value = a.tipo || ""; $("#cFasce").value = a.fasce || "mono";
  const pz = a.tipo === "indicizzato" ? (a.spread || {}) : (a.prezzo || {});
  if ((a.fasce || "mono") === "mono") { setNum($("#cP1"), pz.mono); $("#cP2").value = ""; $("#cP3").value = ""; }
  else if (a.fasce === "bi") { setNum($("#cP1"), pz.f1); setNum($("#cP2"), pz.f23); $("#cP3").value = ""; }
  else { setNum($("#cP1"), pz.f1); setNum($("#cP2"), pz.f2); setNum($("#cP3"), pz.f3); }
  setNum($("#cQf"), a.quotaFissaMese); $("#cScad").value = a.scadenza || "";
  updatePriceLabels("c"); renderSplitBar(); renderHabits();
}
function updatePriceLabels(p) {
  const tipo = $("#" + p + "Tipo").value, f = $("#" + p + "Fasce").value;
  const unit = tipo === "indicizzato" ? "spread €/kWh" : "€/kWh";
  const l1 = $("#" + p + "P1l"), l2 = $("#" + p + "P2l"), l3 = $("#" + p + "P3l");
  l1.textContent = f === "mono" ? (tipo === "indicizzato" ? "Spread sul PUN (€/kWh)" : "Prezzo energia (€/kWh)") : "F1 " + unit;
  l2.textContent = f === "bi" ? "F23 " + unit : "F2 " + unit;
  l3.textContent = "F3 " + unit;
  $("#" + p + "P2").closest("label").hidden = f === "mono";
  $("#" + p + "P3").closest("label").hidden = f !== "tri";
}
function readOfferFields(p) {
  const tipo = $("#" + p + "Tipo").value, f = $("#" + p + "Fasce").value;
  const a = num($("#" + p + "P1")), b = num($("#" + p + "P2")), c = num($("#" + p + "P3"));
  const vals = f === "mono" ? { mono: a } : f === "bi" ? { f1: a, f23: b } : { f1: a, f2: b, f3: c };
  const o = { tipo, fasce: f };
  if (tipo === "indicizzato") o.spread = vals; else o.prezzo = vals;
  o.quotaFissaMese = num($("#" + p + "Qf")) || 0;
  return o;
}
function readCurrent() {
  const u = U(), tipo = $("#cTipo").value;
  const o = readOfferFields("c");
  o.tipo = tipo;
  o.fornitore = $("#cFornitore").value.trim(); o.nome = $("#cNome").value.trim(); o.scadenza = $("#cScad").value || null;
  const vals = o.prezzo || o.spread;
  o.incompleta = !tipo || Object.values(vals).some(x => x == null);
  u.attuale = (!tipo && !o.fornitore && !o.nome) ? null : o;
}
function markEdited(u) { if (u.esempio) { u.esempio = false; if (/^Esempio/.test(u.nome)) { u.nome = "Nuovo cliente"; $("#inNome").value = u.nome; } } }
function onFormChange(e) {
  const u = U(), id = e.target.id;
  if (id === "inNome") { u.nome = e.target.value.trim() || "Cliente"; renderCtx(); scheduleSave(); return; }
  if (id === "inNote") { u.noteCliente = e.target.value; scheduleSave(); return; }
  if (id === "inConsNome" || id === "inConsRec") { S.user.consulente = { nome: $("#inConsNome").value.trim(), recapiti: $("#inConsRec").value.trim() }; scheduleSave(); return; }
  markEdited(u);
  if (id === "inKwh") u.kwhAnno = Math.max(0, num($("#inKwh")) || 0);
  if (id === "inKw") u.potenzaKW = parseFloat($("#inKw").value);
  if (id === "inRes") u.residente = $("#inRes").value === "1";
  if (["inF1", "inF2", "inF3"].includes(id)) { u.split = { f1: (num($("#inF1")) || 0) / 100, f2: (num($("#inF2")) || 0) / 100, f3: (num($("#inF3")) || 0) / 100 }; u.fonteSplit = "manuale"; renderSplitBar(); }
  if (id === "chkDom" || id === "chkWeb") u.preferenze = { domiciliazione: $("#chkDom").checked, bollettaWeb: $("#chkWeb").checked };
  if (id === "chkVul") u.vulnerabile = $("#chkVul").checked;
  if (/^h[A-Z]/.test(id)) { u.abitudini = { persone: $("#hPersone").value, presenza: $("#hPresenza").value, lavaggi: $("#hLavaggi").value, cucina: $("#hCucina").value, acqua: $("#hAcqua").value, risc: $("#hRisc").value, clima: $("#hClima").value, auto: $("#hAuto").value, fv: $("#hFv").value }; renderHabits(); }
  if (/^c[A-Z]/.test(id)) { if (id === "cTipo" || id === "cFasce") updatePriceLabels("c"); readCurrent(); }
  scheduleSave(); renderCtx(); renderRankingSoon();
}
let rankT;
function renderRankingSoon() { clearTimeout(rankT); rankT = setTimeout(renderRanking, 250); }
function renderSplitBar() {
  const sp = normSplit(U().split || {});
  const sum = (num($("#inF1")) || 0) + (num($("#inF2")) || 0) + (num($("#inF3")) || 0);
  $("#splitBar").innerHTML = ["f1", "f2", "f3"].map(k => '<div style="flex:' + sp[k] + ';background:var(--' + k + ')">' + k.toUpperCase() + " " + Math.round(sp[k] * 100) + "%</div>").join("");
  const src = { abitudini: "stimata dalle abitudini", bolletta: "letta dalla bolletta", curva: "calcolata dalla curva di carico", manuale: "inserita a mano" }[U().fonteSplit] || "";
  $("#splitNote").textContent = (src ? "Ripartizione " + src + ". " : "") + (Math.abs(sum - 100) > 1 ? "Le percentuali sommano a " + Math.round(sum) + ": le riporto a 100 in proporzione." : "");
}

/* ---------- Modello delle abitudini ---------- */
function habitsModel(a) {
  const P = +a.persone || 2;
  const DT = ["wd", "sat", "sun"], days = { wd: 250, sat: 50, sun: 65 };
  const occ = { wd: [], sat: [], sun: [] };
  for (let h = 0; h < 24; h++) {
    const sleep = h < 6 || h >= 23;
    let w;
    if (sleep) w = 0.15;
    else if (a.presenza === "casa") w = h >= 7 ? 1 : 0.4;
    else if (a.presenza === "meta") w = h < 8 ? 1 : h < 14 ? 0.2 : 1;
    else w = h < 8 ? 1 : h < 18 ? 0.2 : 1;
    occ.wd[h] = w;
    occ.sat[h] = sleep ? 0.15 : h < 8 ? 0.4 : (h >= 10 && h < 13) ? 0.6 : 1;
    occ.sun[h] = sleep ? 0.15 : h < 9 ? 0.4 : (h >= 10 && h < 13) ? 0.6 : 1;
  }
  const luce = h => (h >= 17 && h < 23) ? 1.6 : (h >= 6 && h < 8) ? 1.2 : 1;
  const C = [];
  C.push({ e: 450 + 60 * P, s: "luce", f: () => 1 });
  C.push({ e: (250 + 220 * P) * (a.presenza === "casa" ? 1.25 : 1), s: "luce", f: (d, h) => occ[d][h] * luce(h) });
  if (a.cucina === "induzione") C.push({ e: 250 + 80 * P, f: (d, h) => { const pranzo = d !== "wd" || a.presenza !== "fuori"; if (h === 12 || h === 13) return pranzo ? 1 : 0.05; if (h >= 19 && h < 21) return 1.3; return h === 7 ? 0.3 : 0; } });
  else C.push({ e: 120, f: (d, h) => (h >= 19 && h < 21) ? 1 : (h === 12 || h === 13) ? 0.5 : 0 });
  C.push({ e: 150 + 120 * P, f: (d, h) => {
    if (a.lavaggi === "giorno") return (d === "wd" && h >= 9 && h < 17) ? 1 : (d !== "wd" && h >= 9 && h < 13) ? 0.3 : 0;
    if (a.lavaggi === "sera") return (d === "wd" && h >= 19 && h < 23) ? 1 : (d !== "wd" && h >= 10 && h < 20) ? 0.6 : 0;
    return (h >= 23 || h < 7) ? 1 : (d === "sun" && h >= 9 && h < 19) ? 0.8 : 0; } });
  if (a.acqua === "boiler") C.push({ e: 450 + 350 * P, s: "acqua", f: (d, h) => (h >= 6 && h < 9) ? 2 : (h >= 19 && h < 23) ? 1.6 : h < 6 ? 0.5 : 0.7 });
  if (a.acqua === "boiler_timer") C.push({ e: 430 + 330 * P, s: "acqua", f: (d, h) => (h >= 23 || h < 7) ? 1 : 0 });
  if (a.acqua === "pdc") C.push({ e: 200 + 120 * P, s: "acqua", f: (d, h) => (h >= 10 && h < 17) ? 1 : 0.4 });
  if (a.risc === "pdc") C.push({ e: 1800, s: "risc", f: (d, h) => h < 6 ? 0.3 : occ[d][h] + 0.2 });
  if (a.risc === "stufe") C.push({ e: 600, s: "risc", f: (d, h) => occ[d][h] * ((h >= 17 && h < 23) ? 1.5 : 1) });
  if (a.clima === "poco" || a.clima === "molto") C.push({ e: a.clima === "molto" ? 700 : 250, s: "clima", f: (d, h) => (h >= 13 && h < 19) ? occ[d][h] * 1.3 : h >= 19 ? occ[d][h] : h < 7 ? 0.2 : 0.1 });
  if (a.auto === "notte") C.push({ e: 2000, f: (d, h) => (h >= 23 || h < 6) ? 1 : 0 });
  if (a.auto === "giorno") C.push({ e: 2000, f: (d, h) => (d === "wd" && h >= 9 && h < 18) ? 1 : (d !== "wd" && h >= 10 && h < 17) ? 1 : 0 });
  const pv = h => a.fv === "si" ? ((h >= 10 && h < 15) ? 0.55 : (h === 9 || h === 15 || h === 16) ? 0.35 : (h === 8 || h === 17) ? 0.12 : 0) : 0;
  const load = { wd: Array(24).fill(0), sat: Array(24).fill(0), sun: Array(24).fill(0) };
  C.forEach(c => {
    let S0 = 0; DT.forEach(d => { for (let h = 0; h < 24; h++) S0 += days[d] * c.f(d, h); });
    if (S0 <= 0) return;
    DT.forEach(d => { for (let h = 0; h < 24; h++) load[d][h] += c.e * c.f(d, h) / S0; });
  });
  DT.forEach(d => { for (let h = 0; h < 24; h++) load[d][h] *= (1 - pv(h)); });
  const dow = { wd: 3, sat: 6, sun: 0 };
  const F = [0, 0, 0, 0]; let tot = 0;
  DT.forEach(d => { for (let h = 0; h < 24; h++) { const e = days[d] * load[d][h]; F[fasciaOf(dow[d], h, false)] += e; tot += e; } });
  // profilo mensile
  const SEAS = {
    luce: [1.12, 1.05, 1, .95, .9, .88, .9, .85, .95, 1.05, 1.12, 1.2],
    acqua: [1.2, 1.15, 1.1, 1, .9, .8, .75, .75, .8, .95, 1.1, 1.2],
    risc: [.22, .19, .13, .05, 0, 0, 0, 0, 0, .03, .15, .23],
    clima: [0, 0, 0, 0, .03, .2, .38, .31, .08, 0, 0, 0],
    flat: Array(12).fill(1)
  };
  const prof = Array(12).fill(0);
  C.forEach(c => { const s = SEAS[c.s || "flat"]; const t = s.reduce((x, y) => x + y, 0); s.forEach((v, i) => { prof[i] += c.e * v / t; }); });
  if (a.fv === "si") { const sol = [.5, .65, .9, 1.1, 1.25, 1.3, 1.35, 1.25, 1.05, .8, .55, .45]; const red = 1 - tot / C.reduce((s, c) => s + c.e, 0); const st = sol.reduce((x, y) => x + y, 0); const T0 = prof.reduce((x, y) => x + y, 0); for (let i = 0; i < 12; i++) prof[i] = Math.max(prof[i] * 0.2, prof[i] - T0 * red * sol[i] / st); }
  const pt = prof.reduce((x, y) => x + y, 0);
  return { kwhAnno: Math.round(tot / 10) * 10, split: { f1: F[1] / tot, f2: F[2] / tot, f3: F[3] / tot }, profilo: prof.map(x => x / pt), load };
}
function currentHabits() { return { persone: $("#hPersone").value, presenza: $("#hPresenza").value, lavaggi: $("#hLavaggi").value, cucina: $("#hCucina").value, acqua: $("#hAcqua").value, risc: $("#hRisc").value, clima: $("#hClima").value, auto: $("#hAuto").value, fv: $("#hFv").value }; }
function renderHabits() {
  const m = habitsModel(currentHabits());
  const max = Math.max(...["wd", "sat", "sun"].flatMap(d => m.load[d]));
  const names = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"], dows = [1, 2, 3, 4, 5, 6, 0];
  let html = '<span></span>' + Array.from({ length: 24 }, (_, h) => '<span class="h">' + (h % 3 === 0 ? h : "") + "</span>").join("");
  names.forEach((n, i) => {
    const d = i < 5 ? "wd" : i === 5 ? "sat" : "sun";
    html += '<span class="d">' + n + "</span>";
    for (let h = 0; h < 24; h++) {
      const f = fasciaOf(dows[i], h, false), pct = Math.round(18 + 82 * m.load[d][h] / max);
      html += '<span class="c" style="background:color-mix(in srgb, var(--f' + f + ") " + pct + '%, var(--surface-2))" title="' + n + " " + h + "-" + (h + 1) + ": F" + f + '"></span>';
    }
  });
  $("#weekGrid").innerHTML = html;
  $("#habitsOut").innerHTML = "Con queste abitudini una casa consuma circa <strong class=\"num\">" + numIt(m.kwhAnno) + " kWh</strong> l'anno, così divisi: <strong class=\"num\">F1 " + Math.round(m.split.f1 * 100) + "%</strong>, <strong class=\"num\">F2 " + Math.round(m.split.f2 * 100) + "%</strong>, <strong class=\"num\">F3 " + Math.round(m.split.f3 * 100) + "%</strong>. Se hai la bolletta, i dati veri sono sempre meglio della stima.";
}
function applyHabits(withKwh) {
  const u = U(), m = habitsModel(currentHabits());
  markEdited(u);
  u.split = m.split; u.profiloMensile = m.profilo; u.fonteSplit = "abitudini"; u.abitudini = currentHabits();
  if (withKwh) u.kwhAnno = m.kwhAnno;
  scheduleSave(); renderCtx(); fillForm(); renderRanking();
  toast(withKwh ? "Fasce e consumo aggiornati dalle abitudini." : "Fasce aggiornate dalle abitudini.");
}

/* ---------- Lettura bolletta e curva di carico ---------- */
let pdfjsPromise = null;
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("load")); document.head.appendChild(s); }); }
function loadPdfJs() {
  if (!pdfjsPromise) {
    const base = ANDROID ? "vendor/" : "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
    pdfjsPromise = loadScript(base + "pdf.min.js").then(() => loadScript(base + "pdf.worker.min.js")).then(() => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.js";
      return window.pdfjsLib;
    });
  }
  return pdfjsPromise;
}
/* Legge un PDF: testo di tutte le pagine (max 8) e, se richiesto, immagini delle prime pagine.
   opts.maxSide limita il lato lungo in pixel; opts.tiles divide ogni pagina in metà
   sovrapposte, così il testo piccolo resta leggibile dopo il ridimensionamento. */
async function readPdf(file, maxImgs, opts) {
  opts = opts || {};
  const maxSide = opts.maxSide || 2200;
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  let text = "";
  const imgs = [];
  for (let i = 1; i <= Math.min(doc.numPages, 8); i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    text += "\n--- pagina " + i + " ---\n" + tc.items.map(x => x.str + (x.hasEOL ? "\n" : " ")).join("");
    if (imgs.length < maxImgs) {
      const v1 = page.getViewport({ scale: 1 });
      const scale = Math.min(2, maxSide / Math.max(v1.width, v1.height));
      const vp = page.getViewport({ scale });
      const cv = document.createElement("canvas"); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      if (opts.tiles) for (const b of await splitCanvas(cv)) { if (imgs.length < maxImgs) imgs.push(b); }
      else { const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.85)); if (blob) imgs.push(blob); }
    }
  }
  return { text, imgs, pagine: doc.numPages };
}
/* Divide un'immagine alta in metà superiore e inferiore, sovrapposte del 10% */
async function splitCanvas(cv) {
  if (cv.height < cv.width * 1.15) { const b = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.85)); return b ? [b] : []; }
  const out = [], h = Math.round(cv.height * 0.55);
  for (const y0 of [0, cv.height - h]) {
    const c2 = document.createElement("canvas"); c2.width = cv.width; c2.height = h;
    c2.getContext("2d").drawImage(cv, 0, y0, cv.width, h, 0, 0, cv.width, h);
    const b = await new Promise(r => c2.toBlob(r, "image/jpeg", 0.85)); if (b) out.push(b);
  }
  return out;
}
async function tileImage(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement("canvas"); cv.width = bmp.width; cv.height = bmp.height;
    cv.getContext("2d").drawImage(bmp, 0, 0);
    return await splitCanvas(cv);
  } catch (e) { return [blob]; }
}
const BILL_PROMPT = `Sei un esperto di bollette elettriche italiane. Leggi la bolletta (testo e/o immagini) e rispondi SOLO con un oggetto JSON con questa forma esatta:
{"fornitore":string|null,"offerta":string|null,"tipo":"fisso"|"indicizzato"|null,"consumoAnnuoKWh":number|null,"consumoAnnuoPeriodo":{"da":"AAAA-MM-GG"|null,"a":"AAAA-MM-GG"|null},"potenzaKW":number|null,"residente":true|false|null,"periodo":{"da":"AAAA-MM-GG"|null,"a":"AAAA-MM-GG"|null},"consumiPeriodoKWh":{"f1":number|null,"f2":number|null,"f3":number|null,"f23":number|null,"totale":number|null},"prezzoEnergia":{"mono":number|null,"f1":number|null,"f2":number|null,"f3":number|null,"f23":number|null},"spreadKWh":number|null,"quotaFissaMese":number|null,"scadenzaPrezzo":"AAAA-MM-GG"|null,"totaleBolletta":number|null,"note":string}
Regole:
- consumoAnnuoKWh è il "consumo annuo" che la bolletta riporta; se manca usa null. Metti in consumoAnnuoPeriodo le date a cui si riferisce: molte bollette, per forniture iniziate da poco, riportano come "consumo annuo" solo i mesi dall'inizio della fornitura.
- Se c'è una tabella dei consumi mensili per fascia, usala per consumiPeriodoKWh solo se mancano i consumi del periodo fatturato.
- prezzoEnergia: prezzo unitario della sola componente energia (spesa per la materia energia) in €/kWh, IVA esclusa, senza perdite, dispacciamento, trasporto, oneri o accise. Se l'offerta è indicizzata (PUN + spread) metti lo spread in spreadKWh e lascia null i prezzi.
- quotaFissaMese: quota fissa/commercializzazione del fornitore in €/mese IVA esclusa (converti se è espressa per anno o per giorno). Non includere la quota fissa di trasporto.
- residente: true se abitazione di residenza, false se non residente.
- Usa numeri con il punto decimale. Non inventare: se un dato non c'è, metti null.
- In "note" scrivi in italiano, in una o due frasi, cosa hai trovato e cosa manca.`;

function extractUI(html) { $("#extractOut").innerHTML = html; }
function mergeRead(a, b) {
  if (!a) return b; if (!b) return a;
  const out = Array.isArray(a) ? a.slice() : Object.assign({}, a);
  for (const k of Object.keys(b)) {
    const va = out[k], vb = b[k];
    if (va == null || va === "") out[k] = vb;
    else if (vb && typeof vb === "object" && !Array.isArray(vb) && typeof va === "object") out[k] = mergeRead(va, vb);
    else if (k === "note" && vb) out[k] = va + " " + vb;
  }
  return out;
}
async function claudeRead(prompt, text, imgs) {
  const sample = S.caps.sample;
  if (!sample) throw { code: "sampling_disabled" };
  const per = (S.caps.images && S.caps.images.maxCount) || 2;
  const list = imgs && imgs.length && S.caps.images ? imgs : [];
  const intro = text ? "\n\nTESTO ESTRATTO:\n" + text.slice(0, 20000) : "\n\nLe immagini allegate sono parti delle pagine del documento, in ordine (metà superiore e inferiore di ogni pagina).";
  if (list.length <= per) return sample.json(prompt + intro, list.length ? { images: list } : {});
  // più immagini di quante ne passano in una richiesta: leggo a gruppi e unisco
  let res = null;
  for (let i = 0; i < list.length && i < per * 3; i += per) {
    const r = await sample.json(prompt + intro + " Questo è il gruppo " + (i / per + 1) + " di immagini: compila solo ciò che vedi qui.", { images: list.slice(i, i + per) });
    res = mergeRead(res, r);
  }
  return res;
}
function sampleErrorText(e) {
  const c = e && e.code;
  if (c === "not_granted" || c === "sampling_disabled" || c === "not_declared" || c === "capability_disabled") return "Claude non è disponibile in questa vista o non hai dato il permesso. Puoi inserire i dati a mano.";
  if (c === "images_unavailable" || c === "image_rejected") return "Questa immagine non può essere letta: prova con una foto più nitida o con il PDF.";
  if (c === "rate_limited") return "Troppe richieste ravvicinate: riprova tra qualche minuto.";
  if (c === "invalid_json") return "Claude non è riuscito a leggere i dati in modo ordinato: riprova o inserisci a mano.";
  return "Lettura non riuscita. Riprova tra poco o inserisci i dati a mano.";
}
function billRowsHtml(r) {
  const rows = [];
  const add = (k, v) => { if (v != null && v !== "") rows.push("<tr><td>" + k + '</td><td class="n">' + esc(v) + "</td></tr>"); };
  add("Fornitore", r.fornitore); add("Offerta", r.offerta); add("Tipo di prezzo", r.tipo === "fisso" ? "fisso" : r.tipo === "indicizzato" ? "variabile" : null);
  const cap = r.consumoAnnuoPeriodo || {}, cov = periodCoverage(cap.da, cap.a);
  add("Consumo annuo", r.consumoAnnuoKWh != null ? numIt(r.consumoAnnuoKWh) + " kWh" + (cov && cov < 0.9 ? " (solo dal " + dataIt(cap.da) + " al " + dataIt(cap.a) + ": su 12 mesi sono circa " + numIt(Math.round(r.consumoAnnuoKWh / cov / 10) * 10) + " kWh)" : "") : null);
  add("Potenza impegnata", r.potenzaKW != null ? numIt(r.potenzaKW, 1) + " kW" : null);
  add("Abitazione", r.residente === true ? "residenza" : r.residente === false ? "seconda casa" : null);
  const cp = r.consumiPeriodoKWh || {};
  if (cp.f1 != null || cp.f2 != null || cp.f3 != null) add("Consumi per fascia", ["f1", "f2", "f3", "f23"].filter(k => cp[k] != null).map(k => k.toUpperCase() + " " + numIt(cp[k]) + " kWh").join(" · "));
  const pe = r.prezzoEnergia || {};
  const pp = ["mono", "f1", "f2", "f3", "f23"].filter(k => pe[k] != null).map(k => (k === "mono" ? "" : k.toUpperCase() + " ") + kwhPrice(pe[k]) + " €/kWh");
  if (pp.length) add("Prezzo energia", pp.join(" · "));
  add("Spread sul PUN", r.spreadKWh != null ? kwhPrice(r.spreadKWh) + " €/kWh" : null);
  add("Quota fissa", r.quotaFissaMese != null ? euro2(r.quotaFissaMese) + "/mese" : null);
  add("Prezzo bloccato fino al", r.scadenzaPrezzo ? dataIt(r.scadenzaPrezzo) : null);
  add("Totale bolletta", r.totaleBolletta != null ? euro2(r.totaleBolletta) : null);
  return rows.join("") || "<tr><td>Nessun dato riconosciuto.</td></tr>";
}
/* Appena letta la bolletta: applico i dati e dico subito se l'offerta conviene ancora */
function showBillResult(r, srcLabel) {
  const u = U();
  S.undoBill = { id: u.id, data: clone(u) };
  S.lastRead = { r, srcLabel };
  S.extracted = r;
  applyBill(true);
  renderBillVerdict();
}
function renderBillVerdict() {
  const L = S.lastRead; if (!L) return;
  const r = L.r, u = U(), p = S.lastPick || {};
  const cur = p.cur, j = p.judge, best = j && j.best;
  let head = "";
  if (cur && best) {
    const d = j.d;
    const altro = esc(best.offer.fornitore + " " + best.offer.nome) + " (" + esc(prezzoTesto(best.offer)) + ")";
    if (j.conviene) {
      head = '<div class="callout ok verdict-big"><strong>✓ La tua offerta conviene ancora.</strong><p>Con circa ' + numIt(u.kwhAnno) + " kWh l'anno spendi <strong>" + euro(cur.calc.totale) + "</strong> nei prossimi 12 mesi, tutto compreso. La migliore alternativa di oggi, " + altro + ", costerebbe " + euro(best.calc.totale) + ".</p>" + (cur.offer.scadenza ? "<p>Il prezzo è bloccato fino al " + dataIt(cur.offer.scadenza) + ": verso quella data rifai il controllo.</p>" : "") + "</div>";
    } else {
      head = '<div class="callout bad verdict-big"><strong>✗ La tua offerta non conviene più: puoi risparmiare circa ' + euro(d) + " l'anno.</strong><p>Con la tua offerta spendi " + euro(cur.calc.totale) + " nei prossimi 12 mesi. Con " + altro + " spenderesti " + euro(best.calc.totale) + ", cioè " + euro(d / 12) + " in meno al mese.</p><p>Cambiare fornitore è gratuito e la disdetta la fa il nuovo fornitore.</p></div>";
    }
  } else {
    head = '<div class="callout warn verdict-big"><strong>Mi manca il prezzo della tua offerta.</strong><p>Ho letto i consumi ma non il prezzo. Lo trovi nella bolletta, nel riquadro dell\'offerta. Scrivilo qui e ti dico subito se conviene ancora.</p>' +
      '<div class="grid3"><label class="fld" for="qfTipo">Tipo di prezzo<select id="qfTipo"><option value="fisso">Fisso</option><option value="indicizzato">Variabile (PUN + spread)</option></select></label>' +
      '<label class="fld" for="qfPrezzo"><span id="qfPrezzoL">Prezzo energia (€/kWh)</span><input type="number" id="qfPrezzo" step="0.0001" min="0" placeholder="es. 0,1450"></label>' +
      '<label class="fld" for="qfQf">Quota fissa (€/mese)<input type="number" id="qfQf" step="0.01" min="0" placeholder="es. 8,00"></label></div>' +
      '<div class="row"><button class="btn primary" type="button" id="btnQf">Controlla la mia offerta</button></div></div>';
  }
  extractUI(head + '<div class="row"><button class="btn primary" type="button" id="btnGoRank">Vedi la classifica completa</button><button class="btn" type="button" id="btnUndoBill">Annulla i dati letti</button></div>' +
    '<details class="panel"><summary class="small" style="cursor:pointer;font-weight:600">Dati letti ' + esc(L.srcLabel) + '</summary><div class="tbl-wrap" style="margin-top:10px"><table class="data">' + billRowsHtml(r) + '</table></div><p class="tiny" style="margin-top:6px">' + esc(r.note || "") + " Li trovi anche qui sotto, nei campi del cliente: puoi correggerli.</p></details>");
  try { $("#extractOut").scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) { /* ignora */ }
  $("#btnGoRank").onclick = () => { showTab("classifica"); window.scrollTo(0, 0); };
  $("#btnUndoBill").onclick = () => {
    const b = S.undoBill; if (!b) return;
    const i = S.user.utenze.findIndex(x => x.id === b.id); if (i >= 0) S.user.utenze[i] = b.data;
    S.undoBill = null; S.lastRead = null; scheduleSave(); renderAll();
    extractUI('<div class="callout">Ho rimesso i dati di prima.</div>');
  };
  const qt = $("#qfTipo");
  if (qt) {
    qt.onchange = () => { $("#qfPrezzoL").textContent = qt.value === "indicizzato" ? "Spread sul PUN (€/kWh)" : "Prezzo energia (€/kWh)"; };
    $("#btnQf").onclick = () => {
      const v = num($("#qfPrezzo")), q = num($("#qfQf"));
      if (v == null) { toast("Scrivi il prezzo della tua offerta."); return; }
      const uu = U(), tipo = qt.value;
      uu.attuale = Object.assign({ fornitore: r.fornitore || "", nome: r.offerta || "", scadenza: r.scadenzaPrezzo || null, fasce: "mono", tipo, quotaFissaMese: q || 0 }, tipo === "indicizzato" ? { spread: { mono: v } } : { prezzo: { mono: v } });
      scheduleSave(); renderCtx(); fillForm(); renderRanking(); renderBillVerdict();
    };
  }
}
/* Quota del consumo annuo tipico coperta da un periodo (profilo stagionale standard) */
function periodCoverage(da, a) {
  if (!da || !a) return null;
  const d0 = new Date(da + "T00:00:00Z"), d1 = new Date(a + "T00:00:00Z");
  if (!(d1 > d0)) return null;
  let cov = 0;
  for (let d = new Date(d0); d <= d1; d = new Date(d.getTime() + 864e5)) {
    const m = d.getUTCMonth(), dim = new Date(Date.UTC(d.getUTCFullYear(), m + 1, 0)).getUTCDate();
    cov += PROFILO_MENSILE_STD[m] / dim;
  }
  return cov;
}
function applyBill(auto) {
  const r = S.extracted; if (!r) return;
  const u = U(); markEdited(u);
  if (r.consumoAnnuoKWh > 0) {
    const pa = r.consumoAnnuoPeriodo || {};
    const cov = periodCoverage(pa.da, pa.a);
    u.kwhAnno = cov && cov < 0.9 ? Math.round(r.consumoAnnuoKWh / cov / 10) * 10 : r.consumoAnnuoKWh;
  }
  else if (r.consumiPeriodoKWh && r.consumiPeriodoKWh.totale > 0 && r.periodo && r.periodo.da && r.periodo.a) {
    const g = (new Date(r.periodo.a) - new Date(r.periodo.da)) / 864e5 + 1;
    if (g > 20) u.kwhAnno = Math.round(r.consumiPeriodoKWh.totale * 365 / g / 10) * 10;
  }
  if (r.potenzaKW > 0) u.potenzaKW = r.potenzaKW;
  if (r.residente === true || r.residente === false) u.residente = r.residente;
  const cp = r.consumiPeriodoKWh || {};
  if (cp.f1 != null && cp.f2 != null && cp.f3 != null && cp.f1 + cp.f2 + cp.f3 > 0) { u.split = { f1: cp.f1, f2: cp.f2, f3: cp.f3 }; u.split = normSplit(u.split); u.fonteSplit = "bolletta"; }
  else if (cp.f1 != null && cp.f23 != null && cp.f1 + cp.f23 > 0) { const old = normSplit(u.split || {}); const t = cp.f1 + cp.f23; const r23 = old.f2 / (old.f2 + old.f3 || 1); u.split = { f1: cp.f1 / t, f2: cp.f23 / t * r23, f3: cp.f23 / t * (1 - r23) }; u.fonteSplit = "bolletta"; }
  const pe = r.prezzoEnergia || {};
  if (r.tipo || r.spreadKWh != null || Object.values(pe).some(x => x != null)) {
    const a = { fornitore: r.fornitore || "", nome: r.offerta || "", quotaFissaMese: r.quotaFissaMese || 0, scadenza: r.scadenzaPrezzo || null };
    if (r.tipo === "indicizzato" || (r.spreadKWh != null && pe.mono == null && pe.f1 == null)) { a.tipo = "indicizzato"; a.fasce = "mono"; a.spread = { mono: r.spreadKWh || 0 }; }
    else if (pe.f1 != null && pe.f2 != null && pe.f3 != null) { a.tipo = "fisso"; a.fasce = "tri"; a.prezzo = { f1: pe.f1, f2: pe.f2, f3: pe.f3 }; }
    else if (pe.f1 != null && pe.f23 != null) { a.tipo = "fisso"; a.fasce = "bi"; a.prezzo = { f1: pe.f1, f23: pe.f23 }; }
    else if (pe.mono != null) { a.tipo = "fisso"; a.fasce = "mono"; a.prezzo = { mono: pe.mono }; }
    if (a.tipo) u.attuale = a;
  }
  S.extracted = null;
  if (!auto) extractUI('<div class="callout ok">Dati applicati. Controllali qui sotto: la classifica è già aggiornata.</div>');
  scheduleSave(); renderCtx(); fillForm(); renderRanking();
}
async function toJpeg(file) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    const b = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.88));
    return b || file;
  } catch (e) { return file; }
}
async function handleBillImages(files) {
  if (!files.length) return;
  if (ANDROID) {
    extractUI('<div class="row"><span class="spinner"></span><span>Leggo il testo della foto…</span></div>');
    try { let txt = ""; for (const f of files) txt += "\n" + await ocrBlob(await toJpeg(f)); showBillResult(localBillParse(txt), "dalla foto"); }
    catch (e) { extractUI('<div class="callout bad">Non riesco a leggere la foto. Prova con una foto più nitida e dritta, o inserisci i dati a mano.</div>'); }
    return;
  }
  if (!S.caps.sample || !S.caps.images) { extractUI('<div class="callout warn">La lettura delle foto non è disponibile in questa vista. Carica il PDF oppure inserisci i dati a mano.</div>'); return; }
  extractUI('<div class="row"><span class="spinner"></span><span>Claude sta leggendo la bolletta. Può volerci un minuto.</span></div>');
  try { const imgs = []; for (const f of files) imgs.push(...await tileImage(await toJpeg(f))); showBillResult(await claudeRead(BILL_PROMPT, "", imgs), "dalla foto"); }
  catch (e) { extractUI('<div class="callout bad">' + esc(sampleErrorText(e)) + "</div>"); }
}
async function handleBillPdf(file) {
  if (!file) return;
  extractUI('<div class="row"><span class="spinner"></span><span>Apro il PDF…</span></div>');
  let pdf;
  try { pdf = await readPdf(file, 0); }
  catch (e) { extractUI('<div class="callout bad">Non riesco ad aprire questo PDF. Se è protetto da password, scaricalo di nuovo dall\'area clienti o carica una foto.</div>'); return; }
  if (ANDROID && pdf.text.replace(/\s|-+ pagina \d+ -+/g, "").length < 200) {
    extractUI('<div class="row"><span class="spinner"></span><span>Il PDF è una scansione: leggo il testo dalle immagini…</span></div>');
    try { const p2 = await readPdf(file, 4, { maxSide: 2600 }); let txt = ""; for (const b of p2.imgs) txt += "\n" + await ocrBlob(b); showBillResult(localBillParse(txt), "dal PDF"); }
    catch (e) { extractUI('<div class="callout bad">Non riesco a leggere questo PDF: inserisci i dati a mano.</div>'); }
    return;
  }
  if (!S.caps.sample) { showBillResult(localBillParse(pdf.text), ANDROID ? "dal PDF" : "dal PDF (lettura di base)"); return; }
  const scansione = pdf.text.replace(/\s|-+ pagina \d+ -+/g, "").length < 200;
  extractUI('<div class="row"><span class="spinner"></span><span>' + (scansione ? "Il PDF è una scansione: Claude legge le pagine come immagini. Può volerci qualche minuto." : "Claude sta leggendo la bolletta. Può volerci un minuto.") + '</span></div>');
  try {
    let imgs = [];
    if (S.caps.images) imgs = (await readPdf(file, scansione ? 8 : 1, { tiles: scansione, maxSide: 2200 })).imgs;
    if (scansione && !imgs.length) { extractUI('<div class="callout warn">Questo PDF è una scansione senza testo e in questa vista Claude non può leggere immagini. Inserisci i dati a mano.</div>'); return; }
    showBillResult(await claudeRead(BILL_PROMPT, scansione ? "" : pdf.text, imgs), "dal PDF");
  }
  catch (e) { if (e && (e.code === "not_granted" || e.code === "sampling_disabled")) showBillResult(localBillParse(pdf.text), "dal PDF (lettura di base)"); else extractUI('<div class="callout bad">' + esc(sampleErrorText(e)) + "</div>"); }
}

/* Curva di carico: formati larghi (una riga per giorno, 24/48/96 colonne) o lunghi (data, ora, valore) */
function parseDateIt(s) {
  s = String(s || "").trim().replace(/"/g, "");
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[ T](\d{1,2})[:.](\d{2}))?/);
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return { y, mo: +m[2], d: +m[1], h: m[4] != null ? +m[4] : null, mi: m[5] != null ? +m[5] : 0 }; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) return { y: +m[1], mo: +m[2], d: +m[3], h: m[4] != null ? +m[4] : null, mi: m[5] != null ? +m[5] : 0 };
  return null;
}
function parseCurve(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const delim = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ";" : (lines[0].includes("\t") ? "\t" : ",");
  const toN = s => { s = String(s || "").trim().replace(/"/g, ""); if (!s) return NaN; if (delim !== "," && s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); return parseFloat(s); };
  const F = [0, 0, 0, 0], mesi = {}; const giorni = new Set(); let tot = 0, vals = [];
  const addKwh = (p, h, v) => {
    if (!isFinite(v) || v < 0) return;
    const dow = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
    const f = fasciaOf(dow, h, isHoliday(p.y, p.mo, p.d));
    F[f] += v; tot += v; const k = monthKey(p.y, p.mo); mesi[k] = (mesi[k] || 0) + v; giorni.add(k + "-" + p.d);
  };
  for (const line of lines) {
    const cells = line.split(delim);
    const di = cells.findIndex(c => parseDateIt(c));
    if (di < 0) continue;
    const p = parseDateIt(cells[di]);
    const rest = cells.slice(di + 1).map(toN);
    const numeric = rest.filter(x => isFinite(x));
    if (p.h == null && numeric.length >= 23) {
      const per = numeric.length, step = 24 / per;
      numeric.forEach((v, i) => { vals.push(v); addKwh(p, Math.min(23, Math.floor(i * step)), v); });
    } else {
      let h = p.h;
      if (h == null) { const tc = cells.slice(di + 1).find(c => /^\s*"?\d{1,2}[:.]\d{2}/.test(c)); if (tc) h = parseInt(tc.replace(/"/g, ""), 10); }
      if (h == null) continue;
      const v = numeric.length ? numeric[numeric.length - 1] : NaN;
      vals.push(v); addKwh(p, Math.min(23, h % 24), v);
    }
  }
  if (!tot) return null;
  // Wh invece di kWh?
  const sorted = vals.filter(isFinite).sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)] || 0;
  const scale = med > 30 ? 1 / 1000 : 1;
  const nGiorni = giorni.size;
  Object.keys(mesi).forEach(k => mesi[k] *= scale);
  const totK = tot * scale;
  // stima annua: correggo con il profilo stagionale standard
  let cover = 0;
  Object.keys(mesi).forEach(k => { const y = +k.slice(0, 4), m = +k.slice(5, 7); const dim = new Date(Date.UTC(y, m, 0)).getUTCDate(); const g = Array.from(giorni).filter(x => x.startsWith(k + "-")).length; cover += PROFILO_MENSILE_STD[m - 1] * g / dim; });
  const annuo = cover > 0 ? totK / cover : totK;
  let profilo = null;
  if (Object.keys(mesi).length >= 11) { profilo = Array(12).fill(0); Object.keys(mesi).forEach(k => { profilo[+k.slice(5, 7) - 1] += mesi[k]; }); }
  return { split: { f1: F[1] / tot, f2: F[2] / tot, f3: F[3] / tot }, kwhAnno: Math.round((nGiorni >= 360 ? totK * 365 / nGiorni : annuo) / 10) * 10, giorni: nGiorni, totK, profilo };
}
async function handleCsv(file) {
  if (!file) return;
  const r = parseCurve(await file.text());
  if (!r) { extractUI('<div class="callout bad">Non riconosco il formato del file. Serve un CSV con la data e i consumi in kWh per ora o per quarto d\'ora.</div>'); return; }
  extractUI('<div class="callout ok"><strong>Curva di carico letta: ' + numIt(r.giorni) + " giorni, " + numIt(r.totK) + ' kWh.</strong> Fasce reali: <span class="num">F1 ' + Math.round(r.split.f1 * 100) + "% · F2 " + Math.round(r.split.f2 * 100) + "% · F3 " + Math.round(r.split.f3 * 100) + '%</span>. Consumo annuo stimato: <span class="num">' + numIt(r.kwhAnno) + " kWh</span>" + (r.giorni < 330 ? " (calcolato da meno di un anno di dati, corretto per la stagione)" : "") + '.</div><div class="row"><button class="btn primary" type="button" id="btnApplyCurve">Usa questi dati</button><button class="btn" type="button" id="btnApplyCurveSplit">Usa solo le fasce</button></div>');
  const apply = withKwh => { const u = U(); markEdited(u); u.split = r.split; u.fonteSplit = "curva"; if (withKwh) u.kwhAnno = r.kwhAnno; if (r.profilo) u.profiloMensile = r.profilo; scheduleSave(); renderCtx(); fillForm(); renderRanking(); extractUI('<div class="callout ok">Dati della curva applicati.</div>'); };
  $("#btnApplyCurve").onclick = () => apply(true);
  $("#btnApplyCurveSplit").onclick = () => apply(false);
}
function wireDrop(el, handler) {
  el.addEventListener("dragover", e => { e.preventDefault(); el.classList.add("over"); });
  el.addEventListener("dragleave", () => el.classList.remove("over"));
  el.addEventListener("drop", e => { e.preventDefault(); el.classList.remove("over"); handler(Array.from(e.dataTransfer.files || [])); });
}
function routeBillFiles(files) {
  const pdf = files.find(f => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
  const csv = files.find(f => /\.(csv|txt)$/i.test(f.name) || /csv/.test(f.type));
  const imgs = files.filter(f => /^image\//.test(f.type));
  if (pdf) handleBillPdf(pdf); else if (csv) handleCsv(csv); else if (imgs.length) handleBillImages(imgs);
}

/* ---------- Catalogo offerte ---------- */
function renderOffersTable() {
  const q = ($("#offSearch").value || "").toLowerCase();
  const list = S.offers.concat(S.user.offerteMie || []).filter(o => !q || (o.fornitore + " " + o.nome).toLowerCase().includes(q));
  $("#offIntro").textContent = S.offers.length + " offerte raccolte dai comparatori e dai siti dei fornitori" + (S.user.offerteMie.length ? ", più " + S.user.offerteMie.length + " aggiunte da te" : "") + ". Il prezzo è IVA esclusa, senza perdite di rete e oneri.";
  $("#offTable").innerHTML = "<thead><tr><th>Fornitore</th><th>Offerta</th><th>Tipo</th><th>Prezzo energia</th><th>Quota fissa</th><th>Valida fino</th><th>Fonte</th><th></th></tr></thead><tbody>" +
    list.map(o => "<tr><td>" + esc(o.fornitore) + "</td><td>" + esc(o.nome) + "</td><td>" + (o.tipo === "fisso" ? "Fisso" : o.tipo === "indicizzato" ? "Variabile" : "ARERA") + '</td><td class="n">' + esc(prezzoTesto(o)) + '</td><td class="n">' + euro2(+o.quotaFissaMese || 0) + '/mese</td><td class="n">' + (o.validoFino ? (isExpired(o) ? '<span style="color:var(--bad)">' + dataIt(o.validoFino) + "</span>" : dataIt(o.validoFino)) : "–") + "</td><td>" + (o.mia ? "Tu" : o.fonte && safeUrl(o.fonte.url) ? '<a href="' + esc(safeUrl(o.fonte.url)) + '" target="_blank" rel="noopener">' + esc(o.fonte.nome) + "</a>" : esc(o.fonte ? o.fonte.nome : "")) + "</td><td>" + (o.mia ? '<button class="btn small" type="button" data-del-offer="' + esc(o.id) + '">Elimina</button>' : "") + "</td></tr>").join("") + "</tbody>";
}
const OFFER_PROMPT = `Leggi questa scheda sintetica / proposta di un'offerta luce per clienti domestici italiani e rispondi SOLO con un JSON:
{"fornitore":string|null,"nome":string|null,"tipo":"fisso"|"indicizzato"|null,"fasce":"mono"|"bi"|"tri","prezzo":{"mono":number|null,"f1":number|null,"f2":number|null,"f3":number|null,"f23":number|null},"spread":{"mono":number|null,"f1":number|null,"f23":number|null},"quotaFissaMese":number|null,"scontiAnno":number|null,"durataMesi":number|null,"note":string}
Prezzi e spread in €/kWh IVA esclusa per la sola energia; quotaFissaMese in €/mese (converti da €/anno). In "note" scrivi in italiano condizioni importanti: bonus, penali, obblighi di domiciliazione, scadenza. Non inventare: se manca metti null.`;
function fillOfferForm(r) {
  $("#nFornitore").value = r.fornitore || ""; $("#nNome").value = r.nome || "";
  $("#nTipo").value = r.tipo === "indicizzato" ? "indicizzato" : "fisso";
  const src = r.tipo === "indicizzato" ? (r.spread || {}) : (r.prezzo || {});
  let f = r.fasce || "mono";
  if (f === "mono" && src.mono == null && src.f1 != null) f = src.f2 != null ? "tri" : "bi";
  $("#nFasce").value = f;
  if (f === "mono") setNum($("#nP1"), src.mono); else if (f === "bi") { setNum($("#nP1"), src.f1); setNum($("#nP2"), src.f23); } else { setNum($("#nP1"), src.f1); setNum($("#nP2"), src.f2); setNum($("#nP3"), src.f3); }
  setNum($("#nQf"), r.quotaFissaMese); setNum($("#nSconto"), r.scontiAnno); setNum($("#nDurata"), r.durataMesi); $("#nNote").value = r.note || "";
  updatePriceLabels("n");
}
async function handleOfferFiles(files) {
  const pdf = files.find(f => /\.pdf$/i.test(f.name) || /pdf/.test(f.type));
  const imgs = files.filter(f => /^image\//.test(f.type));
  const out = $("#offExtractOut");
  if (ANDROID) {
    out.innerHTML = '<div class="row"><span class="spinner"></span><span>Leggo la scheda…</span></div>';
    try {
      let text = "";
      if (pdf) { const p = await readPdf(pdf, 0); text = p.text; if (text.replace(/\s|-+ pagina \d+ -+/g, "").length < 200) { const p2 = await readPdf(pdf, 2); text = ""; for (const b of p2.imgs) text += "\n" + await ocrBlob(b); } }
      else for (const f of imgs) text += "\n" + await ocrBlob(await toJpeg(f));
      fillOfferForm(localOfferParse(text));
      out.innerHTML = '<div class="callout ok">Ho compilato i campi che ho riconosciuto. Controllali e completa quelli vuoti prima di aggiungere l\'offerta.</div>';
    } catch (e) { out.innerHTML = '<div class="callout bad">Non riesco a leggere la scheda: compila i campi a mano.</div>'; }
    return;
  }
  if (!S.caps.sample) { out.innerHTML = '<div class="callout warn">Claude non è disponibile in questa vista: compila i campi a mano.</div>'; return; }
  out.innerHTML = '<div class="row"><span class="spinner"></span><span>Claude sta leggendo la scheda…</span></div>';
  try {
    let text = "", im = await Promise.all(imgs.map(toJpeg));
    if (pdf) { const p = await readPdf(pdf, S.caps.images ? 2 : 0); text = p.text; im = p.imgs; }
    else if (!S.caps.images) { out.innerHTML = '<div class="callout warn">In questa vista Claude non può leggere immagini: usa il PDF o compila a mano.</div>'; return; }
    const r = await claudeRead(OFFER_PROMPT, text.trim().length > 200 ? text : "", im);
    fillOfferForm(r);
    out.innerHTML = '<div class="callout ok">Campi compilati dalla scheda. Controllali e premi "Aggiungi alla classifica".</div>';
  } catch (e) { out.innerHTML = '<div class="callout bad">' + esc(sampleErrorText(e)) + "</div>"; }
}
function submitOffer(e) {
  e.preventDefault();
  const o = readOfferFields("n");
  const vals = o.prezzo || o.spread;
  const msg = $("#offFormMsg");
  if (!$("#nFornitore").value.trim() || !$("#nNome").value.trim()) { msg.textContent = "Scrivi fornitore e nome dell'offerta."; return; }
  if (Object.values(vals).some(x => x == null)) { msg.textContent = "Inserisci tutti i prezzi richiesti."; return; }
  Object.assign(o, { id: "mia-" + Date.now().toString(36), mia: true, fornitore: $("#nFornitore").value.trim(), nome: $("#nNome").value.trim(), durataMesi: num($("#nDurata")) || null, note: $("#nNote").value.trim() || null, fonte: { nome: "Aggiunta da te", data: todayISO() } });
  const sc = num($("#nSconto")); if (sc) o.sconti = [{ descrizione: "Sconti", euroAnno: sc }];
  S.user.offerteMie.push(o);
  scheduleSave(); renderOffersTable(); renderRanking();
  $("#offForm").reset(); updatePriceLabels("n"); msg.textContent = "";
  toast("Offerta aggiunta alla classifica.");
}

/* ---------- Mercato ---------- */
function renderMarket() {
  const m = S.market;
  $("#mktNote").textContent = m.notaMercato || "";
  $("#punAsOf").textContent = "Futures rilevati il " + dataIt(m.forward.rilevatoAl);
  renderPunChart();
  const st = m.pun.storico.slice(-6).concat(m.pun.meseCorrente ? [m.pun.meseCorrente] : []);
  $("#punTable").innerHTML = '<thead><tr><th>Mese</th><th style="text-align:right">PUN</th><th style="text-align:right">F1</th><th style="text-align:right">F2</th><th style="text-align:right">F3</th></tr></thead><tbody>' +
    st.reverse().map(r => "<tr><td>" + meseIt(r.mese) + (r.parziale ? " (fino al " + dataIt(r.aggiornatoAl).slice(0, 5) + ")" : "") + '</td><td class="n">' + kwhPrice(r.mono) + '</td><td class="n">' + kwhPrice(r.f1) + '</td><td class="n">' + kwhPrice(r.f2) + '</td><td class="n">' + kwhPrice(r.f3) + "</td></tr>").join("") + "</tbody>";
  const g = m.regolato, d = g.dispacciamento || {};
  const R = (a, b, c) => "<tr><td>" + a + '</td><td class="n">' + b + "</td><td>" + (c || "") + "</td></tr>";
  $("#regTable").innerHTML = "<thead><tr><th>Voce</th><th style=\"text-align:right\">Valore</th><th>Note</th></tr></thead><tbody>" +
    R("Trasporto: quota fissa", euro2(g.trasporto.quotaFissaAnno) + "/anno") +
    R("Trasporto: quota potenza", euro2(g.trasporto.quotaPotenzaKWAnno) + "/kW/anno", "Con 3 kW: " + euro2(g.trasporto.quotaPotenzaKWAnno * 3) + " l'anno") +
    R("Trasporto: quota energia", kwhPrice(g.trasporto.quotaEnergiaKWh, 5) + " €/kWh") +
    R("Oneri di sistema, residenti", kwhPrice(g.oneri.residente.quotaEnergiaKWh, 5) + " €/kWh") +
    R("Oneri di sistema, seconde case", euro2(g.oneri.nonResidente.quotaFissaAnno) + "/anno + " + kwhPrice(g.oneri.nonResidente.quotaEnergiaKWh, 5) + " €/kWh") +
    R("Accise", kwhPrice(g.accise.aliquotaKWh, 4) + " €/kWh", "Residenti fino a 3 kW: esenti i primi 150 kWh al mese, esenzione ridotta oltre 220 kWh") +
    R("IVA", Math.round(g.iva * 100) + "%") +
    R("Perdite di rete", Math.round(g.perdite * 100) + "%", "Applicate all'energia nelle offerte del mercato libero") +
    R("Dispacciamento", kwhPrice((d.energiaKWh || 0) + (d.capacitaKWh || 0), 4) + " €/kWh", esc(d.nota || "")) +
    R("Canone RAI", euro2(g.canoneRaiAnno || 0) + "/anno", "Solo residenti, uguale per tutti") + "</tbody>";
  const runs = (S.status && S.status.runs) || [];
  $("#runLog").innerHTML = runs.length ? '<ul class="notes">' + runs.slice(0, 8).map(r => '<li class="' + (r.esito === "ok" ? "ok" : "warn") + '">' + esc(new Date(r.at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })) + " · " + esc(r.note || "") + "</li>").join("") + "</ul>" : "Nessun aggiornamento registrato.";
  const fonti = [{ nome: m.pun.fonte, url: m.pun.url }, { nome: m.forward.fonte, url: m.forward.url }].concat(g.fonti || []);
  $("#srcList").innerHTML = '<div class="eyebrow" style="margin:10px 0 4px">Fonti</div>' + fonti.map(f => safeUrl(f.url) ? '<div><a href="' + esc(safeUrl(f.url)) + '" target="_blank" rel="noopener">' + esc(f.nome) + "</a></div>" : "<div>" + esc(f.nome) + "</div>").join("");
}
function renderPunChart() {
  const m = S.market;
  const pts = m.pun.storico.map(r => ({ k: r.mese, v: r.mono, t: "PUN" }));
  if (m.pun.meseCorrente) pts.push({ k: m.pun.meseCorrente.mese, v: m.pun.meseCorrente.mono, t: "PUN parziale" });
  const lastHist = pts[pts.length - 1].k;
  const fw = m.forward.mesi.filter(x => x.mese >= lastHist).slice(0, 16).map(x => ({ k: x.mese, v: x.v / 1000, t: "Futures" }));
  const first = pts[0].k, last = fw.length ? fw[fw.length - 1].k : lastHist;
  const idx = k => (+k.slice(0, 4) - +first.slice(0, 4)) * 12 + (+k.slice(5, 7) - +first.slice(5, 7));
  const N = idx(last);
  const W = 720, H = 250, L = 46, R = 30, T = 14, B = 30;
  const maxV = Math.ceil(Math.max(...pts.map(p => p.v), ...fw.map(p => p.v)) / 0.05) * 0.05;
  const x = i => L + (W - L - R) * i / N, y = v => T + (H - T - B) * (1 - v / maxV);
  let g = '<g class="grid">';
  for (let v = 0; v <= maxV + 1e-9; v += 0.05) g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"></line><text x="' + (L - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + v.toFixed(2).replace(".", ",") + "</text>";
  g += "</g>";
  let xl = "";
  for (let i = 0; i <= N; i++) { const k = addMonths(first, i); if (+k.slice(5, 7) % 3 === 1) xl += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle">' + meseIt(k) + "</text>"; }
  const line = arr => arr.map((p, j) => (j ? "L" : "M") + x(idx(p.k)).toFixed(1) + " " + y(p.v).toFixed(1)).join(" ");
  const area = line(pts) + " L" + x(idx(lastHist)).toFixed(1) + " " + y(0) + " L" + x(0) + " " + y(0) + " Z";
  const now = idx(lastHist);
  const lp = pts[pts.length - 1];
  const svg = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="PUN mensile dal ' + meseIt(first) + " e futures fino a " + meseIt(last) + '">' + g +
    '<path d="' + area + '" fill="var(--accent)" fill-opacity="0.10"></path>' +
    '<line x1="' + x(now).toFixed(1) + '" x2="' + x(now).toFixed(1) + '" y1="' + T + '" y2="' + (H - B) + '" stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="2 3"></line>' +
    '<text x="' + (x(now) + 4).toFixed(1) + '" y="' + (T + 10) + '">oggi</text>' +
    (fw.length ? '<path d="' + line([lp].concat(fw.filter(p => p.k > lp.k))) + '" fill="none" stroke="var(--ink-3)" stroke-width="2" stroke-dasharray="6 4"></path>' : "") +
    '<path d="' + line(pts) + '" fill="none" stroke="var(--accent)" stroke-width="2.25" stroke-linejoin="round"></path>' +
    '<circle cx="' + x(now).toFixed(1) + '" cy="' + y(lp.v).toFixed(1) + '" r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"></circle>' +
    '<text x="' + (x(now) - 8).toFixed(1) + '" y="' + (y(lp.v) - 10).toFixed(1) + '" text-anchor="end" style="fill:var(--ink);font-weight:600">' + kwhPrice(lp.v, 3) + " €/kWh</text>" +
    xl + '<rect id="punHit" x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - T - B) + '" fill="transparent"></rect></svg>';
  const box = $("#punChartBox");
  box.innerHTML = svg + '<div class="tip" id="punTip" hidden></div>';
  const all = {}; fw.forEach(p => all[p.k] = p); pts.forEach(p => all[p.k] = p);
  const hit = $("#punHit"), tip = $("#punTip"), svgEl = box.querySelector("svg");
  const move = ev => {
    const rc = svgEl.getBoundingClientRect(); const cx = (ev.clientX - rc.left) / rc.width * W;
    const i = Math.max(0, Math.min(N, Math.round((cx - L) / (W - L - R) * N))); const k = addMonths(first, i); const p = all[k];
    if (!p) { tip.hidden = true; return; }
    tip.hidden = false; tip.textContent = meseIt(k) + " · " + p.t + " " + kwhPrice(p.v, 4) + " €/kWh";
    tip.style.left = (x(i) / W * rc.width) + "px"; tip.style.top = (y(p.v) / H * rc.height) + "px";
  };
  hit.addEventListener("mousemove", move); hit.addEventListener("mouseleave", () => { tip.hidden = true; });
}

/* ---------- Chiedi a Claude ---------- */
function chatContext() {
  const u = U();
  const top = S.lastRows.filter(r => !r.esclusa.length).slice(0, 10).map((r, i) => ({ pos: i + 1, fornitore: r.offer.fornitore, offerta: r.offer.nome, tipo: r.offer.tipo, prezzo: prezzoTesto(r.offer), quotaFissaMese: r.offer.quotaFissaMese, spesa12mesi: Math.round(r.calc.totale), minimo: Math.round(r.basso), massimo: Math.round(r.alto), prezzoScaduto: r.scaduta, attuale: !!r.offer.attuale, note: r.offer.note || null }));
  const fw = S.market.forward.mesi.slice(0, 12).map(x => x.mese + ": " + (x.v / 1000).toFixed(3));
  return JSON.stringify({ oggi: todayISO(), utenza: { consumoAnnuoKWh: u.kwhAnno, potenzaKW: u.potenzaKW, residente: u.residente !== false, fasce: normSplit(u.split || {}), offertaAttuale: u.attuale, abitudini: u.abitudini, esempio: u.esempio }, classifica: top, mercato: { punUltimiMesi: S.market.pun.storico.slice(-6), punMeseCorrente: S.market.pun.meseCorrente, futuresEuroKWh: fw, nota: S.market.notaMercato }, regolato: S.market.regolato });
}
const CHAT_RULES = "Stai aiutando una consulente energetica che usa l'app Claudia Luce per confrontare le offerte luce per un suo cliente. Rispondi a lei in italiano semplice, breve e concreto, mettendo al primo posto l'interesse del cliente. Usa i numeri dei DATI qui sotto (spese su 12 mesi già comprensive di tasse, perdite, oneri e quota fissa); non inventare offerte o prezzi che non ci sono. Distingui stime e certezze. Se consigli di cambiare, ricorda di controllare la scheda sintetica sul sito del fornitore. Niente tabelle lunghe, al massimo un elenco breve.\n\nDATI:\n";
function renderChat() {
  $("#chatLog").innerHTML = S.chat.map(m => '<div class="msg ' + (m.role === "user" ? "u" : "a") + '">' + esc(m.content) + "</div>").join("");
}
async function sendChat(text) {
  text = (text || "").trim(); if (!text) return;
  const sample = S.caps.sample;
  if (!sample) { $("#chatNote").textContent = "Claude non è disponibile in questa vista."; return; }
  S.chat.push({ role: "user", content: text }); renderChat();
  $("#chatIn").value = "";
  const hist = S.chat.slice(-10); while (hist.length && hist[0].role !== "user") hist.shift();
  const turns = [{ role: "user", content: CHAT_RULES + chatContext() }].concat(hist);
  const bubble = document.createElement("div"); bubble.className = "msg a"; bubble.textContent = "Sto pensando…"; $("#chatLog").appendChild(bubble);
  const ctl = new AbortController(); S.chatCtl = ctl;
  $("#chatSend").disabled = true; $("#chatStop").hidden = false;
  try {
    const r = await sample(turns, { cache: false, signal: ctl.signal, onText: ({ text }) => { bubble.textContent = text; } });
    S.chat.push({ role: "assistant", content: r.text });
    if (r.truncated) $("#chatNote").textContent = "Risposta interrotta perché troppo lunga: chiedi una cosa alla volta.";
  } catch (e) {
    if (e && e.text) S.chat.push({ role: "assistant", content: e.text });
    else S.chat.pop();
    if (!e || e.code !== "cancelled") $("#chatNote").textContent = sampleErrorText(e);
  } finally {
    $("#chatSend").disabled = false; $("#chatStop").hidden = true; renderChat();
  }
}

/* ---------- Aggiorna adesso ---------- */
async function refreshNow() {
  const btn = $("#btnRefresh"); btn.disabled = true;
  try {
    await S.caps.mcp.callTool("Claude Code Remote", "fire_trigger", { trigger_id: S.status.triggerId, text: "Aggiornamento richiesto dall'app alle " + new Date().toLocaleString("it-IT") });
    toast("Aggiornamento avviato: i nuovi dati compaiono qui da soli tra qualche minuto.");
  } catch (e) {
    const c = e && e.code;
    if (c === "server_not_connected" || c === "needs_reauth") toast("Collega 'Claude Code Remote' nelle impostazioni dei connettori di Claude per aggiornare da qui.");
    else if (c === "not_in_manifest" || c === "not_granted") toast("Permesso non concesso: l'aggiornamento automatico quotidiano resta attivo.");
    else if (c === "tool_error") toast("L'aggiornamento non è partito: " + (e.message || "errore del servizio") + ".");
    else toast("L'aggiornamento non è partito. Riprova più tardi: quello quotidiano resta attivo.");
  } finally { setTimeout(() => { btn.disabled = false; }, 60000); }
}

/* ---------- Collegamento alle capacità della pagina ---------- */
function initCaps() {
  if (ANDROID) { initAndroid(); return; }
  const c = window.claude;
  if (!c || typeof c.use !== "function") { S.dbState = "absent"; loadLocal(); renderAll(); return; }
  c.use("db").then(async db => {
    S.caps.db = db;
    if (!db) { S.dbState = "absent"; loadLocal(); renderAll(); return; }
    S.dbState = "ok";
    db.doc("market/current").onSnapshot(s => { if (s.exists && s.data().regolato && s.data().pun) { S.market = s.data(); S.source = "db"; renderAll(); } }, () => {});
    db.collection("offers").onSnapshot(qs => { if (!qs.empty) { S.offers = qs.docs.map(d => d.data()).filter(o => o && o.fornitore && o.tipo && o.attiva !== false); renderAll(); } }, () => {});
    db.doc("meta/status").onSnapshot(s => { if (s.exists) { S.status = s.data(); renderStatus(); renderMarket(); } }, () => {});
    const user = await c.use("user"); S.caps.user = user;
    const uid = user ? await user.id().catch(() => null) : null; S.caps.uid = uid;
    S.caps.isOwner = user ? await user.isOwner().catch(() => false) : false; updateRefreshBtn();
    if (uid) {
      try { const snap = await db.doc("data/users/" + uid + "/watt").get(); if (!(snap.exists && adoptUser(snap.data()))) { loadLocal(); if (S.user.utenze.some(u => !u.esempio)) scheduleSave(); } }
      catch (e) { loadLocal(); }
    } else loadLocal();
    renderAll();
  });
  c.use("sample").then(async s => {
    S.caps.sample = s;
    if (s) { const lim = await s.limits().catch(() => null); S.caps.images = lim && lim.images ? lim.images : null; }
    $("#chatNote").textContent = s ? "Le risposte usano il tuo account Claude." : "Claude non è disponibile in questa vista.";
  });
  c.use("mcp").then(m => { S.caps.mcp = m; updateRefreshBtn(); });
  c.use("downloads").then(d => { S.caps.downloads = d; $("#btnExport").hidden = !d; $("#reportRow").hidden = !d; });
}

/* ---------- Versione Android ---------- */
const _ocrCb = {};
window.__ocrDone = function (id, text, err) { const cb = _ocrCb[id]; if (!cb) return; delete _ocrCb[id]; if (err) cb.reject(new Error(err)); else cb.resolve(text || ""); };
function blobToBase64(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(blob); }); }
async function ocrBlob(blob) {
  const b64 = await blobToBase64(blob);
  const id = "o" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  return new Promise((resolve, reject) => { _ocrCb[id] = { resolve, reject }; window.ClaudiaAndroid.ocr(b64, id); setTimeout(() => { if (_ocrCb[id]) { delete _ocrCb[id]; reject(new Error("timeout")); } }, 60000); });
}
function mimeFor(name) { return /\.pdf$/i.test(name) ? "application/pdf" : /\.csv$/i.test(name) ? "text/csv" : /\.json$/i.test(name) ? "application/json" : "text/plain"; }
const androidDownloads = {
  save: async ({ filename, data }) => {
    const blob = typeof data === "string" ? new Blob([data], { type: mimeFor(filename) }) : data;
    window.ClaudiaAndroid.saveFile(filename, mimeFor(filename), await blobToBase64(blob));
  }
};
function applyRemote(d) {
  if (!d || !d.market || !d.market.regolato || !d.market.pun || !Array.isArray(d.offers)) return false;
  S.market = d.market; S.offers = d.offers.filter(o => o && o.fornitore && o.tipo && o.attiva !== false); S.status = d.status || S.status;
  return true;
}
async function loadRemoteData(manual) {
  let url = lsGet("claudia.dataUrl");
  if (url == null || url === "") { try { url = window.ClaudiaAndroid.dataUrl() || ""; } catch (e) { url = ""; } }
  $("#inDataUrl").value = url;
  if (!url) { S.remoteState = "nourl"; renderAll(); if (manual) toast("Imposta prima l'indirizzo del file prezzi nella scheda Mercato."); return; }
  const btn = $("#btnRefresh"); btn.disabled = true;
  try {
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("http " + r.status);
    const txt = await r.text();
    if (!applyRemote(JSON.parse(txt))) throw new Error("formato");
    lsSet("claudia.dataCache", txt);
    S.source = "remote"; S.remoteState = "ok"; S.lastFetch = Date.now();
    if (manual) toast("Prezzi aggiornati al " + dataIt(S.market.updatedAt) + ".");
  } catch (e) {
    S.remoteState = "offline";
    if (manual) toast("Non riesco a scaricare i prezzi: controlla la connessione o l'indirizzo.");
  } finally { btn.disabled = false; renderAll(); }
}
function initAndroid() {
  S.dbState = "android";
  S.caps.downloads = androidDownloads;
  $("#btnExport").hidden = false; $("#reportRow").hidden = false;
  $("#tab-claude").hidden = true;
  $("#androidData").hidden = false;
  loadLocal();
  const cache = lsGet("claudia.dataCache");
  if (cache) { try { if (applyRemote(JSON.parse(cache))) S.source = "cache"; } catch (e) { /* ignora */ } }
  renderAll();
  loadRemoteData(false);
  // anche quando l'app torna in primo piano dopo essere rimasta aperta in sottofondo:
  // riscarica i prezzi se l'ultimo download riuscito è di più di un'ora fa (o non è mai riuscito)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - (S.lastFetch || 0) > 3600e3) loadRemoteData(false);
  });
}

/* ---------- Backup dei dati ---------- */
async function exportBackup() {
  const d = S.caps.downloads;
  if (!d) { toast("Il salvataggio di file non è disponibile in questa vista."); return; }
  const data = JSON.stringify({ app: "Claudia Luce", tipo: "backup", creato: new Date().toISOString(), dati: S.user }, null, 1);
  try { await d.save({ filename: "claudia-luce-backup-" + todayISO() + ".json", data }); }
  catch (e) { if (!e || e.code !== "declined") toast("Non è stato possibile salvare il backup."); }
}
async function importBackup(file) {
  if (!file) return;
  let j;
  try { j = JSON.parse(await file.text()); } catch (e) { toast("Questo file non è un backup di Claudia Luce."); return; }
  const dati = j && j.dati;
  if (!dati || !Array.isArray(dati.utenze)) { toast("Questo file non è un backup di Claudia Luce."); return; }
  const box = $("#backupConfirm");
  box.hidden = false;
  $("#backupConfirmText").textContent = "Il backup contiene " + dati.utenze.length + " clienti. Vuoi sostituire i dati attuali?";
  $("#btnBackupYes").onclick = () => { if (adoptUser(dati)) { scheduleSave(); renderAll(); toast("Backup ripristinato."); } box.hidden = true; };
  $("#btnBackupNo").onclick = () => { box.hidden = true; };
}

/* ---------- Avvio ---------- */
function showTab(t) {
  $$(".tab").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
  $$("[data-sec]").forEach(s => { s.hidden = s.dataset.sec !== t; });
  lsSet("wattgiusto.tab", t);
  if (t === "mercato") renderPunChart();
}
function boot() {
  $$(".tab").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-goto]"); if (b) { showTab(b.dataset.goto); window.scrollTo(0, 0); } });
  const onSel = e => { S.user.attivaId = e.target.value; scheduleSave(); renderAll(); };
  $("#selUtenza").addEventListener("change", onSel); $("#selUtenza2").addEventListener("change", onSel);
  $("#segTipo").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; S.user.vista.tipo = b.dataset.v; $$("#segTipo button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); scheduleSave(); renderRanking(); });
  $("#selOrdina").addEventListener("change", e => { S.user.vista.ordina = e.target.value; scheduleSave(); renderRanking(); });
  $("#selScenario").addEventListener("change", e => { S.user.vista.scenario = e.target.value; scheduleSave(); renderRanking(); });
  $("#chkCanone").addEventListener("change", e => { S.user.vista.canone = e.target.checked; scheduleSave(); renderRanking(); });
  $("#sec-consumi").addEventListener("input", e => { if (e.target.matches("input,select") && !e.target.closest(".drop") && e.target.id !== "selUtenza2") onFormChange(e); });
  $("#btnApplyHabits").addEventListener("click", () => applyHabits(false));
  $("#btnApplyHabitsKwh").addEventListener("click", () => applyHabits(true));
  $("#btnNewUtenza").addEventListener("click", () => { const u = nuovaUtenza("Nuovo cliente " + (S.user.utenze.length + 1), false); S.user.utenze.push(u); S.user.attivaId = u.id; scheduleSave(); renderAll(); $("#inNome").focus(); $("#inNome").select(); });
  $("#btnDelUtenza").addEventListener("click", () => { $("#delConfirm").hidden = false; });
  $("#btnDelNo").addEventListener("click", () => { $("#delConfirm").hidden = true; });
  $("#btnDelYes").addEventListener("click", () => {
    S.user.utenze = S.user.utenze.filter(u => u.id !== S.user.attivaId);
    if (!S.user.utenze.length) S.user.utenze.push(nuovaUtenza("Nuovo cliente", false));
    S.user.attivaId = S.user.utenze[0].id; $("#delConfirm").hidden = true; scheduleSave(); renderAll(); toast("Cliente eliminato.");
  });
  $("#fileImg").addEventListener("change", e => { handleBillImages(Array.from(e.target.files)); e.target.value = ""; });
  $("#filePdf").addEventListener("change", e => { handleBillPdf(e.target.files[0]); e.target.value = ""; });
  $("#fileCsv").addEventListener("change", e => { handleCsv(e.target.files[0]); e.target.value = ""; });
  wireDrop($("#dropBill"), routeBillFiles);
  wireDrop($("#dropOffer"), handleOfferFiles);
  $("#offImg").addEventListener("change", e => { handleOfferFiles(Array.from(e.target.files)); e.target.value = ""; });
  $("#offPdf").addEventListener("change", e => { handleOfferFiles(Array.from(e.target.files)); e.target.value = ""; });
  $("#nTipo").addEventListener("change", () => updatePriceLabels("n")); $("#nFasce").addEventListener("change", () => updatePriceLabels("n"));
  $("#offForm").addEventListener("submit", submitOffer);
  $("#offSearch").addEventListener("input", renderOffersTable);
  $("#offTable").addEventListener("click", e => { const b = e.target.closest("[data-del-offer]"); if (!b) return; S.user.offerteMie = S.user.offerteMie.filter(o => o.id !== b.dataset.delOffer); scheduleSave(); renderOffersTable(); renderRanking(); toast("Offerta eliminata."); });
  $("#btnExport").addEventListener("click", exportCsv);
  $("#btnReport").addEventListener("click", makeReport);
  $("#btnRefresh").addEventListener("click", () => ANDROID ? loadRemoteData(true) : refreshNow());
  $("#btnBackupOut").addEventListener("click", exportBackup);
  $("#fileBackup").addEventListener("change", e => { importBackup(e.target.files[0]); e.target.value = ""; });
  $("#btnDataUrl").addEventListener("click", () => { lsSet("claudia.dataUrl", $("#inDataUrl").value.trim()); loadRemoteData(true); });
  $("#chatForm").addEventListener("submit", e => { e.preventDefault(); sendChat($("#chatIn").value); });
  $("#chatIn").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat($("#chatIn").value); } });
  $("#chatChips").addEventListener("click", e => { const b = e.target.closest(".chip"); if (b) { showTab("claude"); sendChat(b.textContent); } });
  $("#chatStop").addEventListener("click", () => { if (S.chatCtl) S.chatCtl.abort(); });
  updatePriceLabels("n");
  const v = S.user.vista;
  $("#selOrdina").value = v.ordina; $("#selScenario").value = v.scenario; $("#chkCanone").checked = v.canone;
  renderAll();
  const t = lsGet("wattgiusto.tab"); if (t && $("#tab-" + t)) showTab(t);
  initCaps();
}
function syncVistaControls() {
  const v = S.user.vista;
  $("#selOrdina").value = v.ordina; $("#selScenario").value = v.scenario; $("#chkCanone").checked = !!v.canone;
  $$("#segTipo button").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.v === v.tipo)));
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
