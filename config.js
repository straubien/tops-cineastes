// Configuration partagée — clé publique Supabase (anon key)
var TC_SUPABASE_URL = 'https://afbdrqrslgduomimkmyt.supabase.co';
var TC_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmYmRycXJzbGdkdW9taW1rbXl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTExMTEsImV4cCI6MjA5NTk4NzExMX0.uvOvP-2cfgrIPdOrThLERwOGKid8OYExq1xro-5TAb8';

// Crée un client Supabase à partir des identifiants partagés ci-dessus
function tcCreateClient(opts){
  return supabase.createClient(TC_SUPABASE_URL, TC_SUPABASE_KEY, opts);
}

// Nombre maximum de résultats dans les dropdowns d'autocomplete
var TC_AUTOCOMPLETE_MAX = 12;
// Taille maximale pour l'upload d'avatar (2 Mo)
var TC_AVATAR_MAX_SIZE = 2 * 1024 * 1024;
// Taille maximale pour l'upload d'un photogramme (5 Mo)
var TC_PHOTOGRAMME_MAX_SIZE = 5 * 1024 * 1024;
// Nombre max de photogrammes par session
var TC_PHOTOGRAMME_MAX_IMAGES = 30;
// Intervalle (ms) du filet de sécurité côté client qui lance les sessions programmées arrivées à échéance
var TC_PHOTOGRAMME_AUTOLAUNCH_POLL_MS = 5000;
