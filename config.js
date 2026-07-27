// Configuration partagée — clé publique Supabase (anon key)
var TC_SUPABASE_URL = 'https://afbdrqrslgduomimkmyt.supabase.co';
var TC_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmYmRycXJzbGdkdW9taW1rbXl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTExMTEsImV4cCI6MjA5NTk4NzExMX0.uvOvP-2cfgrIPdOrThLERwOGKid8OYExq1xro-5TAb8';

// Crée un client Supabase à partir des identifiants partagés ci-dessus.
// On force `cache: 'no-store'` sur TOUTES les requêtes HTTP du client : ainsi
// une réponse (y compris une erreur transitoire, ex. un 300 d'ambiguïté) ne
// peut jamais être servie depuis le cache disque du navigateur ni y être figée.
// Les options `auth` (et éventuelles autres) passées par l'appelant sont
// préservées telles quelles.
function tcCreateClient(opts){
  opts = opts || {};
  var baseFetch = (opts.global && opts.global.fetch)
    || (typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : fetch);
  var noStoreFetch = function(input, init){
    return baseFetch(input, Object.assign({}, init, { cache: 'no-store' }));
  };
  var mergedOpts = Object.assign({}, opts, {
    global: Object.assign({}, opts.global, { fetch: noStoreFetch })
  });
  return supabase.createClient(TC_SUPABASE_URL, TC_SUPABASE_KEY, mergedOpts);
}

// Nombre maximum de résultats dans les dropdowns d'autocomplete
var TC_AUTOCOMPLETE_MAX = 12;
// Taille maximale pour l'upload d'avatar (2 Mo)
var TC_AVATAR_MAX_SIZE = 2 * 1024 * 1024;
