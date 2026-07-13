/* Matlogg service worker — gör appen installerbar och offline-kapabel när den serveras över https/localhost.
   Bump CACHE_VERSION vid varje release så gamla filer rensas. */
const CACHE_VERSION = 'matlogg-v7';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './supabase.min.js'
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(function(c){ return c.addAll(APP_SHELL); })
      .then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k!==CACHE_VERSION; })
        .map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  const url = new URL(e.request.url);
  // API-anrop (AI-uppskattning) och externa resurser (typsnitt) går alltid mot nätet.
  if(url.origin !== self.location.origin) return;
  // App-skalet: cache först, uppdatera i bakgrunden (stale-while-revalidate).
  e.respondWith(
    caches.match(e.request).then(function(cached){
      const fetched = fetch(e.request).then(function(res){
        if(res && res.ok){
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(function(c){ c.put(e.request, copy); });
        }
        return res;
      }).catch(function(){ return cached || Response.error(); });
      return cached || fetched;
    })
  );
});
