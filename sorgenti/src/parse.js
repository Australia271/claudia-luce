/* ===== Lettura del testo di bollette e schede sintetiche, senza Claude =====
   Usata sul telefono (testo da riconoscimento ottico o da PDF) e come
   ripiego sul web. Restituisce lo stesso formato della lettura con Claude. */
const FORNITORI_NOTI = ["Servizio Elettrico Nazionale", "Enel Energia", "Plenitude", "Eni gas e luce", "Edison Energia", "Edison", "A2A Energia", "A2A", "Hera Comm", "Hera", "Iren", "Sorgenia", "Octopus Energy", "Octopus", "E.ON", "Engie", "Acea Energia", "Acea", "NeN", "Illumia", "Pulsee", "Alperia", "Dolomiti Energia", "Magis", "Lene", "Wekiwi", "Iberdrola", "Duferco", "AGSM AIM", "Estra", "Optima", "Enegan", "Axpo", "Tate", "Sinergy", "Bluenergy", "Fastweb Energia", "Iliad", "Unoenergy", "Repower", "Green Network", "Argos", "Vivi Energia", "Edison Next"];

function parseNumIt(s) {
  s = String(s || "").trim().replace(/\s/g, "");
  if (!s) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d+,\d+$/.test(s)) s = s.replace(",", ".");
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  const v = parseFloat(s);
  return isFinite(v) ? v : null;
}
const NUM = "(\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?|\\d+(?:[.,]\\d+)?)";
function reEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function cleanText(text) {
  return String(text || "").replace(/ | /g, " ").replace(/€\s*\/\s*/g, "€/").replace(/[ \t]+/g, " ").replace(/k\s?W\s?h/gi, "kWh");
}
function firstNum(t, res, min, max) {
  for (const re of res) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m;
    while ((m = g.exec(t))) {
      const v = parseNumIt(m[1]);
      if (v != null && (min == null || v >= min) && (max == null || v <= max)) return v;
    }
  }
  return null;
}
function dateIt(s) { const m = String(s || "").match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/); if (!m) return null; const y = m[3].length === 2 ? "20" + m[3] : m[3]; return y + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0"); }

function localBillParse(text) {
  const raw = cleanText(text);
  const t = raw.replace(/\n+/g, " \n ");
  const flat = raw.replace(/\s*\n\s*/g, " ");
  const out = { fornitore: null, offerta: null, tipo: null, consumoAnnuoKWh: null, potenzaKW: null, residente: null, periodo: { da: null, a: null }, consumiPeriodoKWh: { f1: null, f2: null, f3: null, f23: null, totale: null }, prezzoEnergia: { mono: null, f1: null, f2: null, f3: null, f23: null }, spreadKWh: null, quotaFissaMese: null, scadenzaPrezzo: null, totaleBolletta: null, note: "" };
  out.fornitore = FORNITORI_NOTI.find(s => new RegExp("(^|[^A-Za-z])" + reEsc(s) + "([^A-Za-z]|$)", "i").test(flat)) || null;
  const STOP = "(?!Condizioni|Codice|Cod\\.|Data|Tipologia|Tipo|Prezzo|Valid|Periodo|Venditore|Fornitore|Scheda)";
  const off = flat.match(new RegExp("(?<![Cc]odice |l'|L'|dell')(?:[Nn]ome (?:dell'?)?[Oo]fferta|[Oo]fferta|OFFERTA)(?: commerciale)?\\s*[:\\-]?\\s*" + STOP + "([A-Z][\\w'.+]*(?:\\s" + STOP + "[A-Z0-9][\\w'.+]*){0,3})"));
  if (off) out.offerta = off[1].trim().replace(/[\s\-–:]+$/, "") || null;
  out.consumoAnnuoPeriodo = { da: null, a: null };
  const ini = flat.match(new RegExp("consumo da inizio fornitura\\s*dal\\s+(\\d{1,2}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{2,4})\\s+al\\s+(\\d{1,2}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{2,4})[^0-9]{0,10}" + NUM + "\\s*kWh", "i"));
  const due = flat.match(/periodo di fatturazione:?\s*periodo di riferimento:?[^0-9]{0,30}?dal\s+(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\s+al\s+(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})[^0-9]{0,20}?dal\s+(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\s+al\s+(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i);
  if (due) { out.periodo = { da: dateIt(due[1]), a: dateIt(due[2]) }; out.consumoAnnuoPeriodo = { da: dateIt(due[3]), a: dateIt(due[4]) }; }
  out.consumoAnnuoKWh = firstNum(flat, [new RegExp("consumo annuo[^0-9]{0,90}" + NUM + "\\s*kWh", "i"), new RegExp("consumi? (?:degli )?ultimi 12 mesi[^0-9]{0,60}" + NUM + "\\s*kWh", "i"), new RegExp("consumo annuo[^0-9]{0,40}" + NUM, "i")], 50, 100000);
  out.potenzaKW = firstNum(flat, [new RegExp("potenza (?:contrattualmente |contrattuale )?impegnata[^0-9]{0,50}" + NUM + "\\s*kW", "i"), new RegExp("potenza impegnata[^0-9]{0,30}" + NUM, "i")], 0.5, 30);
  // "consumo da inizio fornitura" è esplicito: ha la precedenza sul riquadro "consumo annuo"
  if (ini) { const v = parseNumIt(ini[3]); if (v > 0) { out.consumoAnnuoKWh = v; out.consumoAnnuoPeriodo = { da: dateIt(ini[1]), a: dateIt(ini[2]) }; } }
  if (out.potenzaKW == null) { const pd = firstNum(flat, [new RegExp("potenza disponibile[^0-9]{0,40}" + NUM + "\\s*kW", "i")], 0.5, 40); if (pd) out.potenzaKW = Math.round(pd / 1.1 * 2) / 2; }
  if (/non\s+residente|diversa dalla residenza|altri usi domestici|uso domestico non resid/i.test(flat)) out.residente = false;
  else if (/(abitazione di |cliente )?residen(te|za)/i.test(flat)) out.residente = true;
  const per = flat.match(/(?:periodo|fattura(?:zione)?|consumi)?[^0-9]{0,30}dal\s+(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\s+al\s+(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i);
  if (per && !due) { out.periodo.da = dateIt(per[1]); out.periodo.a = dateIt(per[2]); }
  const cons = f => firstNum(flat, [new RegExp("\\b" + f + "\\b[^0-9€\\n]{0,30}" + NUM + "\\s*kWh(?!\\s*\\/)", "i")], 1, 50000);
  out.consumiPeriodoKWh.f1 = cons("F1"); out.consumiPeriodoKWh.f2 = cons("F2"); out.consumiPeriodoKWh.f3 = cons("F3");
  out.consumiPeriodoKWh.f23 = cons("F23");
  out.consumiPeriodoKWh.totale = firstNum(flat, [new RegExp("(?:totale consumi|consumo (?:fatturato|totale|del periodo)|energia consumata)[^0-9]{0,40}" + NUM + "\\s*kWh", "i")], 0, 100000);
  const price = (label) => firstNum(flat, [new RegExp(label + "[^€\\n]{0,60}?" + NUM + "\\s*€\\/kWh", "i"), new RegExp(label + "[^0-9\\n]{0,60}?€\\/kWh\\s*" + NUM, "i")], 0.02, 0.8);
  out.prezzoEnergia.f1 = price("\\bF1\\b"); out.prezzoEnergia.f2 = price("\\bF2\\b"); out.prezzoEnergia.f3 = price("\\bF3\\b"); out.prezzoEnergia.f23 = price("\\bF23\\b");
  // corrispettivo energia per fascia scritto come "CEF (Netto) ... F1 0,0885 F2 0,0885 F3 0,0885"
  const cef = flat.match(new RegExp("(?:CEF|corrispettivo energia(?: fisso)?)\\s*\\(?netto\\)?[^\\n]{0,60}?F1\\s*" + NUM + "[^0-9]{0,12}(?:F2\\s*" + NUM + ")?[^0-9]{0,12}(?:F3\\s*" + NUM + ")?", "i"));
  if (cef && out.prezzoEnergia.f1 == null) {
    const v = [cef[1], cef[2], cef[3]].map(parseNumIt).filter(x => x != null && x > 0.02 && x < 0.8);
    if (v.length && v.every(x => Math.abs(x - v[0]) < 1e-6)) out.prezzoEnergia.mono = v[0];
    else if (v.length === 3) { out.prezzoEnergia.f1 = v[0]; out.prezzoEnergia.f2 = v[1]; out.prezzoEnergia.f3 = v[2]; }
  }
  if (out.prezzoEnergia.f1 == null && out.prezzoEnergia.mono == null) out.prezzoEnergia.mono = price("(?:prezzo (?:della |dell')?energia|corrispettivo energia|quota energia|materia (?:prima )?energia|componente energia|prezzo unico|monorari[ao])");
  out.spreadKWh = firstNum(flat, [new RegExp("spread[^0-9\\n]{0,40}" + NUM, "i"), new RegExp("PUN[^0-9\\n]{0,15}\\+\\s*" + NUM, "i")], 0, 0.15);
  const haPrezzi = out.prezzoEnergia.mono != null || out.prezzoEnergia.f1 != null;
  if (out.spreadKWh != null || (!haPrezzi && (/\bPUN\b/.test(flat) || /indicizzat|prezzo variabile|variabile mensilmente/i.test(flat)))) out.tipo = "indicizzato";
  else if (haPrezzi || /prezzo fisso|prezzo bloccato|fisso per|bloccato (per|fino)/i.test(flat)) out.tipo = "fisso";
  const qv = flat.match(new RegExp("quota fissa[\\s\\S]{0,200}?vendita[^0-9\\n]{0,40}" + NUM + "\\s*€\\/\\s*(mese|anno|giorno|gg)", "i"));
  const qf = qv || flat.match(new RegExp("(?:quota fissa|commercializzazione|corrispettivo fisso|costo fisso|PCV)[^€\\n]{0,70}?" + NUM + "\\s*€\\/\\s*(?:pod\\s*\\/\\s*|punto di prelievo\\s*\\/\\s*|cliente\\s*\\/\\s*)?(mese|anno|giorno|gg)", "i"));
  if (qf) { const v = parseNumIt(qf[1]); const u = qf[2].toLowerCase(); out.quotaFissaMese = u === "anno" ? v / 12 : (u === "giorno" || u === "gg") ? v * 30.42 : v; if (out.quotaFissaMese > 60) out.quotaFissaMese = null; }
  const sc = flat.match(/(?:prezzo|condizioni economiche|offerta)[^.\n]{0,60}?(?:valid[oae]|bloccat[oae]|fisso)[^.\n]{0,20}?(?:fino al|sino al|al)\s+(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i);
  if (sc) out.scadenzaPrezzo = dateIt(sc[1]);
  if (!out.scadenzaPrezzo) { const sc2 = flat.match(/(?:scadenza condizioni economiche|condizioni economiche valide fino al|prezzo bloccato fino al)[:\s]*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i); if (sc2) out.scadenzaPrezzo = dateIt(sc2[1]); }
  out.totaleBolletta = firstNum(flat, [new RegExp("totale (?:da pagare|bolletta|fattura|importo)[^0-9]{0,30}" + NUM, "i")], 1, 20000);
  const found = [out.consumoAnnuoKWh != null && "consumo annuo", out.potenzaKW != null && "potenza", (out.consumiPeriodoKWh.f1 != null) && "fasce", (out.prezzoEnergia.mono ?? out.prezzoEnergia.f1 ?? out.spreadKWh) != null && "prezzo", out.quotaFissaMese != null && "quota fissa"].filter(Boolean);
  const missing = ["consumo annuo", "potenza", "fasce", "prezzo", "quota fissa"].filter(x => !found.includes(x));
  out.note = (found.length ? "Trovati: " + found.join(", ") + "." : "Non ho riconosciuto dati utili.") + (missing.length ? " Mancano: " + missing.join(", ") + ": controlla e completa a mano." : " Controlla comunque i valori.");
  return out;
}

function localOfferParse(text) {
  const flat = cleanText(text).replace(/\s*\n\s*/g, " ");
  const r = { fornitore: null, nome: null, tipo: null, fasce: "mono", prezzo: { mono: null, f1: null, f2: null, f3: null, f23: null }, spread: { mono: null }, quotaFissaMese: null, scontiAnno: null, durataMesi: null, note: "" };
  r.fornitore = FORNITORI_NOTI.find(s => new RegExp("(^|[^A-Za-z])" + reEsc(s) + "([^A-Za-z]|$)", "i").test(flat)) || null;
  const nm = flat.match(/(?:nome (?:dell'?)?offerta|offerta)\s*[:\-]\s*([^\n,;]{3,50}?)(?=\s(?:codice|cod\.|valid|tipo|prezzo|venditore|fornitore|durata|scheda)|[,;]|$)/i);
  if (nm) r.nome = nm[1].trim().replace(/[\s\-–:]+$/, "");
  const p = (label) => firstNum(flat, [new RegExp(label + "[^€\\n]{0,60}?" + NUM + "\\s*€\\/kWh", "i"), new RegExp(label + "[^0-9\\n]{0,40}?€\\/kWh\\s*" + NUM, "i")], 0.02, 0.8);
  r.prezzo.f1 = p("\\bF1\\b"); r.prezzo.f2 = p("\\bF2\\b"); r.prezzo.f3 = p("\\bF3\\b"); r.prezzo.f23 = p("\\bF23\\b");
  r.prezzo.mono = p("(?:costo per consumi|prezzo (?:della |dell')?energia|corrispettivo energia|componente energia|prezzo fisso|monorari[ao]|prezzo unico)");
  r.spread.mono = firstNum(flat, [new RegExp("spread[^0-9\\n]{0,40}" + NUM, "i"), new RegExp("PUN[^0-9\\n]{0,15}\\+\\s*" + NUM, "i")], 0, 0.15);
  const haP = r.prezzo.mono != null || r.prezzo.f1 != null;
  r.tipo = r.spread.mono != null || (!haP && (/\bPUN\b/.test(flat) || /indicizzat|prezzo variabile/i.test(flat))) ? "indicizzato" : "fisso";
  if (r.tipo === "fisso") r.fasce = r.prezzo.f2 != null && r.prezzo.f3 != null ? "tri" : (r.prezzo.f1 != null && r.prezzo.f23 != null ? "bi" : "mono");
  const anno = firstNum(flat, [new RegExp("costo fisso anno[^0-9]{0,40}" + NUM, "i"), new RegExp("(?:quota fissa|commercializzazione|corrispettivo fisso)[^€\\n]{0,60}?" + NUM + "\\s*€\\/(?:pod\\/)?anno", "i")], 0, 500);
  const mese = firstNum(flat, [new RegExp("(?:quota fissa|commercializzazione|corrispettivo fisso|costo fisso)[^€\\n]{0,60}?" + NUM + "\\s*€\\/(?:pod\\/)?mese", "i")], 0, 50);
  r.quotaFissaMese = mese != null ? mese : anno != null ? Math.round(anno / 12 * 100) / 100 : null;
  r.durataMesi = firstNum(flat, [new RegExp("(?:durata|valid[oae]|bloccat[oae]|fisso per|fissa per)[^0-9\\n]{0,40}" + NUM + "\\s*mesi", "i")], 1, 60);
  r.note = "Letta sul telefono: controlla prezzi e quota fissa prima di aggiungerla.";
  return r;
}
if (typeof module !== "undefined") module.exports = { localBillParse, localOfferParse, parseNumIt };
