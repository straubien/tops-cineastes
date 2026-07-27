// Service worker — cache des fichiers statiques de données
// Stratégie : network-first — sert toujours le réseau en priorité (données à jour),
// et ne retombe sur le cache que si le réseau échoue (mode hors-ligne).
// Ainsi une modification du format de muzard.json/cnudde.json ne peut plus jamais
// être masquée par une ancienne version restée en cache.
var TC_SW_CACHE = 'tc-static-v2';
var TC_SW_FILES = ['muzard.json', 'cnudde.json'];

self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(TC_SW_CACHE).then(function(cache){
      return cache.addAll(TC_SW_FILES);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== TC_SW_CACHE; }).map(function(k){ return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event){
  var url = new URL(event.request.url);
  var isTarget = TC_SW_FILES.indexOf(url.pathname.replace(/^\//, '')) !== -1;
  if(!isTarget || event.request.method !== 'GET'){
    return;
  }
  event.respondWith(
    fetch(event.request).then(function(response){
      if(response && response.ok){
        var copy = response.clone();
        caches.open(TC_SW_CACHE).then(function(cache){ cache.put(event.request, copy); });
      }
      return response;
    }).catch(function(){
      return caches.open(TC_SW_CACHE).then(function(cache){ return cache.match(event.request); });
    })
  );
});
