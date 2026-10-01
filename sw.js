// ---------------------------------------------------------------------------
//  Service worker — VERSION DE RETRAIT
//
//  Ce fichier ne met plus rien en cache. Il se désinstalle lui-même et efface
//  ce que l'ancienne version avait stocké.
//
//  POURQUOI
//  L'ancien service worker annonçait un « mode hors-ligne » qu'il ne tenait
//  pas : il ne gardait que muzard.json et cnudde.json, soit 1,1 Mo sur le
//  téléphone de chaque visiteur, sans jamais rendre le site consultable sans
//  réseau — les pages elles-mêmes n'étaient pas mises en cache. Coût réel,
//  bénéfice nul. Cf. audit B-03, vague 3, voie A (actions A-146 et A-147).
//
//  POURQUOI NE PAS SIMPLEMENT SUPPRIMER LE FICHIER
//  Effacer sw.js du site ne désinstalle rien : le service worker déjà
//  installé sur l'appareil d'un visiteur continue de tourner, indéfiniment.
//  Il faut lui envoyer une version qui se retire d'elle-même — c'est celle-ci.
//
//  QUAND POURRA-T-ON TOUT RETIRER
//  Gardez ce fichier ET son enregistrement dans index.js pendant quelques
//  mois, le temps que les visiteurs reviennent au moins une fois. Ensuite
//  seulement, les deux pourront disparaître.
// ---------------------------------------------------------------------------

self.addEventListener('install', function(){
  // On prend la main immédiatement, sans attendre la fermeture des onglets.
  self.skipWaiting();
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys()
      .then(function(noms){
        return Promise.all(noms.map(function(n){ return caches.delete(n); }));
      })
      .then(function(){
        return self.registration.unregister();
      })
      .then(function(){
        // Les onglets ouverts repassent au réseau direct dès maintenant.
        return self.clients.matchAll({ type: 'window' });
      })
      .then(function(clients){
        clients.forEach(function(c){ if(c.navigate) c.navigate(c.url); });
      })
      .catch(function(){ /* rien à faire de plus */ })
  );
});

// Plus aucune interception : toutes les requêtes passent par le réseau.
