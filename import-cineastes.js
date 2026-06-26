#!/usr/bin/env node
//
// Import cineastes.json → table Supabase "cineastes"
//
// Usage :
//   npm install @supabase/supabase-js
//   node import-cineastes.js
//
// Pré-requis : exécuter supabase-migration-cineastes.sql dans le SQL Editor
// avant de lancer ce script.
//
// Le script utilise la clé anon (lecture/écriture via RLS).
// Si la table a une policy INSERT restrictive, utiliser plutôt
// la service_role key en variable d'environnement :
//   SUPABASE_KEY=<service_role_key> node import-cineastes.js

var fs = require('fs');

var SUPABASE_URL = 'https://afbdrqrslgduomimkmyt.supabase.co';
var SUPABASE_KEY = process.env.SUPABASE_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmYmRycXJzbGdkdW9taW1rbXl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTExMTEsImV4cCI6MjA5NTk4NzExMX0.uvOvP-2cfgrIPdOrThLERwOGKid8OYExq1xro-5TAb8';

async function main() {
  var createClient = require('@supabase/supabase-js').createClient;
  var sb = createClient(SUPABASE_URL, SUPABASE_KEY);

  var raw = fs.readFileSync(__dirname + '/cineastes.json', 'utf8');
  var data = JSON.parse(raw);
  var cineastes = data.cineastes;

  console.log('Cinéastes à importer :', cineastes.length);

  var rows = cineastes.map(function (c) {
    return {
      nom: c.nom,
      fbid: c.fbid || null,
      url_facebook: c.url_facebook || null,
      duo: !!c.duo,
      naissance: c.naissance != null ? c.naissance : null,
      deces: c.deces != null ? c.deces : null,
      vivant: c.vivant != null ? c.vivant : null,
      tops_contributeurs: c.tops_contributeurs || []
    };
  });

  // Supabase limite les inserts en lot — on envoie par tranches de 500
  var BATCH = 500;
  var inserted = 0;
  for (var i = 0; i < rows.length; i += BATCH) {
    var batch = rows.slice(i, i + BATCH);
    var res = await sb.from('cineastes').upsert(batch, { onConflict: 'nom' });
    if (res.error) {
      console.error('Erreur batch', i, ':', res.error.message);
      process.exit(1);
    }
    inserted += batch.length;
    console.log('  importés :', inserted, '/', rows.length);
  }

  console.log('Import terminé avec succès.');
}

main().catch(function (err) { console.error(err); process.exit(1); });
