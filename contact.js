// ---------------------------------------------------------------------------
//  Adresse de contact des pages legales
//
//  Elle n'est PAS ecrite en clair dans le code des pages : les robots a spam
//  parcourent le code source, pas le resultat affiche. Elle est recomposee
//  ici, a partir de ses morceaux, au moment de l'affichage.
//
//  Sans JavaScript, le visiteur voit « muzard.mathieu (arobase) orange.fr » :
//  moins pratique, mais parfaitement utilisable. L'obligation legale est
//  d'etre joignable, pas de fournir un lien cliquable.
//
//  POUR CHANGER D'ADRESSE
//    1. modifiez les trois valeurs ci-dessous ;
//    2. modifiez le texte de repli dans confidentialite.html ET
//       mentions-legales.html (cherchez « arobase »).
// ---------------------------------------------------------------------------
(function(){
  var compte = 'muzard.mathieu', domaine = 'orange', ext = 'fr';
  var adr = compte + '@' + domaine + '.' + ext;
  var cibles = document.querySelectorAll('[data-courriel]');
  for(var i = 0; i < cibles.length; i++){
    var a = document.createElement('a');
    a.href = 'mailto:' + adr;
    a.textContent = adr;
    cibles[i].parentNode.replaceChild(a, cibles[i]);
  }
})();
