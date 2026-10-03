# Claudia Luce per Android

App per confrontare le offerte luce, con lo stesso motore di calcolo della versione web.

## Cosa c'è in questa cartella

- `android/`: il progetto da aprire con Android Studio.
- `data/dati.json`: i prezzi di partenza. L'app li scarica da qui quando questo file sta in un indirizzo pubblico, per esempio GitHub.
- `web/claudia-luce.html`: la versione web, la stessa che gira dentro Claude.
- `.github/workflows/android.yml`: compila l'APK in automatico su GitHub (facoltativo).

## Creare l'APK con Android Studio

1. Installa Android Studio: è gratuito, da developer.android.com/studio.
2. Apri il progetto: **File → Open** e scegli la cartella `android`. Aspetta che finisca la sincronizzazione (in basso a destra). La prima volta scarica i componenti necessari e ci vuole qualche minuto.
3. Crea l'APK: **Build → Build App Bundle(s) / APK(s) → Build APK(s)**. A fine compilazione premi "locate" nella notifica: il file è `android/app/build/outputs/apk/debug/app-debug.apk`.
4. Installa l'APK: copialo sul telefono (cavo USB, Drive, WhatsApp a te stesso), aprilo e consenti l'installazione da questa fonte quando Android lo chiede.

In alternativa collega il telefono con il cavo USB, con il debug USB attivo, e premi ▶ **Run**: Android Studio installa e apre l'app direttamente.

Per gli aggiornamenti compila sempre dallo stesso computer: così il telefono accetta la nuova versione sopra la vecchia e i clienti salvati restano.

## Prezzi aggiornati ogni giorno

L'app scarica i prezzi ogni volta che si apre, da un file pubblico. Puoi indicare l'indirizzo in due modi:

- **Nell'app:** scheda **Mercato → Indirizzo del file prezzi**, poi "Salva e scarica".
- **Nel progetto:** `android/gradle.properties`, riga `claudiaDataUrl=`, prima di compilare.

Senza indirizzo l'app funziona con i prezzi inclusi del 3 ottobre 2026 e lo segnala in alto.

## Compilazione automatica su GitHub (facoltativa)

Caricando questa cartella in un repository GitHub, a ogni modifica l'APK compare nella sezione **Releases** con il nome "Claudia Luce, ultima versione".

La firma resta uguale tra una versione e l'altra solo se aggiungi nei **Secrets** del repository una tua chiave: `KEYSTORE_B64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`. Senza chiave, per installare una nuova versione devi prima disinstallare la vecchia. In quel caso fai prima **Dati del cliente → Salva backup**.

## Dati e privacy

Clienti, consumi e offerte aggiunte restano solo nel telefono: nessun server li riceve. Usa **Salva backup** per spostarli su un altro telefono o per non perderli.

Le foto e i PDF delle bollette vengono letti sul telefono, senza inviarli a nessuno.
