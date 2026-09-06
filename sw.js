/* Matlogg service worker — gör appen installerbar och offline-kapabel när den serveras över https/localhost.
   Bump CACHE_VERSION vid varje release så gamla filer rensas. */
const CACHE_VERSION = 'matlogg-v15';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './supabase.min.js',
  './icon-192.png'
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

function cachePut(request, res){
  if(res && res.ok){
    const copy = res.clone();
    caches.open(CACHE_VERSION).then(function(c){ c.put(request, copy); });
  }
  return res;
}

self.addEventListener('fetch', function(e){
  if(e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // API-anrop (AI-uppskattning) och externa resurser (typsnitt) går alltid mot nätet.
  if(url.origin !== self.location.origin) return;

  // Själva sidan: NÄTET FÖRST. Med cache först körde mobilen kvar på förra versionen
  // ända tills appen startats om en extra gång — buggfixar syntes alltså inte.
  // Cachen är reserv: svarar inte nätet inom 2,5 s (eller alls) används den.
  const isPage = e.request.mode === 'navigate' || url.pathname.endsWith('/index.html');
  if(isPage){
    e.respondWith(
      Promise.race([
        fetch(e.request).then(function(res){ return cachePut(e.request, res); }).catch(function(){ return null; }),
        new Promise(function(res){ setTimeout(function(){ res(null); }, 2500); })
      ]).then(function(res){
        if(res) return res;
        return caches.match(e.request).then(function(cached){
          return cached || caches.match('./index.html').then(function(fb){ return fb || fetch(e.request); });
        });
      })
    );
    return;
  }

  // Övriga appfiler: cache först, uppdatera i bakgrunden (stale-while-revalidate).
  e.respondWith(
    caches.match(e.request).then(function(cached){
      const fetched = fetch(e.request)
        .then(function(res){ return cachePut(e.request, res); })
        .catch(function(){ return cached || Response.error(); });
      return cached || fetched;
    })
  );
});
