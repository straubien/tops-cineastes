// ═══════════════════════════════════════════════════════════════
// CONFIG SUPABASE
// ═══════════════════════════════════════════════════════════════
var sb = tcCreateClient();

var currentUser = null;
var currentContributor = null;
var DATA = null;
var cineastesIndex = [];
var selectedCineaste = null;
var parsedFilms = null;

// ═══════════════════════════════════════════════════════════════
// NOTIFICATIONS (confirmation de chaque action / erreurs visibles)
// Réutilise la bannière fixe partagée définie dans shared.js
// (tcShowBanner / tcHideBanner) pour ne dépendre d'aucun conteneur HTML.
// Objectif : aucune action Supabase ne doit rester sans retour visible.
// ═══════════════════════════════════════════════════════════════
var _adminNoticeTimer = null;
function showAdminNotice(msg, ok){
  tcShowBanner('tc-admin-notice', msg, ok ? '#1a6b3a' : '#b3261e');
  clearTimeout(_adminNoticeTimer);
  _adminNoticeTimer = setTimeout(function(){ tcHideBanner('tc-admin-notice'); }, ok ? 4000 : 7000);
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
var _adminAuthResolved = false;
function hideAdminLoading(){
  if(_adminAuthResolved) return;
  _adminAuthResolved = true;
  var el = document.getElementById('section-loading');
  if(el) el.style.display = 'none';
}

// CORRECTIF BUG A : le bandeau "Vérification de la session..." est caché par défaut
// (display:none dans le HTML). On ne l'affiche que si la vérification dépasse 500ms,
// pour éviter le flash à chaque ouverture avec une session déjà valide.
var _showLoadingTimer = setTimeout(function(){
  if(!_adminAuthResolved){
    var el = document.getElementById('section-loading');
    if(el) el.style.display = '';
  }
}, 500);

// Filet de sécurité : si getSession() ne se résout pas en 10s (token JWT bloqué),
// on affiche le formulaire de connexion plutôt que de rester bloqué indéfiniment.
var _loadingSafety = setTimeout(function(){
  if(_adminAuthResolved) return;
  console.error('admin: timeout de sécurité (10s) sur getSession()');
  hideAdminLoading();
  document.getElementById('section-login').style.display = 'block';
}, 10000);
(async function(){
  var session = (await sb.auth.getSession()).data.session;
  clearTimeout(_loadingSafety);
  clearTimeout(_showLoadingTimer); // CORRECTIF BUG A : annule l'affichage tardif si auth rapide
  if(session){ hideAdminLoading(); await onLogin(session.user); }
  else { hideAdminLoading(); document.getElementById('section-login').style.display = 'block'; }
  sb.auth.onAuthStateChange(async function(ev, sess){
    if(ev === 'SIGNED_IN' && sess){
      // Évite un rechargement complet (et le flash associé) si l'admin déjà
      // connecté reçoit un SIGNED_IN redondant (retour d'onglet, refresh…).
      if(currentContributor && currentUser && sess.user && currentUser.id === sess.user.id){
        hideAdminLoading();
        return;
      }
      hideAdminLoading();
      await onLogin(sess.user);
    }
    if(ev === 'SIGNED_OUT'){ hideAdminLoading(); onLogout(); }
    if(ev === 'TOKEN_REFRESHED' && sess && currentUser){ currentUser = sess.user; }
  });
})();

function loadAllCineastesAdmin(offset, pageSize){
  return tcLoadAllCineastes(sb, offset, pageSize);
}

tcWithRetryTimeout(function(){ return loadAllCineastesAdmin(0, 1000); }).then(function(rows){
  rows = rows || [];
  DATA = { cineastes: rows };
  cineastesIndex = rows.map(function(c){ return c&&c.nom; }).filter(function(n){ return typeof n==='string'; });
  if(currentUser){ renderDashboard(); populateContribSelect(); }
});

// ═══════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════
document.getElementById('btn-login').addEventListener('click', login);
document.getElementById('btn-logout').addEventListener('click', function(){ sb.auth.signOut(); });
document.getElementById('btn-dark').addEventListener('click', toggleDark);
document.getElementById('btn-lang').addEventListener('click', toggleLang);

['login-email','login-password'].forEach(function(id){
  document.getElementById(id).addEventListener('keydown', function(e){
    if(e.key === 'Enter') login();
  });
});

// La logique partagée (validation, appel Supabase, affichage erreur)
// vit dans auth-shared.js (tcLogin / showError) pour éviter la
// duplication avec submit.html.
function login(){
  return tcLogin(sb, {
    noFields: t('adm_no_fields'),
    connecting: t('adm_connecting'),
    loginBtn: t('adm_login_btn'),
    loginError: t('adm_login_err')
  });
}

async function onLogin(user){
  currentUser = user;
  var res;
  try {
    res = await tcWithRetryTimeout(function(){ return sb.from('contributors').select('*').eq('auth_id', user.id).single(); });
  } catch(err){
    // Échec réseau/timeout pendant le chargement du profil : on ne laisse
    // jamais l'écran bloqué. On réaffiche le login avec un message explicite.
    console.error('onLogin: échec du chargement du profil contributeur:', err);
    currentUser = null;
    hideAdminLoading();
    document.getElementById('section-login').style.display = 'block';
    showError('Connexion établie, mais le profil n\'a pas pu être chargé (problème réseau). Rechargez la page et réessayez.');
    return;
  }
  if(res.error || !res.data){
    // .single() renvoie une erreur si aucun profil : distinguer réseau vs. absence.
    if(res.error && tcIsTransientNetworkError(res.error)){
      currentUser = null;
      hideAdminLoading();
      document.getElementById('section-login').style.display = 'block';
      showError('Le profil n\'a pas pu être chargé (problème réseau). Rechargez la page et réessayez.');
      return;
    }
    showError(t('adm_no_profil'));
    await sb.auth.signOut();
    return;
  }
  if(!res.data.is_admin){
    showError(t('adm_no_admin'));
    await sb.auth.signOut();
    return;
  }
  currentContributor = res.data;

  document.getElementById('section-login').style.display = 'none';
  document.getElementById('section-admin').style.display = 'block';
  document.getElementById('header-user').style.display = 'block';
  document.getElementById('btn-logout').style.display = 'block';
  if(location.hash !== '#dashboard') history.pushState(null, '', '#dashboard');
  document.getElementById('header-name').textContent = res.data.display_name;

  renderDashboard();
  populateContribSelect();
  loadSubmissions();
  loadProposals();
  startDashboardAutoRefresh();
}

// Rafraîchit automatiquement le dashboard pour refléter les changements Supabase
var dashboardRefreshInterval = null;
var isDashboardTabActive = true;
function startDashboardAutoRefresh(){
  if(dashboardRefreshInterval) clearInterval(dashboardRefreshInterval);
  dashboardRefreshInterval = setInterval(function(){
    if(currentUser && isDashboardTabActive && !document.hidden) renderDashboard();
  }, 30000);
}

document.addEventListener('visibilitychange', function(){
  if(!document.hidden && currentUser && isDashboardTabActive) renderDashboard();
});

function onLogout(){
  currentUser = null;
  currentContributor = null;
  if(dashboardRefreshInterval){ clearInterval(dashboardRefreshInterval); dashboardRefreshInterval = null; }
  document.getElementById('section-login').style.display = 'block';
  document.getElementById('section-admin').style.display = 'none';
  document.getElementById('header-user').style.display = 'none';
  document.getElementById('btn-logout').style.display = 'none';
  if(location.hash !== '#connexion') history.pushState(null, '', '#connexion');
}

tcSyncAuthHashOnPopstate('#dashboard', function(){ return !!currentContributor; });

// ═══════════════════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════════════════
document.querySelectorAll('.tab').forEach(function(tab){
  tab.addEventListener('click', function(){
    document.querySelectorAll('.tab').forEach(function(t){ t.classList.remove('active'); });
    document.querySelectorAll('.tab-panel').forEach(function(p){ p.classList.remove('visible'); });
    tab.classList.add('active');
    document.getElementById('panel-' + tab.getAttribute('data-tab')).classList.add('visible');
    isDashboardTabActive = tab.getAttribute('data-tab') === 'dashboard';
    if(isDashboardTabActive) renderDashboard();
    if(tab.getAttribute('data-tab') === 'comments') loadCommentsAdmin();
    if(tab.getAttribute('data-tab') === 'flags') renderFlagsAdmin();
    if(tab.getAttribute('data-tab') === 'thematiques') loadThematicTops();
  });
});

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════
// ── Totaux attendus par contributeur (source : tableau de statistiques) ──
var TOTAUX_ATTENDUS = {
  'MATHIEU MUZARD':   1258,
  'KEEFE MURPHY':     1502,
  'DANIEL JIRDEN':    1443,
  'BASTIEN TEKLOW':   1235,
  'VINZ J. ORLOV':    1221,
  'SEB LAPIN':        1166,
  'FRANKY FOCKERS':   1059,
  'THORACENTESE RUBIS': 827,
  'GREGORY LESCARD':   699,
  'FREDERIC GUEZ':     639,
  'THOMAS DEMAEREL':   592,
  'KARINE CNUDDE':     553,
  'ARNAUD BSTOP':      501,
  'THIERRY JOUSSE':    421,
  'SIMONE ROGHI':      320,
  "JULIEN D'ABRIGEON": 213,
  'ILAN MALKA':        199,
  'THOMAS FLAVIER':    114,
  'CLEMENT GUIBOREL':   58,
  'YANN PROUST':        29,
  'ANTOINE MOUTON':      7,
  'LILIAN FANARA':       6,
  'PEELSA':              6,
  'WILLE LINDELOW':      5,
  'PATERN RIVAL':        2
};

var TOTAL_ATTENDU_GLOBAL = Object.values(TOTAUX_ATTENDUS).reduce(function(a,b){return a+b;}, 0);

// ── Total de tops dans l'index (saisi à la main, indépendant de la table cineastes) ──
var TOTAL_TOPS_INDEX_MANUEL = 14077;
var TOTAL_CINEASTES_INDEX_MANUEL = 2904;

var DASH_CACHE_TTL = 25000;
var _dashCacheTs = 0;
// Verrou de ré-entrance : renderDashboard() est déclenché par de nombreuses
// sources (login, chargement des cinéastes, auto-refresh 30s, retour d'onglet,
// clics d'onglets, après chaque validation…). Étant asynchrone avec plusieurs
// requêtes réseau, deux exécutions simultanées s'entrelaçaient et pouvaient
// vider puis ré-empiler le tableau → lignes dupliquées / affichage incohérent.
// On sérialise : une seule exécution à la fois ; toute demande arrivée pendant
// le rendu est rejouée une fois terminé.
var _dashRendering = false;
var _dashRerender = false;

async function renderDashboard(force){
  if(!DATA) return;
  if(!force && _dashCacheTs && (Date.now() - _dashCacheTs) < DASH_CACHE_TTL) return;
  if(_dashRendering){ _dashRerender = true; return; }
  _dashRendering = true;
  try {

  // Tops dans l'index : valeur saisie à la main (cf. TOTAL_TOPS_INDEX_MANUEL),
  // car ces totaux ne sont pas synchronisés automatiquement avec la table cineastes.
  document.getElementById('dash-total-tops').textContent = TOTAL_TOPS_INDEX_MANUEL.toLocaleString('fr-FR');
  document.getElementById('dash-total-cineastes').textContent = TOTAL_CINEASTES_INDEX_MANUEL.toLocaleString('fr-FR') + t('adm_cineastes_indexes');

  // Soumissions pending — enveloppé dans un timeout/retry pour ne pas rester
  // silencieusement à 0 en cas de micro-coupure réseau.
  var pendingRes = await tcWithRetryTimeout(function(){ return sb.from('submissions').select('id', { count: 'exact', head: true }).eq('status', 'pending'); });
  var nPending = (pendingRes && pendingRes.count) || 0;
  var dashCountError = !!(pendingRes && pendingRes.error);
  // CORRECTIF BUG 6 : suppression de l'assignation redondante ici — la valeur finale
  // est écrite plus bas après calcul du pourcentage global.

  // Tops importes par contributeur — reproduit exactement la logique
  // d'index.html (IMPORTED_COUNTS) : pour Mathieu Muzard et Karine Cnudde,
  // comptage depuis leurs JSON dédiés ; pour les autres, comptage des
  // cinéastes distincts couverts par (a) les soumissions approuvées
  // (quel que soit leur "type", dès lors qu'un cinéaste est renseigné)
  // et (b) la table "tops" (imports manuels), sans double-compter un même
  // cinéaste s'il apparaît dans les deux sources.
  var importedCounts = {};
  var importedCineastes = {}; // jsonName -> { cineasteNom: true }
  var jsonWarnings = [];
  var warnElReset = document.getElementById('dash-json-warning');
  if(warnElReset) warnElReset.textContent = '';

  try {
    var muz = await tcFetchWithTimeout('muzard.json').then(function(r){ return r.json(); });
    importedCounts['MATHIEU MUZARD'] = Array.isArray(muz.tops) ? muz.tops.length : Object.keys(muz.tops||{}).length;
  } catch(e) { importedCounts['MATHIEU MUZARD'] = 0; jsonWarnings.push('muzard.json'); }

  try {
    var cnd = await tcFetchWithTimeout('cnudde.json').then(function(r){ return r.json(); });
    importedCounts['KARINE CNUDDE'] = Array.isArray(cnd.tops) ? cnd.tops.length : Object.keys(cnd.tops||{}).length;
  } catch(e) { importedCounts['KARINE CNUDDE'] = 0; jsonWarnings.push('cnudde.json'); }

  var contribIdToName = {};
  var contribListRes = await tcWithRetryTimeout(function(){ return sb.from('contributors').select('id, json_name, display_name'); });
  if(contribListRes && contribListRes.error) dashCountError = true;
  if(contribListRes.data){
    contribListRes.data.forEach(function(c){
      if(c.id) contribIdToName[c.id] = c.json_name || (c.display_name ? c.display_name.toUpperCase() : null);
    });
  }

  var subRes = await tcWithRetryTimeout(function(){ return sb.from('submissions').select('*, contributors(display_name)').eq('status', 'approved'); });
  if(subRes && subRes.error) dashCountError = true;
  if(subRes.data){
    subRes.data.forEach(function(s){
      var name = (s.contributor_name ? s.contributor_name.toUpperCase() : null)
        || (s.contributors && s.contributors.display_name ? s.contributors.display_name.toUpperCase() : null)
        || (s.contributor_id && contribIdToName[s.contributor_id]) || null;
      var cinNom = s.parsed_json && s.parsed_json.cineaste;
      if(!name || !cinNom || name === 'MATHIEU MUZARD' || name === 'KARINE CNUDDE') return;
      if(!importedCineastes[name]) importedCineastes[name] = {};
      importedCineastes[name][cinNom] = true;
    });
  }

  // Imports manuels (table "tops") — paginés car PostgREST plafonne le
  // nombre de lignes renvoyées par requête (db.max_rows).
  function loadAllTopsAdmin(offset, pageSize){
    return sb.from('tops').select('contributor_id, cineaste_nom')
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
      .then(function(res3){
        if(res3 && res3.error){ dashCountError = true; return; }
        var rows = res3.data || [];
        rows.forEach(function(top){
          var name = contribIdToName[top.contributor_id];
          var cinNom = top.cineaste_nom;
          if(!name || !cinNom || name === 'MATHIEU MUZARD' || name === 'KARINE CNUDDE') return;
          if(!importedCineastes[name]) importedCineastes[name] = {};
          importedCineastes[name][cinNom] = true;
        });
        if(rows.length === pageSize) return loadAllTopsAdmin(offset + pageSize, pageSize);
      });
  }
  await loadAllTopsAdmin(0, 1000);

  Object.keys(importedCineastes).forEach(function(name){
    importedCounts[name] = Object.keys(importedCineastes[name]).length;
  });

  var warnMsgs = [];
  if(jsonWarnings.length) warnMsgs.push(t('adm_json_warning', jsonWarnings.join(', ')));
  // Échec silencieux corrigé : si une requête Supabase de comptage a échoué,
  // on le signale au lieu d'afficher des totaux faussement complets.
  if(dashCountError) warnMsgs.push('⚠ Une requête Supabase a échoué : les totaux importés peuvent être partiels. Rechargez la page.');
  var warnEl = document.getElementById('dash-json-warning');
  if(warnEl) warnEl.textContent = warnMsgs.join('  ');

  // Afficher les lignes contributeurs
  var container = document.getElementById('contrib-dashboard');
  container.innerHTML = '';

  var contribs = Object.keys(TOTAUX_ATTENDUS).map(function(name){
    var importe = importedCounts[name] || 0;
    return {
      name: name,
      attendu: Math.max(TOTAUX_ATTENDUS[name], importe),
      importe: importe
    };
  }).sort(function(a,b){ return b.attendu - a.attendu; });

  // Total importé global (recalculé avec les attendus ajustés)
  var totalImporte = Object.values(importedCounts).reduce(function(a,b){return a+b;}, 0);
  var totalAttenduAjuste = contribs.reduce(function(a,c){return a+c.attendu;}, 0);
  var pctGlobal = Math.round((totalImporte / totalAttenduAjuste) * 100);
  document.getElementById('dash-total-contribs').textContent = totalImporte.toLocaleString('fr-FR') + ' / ' + totalAttenduAjuste.toLocaleString('fr-FR');
  document.getElementById('dash-pending-count').textContent =
    t('adm_pct_imported', [pctGlobal, nPending]);

  contribs.forEach(function(c, i){
    var pct = Math.round((c.importe / c.attendu) * 100);
    var done = c.importe >= c.attendu;
    var row = document.createElement('div');
    row.className = 'contrib-row';

    var nameParts = c.name.split(' ');
    var nom = nameParts[nameParts.length - 1];
    var prenom = nameParts.slice(0, -1).join(' ');

    row.innerHTML =
      '<div class="contrib-rank">' + (i + 1) + '</div>'
      + '<div class="contrib-name-cell">' + prenom + ' <span class="nom">' + nom + '</span></div>'
      + '<div class="contrib-bar-wrap">'
        + '<div class="contrib-bar-bg"><div class="contrib-bar-fill' + (done?' full':'') + '" style="width:' + pct + '%"></div></div>'
        + '<div class="contrib-count">'
          + (done
            ? '<span class="done">' + c.importe + ' / ' + c.attendu + ' ✓</span>'
            : c.importe + ' / ' + c.attendu)
        + '</div>'
      + '</div>';

    container.appendChild(row);
  });

  _dashCacheTs = Date.now();
  } finally {
    _dashRendering = false;
    // Une demande de rendu est arrivée pendant l'exécution : on la rejoue une
    // seule fois, de façon sérialisée, pour refléter le dernier état.
    if(_dashRerender){ _dashRerender = false; renderDashboard(true); }
  }
}

// ═══════════════════════════════════════════════════════════════
// IMPORT MANUEL
// ═══════════════════════════════════════════════════════════════
function populateContribSelect(){
  if(!DATA) return;
  var sel = document.getElementById('import-contrib');
  // Uniquement depuis la table cineastes (Supabase) — pas de doublon possible
  var names = {};
  DATA.cineastes.forEach(function(c){
    (c.tops_contributeurs || []).forEach(function(n){ names[n] = true; });
  });
  var sorted = Object.keys(names).sort(function(a, b){ return a.localeCompare(b, 'fr'); });
  sorted.forEach(function(n){
    var opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    sel.appendChild(opt);
  });
}

// Autocomplete cineaste
createAutocomplete({
  inputId: 'import-cineaste',
  dropdownId: 'import-dropdown',
  getItems: function(){ return cineastesIndex; },
  onSelect: function(nom){ selectedCineaste = nom; }
});
document.getElementById('import-cineaste').addEventListener('input', function(){ selectedCineaste = null; });

// Parsing
function showImportError(msg){
  var el=document.getElementById('import-error');
  if(el){el.textContent=msg;el.style.display=msg?'block':'none';}
}

document.getElementById('btn-parse').addEventListener('click', function(){
  var contrib = document.getElementById('import-contrib').value;
  var cineaste = selectedCineaste || document.getElementById('import-cineaste').value.trim();
  var texte = document.getElementById('import-textarea').value.trim();

  if(!contrib){ showImportError(t('adm_select_contrib')); return; }
  if(!cineaste){ showImportError(t('adm_select_cin')); return; }
  if(!texte){ showImportError(t('adm_paste_text')); return; }
  showImportError('');

  parsedFilms = parseTopsBrut(texte);
  if(!parsedFilms.length){
    showImportError(t('adm_no_film_detected'));
    return;
  }

  // Afficher resultat
  var parts = cineaste.split(',');
  var nom = parts[0].trim();
  var prenom = parts.length > 1 ? parts[1].trim() : '';
  document.getElementById('import-result-cineaste').innerHTML =
    (prenom ? escapeHtml(prenom) + ' ' : '') + '<strong>' + escapeHtml(nom) + '</strong>' +
    ' — <span style="font-size:18px;color:var(--brun-pale)">' + escapeHtml(contrib) + '</span>';

  var list = document.getElementById('import-films-list');
  list.innerHTML = parsedFilms.map(function(f){
    return '<li><span class="film-titre">' + escapeHtml(f.titre) + '</span>'
      + (f.annee ? '<span class="film-annee">' + escapeHtml(f.annee) + '</span>' : '')
      + '</li>';
  }).join('');

  var sansAnnee = parsedFilms.filter(function(f){ return !f.annee; }).length;
  var warn = document.getElementById('import-warning');
  if(sansAnnee > 0){
    warn.textContent = t('adm_films_sans_annee', sansAnnee);
    warn.style.display = 'block';
  } else {
    warn.style.display = 'none';
  }

  document.getElementById('import-result').classList.add('visible');
  document.getElementById('import-success').classList.remove('visible');
});

// Enregistrer
document.getElementById('btn-submit-import').addEventListener('click', async function(){
  if(!parsedFilms) return;
  var contrib = document.getElementById('import-contrib').value;
  var cineaste = selectedCineaste || document.getElementById('import-cineaste').value.trim();
  var rawText = document.getElementById('import-textarea').value.trim();
  var btn = document.getElementById('btn-submit-import');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>' + t('adm_saving');
  showImportError('');

  try{
    // Résoudre le contributor_id depuis la table contributors (lectures :
    // enveloppées dans un timeout/retry pour ne pas rester bloqué sur réseau lent).
    var contribId = null;
    var contribRes = await tcWithRetryTimeout(function(){ return sb.from('contributors').select('id').ilike('json_name', contrib).maybeSingle(); });
    if(contribRes.data) contribId = contribRes.data.id;
    if(!contribId){
      contribRes = await tcWithRetryTimeout(function(){ return sb.from('contributors').select('id').ilike('display_name', contrib).maybeSingle(); });
      if(contribRes.data) contribId = contribRes.data.id;
    }

    if(!contribId){
      btn.disabled = false;
      btn.textContent = t('adm_save_btn');
      showImportError(t('adm_contrib_not_found', contrib));
      return;
    }

    // GARDE-FOU DOUBLON : avant d'insérer un top "approved", on vérifie qu'il
    // n'existe pas déjà une submission approuvée pour ce couple
    // (contributor_id, cineaste). Le filtre sur parsed_json->>'cineaste' n'étant
    // pas exploitable via l'API REST anon, on récupère les submissions approuvées
    // du contributeur (limite raisonnable) et on filtre côté client.
    // Une lecture en échec (réseau/timeout) n'est pas bloquante : on laisse
    // l'INSERT se faire pour ne pas empêcher un import légitime sur un aléa réseau.
    try{
      var dupRes = await tcWithRetryTimeout(function(){
        return sb.from('submissions').select('parsed_json')
          .eq('contributor_id', contribId)
          .eq('status', 'approved')
          .limit(200);
      });
      if(dupRes && !dupRes.error && dupRes.data){
        var dejaApprouve = dupRes.data.some(function(row){
          return row.parsed_json && row.parsed_json.cineaste === cineaste;
        });
        if(dejaApprouve){
          btn.disabled = false;
          btn.textContent = t('adm_save_btn');
          showImportError(t('adm_dup_import', cineaste));
          return;
        }
      }
    }catch(dupErr){
      console.warn('Vérification doublon impossible, poursuite de l\'import:', dupErr);
    }

    // INSERT : timeout mais SANS relance automatique (retries:0). Un INSERT
    // n'est pas idempotent : le rejouer après un timeout risquerait de créer
    // un doublon. En cas de coupure, on informe et on laisse l'admin réessayer.
    var res = await tcWithRetryTimeout(function(){
      return sb.from('submissions').insert({
        contributor_id: contribId,
        raw_text: rawText,
        parsed_json: { cineaste: cineaste, films: parsedFilms },
        status: 'approved',
        reviewed_at: new Date().toISOString() // date de validation (import = validé maintenant)
      }).select('id');
    }, { retries: 0, timeoutMs: 15000 });

    btn.disabled = false;
    btn.textContent = t('adm_save_btn');

    if(res.error){
      showImportError(t('adm_err_prefix') + friendlyError(res.error));
      return;
    }
    if(!res.data || !res.data.length){
      showImportError(t('adm_save_rights'));
      return;
    }

    // Succès : on neutralise parsedFilms pour empêcher toute double-insertion
    // (un nouveau clic ne fera rien tant qu'une nouvelle analyse n'a pas eu lieu).
    parsedFilms = null;
    document.getElementById('import-result').classList.remove('visible');
    document.getElementById('import-success').classList.add('visible');
    showAdminNotice('✓ Import enregistré et pris en compte.', true);
    loadSubmissions();
    renderDashboard(true);
  }catch(err){
    console.error('Erreur lors de l\'enregistrement:', err);
    btn.disabled = false;
    btn.textContent = t('adm_save_btn');
    showImportError(t('adm_err_unexpected') + friendlyError(err));
  }
});

// Reset
document.getElementById('btn-reset-import').addEventListener('click', function(){
  document.getElementById('import-contrib').value = '';
  document.getElementById('import-cineaste').value = '';
  document.getElementById('import-textarea').value = '';
  document.getElementById('import-result').classList.remove('visible');
  document.getElementById('import-success').classList.remove('visible');
  selectedCineaste = null;
  parsedFilms = null;
});

// ═══════════════════════════════════════════════════════════════
// FENETRE DE CONFIRMATION GENERIQUE
// ═══════════════════════════════════════════════════════════════
function showConfirmModal(message, onConfirm){
  var overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  var box = document.createElement('div');
  box.className = 'confirm-box';
  var msg = document.createElement('p');
  msg.className = 'confirm-message';
  msg.textContent = message;
  var actions = document.createElement('div');
  actions.className = 'confirm-actions';
  var noBtn = document.createElement('button');
  noBtn.className = 'confirm-btn-no';
  noBtn.textContent = t('adm_cancel');
  var yesBtn = document.createElement('button');
  yesBtn.className = 'confirm-btn-yes';
  yesBtn.textContent = t('adm_confirm');
  function close(){ if(overlay.parentNode) document.body.removeChild(overlay); }
  noBtn.addEventListener('click', close);
  overlay.addEventListener('click', function(e){ if(e.target === overlay) close(); });
  yesBtn.addEventListener('click', function(){ close(); onConfirm(); });
  actions.appendChild(noBtn);
  actions.appendChild(yesBtn);
  box.appendChild(msg);
  box.appendChild(actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// ═══════════════════════════════════════════════════════════════
// SOUMISSIONS
// ═══════════════════════════════════════════════════════════════
// CORRECTIF BUG 3 : getTypeLabel() est une fonction appelée à la volée,
// ce qui garantit que les libellés reflètent la langue active au moment du rendu.
function getTypeLabel(type){
  var labels = {
    top: t('adm_type_top'), favoris: t('adm_type_favoris'),
    autres_cineastes: t('adm_type_autres_cin'),
    films_favoris: t('adm_type_films_favoris'), autres_films: t('adm_type_autres_films'),
    presentation: t('adm_type_presentation')
  };
  return labels[type] || type;
}

var currentFilter = 'pending';
var allSubmissions = [];

// Detection "Nouveau" / "Modification" pour les soumissions de type "top" :
// on regarde si le couple (contributeur, cinéaste) existe déjà dans la table
// "tops" (legacy) ou dans une autre soumission déjà approuvée.
var legacyTopsKeys = null; // Set de "contributor_id|cineaste_nom"
var approvedTopSubsByKey = {}; // "contributor_id|cineaste" -> [submission ids]

function topKey(contributorId, cineaste){ return contributorId + '|' + cineaste; }

function loadLegacyTopsKeys(offset, pageSize){
  return tcWithRetryTimeout(function(){
    return sb.from('tops').select('contributor_id, cineaste_nom')
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
  })
    .then(function(res){
      if(res && res.error) return; // détection non critique : on n'échoue pas
      var rows = res.data || [];
      rows.forEach(function(row){
        if(row.contributor_id && row.cineaste_nom) legacyTopsKeys.add(topKey(row.contributor_id, row.cineaste_nom));
      });
      if(rows.length === pageSize) return loadLegacyTopsKeys(offset + pageSize, pageSize);
    });
}

async function loadModificationDetectionData(){
  legacyTopsKeys = new Set();
  approvedTopSubsByKey = {};
  // Détection "Nouveau/Modification" : utile mais NON critique. On l'isole dans
  // un try/catch pour qu'un incident réseau ici ne bloque JAMAIS le chargement
  // des soumissions (loadSubmissions l'attend en tête).
  try {
    await loadLegacyTopsKeys(0, 1000);

    var res = await tcWithRetryTimeout(function(){ return sb.from('submissions').select('id, contributor_id, parsed_json').eq('status', 'approved'); });
    if(res && res.error) return;
    (res.data || []).forEach(function(s){
      var type = (s.parsed_json && s.parsed_json.type) || 'top';
      var cineaste = s.parsed_json && s.parsed_json.cineaste;
      if(type !== 'top' || !s.contributor_id || !cineaste) return;
      var key = topKey(s.contributor_id, cineaste);
      if(!approvedTopSubsByKey[key]) approvedTopSubsByKey[key] = [];
      approvedTopSubsByKey[key].push(s.id);
    });
  } catch(err){
    console.error('loadModificationDetectionData: détection ignorée (erreur réseau):', err);
  }
}

function isTopModification(s){
  var cineaste = s.parsed_json && s.parsed_json.cineaste;
  if(!s.contributor_id || !cineaste) return false;
  if(s.parsed_json && s.parsed_json.approvalCount > 1) return true;
  var key = topKey(s.contributor_id, cineaste);
  if(legacyTopsKeys && legacyTopsKeys.has(key)) return true;
  var approvedIds = approvedTopSubsByKey[key] || [];
  return approvedIds.some(function(id){ return id !== s.id; });
}

// Filtres
document.querySelectorAll('.sub-filter').forEach(function(btn){
  btn.addEventListener('click', function(){
    document.querySelectorAll('.sub-filter').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    currentFilter = btn.getAttribute('data-filter');
    renderSubmissions();
  });
});

function renderSubmissions(){
  var container = document.getElementById('submissions-list');
  var filtered = allSubmissions.filter(function(s){
    if(currentFilter === 'all') return true;
    if(currentFilter === 'pending') return s.status === 'pending';
    if(currentFilter === 'approved') return s.status === 'approved';
    if(currentFilter === 'rejected') return s.status === 'rejected';
    var type = (s.parsed_json && s.parsed_json.type) || 'top';
    return type === currentFilter;
  });
  container.innerHTML = '';
  if(!filtered.length){
    container.innerHTML = '<div class="empty-state">' + t('adm_no_submission') + '</div>';
    return;
  }
  filtered.forEach(function(s){ buildSubmissionCard(s, container); });
}

function buildSubmissionCard(s, container){
  var type = (s.parsed_json && s.parsed_json.type) || 'top';
  var typeLabel = getTypeLabel(type); // CORRECTIF BUG 3 : appel dynamique
  var contribName = s.contributor_name || '—';
  var date = new Date(s.submitted_at).toLocaleDateString('fr-FR');
  var statusLabel = {pending: t('adm_status_pending'), approved: t('adm_status_approved'), rejected: t('adm_status_rejected')}[s.status] || s.status;
  var cardId = 'sub-' + s.id;

  // Sous-titre selon le type
  var subtitle = '';
  var nbFilms = 0;
  if(type === 'top'){
    var cineaste = s.parsed_json && s.parsed_json.cineaste ? s.parsed_json.cineaste : '—';
    nbFilms = s.parsed_json && s.parsed_json.films ? s.parsed_json.films.length : 0;
    subtitle = cineaste + ' · ' + nbFilms + ' film' + (nbFilms > 1 ? 's' : '');
  } else if(type === 'favoris' || type === 'autres_cineastes'){
    var nb = s.parsed_json && s.parsed_json.cineastes ? s.parsed_json.cineastes.length : 0;
    subtitle = nb + ' cinéaste' + (nb > 1 ? 's' : '');
  } else if(type === 'films_favoris' || type === 'autres_films'){
    var nb = s.parsed_json && s.parsed_json.films ? s.parsed_json.films.length : 0;
    subtitle = nb + ' film' + (nb > 1 ? 's' : '');
  } else if(type === 'presentation'){
    var txt = s.parsed_json && s.parsed_json.texte ? s.parsed_json.texte : '';
    subtitle = txt.slice(0, 60) + (txt.length > 60 ? '…' : '');
  }

  var card = document.createElement('div');
  card.className = 'submission-card ' + s.status;

  var header = document.createElement('div');
  header.className = 'submission-header';
  var infoDiv = document.createElement('div');
  infoDiv.className = 'submission-info';

  var namesDiv = document.createElement('div');
  namesDiv.className = 'submission-names';
  var contribDiv = document.createElement('span');
  contribDiv.className = 'submission-contrib';
  contribDiv.textContent = contribName;
  namesDiv.appendChild(contribDiv);
  if(type === 'top'){
    var cineasteNomEl = document.createElement('span');
    cineasteNomEl.className = 'submission-cineaste-nom';
    var cineasteNomTxt = s.parsed_json && s.parsed_json.cineaste ? s.parsed_json.cineaste : '—';
    var arrowEl = document.createElement('span');
    arrowEl.className = 'submission-names-sep';
    arrowEl.textContent = '→';
    namesDiv.appendChild(arrowEl);
    cineasteNomEl.textContent = cineasteNomTxt;
    namesDiv.appendChild(cineasteNomEl);
  }
  var badge = document.createElement('span');
  badge.className = 'type-badge ' + type;
  badge.textContent = typeLabel;
  namesDiv.appendChild(badge);
  if(type === 'top'){
    var modifBadge = document.createElement('span');
    var isModif = isTopModification(s);
    modifBadge.className = 'modif-badge ' + (isModif ? 'modification' : 'nouveau');
    modifBadge.textContent = isModif ? t('adm_badge_modif') : t('adm_badge_new');
    namesDiv.appendChild(modifBadge);
  }
  var cineasteDiv = document.createElement('div');
  cineasteDiv.className = 'submission-meta-line';
  cineasteDiv.textContent = (type === 'top' ? (nbFilms + ' film' + (nbFilms > 1 ? 's' : '')) : subtitle) + ' · ' + date;
  infoDiv.appendChild(namesDiv);
  infoDiv.appendChild(cineasteDiv);
  var statusSpan = document.createElement('span');
  statusSpan.className = 'submission-status ' + s.status;
  statusSpan.textContent = statusLabel;
  header.appendChild(infoDiv);
  header.appendChild(statusSpan);
  header.addEventListener('click', function(){
    document.getElementById(cardId).classList.toggle('visible');
  });

  var body = document.createElement('div');
  body.className = 'submission-body';
  body.id = cardId;

  // Contenu selon le type
  var contentEl = document.createElement('div');

  if(type === 'top'){
    var films = s.parsed_json && s.parsed_json.films ? s.parsed_json.films : [];
    var ol = document.createElement('ol');
    ol.className = 'submission-films';
    films.forEach(function(f){
      var li = document.createElement('li');
      li.textContent = f.titre;
      if(f.annee){ var ys=document.createElement('span');ys.style.color='var(--brun-pale)';ys.style.fontSize='13px';ys.textContent=' ('+f.annee+')';li.appendChild(ys); }
      ol.appendChild(li);
    });
    contentEl.appendChild(ol);
  } else if(type === 'favoris' || type === 'autres_cineastes'){
    var cineastes = s.parsed_json && s.parsed_json.cineastes ? s.parsed_json.cineastes : [];
    var chipsDiv = document.createElement('div');
    chipsDiv.className = 'admin-chips';
    cineastes.forEach(function(c){
      var chip = document.createElement('div');
      chip.className = 'admin-chip';
      chip.textContent = c;
      chipsDiv.appendChild(chip);
    });
    contentEl.appendChild(chipsDiv);
  } else if(type === 'films_favoris' || type === 'autres_films'){
    var films = s.parsed_json && s.parsed_json.films ? s.parsed_json.films : [];
    var ul = document.createElement('ul');
    ul.className = 'submission-films';
    films.forEach(function(f){
      var li = document.createElement('li');
      li.textContent = f.titre;
      if(f.annee){ var ys=document.createElement('span');ys.style.color='var(--brun-pale)';ys.style.fontSize='13px';ys.textContent=' ('+f.annee+')';li.appendChild(ys); }
      ul.appendChild(li);
    });
    contentEl.appendChild(ul);
  } else if(type === 'presentation'){
    var p = document.createElement('p');
    p.style.cssText = 'font-size:17px;line-height:1.7;padding:8px 0;font-style:italic;color:var(--brun)';
    p.textContent = s.parsed_json && s.parsed_json.texte ? s.parsed_json.texte : '';
    contentEl.appendChild(p);
  }

  body.appendChild(contentEl);

  // Zone edition
  if(s.status === 'pending'){
    // Bouton editer
    var editBtn = document.createElement('button');
    editBtn.className = 'btn-edit';
    editBtn.textContent = t('adm_edit_before');
    var editZone = document.createElement('div');
    editZone.className = 'edit-zone';

    // Contenu editable selon le type
    var editTextarea = document.createElement('textarea');
    editTextarea.className = 'edit-textarea';

    if(type === 'top'){
      var films = s.parsed_json && s.parsed_json.films ? s.parsed_json.films : [];
      editTextarea.value = films.map(function(f,i){
        return (i+1)+'. '+f.titre+(f.annee?' ('+f.annee+')':'');
      }).join('\n');
    } else if(type === 'favoris' || type === 'autres_cineastes'){
      var cineastes = s.parsed_json && s.parsed_json.cineastes ? s.parsed_json.cineastes : [];
      editTextarea.value = cineastes.join('\n');
    } else if(type === 'films_favoris' || type === 'autres_films'){
      var films = s.parsed_json && s.parsed_json.films ? s.parsed_json.films : [];
      editTextarea.value = films.map(function(f){
        return f.titre+(f.annee?' ('+f.annee+')':'');
      }).join('\n');
    } else if(type === 'presentation'){
      editTextarea.value = s.parsed_json && s.parsed_json.texte ? s.parsed_json.texte : '';
    }

    editBtn.addEventListener('click', function(){
      editZone.classList.toggle('visible');
      editBtn.textContent = editZone.classList.contains('visible') ? t('adm_close_editor') : t('adm_edit_before');
    });

    editZone.appendChild(editTextarea);
    body.appendChild(editBtn);
    body.appendChild(editZone);

    // Actions valider/rejeter
    var actionsDiv = document.createElement('div');
    actionsDiv.className = 'submission-actions';

    var approveBtn = document.createElement('button');
    approveBtn.className = 'btn-approve';
    approveBtn.textContent = t('adm_approve');
    approveBtn.addEventListener('click', function(e){
      e.stopPropagation();
      var cineasteTxt = s.parsed_json && s.parsed_json.cineaste;
      var confirmMsg = (type === 'top' && cineasteTxt)
        ? t('adm_confirm_top', [contribName, cineasteTxt])
        : t('adm_confirm_other', contribName);
      showConfirmModal(confirmMsg, async function(){
        approveBtn.disabled = true;
        approveBtn.textContent = t('adm_approving');
        try{
          // Si editeur ouvert, sauvegarder
          var ok = editZone.classList.contains('visible')
            ? await updateSubmissionWithEdit(s.id, s, type, editTextarea.value)
            : await updateSubmission(s.id, 'approved', s);
          if(!ok){
            approveBtn.disabled = false;
            approveBtn.textContent = t('adm_approve');
          }
        }catch(err){
          console.error('Erreur lors de la validation:', err);
          showSubmissionsError(t('adm_approve_unexpected') + friendlyError(err));
          approveBtn.disabled = false;
          approveBtn.textContent = t('adm_approve');
        }
      });
    });

    var rejectBtn = document.createElement('button');
    rejectBtn.className = 'btn-reject';
    rejectBtn.textContent = t('adm_reject');
    // CORRECTIF BUG 2 : confirmation avant rejet (comme pour la validation)
    rejectBtn.addEventListener('click', function(e){
      e.stopPropagation();
      showConfirmModal(t('adm_confirm_reject', contribName), async function(){
        approveBtn.disabled = true;
        rejectBtn.disabled = true;
        rejectBtn.textContent = 'Rejet…';
        try{
          var ok = await updateSubmission(s.id, 'rejected');
          if(!ok){
            approveBtn.disabled = false;
            rejectBtn.disabled = false;
            rejectBtn.textContent = t('adm_reject');
          }
        }catch(err){
          console.error('Erreur lors du rejet:', err);
          showSubmissionsError(t('adm_update_err') + friendlyError(err));
          approveBtn.disabled = false;
          rejectBtn.disabled = false;
          rejectBtn.textContent = t('adm_reject');
        }
      });
    });

    actionsDiv.appendChild(approveBtn);
    actionsDiv.appendChild(rejectBtn);
    body.appendChild(actionsDiv);
  }

  // Texte brut (repliable)
  if(s.raw_text && type === 'top'){
    var rawDiv = document.createElement('div');
    rawDiv.className = 'submission-raw';
    rawDiv.textContent = s.raw_text;
    body.appendChild(rawDiv);
  }

  card.appendChild(header);
  card.appendChild(body);
  container.appendChild(card);
}

async function loadSubmissions(){
  await loadModificationDetectionData();

  var container = document.getElementById('submissions-list');
  var truncWarn = document.getElementById('submissions-truncated-warning');
  showSubmissionsError('');

  var SUBMISSIONS_LIMIT = 50;
  var countRes = await tcWithRetryTimeout(function(){ return sb.from('submissions').select('id', { count: 'exact', head: true }); });
  var totalCount = (countRes && typeof countRes.count === 'number') ? countRes.count : null;

  var res = await tcWithRetryTimeout(function(){
    return sb.from('submissions')
      .select('*, contributors(display_name)')
      .order('submitted_at', { ascending: false })
      .limit(SUBMISSIONS_LIMIT);
  });

  // Échec silencieux corrigé : une ERREUR de chargement ne doit PAS s'afficher
  // comme « Aucune soumission ». On distingue explicitement les deux cas.
  if(res && res.error){
    allSubmissions = [];
    var subErrMsg = 'Erreur de chargement des soumissions : ' + friendlyError(res.error);
    showSubmissionsError(subErrMsg);
    container.innerHTML = '<div class="empty-state">' + escapeHtml(subErrMsg) + '</div>';
    if(truncWarn) truncWarn.style.display = 'none';
    return;
  }
  if(!res.data || !res.data.length){
    allSubmissions = [];
    container.innerHTML = '<div class="empty-state">' + t('adm_no_submission') + '</div>';
    if(truncWarn) truncWarn.style.display = 'none';
    return;
  }
  allSubmissions = res.data.map(function(s){
    s.contributor_name = (s.contributors && s.contributors.display_name) || s.contributor_name || '—';
    return s;
  });
  if(truncWarn){
    if(totalCount !== null && totalCount > SUBMISSIONS_LIMIT){
      truncWarn.textContent = t('adm_truncated', [SUBMISSIONS_LIMIT, totalCount]);
      truncWarn.style.display = 'block';
    } else {
      truncWarn.style.display = 'none';
    }
  }
  renderSubmissions();
}

async function updateSubmissionWithEdit(id, s, type, editedText){
  // Parser texte edite et MAJ parsed_json
  var newParsedJson = Object.assign({}, s.parsed_json);

  if(type === 'top'){
    var lines = editedText.split('\n').filter(function(l){ return l.trim(); });
    var films = lines.map(function(line, i){
      line = line.replace(/^\d+[.\-)\s]+/, '').trim();
      var am = line.match(/\((\d{4})\)\s*$/);
      var annee = am ? parseInt(am[1]) : null;
      var titre = line.replace(/\(\d{4}\)\s*$/, '').trim();
      return { rang: i+1, titre: titre, annee: annee };
    }).filter(function(f){ return f.titre; });
    newParsedJson.films = films;
  } else if(type === 'favoris' || type === 'autres_cineastes'){
    newParsedJson.cineastes = editedText.split('\n').map(function(l){ return l.trim(); }).filter(Boolean);
  } else if(type === 'films_favoris' || type === 'autres_films'){
    var lines = editedText.split('\n').filter(function(l){ return l.trim(); });
    var films = lines.map(function(line){
      var am = line.match(/\((\d{4})\)\s*$/);
      var annee = am ? parseInt(am[1]) : null;
      var titre = line.replace(/\(\d{4}\)\s*$/, '').trim();
      return { titre: titre, annee: annee };
    }).filter(function(f){ return f.titre; });
    newParsedJson.films = films;
  } else if(type === 'presentation'){
    newParsedJson.texte = editedText.trim();
  }

  newParsedJson.approvalCount = ((s.parsed_json && s.parsed_json.approvalCount) || 0) + 1;
  newParsedJson.isModification = newParsedJson.isModification || newParsedJson.approvalCount > 1 || await legacyTopExists(s, newParsedJson);
  showSubmissionsError('');
  // Filet anti-doublon : retirer toute autre submission déjà approuvée du couple
  // AVANT de valider celle-ci (sinon l'index unique en base refuserait l'écriture).
  await removeDuplicateApprovedSubmissions(s, newParsedJson, id);
  // UPDATE idempotent (valeurs fixes calculées avant l'appel) : timeout/retry sûr.
  var res = await tcWithRetryTimeout(function(){
    return sb.from('submissions')
      .update({ status: 'approved', parsed_json: newParsedJson, reviewed_at: new Date().toISOString() })
      .eq('id', id)
      .select('id');
  });
  if(res.error){ console.error('Erreur approbation:', res.error.message); showSubmissionsError(t('adm_approve_err') + friendlyError(res.error)); return false; }
  if(!res.data || !res.data.length){ showSubmissionsError(t('adm_approve_rights')); return false; }
  await applySubmissionToContributor(s, newParsedJson);
  await removeLegacyTopDuplicate(s, newParsedJson);
  showAdminNotice('✓ Soumission validée (avec modifications) et prise en compte.', true);
  loadSubmissions();
  renderDashboard(true);
  return true;
}

async function legacyTopExists(submission, parsedJson){
  var type = (parsedJson && parsedJson.type) || 'top';
  var contributorId = submission && submission.contributor_id;
  var cineaste = parsedJson && parsedJson.cineaste;
  if(!contributorId || type !== 'top' || !cineaste) return false;
  var res = await tcWithRetryTimeout(function(){ return sb.from('tops').select('id').eq('contributor_id', contributorId).eq('cineaste_nom', cineaste).limit(1); });
  if(res.error){ console.error('Erreur vérification doublon table tops:', res.error.message); return false; }
  return !!(res.data && res.data.length);
}

async function removeLegacyTopDuplicate(submission, parsedJson){
  var type = (parsedJson && parsedJson.type) || 'top';
  var contributorId = submission && submission.contributor_id;
  var cineaste = parsedJson && parsedJson.cineaste;
  if(!contributorId || type !== 'top' || !cineaste) return;
  var existedBefore = await legacyTopExists(submission, parsedJson);
  if(!existedBefore) return;
  // DELETE idempotent (par clés contributor+cineaste) : timeout/retry sûr.
  var res = await tcWithRetryTimeout(function(){ return sb.from('tops').delete().eq('contributor_id', contributorId).eq('cineaste_nom', cineaste).select('id'); });
  if(res.error){
    console.error('Erreur suppression doublon table tops:', res.error.message);
    showSubmissionsError(t('adm_dup_err', friendlyError(res.error)));
  } else if(!res.data || !res.data.length){
    console.error('Suppression doublon table tops : 0 ligne supprimée malgré une ligne existante (droits insuffisants ?)');
    showSubmissionsError(t('adm_dup_rights'));
  }
}

// Filet anti-doublon (table submissions) : supprime toute AUTRE submission déjà
// approuvée pour le même couple (contributeur, cinéaste). À appeler AVANT de
// valider la nouvelle, pour ne jamais avoir deux tops approuvés (et ne pas heurter
// l'index unique en base). Le filtre parsed_json->>'cineaste' n'étant pas
// exploitable via l'API REST, on récupère les submissions approuvées du
// contributeur et on filtre côté client (comparaison exacte, comme l'index).
// En pratique ne se déclenche que sur d'éventuelles données héritées.
async function removeDuplicateApprovedSubmissions(submission, parsedJson, keepId){
  var type = (parsedJson && parsedJson.type) || 'top';
  var contributorId = submission && submission.contributor_id;
  var cineaste = parsedJson && parsedJson.cineaste;
  if(!contributorId || type !== 'top' || !cineaste) return;
  var res = await tcWithRetryTimeout(function(){
    return sb.from('submissions').select('id, parsed_json')
      .eq('contributor_id', contributorId)
      .eq('status', 'approved')
      .limit(200);
  });
  if(!res || res.error || !res.data) return;
  var dupIds = res.data.filter(function(row){
    return row.id !== keepId && row.parsed_json && row.parsed_json.cineaste === cineaste;
  }).map(function(row){ return row.id; });
  if(!dupIds.length) return;
  // DELETE idempotent (par ids) : timeout/retry sûr.
  await tcWithRetryTimeout(function(){ return sb.from('submissions').delete().in('id', dupIds).select('id'); });
}

async function applySubmissionToContributor(submission, parsedJson){
  var type = (parsedJson && parsedJson.type) || 'top';
  var contributorId = submission && submission.contributor_id;
  if(!contributorId || type === 'top') return;

  var update = {};
  if(type === 'favoris'){
    update.cineaste_coeur = parsedJson.cineastes || [];
  } else if(type === 'autres_cineastes'){
    update.cineaste_autres = parsedJson.cineastes || [];
  } else if(type === 'films_favoris'){
    update.film_coeur = (parsedJson.films || []).map(function(f){
      return f.titre + (f.annee ? ' (' + f.annee + ')' : '');
    });
  } else if(type === 'autres_films'){
    update.film_autres = (parsedJson.films || []).map(function(f){
      return f.titre + (f.annee ? ' (' + f.annee + ')' : '');
    });
  } else if(type === 'presentation'){
    update.presentation = parsedJson.texte || '';
  }

  if(Object.keys(update).length === 0) return;
  // UPDATE idempotent (valeurs fixes) : timeout/retry sûr.
  var res = await tcWithRetryTimeout(function(){ return sb.from('contributors').update(update).eq('id', contributorId).select('id'); });
  if(res.error){ console.error('Erreur mise à jour profil contributeur:', res.error.message); showSubmissionsError(t('adm_profile_err') + friendlyError(res.error)); }
  else if(!res.data || !res.data.length){ console.error('Mise à jour profil contributeur : 0 lignes affectées'); showSubmissionsError(t('adm_profile_rights')); }
}

async function updateSubmission(id, status, submission){
  showSubmissionsError('');
  var update = { status: status, reviewed_at: new Date().toISOString() }; // date de validation/revue
  if(status === 'approved' && submission){
    var prevCount = (submission.parsed_json && submission.parsed_json.approvalCount) || 0;
    var isModification = (submission.parsed_json && submission.parsed_json.isModification) || prevCount > 0 || await legacyTopExists(submission, submission.parsed_json);
    update.parsed_json = Object.assign({}, submission.parsed_json, { approvalCount: prevCount + 1, isModification: isModification });
    // Filet anti-doublon : retirer toute autre submission déjà approuvée du couple
    // AVANT de valider celle-ci (sinon l'index unique en base refuserait l'écriture).
    await removeDuplicateApprovedSubmissions(submission, update.parsed_json, id);
  }
  // UPDATE idempotent (valeurs fixes calculées avant l'appel) : timeout/retry sûr.
  var res = await tcWithRetryTimeout(function(){ return sb.from('submissions').update(update).eq('id', id).select('id'); });
  if(res.error){ console.error('Erreur mise à jour statut:', res.error.message); showSubmissionsError(t('adm_update_err') + friendlyError(res.error)); return false; }
  if(!res.data || !res.data.length){ showSubmissionsError(t('adm_update_rights')); return false; }
  if(status === 'approved' && submission){
    await applySubmissionToContributor(submission, submission.parsed_json);
    await removeLegacyTopDuplicate(submission, submission.parsed_json);
  }
  showAdminNotice(status === 'approved' ? '✓ Soumission validée et prise en compte.' : '✓ Soumission rejetée et prise en compte.', true);
  loadSubmissions();
  renderDashboard(true);
  return true;
}

function showSubmissionsError(msg){
  var el = document.getElementById('submissions-error');
  if(!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

// ═══════════════════════════════════════════════════════════════
// PROPOSITIONS CINÉASTES
// ═══════════════════════════════════════════════════════════════
async function loadProposals(){
  var container = document.getElementById('propositions-list');
  container.innerHTML = '<div class="empty-state">' + t('adm_loading') + '</div>';

  var res;
  try {
    res = await tcWithRetryTimeout(function(){
      return sb.from('cineaste_proposals')
        .select('*, cineaste_proposal_votes(contributor_id, contributors(display_name))')
        .order('submitted_at', { ascending: false })
        .limit(100);
    });
  } catch(err){
    container.innerHTML = '<div class="empty-state">' + t('adm_err_prefix') + escapeHtml(friendlyError(err)) + '</div>'; return;
  }

  if(res.error){ container.innerHTML = '<div class="empty-state">' + t('adm_err_prefix') + escapeHtml(friendlyError(res.error)) + '</div>'; return; }
  if(!res.data || !res.data.length){ container.innerHTML = '<div class="empty-state">' + t('adm_no_proposal') + '</div>'; return; }

  container.innerHTML = '';
  res.data.forEach(function(p){
    var votes = p.cineaste_proposal_votes || [];
    var voterNames = votes.map(function(v){ return v.contributors && v.contributors.display_name ? v.contributors.display_name : '?'; });
    var nomComplet = (p.prenom ? p.prenom + ' ' : '') + p.nom;
    var annees = [];
    if(p.annee_naissance) annees.push(t('adm_born_in', p.annee_naissance));
    if(p.annee_deces) annees.push(t('adm_died_in', p.annee_deces));

    var card = document.createElement('div'); card.className = 'prop-card';

    var nameEl = document.createElement('div'); nameEl.className = 'prop-card-name'; nameEl.textContent = nomComplet;
    var metaEl = document.createElement('div'); metaEl.className = 'prop-card-meta'; metaEl.textContent = annees.length ? annees.join(', ') : t('adm_years_unknown');

    var footer = document.createElement('div'); footer.className = 'prop-card-footer';

    var voteCountEl = document.createElement('span'); voteCountEl.className = 'prop-vote-count';
    voteCountEl.textContent = '▲ ' + votes.length + ' vote' + (votes.length !== 1 ? 's' : '');

    var votersEl = document.createElement('span'); votersEl.className = 'prop-voters';
    votersEl.textContent = voterNames.length ? voterNames.join(', ') : t('adm_no_vote');

    var byEl = document.createElement('span'); byEl.className = 'prop-by';
    byEl.textContent = 'par ' + (p.contributor_name || '?');

    var actionsEl = document.createElement('div'); actionsEl.className = 'prop-actions';

    if(p.status === 'pending'){
      var approveBtn = document.createElement('button'); approveBtn.className = 'prop-btn-approve'; approveBtn.textContent = t('adm_prop_approve');
      var rejectBtn = document.createElement('button'); rejectBtn.className = 'prop-btn-reject'; rejectBtn.textContent = t('adm_prop_reject');
      // CORRECTIF BUG D : confirmation avant approbation/rejet d'une proposition
      approveBtn.addEventListener('click', function(){
        showConfirmModal(t('adm_confirm_prop_approve', nomComplet), function(){
          updateProposal(p, 'approved', approveBtn, rejectBtn);
        });
      });
      rejectBtn.addEventListener('click', function(){
        showConfirmModal(t('adm_confirm_prop_reject', nomComplet), function(){
          updateProposal(p, 'rejected', approveBtn, rejectBtn);
        });
      });
      actionsEl.appendChild(approveBtn); actionsEl.appendChild(rejectBtn);
    } else {
      var badge = document.createElement('span');
      badge.className = 'prop-status-badge ' + p.status;
      badge.textContent = p.status === 'approved' ? t('adm_prop_approved') : t('adm_prop_rejected');
      actionsEl.appendChild(badge);
    }

    footer.appendChild(voteCountEl); footer.appendChild(votersEl); footer.appendChild(byEl); footer.appendChild(actionsEl);
    card.appendChild(nameEl); card.appendChild(metaEl); card.appendChild(footer);
    container.appendChild(card);
  });
}

// Construit le "nom" au format de la table cineastes : "NOM, Prénom"
// (ou "NOM" seul si pas de prénom). p.nom est déjà en majuscules (cf. submit).
function cineasteNomFromProposal(p){
  var nom = (p.nom || '').trim();
  var prenom = (p.prenom || '').trim();
  return prenom ? (nom + ', ' + prenom) : nom;
}

// Insère le cinéaste validé dans la table "cineastes".
// Retourne { inserted } | { skipped, nom } | { error, nom }.
// NB : "Ordre" reçoit une valeur provisoire (max+1). L'ordre définitif
// (alignement alphabétique avec ton Excel) se recale via la requête SQL de
// renumérotation, à lancer après un lot d'ajouts.
async function insertCineasteFromProposal(p){
  var nom = cineasteNomFromProposal(p);
  if(!nom) return { error: { message: 'Nom vide.' }, nom: nom };

  // Anti-doublon : ne pas recréer un cinéaste déjà présent.
  var dup = await tcWithRetryTimeout(function(){ return sb.from('cineastes').select('id').eq('nom', nom).limit(1); });
  if(dup && dup.error) return { error: dup.error, nom: nom };
  if(dup && dup.data && dup.data.length) return { skipped: true, nom: nom };

  // Ordre provisoire = max(Ordre)+1 (non nul, pour respecter un éventuel NOT NULL).
  var nextOrdre = null;
  var maxRes = await tcWithRetryTimeout(function(){ return sb.from('cineastes').select('Ordre').order('Ordre', { ascending: false }).limit(1); });
  if(maxRes && maxRes.data && maxRes.data[0] && typeof maxRes.data[0].Ordre === 'number') nextOrdre = maxRes.data[0].Ordre + 1;

  var row = {
    nom: nom,
    naissance: p.annee_naissance || null,
    deces: p.annee_deces || null,
    vivant: p.annee_deces ? false : true,
    duo: false,
    tops_contributeurs: [],
    pays: null
  };
  if(nextOrdre !== null) row.Ordre = nextOrdre;

  // INSERT non-idempotent : timeout sans relance auto (évite un doublon).
  var ins = await tcWithRetryTimeout(function(){ return sb.from('cineastes').insert(row).select('id'); }, { retries: 0 });
  if(ins && ins.error) return { error: ins.error, nom: nom };
  if(!ins || !ins.data || !ins.data.length) return { error: { message: 'droits insuffisants (policy INSERT sur cineastes ?)' }, nom: nom };
  return { inserted: true, nom: nom };
}

async function updateProposal(p, status, approveBtn, rejectBtn){
  var id = p.id;
  approveBtn.disabled = true; rejectBtn.disabled = true;
  var res;
  try {
    // UPDATE idempotent (statut fixe) : timeout/retry sûr.
    res = await tcWithRetryTimeout(function(){ return sb.from('cineaste_proposals').update({ status: status, reviewed_at: new Date().toISOString() }).eq('id', id).select('id'); });
  } catch(err){
    showAdminNotice(t('adm_err_unexpected') + friendlyError(err), false);
    approveBtn.disabled = false; rejectBtn.disabled = false; return;
  }
  if(res.error){ showAdminNotice(t('adm_err_prefix') + friendlyError(res.error), false); approveBtn.disabled = false; rejectBtn.disabled = false; return; }
  if(!res.data || !res.data.length){ showAdminNotice(t('adm_prop_rights'), false); approveBtn.disabled = false; rejectBtn.disabled = false; return; }

  if(status === 'rejected'){
    showAdminNotice('✓ Proposition rejetée et prise en compte.', true);
    loadProposals();
    return;
  }

  // Validation : on crée aussi le cinéaste dans l'index.
  var r;
  try {
    r = await insertCineasteFromProposal(p);
  } catch(err){
    showAdminNotice('Proposition approuvée, mais l\'ajout du cinéaste a échoué : ' + friendlyError(err), false);
    loadProposals();
    return;
  }
  if(r.skipped){
    showAdminNotice('✓ Proposition approuvée. Le cinéaste « ' + r.nom + ' » existait déjà dans l\'index.', true);
  } else if(r.error){
    showAdminNotice('Proposition approuvée, mais l\'ajout de « ' + r.nom + ' » a échoué : ' + friendlyError(r.error), false);
  } else {
    showAdminNotice('✓ Proposition approuvée et cinéaste « ' + r.nom + ' » ajouté à l\'index. Pense à relancer la renumérotation « Ordre » après tes ajouts.', true);
  }
  loadProposals();
}

// ═══════════════════════════════════════════════════════════════
// MODÉRATION DES COMMENTAIRES
// ═══════════════════════════════════════════════════════════════
// CORRECTIF BUG 5 : commentsAdminLoaded est désormais vérifié pour éviter
// les rechargements inutiles à chaque clic sur l'onglet.
// Passer force=true pour forcer le rechargement (ex: après suppression).
var commentsAdminLoaded = false;

async function loadCommentsAdmin(force){
  if(!force && commentsAdminLoaded) return; // CORRECTIF BUG 5 : guard anti-rechargement

  var container = document.getElementById('comments-list');
  var errEl = document.getElementById('comments-error');
  errEl.style.display = 'none';
  container.innerHTML = '<div class="empty-state">' + t('adm_loading') + '</div>';

  try {
    var contribRes = await tcWithRetryTimeout(function(){ return sb.from('contributors').select('id, json_name, display_name'); });
    var nameById = {};
    if(contribRes.error){
      var errMsg = t('adm_contrib_load_err') + friendlyError(contribRes.error);
      errEl.textContent = errMsg;
      errEl.style.display = 'block';
      // CORRECTIF BUG B : affichage de l'erreur dans le container également
      container.innerHTML = '<div class="empty-state">' + escapeHtml(errMsg) + '</div>';
      return;
    }
    (contribRes.data || []).forEach(function(c){ nameById[c.id] = c.display_name || c.json_name || ('#' + c.id); });

    var res = await tcWithRetryTimeout(function(){ return sb.from('comments').select('*').order('created_at', { ascending: false }).limit(200); });
    if(res.error){
      var errMsg2 = t('adm_cm_load_err') + friendlyError(res.error);
      errEl.textContent = errMsg2;
      errEl.style.display = 'block';
      // CORRECTIF BUG B : affichage de l'erreur dans le container également
      container.innerHTML = '<div class="empty-state">' + escapeHtml(errMsg2) + '</div>';
      return;
    }
    commentsAdminLoaded = true;
    renderCommentsAdmin(res.data || [], nameById);
  } catch(err) {
    var errMsg3 = t('adm_err_load') + friendlyError(err);
    errEl.textContent = errMsg3;
    errEl.style.display = 'block';
    // CORRECTIF BUG B : affichage de l'erreur dans le container également
    container.innerHTML = '<div class="empty-state">' + escapeHtml(errMsg3) + '</div>';
  }
}

function renderCommentsAdmin(rows, nameById){
  var container = document.getElementById('comments-list');
  container.innerHTML = '';
  if(!rows.length){ container.innerHTML = '<p>' + t('adm_no_comment') + '</p>'; return; }
  rows.forEach(function(cm){
    var card = document.createElement('div'); card.className = 'cm-card';
    var meta = document.createElement('div'); meta.className = 'cm-card-meta';
    meta.innerHTML = '<b>' + escapeHtml(nameById[cm.author_contributor_id] || '?') + '</b>'
      + ' — top de <b>' + escapeHtml(nameById[cm.top_contributor_id] || '?') + '</b> sur <b>' + escapeHtml(cm.cineaste_nom) + '</b>'
      + (cm.parent_comment_id ? ' (réponse)' : '')
      + ' — ' + new Date(cm.created_at).toLocaleString('fr-FR');
    var body = document.createElement('div'); body.className = 'cm-card-body'; body.textContent = cm.body;
    var footer = document.createElement('div'); footer.className = 'cm-card-footer';
    var delBtn = document.createElement('button'); delBtn.className = 'cm-btn-delete'; delBtn.textContent = t('adm_cm_delete');
    delBtn.addEventListener('click', function(){ deleteCommentAdmin(cm.id, delBtn); });
    footer.appendChild(delBtn);
    card.appendChild(meta); card.appendChild(body); card.appendChild(footer);
    container.appendChild(card);
  });
}

function deleteCommentAdmin(id, delBtn){
  // Confirmation via la modale cohérente du site (au lieu de confirm() natif).
  showConfirmModal(t('adm_cm_confirm'), async function(){
    delBtn.disabled = true;
    var res;
    try {
      // DELETE idempotent (par id) : timeout/retry sûr.
      res = await tcWithRetryTimeout(function(){ return sb.from('comments').delete().eq('id', id).select('id'); });
    } catch(err){
      showAdminNotice(t('adm_err_unexpected') + friendlyError(err), false);
      delBtn.disabled = false; return;
    }
    if(res.error){ showAdminNotice(t('adm_err_prefix') + friendlyError(res.error), false); delBtn.disabled = false; return; }
    if(!res.data || !res.data.length){ showAdminNotice(t('adm_cm_err_rights'), false); delBtn.disabled = false; return; }
    showAdminNotice('✓ Commentaire supprimé.', true);
    commentsAdminLoaded = false; // CORRECTIF BUG 5 : réinitialise le guard pour forcer le rechargement
    loadCommentsAdmin(true);
  });
}

// ═══════════════════════════════════════════════════════════════
// DRAPEAUX DE NATIONALITÉ
// ═══════════════════════════════════════════════════════════════
var flagsSearchTerm = '';

function flagsCountrySelectHtml(currentCode){
  var groups = tcCountrySelectOptions();
  var html = '<option value=""' + (!currentCode ? ' selected' : '') + '>—</option>';
  html += '<optgroup label="' + t('adm_flags_countries') + '">';
  groups.iso.forEach(function(o){
    html += '<option value="' + o.code + '"' + (currentCode === o.code ? ' selected' : '') + '>' + escapeHtml(o.label) + '</option>';
  });
  html += '</optgroup><optgroup label="' + t('adm_flags_historic') + '">';
  groups.historic.forEach(function(o){
    html += '<option value="' + o.code + '"' + (currentCode === o.code ? ' selected' : '') + '>' + escapeHtml(o.label) + '</option>';
  });
  html += '</optgroup>';
  return html;
}

function renderFlagsAdmin(){
  var tbody = document.getElementById('flags-tbody');
  var errEl = document.getElementById('flags-error');
  errEl.style.display = 'none';
  if(!DATA || !DATA.cineastes){ tbody.innerHTML = '<tr><td colspan="3">' + t('adm_loading') + '</td></tr>'; return; }

  var term = normStr(flagsSearchTerm.trim());
  // CORRECTIF BUG C : sans recherche, limité à 200 pour éviter le gel du navigateur
  // (2000+ lignes × selects pays = centaines de milliers d'éléments DOM).
  // Avec une recherche, tous les résultats sont affichés.
  var allFiltered = DATA.cineastes
    .filter(function(c){ return !term || normStr(c.nom).indexOf(term) !== -1; })
    .sort(function(a,b){ return a.nom.localeCompare(b.nom,'fr'); });
  var limited = !term;
  var rows = limited ? allFiltered.slice(0, 200) : allFiltered;

  tbody.innerHTML = '';
  if(!rows.length){ tbody.innerHTML = '<tr><td colspan="3">' + t('adm_flags_no_result') + '</td></tr>'; return; }
  if(limited && allFiltered.length > 200){
    errEl.textContent = t('adm_flags_limit');
    errEl.style.display = 'block';
  }

  rows.forEach(function(c){
    var tr = document.createElement('tr');

    var tdName = document.createElement('td');
    tdName.textContent = c.nom;

    var tdFlag = document.createElement('td');
    var select = document.createElement('select');
    select.className = 'contrib-select';
    select.innerHTML = flagsCountrySelectHtml(c.pays || '');

    var tdAction = document.createElement('td');
    var saveBtn = document.createElement('button');
    saveBtn.className = 'btn-secondary';
    saveBtn.textContent = t('adm_flags_save');
    saveBtn.addEventListener('click', function(){ saveCineasteFlag(c, select.value, saveBtn); });

    tdFlag.appendChild(select);
    tdAction.appendChild(saveBtn);
    tr.appendChild(tdName); tr.appendChild(tdFlag); tr.appendChild(tdAction);
    tbody.appendChild(tr);
  });
}

async function saveCineasteFlag(c, code, saveBtn){
  var errEl = document.getElementById('flags-error');
  errEl.style.display = 'none';
  saveBtn.disabled = true;
  saveBtn.textContent = t('adm_flags_saving');
  var newVal = code || null;
  // Filet de sécurité : si la Promise ne se résout jamais (ex: token JWT expiré
  // et refresh silencieusement bloqué), on débloque le bouton après 20s.
  var _done = false;
  var _safety = setTimeout(function(){
    if(_done) return;
    _done = true;
    console.error('saveCineasteFlag: timeout de sécurité (20s) pour "' + c.nom + '"');
    errEl.textContent = 'La connexion a expiré pour "' + c.nom + '". Rechargez la page et réessayez.';
    errEl.style.display = 'block';
    saveBtn.disabled = false;
    saveBtn.textContent = t('adm_flags_save');
  }, 20000);
  try {
    var res = await tcWithRetryTimeout(function(){
      return sb.from('cineastes').update({ pays: newVal }).eq('nom', c.nom).select('nom');
    });
    if(_done) return;
    _done = true;
    clearTimeout(_safety);
    if(res.error){
      errEl.textContent = t('adm_flags_save_err', [c.nom, friendlyError(res.error)]);
      errEl.style.display = 'block';
      saveBtn.textContent = t('adm_flags_err_mark');
      setTimeout(function(){ saveBtn.textContent = t('adm_flags_save'); }, 2500);
      return;
    }
    if(!res.data || !res.data.length){
      errEl.textContent = t('adm_flags_update_err', c.nom);
      errEl.style.display = 'block';
      saveBtn.textContent = t('adm_flags_err_mark');
      setTimeout(function(){ saveBtn.textContent = t('adm_flags_save'); }, 2500);
      return;
    }
    c.pays = newVal;
    saveBtn.textContent = t('adm_flags_saved');
    showAdminNotice('✓ Pays enregistré pour « ' + c.nom + ' ».', true);
    setTimeout(function(){ saveBtn.textContent = t('adm_flags_save'); }, 1500);
  } catch(err) {
    if(_done) return;
    _done = true;
    clearTimeout(_safety);
    errEl.textContent = t('adm_err_unexpected') + friendlyError(err);
    errEl.style.display = 'block';
    saveBtn.textContent = t('adm_flags_err_mark');
    setTimeout(function(){ saveBtn.textContent = t('adm_flags_save'); }, 2500);
  } finally {
    saveBtn.disabled = false;
  }
}

document.getElementById('flags-search').addEventListener('input', function(e){
  flagsSearchTerm = e.target.value;
  renderFlagsAdmin();
});


// ═══════════════════════════════════════════════════════════════
// TOPS THÉMATIQUES — Modération admin
// ═══════════════════════════════════════════════════════════════

var _thematicFilter = 'pending'; // filtre actif

// Filtres
document.querySelectorAll('[data-thematic-filter]').forEach(function(btn){
  btn.addEventListener('click', function(){
    _thematicFilter = btn.getAttribute('data-thematic-filter');
    document.querySelectorAll('[data-thematic-filter]').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    loadThematicTops();
  });
});

async function loadThematicTops(){
  var listEl = document.getElementById('thematiques-list');
  var errEl = document.getElementById('thematiques-error');
  if(!listEl) return;
  listEl.innerHTML = '<div class="empty-state">Chargement…</div>';
  if(errEl) errEl.style.display = 'none';

  var res;
  try {
    res = await tcWithRetryTimeout(function(){
      return sb.from('thematic_tops')
        .select('*, contributors(display_name)')
        .eq('status', _thematicFilter)
        .order('submitted_at', { ascending: false });
    });
  } catch(err){
    if(errEl){ errEl.textContent = 'Erreur de chargement : ' + (err && err.message ? err.message : err); errEl.style.display = 'block'; }
    listEl.innerHTML = '';
    return;
  }

  if(res.error){
    if(errEl){ errEl.textContent = 'Erreur : ' + res.error.message; errEl.style.display = 'block'; }
    listEl.innerHTML = '';
    return;
  }

  renderThematicTops(res.data || []);
}

function renderThematicTops(rows){
  var listEl = document.getElementById('thematiques-list');
  listEl.innerHTML = '';
  if(!rows.length){
    listEl.innerHTML = '<div class="empty-state">Aucune soumission.</div>';
    return;
  }
  rows.forEach(function(row){
    listEl.appendChild(buildThematicCard(row));
  });
}

function buildThematicCard(row){
  var card = document.createElement('div');
  card.className = 'submission-card ' + (row.status || 'pending');

  var contribName = row.contributors && row.contributors.display_name ? row.contributors.display_name : '?';
  var films = Array.isArray(row.films) ? row.films : [];
  var date = row.submitted_at ? new Date(row.submitted_at).toLocaleDateString('fr-FR') : '?';

  var statusLabels = { pending: 'En attente', approved: 'Validé', rejected: 'Refusé' };
  var statusLabel = statusLabels[row.status] || row.status;

  var header = document.createElement('div');
  header.className = 'submission-header';
  header.innerHTML = '<div class="submission-info">'
    + '<div class="submission-names">'
    + '<span class="submission-contrib">' + escapeHtml(contribName) + '</span>'
    + '<span class="submission-names-sep">→</span>'
    + '<span class="submission-cineaste-nom">' + escapeHtml(row.theme_nom) + '</span>'
    + '</div>'
    + '<div class="submission-meta">' + date + '</div>'
    + '</div>'
    + '<span class="submission-status ' + (row.status||'pending') + '">' + statusLabel + '</span>';

  var body = document.createElement('div');
  body.className = 'submission-body';
  var filmsHtml = '<ul class="submission-films">'
    + films.map(function(f){
        var titre = typeof f === 'string' ? f : (f.titre || '');
        var annee = f.annee ? ' (' + f.annee + ')' : '';
        return '<li>' + escapeHtml(titre + annee) + '</li>';
      }).join('')
    + '</ul>';

  var actionsHtml = '';
  if(row.status === 'pending'){
    actionsHtml = '<div class="submission-actions">'
      + '<button class="btn-approve" data-id="' + row.id + '">Valider</button>'
      + '<button class="btn-reject" data-id="' + row.id + '">Rejeter</button>'
      + '</div>';
  }

  body.innerHTML = filmsHtml + actionsHtml;

  header.addEventListener('click', function(){
    body.classList.toggle('visible');
  });

  if(row.status === 'pending'){
    body.querySelector('.btn-approve').addEventListener('click', function(e){
      e.stopPropagation();
      approveThematic(row.id);
    });
    body.querySelector('.btn-reject').addEventListener('click', function(e){
      e.stopPropagation();
      rejectThematic(row.id, contribName);
    });
  }

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

async function approveThematic(id){
  var res;
  try {
    res = await tcWithRetryTimeout(function(){
      return sb.from('thematic_tops').update({ status: 'approved', reviewed_at: new Date().toISOString() }).eq('id', id).select('id');
    });
  } catch(err){ showAdminNotice('Erreur : ' + (err && err.message ? err.message : err), false); return; }
  if(res.error){ showAdminNotice('Erreur : ' + res.error.message, false); return; }
  showAdminNotice('Top thématique validé.', true);
  loadThematicTops();
}

async function rejectThematic(id, contribName){
  var msg = 'Confirmer le rejet du top thématique de ' + contribName + ' ?';
  if(!confirm(msg)) return;
  var res;
  try {
    res = await tcWithRetryTimeout(function(){
      return sb.from('thematic_tops').update({ status: 'rejected', reviewed_at: new Date().toISOString() }).eq('id', id).select('id');
    });
  } catch(err){ showAdminNotice('Erreur : ' + (err && err.message ? err.message : err), false); return; }
  if(res.error){ showAdminNotice('Erreur : ' + res.error.message, false); return; }
  showAdminNotice('Top thématique rejeté.', true);
  loadThematicTops();
}
