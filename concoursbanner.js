// ═══════════════════════════════════════════════════════════════
// JEU-CONCOURS — bandeau d'incitation à soumettre son top sur le site
// (plutôt qu'en commentaire sous les publications Facebook).
// Fichier autonome, sans dépendance à index.js.
// ═══════════════════════════════════════════════════════════════
(function(){
  // ── À MODIFIER : dates du concours ──
  // Ces deux constantes doivent rester identiques à celles définies en haut
  // de concours-tirage.js, afin que le bandeau et l'outil de tirage au sort
  // portent sur la même période.
  var CONCOURS_DATE_DEBUT = '2026-09-10T00:00:00';
  var CONCOURS_DATE_FIN   = '2026-09-24T23:59:59';
  // ─────────────────────────────────────

  var banner = document.getElementById('concours-banner');
  if(!banner) return;

  var debut = new Date(CONCOURS_DATE_DEBUT);
  var fin = new Date(CONCOURS_DATE_FIN);
  var now = new Date();
  if(isNaN(debut.getTime()) || isNaN(fin.getTime()) || now < debut || now > fin){
    banner.style.display = 'none';
    return;
  }

  var concoursId = CONCOURS_DATE_DEBUT + '_' + CONCOURS_DATE_FIN;
  var dismissed = false;
  try{ dismissed = localStorage.getItem('tc-concours-ferme') === concoursId; }catch(e){}
  if(dismissed){
    banner.style.display = 'none';
    return;
  }

  var lang = 'fr';
  try{ lang = localStorage.getItem('tc-lang') || 'fr'; }catch(e){}
  var locale = lang === 'en' ? 'en-GB' : 'fr-FR';
  var datesEl = document.getElementById('concours-periode-dates');
  if(datesEl){
    var opts = { day: 'numeric', month: 'long', year: 'numeric' };
    datesEl.textContent = debut.toLocaleDateString(locale, opts) + ' → ' + fin.toLocaleDateString(locale, opts);
  }

  var closeBtn = document.getElementById('concours-close');
  if(closeBtn){
    closeBtn.addEventListener('click', function(){
      banner.style.display = 'none';
      try{ localStorage.setItem('tc-concours-ferme', concoursId); }catch(e){}
    });
  }

  var toggleBtn = document.getElementById('concours-regles-toggle');
  var regles = document.getElementById('concours-regles');
  if(toggleBtn && regles){
    toggleBtn.addEventListener('click', function(){
      var visible = regles.style.display !== 'none';
      regles.style.display = visible ? 'none' : 'block';
      toggleBtn.setAttribute('aria-expanded', visible ? 'false' : 'true');
    });
  }
})();
