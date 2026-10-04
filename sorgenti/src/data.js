/* ===== Dati incorporati (copia di sicurezza) =====
   Usati solo se il database dell'app non risponde. I dati vivi arrivano dal
   database, che un'attività programmata aggiorna ogni giorno. */
const FALLBACK = {
  market: {
    schema: 1,
    updatedAt: "2026-10-03T12:30:00+02:00",
    regolato: {
      validoDal: "2026-10-01",
      validoAl: "2026-12-31",
      trasporto: { quotaFissaAnno: 23.04, quotaPotenzaKWAnno: 23.7192, quotaEnergiaKWh: 0.01473 },
      oneri: {
        residente: { quotaFissaAnno: 0, quotaEnergiaKWh: 0.033153 },
        nonResidente: { quotaFissaAnno: 95.0916, quotaEnergiaKWh: 0.033153 }
      },
      accise: { aliquotaKWh: 0.0227, franchigiaMeseKWh: 150, soglia1MeseKWh: 220, potenzaMaxKW: 3 },
      iva: 0.10,
      perdite: 0.10,
      dispacciamento: { energiaKWh: 0.0117, capacitaKWh: 0.0085, dispBTAnno: 1.2311, nota: "Componenti ARERA (uplift, essenzialità, modulazione, altri) del I trim. 2026 più stima media del corrispettivo mercato capacità." },
      canoneRaiAnno: 90,
      fonti: [
        { nome: "Servizio Elettrico Nazionale, tariffe ott-dic 2026 (trasporto, oneri)", url: "https://www.servizioelettriconazionale.it/it-IT/tariffe/uso-domestico/biorarie/residente" },
        { nome: "ARERA, comunicato IV trimestre 2026", url: "https://www.arera.it/comunicati-stampa/dettaglio/elettricita-maggior-tutela-373-nel-iv-trimestre-2026-per-i-clienti-vulnerabili" },
        { nome: "Pulsee, CTE con componenti di dispacciamento", url: "https://pulsee.it/assets/pulsee/data/it/cte_12_01/Pulsee%20Luce%20Limit.e%20-%20Condizioni%20tecnico-economiche%20e%20Scheda%20Sintetica.pdf" }
      ]
    },
    pun: {
      fonte: "GME, Prezzo medio per fasce (PUN Index)",
      url: "https://gme.mercatoelettrico.org/it-it/Home/Pubblicazioni/PrezzoMedioFasce",
      storico: [
        { mese: "2025-01", mono: 0.14305, f1: 0.1583, f2: 0.1516, f3: 0.1286 },
        { mese: "2025-02", mono: 0.15039, f1: 0.1577, f2: 0.1590, f3: 0.1399 },
        { mese: "2025-03", mono: 0.12057, f1: 0.1217, f2: 0.1349, f3: 0.1117 },
        { mese: "2025-04", mono: 0.09990, f1: 0.0959, f2: 0.1151, f3: 0.0951 },
        { mese: "2025-05", mono: 0.09356, f1: 0.0891, f2: 0.1106, f3: 0.0871 },
        { mese: "2025-06", mono: 0.11179, f1: 0.1131, f2: 0.1268, f3: 0.1036 },
        { mese: "2025-07", mono: 0.11315, f1: 0.1090, f2: 0.1271, f3: 0.1085 },
        { mese: "2025-08", mono: 0.10878, f1: 0.1056, f2: 0.1180, f3: 0.1060 },
        { mese: "2025-09", mono: 0.10908, f1: 0.1096, f2: 0.1209, f3: 0.1019 },
        { mese: "2025-10", mono: 0.11106, f1: 0.1178, f2: 0.1217, f3: 0.0995 },
        { mese: "2025-11", mono: 0.11708, f1: 0.1296, f2: 0.1240, f3: 0.1055 },
        { mese: "2025-12", mono: 0.11373, f1: 0.13009, f2: 0.11200, f3: 0.10452 },
        { mese: "2026-01", mono: 0.13266, f1: 0.15126, f2: 0.13740, f3: 0.11829 },
        { mese: "2026-02", mono: 0.11441, f1: 0.12228, f2: 0.11984, f3: 0.10530 },
        { mese: "2026-03", mono: 0.14340, f1: 0.14302, f2: 0.15391, f3: 0.13809 },
        { mese: "2026-04", mono: 0.11946, f1: 0.11114, f2: 0.13826, f3: 0.11663 },
        { mese: "2026-05", mono: 0.11935, f1: 0.10717, f2: 0.13144, f3: 0.12081 },
        { mese: "2026-06", mono: 0.13251, f1: 0.12576, f2: 0.15170, f3: 0.12724 },
        { mese: "2026-07", mono: 0.15704, f1: 0.15420, f2: 0.16938, f3: 0.15226 },
        { mese: "2026-08", mono: 0.18000, f1: 0.17452, f2: 0.20435, f3: 0.17172 },
        { mese: "2026-09", mono: 0.20754, f1: 0.20635, f2: 0.22758, f3: 0.19702 }
      ],
      meseCorrente: { mese: "2026-10", parziale: true, aggiornatoAl: "2026-10-02", mono: 0.213061, f1: 0.21057, f2: 0.251871, f3: 0.192231, fonte: "a4energie.it su dati GME" }
    },
    forward: {
      rilevatoAl: "2026-10-03",
      fonte: "ICE Endex, Italian Power Base futures (quotazioni via TradingView)",
      url: "https://www.tradingview.com/symbols/ICEENDEX-IPB1!/contracts",
      unita: "€/MWh",
      mesi: [
        { mese: "2026-10", v: 201.41 }, { mese: "2026-11", v: 205.47 }, { mese: "2026-12", v: 206.55 },
        { mese: "2027-01", v: 197.45 }, { mese: "2027-02", v: 190.86 }, { mese: "2027-03", v: 176.60 },
        { mese: "2027-04", v: 135.61 }, { mese: "2027-05", v: 137.00 }, { mese: "2027-06", v: 135.88 },
        { mese: "2027-07", v: 142.58 }, { mese: "2027-08", v: 147.55 }, { mese: "2027-09", v: 148.95 },
        { mese: "2027-10", v: 143.26 }, { mese: "2027-11", v: 146.31 }, { mese: "2027-12", v: 148.72 },
        { mese: "2028-01", v: 145.61 }, { mese: "2028-02", v: 138.58 }, { mese: "2028-03", v: 130.41 },
        { mese: "2028-04", v: 105.57 }, { mese: "2028-05", v: 98.23 }, { mese: "2028-06", v: 95.89 },
        { mese: "2028-07", v: 101.12 }, { mese: "2028-08", v: 108.39 }, { mese: "2028-09", v: 112.53 },
        { mese: "2028-10", v: 107.95 }, { mese: "2028-11", v: 113.70 }, { mese: "2028-12", v: 114.57 }
      ]
    },
    rapportiFasce: {
      "01": { f1: 1.123, f2: 1.048, f3: 0.895 }, "02": { f1: 1.059, f2: 1.052, f3: 0.925 },
      "03": { f1: 1.003, f2: 1.096, f3: 0.945 }, "04": { f1: 0.945, f2: 1.155, f3: 0.964 },
      "05": { f1: 0.925, f2: 1.142, f3: 0.972 }, "06": { f1: 0.980, f2: 1.140, f3: 0.943 },
      "07": { f1: 0.973, f2: 1.101, f3: 0.964 }, "08": { f1: 0.970, f2: 1.110, f3: 0.964 },
      "09": { f1: 1.000, f2: 1.102, f3: 0.942 }, "10": { f1: 1.061, f2: 1.096, f3: 0.896 },
      "11": { f1: 1.107, f2: 1.059, f3: 0.901 }, "12": { f1: 1.144, f2: 0.985, f3: 0.919 }
    },
    notaMercato: "Il PUN è salito da 0,13 €/kWh di gennaio a 0,21 €/kWh di settembre per la tensione sul gas (PSV intorno a 0,80 €/Smc). I futures prezzano un inverno ancora caro, intorno a 0,20 €/kWh, e un calo dalla primavera 2027 verso 0,14 €/kWh. Le offerte a prezzo fisso oggi sul mercato costano meno del PUN atteso per i prossimi 12 mesi."
  },

  offers: [
    { id: "octopus-fissa-12m", fornitore: "Octopus Energy", nome: "Fissa 12M", tipo: "fisso", fasce: "mono", prezzo: { mono: 0.1683 }, quotaFissaMese: 6, durataMesi: 12, validoFino: "2026-10-02", requisiti: ["online"], verde: true, fonte: { nome: "luce-gas.it (Selectra)", url: "https://luce-gas.it/fornitori/octopus-energy/offerte", data: "2026-10-01" }, note: "Octopus aggiorna il prezzo fisso ogni settimana: controlla quello del giorno prima di firmare." },
    { id: "octopus-flex", fornitore: "Octopus Energy", nome: "Flex Luce", tipo: "indicizzato", fasce: "mono", spread: { mono: 0.0088 }, quotaFissaMese: 6, validoFino: "2026-10-31", requisiti: ["online"], verde: true, fonte: { nome: "luce-gas.it (Selectra)", url: "https://luce-gas.it/fornitori/octopus-energy/offerte", data: "2026-10-01" } },
    { id: "edison-web-luce", fornitore: "Edison Energia", nome: "Web Luce", tipo: "fisso", fasce: "mono", prezzo: { mono: 0.168 }, quotaFissaMese: 8, sconti: [{ descrizione: "Sconto annuo", euroAnno: 30 }], durataMesi: 12, validoFino: "2026-10-07", requisiti: ["online", "bolletta_web"], fonte: { nome: "luce-gas.it (Selectra)", url: "https://luce-gas.it/fornitori/edison/offerte", data: "2026-10-01" }, note: "Disponibile anche bioraria: F1 0,172 e F23 0,167 €/kWh." },
    { id: "edison-easy-fix", fornitore: "Edison Energia", nome: "Easy Fix Luce (bioraria)", tipo: "fisso", fasce: "bi", prezzo: { f1: 0.172, f23: 0.167 }, quotaFissaMese: 12, sconti: [{ descrizione: "Sconto annuo", euroAnno: 30 }], durataMesi: 12, validoFino: "2026-10-07", fonte: { nome: "luce-gas.it (Selectra)", url: "https://luce-gas.it/fornitori/edison/offerte", data: "2026-10-01" } },
    { id: "edison-dynamic", fornitore: "Edison Energia", nome: "Dynamic Luce", tipo: "indicizzato", fasce: "mono", spread: { mono: 0.018 }, spreadOltre: { sogliaAnnoKWh: 2200, spread: 0.023 }, quotaFissaMese: 8.3, sconti: [{ descrizione: "Sconto annuo", euroAnno: 30 }], validoFino: "2026-10-07", fonte: { nome: "luce-gas.it (Selectra)", url: "https://luce-gas.it/fornitori/edison/offerte", data: "2026-10-01" }, note: "Spread 0,018 €/kWh fino a 2.200 kWh l'anno, 0,023 €/kWh oltre." },
    { id: "edison-super-flex", fornitore: "Edison Energia", nome: "Super Flex Luce", tipo: "indicizzato", fasce: "mono", spread: { mono: 0.022 }, quotaFissaMese: 12, sconti: [{ descrizione: "Sconto annuo", euroAnno: 30 }], validoFino: "2026-10-07", fonte: { nome: "luce-gas.it (Selectra)", url: "https://luce-gas.it/fornitori/edison/offerte", data: "2026-10-01" } },
    { id: "edison-world", fornitore: "Edison Energia", nome: "World Luce", tipo: "indicizzato", fasce: "mono", spread: { mono: 0 }, quotaFissaMese: 20, sconti: [{ descrizione: "Sconto annuo", euroAnno: 30 }], validoFino: "2026-10-07", fonte: { nome: "luce-gas.it (Selectra)", url: "https://luce-gas.it/fornitori/edison/offerte", data: "2026-10-01" } },
    { id: "lene-leggera-24", fornitore: "Lene", nome: "Leggera Luce 24", tipo: "fisso", fasce: "mono", prezzo: { mono: 0.1604 }, quotaFissaMese: 7, sconti: [{ descrizione: "Sconto annuo", euroAnno: 50 }], durataMesi: 24, validoFino: "2026-10-05", fonte: { nome: "luce-gas.it (Selectra)", url: "https://luce-gas.it/confronto/offerte-luce", data: "2026-10-02" } },
    { id: "alperia-smile-easy", fornitore: "Alperia Energia", nome: "Smile Easy Luce", tipo: "fisso", fasce: "mono", prezzo: { mono: 0.1298 }, quotaFissaMese: 9.1, durataMesi: 12, validoFino: "2026-10-10", fonte: { nome: "luce-gas.it (Selectra)", url: "https://luce-gas.it/confronto/offerte-luce", data: "2026-09-24" } },
    { id: "sorgenia-puntuale", fornitore: "Sorgenia", nome: "Next Energy PUNtuale Luce", tipo: "indicizzato", fasce: "mono", spread: { mono: 0 }, quotaFissaMese: 6.7, sconti: [{ descrizione: "Sconto annuo", euroAnno: 40 }], validoFino: "2026-10-08", requisiti: ["online"], fonte: { nome: "luce-gas.it (Selectra)", url: "https://luce-gas.it/fornitori/sorgenia/offerte", data: "2026-10-02" } },
    { id: "eon-luce-premia", fornitore: "E.ON", nome: "Luce Premia", tipo: "fisso", fasce: "mono", prezzo: { mono: 0.146 }, quotaFissaMese: 9, sconti: [{ descrizione: "Sconto annuo", euroAnno: 20 }], durataMesi: 12, validoFino: "2026-10-08", fonte: { nome: "luce-gas.it (Selectra)", url: "https://luce-gas.it/confronto/offerte-luce", data: "2026-10-02" }, note: "Prevede costi in caso di recesso anticipato: leggi le condizioni." },
    { id: "eon-insieme", fornitore: "E.ON", nome: "Insieme Luce", tipo: "fisso", fasce: "mono", prezzo: { mono: 0.1559 }, quotaFissaMese: 9, durataMesi: 12, validoFino: "2026-10-08", fonte: { nome: "luce-gas.it (Selectra)", url: "https://luce-gas.it/confronto/offerte-luce", data: "2026-10-02" }, note: "Prevede costi in caso di recesso anticipato: leggi le condizioni." },
    { id: "enel-fix-web", fornitore: "Enel Energia", nome: "Fix Web Luce", tipo: "fisso", fasce: "mono", prezzo: { mono: 0.1785 }, quotaFissaMese: 12, sconti: [{ descrizione: "Sconto annuo", euroAnno: 50 }], durataMesi: 12, validoFino: "2026-10-01", requisiti: ["online", "bolletta_web", "domiciliazione"], fonte: { nome: "luce-gas.it (Selectra)", url: "https://luce-gas.it/fornitori/enel/offerte", data: "2026-10-01" } },
    { id: "enel-move", fornitore: "Enel Energia", nome: "Move Luce", tipo: "fisso", fasce: "mono", prezzo: { mono: 0.208 }, quotaFissaMese: 14, durataMesi: 12, validoFino: "2026-10-01", fonte: { nome: "luce-gas.it (Selectra)", url: "https://luce-gas.it/fornitori/enel/offerte", data: "2026-09-30" }, note: "Include il servizio Enel Move Plus (riparazioni elettriche) per 36 mesi." },
    { id: "enel-flex-box", fornitore: "Enel Energia", nome: "Flex Box", tipo: "indicizzato", fasce: "mono", spread: { mono: 0.041 }, quotaFissaMese: 6, validoFino: "2026-10-22", fonte: { nome: "luce-gas.it (Selectra)", url: "https://luce-gas.it/fornitori/enel/offerte", data: "2026-10-01" } },
    { id: "plenitude-trend-casa", fornitore: "Plenitude", nome: "Trend Casa Luce", tipo: "indicizzato", fasce: "mono", spread: { mono: 0.022 }, quotaFissaMese: 12, sconti: [{ descrizione: "Sconto con domiciliazione", euroAnno: 12, condizione: "domiciliazione" }], validoFino: "2026-10-14", fonte: { nome: "luce-gas.it (Selectra)", url: "https://luce-gas.it/fornitori/eni/offerte", data: "2026-10-02" } },
    { id: "plenitude-fixa-time-24", fornitore: "Plenitude", nome: "Fixa Time 24 Luce", tipo: "fisso", fasce: "mono", prezzo: { mono: 0.2079 }, quotaFissaMese: 12, scontoEnergiaPct: { pct: 5, condizione: "domiciliazione" }, durataMesi: 24, validoFino: "2026-10-14", fonte: { nome: "luce-gas.it (Selectra)", url: "https://luce-gas.it/fornitori/eni/offerte", data: "2026-10-02" }, note: "Bioraria: F1 0,2165 e F23 0,2029 €/kWh. Durata del prezzo bloccato da verificare (12 o 24 mesi)." },
    { id: "hera-special-active", fornitore: "Hera Comm", nome: "Più Controllo Special Active Luce", tipo: "indicizzato", fasce: "mono", spread: { mono: 0.005 }, quotaFissaMese: 12, bonusUnaTantum: 30, validoFino: "2026-11-04", requisiti: ["online"], fonte: { nome: "luce-gas.it (Selectra)", url: "https://luce-gas.it/fornitori/hera/offerte", data: "2026-10-01" }, note: "Bonus digitale di 30 € per chi attiva online." },
    { id: "hera-special-flat", fornitore: "Hera Comm", nome: "Più Controllo Special Flat Luce", tipo: "fisso", fasce: "mono", prezzo: { mono: 0.1777 }, quotaFissaMese: 12, durataMesi: 12, validoFino: "2026-10-07", fonte: { nome: "luce-gas.it (Selectra)", url: "https://luce-gas.it/fornitori/hera/offerte", data: "2026-10-01" } },
    { id: "nen-surf", fornitore: "NeN", nome: "Surf Luce", tipo: "indicizzato", fasce: "mono", spread: { mono: 0 }, quotaFissaMese: 12, requisiti: ["online"], fonte: { nome: "luce-gas.it (Selectra)", url: "https://luce-gas.it/confronto/meglio-nen-o-pulsee", data: "2026-10-02" }, note: "Quota fissa riportata da un confronto Selectra: verificala sul sito NeN." },
    { id: "pulsee-limite", fornitore: "Pulsee", nome: "Luce Limit.e", tipo: "indicizzato", fasce: "mono", spread: { mono: 0 }, quotaFissaMese: 15, requisiti: ["online"], fonte: { nome: "luce-gas.it (Selectra)", url: "https://luce-gas.it/confronto/meglio-nen-o-pulsee", data: "2026-10-02" }, note: "In passato includeva un tetto massimo al prezzo per 12 mesi: controlla se è ancora previsto, perché con il PUN alto conviene molto." },
    { id: "arera-vulnerabilita", fornitore: "Servizio di tutela (ARERA)", nome: "Tutela della vulnerabilità ott-dic 2026", tipo: "regolato", fasce: "bi", prezzo: { f1: 0.27379, f23: 0.27781 }, quotaFissaMese: 3.524, perdite: "incluse", dispacciamento: "incluso", durataMesi: 3, validoFino: "2026-12-31", solo: "vulnerabili", fonte: { nome: "Servizio Elettrico Nazionale", url: "https://www.servizioelettriconazionale.it/it-IT/tariffe/uso-domestico/biorarie/residente", data: "2026-10-01" }, note: "Solo per clienti vulnerabili (over 75, bonus sociale, disabilità, ecc.). Prezzo aggiornato da ARERA ogni trimestre: qui è applicato a tutti i 12 mesi." }
  ],

  status: { lastRun: "2026-10-03T12:30:00+02:00", lastFull: "2026-10-03T12:30:00+02:00", runs: [{ at: "2026-10-03T12:30:00+02:00", esito: "ok", note: "Prima raccolta dati: PUN GME gen-set 2026, futures ICE, tariffe ARERA ott-dic 2026, 22 offerte." }] }
};
