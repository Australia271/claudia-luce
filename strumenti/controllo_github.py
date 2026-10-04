#!/usr/bin/env python3
"""Controllo indipendente da Claude, eseguito ogni giorno da GitHub Actions.
Legge data/dati.json (il file che scarica l'app Android) e fallisce se i prezzi
non sono stati aggiornati nelle ultime 30 ore o se mancano dati essenziali.
Uso: python3 strumenti/controllo_github.py  -> stampa l'esito; codice 1 se c'è un problema."""
import json, os, sys
from datetime import datetime, timedelta, timezone, date

repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = json.load(open(os.path.join(repo, "data", "dati.json"), encoding="utf-8"))
ora = datetime.now(timezone.utc)
oggi = ora.date()
problemi = []
def quando(iso):
    try: return datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except Exception: return None
m, st = d.get("market", {}), d.get("status", {})
for nome, iso in [("prezzi di mercato", m.get("updatedAt")), ("ultimo aggiornamento", st.get("lastRun"))]:
    t = quando(iso or "")
    if not t or ora - t > timedelta(hours=30):
        problemi.append("%s fermi a %s" % (nome, iso))
reg = m.get("regolato", {})
try:
    if not (date.fromisoformat(reg["validoDal"]) <= oggi <= date.fromisoformat(reg["validoAl"])):
        problemi.append("tariffe ARERA scadute (valide %s - %s)" % (reg["validoDal"], reg["validoAl"]))
except Exception:
    problemi.append("tariffe ARERA mancanti")
attive = [o for o in d.get("offers", []) if o.get("attiva") is not False]
if len(attive) < 20: problemi.append("solo %d offerte attive" % len(attive))
if problemi:
    print("PROBLEMA: " + "; ".join(problemi)); sys.exit(1)
print("OK: prezzi del %s, %d offerte attive" % (m.get("updatedAt"), len(attive)))
