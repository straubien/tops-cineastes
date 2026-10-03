#!/usr/bin/env node
// ---------------------------------------------------------------------------
//  Controle du dictionnaire de traduction (action A-100)
//
//  Ce script ne modifie rien. Il repond a trois questions :
//
//    1. Un texte affiche reclame-t-il une cle qui n'existe pas ?
//       -> ECHEC. Le visiteur verrait « mt_soumettre » au lieu d'un vrai mot.
//
//    2. Une cle francaise n'a-t-elle pas sa contrepartie anglaise (ou
//       l'inverse) ?
//       -> ECHEC. La page afficherait du francais au milieu de l'anglais.
//
//    3. Une cle est-elle definie sans etre jamais utilisee ?
//       -> AVERTISSEMENT seulement. C'est du poids mort, pas une panne.
//
//  Lancer a la main :  node _outils/verifier-i18n.js
//  Lance tout seul a chaque publication par verifier-le-js.yml.
// ---------------------------------------------------------------------------
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RACINE = path.join(__dirname, '..');

// Les pages du site public. admin.html ne charge plus i18n.js depuis A-066 :
// son texte est ecrit en francais directement, il n'a rien a verifier ici.
const PAGES = {
  'index.html':  ['index.html', 'index.js', 'shared.js', 'utils.js', 'i18n.js'],
  'submit.html': ['submit.html', 'submit.js', 'shared.js', 'utils.js', 'i18n.js', 'auth-shared.js'],
  'photogramme.html': ['photogramme.html', 'photogramme.js', 'shared.js', 'utils.js', 'i18n.js', 'auth-shared.js']
};

function lire(f){ return fs.readFileSync(path.join(RACINE, f), 'utf8'); }

// ── Le dictionnaire ────────────────────────────────────────────────────────
const bac = {
  document: { addEventListener(){}, querySelectorAll(){ return []; },
              documentElement: { setAttribute(){} } },
  localStorage: { getItem(){ return null; }, setItem(){} },
  window: {}, console
};
vm.createContext(bac);
vm.runInContext(lire('i18n.js'), bac, { filename: 'i18n.js' });
const { fr, en } = bac.TC_TRANSLATIONS;

// ── Les cles reclamees par le code ─────────────────────────────────────────
// Trois formes : t('cle'), tcTexte('cle', ...) et data-i18n="cle" dans le HTML.
function clesDemandees(src){
  const out = new Set();
  const ajoute = (re, g) => { for(const m of src.matchAll(re)) out.add(m[g]); };
  ajoute(/(?<![A-Za-z0-9_$.])t\(\s*['"]([A-Za-z0-9_]+)['"]/g, 1);
  ajoute(/tcTexte\(\s*['"]([A-Za-z0-9_]+)['"]/g, 1);
  ajoute(/data-i18n(?:-ph|-title|-aria)?="([A-Za-z0-9_]+)"/g, 1);
  return out;
}

let echecs = 0, avertissements = 0;
const toutesDemandees = new Set();

// ── 1. Cles reclamees mais absentes ────────────────────────────────────────
for(const [page, fichiers] of Object.entries(PAGES)){
  const manquantes = new Set();
  for(const f of fichiers){
    for(const cle of clesDemandees(lire(f))){
      toutesDemandees.add(cle);
      if(fr[cle] === undefined) manquantes.add(cle + '  (dans ' + f + ')');
    }
  }
  if(manquantes.size){
    echecs += manquantes.size;
    console.error('\nECHEC — ' + page + ' reclame ' + manquantes.size + ' cle(s) inexistante(s) :');
    for(const m of manquantes) console.error('   ' + m);
  }
}

// ── 2. Desequilibre entre les deux dictionnaires ───────────────────────────
const sansAnglais = Object.keys(fr).filter(k => !(k in en));
const sansFrancais = Object.keys(en).filter(k => !(k in fr));
if(sansAnglais.length){
  echecs += sansAnglais.length;
  console.error('\nECHEC — ' + sansAnglais.length + ' cle(s) sans version anglaise :\n   ' + sansAnglais.join('\n   '));
}
if(sansFrancais.length){
  echecs += sansFrancais.length;
  console.error('\nECHEC — ' + sansFrancais.length + ' cle(s) sans version francaise :\n   ' + sansFrancais.join('\n   '));
}

// ── 3. Cles definies mais jamais utilisees (avertissement) ─────────────────
// Certaines cles sont choisies au moment de l'execution (t(uneVariable)).
// On balaie donc aussi les identifiants entre guillemets, pour ne pas
// signaler a tort une cle qui sert bel et bien.
let tout = '';
for(const f of new Set(Object.values(PAGES).flat())) tout += lire(f);
const citees = new Set([...tout.matchAll(/['"]([A-Za-z0-9_]+)['"]/g)].map(m => m[1]));
const inutilisees = Object.keys(fr).filter(k => !citees.has(k));
if(inutilisees.length){
  avertissements = inutilisees.length;
  console.warn('\nAvertissement — ' + inutilisees.length + ' cle(s) definie(s) mais jamais utilisee(s) :\n   ' + inutilisees.join('\n   '));
  console.warn('   (poids mort, pas une panne : a nettoyer quand vous voudrez)');
}

// ── Verdict ────────────────────────────────────────────────────────────────
console.log('\n' + Object.keys(fr).length + ' cles en francais, ' + Object.keys(en).length + ' en anglais.');
console.log(toutesDemandees.size + ' cles reclamees par les pages, toutes verifiees.');
if(echecs){
  console.error('\n' + echecs + ' probleme(s) bloquant(s). Corrigez i18n.js.');
  process.exit(1);
}
console.log(avertissements ? 'Aucun probleme bloquant (' + avertissements + ' avertissement(s)).'
                           : 'Dictionnaire complet et sans poids mort.');
