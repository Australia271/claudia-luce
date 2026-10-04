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
    nome, esempio: !!esempio, anagrafica: {},
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
  saveTimer = setTimeout(salvaOra, 1200);
}
async function salvaOra() {
  clearTimeout(saveTimer); saveTimer = null;
  if (S.bloccato) return;                       // dati non ancora aperti: non sovrascrivo niente
  const data = clone(S.user); data.updatedAt = new Date().toISOString();
  let out = data;
  if (PROT.key) {
    try { out = { cifrato: await cifra(data), updatedAt: data.updatedAt }; }
    catch (e) { toast("Non riesco a cifrare i dati: non li salvo."); return; }
  }
  lsSet("wattgiusto.user", JSON.stringify(out));
  const db = S.caps.db, uid = S.caps.uid;
  if (db && uid) {
    saveChain = saveChain.then(() => db.doc("data/users/" + uid + "/watt").set(out)).then(() => { if (S.saveDenied) { S.saveDenied = false; renderStatus(); } }).catch(e => {
      if (e && e.code === "quota_exceeded") toast("Spazio del database esaurito: elimina qualche cliente o offerta aggiunta.");
      if (e && e.code === "invalid_argument") { S.saveDenied = true; renderStatus(); }
    });
    await saveChain;
  }
}
function adoptUser(data) {
  if (!data || !Array.isArray(data.utenze) || !data.utenze.length) return false;
  S.user = clone(data);
  S.user.offerteMie = S.user.offerteMie || [];
  S.user.vista = Object.assign({ tipo: "tutte", ordina: "previsto", scenario: "1", canone: false }, S.user.vista || {});
  if (!S.user.utenze.some(u => u.id === S.user.attivaId)) S.user.attivaId = S.user.utenze[0].id;
  return true;
}
function loadLocal() { const raw = lsGet("wattgiusto.user"); if (raw) { try { caricaDati(JSON.parse(raw)); } catch (e) { /* ignora */ } } }
/* Dati salvati: in chiaro (si aprono subito) o cifrati (serve il codice) */
function caricaDati(d) {
  if (d && d.cifrato) { S.bloccato = true; S.datiCifrati = d.cifrato; mostraBlocco(); return true; }
  return adoptUser(d);
}

/* ---------- Codice di accesso e cifratura dei dati dei clienti ----------
   Con il codice attivo, tutti i dati (clienti, dati anagrafici, consumi, offerte
   aggiunte, dati del consulente) vengono salvati cifrati con AES-GCM a 256 bit.
   La chiave nasce dal codice (PBKDF2-SHA256, 250.000 passaggi) e resta solo in
   memoria finché l'app è aperta: il codice non viene salvato da nessuna parte. */
const PROT = { key: null, salt: null, iter: 250000 };
const BLOCCO_DOPO_MS = 5 * 60 * 1000;
function cifraturaDisponibile() { return !!(window.crypto && crypto.subtle && window.TextEncoder); }
function b64da(u8) { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function b64a(b) { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
async function chiaveDa(codice, salt, iter) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(codice), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function cifra(obj, prot) {
  const p = prot || PROT;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, p.key, new TextEncoder().encode(JSON.stringify(obj))));
  return { v: 1, alg: "AES-GCM-256", kdf: "PBKDF2-SHA256", iter: p.iter, salt: b64da(p.salt), iv: b64da(iv), dati: b64da(ct) };
}
/* Restituisce { dati, prot } se il codice è giusto, altrimenti null */
async function decifra(c, codice) {
  try {
    const salt = b64a(c.salt), iter = c.iter || 250000;
    const key = await chiaveDa(codice, salt, iter);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64a(c.iv) }, key, b64a(c.dati));
    return { dati: JSON.parse(new TextDecoder().decode(pt)), prot: { key, salt, iter } };
  } catch (e) { return null; }
}
function mostraBlocco() {
  const ls = $("#lockScreen"); if (!ls) return;
  document.body.classList.add("bloccato"); ls.hidden = false;
  $("#lockErr").hidden = true; $("#lockCode").value = "";
  setTimeout(() => { try { $("#lockCode").focus(); } catch (e) { /* ignora */ } }, 50);
}
async function sblocca(e) {
  e.preventDefault();
  const btn = $("#btnUnlock"), err = $("#lockErr");
  btn.disabled = true; err.hidden = true; btn.textContent = "Apro…";
  const r = S.datiCifrati ? await decifra(S.datiCifrati, $("#lockCode").value) : null;
  btn.disabled = false; btn.textContent = "Apri";
  if (!r || !adoptUser(r.dati)) { err.textContent = "Codice sbagliato. Riprova."; err.hidden = false; $("#lockCode").select(); return; }
  Object.assign(PROT, r.prot);
  S.bloccato = false; S.datiCifrati = null;
  $("#lockScreen").hidden = true; document.body.classList.remove("bloccato");
  renderAll(); renderProt();
}
function bloccaAdesso() {
  if (!PROT.key) return;
  Promise.resolve(salvaOra()).catch(() => {}).then(() => location.reload());
}
let resetArmato = false;
function cancellaDatiProtetti() {
  const b = $("#btnLockReset");
  if (!resetArmato) { resetArmato = true; b.textContent = "Sicuro? Tocca di nuovo per cancellare tutto"; return; }
  try { localStorage.removeItem("wattgiusto.user"); } catch (e) { /* ignora */ }
  const db = S.caps.db, uid = S.caps.uid;
  const fatto = () => location.reload();
  if (db && uid) db.doc("data/users/" + uid + "/watt").delete().then(fatto, fatto); else fatto();
}
function renderProt() {
  if (!$("#protPanel")) return;
  const on = !!PROT.key;
  if (!cifraturaDisponibile()) { $("#protStato").textContent = "La cifratura non è disponibile in questa vista."; $("#protOff").hidden = true; $("#protOn").hidden = true; return; }
  $("#protStato").innerHTML = on
    ? "<strong>Attivo.</strong> I dati dei clienti sono salvati cifrati su questo dispositivo. L'app si blocca da sola dopo 5 minuti in sottofondo; si riapre con il codice."
    : "Non attivo: chi usa questo dispositivo può aprire i dati dei clienti. Con il codice vengono salvati cifrati e per vederli serve il codice.";
  $("#protOff").hidden = on; $("#protOn").hidden = !on;
  const lb = $("#btnLock"); if (lb) lb.hidden = !on;
}
function codiceValido(a, b) {
  if ((a || "").length < 6) { toast("Il codice deve avere almeno 6 caratteri."); return false; }
  if (a !== b) { toast("I due codici non sono uguali."); return false; }
  return true;
}
async function attivaCodice() {
  const a = $("#protNew1").value, b = $("#protNew2").value;
  if (!codiceValido(a, b)) return;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  Object.assign(PROT, { key: await chiaveDa(a, salt, 250000), salt, iter: 250000 });
  $("#protNew1").value = ""; $("#protNew2").value = "";
  await salvaOra(); renderProt();
  toast("Fatto: i dati dei clienti ora sono cifrati. Ricorda il codice.");
}
async function verificaAttuale() {
  const c = $("#protCur").value;
  const prova = await cifra({ prova: 1 });
  const r = await decifra(prova, c);
  if (!r) { toast("Il codice attuale non è giusto."); return false; }
  return true;
}
async function cambiaCodice() {
  if (!(await verificaAttuale())) return;
  const a = $("#protChg1").value, b = $("#protChg2").value;
  if (!codiceValido(a, b)) return;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  Object.assign(PROT, { key: await chiaveDa(a, salt, 250000), salt, iter: 250000 });
  ["#protCur", "#protChg1", "#protChg2"].forEach(id => { $(id).value = ""; });
  await salvaOra(); renderProt(); toast("Codice cambiato.");
}
async function togliCodice() {
  if (!(await verificaAttuale())) return;
  Object.assign(PROT, { key: null, salt: null });
  $("#protCur").value = "";
  await salvaOra(); renderProt(); toast("Codice tolto: i dati ora sono salvati senza cifratura.");
}

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
  // App Android e versione per PC: riscarica il file dei prezzi già pubblicato (non consuma Claude).
  // Nella versione dentro Claude il pulsante non c'è: ogni avvio dell'aggiornamento consumerebbe
  // l'utilizzo del piano, e i prezzi li aggiorna già l'attività delle 6:55.
  if (ANDROID) { btn.hidden = false; btn.textContent = "Aggiorna prezzi"; return; }
  btn.hidden = true;
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
  renderProposta();
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

/* ---------- Proposta per il cliente ----------
   Scheda "Proposta": dati del promotore, due proposte (la migliore a prezzo fisso e,
   quando ha senso per il caso, la migliore variabile), valutazione della convenienza,
   messaggio pronto e PDF da allegare. Tutti i numeri vengono dalla stessa classifica
   (S.lastRows): spesa dei prossimi 12 mesi, tutto compreso. */
let jspdfPromise = null;
function loadJsPdf() { if (!jspdfPromise) jspdfPromise = loadScript(ANDROID ? "vendor/jspdf.umd.min.js" : "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js").then(() => window.jspdf.jsPDF).catch(e => { jspdfPromise = null; throw e; }); return jspdfPromise; }
function pdfSafe(s) { return String(s == null ? "" : s).replace(/−/g, "-").replace(/…/g, "...").replace(/[–—]/g, "-").replace(/ | /g, " ").replace(/[^\x20-\x7E -ÿ€’“”‘]/g, ""); }

const CONS_STD = { nome: "Claudia Caria", ruolo: "Consulente energetica" };
function consulente() {
  const c = S.user.consulente || {};
  return {
    nome: c.nome || CONS_STD.nome,
    ruolo: c.ruolo != null ? c.ruolo : CONS_STD.ruolo,
    telefono: c.telefono || "", whatsapp: c.whatsapp || "", email: c.email || "", telegram: c.telegram || "",
    altro: c.altro != null ? c.altro : (c.recapiti || "")          // "recapiti": vecchio campo unico
  };
}
/* Numero per i link di WhatsApp: solo cifre, con il prefisso internazionale (Italia se manca) */
function telWa(s) {
  let d = String(s || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1); else if (d.startsWith("00")) d = d.slice(2);
  else if (/^[03]\d{7,10}$/.test(d)) d = "39" + d;
  return d.length >= 8 ? d : "";
}
function pctIt(p) { return Math.round(Math.abs(p) * 100) + "%"; }
function tipoT(o) { return o.tipo === "fisso" ? "prezzo fisso" : o.tipo === "indicizzato" ? "prezzo variabile" : "prezzo ARERA"; }
function giorniA(iso) { return Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(todayISO() + "T00:00:00Z")) / 864e5); }
function nomeCliente(u) { const an = u.anagrafica || {}; return an.intestatario || (u.esempio ? "" : u.nome) || ""; }

/* Prezzo all'ingrosso (PUN) medio previsto nei prossimi 12 mesi, pesato sui consumi del cliente */
function punPrevisto(mult, start) {
  const prof = normProfile(U().profiloMensile);
  let s = 0;
  for (let i = 0; i < 12; i++) { const k = addMonths(start, i); s += punMonoFor(k, S.market, mult) * prof[+k.slice(5, 7) - 1]; }
  return s;
}
/* A quale livello dei prezzi di borsa (moltiplicatore sui futures) la variabile costa quanto il fisso */
function pareggioVar(row, target, ctx) {
  const u = U();
  const f = m => computeOffer(row.offer, u, S.market, { mult: m, start: ctx.start, canoneRai: ctx.canone }).totale - target;
  let lo = 0.3, hi = 3;
  if (f(lo) > 0) return { mai: true };
  if (f(hi) < 0) return { sempre: true };
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0) hi = mid; else lo = mid; }
  return { m: (lo + hi) / 2 };
}

/* Le due proposte per il cliente aperto e la loro valutazione */
function propostaCtx() {
  const u = U(), v = S.user.vista;
  const mult = parseFloat(v.scenario) || 1, start = nextMonthKey(), canone = !!v.canone && u.residente !== false;
  const rows = (S.lastRows || []).slice().sort((a, b) => a.calc.totale - b.calc.totale);
  const valide = rows.filter(r => !r.esclusa.length && !r.scaduta && !r.offer.attuale);
  const cur = rows.find(r => r.offer.attuale) || null;
  const fissi = valide.filter(r => r.offer.tipo === "fisso");
  const variabili = valide.filter(r => r.offer.tipo === "indicizzato");
  const pr = u.proposta || {};
  const pick = (list, id) => (id && list.find(r => r.offer.id === id)) || list[0] || null;
  const fisso = pick(fissi, pr.fisso);
  const varia = pick(variabili, pr.variabile);
  const tot = valide.map(r => r.calc.totale).sort((a, b) => a - b);
  const ctx = {
    u, mult, start, canone, rows, valide, cur, fissi, variabili, fisso, varia,
    mediana: tot.length ? tot[Math.floor(tot.length / 2)] : null,
    judge: cur ? judgeCurrent(cur, valide) : null
  };
  // La variabile entra nella proposta quando è coerente con il caso:
  // il cliente ha già un prezzo variabile, oppure la variabile costa meno del miglior fisso.
  const curVar = !!(cur && cur.offer.tipo === "indicizzato");
  const diff = varia && fisso ? varia.calc.totale - fisso.calc.totale : null;
  if (!varia) { ctx.conVar = false; ctx.varAuto = true; ctx.motivoVar = "Non ci sono offerte a prezzo variabile attivabili con le condizioni di questo cliente."; }
  else if (pr.conVariabile === true) { ctx.conVar = true; ctx.varAuto = false; ctx.motivoVar = "Hai aggiunto tu la proposta a prezzo variabile."; }
  else if (pr.conVariabile === false) { ctx.conVar = false; ctx.varAuto = false; ctx.motivoVar = "Hai tolto tu la proposta a prezzo variabile."; }
  else if (curVar) { ctx.conVar = true; ctx.varAuto = true; ctx.motivoVar = "Variabile inclusa perché il cliente ha già un prezzo variabile: così può confrontarla con il fisso."; }
  else if (diff == null || diff < 0) { ctx.conVar = true; ctx.varAuto = true; ctx.motivoVar = "Variabile inclusa perché, con le previsioni di borsa, costa meno del miglior prezzo fisso."; }
  else {
    ctx.conVar = false; ctx.varAuto = true;
    ctx.motivoVar = (cur ? "Il cliente ha un prezzo fisso e la" : "La") + " migliore variabile (" + varia.offer.fornitore + " " + varia.offer.nome + ") costerebbe " + euro(diff) + " in più del miglior fisso, con il rischio di aumenti: per questo non la propongo. Al suo posto c'è un secondo prezzo fisso di un altro fornitore.";
  }
  ctx.secondo = ctx.conVar ? varia : pick(fissi.filter(r => r !== fisso && (!fisso || r.offer.fornitore !== fisso.offer.fornitore)), pr.fisso2);
  ctx.kindB = ctx.conVar ? "variabile" : "fisso2";
  ctx.A = fisso ? valuta(fisso, ctx) : null;
  ctx.B = ctx.secondo ? valuta(ctx.secondo, ctx) : null;
  ctx.rec = raccomanda(ctx);
  ctx.motivi = motiviValutazione(ctx);
  return ctx;
}
function valuta(r, ctx) {
  const o = r.offer, c = r.calc.totale;
  const e = { r, o, costo: c, mese: c / 12, pos: ctx.valide.indexOf(r) + 1, di: ctx.valide.length };
  e.prezzoMedio = r.calc.energia / Math.max(1, +ctx.u.kwhAnno || 0);
  if (ctx.cur) { e.risparmio = ctx.cur.calc.totale - c; e.pct = e.risparmio / ctx.cur.calc.totale; }
  if (ctx.mediana) { e.vsMedia = ctx.mediana - c; e.pctMedia = e.vsMedia / ctx.mediana; }
  if (ctx.cur) {
    const s = e.risparmio;
    e.grado = s <= 0 ? { k: "bad", t: "Non conviene" }
      : (s >= 100 || e.pct >= 0.10) ? { k: "good", t: "Convenienza alta" }
      : (s >= 30 || e.pct >= 0.04) ? { k: "good", t: "Convenienza buona" }
      : { k: "warn", t: "Risparmio minimo", poco: true };
  } else {
    const p = e.pctMedia || 0;
    e.grado = (e.pos <= 3 && p >= 0.06) ? { k: "good", t: "Tra le migliori" }
      : p >= 0.02 ? { k: "good", t: "Sotto la media" }
      : p > -0.02 ? { k: "warn", t: "Nella media" }
      : { k: "bad", t: "Sopra la media" };
  }
  if (o.tipo === "indicizzato") {
    e.basso = r.basso; e.alto = r.alto;
    if (ctx.fisso && ctx.fisso !== r) e.pareggio = pareggioVar(r, ctx.fisso.calc.totale, ctx);
    if (ctx.cur) e.peggioreVsAttuale = ctx.cur.calc.totale - r.alto;
  }
  return e;
}
/* La proposta consigliata: la meno cara, ma se la variabile costa meno del 4% in meno
   del fisso consiglio il fisso, che protegge dagli aumenti. */
function raccomanda(ctx) {
  const A = ctx.A, B = ctx.B, cands = [A, B].filter(Boolean);
  if (!cands.length) return { k: "none" };
  let rec = cands.reduce((m, x) => x.costo < m.costo ? x : m), perche = "costo";
  if (A && B && rec === B && B.o.tipo === "indicizzato" && A.costo - B.costo < A.costo * 0.04 && (!ctx.cur || A.risparmio > 0)) { rec = A; perche = "tranquillita"; }
  const out = { rec, perche, n: rec === A ? 1 : 2 };
  if (ctx.cur) out.k = !(rec.risparmio > 0) ? "resta" : rec.grado.poco ? "poco" : "cambia";
  else out.k = "nuovo";
  return out;
}
function motiviValutazione(ctx) {
  const R = [], rec = ctx.rec, u = ctx.u, A = ctx.A, B = ctx.B, cur = ctx.cur;
  if (rec.k === "none") return R;
  const e = rec.rec, o = e.o;
  const nome = x => x.o.fornitore + " " + x.o.nome;
  if (cur) {
    const j = ctx.judge;
    R.push({ t: j.conviene ? "ok" : "bad", s: "Oggi il cliente spende " + euro(cur.calc.totale) + " in 12 mesi con " + cur.offer.fornitore + " (" + tipoT(cur.offer) + "): la sua offerta è " + j.pos + "ª su " + j.di + " per convenienza" + (j.conviene ? ", già tra le migliori." : ".") });
  } else if (ctx.mediana) {
    R.push({ t: "info", s: "Non ho l'offerta attuale del cliente: confronto le proposte con un'offerta nella media del mercato (" + euro(ctx.mediana) + " in 12 mesi). Con la bolletta il confronto è più preciso." });
  }
  if (rec.k === "resta") {
    R.push({ t: "ok", s: "Nessuna proposta costa meno dell'offerta attuale: al cliente conviene restare dov'è. La proposta più vicina, " + nome(e) + ", costerebbe " + euro(-e.risparmio) + " in più l'anno." });
    if (cur.offer.tipo === "indicizzato" && A) R.push({ t: "info", s: "Se il cliente preferisce un prezzo che non cambia ogni mese, il fisso di " + A.o.fornitore + " costa " + (A.risparmio >= 0 ? euro(A.risparmio) + " in meno" : euro(-A.risparmio) + " in più") + " l'anno e lo protegge dagli aumenti." });
  }
  if (rec.k === "resta") {
    if (u.potenzaKW > 3) R.push({ t: "info", s: "Con " + numIt(u.potenzaKW, 1) + " kW di potenza il cliente paga circa " + euro(S.market.regolato.trasporto.quotaPotenzaKWAnno * (u.potenzaKW - 3) * 1.1) + " l'anno in più rispetto a 3 kW: se il contatore non salta mai, si può valutare di ridurla." });
    if (cur.offer.scadenza && cur.offer.scadenza >= todayISO()) R.push({ t: "info", s: "Il prezzo attuale è bloccato fino al " + dataIt(cur.offer.scadenza) + ": verso quella data conviene rifare il confronto." });
    return R;
  }
  if (rec.perche === "tranquillita") R.push({ t: "ok", s: "La variabile costerebbe solo " + euro(A.costo - B.costo) + " in meno nell'anno: per pochi euro conviene il prezzo bloccato, che protegge dagli aumenti." });
  if (o.tipo === "fisso") {
    const pun = punPrevisto(ctx.mult, ctx.start), pz = e.prezzoMedio;
    R.push({ t: "ok", s: "Prezzo bloccato per " + (o.durataMesi || 12) + " mesi a " + kwhPrice(pz) + " €/kWh" + (pz < pun ? ": è sotto il prezzo all'ingrosso che la borsa prevede per i prossimi 12 mesi (" + kwhPrice(pun) + " €/kWh), quindi bloccarlo oggi conviene." : "; la borsa prevede " + kwhPrice(pun) + " €/kWh all'ingrosso per i prossimi 12 mesi.") });
  } else if (o.tipo === "indicizzato") {
    R.push({ t: "warn", s: "Prezzo variabile: segue la borsa mese per mese. Nei prossimi 12 mesi la spesa può andare da " + euro(e.basso) + " a " + euro(e.alto) + "." });
  }
  const V = [A, B].find(x => x && x.o.tipo === "indicizzato");
  if (V && V.pareggio) {
    const p = V.pareggio, chi = "La variabile di " + V.o.fornitore;
    if (p.mai) R.push({ t: "info", s: chi + " costa più del fisso anche se i prezzi di borsa scendessero molto." });
    else if (p.sempre) R.push({ t: "info", s: chi + " costa meno del fisso anche se i prezzi di borsa salissero molto." });
    else {
      const d = Math.round((p.m - 1) * 100);
      R.push({ t: "info", s: d >= 0 ? chi + " resta più conveniente del fisso finché i prezzi di borsa non superano di oltre il " + d + "% le previsioni." : chi + " diventa più conveniente del fisso solo se i prezzi di borsa scendono di almeno il " + (-d) + "% rispetto alle previsioni." });
    }
  }
  if (V && cur && V.risparmio > 0 && V.peggioreVsAttuale < -20) R.push({ t: "warn", s: "Se il mercato salisse molto, con la variabile il cliente arriverebbe a spendere " + euro(-V.peggioreVsAttuale) + " più di oggi." });
  if (o.validoFino) { const g = giorniA(o.validoFino); if (g >= 0 && g <= 14) R.push({ t: "warn", s: "Il prezzo di " + nome(e) + " vale per chi aderisce entro il " + dataIt(o.validoFino) + ": dopo quella data va ricontrollato." }); }
  const req = o.requisiti || [];
  const cond = [req.includes("domiciliazione") && "addebito automatico su conto corrente", req.includes("bolletta_web") && "bolletta via email", req.includes("online") && "attivazione online"].filter(Boolean);
  if (cond.length) R.push({ t: "info", s: "Condizioni dell'offerta consigliata: " + cond.join(", ") + "." });
  if (o.note && /recesso|penal/i.test(o.note)) R.push({ t: "warn", s: o.note });
  if (o.bonusUnaTantum) R.push({ t: "info", s: "Il bonus di " + euro(o.bonusUnaTantum) + " vale solo il primo anno: dal secondo anno la spesa sale." });
  if (u.vulnerabile) { const reg = ctx.valide.find(r => r.offer.tipo === "regolato"); if (reg && reg.calc.totale < e.costo) R.push({ t: "info", s: "Il cliente è vulnerabile: il servizio di tutela ARERA costerebbe " + euro(reg.calc.totale) + ", cioè " + euro(e.costo - reg.calc.totale) + " meno della proposta consigliata." }); }
  if (cur && cur.offer.scadenza && cur.offer.scadenza >= todayISO() && rec.k !== "resta") R.push({ t: "info", s: "Il prezzo attuale è bloccato fino al " + dataIt(cur.offer.scadenza) + ". Per i clienti domestici cambiare fornitore è gratuito: controlla solo eventuali costi di recesso nel contratto attuale." });
  if (u.potenzaKW > 3) R.push({ t: "info", s: "Con " + numIt(u.potenzaKW, 1) + " kW di potenza il cliente paga circa " + euro(S.market.regolato.trasporto.quotaPotenzaKWAnno * (u.potenzaKW - 3) * 1.1) + " l'anno in più rispetto a 3 kW: se il contatore non salta mai, si può valutare di ridurla." });
  return R;
}

/* ---------- Disegno della scheda ---------- */
function renderPromoter() {
  const c = consulente();
  $("#pmName").textContent = c.nome;
  $("#pmRole").textContent = c.ruolo;
  $("#pmRole").hidden = !c.ruolo;
  const row = (t, v, ph) => "<dt>" + t + "</dt>" + (v ? "<dd>" + esc(v) + "</dd>" : '<dd class="missing">' + ph + "</dd>");
  $("#pmContacts").innerHTML = row("Telefono", c.telefono, "da aggiungere") + row("WhatsApp", c.whatsapp || c.telefono, "da aggiungere") +
    row("Email", c.email, "da aggiungere") + (c.telegram ? row("Telegram", c.telegram) : "") + (c.altro ? row("Altro", c.altro) : "");
  const set = (id, v) => { const el = $("#" + id); if (document.activeElement !== el) el.value = v; };
  const raw = S.user.consulente || {};
  set("pcNome", raw.nome || c.nome); set("pcRuolo", c.ruolo); set("pcTel", c.telefono); set("pcWa", c.whatsapp);
  set("pcEmail", c.email); set("pcTg", c.telegram); set("pcAltro", c.altro);
}
function renderProposta() {
  if (!$("#sec-proposta")) return;
  const ctx = propostaCtx();
  S.prCtx = ctx;
  renderPromoter();
  const u = ctx.u, an = u.anagrafica || {};
  const set = (id, v) => { const el = $("#" + id); if (document.activeElement !== el) el.value = v || ""; };
  set("prEmail", an.email); set("prTel", an.telefono);
  renderEval(ctx);
  $("#prCards").innerHTML = cardProposta(ctx.A, 1, ctx, "fisso") + cardProposta(ctx.B, 2, ctx, ctx.kindB);
  renderVarNote(ctx);
  const tono = (u.proposta && u.proposta.tono) || "lei";
  $$("#prTono button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === tono)));
  $("#prSendFor").textContent = "Per " + (nomeCliente(u) || u.nome);
  aggiornaMsg();
  $("#btnPrShare").hidden = !canSharePdf();
  $("#btnPrPdf").disabled = ctx.rec.k === "none";
}
function renderEval(ctx) {
  const el = $("#prEval"), rec = ctx.rec;
  if (rec.k === "none") { el.innerHTML = '<div class="callout warn">Non ci sono offerte valide da proporre a questo cliente con le sue condizioni. Controlla i dati in <em>Dati del cliente</em> o il catalogo delle offerte.</div>'; return; }
  const e = rec.rec, o = e.o, cur = ctx.cur;
  const cls = rec.k === "cambia" || rec.k === "nuovo" ? "is-ok" : "is-warn";
  const badge = { cambia: "✓ Conviene cambiare", poco: "≈ Risparmio minimo", resta: "✗ Meglio restare", nuovo: "Proposta consigliata" }[rec.k];
  let digits, unit, sub, head, text;
  if (rec.k === "cambia" || rec.k === "poco") {
    digits = e.risparmio; unit = "€ risparmiati in 12 mesi";
    sub = "−" + pctIt(e.pct) + " sulla spesa · " + euro(e.risparmio / 12) + " al mese in meno";
    head = rec.k === "cambia" ? "Consiglio la proposta " + rec.n : "Il risparmio è piccolo: valutalo con il cliente";
    text = "Con " + esc(o.fornitore + " " + o.nome) + " (" + tipoT(o) + ") il cliente spenderebbe " + euro(e.costo) + " invece di " + euro(cur.calc.totale) + " nei prossimi 12 mesi, tutto compreso." +
      (rec.k === "poco" ? " Con una differenza così piccola il cambio conviene solo se al cliente interessano anche le altre condizioni dell'offerta." : "");
  } else if (rec.k === "resta") {
    digits = cur.calc.totale; unit = "€ in 12 mesi con l'offerta attuale";
    sub = euro(cur.calc.totale / 12) + " al mese · " + cent(cur.calc.cKWh) + " tutto compreso";
    head = "L'offerta attuale del cliente conviene già";
    text = "Nessuna delle due proposte costa meno di quello che il cliente paga oggi con " + esc(cur.offer.fornitore) + ". Puoi comunque inviargli il confronto: è un buon motivo per fidarsi di te.";
  } else {
    digits = e.costo; unit = "€ in 12 mesi";
    sub = euro(e.mese) + " al mese · " + cent(e.r.calc.cKWh) + " tutto compreso";
    head = "Consiglio la proposta " + rec.n;
    text = esc(o.fornitore + " " + o.nome) + " (" + tipoT(o) + ") è " + e.pos + "ª su " + e.di + " offerte per questo cliente" + (e.vsMedia > 5 ? " e costa " + euro(e.vsMedia) + " meno di un'offerta nella media." : ".");
  }
  const fact = (t, v) => "<div><dt>" + t + "</dt><dd>" + v + "</dd></div>";
  const facts = rec.k === "resta"
    ? fact("Consiglio", "Restare con l'offerta attuale") + fact("Prezzo energia attuale", esc(prezzoTesto(cur.offer))) +
      fact("Quota fissa attuale", euro2(+cur.offer.quotaFissaMese || 0) + " al mese") + fact("Posizione", ctx.judge.pos + "ª su " + ctx.judge.di + " offerte") +
      fact("Proposta più vicina", esc(o.fornitore) + " · " + euro(e.costo))
    : fact("Proposta consigliata", "N. " + rec.n + " · " + tipoT(o)) +
      fact("Prezzo energia", esc(prezzoTesto(o))) + fact("Quota fissa", euro2(+o.quotaFissaMese || 0) + " al mese") +
      fact("Posizione", e.pos + "ª su " + e.di + " offerte") + (o.validoFino ? fact("Prezzo valido fino al", dataIt(o.validoFino)) : "");
  el.innerHTML = '<section class="current ' + cls + '" aria-label="Valutazione della convenienza">' +
    '<div class="cur-band"><span>Valutazione della convenienza</span><span class="cur-badge">' + badge + "</span></div>" +
    '<div class="cur-main"><div><div class="cur-who">' + esc(rec.k === "resta" ? cur.offer.fornitore : o.fornitore) + "<small>" + esc(rec.k === "resta" ? (cur.offer.nome + " · offerta attuale") : (o.nome + " · " + tipoT(o))) + "</small></div>" +
    '<div class="cur-digits">' + Math.round(Math.abs(digits)).toLocaleString("it-IT") + '<span class="u">' + unit + "</span></div>" +
    '<div class="cur-sub">' + sub + "</div></div>" +
    '<div class="cur-verdict"><strong>' + head + "</strong><p>" + text + "</p></div></div>" +
    '<dl class="cur-facts">' + facts + "</dl>" +
    '<div class="cur-why"><div class="eyebrow">Perché</div><ul class="notes">' + ctx.motivi.map(x => '<li class="' + x.t + '">' + esc(x.s) + "</li>").join("") + "</ul></div></section>";
}
function cardProposta(e, n, ctx, kind) {
  const lab = kind === "variabile" ? "Prezzo variabile" : kind === "fisso" ? "Prezzo fisso" : "Alternativa a prezzo fisso";
  if (!e) return '<article class="prop"><div class="prop-head"><span class="eyebrow">Proposta ' + n + " · " + lab + '</span></div><div class="prop-body"><p class="muted small">' + (kind === "fisso" ? "Nessuna offerta a prezzo fisso attivabile per questo cliente." : "Nessuna seconda proposta disponibile con le condizioni di questo cliente.") + "</p></div></article>";
  const o = e.o, isRec = ctx.rec.rec === e && ctx.rec.k !== "resta";
  const list = kind === "variabile" ? ctx.variabili : kind === "fisso" ? ctx.fissi : ctx.fissi.filter(r => r !== ctx.fisso);
  const opts = list.map((r, i) => '<option value="' + esc(r.offer.id) + '"' + (r === e.r ? " selected" : "") + ">" + esc(r.offer.fornitore + " · " + r.offer.nome + " · " + euro(r.calc.totale)) + (i === 0 ? " · la più conveniente" : "") + "</option>").join("");
  let save = "";
  if (ctx.cur) save = e.risparmio > 0 ? '<div class="prop-save down">Risparmio ' + euro(e.risparmio) + " l'anno (−" + pctIt(e.pct) + ")</div>" : '<div class="prop-save up">Costa ' + euro(-e.risparmio) + " l'anno più dell'offerta attuale</div>";
  else if (e.vsMedia != null) save = '<div class="prop-save ' + (e.vsMedia >= 0 ? "down" : "up") + '">' + (e.vsMedia >= 0 ? euro(e.vsMedia) + " meno" : euro(-e.vsMedia) + " più") + " di un'offerta media</div>";
  const dd = (t, v) => "<dt>" + t + "</dt><dd>" + v + "</dd>";
  const dl = dd("Prezzo energia", esc(prezzoTesto(o))) + dd("Quota fissa", euro2(+o.quotaFissaMese || 0) + "/mese") +
    (o.tipo === "fisso" ? dd("Prezzo bloccato", (o.durataMesi || 12) + " mesi") : dd("Spesa possibile", euro(e.basso) + " – " + euro(e.alto))) +
    dd("Posizione", e.pos + "ª su " + e.di) + (o.validoFino ? dd("Adesioni entro il", dataIt(o.validoFino)) : "");
  const notes = consumerNotes(e.r, null, ctx.u).filter(x => x.t !== "ok" && !/^Prezzo variabile ogni mese/.test(x.s)).slice(0, 4);
  return '<article class="prop' + (isRec ? " is-rec" : "") + '">' +
    '<div class="prop-head"><span class="eyebrow">Proposta ' + n + " · " + lab + '</span><span class="row" style="gap:6px">' + (isRec ? '<span class="rec-flag">Consigliata</span>' : "") + '<span class="grade ' + e.grado.k + '">' + e.grado.t + "</span></span></div>" +
    '<div class="prop-body"><div><div class="o-name">' + esc(o.fornitore) + '</div><div class="o-sup">' + esc(o.nome) + "</div></div>" +
    '<div><div class="prop-cost">' + Math.round(e.costo).toLocaleString("it-IT") + '<span class="u">€ in 12 mesi</span></div><div class="prop-per">' + euro(e.mese) + " al mese · " + cent(e.r.calc.cKWh) + " tutto compreso</div></div>" +
    save + "<dl>" + dl + "</dl>" +
    (notes.length ? '<ul class="notes small">' + notes.map(x => '<li class="' + x.t + '">' + esc(x.s) + "</li>").join("") + "</ul>" : "") +
    (list.length > 1 ? '<label class="fld" for="prSel' + n + '">Cambia offerta<select id="prSel' + n + '" data-kind="' + kind + '">' + opts + "</select></label>" : "") +
    "</div></article>";
}
function renderVarNote(ctx) {
  const el = $("#prVarNote");
  if (!ctx.varia) { el.innerHTML = ""; return; }
  let btn = "";
  if (!ctx.conVar) btn = '<button class="btn small" type="button" data-var="si">Proponi comunque la variabile</button>';
  else if (ctx.varAuto) btn = '<button class="btn small" type="button" data-var="no">Togli la variabile</button>';
  if (!ctx.varAuto) btn += '<button class="btn small" type="button" data-var="auto">Lascia scegliere all\'app</button>';
  el.innerHTML = '<div class="callout row"><span class="grow small">' + esc(ctx.motivoVar) + "</span>" + btn + "</div>";
}

/* ---------- Messaggio per il cliente ---------- */
function oggettoEmail() { const u = U(); return "Proposta fornitura luce" + (nomeCliente(u) ? " – " + nomeCliente(u) : ""); }
function messaggioCliente(ctx, tono) {
  const u = ctx.u, c = consulente(), tu = tono === "tu", rec = ctx.rec, cur = ctx.cur;
  const nc = nomeCliente(u), L = [];
  L.push(tu ? "Ciao" + (nc ? " " + nc.split(" ")[0] : "") + "," : "Gentile" + (nc ? " " + nc : " cliente") + ",");
  L.push(tu ? "come promesso ti mando la proposta per la luce, calcolata sui tuoi consumi (" + numIt(u.kwhAnno) + " kWh l'anno)."
    : "come d'accordo le invio la proposta per la fornitura di luce, calcolata sui suoi consumi (" + numIt(u.kwhAnno) + " kWh l'anno).");
  if (cur) L.push((tu ? "Oggi con " + cur.offer.fornitore + " spendi" : "Oggi con " + cur.offer.fornitore + " spende") + " circa " + euro(cur.calc.totale) + " l'anno, tutto compreso.");
  L.push("");
  [[ctx.A, 1], [ctx.B, 2]].forEach(([e, n]) => {
    if (!e) return;
    let s = n + ") " + (e.o.tipo === "fisso" ? "Prezzo fisso" : "Prezzo variabile") + ": " + e.o.fornitore + " " + e.o.nome + ", circa " + euro(e.costo) + " in 12 mesi (" + euro(e.mese) + " al mese)";
    if (cur && e.risparmio > 0) s += ", " + (tu ? "risparmi" : "risparmio stimato") + " " + euro(e.risparmio) + " l'anno";
    if (e.o.tipo === "indicizzato") s += "; il prezzo segue il mercato, quindi la spesa può andare da " + euro(e.basso) + " a " + euro(e.alto);
    else s += "; prezzo bloccato per " + (e.o.durataMesi || 12) + " mesi";
    L.push(s + ".");
  });
  L.push("");
  if (rec.k === "resta") L.push(tu ? "La tua offerta attuale è già conveniente: per ora ti consiglio di restare così. Ti avviso io quando trovo di meglio."
    : "La sua offerta attuale è già conveniente: per ora le consiglio di restare così. La avviserò quando ci sarà di meglio.");
  else if (rec.k !== "none") {
    const why = rec.rec.o.tipo === "fisso"
      ? (rec.perche === "tranquillita" ? "perché per pochi euro di differenza il prezzo resta bloccato e non ci sono sorprese" : "perché costa meno e il prezzo resta bloccato")
      : "perché con le previsioni di mercato costa meno, anche se il prezzo cambia ogni mese";
    L.push((tu ? "Il mio consiglio è la proposta " : "Il mio consiglio è la proposta ") + rec.n + ", " + why + ".");
  }
  L.push(tu ? "Trovi tutti i dettagli nel PDF allegato. Cambiare è gratuito, la luce non si interrompe e alla disdetta pensa il nuovo fornitore."
    : "Trova tutti i dettagli nel PDF allegato. Cambiare è gratuito, la luce non si interrompe e alla disdetta pensa il nuovo fornitore.");
  const tel = c.telefono || c.whatsapp;
  if (tel) L.push((tu ? "Per attivarla o per qualsiasi domanda chiamami o scrivimi al " : "Per attivarla o per qualsiasi domanda può chiamarmi o scrivermi al ") + tel + " (anche su WhatsApp).");
  else if (c.email) L.push((tu ? "Per attivarla o per qualsiasi domanda scrivimi a " : "Per attivarla o per qualsiasi domanda può scrivermi a ") + c.email + ".");
  L.push("", tu ? "A presto," : "Cordiali saluti,", c.nome);
  if (c.ruolo) L.push(c.ruolo);
  const rec2 = [c.telefono && "Tel. " + c.telefono, c.whatsapp && c.whatsapp !== c.telefono && "WhatsApp " + c.whatsapp, c.email, c.telegram && "Telegram " + c.telegram].filter(Boolean);
  if (rec2.length) L.push(rec2.join(" · "));
  return L.join("\n");
}
function aggiornaMsg() {
  const u = U(), ctx = S.prCtx; if (!ctx) return;
  const pr = u.proposta || {}, el = $("#prMsg");
  if (!pr.msg && document.activeElement !== el) el.value = ctx.rec.k === "none" ? "" : messaggioCliente(ctx, pr.tono || "lei");
  else if (pr.msg && document.activeElement !== el) el.value = pr.msg;
  $("#prMsgHint").textContent = pr.msg ? "Hai modificato il testo a mano: se cambi le proposte, premi «Riscrivi il messaggio» per aggiornare i numeri." : "Il testo si aggiorna da solo con le proposte. Puoi correggerlo prima di inviarlo.";
  renderLinks();
}
function renderLinks() {
  const u = U(), an = u.anagrafica || {}, msg = $("#prMsg").value, subj = oggettoEmail();
  const wa = telWa(an.telefono), mail = String(an.email || "").replace(/\s/g, "");
  const L = [
    ["WhatsApp", "https://wa.me/" + wa + "?text=" + encodeURIComponent(msg), "Apre WhatsApp con il messaggio già scritto" + (wa ? "" : ": scegli tu il contatto")],
    ["Telegram", "https://t.me/share/url?url=" + encodeURIComponent(msg), "Apre Telegram con il messaggio già scritto: scegli tu il contatto"],
    ["Email", "mailto:" + mail + "?subject=" + encodeURIComponent(subj) + "&body=" + encodeURIComponent(msg), "Apre il programma di posta del dispositivo"],
    ["Gmail", "https://mail.google.com/mail/?view=cm&fs=1&to=" + encodeURIComponent(mail) + "&su=" + encodeURIComponent(subj) + "&body=" + encodeURIComponent(msg), "Apre Gmail nel browser"]
  ];
  $("#prLinks").innerHTML = '<span class="small muted">Invia con</span>' + L.map(([t, h, tt]) => '<a class="btn" href="' + esc(h) + '" target="_blank" rel="noopener" title="' + esc(tt) + '">' + t + "</a>").join("");
  $("#prSendNote").textContent = (mail || wa ? "" : "Aggiungi email o cellulare del cliente per aprire il messaggio già indirizzato. ") +
    "Il PDF va allegato al messaggio: prima scaricalo con «Scarica la proposta», poi aggiungilo nella chat o nell'email" + (canSharePdf() ? ", oppure usa «Condividi il PDF» per allegarlo direttamente." : ".");
}

/* ---------- PDF della proposta ---------- */
function canSharePdf() {
  if (ANDROID && window.ClaudiaAndroid && typeof window.ClaudiaAndroid.shareFile === "function") return "android";
  if (!window.claude && navigator.canShare && typeof File !== "undefined") {
    try { if (navigator.canShare({ files: [new File(["x"], "x.pdf", { type: "application/pdf" })] })) return "web"; } catch (e) { /* non disponibile */ }
  }
  return null;
}
function nomeFilePdf(u) { return "proposta-luce-" + ((nomeCliente(u) || u.nome || "cliente").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cliente"); }
async function buildPdf(ctx) {
  if (ctx.rec.k === "none") { toast("Non ci sono offerte valide da proporre a questo cliente."); return null; }
  const JsPDF = await loadJsPdf();
  const doc = new JsPDF({ unit: "mm", format: "a4" });
  const u = ctx.u, an = u.anagrafica || {}, c = consulente(), cur = ctx.cur, rec = ctx.rec;
  const M = 16, W = 210 - 2 * M, BOT = 278;
  let y = 20;
  const INK = [19, 33, 43], SOFT = [84, 98, 110], ACC = [11, 92, 173], GOOD = [29, 122, 76], BAD = [178, 58, 46], WARN = [154, 91, 0], LINE = [212, 219, 224];
  const font = (size, bold, color) => { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor.apply(doc, color || INK); };
  const LH = size => size * 0.42;
  const need = h => { if (y + h > BOT) { doc.addPage(); y = 20; } };
  const text = (t, size, opt) => {
    opt = opt || {}; font(size, opt.bold, opt.color);
    const lines = doc.splitTextToSize(pdfSafe(t), opt.w || W);
    need(lines.length * LH(size));
    doc.text(lines, opt.x || M, y); y += lines.length * LH(size) + (opt.gap == null ? 1.5 : opt.gap);
  };
  const titolo = t => { need(14); y += 2; font(8.5, true, ACC); doc.text(pdfSafe(t.toUpperCase()), M, y); y += 2; doc.setDrawColor.apply(doc, LINE); doc.line(M, y, M + W, y); y += 4.5; };
  const bullet = (t, size, color) => {
    font(size, false, color || INK);
    const lines = doc.splitTextToSize(pdfSafe(t), W - 5); need(lines.length * LH(size));
    doc.text("-", M + 1, y); doc.text(lines, M + 5, y); y += lines.length * LH(size) + 1.2;
  };

  // Intestazione: titolo a sinistra, promotore a destra (ben in vista)
  const xR = M + W, colL = W - 74;
  let yR = y - 1;
  font(13, true, INK); doc.text(pdfSafe(c.nome), xR, yR, { align: "right" }); yR += 5;
  if (c.ruolo) { font(9, false, SOFT); doc.text(pdfSafe(c.ruolo), xR, yR, { align: "right" }); yR += 5; }
  [c.telefono && "Tel. " + c.telefono, (c.whatsapp || c.telefono) && "WhatsApp " + (c.whatsapp || c.telefono), c.email, c.telegram && "Telegram " + c.telegram, c.altro].filter(Boolean)
    .forEach(s => { font(9.5, true, ACC); doc.text(pdfSafe(s), xR, yR, { align: "right" }); yR += 4.6; });
  font(8.5, true, ACC); doc.text("CLAUDIA LUCE · CONSULENZA ENERGETICA", M, y);
  y += 8;
  text("Proposta fornitura luce", 21, { bold: true, w: colL, gap: 2 });
  text("Per " + (nomeCliente(u) || u.nome) + (u.esempio ? " (dati di esempio)" : ""), 12, { bold: true, w: colL, gap: 1 });
  text("Preparata il " + new Date().toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" }), 9, { color: SOFT, w: colL, gap: 1 });
  y = Math.max(y, yR) + 3;
  doc.setDrawColor.apply(doc, LINE); doc.setLineWidth(0.4); doc.line(M, y, M + W, y); y += 7;

  // Fornitura e situazione di oggi
  const sp = normSplit(u.split || {});
  if (an.indirizzo || an.pod) text("Fornitura: " + [an.indirizzo, an.pod && "POD " + an.pod].filter(Boolean).join(" · "), 9.5, { color: SOFT, gap: 1 });
  text("Consumi considerati: " + numIt(u.kwhAnno) + " kWh l'anno · potenza " + numIt(u.potenzaKW, 1) + " kW · " + (u.residente !== false ? "abitazione di residenza" : "seconda casa") + " · fasce F1 " + Math.round(sp.f1 * 100) + "%, F2 " + Math.round(sp.f2 * 100) + "%, F3 " + Math.round(sp.f3 * 100) + "%", 9.5, { color: SOFT, gap: 2 });
  if (cur) text("Oggi: " + cur.offer.fornitore + (cur.offer.nome && cur.offer.nome !== "Offerta attuale" ? " " + cur.offer.nome : "") + " (" + tipoT(cur.offer) + "), spesa stimata " + euro(cur.calc.totale) + " nei prossimi 12 mesi.", 10.5, { bold: true, gap: 2 });

  // Le due proposte, affiancate
  titolo("Le proposte");
  const props = [[ctx.A, 1, "Prezzo fisso"], [ctx.B, 2, ctx.kindB === "variabile" ? "Prezzo variabile" : "Alternativa a prezzo fisso"]].filter(p => p[0]);
  const gapC = 6, bw = props.length > 1 ? (W - gapC) / 2 : W, pad = 4;
  const boxLines = ([e, n, lab]) => {
    const o = e.o, isRec = rec.rec === e && rec.k !== "resta", L = [];
    const add = (t, size, bold, color, gap) => { font(size, bold); doc.splitTextToSize(pdfSafe(t), bw - 2 * pad).forEach((ln, i, a) => L.push({ t: ln, size, bold, color, gap: i === a.length - 1 ? (gap || 0) : 0 })); };
    add(("Proposta " + n + " · " + lab).toUpperCase() + (isRec ? "  ·  CONSIGLIATA" : ""), 8, true, isRec ? GOOD : ACC, 2.5);
    add(o.fornitore, 13, true, INK, 0.5);
    add(o.nome, 10, false, SOFT, 3);
    add(euro(e.costo) + " in 12 mesi", 17, true, INK, 1);
    add(euro(e.mese) + " al mese · " + cent(e.r.calc.cKWh) + " tutto compreso", 8.5, false, SOFT, 2);
    if (cur) add(e.risparmio > 0 ? "Risparmio " + euro(e.risparmio) + " l'anno (-" + pctIt(e.pct) + ")" : "Costa " + euro(-e.risparmio) + " l'anno più di oggi", 10.5, true, e.risparmio > 0 ? GOOD : BAD, 2.5);
    else if (e.vsMedia != null) add((e.vsMedia >= 0 ? euro(e.vsMedia) + " meno" : euro(-e.vsMedia) + " più") + " di un'offerta nella media", 10, true, e.vsMedia >= 0 ? GOOD : BAD, 2.5);
    add("Valutazione: " + e.grado.t, 9, true, e.grado.k === "good" ? GOOD : e.grado.k === "warn" ? WARN : BAD, 2.5);
    add("Prezzo energia: " + prezzoTesto(o), 8.5, false, INK, 1);
    add("Quota fissa: " + euro2(+o.quotaFissaMese || 0) + " al mese", 8.5, false, INK, 1);
    if (o.tipo === "fisso") add("Prezzo bloccato per " + (o.durataMesi || 12) + " mesi", 8.5, false, INK, 1);
    else add("Il prezzo segue la borsa: in 12 mesi la spesa può andare da " + euro(e.basso) + " a " + euro(e.alto), 8.5, false, INK, 1);
    if (o.validoFino) add("Prezzo valido per adesioni entro il " + dataIt(o.validoFino), 8.5, false, SOFT, 1);
    return { L, isRec };
  };
  const boxes = props.map(boxLines);
  const hBox = Math.max(...boxes.map(b => b.L.reduce((s, l) => s + LH(l.size) + l.gap, 0))) + 6.5;
  need(hBox + 2);
  boxes.forEach((b, i) => {
    const x = M + i * (bw + gapC);
    if (b.isRec) { doc.setFillColor(230, 244, 236); doc.setDrawColor.apply(doc, GOOD); doc.setLineWidth(0.6); doc.roundedRect(x, y - 2, bw, hBox, 2.5, 2.5, "FD"); }
    else { doc.setFillColor(245, 247, 248); doc.setDrawColor.apply(doc, LINE); doc.setLineWidth(0.3); doc.roundedRect(x, y - 2, bw, hBox, 2.5, 2.5, "FD"); }
    let yy = y + pad + 1;
    b.L.forEach(l => { font(l.size, l.bold, l.color); doc.text(l.t, x + pad, yy); yy += LH(l.size) + l.gap; });
  });
  y += hBox + 4;

  // La valutazione
  titolo("La nostra valutazione");
  const e = rec.rec;
  const head = rec.k === "resta" ? "L'offerta attuale è già conveniente: oggi non conviene cambiare."
    : rec.k === "poco" ? "Consigliata la proposta " + rec.n + " (" + e.o.fornitore + "), ma il risparmio è piccolo: " + euro(e.risparmio) + " l'anno."
    : rec.k === "cambia" ? "Consigliata la proposta " + rec.n + " (" + e.o.fornitore + "): risparmio stimato " + euro(e.risparmio) + " l'anno, " + euro(e.risparmio / 12) + " al mese."
    : "Consigliata la proposta " + rec.n + " (" + e.o.fornitore + " " + e.o.nome + "): " + euro(e.costo) + " in 12 mesi.";
  text(head, 11.5, { bold: true, color: rec.k === "cambia" || rec.k === "nuovo" ? GOOD : WARN, gap: 2.5 });
  ctx.motivi.forEach(m => bullet(m.s, 9));

  // Cosa sapere sulle proposte
  const noteP = props.map(([pe, n]) => consumerNotes(pe.r, null, u).filter(x => x.t !== "ok" && !/^Prezzo variabile ogni mese/.test(x.s)).slice(0, 3).map(x => "Proposta " + n + ": " + x.s)).flat();
  if (noteP.length) { titolo("Da sapere"); noteP.forEach(s => bullet(s, 9)); }

  // Come si attiva
  titolo("Come si attiva");
  ["Servono un documento d'identità, il codice fiscale e il codice POD" + (an.pod ? " (" + an.pod + ")" : ", che si trova in bolletta") + ". Per l'addebito automatico serve anche l'IBAN.",
   "Il cambio è gratuito, la luce non si interrompe e alla disdetta con il vecchio fornitore pensa il nuovo.",
   "Prima di firmare si legge insieme la scheda sintetica dell'offerta, con prezzi e condizioni ufficiali.",
   "Per attivare la proposta o per qualsiasi domanda: " + [c.nome, c.telefono && "tel. " + c.telefono, c.email].filter(Boolean).join(", ") + "."].forEach(s => bullet(s, 9));

  // Mercato e metodo, in piccolo in fondo
  y += 3;
  const pc = S.market.pun.meseCorrente || S.market.pun.storico[S.market.pun.storico.length - 1];
  text("Prezzo all'ingrosso dell'energia (PUN) di " + MESI_LUNGHI[+pc.mese.slice(5, 7) - 1] + ": " + kwhPrice(pc.mono, 3) + " €/kWh. La borsa prevede in media " + kwhPrice(punPrevisto(ctx.mult, ctx.start), 3) + " €/kWh nei prossimi 12 mesi (futures del " + dataIt(S.market.forward.rilevatoAl) + ")." +
    (ctx.mult !== 1 ? " Calcolo fatto con lo scenario: prezzi " + (ctx.mult > 1 ? "in salita del " : "in discesa del ") + Math.round(Math.abs(ctx.mult - 1) * 100) + "%." : ""), 7.5, { color: SOFT, gap: 1 });
  text("Le cifre sono la spesa stimata dei prossimi 12 mesi e comprendono energia, perdite di rete, dispacciamento, quota fissa, trasporto, oneri di sistema, accise e IVA" + (ctx.canone ? ", più il canone RAI" : "") + ". Per le offerte variabili il prezzo futuro viene dai futures di borsa ed è una previsione, non una certezza. Dati di mercato aggiornati al " + dataIt(S.market.updatedAt) + ".", 7.5, { color: SOFT });

  // Piè di pagina con i contatti del promotore su ogni pagina
  const n = doc.getNumberOfPages();
  const piede = [c.nome, c.telefono && "Tel. " + c.telefono, c.email].filter(Boolean).join(" · ");
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setDrawColor.apply(doc, LINE); doc.setLineWidth(0.3); doc.line(M, 287, M + W, 287);
    font(8, false, SOFT); doc.text(pdfSafe(piede), M, 291); doc.text("Pagina " + i + " di " + n, M + W, 291, { align: "right" });
  }
  return { blob: doc.output("blob"), fname: nomeFilePdf(u) + ".pdf" };
}
function propostaTesto(ctx) {
  const c = consulente(), u = ctx.u, an = u.anagrafica || {};
  const L = ["PROPOSTA FORNITURA LUCE", "Preparata da " + [c.nome, c.ruolo, c.telefono && "tel. " + c.telefono, c.email].filter(Boolean).join(" - "), "Per " + (nomeCliente(u) || u.nome) + " - " + new Date().toLocaleDateString("it-IT")];
  if (an.indirizzo || an.pod) L.push("Fornitura: " + [an.indirizzo, an.pod && "POD " + an.pod].filter(Boolean).join(" - "));
  L.push("", messaggioCliente(ctx, (u.proposta && u.proposta.tono) || "lei"), "", "VALUTAZIONE");
  ctx.motivi.forEach(m => L.push("- " + m.s));
  L.push("", "Stima su 12 mesi comprensiva di energia, perdite di rete, dispacciamento, quota fissa, trasporto, oneri, accise e IVA. Dati di mercato aggiornati al " + dataIt(S.market.updatedAt) + ".");
  return L.join("\n");
}
async function scaricaPdf() {
  const dl = S.caps.downloads;
  if (!dl) { toast("Il salvataggio dei file non è disponibile in questa vista."); return; }
  const ctx = S.prCtx || propostaCtx();
  const btn = $("#btnPrPdf"); btn.disabled = true;
  let r = null;
  try {
    r = await buildPdf(ctx); if (!r) return;
    await dl.save({ filename: r.fname, data: r.blob });
    toast("PDF salvato: ora allegalo al messaggio per il cliente.");
  } catch (e) {
    const c = e && e.code;
    if (c === "declined") { /* annullato */ }
    else if (!c || c === "extension_not_enabled" || c === "rejected_extension") {
      try { await dl.save({ filename: nomeFilePdf(ctx.u) + ".txt", data: propostaTesto(ctx) }); toast("Il PDF non è disponibile qui: ho preparato la proposta come testo."); }
      catch (e2) { if (!e2 || e2.code !== "declined") toast("Non è stato possibile creare la proposta in questa vista."); }
    } else toast("Non è stato possibile salvare il PDF in questa vista.");
  } finally { btn.disabled = false; }
}
async function condividiPdf() {
  const how = canSharePdf(); if (!how) return;
  const ctx = S.prCtx || propostaCtx();
  try {
    const r = await buildPdf(ctx); if (!r) return;
    const msg = $("#prMsg").value;
    if (how === "android") { window.ClaudiaAndroid.shareFile(r.fname, "application/pdf", await blobToBase64(r.blob), msg); return; }
    await navigator.share({ files: [new File([r.blob], r.fname, { type: "application/pdf" })], title: oggettoEmail(), text: msg });
  } catch (e) {
    if (e && e.name === "AbortError") return;
    toast("Condivisione non riuscita: scarica il PDF e allegalo al messaggio.");
  }
}
async function copiaMsg() {
  const t = $("#prMsg");
  try { await navigator.clipboard.writeText(t.value); toast("Messaggio copiato: incollalo nella chat o nell'email."); }
  catch (e) { t.focus(); t.select(); toast("Il testo è selezionato: copialo con Ctrl+C, oppure tieni premuto e scegli Copia."); }
}
function onPropostaInput(e) {
  const id = e.target.id, u = U();
  if (/^pc[A-Z]/.test(id)) {
    S.user.consulente = { nome: $("#pcNome").value.trim(), ruolo: $("#pcRuolo").value.trim(), telefono: $("#pcTel").value.trim(), whatsapp: $("#pcWa").value.trim(), email: $("#pcEmail").value.trim(), telegram: $("#pcTg").value.trim(), altro: $("#pcAltro").value.trim() };
    scheduleSave(); renderPromoter(); aggiornaMsg(); return;
  }
  if (id === "prEmail" || id === "prTel") {
    u.anagrafica = Object.assign({}, u.anagrafica, { [id === "prEmail" ? "email" : "telefono"]: e.target.value.trim() || null });
    scheduleSave(); renderLinks(); return;
  }
  if (id === "prMsg") { u.proposta = Object.assign({}, u.proposta, { msg: e.target.value }); scheduleSave(); $("#prMsgHint").textContent = "Hai modificato il testo a mano: se cambi le proposte, premi «Riscrivi il messaggio» per aggiornare i numeri."; renderLinks(); }
}
function wireProposta() {
  $("#sec-proposta").addEventListener("input", e => { if (e.target.matches("input,textarea")) onPropostaInput(e); });
  $("#prCards").addEventListener("change", e => {
    const s = e.target.closest("select[data-kind]"); if (!s) return;
    const u = U(), k = s.dataset.kind === "fisso" ? "fisso" : s.dataset.kind === "variabile" ? "variabile" : "fisso2";
    u.proposta = Object.assign({}, u.proposta, { [k]: s.value }); scheduleSave(); renderProposta();
  });
  $("#prVarNote").addEventListener("click", e => {
    const b = e.target.closest("[data-var]"); if (!b) return;
    const u = U(); u.proposta = Object.assign({}, u.proposta, { conVariabile: b.dataset.var === "si" ? true : b.dataset.var === "no" ? false : null });
    scheduleSave(); renderProposta();
  });
  $("#prTono").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const u = U(); u.proposta = Object.assign({}, u.proposta, { tono: b.dataset.v, msg: null }); scheduleSave(); renderProposta();
  });
  $("#btnPrRegen").addEventListener("click", () => { const u = U(); u.proposta = Object.assign({}, u.proposta, { msg: null }); scheduleSave(); $("#prMsg").value = ""; $("#prMsg").blur(); aggiornaMsg(); toast("Messaggio riscritto con i numeri aggiornati."); });
  $("#btnPrCopy").addEventListener("click", copiaMsg);
  $("#btnPrPdf").addEventListener("click", scaricaPdf);
  $("#btnPrShare").addEventListener("click", condividiPdf);
}

function renderCtx() {
  const opts = S.user.utenze.map(u => '<option value="' + esc(u.id) + '"' + (u.id === S.user.attivaId ? " selected" : "") + ">" + esc(u.nome) + "</option>").join("");
  $("#selUtenza").innerHTML = opts; $("#selUtenza2").innerHTML = opts; $("#selUtenza3").innerHTML = opts;
  const u = U(), sp = normSplit(u.split || {});
  $("#ctxFacts").innerHTML = (u.esempio ? '<span class="example-tag">Dati di esempio</span>' : "") +
    '<span class="fact">' + numIt(u.kwhAnno) + " kWh/anno</span>" + '<span class="fact">' + numIt(u.potenzaKW, 1) + " kW</span>" +
    '<span class="fact">' + (u.residente !== false ? "residente" : "seconda casa") + "</span>" +
    '<span class="fact">F1 ' + Math.round(sp.f1 * 100) + "% · F2 " + Math.round(sp.f2 * 100) + "% · F3 " + Math.round(sp.f3 * 100) + "%</span>";
  $("#prFacts").innerHTML = $("#ctxFacts").innerHTML;
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
  const an = u.anagrafica || {};
  for (const [id, k] of ANAG_CAMPI) { const el = $("#" + id); if (document.activeElement !== el) el.value = an[k] || ""; }
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
const ANAG_CAMPI = [["anIntest", "intestatario"], ["anCF", "codiceFiscale"], ["anIndirizzo", "indirizzo"], ["anPod", "pod"], ["anCodCli", "codiceCliente"], ["anEmail", "email"], ["anTel", "telefono"]];
function markEdited(u) { if (u.esempio) { u.esempio = false; if (/^Esempio/.test(u.nome)) { u.nome = "Nuovo cliente"; $("#inNome").value = u.nome; } } }
function onFormChange(e) {
  const u = U(), id = e.target.id;
  if (id === "inNome") { u.nome = e.target.value.trim() || "Cliente"; renderCtx(); scheduleSave(); return; }
  if (id === "inNote") { u.noteCliente = e.target.value; scheduleSave(); return; }
  const campo = ANAG_CAMPI.find(x => x[0] === id);
  if (campo) {
    let v = e.target.value.trim();
    if (campo[1] === "pod" || campo[1] === "codiceFiscale") v = v.toUpperCase().replace(/\s/g, "");
    u.anagrafica = Object.assign({}, u.anagrafica, { [campo[1]]: v || null });
    scheduleSave(); return;
  }
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
{"cliente":{"nome":string|null,"codiceFiscale":string|null,"indirizzo":string|null,"pod":string|null,"codiceCliente":string|null},"fornitore":string|null,"offerta":string|null,"tipo":"fisso"|"indicizzato"|null,"consumoAnnuoKWh":number|null,"consumoAnnuoPeriodo":{"da":"AAAA-MM-GG"|null,"a":"AAAA-MM-GG"|null},"potenzaKW":number|null,"residente":true|false|null,"periodo":{"da":"AAAA-MM-GG"|null,"a":"AAAA-MM-GG"|null},"consumiPeriodoKWh":{"f1":number|null,"f2":number|null,"f3":number|null,"f23":number|null,"totale":number|null},"prezzoEnergia":{"mono":number|null,"f1":number|null,"f2":number|null,"f3":number|null,"f23":number|null},"spreadKWh":number|null,"quotaFissaMese":number|null,"scadenzaPrezzo":"AAAA-MM-GG"|null,"totaleBolletta":number|null,"note":string}
Regole:
- consumoAnnuoKWh è il "consumo annuo" che la bolletta riporta; se manca usa null. Metti in consumoAnnuoPeriodo le date a cui si riferisce: molte bollette, per forniture iniziate da poco, riportano come "consumo annuo" solo i mesi dall'inizio della fornitura.
- Se c'è una tabella dei consumi mensili per fascia, usala per consumiPeriodoKWh solo se mancano i consumi del periodo fatturato.
- prezzoEnergia: prezzo unitario della sola componente energia (spesa per la materia energia) in €/kWh, IVA esclusa, senza perdite, dispacciamento, trasporto, oneri o accise. Se l'offerta è indicizzata (PUN + spread) metti lo spread in spreadKWh e lascia null i prezzi.
- quotaFissaMese: quota fissa/commercializzazione del fornitore in €/mese IVA esclusa (converti se è espressa per anno o per giorno). Non includere la quota fissa di trasporto.
- residente: true se abitazione di residenza, false se non residente.
- cliente: dati dell'intestatario del contratto come scritti in bolletta. nome = nome e cognome (o ragione sociale); codiceFiscale = codice fiscale dell'intestatario; indirizzo = indirizzo di FORNITURA (dove si trova il contatore, con CAP e comune), non quello di recapito della bolletta; pod = codice POD che inizia con IT (es. IT001E12345678); codiceCliente = codice o numero cliente presso il fornitore. Non confondere i dati del cliente con quelli del fornitore.
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
  const cl = r.cliente || {};
  add("Intestatario", cl.nome); add("Codice fiscale", cl.codiceFiscale); add("Indirizzo di fornitura", cl.indirizzo); add("POD", cl.pod); add("Codice cliente", cl.codiceCliente);
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
/* A quale cliente appartiene la bolletta: stesso POD o stesso nome = cliente già presente;
   se il cliente aperto è un'altra persona, ne creo uno nuovo invece di sovrascriverlo. */
const NOME_PROVVISORIO = /^(?:nuovo cliente(?: \d+)?|cliente(?: \d+)?|esempio.*)$/i;
function chiaveNome(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean).sort().join(" "); }
function clientePerBolletta(c) {
  const cur = U();
  if (!c || (!c.nome && !c.pod)) return { u: cur, come: "attuale" };
  const stesso = x => { const a = x.anagrafica || {}; return (c.pod && a.pod === c.pod) || (c.nome && [a.intestatario, x.nome].some(n => n && chiaveNome(n) === chiaveNome(c.nome))); };
  if (stesso(cur)) return { u: cur, come: "stesso" };
  const altro = S.user.utenze.find(x => x !== cur && stesso(x));
  if (altro) return { u: altro, come: "esistente" };
  const a = cur.anagrafica || {};
  if (!cur.esempio && (a.pod || a.intestatario || !NOME_PROVVISORIO.test(cur.nome || ""))) return { u: null, come: "nuovo" };
  return { u: cur, come: "attuale" };
}
function showBillResult(r, srcLabel) {
  r.cliente = normCliente(r.cliente);
  const prevAttiva = S.user.attivaId;
  const scelta = clientePerBolletta(r.cliente);
  let u = scelta.u;
  if (!u) { u = nuovaUtenza(r.cliente.nome || "Nuovo cliente " + (S.user.utenze.length + 1), false); S.user.utenze.push(u); }
  S.undoBill = { id: u.id, data: scelta.come === "nuovo" ? null : clone(u), prevAttiva };
  S.user.attivaId = u.id;
  r.destinazione = { come: scelta.come, nome: null };
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
  const dst = r.destinazione || {};
  const dove = dst.come === "nuovo" ? "Ho creato il nuovo cliente <strong>" + esc(dst.nome) + "</strong> con i dati della bolletta."
    : dst.come === "esistente" ? "La bolletta è di <strong>" + esc(dst.nome) + "</strong>, già tra i tuoi clienti: ho aggiornato i suoi dati."
    : dst.nome ? "Dati salvati nel cliente <strong>" + esc(dst.nome) + "</strong>." : "";
  const manca = !(r.cliente && r.cliente.nome) ? " Non ho trovato il nome dell'intestatario: puoi scriverlo nella scheda del cliente qui sotto." : "";
  extractUI(head + (dove || manca ? '<p class="small">' + dove + manca + "</p>" : "") + '<div class="row"><button class="btn primary" type="button" id="btnGoRank">Vedi la classifica completa</button><button class="btn" type="button" id="btnUndoBill">Annulla i dati letti</button></div>' +
    '<details class="panel"><summary class="small" style="cursor:pointer;font-weight:600">Dati letti ' + esc(L.srcLabel) + '</summary><div class="tbl-wrap" style="margin-top:10px"><table class="data">' + billRowsHtml(r) + '</table></div><p class="tiny" style="margin-top:6px">' + esc(r.note || "") + " Li trovi anche qui sotto, nei campi del cliente: puoi correggerli.</p></details>");
  try { $("#extractOut").scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) { /* ignora */ }
  $("#btnGoRank").onclick = () => { showTab("classifica"); window.scrollTo(0, 0); };
  $("#btnUndoBill").onclick = () => {
    const b = S.undoBill; if (!b) return;
    const i = S.user.utenze.findIndex(x => x.id === b.id);
    if (i >= 0) { if (b.data) S.user.utenze[i] = b.data; else S.user.utenze.splice(i, 1); }
    if (S.user.utenze.some(x => x.id === b.prevAttiva)) S.user.attivaId = b.prevAttiva;
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
  const c = r.cliente || {};
  const an = u.anagrafica = Object.assign({}, u.anagrafica);
  if (c.nome) an.intestatario = c.nome;
  if (c.codiceFiscale) an.codiceFiscale = c.codiceFiscale;
  if (c.indirizzo) an.indirizzo = c.indirizzo;
  if (c.pod) an.pod = c.pod;
  if (c.codiceCliente) an.codiceCliente = c.codiceCliente;
  if (c.nome && NOME_PROVVISORIO.test(u.nome || "")) u.nome = c.nome;
  if (r.destinazione) r.destinazione.nome = u.nome;
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
    const letto = await claudeRead(BILL_PROMPT, scansione ? "" : pdf.text, imgs);
    if (pdf.text && pdf.text.trim()) letto.cliente = mergeRead(letto.cliente || {}, localBillParse(pdf.text).cliente);
    showBillResult(letto, "dal PDF");
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
      try { const snap = await db.doc("data/users/" + uid + "/watt").get(); if (!(snap.exists && caricaDati(snap.data()))) { loadLocal(); if (!S.bloccato && S.user.utenze.some(u => !u.esempio)) scheduleSave(); } }
      catch (e) { loadLocal(); }
    } else loadLocal();
    renderAll();
  });
  c.use("sample").then(async s => {
    S.caps.sample = s;
    if (s) { const lim = await s.limits().catch(() => null); S.caps.images = lim && lim.images ? lim.images : null; }
    $("#chatNote").textContent = s ? "Le risposte usano il tuo account Claude." : "Claude non è disponibile in questa vista.";
  });
  c.use("downloads").then(d => { S.caps.downloads = d; $("#btnExport").hidden = !d; renderProposta(); });
}

/* ---------- Versione Android ---------- */
const _ocrCb = {};
window.__ocrDone = function (id, text, err) { const cb = _ocrCb[id]; if (!cb) return; delete _ocrCb[id]; if (err) cb.reject(new Error(err)); else cb.resolve(text || ""); };
function blobToBase64(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(blob); }); }
async function ocrBlob(blob) {
  const b64 = await blobToBase64(blob);
  const id = "o" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  return new Promise((resolve, reject) => { _ocrCb[id] = { resolve, reject }; window.ClaudiaAndroid.ocr(b64, id); setTimeout(() => { if (_ocrCb[id]) { delete _ocrCb[id]; reject(new Error("timeout")); } }, window.CLAUDIA_WEBAPP ? 240000 : 60000); });
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
  $("#btnExport").hidden = false;
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
  const base = { app: "Claudia Luce", tipo: "backup", creato: new Date().toISOString() };
  const data = JSON.stringify(PROT.key ? Object.assign(base, { cifrato: await cifra(S.user) }) : Object.assign(base, { dati: S.user }), null, 1);
  try { await d.save({ filename: "claudia-luce-backup-" + todayISO() + ".json", data }); }
  catch (e) { if (!e || e.code !== "declined") toast("Non è stato possibile salvare il backup."); }
}
async function importBackup(file) {
  if (!file) return;
  let j;
  try { j = JSON.parse(await file.text()); } catch (e) { toast("Questo file non è un backup di Claudia Luce."); return; }
  const cif = j && j.tipo === "backup" && j.cifrato;
  const dati = j && j.dati;
  if (!cif && (!dati || !Array.isArray(dati.utenze))) { toast("Questo file non è un backup di Claudia Luce."); return; }
  const box = $("#backupConfirm");
  box.hidden = false;
  $("#backupCodeL").hidden = !cif; $("#backupCode").value = "";
  $("#backupConfirmText").textContent = cif ? "Il backup è protetto: scrivi il suo codice. Sostituirà i dati attuali." : "Il backup contiene " + dati.utenze.length + " clienti. Vuoi sostituire i dati attuali?";
  $("#btnBackupYes").onclick = async () => {
    let d = dati;
    if (cif) {
      const r = await decifra(cif, $("#backupCode").value);
      if (!r) { toast("Codice del backup sbagliato."); return; }
      d = r.dati;
      if (!PROT.key) Object.assign(PROT, r.prot);   // il backup era protetto: resta protetto anche qui
    }
    if (adoptUser(d)) { await salvaOra(); renderAll(); renderProt(); toast("Backup ripristinato."); }
    box.hidden = true;
  };
  $("#btnBackupNo").onclick = () => { box.hidden = true; };
}

/* ---------- Avvio ---------- */
function showTab(t) {
  $$(".tab").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
  $$("[data-sec]").forEach(s => { s.hidden = s.dataset.sec !== t; });
  lsSet("wattgiusto.tab", t);
  if (t === "mercato") renderPunChart();
  if (t === "proposta") {
    renderProposta(); loadJsPdf().catch(() => {});
    // la prima volta, se mancano i contatti del promotore, apro subito i campi per inserirli
    if (!S.pmAperto) { S.pmAperto = true; const c = consulente(); $("#pmEdit").open = !c.telefono && !c.email; }
  }
}
function boot() {
  $$(".tab").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-goto]"); if (b) { showTab(b.dataset.goto); window.scrollTo(0, 0); } });
  const onSel = e => { S.user.attivaId = e.target.value; scheduleSave(); renderAll(); };
  $("#selUtenza").addEventListener("change", onSel); $("#selUtenza2").addEventListener("change", onSel); $("#selUtenza3").addEventListener("change", onSel);
  $("#segTipo").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; S.user.vista.tipo = b.dataset.v; $$("#segTipo button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); scheduleSave(); renderRanking(); });
  $("#selOrdina").addEventListener("change", e => { S.user.vista.ordina = e.target.value; scheduleSave(); renderRanking(); });
  $("#selScenario").addEventListener("change", e => { S.user.vista.scenario = e.target.value; scheduleSave(); renderRanking(); });
  $("#chkCanone").addEventListener("change", e => { S.user.vista.canone = e.target.checked; scheduleSave(); renderRanking(); });
  $("#sec-consumi").addEventListener("input", e => { if (e.target.matches("input,select") && !e.target.closest(".drop") && !e.target.closest("#protPanel") && !e.target.closest("#backupConfirm") && e.target.id !== "selUtenza2") onFormChange(e); });
  $("#lockForm").addEventListener("submit", sblocca);
  $("#btnLockReset").addEventListener("click", cancellaDatiProtetti);
  $("#btnProtOn").addEventListener("click", attivaCodice);
  $("#btnProtLock").addEventListener("click", bloccaAdesso);
  $("#btnLock").addEventListener("click", bloccaAdesso);
  $("#btnProtChange").addEventListener("click", cambiaCodice);
  $("#btnProtOff").addEventListener("click", togliCodice);
  renderProt();
  // si blocca da solo se resta in sottofondo per più di 5 minuti; quando va in sottofondo salvo subito
  let nascostaDal = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { nascostaDal = Date.now(); if (saveTimer) salvaOra(); }
    else if (PROT.key && nascostaDal && Date.now() - nascostaDal > BLOCCO_DOPO_MS) bloccaAdesso();
  });
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
  wireProposta();
  $("#btnRefresh").addEventListener("click", () => loadRemoteData(true));
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
