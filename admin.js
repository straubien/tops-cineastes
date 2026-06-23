// ═══════════════════════════════════════════════════════════════
// CONFIG SUPABASE
// ═══════════════════════════════════════════════════════════════
var sb = supabase.createClient(TC_SUPABASE_URL, TC_SUPABASE_KEY);

var currentUser = null;
var currentContributor = null;
var DATA = null;
var cineastesIndex = [];
var selectedCineaste = null;
var parsedFilms = null;

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
(async function(){
  var session = (await sb.auth.getSession()).data.session;
  if(session) await onLogin(session.user);
  sb.auth.onAuthStateChange(async function(ev, sess){
    if(ev === 'SIGNED_IN' && sess) await onLogin(sess.user);
    if(ev === 'SIGNED_OUT') onLogout();
  });
})();

// Charger cineastes.json
fetch('cineastes.json')
  .then(function(r){ return r.json(); })
  .then(function(d){
    DATA = d;
    cineastesIndex = d.cineastes.map(function(c){ return c.nom; });
    if(currentUser){ renderDashboard(); populateContribSelect(); }
  });

// ═══════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════
document.getElementById('btn-login').addEventListener('click', login);
document.getElementById('btn-logout').addEventListener('click', function(){ sb.auth.signOut(); });

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
    noFields: 'Veuillez remplir les deux champs.',
    connecting: 'Connexion…',
    loginBtn: 'Se connecter',
    loginError: 'Email ou mot de passe incorrect.'
  });
}

async function onLogin(user){
  currentUser = user;
  var res = await sb.from('contributors').select('*').eq('auth_id', user.id).single();
  if(res.error || !res.data){
    showError("Compte non lié à un profil contributeur.");
    await sb.auth.signOut();
    return;
  }
  if(!res.data.is_admin){
    showError("Accès refusé : droits d'administration requis.");
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
function startDashboardAutoRefresh(){
  if(dashboardRefreshInterval) clearInterval(dashboardRefreshInterval);
  dashboardRefreshInterval = setInterval(function(){
    if(currentUser) renderDashboard();
  }, 30000);
}

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
    if(tab.getAttribute('data-tab') === 'comments') loadCommentsAdmin();
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

// ── Total de tops dans l'index (saisi à la main, indépendant de cineastes.json) ──
var TOTAL_TOPS_INDEX_MANUEL = 14077;
var TOTAL_CINEASTES_INDEX_MANUEL = 2904;

async function renderDashboard(){
  if(!DATA) return;

  // Tops dans l'index : valeur saisie à la main (cf. TOTAL_TOPS_INDEX_MANUEL),
  // car cineastes.json n'est pas synchronisé automatiquement avec Supabase.
  document.getElementById('dash-total-tops').textContent = TOTAL_TOPS_INDEX_MANUEL.toLocaleString('fr-FR');
  document.getElementById('dash-total-cineastes').textContent = TOTAL_CINEASTES_INDEX_MANUEL.toLocaleString('fr-FR') + ' cinéastes indexés';

  // Soumissions pending
  var pendingRes = await sb.from('submissions').select('id', { count: 'exact', head: true }).eq('status', 'pending');
  var nPending = pendingRes.count || 0;
  document.getElementById('dash-pending-count').textContent = nPending > 0
    ? nPending + ' soumission' + (nPending > 1 ? 's' : '') + ' en attente'
    : 'Aucune soumission en attente';

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
    var muz = await fetch('muzard.json').then(function(r){ return r.json(); });
    importedCounts['MATHIEU MUZARD'] = Array.isArray(muz.tops) ? muz.tops.length : Object.keys(muz.tops||{}).length;
  } catch(e) { importedCounts['MATHIEU MUZARD'] = 0; jsonWarnings.push('muzard.json'); }

  try {
    var cnd = await fetch('cnudde.json').then(function(r){ return r.json(); });
    importedCounts['KARINE CNUDDE'] = Array.isArray(cnd.tops) ? cnd.tops.length : Object.keys(cnd.tops||{}).length;
  } catch(e) { importedCounts['KARINE CNUDDE'] = 0; jsonWarnings.push('cnudde.json'); }

  var contribIdToName = {};
  var contribListRes = await sb.from('contributors').select('id, json_name, display_name');
  if(contribListRes.data){
    contribListRes.data.forEach(function(c){
      if(c.id) contribIdToName[c.id] = c.json_name || (c.display_name ? c.display_name.toUpperCase() : null);
    });
  }

  var subRes = await sb.from('submissions').select('*, contributors(display_name)').eq('status', 'approved');
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

  if(jsonWarnings.length){
    var warnEl = document.getElementById('dash-json-warning');
    if(warnEl) warnEl.textContent = '⚠ Fichier(s) JSON inaccessible(s) : ' + jsonWarnings.join(', ') + ' — comptages partiels.';
  }

  // Total importe global
  var totalImporte = Object.values(importedCounts).reduce(function(a,b){return a+b;}, 0);
  var pctGlobal = Math.round((totalImporte / TOTAL_ATTENDU_GLOBAL) * 100);
  document.getElementById('dash-total-contribs').textContent = totalImporte.toLocaleString('fr-FR') + ' / ' + TOTAL_ATTENDU_GLOBAL.toLocaleString('fr-FR');
  document.getElementById('dash-pending-count').textContent =
    pctGlobal + ' % importés' + (nPending > 0 ? ' · ' + nPending + ' soumission' + (nPending>1?'s':'') + ' en attente' : '');

  // Afficher les lignes contributeurs
  var container = document.getElementById('contrib-dashboard');
  container.innerHTML = '';

  var contribs = Object.keys(TOTAUX_ATTENDUS).map(function(name){
    return {
      name: name,
      attendu: TOTAUX_ATTENDUS[name],
      importe: importedCounts[name] || 0
    };
  }).sort(function(a,b){ return b.attendu - a.attendu; });

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
            ? '<span class="done">' + c.importe + ' / ' + c.attendu + ' ✓</span>'
            : c.importe + ' / ' + c.attendu)
        + '</div>'
      + '</div>';

    container.appendChild(row);
  });
}

// ═══════════════════════════════════════════════════════════════
// IMPORT MANUEL
// ═══════════════════════════════════════════════════════════════
function populateContribSelect(){
  if(!DATA) return;
  var sel = document.getElementById('import-contrib');
  // Uniquement depuis cineastes.json — pas de doublon possible
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

  if(!contrib){ showImportError('Sélectionnez un contributeur.'); return; }
  if(!cineaste){ showImportError('Sélectionnez un cinéaste.'); return; }
  if(!texte){ showImportError('Collez le commentaire.'); return; }
  showImportError('');

  parsedFilms = parseTopsBrut(texte);
  if(!parsedFilms.length){
    showImportError('Aucun film détecté. Vérifiez le format (lignes numérotées).');
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
    warn.textContent = sansAnnee + ' film' + (sansAnnee > 1 ? 's' : '') + ' sans année.';
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
  btn.innerHTML = '<span class="spinner"></span>Enregistrement…';

  try{
    // Résoudre le contributor_id depuis la table contributors
    var contribId = null;
    var contribRes = await sb.from('contributors').select('id').ilike('json_name', contrib).maybeSingle();
    if(contribRes.data) contribId = contribRes.data.id;
    if(!contribId){
      contribRes = await sb.from('contributors').select('id').ilike('display_name', contrib).maybeSingle();
      if(contribRes.data) contribId = contribRes.data.id;
    }

    if(!contribId){
      btn.disabled = false;
      btn.textContent = 'Enregistrer dans Supabase';
      showImportError('Contributeur "' + contrib + '" introuvable dans la table contributors.');
      return;
    }

    var res = await sb.from('submissions').insert({
      contributor_id: contribId,
      raw_text: rawText,
      parsed_json: { cineaste: cineaste, films: parsedFilms },
      status: 'approved'
    }).select('id');

    btn.disabled = false;
    btn.textContent = 'Enregistrer dans Supabase';

    if(res.error){
      showImportError('Erreur : ' + friendlyError(res.error));
      return;
    }
    if(!res.data || !res.data.length){
      showImportError('L\'enregistrement n\'a pas abouti — vérifiez les droits de la table submissions.');
      return;
    }

    document.getElementById('import-result').classList.remove('visible');
    document.getElementById('import-success').classList.add('visible');
    loadSubmissions();
  }catch(err){
    console.error('Erreur lors de l\'enregistrement:', err);
    btn.disabled = false;
    btn.textContent = 'Enregistrer dans Supabase';
    showImportError('Erreur inattendue : ' + friendlyError(err));
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
  noBtn.textContent = 'Annuler';
  var yesBtn = document.createElement('button');
  yesBtn.className = 'confirm-btn-yes';
  yesBtn.textContent = 'Confirmer';
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
// Labels et couleurs par type
var TYPE_LABELS = {
  top: 'Top', favoris: 'Cinéastes ❤',
  autres_cineastes: 'Autres cinéastes',
  films_favoris: 'Films ❤', autres_films: 'Autres films',
  presentation: 'Présentation'
};

var currentFilter = 'pending';
var allSubmissions = [];

// Detection "Nouveau" / "Modification" pour les soumissions de type "top" :
// on regarde si le couple (contributeur, cinéaste) existe déjà dans la table
// "tops" (legacy) ou dans une autre soumission déjà approuvée.
var legacyTopsKeys = null; // Set de "contributor_id|cineaste_nom"
var approvedTopSubsByKey = {}; // "contributor_id|cineaste" -> [submission ids]

function topKey(contributorId, cineaste){ return contributorId + '|' + cineaste; }

function loadLegacyTopsKeys(offset, pageSize){
  return sb.from('tops').select('contributor_id, cineaste_nom')
    .order('id', { ascending: true })
    .range(offset, offset + pageSize - 1)
    .then(function(res){
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
  await loadLegacyTopsKeys(0, 1000);

  var res = await sb.from('submissions').select('id, contributor_id, parsed_json').eq('status', 'approved');
  (res.data || []).forEach(function(s){
    var type = (s.parsed_json && s.parsed_json.type) || 'top';
    var cineaste = s.parsed_json && s.parsed_json.cineaste;
    if(type !== 'top' || !s.contributor_id || !cineaste) return;
    var key = topKey(s.contributor_id, cineaste);
    if(!approvedTopSubsByKey[key]) approvedTopSubsByKey[key] = [];
    approvedTopSubsByKey[key].push(s.id);
  });
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
    var type = (s.parsed_json && s.parsed_json.type) || 'top';
    return type === currentFilter;
  });
  container.innerHTML = '';
  if(!filtered.length){
    container.innerHTML = '<div class="empty-state">Aucune soumission</div>';
    return;
  }
  filtered.forEach(function(s){ buildSubmissionCard(s, container); });
}

function buildSubmissionCard(s, container){
  var type = (s.parsed_json && s.parsed_json.type) || 'top';
  var typeLabel = TYPE_LABELS[type] || type;
  var contribName = s.contributor_name || '—';
  var date = new Date(s.submitted_at).toLocaleDateString('fr-FR');
  var statusLabel = {pending: 'En attente', approved: 'Validé', rejected: 'Refusé'}[s.status] || s.status;
  var cardId = 'sub-' + s.id;

  // Sous-titre selon le type
  var subtitle = '';
  if(type === 'top'){
    var cineaste = s.parsed_json && s.parsed_json.cineaste ? s.parsed_json.cineaste : '—';
    var nbFilms = s.parsed_json && s.parsed_json.films ? s.parsed_json.films.length : 0;
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
    modifBadge.textContent = isModif ? 'Modification' : 'Nouveau';
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
    editBtn.textContent = 'Modifier avant validation';
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
      editBtn.textContent = editZone.classList.contains('visible') ? "Fermer l'éditeur" : "Modifier avant validation";
    });

    editZone.appendChild(editTextarea);
    body.appendChild(editBtn);
    body.appendChild(editZone);

    // Actions valider/rejeter
    var actionsDiv = document.createElement('div');
    actionsDiv.className = 'submission-actions';

    var approveBtn = document.createElement('button');
    approveBtn.className = 'btn-approve';
    approveBtn.textContent = 'Valider';
    approveBtn.addEventListener('click', function(e){
      e.stopPropagation();
      var cineasteTxt = s.parsed_json && s.parsed_json.cineaste;
      var confirmMsg = (type === 'top' && cineasteTxt)
        ? 'Confirmer la validation du top de ' + contribName + ' pour ' + cineasteTxt + ' ?'
        : 'Confirmer la validation de cette soumission de ' + contribName + ' ?';
      showConfirmModal(confirmMsg, async function(){
        approveBtn.disabled = true;
        approveBtn.textContent = 'Validation…';
        try{
          // Si editeur ouvert, sauvegarder
          var ok = editZone.classList.contains('visible')
            ? await updateSubmissionWithEdit(s.id, s, type, editTextarea.value)
            : await updateSubmission(s.id, 'approved', s);
          if(!ok){
            approveBtn.disabled = false;
            approveBtn.textContent = 'Valider';
          }
        }catch(err){
          console.error('Erreur lors de la validation:', err);
          showSubmissionsError('Erreur inattendue lors de la validation : ' + friendlyError(err));
          approveBtn.disabled = false;
          approveBtn.textContent = 'Valider';
        }
      });
    });

    var rejectBtn = document.createElement('button');
    rejectBtn.className = 'btn-reject';
    rejectBtn.textContent = 'Rejeter';
    rejectBtn.addEventListener('click', function(e){
      e.stopPropagation();
      updateSubmission(s.id, 'rejected');
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

  var res = await sb.from('submissions')
    .select('*, contributors(display_name)')
    .order('submitted_at', { ascending: false })
    .limit(50);

  var container = document.getElementById('submissions-list');
  if(res.error || !res.data || !res.data.length){
    allSubmissions = [];
    container.innerHTML = '<div class="empty-state">Aucune soumission</div>';
    return;
  }
  allSubmissions = res.data.map(function(s){
    s.contributor_name = (s.contributors && s.contributors.display_name) || s.contributor_name || '—';
    return s;
  });
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
  showSubmissionsError('');
  var res = await sb.from('submissions')
    .update({ status: 'approved', parsed_json: newParsedJson })
    .eq('id', id)
    .select('id');
  if(res.error){ console.error('Erreur approbation:', res.error.message); showSubmissionsError('Erreur lors de la validation : ' + friendlyError(res.error)); return false; }
  if(!res.data || !res.data.length){ showSubmissionsError('La validation n\'a pas abouti — vérifiez les droits de la table submissions.'); return false; }
  await applySubmissionToContributor(s, newParsedJson);
  await removeLegacyTopDuplicate(s, newParsedJson);
  loadSubmissions();
  renderDashboard();
  return true;
}

async function removeLegacyTopDuplicate(submission, parsedJson){
  var type = (parsedJson && parsedJson.type) || 'top';
  var contributorId = submission && submission.contributor_id;
  var cineaste = parsedJson && parsedJson.cineaste;
  if(!contributorId || type !== 'top' || !cineaste) return;
  var res = await sb.from('tops').delete().eq('contributor_id', contributorId).eq('cineaste_nom', cineaste);
  if(res.error){ console.error('Erreur suppression doublon table tops:', res.error.message); }
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
  var res = await sb.from('contributors').update(update).eq('id', contributorId).select('id');
  if(res.error){ console.error('Erreur mise à jour profil contributeur:', res.error.message); showSubmissionsError('Erreur mise à jour profil : ' + friendlyError(res.error)); }
  else if(!res.data || !res.data.length){ console.error('Mise à jour profil contributeur : 0 lignes affectées'); showSubmissionsError('La mise à jour du profil contributeur n\'a pas abouti — vérifiez les droits de la table contributors.'); }
}

async function updateSubmission(id, status, submission){
  showSubmissionsError('');
  var update = { status: status };
  if(status === 'approved' && submission){
    var prevCount = (submission.parsed_json && submission.parsed_json.approvalCount) || 0;
    update.parsed_json = Object.assign({}, submission.parsed_json, { approvalCount: prevCount + 1 });
  }
  var res = await sb.from('submissions').update(update).eq('id', id).select('id');
  if(res.error){ console.error('Erreur mise à jour statut:', res.error.message); showSubmissionsError('Erreur lors de la mise à jour : ' + friendlyError(res.error)); return false; }
  if(!res.data || !res.data.length){ showSubmissionsError('La mise à jour n\'a pas abouti — vérifiez les droits de la table submissions.'); return false; }
  if(status === 'approved' && submission){
    await applySubmissionToContributor(submission, submission.parsed_json);
    await removeLegacyTopDuplicate(submission, submission.parsed_json);
  }
  loadSubmissions();
  renderDashboard();
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
  container.innerHTML = '<div class="empty-state">Chargement…</div>';

  var res = await sb.from('cineaste_proposals')
    .select('*, cineaste_proposal_votes(contributor_id, contributors(display_name))')
    .order('submitted_at', { ascending: false })
    .limit(100);

  if(res.error){ container.innerHTML = '<div class="empty-state">Erreur : ' + escapeHtml(friendlyError(res.error)) + '</div>'; return; }
  if(!res.data || !res.data.length){ container.innerHTML = '<div class="empty-state">Aucune proposition.</div>'; return; }

  container.innerHTML = '';
  res.data.forEach(function(p){
    var votes = p.cineaste_proposal_votes || [];
    var voterNames = votes.map(function(v){ return v.contributors && v.contributors.display_name ? v.contributors.display_name : '?'; });
    var nomComplet = (p.prenom ? p.prenom + ' ' : '') + p.nom;
    var annees = [];
    if(p.annee_naissance) annees.push('né en ' + p.annee_naissance);
    if(p.annee_deces) annees.push('décédé en ' + p.annee_deces);

    var card = document.createElement('div'); card.className = 'prop-card';

    var nameEl = document.createElement('div'); nameEl.className = 'prop-card-name'; nameEl.textContent = nomComplet;
    var metaEl = document.createElement('div'); metaEl.className = 'prop-card-meta'; metaEl.textContent = annees.length ? annees.join(', ') : 'Années non renseignées';

    var footer = document.createElement('div'); footer.className = 'prop-card-footer';

    var voteCountEl = document.createElement('span'); voteCountEl.className = 'prop-vote-count';
    voteCountEl.textContent = '▲ ' + votes.length + ' vote' + (votes.length !== 1 ? 's' : '');

    var votersEl = document.createElement('span'); votersEl.className = 'prop-voters';
    votersEl.textContent = voterNames.length ? voterNames.join(', ') : 'Aucun vote';

    var byEl = document.createElement('span'); byEl.className = 'prop-by';
    byEl.textContent = 'par ' + (p.contributor_name || '?');

    var actionsEl = document.createElement('div'); actionsEl.className = 'prop-actions';

    if(p.status === 'pending'){
      var approveBtn = document.createElement('button'); approveBtn.className = 'prop-btn-approve'; approveBtn.textContent = 'Approuver';
      var rejectBtn = document.createElement('button'); rejectBtn.className = 'prop-btn-reject'; rejectBtn.textContent = 'Rejeter';
      approveBtn.addEventListener('click', function(){ updateProposal(p.id, 'approved', approveBtn, rejectBtn); });
      rejectBtn.addEventListener('click', function(){ updateProposal(p.id, 'rejected', approveBtn, rejectBtn); });
      actionsEl.appendChild(approveBtn); actionsEl.appendChild(rejectBtn);
    } else {
      var badge = document.createElement('span');
      badge.className = 'prop-status-badge ' + p.status;
      badge.textContent = p.status === 'approved' ? 'Approuvé' : 'Rejeté';
      actionsEl.appendChild(badge);
    }

    footer.appendChild(voteCountEl); footer.appendChild(votersEl); footer.appendChild(byEl); footer.appendChild(actionsEl);
    card.appendChild(nameEl); card.appendChild(metaEl); card.appendChild(footer);
    container.appendChild(card);
  });
}

async function updateProposal(id, status, approveBtn, rejectBtn){
  approveBtn.disabled = true; rejectBtn.disabled = true;
  var res = await sb.from('cineaste_proposals').update({ status: status }).eq('id', id).select('id');
  if(res.error){ alert('Erreur : ' + friendlyError(res.error)); approveBtn.disabled = false; rejectBtn.disabled = false; return; }
  if(!res.data || !res.data.length){ alert('La mise à jour n\'a pas abouti — vérifiez les droits de la table cineaste_proposals.'); approveBtn.disabled = false; rejectBtn.disabled = false; return; }
  loadProposals();
}

// ═══════════════════════════════════════════════════════════════
// MODÉRATION DES COMMENTAIRES
// ═══════════════════════════════════════════════════════════════
var commentsAdminLoaded = false;

async function loadCommentsAdmin(){
  var container = document.getElementById('comments-list');
  var errEl = document.getElementById('comments-error');
  errEl.style.display = 'none';
  container.innerHTML = 'Chargement…';

  var contribRes = await sb.from('contributors').select('id, json_name, display_name');
  var nameById = {};
  (contribRes.data || []).forEach(function(c){ nameById[c.id] = c.display_name || c.json_name || ('#' + c.id); });

  var res = await sb.from('comments').select('*').order('created_at', { ascending: false }).limit(200);
  if(res.error){
    errEl.textContent = 'Erreur de chargement : ' + friendlyError(res.error);
    errEl.style.display = 'block';
    container.innerHTML = '';
    return;
  }
  commentsAdminLoaded = true;
  renderCommentsAdmin(res.data || [], nameById);
}

function renderCommentsAdmin(rows, nameById){
  var container = document.getElementById('comments-list');
  container.innerHTML = '';
  if(!rows.length){ container.innerHTML = '<p>Aucun commentaire.</p>'; return; }
  rows.forEach(function(cm){
    var card = document.createElement('div'); card.className = 'cm-card';
    var meta = document.createElement('div'); meta.className = 'cm-card-meta';
    meta.innerHTML = '<b>' + escapeHtml(nameById[cm.author_contributor_id] || '?') + '</b>'
      + ' — top de <b>' + escapeHtml(nameById[cm.top_contributor_id] || '?') + '</b> sur <b>' + escapeHtml(cm.cineaste_nom) + '</b>'
      + (cm.parent_comment_id ? ' (réponse)' : '')
      + ' — ' + new Date(cm.created_at).toLocaleString('fr-FR');
    var body = document.createElement('div'); body.className = 'cm-card-body'; body.textContent = cm.body;
    var footer = document.createElement('div'); footer.className = 'cm-card-footer';
    var delBtn = document.createElement('button'); delBtn.className = 'cm-btn-delete'; delBtn.textContent = 'Supprimer';
    delBtn.addEventListener('click', function(){ deleteCommentAdmin(cm.id, delBtn); });
    footer.appendChild(delBtn);
    card.appendChild(meta); card.appendChild(body); card.appendChild(footer);
    container.appendChild(card);
  });
}

async function deleteCommentAdmin(id, delBtn){
  if(!confirm('Supprimer ce commentaire (et ses éventuelles réponses) ?')) return;
  delBtn.disabled = true;
  var res = await sb.from('comments').delete().eq('id', id).select('id');
  if(res.error){ alert('Erreur : ' + friendlyError(res.error)); delBtn.disabled = false; return; }
  if(!res.data || !res.data.length){ alert('Erreur : droits insuffisants.'); delBtn.disabled = false; return; }
  loadCommentsAdmin();
}
