// Tests des duos de cinéastes : la composition d'un nom de duo à partir des
// deux membres saisis séparément (formulaire « Proposer un cinéaste »), et
// son ALLER-RETOUR avec tcDuoMembres, qui relit ce nom sur les fiches.
//
// Ces deux fonctions sont inverses l'une de l'autre : si l'une écrit ce que
// l'autre ne sait pas relire, une fiche de duo s'affiche avec un seul
// portrait et des dates fausses, sans la moindre erreur à l'écran. D'où ces
// tests, qui vérifient le cycle complet plutôt que chaque fonction à part.
//
// Lancer :  npm test
const { test } = require('node:test');
const assert = require('node:assert');
const { charger } = require('./_charger');

const u = charger('utils.js');

// Le nom tel qu'il est écrit dans la colonne « nom » de la table cineastes.
function nomEnBase(c){ return c.prenom ? (c.nom + ', ' + c.prenom) : c.nom; }

// ═══════════════════════════════════════════════════════════════
//  tcComposerDuo — des deux membres vers le nom de l'index
// ═══════════════════════════════════════════════════════════════

test('tcComposerDuo : nom de famille commun → « NOM, Prénom1 & Prénom2 »', () => {
  assert.equal(nomEnBase(u.tcComposerDuo('COEN', 'Joel', 'COEN', 'Ethan')), 'COEN, Joel & Ethan');
  assert.equal(nomEnBase(u.tcComposerDuo('HEIN', 'Wilhelm', 'HEIN', 'Birgit')), 'HEIN, Wilhelm & Birgit');
  assert.equal(nomEnBase(u.tcComposerDuo('BOULTING', 'John', 'BOULTING', 'Roy')), 'BOULTING, John & Roy');
});

test('tcComposerDuo : noms de famille différents → « NOM1 & NOM2 », les prénoms tombent', () => {
  assert.equal(nomEnBase(u.tcComposerDuo('ALOV', '', 'NAUMOV', '')), 'ALOV & NAUMOV');
  assert.equal(nomEnBase(u.tcComposerDuo('STRAUB', 'Jean-Marie', 'HUILLET', 'Danièle')), 'STRAUB & HUILLET');
  assert.equal(nomEnBase(u.tcComposerDuo('GIANIKIAN', 'Yervant', 'RICCI LUCCHI', 'Angela')), 'GIANIKIAN & RICCI LUCCHI');
});

test('tcComposerDuo : un prénom manquant renvoie à l’écriture « NOM1 & NOM2 »', () => {
  // Sans les deux prénoms, « COEN, Joel & » n'aurait aucun sens.
  assert.equal(nomEnBase(u.tcComposerDuo('COEN', 'Joel', 'COEN', '')), 'COEN & COEN');
});

test('tcComposerDuo : le nom de famille se compare sans la casse ni les accents', () => {
  assert.equal(nomEnBase(u.tcComposerDuo('TAVIANI', 'Paolo', 'taviani', 'Vittorio')), 'TAVIANI, Paolo & Vittorio');
});

test('tcComposerDuo : les espaces en trop sont retirés', () => {
  assert.equal(nomEnBase(u.tcComposerDuo('  COEN ', ' Joel ', 'COEN', ' Ethan ')), 'COEN, Joel & Ethan');
});

// ═══════════════════════════════════════════════════════════════
//  Aller-retour : ce qui est composé doit être relu
// ═══════════════════════════════════════════════════════════════

test('aller-retour : tcDuoMembres relit toujours les deux membres', () => {
  const cas = [
    ['COEN', 'Joel', 'COEN', 'Ethan', ['COEN, Joel', 'COEN, Ethan']],
    ['CANTRILL', 'Arthur', 'CANTRILL', 'Corinne', ['CANTRILL, Arthur', 'CANTRILL, Corinne']],
    ['ALOV', '', 'NAUMOV', '', ['ALOV', 'NAUMOV']],
    ['STRAUB', 'Jean-Marie', 'HUILLET', 'Danièle', ['STRAUB', 'HUILLET']]
  ];
  for(const [n1, p1, n2, p2, attendus] of cas){
    const nom = nomEnBase(u.tcComposerDuo(n1, p1, n2, p2));
    assert.deepEqual(u.tcDuoMembres(nom), attendus, 'échec sur « ' + nom + ' »');
  }
});

// ═══════════════════════════════════════════════════════════════
//  Les solos ne doivent JAMAIS être pris pour des duos
// ═══════════════════════════════════════════════════════════════

test('tcDuoMembres : un cinéaste seul n’est pas un duo, minuscules comprises', () => {
  // Les noms à minuscule sont ceux que les capitales forcées du formulaire
  // rendaient impossibles à proposer : ils doivent traverser sans dommage.
  ['LYNCH, David', 'McCAREY, Leo', 'DeMILLE, Cecil B.', 'LaBRUCE, Bruce',
   'MacDOUGALL, Ranald', 'St. CLAIR, Malcolm', 'DAVIES Jr., Akinola',
   'ABBADIE d’ARRAST, Harry d’', 'McG'
  ].forEach(nom => {
    assert.equal(u.tcDuoMembres(nom), null, nom + ' ne devrait pas être lu comme un duo');
  });
});
