const test = require('node:test');
const assert = require('node:assert');
const { charger } = require('./_charger.js');
const bac = charger('utils.js');

test('tcCourantIds rend les 4 emplacements', () => {
  assert.strictEqual(
    JSON.stringify(bac.tcCourantIds({ courant: 1, courant2: 2, courant3: 3, courant4: 4 })), JSON.stringify([1, 2, 3, 4]));
});
test('tcCourantIds ignore les emplacements vides, 4e compris', () => {
  assert.strictEqual(JSON.stringify(bac.tcCourantIds({ courant: 1, courant2: null, courant3: 0, courant4: 9 })), JSON.stringify([1, 9]));
  assert.strictEqual(JSON.stringify(bac.tcCourantIds({ courant: 5 })), JSON.stringify([5]));
  assert.strictEqual(JSON.stringify(bac.tcCourantIds({})), JSON.stringify([]));
});
test('une fiche encore a 3 courants (colonne 4 vide en base) reste intacte', () => {
  assert.strictEqual(JSON.stringify(bac.tcCourantIds({ courant: 1, courant2: 2, courant3: 3, courant4: null })), JSON.stringify([1, 2, 3]));
});
test('la requete demande bien la colonne courant4', () => {
  assert.ok(bac.TC_CINEASTES_COLONNES.split(',').includes('courant4'));
});
