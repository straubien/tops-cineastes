// Les dates du site public doivent suivre la langue choisie.
// Ces tests verrouillent deux choses :
//   1. le francais ne bouge pas d'un caractere par rapport a l'existant ;
//   2. l'anglais n'affiche jamais de date tout en chiffres, qui serait
//      ambigue d'un pays a l'autre (03/01 = 3 janvier ou January 3rd ?).
const test = require('node:test');
const assert = require('node:assert');
const { charger } = require('./_charger');

function enLangue(lang){
  const ctx = charger('i18n.js');
  ctx.localStorage.getItem = function(cle){ return cle === 'tc-lang' ? lang : null; };
  return ctx;
}

const LE_30_SEPT = '2026-09-30T14:05:00Z';
const LE_3_JANV  = '2026-01-03T08:00:00Z';

test('tcLocale suit la langue choisie', function(){
  assert.strictEqual(enLangue('fr').tcLocale(), 'fr-FR');
  assert.strictEqual(enLangue('en').tcLocale(), 'en-GB');
});

test('sans langue enregistree, le site reste en francais', function(){
  assert.strictEqual(charger('i18n.js').tcLocale(), 'fr-FR');
});

test('une date vide ou invalide ne produit jamais de texte', function(){
  const fr = enLangue('fr');
  for(const mauvais of ['', null, undefined, 'pas-une-date', {}, []]){
    assert.strictEqual(fr.tcDate(mauvais), '', 'tcDate(' + JSON.stringify(mauvais) + ')');
    assert.strictEqual(fr.tcDateHeure(mauvais), '', 'tcDateHeure(' + JSON.stringify(mauvais) + ')');
    assert.strictEqual(fr.tcDateCourte(mauvais), '', 'tcDateCourte(' + JSON.stringify(mauvais) + ')');
  }
});

test('jamais de 01/01/1970 a la place d\'une date absente', function(){
  const fr = enLangue('fr');
  assert.ok(!fr.tcDate(null).includes('1970'));
  assert.ok(!fr.tcDateCourte(0).includes('1970'));
});

test('en francais, la date compacte reste tout en chiffres', function(){
  const fr = enLangue('fr');
  assert.strictEqual(fr.tcDateCourte(LE_30_SEPT), '30/09/2026');
  assert.strictEqual(fr.tcDateCourte(LE_3_JANV), '03/01/2026');
});

test('en anglais, la date compacte ecrit le mois (jamais 03/01/2026)', function(){
  const en = enLangue('en');
  assert.ok(/^3 \w+ 2026$/.test(en.tcDateCourte(LE_3_JANV)), en.tcDateCourte(LE_3_JANV));
  assert.ok(!/^\d{2}\/\d{2}\/\d{4}$/.test(en.tcDateCourte(LE_3_JANV)));
});

test('la liaison date-heure est traduite, pas ecrite en dur', function(){
  assert.ok(enLangue('fr').tcDateHeure(LE_30_SEPT).includes(' à '));
  assert.ok(enLangue('en').tcDateHeure(LE_30_SEPT).includes(' at '));
  assert.ok(!enLangue('en').tcDateHeure(LE_30_SEPT).includes(' à '));
});

test('date et heure sont toutes deux presentes', function(){
  const s = enLangue('fr').tcDateHeure(LE_30_SEPT);
  assert.ok(s.includes('2026'), s);
  assert.ok(/\d{2}:\d{2}/.test(s), s);
});

test('les deux dictionnaires portent la cle de liaison', function(){
  const d = charger('i18n.js').TC_TRANSLATIONS;
  assert.strictEqual(typeof d.fr.date_liaison, 'string');
  assert.strictEqual(typeof d.en.date_liaison, 'string');
});
