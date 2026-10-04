/* Claudia Luce: tiene una copia della pagina e dei suoi file sul dispositivo,
   così l'app si apre anche senza internet. La pagina si prende prima dalla rete
   (per avere sempre l'ultima versione) e, se non c'è rete, dalla copia salvata.
   I prezzi non passano da qui: li scarica e li conserva la pagina stessa. */
const VERSIONE = "__VERSIONE__";
const FILE = __FILE__;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSIONE).then(c => c.addAll(FILE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSIONE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req)
      .then(r => { if (r.ok) { const copia = r.clone(); caches.open(VERSIONE).then(c => c.put("index.html", copia)); } return r; })
      .catch(() => caches.match("index.html")));
    return;
  }
  e.respondWith(caches.match(req).then(salvato => salvato || fetch(req).then(r => {
    if (r.ok) { const copia = r.clone(); caches.open(VERSIONE).then(c => c.put(req, copia)); }
    return r;
  })));
});
