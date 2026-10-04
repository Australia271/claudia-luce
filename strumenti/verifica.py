#!/usr/bin/env python3
"""Verifica quotidiana dei dati di Claudia Luce.

Controlla che i dati scaricati dal database dell'artifact (con ArtifactData out_dir:
<cartella>/market/current.json, <cartella>/offers/*.json, <cartella>/meta/status.json)
siano di oggi, completi e coerenti, che il motore di calcolo dia risultati sensati e,
con --github, che il file pubblicato per l'app Android sia lo stesso del database.

Uso: python3 strumenti/verifica.py <cartella> [--github]
Stampa un JSON {problemi, avvisi, ok}; esce con codice 1 se ci sono problemi.
"""
import glob, json, os, subprocess, sys, urllib.request
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

RAW = "https://raw.githubusercontent.com/Australia271/claudia-luce/main/data/dati.json"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = sys.argv[1]
load = lambda p: json.load(open(p, encoding="utf-8"))
market = load(os.path.join(src, "market", "current.json"))
status = load(os.path.join(src, "meta", "status.json"))
offers = [load(p) for p in sorted(glob.glob(os.path.join(src, "offers", "*.json")))]

oggi = datetime.now(ZoneInfo("Europe/Rome")).date()
problemi, avvisi, ok = [], [], []
def giorno(iso):
    try: return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(ZoneInfo("Europe/Rome")).date()
    except Exception: return None
def d(s):
    try: return date.fromisoformat(s[:10])
    except Exception: return None
def mese(dt): return "%04d-%02d" % (dt.year, dt.month)
def mese_prima(dt): return mese(dt.replace(day=1) - timedelta(days=1))
def aggiungi_mesi(m, n):
    y, mm = int(m[:4]), int(m[5:7]) - 1 + n
    return "%04d-%02d" % (y + mm // 12, mm % 12 + 1)

# 1. aggiornamento di oggi
lr = giorno(status.get("lastRun") or "")
if lr != oggi: problemi.append("aggiornamento_mancante: ultimo aggiornamento %s, oggi %s" % (lr, oggi))
else: ok.append("aggiornamento di oggi fatto (%s)" % status["lastRun"][11:16])
run = (status.get("runs") or [{}])[0]
if lr == oggi and run.get("esito") != "ok": avvisi.append("ultimo aggiornamento parziale: " + (run.get("note") or ""))
mu = giorno(market.get("updatedAt") or "")
if mu != oggi: problemi.append("mercato_non_aggiornato: market.updatedAt del %s" % mu)

# 2. tariffe regolate e dispacciamento
reg = market.get("regolato", {})
if not (d(reg.get("validoDal", "")) and d(reg["validoDal"]) <= oggi <= d(reg.get("validoAl", "1900-01-01"))):
    problemi.append("tariffe_regolate_scadute: valide %s - %s" % (reg.get("validoDal"), reg.get("validoAl")))
else: ok.append("tariffe ARERA valide fino al %s" % reg["validoAl"])
for k, v in [("trasporto.quotaFissaAnno", reg.get("trasporto", {}).get("quotaFissaAnno")), ("trasporto.quotaPotenzaKWAnno", reg.get("trasporto", {}).get("quotaPotenzaKWAnno")),
             ("trasporto.quotaEnergiaKWh", reg.get("trasporto", {}).get("quotaEnergiaKWh")), ("oneri.residente.quotaEnergiaKWh", reg.get("oneri", {}).get("residente", {}).get("quotaEnergiaKWh"))]:
    if not isinstance(v, (int, float)) or v <= 0: problemi.append("valore_regolato_mancante: " + k)
inizio_trim = date(oggi.year, 3 * ((oggi.month - 1) // 3) + 1, 1)
disp = reg.get("dispacciamento", {})
if (oggi - inizio_trim).days >= 6 and d(disp.get("validoDal", "")) != inizio_trim:
    avvisi.append("dispacciamento_non_del_trimestre: valori riferiti a %s (nota: %s)" % (disp.get("validoDal"), disp.get("nota", "")))
viv = next((o for o in offers if o.get("id") == "arera-vulnerabilita"), None)
if not viv or (d(viv.get("validoFino", "")) or date.min) < oggi: problemi.append("prezzo_vulnerabili_scaduto")

# 3. PUN e futures
pun = market.get("pun", {})
storico = [x.get("mese") for x in pun.get("storico", [])]
if mese_prima(oggi) not in storico:
    (problemi if oggi.day >= 12 else avvisi if oggi.day >= 6 else ok).append("PUN di %s %s" % (mese_prima(oggi), "mancante" if oggi.day >= 6 else "non ancora pubblicato dal GME (normale nei primi giorni)"))
else: ok.append("PUN ufficiale fino a %s" % storico[-1])
mc = pun.get("meseCorrente") or {}
if oggi.day >= 4 and (mc.get("mese") != mese(oggi) or (d(mc.get("aggiornatoAl", "")) or date.min) < oggi - timedelta(days=4)):
    avvisi.append("PUN_mese_corrente_vecchio: %s aggiornato al %s" % (mc.get("mese"), mc.get("aggiornatoAl")))
fw = market.get("forward", {})
mesi_fw = {x.get("mese") for x in fw.get("mesi", []) if isinstance(x.get("v"), (int, float)) and x["v"] > 0}
mancanti = [aggiungi_mesi(mese(oggi), i) for i in range(1, 13) if aggiungi_mesi(mese(oggi), i) not in mesi_fw]
if mancanti: problemi.append("futures_incompleti: mancano " + ", ".join(mancanti))
ril = d(fw.get("rilevatoAl", ""))
if not ril or ril < oggi - timedelta(days=4): avvisi.append("futures_vecchi: rilevati il %s" % fw.get("rilevatoAl"))
else: ok.append("futures rilevati il %s" % fw["rilevatoAl"])

# 4. offerte
attive = [o for o in offers if o.get("attiva") is not False and o.get("id") != "arera-vulnerabilita"]
scadute = [o["id"] for o in attive if o.get("validoFino") and d(o["validoFino"]) and d(o["validoFino"]) < oggi]
vecchie = [o["id"] for o in attive if (d(o.get("aggiornato", "")) or date.min) < oggi - timedelta(days=10)]
if len(attive) < 20: problemi.append("poche_offerte: %d attive" % len(attive))
else: ok.append("%d offerte attive" % len(attive))
if scadute: (problemi if len(scadute) > 0.3 * len(attive) else avvisi).append("offerte_con_prezzo_scaduto (%d): %s" % (len(scadute), ", ".join(scadute)))
if vecchie: avvisi.append("offerte_non_ricontrollate_da_10_giorni (%d): %s" % (len(vecchie), ", ".join(vecchie)))

# 5. motore di calcolo: risultati sensati per una famiglia tipo
eng = os.path.join(REPO, "sorgenti", "src", "engine.js")
js = """const fs=require('fs');eval(fs.readFileSync(%s,'utf8').replace(/^export /gm,''));
const m=JSON.parse(fs.readFileSync(%s,'utf8')),offs=JSON.parse(fs.readFileSync(0,'utf8'));
const p={kwhAnno:2700,potenzaKW:3,residente:true,split:{f1:0.33,f2:0.31,f3:0.36}};
const r=rankOffers(offs,p,m,{});const bad=r.filter(x=>!isFinite(x.calc.totale)||x.calc.totale<350||x.calc.totale>2500).map(x=>x.offer.id+':'+x.calc.totale);
console.log(JSON.stringify({n:r.length,min:Math.round(r[0].calc.totale),max:Math.round(r[r.length-1].calc.totale),bad}));""" % (json.dumps(eng), json.dumps(os.path.join(src, "market", "current.json")))
try:
    out = subprocess.run(["node", "-e", js], input=json.dumps(attive), capture_output=True, text=True, timeout=60)
    res = json.loads(out.stdout.strip().splitlines()[-1])
    if res["bad"]: problemi.append("calcolo_anomalo: " + ", ".join(res["bad"]))
    else: ok.append("calcolo ok: famiglia tipo da %d a %d €/anno su %d offerte" % (res["min"], res["max"], res["n"]))
except Exception as e:
    problemi.append("calcolo_non_eseguito: %s %s" % (e, (out.stderr if 'out' in dir() else "")[:300]))

# 6. file per l'app Android
if "--github" in sys.argv:
    try:
        with urllib.request.urlopen(RAW + "?t=" + str(int(datetime.now().timestamp())), timeout=30) as r:
            gh = json.load(r)
        if gh.get("market", {}).get("updatedAt") != market.get("updatedAt") or len(gh.get("offers", [])) != len(offers):
            problemi.append("app_android_non_aggiornata: GitHub ha mercato del %s e %d offerte" % (gh.get("market", {}).get("updatedAt"), len(gh.get("offers", []))))
        else: ok.append("file dell'app Android uguale al database")
    except Exception as e:
        problemi.append("github_non_raggiungibile: %s" % e)

print(json.dumps({"oggi": str(oggi), "problemi": problemi, "avvisi": avvisi, "ok": ok}, ensure_ascii=False, indent=1))
sys.exit(1 if problemi else 0)
