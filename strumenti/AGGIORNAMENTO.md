# Aggiornamento quotidiano di Claudia Luce (ogni mattina alle 6:55)

Un'unica attività programmata di Claude, "Aggiorna Claudia Luce", fa tutto in una sola
sessione: aggiorna i prezzi nel database dell'artifact, li controlla e pubblica
data/dati.json per l'app Android e la versione con link (PC, Mac, iPhone).
Alle 9:30 circa GitHub Actions ("Controllo prezzi giornaliero") ricontrolla data/dati.json
senza Claude: se è vecchio apre una Issue e GitHub manda un'email a Filippo.

Filippo vuole prezzi aggiornati ogni giorno, ma spendendo il meno possibile del suo piano
Claude: per questo il lavoro pesante (il giro di tutte le offerte) si fa due volte a
settimana e negli altri giorni si aggiorna solo quello che cambia davvero.

Artifact: https://claude.ai/artifact/Kjs8kp1ZwL2GwhRdPyobbm, database letto e scritto con lo
strumento ArtifactData (caricalo con ToolSearch "select:ArtifactData").
Repository: Australia271/claudia-luce, di solito già in /home/claude/claudia-luce (se manca,
clonalo lì). Rispondi e scrivi le note in italiano.

## Regole
- Scrivi solo numeri letti da una fonte: mai stime, mai prezzi inventati. Se una fonte non
  risponde, tieni i valori che ci sono ed esito "parziale".
- Non toccare mai il percorso data/users del database. Non ripubblicare la pagina web.
- Ogni scrittura passa if_version. Conserva sempre i campi triggerId e verifica di meta/status.
- Nel repository modifica solo data/dati.json.
- Lavora in modo essenziale: non riaprire pagine già lette, non cercare la stessa cosa due
  volte, niente controlli in più di quelli scritti qui.

## 0. Che giro è oggi
- **Giro completo**: lunedì e giovedì; oppure se il messaggio contiene "Aggiornamento
  richiesto dall'app"; oppure se la verifica di ieri (meta/status.verifica) ha esito
  "problemi" sulle offerte.
- **Giro leggero**: tutti gli altri giorni.
- **Tariffe regolate e dispacciamento** (passo 4) solo nei primi 5 giorni di gennaio,
  aprile, luglio e ottobre e negli ultimi 5 giorni di marzo, giugno, settembre e dicembre,
  in qualunque giro; oppure se la verifica le segnala scadute. Negli altri giorni non aprirle.

## 1. Scarica lo stato attuale
`git -C /home/claude/claudia-luce pull --rebase origin main`.
Con ArtifactData salva in una cartella NUOVA e vuota dello scratchpad (out_dir):
get market/current, get meta/status, list offers (limit 200). Annota le version.

## 2. PUN (tutti i giorni)
- Mese concluso mancante in market.pun.storico (dal giorno 3 del mese in poi): apri
  https://gme.mercatoelettrico.org/it-it/Home/Pubblicazioni/PrezzoMedioFasce e il PDF
  "Prezzomedioperfasce<Mese><Anno>". Leggi F1, F2, F3 in €/MWh e le ore di ogni fascia.
  mono = (F1·oreF1 + F2·oreF2 + F3·oreF3) / ore totali. Aggiungi {mese:"AAAA-MM", mono, f1,
  f2, f3} in €/kWh con 5 decimali, in ordine; al massimo gli ultimi 24 mesi. Se aggiungi un
  mese, ricalcola market.rapportiFasce: per ogni mese "01"…"12" media dei rapporti f1/mono,
  f2/mono, f3/mono degli anni disponibili, 3 decimali.
- Mese in corso: una sola ricerca WebSearch "PUN oggi media mensile <mese> <anno> F1 F2 F3"
  (per esempio a4energie.it o tariffe.segugio.it) e aggiorna pun.meseCorrente {mese,
  parziale:true, aggiornatoAl, mono, f1, f2, f3, fonte}. Se non trovi valori affidabili,
  lascia quelli che ci sono.

## 3. Futures (da martedì a sabato)
Domenica e lunedì la borsa non ha chiuso nuove sedute: salta questo passo.
Apri https://ar.tradingview.com/symbols/ICEENDEX-IPB1%21/contracts (ICE Endex Italian Power
Base) e riscrivi market.forward.mesi [{mese:"AAAA-MM", v: €/MWh}] dal mese in corso per
circa 27 mesi; forward.rilevatoAl = oggi. Se la pagina non risponde, una ricerca "Italian
power base futures"; se non trovi nulla, lascia com'è e scrivilo nella nota.

## 4. Tariffe regolate e dispacciamento (solo nei giorni indicati al passo 0)
Fonte: https://www.servizioelettriconazionale.it/it-IT/tariffe/uso-domestico/biorarie/residente
e le pagine sorelle per monorarie e non residenti (€/mese × 12). Aggiorna in market.regolato:
trasporto.quotaFissaAnno, trasporto.quotaPotenzaKWAnno, trasporto.quotaEnergiaKWh,
oneri.residente.quotaEnergiaKWh, oneri.nonResidente.quotaFissaAnno,
oneri.nonResidente.quotaEnergiaKWh, validoDal, validoAl, fonti.
Dispacciamento: energiaKWh = somma in €/kWh delle componenti ARERA/Terna per i domestici sul
mercato libero (uplift, essenzialità, modulazione, interrompibilità e simili), capacitaKWh =
mercato della capacità in €/kWh, dispBTAnno = DispBT domestici €/anno, validoDal = primo
giorno del trimestre, nota = trimestre e componenti. Fonti: ARERA, Terna o le CTE di un
venditore aggiornate al trimestre (Pulsee, Octopus, NeN). Aggiorna anche
offers/arera-vulnerabilita (prezzo.f1, prezzo.f23, quotaFissaMese, validoFino) dal
comunicato ARERA del trimestre. Accise 0,0227 €/kWh, IVA 10% e perdite 10% cambiano solo
per legge.

## 5. Offerte
**Giro leggero**: ricontrolla solo le offerte attive con validoFino già passato o entro
domani, e quelle segnalate dalla verifica di ieri. Per ognuna apri la sua fonte (fonte.url)
o la pagina del fornitore su luce-gas.it. Niente ricerche generali, niente offerte nuove.
**Giro completo**: tutte le offerte, con le fonti dove i prezzi hanno la data:
- https://luce-gas.it/confronto/offerte-luce e
  luce-gas.it/fornitori/<octopus-energy|enel|edison|sorgenia|eni|hera>/offerte
- https://luce-gas.it/confronto/gestore-energia-elettrica-piu-conveniente
- https://www.papernest.it/luce-gas/compara/offerte-luce-piu-convenienti-mercato-libero/
- WebSearch "migliori offerte luce <mese> <anno> prezzo fisso" e "offerte luce PUN spread
  <mese> <anno>", coprendo Enel, Plenitude, Edison, A2A, Hera, Iren, Sorgenia, Octopus,
  E.ON, Engie, Acea, NeN, Illumia, Pulsee, Alperia, Dolomiti Energia, Magis, Lene.

In entrambi i giri, per ogni offerta ricontrollata aggiorna prezzo o spread, quotaFissaMese,
sconti, validoFino, fonte {nome,url,data} e aggiornato. Offerta non più in vendita:
attiva:false (non cancellarla). Offerte nuove (solo nel giro completo) solo se hai il prezzo
o lo spread E la quota fissa mensile, con lo stesso schema dei documenti esistenti:
{id, fornitore, nome, tipo:"fisso"|"indicizzato", fasce:"mono"|"bi"|"tri",
prezzo:{mono}|{f1,f23}|{f1,f2,f3} oppure spread:{mono}, quotaFissaMese,
sconti:[{descrizione, euroAnno, condizione?}], bonusUnaTantum?, scontoEnergiaPct?:{pct,
condizione}, durataMesi?, validoFino:"AAAA-MM-GG", requisiti?:["online","bolletta_web",
"domiciliazione"], spreadOltre?:{sogliaAnnoKWh, spread}, tetto?:{prezzoKWh,
perditeComprese}, perdite?:"incluse", dispacciamento?:"incluso", verde?, note?,
fonte:{nome,url,data}, attiva:true, aggiornato:"AAAA-MM-GG"}; doc_id = id (minuscole e
trattini). Prezzi in €/kWh IVA esclusa, solo energia. Se due fonti non coincidono, usa la
più recente e scrivilo in note.

## 6. Nota e scrittura nel database
- market.notaMercato (2-3 frasi semplici: dove sta il PUN, cosa prevedono i futures per i
  prossimi 12 mesi, se oggi conviene di più il fisso o il variabile): riscrivila nel giro
  completo o se PUN o futures sono cambiati.
- market.updatedAt = ora attuale (ISO, fuso Europe/Rome).
- Scrivi con ArtifactData "batch" (max 50 scritture, if_version, file_path per i documenti
  grandi); market/current con "set" del documento completo.
- meta/status con "update": lastRun = ora; lastFull = ora solo nel giro completo;
  runs = {at, esito:"ok"|"parziale", note} in testa, massimo 20 elementi. La nota inizia con
  "Giro completo:" o "Giro leggero:" e dice cosa è cambiato. Conserva triggerId e verifica.

## 7. Verifica e pubblicazione per l'app Android
Riscarica i dati in una cartella NUOVA (come al passo 1), poi
`python3 strumenti/verifica.py <cartella>`.
- Se ci sono **problemi**, correggi una volta sola la parte che manca, seguendo il passo
  corrispondente qui sopra, poi riscarica e ricontrolla.
- Gli **avvisi** nel giro leggero si lasciano com'è, tranne "offerte_con_prezzo_scaduto"
  (già gestito al passo 5). Un esito "parziale" dovuto solo al fine settimana non è un
  problema.
Poi `python3 strumenti/pubblica_dati.py <cartella>`. Se data/dati.json è cambiato: commit
solo di quel file, messaggio "Prezzi aggiornati AAAA-MM-GG" con le righe di attribuzione,
push su main (se il push viene rifiutato: `git pull --rebase origin main` e riprova).
Infine `python3 strumenti/verifica.py <cartella> --github`.

## 8. Registra e avvisa solo se serve
meta/status "update" (if_version) del solo campo verifica = {at: ora ISO Europe/Rome,
esito: "ok" | "problemi", note: riassunto breve}.
Se tutto è a posto non scrivere niente a Filippo. Se resta un problema che non hai potuto
correggere, avvisalo con una riga in italiano semplice con PushNotification (caricala con
ToolSearch). Alla fine riassumi in 3 righe cosa hai aggiornato e controllato.
