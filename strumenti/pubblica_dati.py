#!/usr/bin/env python3
"""Crea data/dati.json (letto dall'app Android) dai documenti del database
dell'artifact salvati con ArtifactData out_dir:
  <cartella>/market/current.json, <cartella>/offers/*.json, <cartella>/meta/status.json
Uso: python3 strumenti/pubblica_dati.py <cartella>
"""
import glob, json, os, sys

src = sys.argv[1]
repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load = lambda p: json.load(open(p, encoding="utf-8"))

market = load(os.path.join(src, "market", "current.json"))
offers = [load(p) for p in sorted(glob.glob(os.path.join(src, "offers", "*.json")))]
status = load(os.path.join(src, "meta", "status.json"))
status.pop("triggerId", None)

assert market.get("regolato") and market.get("pun") and market.get("forward"), "market incompleto"
assert len(offers) >= 10, "troppe poche offerte: %d" % len(offers)
for o in offers:
    assert o.get("id") and o.get("fornitore") and o.get("tipo") in ("fisso", "indicizzato", "regolato"), o.get("id")

out = {"schema": 1, "market": market, "offers": offers, "status": status}
dest = os.path.join(repo, "data", "dati.json")
with open(dest, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
    f.write("\n")
print("scritto", dest, "-", len(offers), "offerte, mercato del", market.get("updatedAt"))
