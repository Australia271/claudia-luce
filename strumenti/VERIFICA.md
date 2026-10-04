# Verifica quotidiana di Claudia Luce (ogni mattina alle 7:20)

Filippo vuole che i prezzi siano aggiornati ogni giorno e che il controllo lo faccia Claude,
senza che lui debba pensarci. L'aggiornamento lo fa l'attività "Aggiorna Claudia Luce"
alle 6:55 (sessione nuova, scrive nel database dell'artifact). Questa verifica gira nella
conversazione di Claudia Luce, l'unica che può scrivere su GitHub.

Artifact: https://claude.ai/artifact/Kjs8kp1ZwL2GwhRdPyobbm
Repository: Australia271/claudia-luce, clone in /home/claude/claudia-luce
(se la cartella manca, clonalo lì; per il controllo del calcolo serve `node`).

## 0. Tieni viva la catena
Con `list_triggers` guarda le attività "Verifica quotidiana Claudia Luce" ancora da eseguire.
Ci deve essere una verifica per ciascuno dei prossimi 3 giorni alle 7:20 ora di Roma
(05:20Z con l'ora legale, 06:20Z con l'ora solare: calcolala con Europe/Rome).
Crea con `send_later` (name "Verifica quotidiana Claudia Luce", initiation own_followup)
quelle che mancano, con questo messaggio esatto:
"Verifica quotidiana di Claudia Luce: segui strumenti/VERIFICA.md nel repository /home/claude/claudia-luce (se manca, clona Australia271/claudia-luce lì)."
Non creare doppioni per lo stesso giorno.

## 1. Scarica i dati
Con ArtifactData salva in una cartella NUOVA e vuota dello scratchpad, con `out_dir`:
get market/current, list offers (limit 200), get meta/status.

## 2. Controlla
`git -C /home/claude/claudia-luce pull --rebase origin main`, poi
`python3 strumenti/verifica.py <cartella>`.

## 3. Correggi
- `aggiornamento_mancante` o `mercato_non_aggiornato`: guarda l'ultima esecuzione di
  "Aggiorna Claudia Luce" (`list_triggers`), rilanciala con `fire_trigger` e testo
  "Aggiornamento richiesto dalla verifica delle 7:20: <problemi>". Controlla meta/status
  ogni 3 minuti (sleep) per al massimo 30 minuti, poi riscarica e ricontrolla.
- Problemi su tariffe, PUN, futures o offerte (anche dopo il rilancio): fai tu la parte
  che manca, seguendo il passo corrispondente del prompt di "Aggiorna Claudia Luce"
  (leggilo con `list_triggers`), con le stesse fonti e le stesse regole: solo numeri letti
  da una fonte, mai stime; scrivi con if_version.
- Avvisi (prezzo di un'offerta scaduto, offerta non ricontrollata da 10 giorni,
  dispacciamento non del trimestre, PUN del mese in corso vecchio): prova a sistemarli
  cercando il dato aggiornato; se la fonte non c'è ancora, lascia com'è.
- Una nota "parziale" dovuta solo a mercati chiusi nel fine settimana non è un problema.

## 4. Pubblica per l'app Android
`python3 strumenti/pubblica_dati.py <cartella>` (dopo aver riscaricato i dati se li hai
cambiati). Se data/dati.json è cambiato: commit solo di quel file, messaggio
"Prezzi aggiornati AAAA-MM-GG" con le righe di attribuzione, push su main.
Poi `python3 strumenti/verifica.py <cartella> --github`: deve finire senza problemi.

## 5. Registra
Aggiorna meta/status con "update" (if_version) del solo campo
`verifica = {at: ora ISO Europe/Rome, esito: "ok" | "problemi", note: riassunto breve}`.

## 6. Avvisa solo se serve
Se tutto è a posto non scrivere niente a Filippo.
Se resta un problema che non hai potuto correggere, avvisalo con una riga in italiano
semplice: con `SendUserMessage` e con `PushNotification` (caricali con ToolSearch).
