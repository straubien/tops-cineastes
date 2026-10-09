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

// ── CLE API TMDB (facultative) ─────────────────────────────────────────────
// Elle sert a UNE chose : dans le studio du Jeu du photogramme, completer
// tout seul le titre original et le titre anglais d'un film, a partir du
// titre francais et du realisateur saisis par le createur. Jusqu'ici ces
// titres se tapaient un par un, ce qui etait long sur une partie de trente
// photogrammes.
//
// TANT QUE CETTE CHAINE EST VIDE, RIEN NE CHANGE : le studio ne montre pas
// le bouton, ne tente aucun appel, et les titres se saisissent a la main
// exactement comme avant. Aucune autre page du site ne la lit.
//
// Pour l'obtenir : compte gratuit sur themoviedb.org, puis Parametres > API.
// C'est la « Cle API (v3 auth) », une chaine COURTE de 32 caracteres — pas
// le « Read Access Token », bien plus long, qui commence par « eyJ ».
//
// Elle est ecrite ici en clair, et c'est sans danger — pour la meme raison
// que la cle anon de Supabase juste au-dessus : une cle TMDB v3 ne donne
// acces qu'EN LECTURE au catalogue public de TMDB. Elle ne permet pas
// d'ecrire chez TMDB, et elle n'ouvre rien de ce site.
var TC_TMDB_KEY = 'fea3cb32bf2802cf15b71898983593ae';
