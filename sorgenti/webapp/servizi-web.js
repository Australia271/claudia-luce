/* Claudia Luce, versione da aprire con un link (iPhone, Android, Windows, Mac).
   È la stessa pagina dell'app Android: qui sotto ci sono, fatti con il browser, i
   servizi che su Android dà il telefono (window.ClaudiaAndroid):
   - prezzi aggiornati scaricati dallo stesso file pubblico dell'app;
   - lettura del testo di foto e PDF scansionati sul dispositivo (Tesseract, italiano);
   - salvataggio dei file creati (backup, proposta PDF, CSV).
   Più: funzionamento senza internet e invito a installarla come app.
   Dentro l'app Android (che scarica questa stessa pagina per aggiornarsi da sola)
   i servizi veri del telefono ci sono già: in quel caso qui non si fa niente. */
(function () {
  "use strict";
  if (window.ClaudiaAndroid) return;
  window.CLAUDIA_WEBAPP = true;
  var DATA_URL = "https://raw.githubusercontent.com/Australia271/claudia-luce/main/data/dati.json";
  var abs = function (p) { return new URL(p, location.href).href; };

  var ocrWorker = null;
  function lettore() {
    if (ocrWorker) return ocrWorker;
    ocrWorker = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "vendor/tesseract/tesseract.min.js";
      s.onload = function () {
        window.Tesseract.createWorker("ita", 1, {
          workerPath: abs("vendor/tesseract/worker.min.js"),
          corePath: abs("vendor/tesseract/"),
          langPath: abs("vendor/tesseract/lang")
        }).then(resolve, reject);
      };
      s.onerror = function () { reject(new Error("lettura del testo non disponibile senza internet la prima volta")); };
      document.head.appendChild(s);
    });
    ocrWorker.catch(function () { ocrWorker = null; });
    return ocrWorker;
  }

  window.ClaudiaAndroid = {
    version: function () { return "web"; },
    dataUrl: function () { return DATA_URL; },
    ocr: function (b64, id) {
      lettore()
        .then(function (w) { return w.recognize("data:image/jpeg;base64," + b64); })
        .then(function (r) { window.__ocrDone(id, (r && r.data && r.data.text) || "", null); },
          function (e) { window.__ocrDone(id, null, (e && e.message) || String(e)); });
    },
    saveFile: function (name, mime, b64) {
      var bin = atob(b64), u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([u8], { type: mime || "application/octet-stream" }));
      var a = document.createElement("a");
      a.href = url; a.download = name; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }
  };

  // funziona anche senza internet: la pagina e i suoi file restano salvati sul dispositivo
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () { }); });
  }

  // invito a installarla come app (icona sulla schermata Home o tra i programmi)
  var installata = function () { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; };
  var ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var richiesta = null;
  var chiusa = function () { try { return localStorage.getItem("claudia.installHint") === "no"; } catch (e) { return false; } };
  function mostra() {
    if (installata() || chiusa() || document.getElementById("installHint")) return;
    if (!ios && !richiesta) return;
    var main = document.querySelector("main.wrap"); if (!main) return;
    var box = document.createElement("div");
    box.id = "installHint"; box.className = "callout"; box.style.cssText = "margin-top:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap";
    var t = document.createElement("span"); t.style.flex = "1 1 240px";
    t.innerHTML = ios
      ? "<strong>Usala come un'app:</strong> tocca il tasto Condividi <span aria-hidden=\"true\">(il quadrato con la freccia in su)</span> e poi «Aggiungi alla schermata Home»."
      : "<strong>Usala come un'app:</strong> installala sul dispositivo, così la apri dalla sua icona e funziona anche senza internet.";
    box.appendChild(t);
    if (!ios && richiesta) {
      var b = document.createElement("button"); b.type = "button"; b.className = "btn primary small"; b.textContent = "Installa Claudia Luce";
      b.onclick = function () { richiesta.prompt(); richiesta.userChoice.finally(function () { richiesta = null; box.remove(); }); };
      box.appendChild(b);
    }
    var x = document.createElement("button"); x.type = "button"; x.className = "btn ghost small"; x.textContent = "Non ora";
    x.onclick = function () { try { localStorage.setItem("claudia.installHint", "no"); } catch (e) { } box.remove(); };
    box.appendChild(x);
    main.insertBefore(box, main.firstChild);
  }
  addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); richiesta = e; mostra(); });
  addEventListener("appinstalled", function () { var b = document.getElementById("installHint"); if (b) b.remove(); });
  document.addEventListener("DOMContentLoaded", function () {
    // il campo per cambiare l'indirizzo del file prezzi serve solo nell'app Android
    var st = document.createElement("style"); st.textContent = "#androidData{display:none!important}"; document.head.appendChild(st);
    setTimeout(mostra, 1500);
  });
})();
