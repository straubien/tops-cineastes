// ---------------------------------------------------------------------------
//  Adresse de contact des pages legales
//
//  AUCUNE ADRESSE N'EST ECRITE ICI. Les trois morceaux sont dans _config.yml
//  (cherchez « courriel_compte »), et Jekyll les recopie dans les deux pages
//  legales au moment de publier le site. C'est donc le seul endroit a
//  modifier pour changer d'adresse.
//
//  Ce que fait ce fichier : les pages affichent l'adresse sous la forme
//  « prenom.nom (arobase) exemple.fr », qui reste lisible sans JavaScript
//  mais ne contient pas de signe arobase — les robots a spam parcourent le
//  code source, et c'est ce signe qu'ils y cherchent. Le code ci-dessous
//  remplace « (arobase) » par le vrai signe et pose un lien cliquable.
//
//  Sans JavaScript, le visiteur lit la forme en clair : moins pratique, mais
//  parfaitement utilisable. L'obligation legale est d'etre joignable, pas de
//  fournir un lien cliquable.
// ---------------------------------------------------------------------------
(function(){
  var cibles = document.querySelectorAll('[data-courriel]');
  for(var i = 0; i < cibles.length; i++){
    var brut = (cibles[i].textContent || '').replace(/\s+/g, ' ').trim();
    var adr = brut.replace(/ ?\(arobase\) ?/, '@');
    // L'adresse obtenue doit avoir la forme d'une adresse. Sinon on laisse le
    // texte tel quel, plutot que de poser un lien casse : cela arrive si le
    // marqueur « (arobase) » a disparu de la page, ou si une valeur manque
    // dans _config.yml (une cle vide donnerait « @exemple.fr »).
    if(!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(adr)) continue;
    var a = document.createElement('a');
    a.href = 'mailto:' + adr;
    a.textContent = adr;
    cibles[i].parentNode.replaceChild(a, cibles[i]);
  }
})();
