// Tests des homonymes : deux cinéastes du même nom dans l'index.
//
// La colonne « nom » est UNIQUE et sert de clef partout (tops, commentaires,
// favoris, JSON, portraits). Le second homonyme porte donc un suffixe
// d'unicité — « CLARK (II), Larry ». Ce suffixe est un jeton technique : il
// ne doit jamais s'afficher, il ne doit jamais fausser le tri, et il ne doit
// JAMAIS être confondu avec une parenthèse qui fait partie du nom, comme
// celle de « MEDVEDKINE (Groupes) ». C'est tout l'objet de ces tests.
//
// Lancer :  npm test
const { test } = require('node:test');
const assert = require('node:assert');
const { charger } = require('./_charger');

const u = charger('utils.js');

// ═══════════════════════════════════════════════════════════════
//  tcNomNu — retirer le suffixe d'unicité
// ═══════════════════════════════════════════════════════════════

test('tcNomNu : retire le chiffre romain, garde le reste intact', () => {
  assert.equal(u.tcNomNu('CLARK (II), Larry'), 'CLARK, Larry');
  assert.equal(u.tcNomNu('DUPONT (III), Jean'), 'DUPONT, Jean');
  assert.equal(u.tcNomNu('SMITH (IV)'), 'SMITH');
});

test('tcNomNu : retire aussi une année de naissance entre parenthèses', () => {
  // Seconde écriture admise, plus parlante qu'un chiffre romain.
  assert.equal(u.tcNomNu('CLARK (1948), Larry'), 'CLARK, Larry');
});

test('tcNomNu : NE TOUCHE PAS aux parenthèses qui font partie du nom', () => {
  // Le seul autre nom à parenthèses de l'index. Le réduire à « MEDVEDKINE »
  // changerait un nom de cinéaste, et casserait le lien vers sa fiche.
  assert.equal(u.tcNomNu('MEDVEDKINE (Groupes)'), 'MEDVEDKINE (Groupes)');
  assert.equal(u.tcNomNu('ABBADIE d’ARRAST, Harry d’'), 'ABBADIE d’ARRAST, Harry d’');
});

test('tcNomNu : un nom sans suffixe ressort identique', () => {
  ['CLARK, Larry', 'McCAREY, Leo', 'COEN, Joel & Ethan', 'ALOV & NAUMOV', 'McG'
  ].forEach(n => assert.equal(u.tcNomNu(n), n));
});

test('tcNomNu : tolère une entrée qui n’est pas une chaîne', () => {
  assert.equal(u.tcNomNu(null), '');
  assert.equal(u.tcNomNu(undefined), '');
});

// ═══════════════════════════════════════════════════════════════
//  tcSuffixeHomonyme — le jeton lui-même
// ═══════════════════════════════════════════════════════════════

test('tcSuffixeHomonyme : rend le jeton, ou une chaîne vide', () => {
  assert.equal(u.tcSuffixeHomonyme('CLARK (II), Larry'), 'II');
  assert.equal(u.tcSuffixeHomonyme('CLARK (1948), Larry'), '1948');
  assert.equal(u.tcSuffixeHomonyme('CLARK, Larry'), '');
  assert.equal(u.tcSuffixeHomonyme('MEDVEDKINE (Groupes)'), '');
});

// ═══════════════════════════════════════════════════════════════
//  tcComparerNoms — le tri
// ═══════════════════════════════════════════════════════════════

test('tcComparerNoms : deux homonymes ne sont plus séparés par un tiers', () => {
  // Avec localeCompare seul, « ( » passe avant « , » : l'ordre était
  // CLARK (II) / CLARK, Bob / CLARK, Larry — Bob coincé entre les deux Larry.
  const noms = ['CLARK (II), Larry', 'CLARK, Bob', 'CLARK, Larry', 'CLARKE, Alan'];
  assert.deepEqual(noms.slice().sort(u.tcComparerNoms),
    ['CLARK, Bob', 'CLARK, Larry', 'CLARK (II), Larry', 'CLARKE, Alan']);
});

test('tcComparerNoms : la fiche sans suffixe passe avant ses homonymes', () => {
  // « le deuxième » ne doit pas s'afficher avant « le premier ».
  assert.ok(u.tcComparerNoms('CLARK, Larry', 'CLARK (II), Larry') < 0);
  assert.deepEqual(
    ['CLARK (III), Larry', 'CLARK (II), Larry', 'CLARK, Larry'].sort(u.tcComparerNoms),
    ['CLARK, Larry', 'CLARK (II), Larry', 'CLARK (III), Larry']);
  // Deux années : la plus ancienne d'abord.
  assert.deepEqual(
    ['CLARK (1948), Larry', 'CLARK (1943), Larry'].sort(u.tcComparerNoms),
    ['CLARK (1943), Larry', 'CLARK (1948), Larry']);
});

test('tcComparerNoms : l’ordre reste celui de localeCompare sans homonyme', () => {
  const noms = ['ZULAWSKI, Andrzej', 'AKERMAN, Chantal', 'ÉPSTEIN, Jean', 'OZU, Yasujiro'];
  assert.deepEqual(noms.slice().sort(u.tcComparerNoms),
                   noms.slice().sort((a, b) => a.localeCompare(b, 'fr')));
});

test('tcComparerNoms : l’ordre entre deux homonymes est stable', () => {
  // Noms nus égaux : on départage sur le nom complet, jamais au hasard.
  assert.ok(u.tcComparerNoms('CLARK (II), Larry', 'CLARK, Larry') !== 0);
  assert.equal(u.tcComparerNoms('CLARK (II), Larry', 'CLARK (II), Larry'), 0);
});

// ═══════════════════════════════════════════════════════════════
//  Portraits : chacun le sien
// ═══════════════════════════════════════════════════════════════

test('tcLocalPortraitCandidates : un homonyme peut avoir son portrait à lui', () => {
  const c = u.tcLocalPortraitCandidates('CLARK (II), Larry');
  // Le fichier propre à l'homonyme est essayé AVANT celui du nom nu...
  assert.ok(c.indexOf('portraits/portrait-Clark, Larry (II).jpg') !== -1,
            'le candidat suffixé devrait exister : ' + JSON.stringify(c));
  // ... et le nom nu reste un repli.
  assert.ok(c.indexOf('portraits/portrait-Clark, Larry.jpg') > c.indexOf('portraits/portrait-Clark, Larry (II).jpg'),
            'le repli devrait venir après : ' + JSON.stringify(c));
  // Aucun candidat ne doit porter la parenthèse brute du suffixe.
  c.forEach(p => assert.ok(!/\(ii\)/i.test(p.replace(' (II).jpg', '')),
                           'nom de fichier bancal : ' + p));
});

test('tcLocalPortraitCandidates : rien ne change pour un nom sans suffixe', () => {
  assert.deepEqual(u.tcLocalPortraitCandidates('CLARK, Larry'),
    ['portraits/portrait-Clark.jpg', 'portraits/portrait-Clark, Larry.jpg']);
});
