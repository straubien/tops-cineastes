// Charge un fichier du site dans un bac a sable, pour pouvoir appeler ses
// fonctions sans navigateur. Les fichiers du site ne sont PAS des modules :
// ils definissent des fonctions globales, chargees les unes apres les autres
// par les pages HTML. On reproduit ici cette portee partagee.
//
// Aucun changement n'est demande au code du site : c'est le test qui
// s'adapte, pas l'inverse.
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Le strict minimum de navigateur pour que les fichiers se chargent.
// utils.js ne fait qu'UNE chose au chargement : poser un ecouteur de clic.
function faussesGlobalesNavigateur(){
  const elementVide = {
    addEventListener(){}, removeEventListener(){}, setAttribute(){}, removeAttribute(){},
    getAttribute(){ return null; }, hasAttribute(){ return false; },
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    appendChild(){}, focus(){}, click(){},
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    style: {}, children: [], textContent: '', innerHTML: ''
  };
  return {
    console,
    document: Object.assign({}, elementVide, {
      getElementById(){ return null; },
      createElement(){ return Object.assign({}, elementVide); },
      body: Object.assign({}, elementVide),
      documentElement: Object.assign({}, elementVide),
      readyState: 'complete'
    }),
    window: { matchMedia(){ return { matches: false }; }, addEventListener(){} },
    localStorage: { getItem(){ return null; }, setItem(){}, removeItem(){} },
    sessionStorage: { getItem(){ return null; }, setItem(){}, removeItem(){} },
    navigator: { userAgent: 'test', onLine: true },
    location: { origin: 'http://test', pathname: '/', hash: '' },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, Set, Map, Date, JSON, Math, RegExp, Error, AbortController
  };
}

// Charge un ou plusieurs fichiers du site dans une meme portee, dans l'ordre.
function charger(...fichiers){
  const ctx = faussesGlobalesNavigateur();
  vm.createContext(ctx);
  for(const f of fichiers){
    const chemin = path.join(__dirname, '..', f);
    vm.runInContext(fs.readFileSync(chemin, 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

module.exports = { charger };
