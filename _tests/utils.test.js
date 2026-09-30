// Tests des fonctions de utils.js — les plus fragiles du projet :
// elles lisent du texte saisi par des humains, dans des formats imprevisibles.
//
// Lancer :  npm test
// Cf. audit B-30, actions A-058 et A-059.
const { test } = require('node:test');
const assert = require('node:assert');
const { charger } = require('./_charger');

const u = charger('utils.js');

// ═══════════════════════════════════════════════════════════════
//  parseTopsBrut — l'analyseur de listes collees
// ═══════════════════════════════════════════════════════════════

test('parseTopsBrut : accepte les trois separateurs « . » « ) » « - »', () => {
  const r = u.parseTopsBrut('1. Sansho (1954)\n2) Ugetsu (1953)\n3- Les Contes (1953)');
  assert.equal(r.length, 3);
  assert.deepEqual(r.map(f => f.titre), ['Sansho', 'Ugetsu', 'Les Contes']);
  assert.deepEqual(r.map(f => f.annee), [1954, 1953, 1953]);
});

test('parseTopsBrut : un film sans annee donne annee = null, pas une erreur', () => {
  const r = u.parseTopsBrut('1. Film sans annee');
  assert.equal(r[0].titre, 'Film sans annee');
  assert.equal(r[0].annee, null);
});

test('parseTopsBrut : les lignes non numerotees sont collectees, pas perdues', () => {
  const r = u.parseTopsBrut('1. Premier\nune remarque en vrac\n2. Second');
  assert.equal(r.length, 2, 'seules les lignes numerotees deviennent des films');
  assert.deepEqual(r.ignorees, ['une remarque en vrac'],
    'la ligne non reconnue doit etre signalee, sinon elle disparait en silence');
});

test('parseTopsBrut : les lignes vides ne comptent pas comme ignorees', () => {
  const r = u.parseTopsBrut('1. Premier\n\n   \n2. Second');
  assert.equal(r.length, 2);
  assert.deepEqual(r.ignorees, []);
});

test('parseTopsBrut : renumerote les rangs de 1 a N', () => {
  const r = u.parseTopsBrut('5. Cinq\n9. Neuf');
  assert.deepEqual(r.map(f => f.rang), [1, 2]);
});

test('parseTopsBrut : une annee trop ancienne reste dans le titre', () => {
  // Volontaire : le film ressort alors dans l'avertissement « N films sans
  // annee », donc visiblement, au lieu d'entrer en base avec une date fausse.
  const r = u.parseTopsBrut('1. Trop vieux (1800)');
  assert.equal(r[0].annee, null);
  assert.equal(r[0].titre, 'Trop vieux (1800)');
});

test('parseTopsBrut : une annee absurde dans le futur reste dans le titre', () => {
  const r = u.parseTopsBrut('1. Trop loin (9999)');
  assert.equal(r[0].annee, null);
  assert.equal(r[0].titre, 'Trop loin (9999)');
});

test('parseTopsBrut : 1888 est acceptee (naissance du cinema)', () => {
  const r = u.parseTopsBrut('1. Premier film (1888)');
  assert.equal(r[0].annee, 1888);
  assert.equal(r[0].titre, 'Premier film');
});

test('parseTopsBrut : texte vide ne plante pas', () => {
  const r = u.parseTopsBrut('');
  assert.equal(r.length, 0);
  assert.deepEqual(r.ignorees, []);
});

test('tcMessageLignesIgnorees : rien a signaler donne une chaine vide', () => {
  assert.equal(u.tcMessageLignesIgnorees(u.parseTopsBrut('1. A')), '');
});

test('tcMessageLignesIgnorees : annonce le nombre et un apercu', () => {
  const msg = u.tcMessageLignesIgnorees(u.parseTopsBrut('1. A\nbruit\nautre bruit'));
  assert.match(msg, /2 ligne/);
  assert.match(msg, /bruit/);
});

// ═══════════════════════════════════════════════════════════════
//  Noms et affichage
// ═══════════════════════════════════════════════════════════════

test('normStr : retire accents et majuscules (utilise par la recherche)', () => {
  assert.equal(u.normStr('Éluard Ça'), 'eluard ca');
  assert.equal(u.normStr('MIZOGUCHI'), 'mizoguchi');
});

test('escapeHtml : neutralise les cinq caracteres dangereux', () => {
  assert.equal(u.escapeHtml('<a href="x">&\'</a>'),
    '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('escapeHtml : une valeur vide ne plante pas', () => {
  assert.equal(u.escapeHtml(''), '');
  assert.equal(u.escapeHtml(null), '');
});

test('toTitleCase : retablit les accents des prenoms connus', () => {
  assert.equal(u.toTitleCase('THORACENTESE'), 'Thoracentèse');
  assert.equal(u.toTitleCase('GREGORY'), 'Grégory');
  assert.equal(u.toTitleCase('DUPONT'), 'Dupont');
});

test('getInitiales : deux mots donnent deux initiales', () => {
  assert.equal(u.getInitiales('MATHIEU MUZARD'), 'MM');
});

test('getInitiales : un seul mot donne ses deux premieres lettres', () => {
  assert.equal(u.getInitiales('PEELSA'), 'PE');
});

test('formatContribNamePlain : prenom en capitale initiale, nom en majuscules', () => {
  assert.equal(u.formatContribNamePlain('MATHIEU MUZARD'), 'Mathieu MUZARD');
  assert.equal(u.formatContribNamePlain('GREGORY LESCARD'), 'Grégory LESCARD');
});

test('getAvatarFilename : nom de fichier sans accent ni espace', () => {
  assert.equal(u.getAvatarFilename('Thoracentèse RUBIS'), 'thoracentese-rubis.jpg');
  assert.equal(u.getAvatarFilename(''), 'avatar.jpg');
});

// ═══════════════════════════════════════════════════════════════
//  Resolution des portraits locaux
// ═══════════════════════════════════════════════════════════════

test('tcLocalPortraitCandidates : du plus generique au plus precis', () => {
  assert.deepEqual(u.tcLocalPortraitCandidates('MIZOGUCHI, Kenji'), [
    'portraits/portrait-Mizoguchi.jpg',
    'portraits/portrait-Mizoguchi, Kenji.jpg'
  ]);
});

test('tcLocalPortraitCandidates : sans prenom, un seul candidat', () => {
  assert.deepEqual(u.tcLocalPortraitCandidates('KUROSAWA'), ['portraits/portrait-Kurosawa.jpg']);
});

test('tcLocalPortraitCandidates : les particules restent dans le nom', () => {
  assert.deepEqual(u.tcLocalPortraitCandidates('DE SICA, Vittorio'), [
    'portraits/portrait-De Sica.jpg',
    'portraits/portrait-De Sica, Vittorio.jpg'
  ]);
});

test('tcLocalPortraitCandidates : Straub/Huillet a un fichier commun', () => {
  assert.deepEqual(u.tcLocalPortraitCandidates('STRAUB, Jean-Marie & HUILLET'),
    ['portraits/portrait-Straub.jpg']);
});

test('tcLocalPortraitCandidates : nom vide ne plante pas', () => {
  assert.deepEqual(u.tcLocalPortraitCandidates(''), []);
});

test('tcLocalPortraitDuoCandidates : un duo donne deux listes distinctes', () => {
  const d = u.tcLocalPortraitDuoCandidates('COEN, Joel & Ethan');
  assert.equal(d.length, 2);
  assert.ok(d[0].includes('portraits/portrait-Coen, Joel.jpg'));
  assert.ok(d[1].includes('portraits/portrait-Coen, Ethan.jpg'));
});

test('tcLocalPortraitDuoCandidates : un cineaste seul renvoie null', () => {
  assert.equal(u.tcLocalPortraitDuoCandidates('MIZOGUCHI, Kenji'), null);
});

// ═══════════════════════════════════════════════════════════════
//  Erreurs — la distinction panne / refus de droits
// ═══════════════════════════════════════════════════════════════

test('friendlyError : traduit les quatre cas connus', () => {
  assert.match(u.friendlyError({ message: 'JWT expired' }), /session a expiré/);
  assert.match(u.friendlyError({ message: 'duplicate key value' }), /existe déjà/);
  assert.match(u.friendlyError({ message: 'Failed to fetch' }), /connexion/);
  assert.match(u.friendlyError({ message: 'row-level security policy' }), /non autorisée/);
});

test('friendlyError : sans erreur, message generique', () => {
  assert.equal(u.friendlyError(null), 'Une erreur est survenue.');
});

test('tcIsAuthError : reconnait un 401 et un JWT expire', () => {
  assert.equal(u.tcIsAuthError({ status: 401 }), true);
  assert.equal(u.tcIsAuthError({ message: 'JWT expired' }), true);
  assert.equal(u.tcIsAuthError({ code: 'PGRST301' }), true);
});

test('tcIsAuthError : un refus de droits n\'est PAS une erreur de session', () => {
  assert.equal(u.tcIsAuthError({ message: 'row-level security' }), false);
});

test('tcIsTransientNetworkError : une panne reseau est rejouable', () => {
  assert.equal(u.tcIsTransientNetworkError({ message: 'Failed to fetch' }), true);
  assert.equal(u.tcIsTransientNetworkError({ name: 'AbortError' }), true);
  assert.equal(u.tcIsTransientNetworkError({ name: 'TC_TIMEOUT' }), true);
});

test('tcIsTransientNetworkError : un refus de droits n\'est JAMAIS rejoue', () => {
  // Invariant important : relancer automatiquement une requete refusee par
  // les droits ne peut pas reussir, et multiplie les appels inutiles.
  assert.equal(u.tcIsTransientNetworkError({ message: 'row-level security policy' }), false);
  assert.equal(u.tcIsTransientNetworkError({ message: 'permission denied' }), false);
});

test('tcIsTransientNetworkError : un doublon n\'est JAMAIS rejoue', () => {
  assert.equal(u.tcIsTransientNetworkError({ message: 'duplicate key' }), false);
});

// ═══════════════════════════════════════════════════════════════
//  Presentation des contributeurs
// ═══════════════════════════════════════════════════════════════

test('formatPresentation : gras, italique, souligne et retours a la ligne', () => {
  assert.equal(u.formatPresentation('**gras** *ital* __soul__\nligne2'),
    '<strong>gras</strong> <em>ital</em> <u>soul</u><br>ligne2');
});

test('formatPresentation : le HTML saisi est neutralise AVANT la mise en forme', () => {
  // Invariant de securite : un contributeur ne doit pas pouvoir injecter de
  // balises dans sa presentation.
  const r = u.formatPresentation('<script>alert(1)</script>');
  assert.equal(r, '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.ok(!r.includes('<script'), 'aucune balise script ne doit survivre');
});
