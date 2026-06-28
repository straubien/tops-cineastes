// Service worker — cache des fichiers statiques de données (muzard.json, cnudde.json)
// Stratégie : stale-while-revalidate — sert le cache immédiatement, met à jour en arrière-plan.
var TC_SW_CACHE = 'tc-static-v1';
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
    caches.open(TC_SW_CACHE).then(function(cache){
      return cache.match(event.request).then(function(cached){
        var fetchPromise = fetch(event.request).then(function(response){
          if(response && response.ok){ cache.put(event.request, response.clone()); }
          return response;
        }).catch(function(){ return cached; });
        return cached || fetchPromise;
      });
    })
  );
});
