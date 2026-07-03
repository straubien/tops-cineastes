// ── CONFIG SUPABASE ──────────────────────────────────────────
const sb = tcCreateClient({
  auth: {
    flowType: 'implicit',
    detectSessionInUrl: true
  }
});

var currentUser = null;
var currentContributor = null;
var parsedFilms = null;

(function(){
  var btnDark = document.getElementById('btn-dark');
  if(btnDark) btnDark.addEventListener('click', toggleDark);
  var btnLang = document.getElementById('btn-lang');
  if(btnLang) btnLang.addEventListener('click', toggleLang);
  var btnLogin = document.getElementById('btn-login');
  if(btnLogin) btnLogin.addEventListener('click', login);
  var btnForgot = document.getElementById('btn-forgot');
  if(btnForgot) btnForgot.addEventListener('click', sendPasswordReset);
  var spBack = document.getElementById('sp-profil-back');
  if(spBack) spBack.addEventListener('click', function(){ sessionStorage.setItem('tc-page', 'index'); });
})();

// ── PHOTOS TMDB (cinéastes) ─────────────────────────────────────
var PHOTOS_TMDB = {};
var PHOTOS_TMDB_NORM = {};
tcFetchWithTimeout('photos-tmdb.json').then(function(r){return r.json()}).then(function(data){
  PHOTOS_TMDB = data || {};
  PHOTOS_TMDB_NORM = {};
  Object.keys(PHOTOS_TMDB).forEach(function(k){ PHOTOS_TMDB_NORM[normStr(k)] = PHOTOS_TMDB[k]; });
  refreshProfilViews();
}).catch(function(){});
function cinNomPrenomVariant(raw){
  // Convertit "Prénom NOM" en "NOM, Prénom" pour matcher le format de photos-tmdb.json
  if(raw.indexOf(',') !== -1) return null;
  var words = raw.split(' ');
  var upperWords = [], lowerWords = [];
  words.forEach(function(w){
    if(w.length >= 2 && w === w.toUpperCase()) upperWords.push(w); else lowerWords.push(w);
  });
  if(!upperWords.length || !lowerWords.length) return null;
  return upperWords.join(' ') + ', ' + lowerWords.join(' ');
}
function firstDuoName(raw){
  // "NOM1 & NOM2" ou "NOM, Prenom1 & Prenom2" → nom du premier cinéaste du duo
  var sep = raw.indexOf('&') !== -1 ? '&' : (raw.indexOf('/') !== -1 ? '/' : null);
  if(!sep) return null;
  var idx = raw.indexOf(',');
  if(idx !== -1){
    var lastName = raw.slice(0, idx).trim();
    var firstNames = raw.slice(idx + 1).split(sep)[0].trim();
    return lastName + ', ' + firstNames;
  }
  return raw.split(sep)[0].trim();
}
function lookupPhoto(nom){
  if(/straub/i.test(nom) && /huillet/i.test(nom)) return PHOTOS_TMDB['STRAUB & HUILLET'];
  var variant = cinNomPrenomVariant(nom);
  var direct = PHOTOS_TMDB[nom] || PHOTOS_TMDB_NORM[normStr(nom)]
    || (variant && (PHOTOS_TMDB[variant] || PHOTOS_TMDB_NORM[normStr(variant)]));
  if(direct) return direct;
  var first = firstDuoName(nom);
  return first ? lookupPhoto(first) : undefined;
}
// Portrait local (dossier /portraits) en priorité sur les photos TMDB
function localPortraitPath(n){
  if(/straub/i.test(n) && /huillet/i.test(n)) return 'portraits/portrait-Straub.jpg';
  if(/reis/i.test(n) && /cordeiro/i.test(n)) return 'portraits/portrait-Reis.jpg';
  var clean = n.replace(/,.*$/, '');
  var parts = clean.split(' ').filter(function(w){ return w.length >= 2 && w === w.toUpperCase(); });
  var surnameUpper = parts.length ? parts.join(' ') : clean.trim().toUpperCase();
  var titleCased = surnameUpper.split(' ').map(function(w){ return w.charAt(0) + w.slice(1).toLowerCase(); }).join(' ');
  return 'portraits/portrait-' + titleCased + '.jpg';
}
function makeEmptyAvatar(){
  var span = document.createElement('span');
  span.className = 'sp-view-avatar sp-view-avatar-empty';
  return span;
}
function makeTmdbAvatar(photoVal){
  var path = Array.isArray(photoVal) ? (photoVal[0] || photoVal[1]) : photoVal;
  if(!path) return makeEmptyAvatar();
  var img = document.createElement('img');
  img.className = 'sp-view-avatar sp-view-avatar-tmdb';
  img.alt = '';
  img.loading = 'lazy';
  img.src = 'https://image.tmdb.org/t/p/w92' + path;
  img.onerror = function(){ img.replaceWith(makeEmptyAvatar()); };
  return img;
}
function makeLocalAvatar(n, fallbackToTmdb){
  var img = document.createElement('img');
  img.className = 'sp-view-avatar';
  img.alt = '';
  img.loading = 'lazy';
  img.src = localPortraitPath(n);
  img.onerror = function(){
    if(fallbackToTmdb){
      var photoVal = lookupPhoto(n) || lookupPhoto(n.replace(/,.*$/, '').trim());
      img.replaceWith(makeTmdbAvatar(photoVal));
    } else {
      img.replaceWith(makeEmptyAvatar());
    }
  };
  return img;
}

// ── INIT ─────────────────────────────────────────────────────
(function(){
  // Détecter un token d'invitation ou de récupération dans l'URL (hash ou query string)
  var hash = window.location.hash;
  var search = window.location.search;
  var isInvite = hash.includes('type=invite') || hash.includes('type=recovery')
    || search.includes('type=invite') || search.includes('type=recovery')
    || hash.includes('type=signup') || search.includes('type=signup');

  // Personnaliser le message de chargement si on connaît déjà le nom
  var knownName = null;
  try{ knownName = localStorage.getItem('tc-display-name'); }catch(e){}
  if(knownName){
    var prenom = knownName.split(' ')[0];
    prenom = prenom.charAt(0).toUpperCase() + prenom.slice(1).toLowerCase();
    document.getElementById('loading-auth-msg').textContent = t('sp_reconnect', prenom);
  }

  // Timeout de sécurité : si aucune session après 30s, afficher le login
  var authResolved = false;
  var loadingTimeout = setTimeout(function(){
    if(!authResolved){
      authResolved = true;
      document.getElementById('section-loading').style.display = 'none';
      document.getElementById('section-login').style.display = 'block';
    }
  }, 30000);

  function hideLoading(){
    if(authResolved) return;
    authResolved = true;
    clearTimeout(loadingTimeout);
    document.getElementById('section-loading').style.display = 'none';
  }

  sb.auth.onAuthStateChange(function(event, session){
    // Session initiale
    if(event === 'INITIAL_SESSION'){
      if(session && isInvite){
        hideLoading();
        document.getElementById('section-setpwd').style.display = 'block';
        isInvite = false;
      } else if(session){
        hideLoading();
        var u = session.user;
        setTimeout(function(){ onLogin(u); }, 0);
      }
      // Si null : on reste en loading, on attend TOKEN_REFRESHED
      return;
    }
    if((event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY') && session && isInvite){
      hideLoading();
      document.getElementById('section-setpwd').style.display = 'block';
      document.getElementById('section-login').style.display = 'none';
      isInvite = false;
    } else if(event === 'SIGNED_IN' && session && !isInvite){
      hideLoading();
      var u = session.user;
      setTimeout(function(){ onLogin(u); }, 0);
    } else if(event === 'USER_UPDATED' && session){
      // Mot de passe défini avec succès
      document.getElementById('section-setpwd').style.display = 'none';
      var u = session.user;
      setTimeout(function(){ onLogin(u); }, 0);
    } else if(event === 'TOKEN_REFRESHED' && session){
      hideLoading();
      if(!currentUser){
        var u = session.user;
        setTimeout(function(){ onLogin(u); }, 0);
      }
    } else if(event === 'SIGNED_OUT'){
      hideLoading();
      onLogout();
    }
  });
})();

// ── LOGIN ────────────────────────────────────────────────────
// La logique partagée (validation, appel Supabase, affichage erreur)
// vit dans auth-shared.js (tcLogin / showError) pour éviter la
// duplication avec admin.html.
function login(){
  return tcLogin(sb, {
    noFields: t('sp_err_no_fields'),
    connecting: t('login_btn') + '…',
    loginBtn: t('login_btn'),
    loginError: t('sp_err_login')
  });
}

async function sendPasswordReset(){
  var email = document.getElementById('login-email').value.trim();
  var msgEl = document.getElementById('forgot-msg');
  if(!email){ showError(t('sp_err_no_email')); return; }
  msgEl.style.display = 'none';
  var btn = document.getElementById('btn-forgot');
  btn.disabled = true;
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname
  });
  btn.disabled = false;
  if(error){
    showError('Erreur : ' + friendlyError(error));
  } else {
    msgEl.textContent = t('sp_forgot_sent') + email + '.';
    msgEl.style.display = 'block';
  }
}

function formatPrenom(displayName){
  if(!displayName) return '';
  var prenom = displayName.split(' ')[0];
  return prenom.charAt(0).toUpperCase() + prenom.slice(1).toLowerCase();
}

async function onLogin(user){
  currentUser = user;
  // Récupérer le contributeur lié
  const { data, error } = await tcWithRetryTimeout(function(){
    return sb.from('contributors')
      .select('*')
      .eq('auth_id', user.id)
      .single();
  });

  if(error || !data){
    // Vérifier si c'est un compte invité récent (email confirmé très récemment = premier login)
    var confirmedAt = user.email_confirmed_at ? new Date(user.email_confirmed_at).getTime() : 0;
    var now = Date.now();
    if(confirmedAt && (now - confirmedAt < 900000)){ // moins de 15 minutes
      // Probablement un nouvel invité qui n'a pas encore défini son mot de passe
      document.getElementById('section-login').style.display = 'none';
      document.getElementById('section-setpwd').style.display = 'block';
      return;
    }
    showError(t('sp_err_no_profil'));
    await sb.auth.signOut();
    return;
  }

  currentContributor = data;
  try{ localStorage.setItem('tc-display-name', data.display_name); }catch(e){}

  // Afficher l'interface
  document.getElementById('section-login').style.display = 'none';
  document.getElementById('section-submit').style.display = 'block';
  document.getElementById('header-user').style.display = 'block';
  document.getElementById('btn-logout').style.display = 'block';
  if(data.is_admin) document.getElementById('btn-admin').style.display = 'inline';
  if(location.hash !== '#mon-profil') history.pushState(null, '', '#mon-profil');
  document.getElementById('header-name').textContent = formatPrenom(data.display_name);
  var titleEl = document.getElementById('submit-title');
  titleEl.textContent = t('nav_mon_profil') + ' — ';
  var nameSpan = document.createElement('span');
  nameSpan.style.color = 'var(--rouge)';
  nameSpan.textContent = formatPrenom(data.display_name);
  titleEl.appendChild(nameSpan);

  initProfil();
}

function onLogout(){
  currentUser = null;
  currentContributor = null;
  try{ localStorage.removeItem('tc-display-name'); }catch(e){}
  document.getElementById('section-loading').style.display = 'none';
  document.getElementById('section-login').style.display = 'block';
  document.getElementById('section-submit').style.display = 'none';
  document.getElementById('header-user').style.display = 'none';
  document.getElementById('btn-logout').style.display = 'none';
  if(location.hash !== '#connexion') history.pushState(null, '', '#connexion');
}

async function logout(){
  await sb.auth.signOut();
}
document.getElementById('btn-logout').addEventListener('click', logout);

tcSyncAuthHashOnPopstate('#mon-profil', function(){ return !!currentContributor; });

// ── AUTOCOMPLETE CINÉASTES ────────────────────────────────────
var cineastesIndex = [];
var selectedCineaste = null;

function loadAllCineastesSubmit(offset, pageSize){
  return tcLoadAllCineastes(sb, offset, pageSize);
}

tcWithRetryTimeout(function(){ return loadAllCineastesSubmit(0, 1000); }).then(function(rows){
  cineastesIndex = (rows||[]).map(function(c){ return c&&c.nom; }).filter(function(n){ return typeof n==='string'; });
}).catch(function(){ /* silencieux si hors site */ });

createAutocomplete({
  inputId: 'cineaste-input',
  dropdownId: 'cineaste-dropdown',
  getItems: function(){ return cineastesIndex; },
  onSelect: function(nom){ selectedCineaste = nom; }
});
var _ciEl = document.getElementById('cineaste-input');
if(_ciEl) _ciEl.addEventListener('input', function(){ selectedCineaste = null; });

// ── PARSING JS PUR (parseTopsBrut défini dans utils.js) ──────

// ── PARSING via Claude API ────────────────────────────────────
async function parseTops(){
  var cineaste = selectedCineaste || document.getElementById('cineaste-input').value.trim();
  var texte = document.getElementById('tops-textarea').value.trim();

  if(!cineaste){
    alert(t('mt_no_cin_alert'));
    return;
  }
  if(!texte){
    alert(t('mt_no_texte_alert'));
    return;
  }

  var btn = document.getElementById('btn-parse');
  var loadingBar = document.getElementById('loading-bar');
  btn.disabled = true;
  btn.textContent = t('mt_analyse_loading');
  loadingBar.classList.add('visible');
  document.getElementById('result-wrap').classList.remove('visible');
  document.getElementById('success-msg').classList.remove('visible');

  // Parser en JS pur
  var films = parseTopsBrut(texte);

  btn.disabled = false;
  btn.textContent = t('mt_analyser');
  loadingBar.classList.remove('visible');

  if(!films.length){
    alert(t('mt_no_films_alert'));
    return;
  }

  parsedFilms = films;
  renderResult(cineaste, parsedFilms);
}

function renderResult(cineaste, films){
  // Afficher le cinéaste
  var parts = cineaste.trim().split(' ');
  var nom = parts[parts.length - 1].toUpperCase();
  var prenom = parts.slice(0, -1).join(' ');
  var resultEl = document.getElementById('result-cineaste');
  resultEl.textContent = prenom ? prenom + ' ' : '';
  var strongEl = document.createElement('strong');
  strongEl.textContent = nom;
  resultEl.appendChild(strongEl);

  // Afficher les films
  var list = document.getElementById('films-list');
  list.innerHTML = '';
  films.forEach(function(f){
    var li = document.createElement('li');
    var titreEl = document.createElement('span');
    titreEl.className = 'film-titre';
    titreEl.textContent = f.titre;
    li.appendChild(titreEl);
    if(f.annee){
      var anneeEl = document.createElement('span');
      anneeEl.className = 'film-annee';
      anneeEl.textContent = f.annee;
      li.appendChild(anneeEl);
    }
    list.appendChild(li);
  });

  // Avertissement si films sans année
  var sansAnnee = films.filter(function(f){ return !f.annee; }).length;
  var warn = document.getElementById('parse-warning');
  if(sansAnnee > 0){
    warn.textContent = t('mt_sans_annee', sansAnnee);
    warn.style.display = 'block';
  } else {
    warn.style.display = 'none';
  }

  document.getElementById('result-wrap').classList.add('visible');
}

// ── SOUMISSION ────────────────────────────────────────────────
async function submitTops(){
  if(!parsedFilms || !currentContributor) return;

  var cineaste = document.getElementById('cineaste-input').value.trim();
  var rawText = document.getElementById('tops-textarea').value.trim();
  var btn = document.getElementById('btn-submit');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>'+t('sp_envoi');

  var insertRes = await sb.from('submissions').insert({
    contributor_id: currentContributor.id,
    raw_text: rawText,
    parsed_json: {
      cineaste: cineaste,
      films: parsedFilms
    },
    status: 'pending'
  }).select('id');

  if(insertRes.error){
    alert(t('sp_err_submission') + friendlyError(insertRes.error));
    btn.disabled = false;
    btn.textContent = t('sp_soumettre');
    return;
  }
  if(!insertRes.data || !insertRes.data.length){
    alert(t('sp_err_rights'));
    btn.disabled = false;
    btn.textContent = t('sp_soumettre');
    return;
  }

  // Succès
  document.getElementById('result-wrap').classList.remove('visible');
  document.getElementById('success-msg').classList.add('visible');
  btn.disabled = false;
  btn.textContent = t('sp_soumettre');

  // Recharger les soumissions
  loadPrevSubmissions();
  resetForm();
}

// ── SOUMISSIONS PRÉCÉDENTES ───────────────────────────────────
async function loadPrevSubmissions(){
  if(!currentContributor) return;

  const { data, error } = await tcWithRetryTimeout(function(){
    return sb.from('submissions')
      .select('id, parsed_json, status, submitted_at')
      .eq('contributor_id', currentContributor.id)
      .order('submitted_at', { ascending: false })
      .limit(50);
  });

  if(error || !data || !data.length){
    document.getElementById('prev-section').style.display = 'none';
    return;
  }

  document.getElementById('prev-section').style.display = 'block';
  var list = document.getElementById('prev-list');
  list.innerHTML = '';

  data.forEach(function(s){
    var cineaste = s.parsed_json && s.parsed_json.cineaste ? s.parsed_json.cineaste : '—';
    var films = (s.parsed_json && s.parsed_json.films) || [];
    var nbFilms = films.length;
    var date = new Date(s.submitted_at).toLocaleDateString('fr-FR');
    var statusLabel = {pending: t('sp_status_pending'), approved: t('sp_status_approved'), rejected: t('sp_status_rejected')}[s.status] || s.status;

    var item = document.createElement('div');
    item.className = 'prev-item';

    // Ligne principale
    var row = document.createElement('div');
    row.className = 'prev-item-row';

    var nameSpan = document.createElement('span');
    nameSpan.className = 'prev-name';
    nameSpan.textContent = cineaste + ' ';
    var metaSpan = document.createElement('span');
    metaSpan.style.cssText = 'opacity:0.45;font-size:14px';
    metaSpan.textContent = '(' + nbFilms + ' film' + (nbFilms > 1 ? 's' : '') + ' · ' + date + ')';
    nameSpan.appendChild(metaSpan);

    var actionsDiv = document.createElement('div');
    actionsDiv.className = 'prev-item-actions';

    var statusSpan = document.createElement('span');
    statusSpan.className = 'prev-status ' + s.status;
    statusSpan.textContent = statusLabel;

    var editBtn = document.createElement('button');
    editBtn.className = 'prev-btn';
    editBtn.textContent = t('sp_modifier');

    var delBtn = document.createElement('button');
    delBtn.className = 'prev-btn delete';
    delBtn.textContent = 'Supprimer';

    actionsDiv.appendChild(statusSpan);
    actionsDiv.appendChild(editBtn);
    actionsDiv.appendChild(delBtn);
    row.appendChild(nameSpan);
    row.appendChild(actionsDiv);

    // Zone d'édition inline
    var editZone = document.createElement('div');
    editZone.className = 'prev-edit-zone';
    var filmsText = films.map(function(f, i){
      return (i + 1) + '. ' + f.titre + (f.annee ? ' (' + f.annee + ')' : '');
    }).join('\n');
    var ta = document.createElement('textarea');
    ta.value = filmsText;
    var editActions = document.createElement('div');
    editActions.className = 'prev-edit-actions';
    var saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary';
    saveBtn.style.cssText = 'font-size:13px;padding:7px 18px';
    saveBtn.textContent = t('sp_sauvegarder');
    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-secondary';
    cancelBtn.style.cssText = 'font-size:13px;padding:7px 18px';
    cancelBtn.textContent = t('sp_annuler');
    var note = document.createElement('div');
    note.className = 'prev-edit-note';
    note.textContent = t('sp_edit_note');
    editActions.appendChild(saveBtn);
    editActions.appendChild(cancelBtn);
    editZone.appendChild(ta);
    editZone.appendChild(editActions);
    editZone.appendChild(note);

    item.appendChild(row);
    item.appendChild(editZone);
    list.appendChild(item);

    // Logique boutons
    editBtn.addEventListener('click', function(){
      var open = editZone.classList.toggle('visible');
      editBtn.textContent = open ? t('sp_fermer') : t('sp_modifier');
    });
    cancelBtn.addEventListener('click', function(){
      editZone.classList.remove('visible');
      editBtn.textContent = t('sp_modifier');
      ta.value = filmsText;
    });
    saveBtn.addEventListener('click', async function(){
      saveBtn.disabled = true;
      saveBtn.textContent = t('sp_enregistrement');
      var lines = ta.value.split('\n').filter(function(l){ return l.trim(); });
      var newFilms = lines.map(function(line, i){
        line = line.replace(/^\d+[.\-)\s]+/, '').trim();
        var am = line.match(/\((\d{4})\)\s*$/);
        var annee = am ? parseInt(am[1]) : null;
        var titre = line.replace(/\(\d{4}\)\s*$/, '').trim();
        return { rang: i + 1, titre: titre, annee: annee };
      });
      var newParsedJson = Object.assign({}, s.parsed_json, { films: newFilms });
      var res = await sb.from('submissions').update({ parsed_json: newParsedJson, status: 'pending' }).eq('id', s.id).select('id');
      if(res.error){ alert(t('sp_err_err') + friendlyError(res.error)); saveBtn.disabled = false; saveBtn.textContent = t('sp_sauvegarder'); return; }
      if(!res.data || !res.data.length){ alert(t('sp_err_rights')); saveBtn.disabled = false; saveBtn.textContent = t('sp_sauvegarder'); return; }
      loadPrevSubmissions();
    });
    delBtn.addEventListener('click', async function(){
      if(!confirm(t('sp_confirm_del', cineaste))) return;
      delBtn.disabled = true;
      var res = await sb.from('submissions').delete().eq('id', s.id).select('id');
      if(res.error){ alert(t('sp_err_err') + friendlyError(res.error)); delBtn.disabled = false; return; }
      if(!res.data || !res.data.length){ alert(t('sp_err_rights')); delBtn.disabled = false; return; }
      loadPrevSubmissions();
    });
  });
}

// ── RESET ─────────────────────────────────────────────────────
function resetForm(){
  document.getElementById('cineaste-input').value = '';
  document.getElementById('tops-textarea').value = '';
  document.getElementById('result-wrap').classList.remove('visible');
  document.getElementById('cineaste-dropdown').classList.remove('visible');
  selectedCineaste = null;
  parsedFilms = null;
}

// ── SET PASSWORD ─────────────────────────────────────────────
async function setPassword(){
  var pwd = document.getElementById('setpwd-password').value;
  var confirm = document.getElementById('setpwd-confirm').value;
  var btn = document.getElementById('btn-setpwd');
  var errEl = document.getElementById('setpwd-error');

  errEl.style.display = 'none';
  if(!pwd || pwd.length < 8){
    errEl.textContent = t('sp_pwd_min');
    errEl.style.display = 'block';
    return;
  }
  if(pwd !== confirm){
    errEl.textContent = t('sp_pwd_match');
    errEl.style.display = 'block';
    return;
  }
  btn.disabled = true;
  btn.textContent = t('sp_pwd_validating');

  const { error } = await sb.auth.updateUser({ password: pwd });
  if(error){
    btn.disabled = false;
    btn.textContent = t('setpwd_btn');
    errEl.textContent = 'Erreur : ' + friendlyError(error);
    errEl.style.display = 'block';
  }
  // onAuthStateChange gère la suite (USER_UPDATED)
}

document.getElementById('btn-setpwd').addEventListener('click', setPassword);
['setpwd-password','setpwd-confirm'].forEach(function(id){
  document.getElementById(id).addEventListener('keydown', function(e){
    if(e.key==='Enter') setPassword();
  });
});

// ── ENTER sur les champs login ────────────────────────────────
document.addEventListener('DOMContentLoaded', function(){
  ['login-email','login-password'].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.addEventListener('keydown', function(e){ if(e.key==='Enter') login(); });
  });
});

// ── ONGLETS ───────────────────────────────────────────────────
// ── PROFIL : TOGGLE ÉDITION ────────────────────────────────────
function toggleEdit(section){
  var viewEl = document.getElementById('sp-'+section+'-view');
  var editEl = document.getElementById('sp-'+section+'-edit');
  var btnEl = document.getElementById('sp-edit-'+section);
  if(editEl.style.display === 'none'){
    editEl.style.display = 'block';
    viewEl.style.display = 'none';
    btnEl.textContent = t('sp_fermer');
  } else {
    editEl.style.display = 'none';
    viewEl.style.display = 'block';
    btnEl.textContent = t('sp_modifier');
    // Masquer les success
    var succ = editEl.querySelector('.profil-success');
    if(succ) succ.classList.remove('visible');
  }
}
function closeEdit(section){
  document.getElementById('sp-'+section+'-edit').style.display = 'none';
  document.getElementById('sp-'+section+'-view').style.display = 'block';
  document.getElementById('sp-edit-'+section).textContent = t('sp_modifier');
}

// ── PROFIL : RENDU VUE LECTURE ─────────────────────────────────
function boldNomFamille(n){
  // Met en gras la partie en majuscules (nom de famille)
  return n.replace(/([A-ZÀ-Ü\-]{2,}(?:\s[A-ZÀ-Ü\-]{2,})*)/g, function(m){ return '<b>'+m+'</b>'; });
}
function renderViewList(containerId, items, fallbackToTmdb){
  var el = document.getElementById(containerId);
  el.innerHTML = '';
  if(!items || !items.length){ el.innerHTML = '<span class="sp-empty">'+t('sp_empty_item')+'</span>'; return; }
  var wrap = document.createElement('div');
  wrap.className = 'sp-view-list';
  items.forEach(function(n){
    var clean=n.replace(/,.*$/,'');
    var parts=clean.split(' ').filter(function(w){return w.length>=2&&w===w.toUpperCase();});
    var nom=parts.length?parts.join(' '):clean.trim();
    if(nom.indexOf('STRAUB')!==-1&&nom.indexOf('HUILLET')!==-1) nom='STRAUB/HUILLET';
    if(nom.indexOf('REIS')!==-1&&nom.indexOf('CORDEIRO')!==-1) nom='REIS/CORDEIRO';
    var item = document.createElement('span');
    item.className = 'sp-view-item';
    item.title = nom;
    item.appendChild(makeLocalAvatar(n, fallbackToTmdb));
    wrap.appendChild(item);
  });
  el.appendChild(wrap);
}
function renderViewFilms(containerId, films){
  var el = document.getElementById(containerId);
  if(!films || !films.length){ el.innerHTML = '<span class="sp-empty">Aucun film ajouté.</span>'; return; }
  el.innerHTML = films.map(function(f){ return '<div style="padding:3px 0">'+escapeHtml(f)+'</div>'; }).join('');
}
function renderViewPresentation(text){
  var el = document.getElementById('sp-presentation-view');
  if(!text){ el.innerHTML = '<span class="sp-empty">Aucune présentation ajoutée.</span>'; return; }
  el.innerHTML = '<div class="sp-presentation-text">'+formatPresentation(text)+'</div>';
}
function refreshProfilViews(){
  if(!currentContributor) return;
  renderViewList('sp-favoris-view', currentContributor.cineaste_coeur, false);
  renderViewList('sp-autres-view', currentContributor.cineaste_autres, true);
  renderViewFilms('sp-films-view', currentContributor.film_coeur);
  renderViewFilms('sp-autresfilms-view', currentContributor.film_autres);
  renderViewPresentation(currentContributor.presentation);
}

// ── PRÉSENTATION : TOOLBAR MISE EN FORME ──────────────────────
document.querySelectorAll('.fmt-btn').forEach(function(btn){
  btn.addEventListener('click', function(){
    var ta=document.getElementById('presentation-textarea');
    var start=ta.selectionStart, end=ta.selectionEnd;
    var sel=ta.value.substring(start,end);
    var wrap={'bold':['**','**'],'italic':['*','*'],'underline':['__','__']}[btn.getAttribute('data-fmt')];
    if(!wrap) return;
    ta.setRangeText(wrap[0]+sel+wrap[1], start, end, 'select');
    ta.focus();
  });
});

// ── PRÉSENTATION : COMPTEUR DE CARACTÈRES ──────────────────────
(function(){
  var ta = document.getElementById('presentation-textarea');
  var counter = document.getElementById('presentation-charcount');
  if(!ta || !counter) return;
  function update(){ counter.textContent = ta.value.length + ' / ' + ta.maxLength; }
  ta.addEventListener('input', update);
  update();
})();

// ── PROFIL : BOUTONS MODIFIER / ANNULER ────────────────────────
['favoris','autres','films','autresfilms','presentation'].forEach(function(s){
  document.getElementById('sp-edit-'+s).addEventListener('click', function(){ toggleEdit(s); });
  var cancelBtn = document.getElementById('sp-cancel-'+s);
  if(cancelBtn) cancelBtn.addEventListener('click', function(){ closeEdit(s); });
});

// ── PROFIL : AVATAR ────────────────────────────────────────────
document.getElementById('btn-change-avatar').addEventListener('click', function(){
  document.getElementById('avatar-input').click();
});

// ── MULTI-SELECT GÉNÉRIQUE ────────────────────────────────────
function formatChipCineaste(n){
  // "KUBRICK, Stanley" → "Stanley KUBRICK"
  var idx = n.indexOf(',');
  if(idx === -1) return n;
  var last = n.slice(0, idx).trim();
  var first = n.slice(idx + 1).trim();
  return first ? first + ' ' + last : last;
}

function createMultiSelect(opts){
  // opts: { inputId, dropdownId, chipsId, maxId, max, showRank }
  var selected = [];
  var acIdx = -1;

  var input = document.getElementById(opts.inputId);
  var dropdown = document.getElementById(opts.dropdownId);
  var chipsEl = document.getElementById(opts.chipsId);
  var maxEl = opts.maxId ? document.getElementById(opts.maxId) : null;

  input.setAttribute('role','combobox');
  input.setAttribute('aria-autocomplete','list');
  input.setAttribute('aria-expanded','false');
  input.setAttribute('aria-haspopup','listbox');
  input.setAttribute('aria-controls',opts.dropdownId);
  dropdown.setAttribute('role','listbox');

  function render(){
    chipsEl.innerHTML = '';
    selected.forEach(function(nom, i){
      var chip = document.createElement('div');
      chip.className = 'chip';
      chip.setAttribute('data-idx', i);
      chip.innerHTML = (opts.showRank ? '<span class="chip-rank" style="pointer-events:none">'+(i+1)+'.&nbsp;</span>' : '')
        + '<span class="chip-label">'+formatChipCineaste(nom)+'</span>'
        + '<button class="chip-remove" data-nom="'+nom.replace(/"/g,'&quot;')+'">&times;</button>';
      chip.querySelector('.chip-remove').addEventListener('click', function(e){
        e.stopPropagation();
        remove(this.getAttribute('data-nom'));
      });
      // Drag FLIP — clone suit le curseur, les autres chips se décalent en douceur
      (function(chipEl){
        var THRESHOLD = 6;
        chipEl.addEventListener('pointerdown', function(e){
          if(e.target.classList.contains('chip-remove')) return;
          e.preventDefault();
          var startX = e.clientX, startY = e.clientY;
          var dragging = false;
          var clone = null, offsetX, offsetY;

          function onMove(ev){
            var dx = ev.clientX - startX, dy = ev.clientY - startY;
            if(!dragging && Math.sqrt(dx*dx+dy*dy) > THRESHOLD){
              dragging = true;
              var rect = chipEl.getBoundingClientRect();
              offsetX = startX - rect.left;
              offsetY = startY - rect.top;
              // Clone flottant
              clone = chipEl.cloneNode(true);
              clone.style.cssText = 'position:fixed;top:'+rect.top+'px;left:'+rect.left+'px;width:'+rect.width+'px;pointer-events:none;z-index:9999;margin:0;opacity:0.92;box-shadow:0 4px 16px rgba(0,0,0,0.28);transition:none;';
              document.body.appendChild(clone);
              // Rendre l'original invisible (placeholder)
              chipEl.style.opacity = '0';
              chipEl.style.pointerEvents = 'none';
            }
            if(!dragging) return;
            clone.style.left = (ev.clientX - offsetX) + 'px';
            clone.style.top  = (ev.clientY - offsetY) + 'px';
            // Trouver le chip cible (masquer clone pour elementFromPoint)
            clone.style.visibility = 'hidden';
            var over = document.elementFromPoint(ev.clientX, ev.clientY);
            clone.style.visibility = '';
            var target = over && over.closest ? over.closest('#'+opts.chipsId+' .chip') : null;
            if(target && target !== chipEl){
              var chips = Array.from(chipsEl.querySelectorAll('.chip'));
              // FLIP : First
              var before = chips.map(function(c){ return c.getBoundingClientRect(); });
              // Déplacer placeholder dans le DOM
              var targetRect = target.getBoundingClientRect();
              if(ev.clientX < targetRect.left + targetRect.width / 2){
                chipsEl.insertBefore(chipEl, target);
              } else {
                chipsEl.insertBefore(chipEl, target.nextSibling);
              }
              // FLIP : Last → Invert → Play
              var after = chips.map(function(c){ return c.getBoundingClientRect(); });
              chips.forEach(function(c, idx){
                if(c === chipEl) return;
                var ddx = before[idx].left - after[idx].left;
                var ddy = before[idx].top  - after[idx].top;
                if(ddx === 0 && ddy === 0) return;
                c.style.transition = 'none';
                c.style.transform = 'translate('+ddx+'px,'+ddy+'px)';
              });
              void chipsEl.offsetHeight;
              chips.forEach(function(c){
                if(c === chipEl) return;
                c.style.transition = 'transform 0.18s ease';
                c.style.transform = '';
              });
            }
          }

          function onUp(){
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            if(!dragging) return;
            if(clone){ clone.remove(); clone = null; }
            // Réinitialiser styles chip
            chipEl.style.opacity = '';
            chipEl.style.pointerEvents = '';
            chipEl.style.transition = 'none';
            chipEl.style.transform = '';
            // Reconstruire selected depuis l'ordre DOM
            var newOrder = Array.from(chipsEl.querySelectorAll('.chip-remove')).map(function(btn){
              return btn.getAttribute('data-nom');
            });
            selected.length = 0;
            newOrder.forEach(function(n){ selected.push(n); });
            render();
          }

          document.addEventListener('pointermove', onMove);
          document.addEventListener('pointerup', onUp);
        });
      })(chip);
      chipsEl.appendChild(chip);
    });
    if(maxEl){
      maxEl.style.display = (opts.max && selected.length >= opts.max) ? 'block' : 'none';
    }
    if(opts.max && selected.length >= opts.max){
      input.style.display = 'none';
    } else {
      input.style.display = '';
    }
  }

  function add(nom){
    if(selected.indexOf(nom) !== -1) return;
    if(opts.max && selected.length >= opts.max) return;
    selected.push(nom);
    input.value = '';
    dropdown.classList.remove('visible');
    input.setAttribute('aria-expanded','false');
    acIdx = -1;
    render();
  }

  function remove(nom){
    selected = selected.filter(function(n){ return n !== nom; });
    render();
  }

  input.addEventListener('input', function(){
    var q = normStr(input.value.trim());
    acIdx = -1;
    if(q.length < 2){ dropdown.classList.remove('visible'); input.setAttribute('aria-expanded','false'); return; }
    var results = cineastesIndex.filter(function(nom){
      return normStr(nom).indexOf(q) !== -1 && selected.indexOf(nom) === -1;
    }).slice(0, TC_AUTOCOMPLETE_MAX);
    if(!results.length){ dropdown.classList.remove('visible'); input.setAttribute('aria-expanded','false'); return; }
    dropdown.innerHTML = '';
    results.forEach(function(nom, i){
      var normNom = normStr(nom);
      var idx = normNom.indexOf(q);
      var div = document.createElement('div');
      div.className = 'autocomplete-item';
      div.setAttribute('role','option');
      div.setAttribute('aria-selected','false');
      div.setAttribute('data-nom', nom);
      div.appendChild(document.createTextNode(nom.slice(0, idx)));
      var bold = document.createElement('b');
      bold.textContent = nom.slice(idx, idx + q.length);
      div.appendChild(bold);
      div.appendChild(document.createTextNode(nom.slice(idx + q.length)));
      div.addEventListener('mousedown', function(e){ e.preventDefault(); add(this.getAttribute('data-nom')); });
      dropdown.appendChild(div);
    });
    dropdown.classList.add('visible'); input.setAttribute('aria-expanded','true');
  });

  input.addEventListener('keydown', function(e){
    var items = dropdown.querySelectorAll('.autocomplete-item');
    if(!items.length) return;
    if(e.key==='ArrowDown'){ e.preventDefault(); acIdx=Math.min(acIdx+1,items.length-1); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); acIdx=Math.max(acIdx-1,0); }
    else if(e.key==='Enter' && acIdx>=0){ e.preventDefault(); add(items[acIdx].getAttribute('data-nom')); return; }
    else if(e.key==='Escape'){ dropdown.classList.remove('visible'); return; }
    items.forEach(function(el,i){ el.classList.toggle('selected', i===acIdx); });
    if(acIdx>=0&&items[acIdx])items[acIdx].scrollIntoView({block:'nearest'});
  });

  var outsideClickHandler = function(e){
    if(!e.target.closest('#'+opts.inputId) && !e.target.closest('#'+opts.dropdownId)){
      dropdown.classList.remove('visible');
    }
  };
  document.addEventListener('click', outsideClickHandler);

  return {
    getSelected: function(){ return selected.slice(); },
    setSelected: function(arr){ selected = arr.slice(); render(); },
    destroy: function(){ document.removeEventListener('click', outsideClickHandler); }
  };
}

// ── INSTANCES MULTI-SELECT ────────────────────────────────────
var favorisSelect, autresSelect;
function initMultiSelects(){
  if(favorisSelect) favorisSelect.destroy();
  if(autresSelect) autresSelect.destroy();
  favorisSelect = createMultiSelect({
    inputId: 'favoris-input',
    dropdownId: 'favoris-dropdown',
    chipsId: 'favoris-chips',
    maxId: 'favoris-max',
    max: 3,
    showRank: false
  });
  autresSelect = createMultiSelect({
    inputId: 'autres-input',
    dropdownId: 'autres-dropdown',
    chipsId: 'autres-chips',
    maxId: null,
    max: null,
    showRank: false
  });
}

// ── PARSEUR FILMS LIBRES (sans numérotation obligatoire) ──────
function parseFilmsLibre(texte, maxFilms){
  var films = [];
  var lines = texte.split('\n');
  lines.forEach(function(line){
    line = line.trim();
    if(!line) return;
    // Retirer numérotation si présente
    line = line.replace(/^\d+[.\-\)\s]+/, '').trim();
    // Retirer emoji
    line = line.replace(/[❤😍🎬🎥]+/g,'').trim();
    if(!line) return;
    // Extraire année
    var am = line.match(/\((\d{4})\)\s*$/);
    var annee = am ? parseInt(am[1]) : null;
    var titre = line.replace(/\(\d{4}\)\s*$/, '').replace(/[-–]\s*$/, '').trim();
    if(titre) films.push({ titre: titre, annee: annee });
  });
  if(maxFilms && films.length > maxFilms) films = films.slice(0, maxFilms);
  return films;
}

function renderFilmsLibre(films, listId, countId, warnId, maxFilms){
  var listEl = document.getElementById(listId);
  var countEl = document.getElementById(countId);
  var warnEl = document.getElementById(warnId);
  listEl.innerHTML = films.map(function(f){
    return '<li><span class="film-titre">'+escapeHtml(f.titre)+'</span>'
      +(f.annee?'<span class="film-annee">'+escapeHtml(f.annee)+'</span>':'')+'</li>';
  }).join('');
  countEl.textContent = films.length+' film'+(films.length>1?'s':'');
  if(maxFilms && films.length >= maxFilms) countEl.className = 'films-count warn';
  else countEl.className = 'films-count';
  var sansAnnee = films.filter(function(f){ return !f.annee; }).length;
  if(sansAnnee > 0){
    warnEl.textContent = sansAnnee+' film'+(sansAnnee>1?'s':'')+' sans année détectée.';
    warnEl.style.display = 'block';
  } else { warnEl.style.display = 'none'; }
}

// ── FILMS FAVORIS ─────────────────────────────────────────────
document.getElementById('btn-save-films-fav').addEventListener('click', async function(){
  if(!currentContributor) return;
  var texte = document.getElementById('films-fav-textarea').value.trim();
  var films = texte ? texte.split('\n').map(function(l){return l.trim();}).filter(function(l){return l;}) : [];
  var btn = this;
  btn.disabled = true; btn.textContent = t('sp_enregistrement');
  try {
    var res = await sb.from('contributors').update({
      film_coeur: films
    }).eq('id', currentContributor.id).select();
    btn.disabled = false; btn.textContent = t('sp_sauvegarder');
    if(res.error){ alert(t('sp_err_save')+friendlyError(res.error)); return; }
    if(!res.data || !res.data.length){ alert(t('sp_err_rights')); return; }
    currentContributor.film_coeur = films;
    document.getElementById('success-films-fav').classList.add('visible');
    refreshProfilViews();
    setTimeout(function(){ closeEdit('films'); }, 1500);
  } catch(e){ btn.disabled = false; btn.textContent = t('sp_sauvegarder'); alert(t('sp_err_unexpected')+e.message); }
});

// ── AUTRES FILMS ──────────────────────────────────────────────
document.getElementById('btn-save-autres-films').addEventListener('click', async function(){
  if(!currentContributor) return;
  var texte = document.getElementById('autres-films-textarea').value.trim();
  var films = texte ? texte.split('\n').map(function(l){return l.trim();}).filter(function(l){return l;}) : [];
  var btn = this;
  btn.disabled = true; btn.textContent = t('sp_enregistrement');
  try {
    var res = await sb.from('contributors').update({
      film_autres: films
    }).eq('id', currentContributor.id).select();
    btn.disabled = false; btn.textContent = t('sp_sauvegarder');
    if(res.error){ alert(t('sp_err_save')+friendlyError(res.error)); return; }
    if(!res.data || !res.data.length){ alert(t('sp_err_rights')); return; }
    currentContributor.film_autres = films;
    document.getElementById('success-autres-films').classList.add('visible');
    refreshProfilViews();
    setTimeout(function(){ closeEdit('autresfilms'); }, 1500);
  } catch(e){ btn.disabled = false; btn.textContent = t('sp_sauvegarder'); alert(t('sp_err_unexpected')+e.message); }
});

// ── CINÉASTES FAVORIS ─────────────────────────────────────────
document.getElementById('btn-submit-favoris').addEventListener('click', async function(){
  if(!currentContributor) return;
  var cineastes = favorisSelect.getSelected();
  if(!cineastes.length){ alert(t('sp_min_cin')); return; }
  var btn = this;
  btn.disabled = true; btn.textContent = t('sp_enregistrement');
  try {
    var res = await sb.from('contributors').update({
      cineaste_coeur: cineastes
    }).eq('id', currentContributor.id).select();
    btn.disabled = false; btn.textContent = t('sp_sauvegarder');
    if(res.error){ alert(t('sp_err_save')+friendlyError(res.error)); return; }
    if(!res.data || !res.data.length){ alert(t('sp_err_rights')); return; }
    currentContributor.cineaste_coeur = cineastes;
    document.getElementById('success-favoris').classList.add('visible');
    refreshProfilViews();
    setTimeout(function(){ closeEdit('favoris'); }, 1500);
  } catch(e){ btn.disabled = false; btn.textContent = t('sp_sauvegarder'); alert(t('sp_err_unexpected')+e.message); }
});

// ── AUTRES CINÉASTES ──────────────────────────────────────────
document.getElementById('btn-submit-autres').addEventListener('click', async function(){
  if(!currentContributor) return;
  var cineastes = autresSelect.getSelected();
  if(!cineastes.length){ alert(t('sp_min_cin')); return; }
  var btn = this;
  btn.disabled = true; btn.textContent = t('sp_enregistrement');
  try {
    var res = await sb.from('contributors').update({
      cineaste_autres: cineastes
    }).eq('id', currentContributor.id).select();
    btn.disabled = false; btn.textContent = t('sp_sauvegarder');
    if(res.error){ alert(t('sp_err_save')+friendlyError(res.error)); return; }
    if(!res.data || !res.data.length){ alert(t('sp_err_rights')); return; }
    currentContributor.cineaste_autres = cineastes;
    document.getElementById('success-autres').classList.add('visible');
    refreshProfilViews();
    setTimeout(function(){ closeEdit('autres'); }, 1500);
  } catch(e){ btn.disabled = false; btn.textContent = t('sp_sauvegarder'); alert(t('sp_err_unexpected')+e.message); }
});

// ── PRÉSENTATION ──────────────────────────────────────────────
document.getElementById('btn-submit-presentation').addEventListener('click', async function(){
  if(!currentContributor) return;
  var texte = document.getElementById('presentation-textarea').value.trim();
  if(!texte){ alert(t('sp_no_presentation')); return; }
  var btn = this;
  btn.disabled = true; btn.textContent = t('sp_enregistrement');
  try {
    var res = await sb.from('contributors').update({
      presentation: texte
    }).eq('id', currentContributor.id).select();
    btn.disabled = false; btn.textContent = t('sp_sauvegarder');
    if(res.error){ alert(t('sp_err_save')+friendlyError(res.error)); return; }
    if(!res.data || !res.data.length){ alert(t('sp_err_rights')); return; }
    currentContributor.presentation = texte;
    document.getElementById('success-presentation').classList.add('visible');
    refreshProfilViews();
    setTimeout(function(){ closeEdit('presentation'); }, 1500);
  } catch(e){ btn.disabled = false; btn.textContent = t('sp_sauvegarder'); alert(t('sp_err_unexpected')+e.message); }
});

// ── AVATAR ────────────────────────────────────────────────────

document.getElementById('avatar-input').addEventListener('change', function(){
  var file = this.files[0];
  var inputEl = this;
  if(!file) return;
  var allowed = ['image/jpeg','image/png','image/webp'];
  if(!allowed.includes(file.type)){
    alert(t('sp_err_upload_fmt'));
    inputEl.value = '';
    return;
  }
  if(file.size > TC_AVATAR_MAX_SIZE){
    alert(t('sp_err_upload_size'));
    inputEl.value = '';
    return;
  }
  // Validate magic bytes to prevent MIME-type spoofing
  var sliceReader = new FileReader();
  sliceReader.onload = function(ev){
    var bytes = new Uint8Array(ev.target.result);
    var valid = (
      (bytes[0]===0xFF&&bytes[1]===0xD8&&bytes[2]===0xFF) || // JPEG
      (bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4E&&bytes[3]===0x47) || // PNG
      (bytes[0]===0x52&&bytes[1]===0x49&&bytes[2]===0x46&&bytes[3]===0x46) // WebP (RIFF)
    );
    if(!valid){ alert(t('sp_err_upload_fmt')); inputEl.value=''; return; }
    var reader = new FileReader();
    reader.onload = function(e){
      document.getElementById('sp-avatar').innerHTML = '<img src="'+e.target.result+'" alt="aperçu">';
    };
    reader.readAsDataURL(file);
    document.getElementById('btn-upload-avatar').style.display = 'inline-block';
    document.getElementById('avatar-success').style.display = 'none';
  };
  sliceReader.readAsArrayBuffer(file.slice(0,4));
});

document.getElementById('btn-upload-avatar').addEventListener('click', async function(){
  var file = document.getElementById('avatar-input').files[0];
  if(!file || !currentContributor) return;
  var btn = this;
  btn.disabled = true; btn.textContent = t('sp_upload_loading');
  try {
    var filename = getAvatarFilename(currentContributor.display_name);
    var ext = file.name.split('.').pop().toLowerCase();
    if(ext !== 'jpg' && ext !== 'jpeg') filename = filename.replace('.jpg', '.'+ext);
    var res = await tcWithRetryTimeout(function(){ return sb.storage.from('avatars').upload(filename, file, {
      upsert: true,
      contentType: file.type
    }); });
    if(res.error){ btn.disabled = false; btn.textContent = t('sp_avatar_publish'); alert(t('sp_err_save')+friendlyError(res.error)); return; }
    var publicUrl = sb.storage.from('avatars').getPublicUrl(filename).data.publicUrl;
    var upd = await sb.from('contributors').update({
      avatar_url: publicUrl
    }).eq('id', currentContributor.id).select();
    if(upd.error){ btn.disabled = false; btn.textContent = t('sp_avatar_publish'); alert('Erreur enregistrement URL : '+friendlyError(upd.error)); return; }
    if(!upd.data || !upd.data.length){ btn.disabled = false; btn.textContent = t('sp_avatar_publish'); alert('La mise à jour de la photo de profil n\'a pas abouti — vérifiez les droits de la table contributors.'); return; }
    currentContributor.avatar_url = publicUrl;
    btn.disabled = false; btn.textContent = t('sp_avatar_publish');
    document.getElementById('avatar-success').style.display = 'block';
  } catch(e){ btn.disabled = false; btn.textContent = 'Publier'; alert('Erreur inattendue : '+e.message); }
});

// ── TOGGLE VISIBILITÉ MOT DE PASSE ──────────────────────────
document.querySelectorAll('.pwd-toggle').forEach(function(btn){
  btn.addEventListener('click', function(){
    var input = document.getElementById(this.getAttribute('data-for'));
    if(!input) return;
    var isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    this.style.color = isPassword ? 'var(--rouge)' : '';
  });
});

// ── TRADUCTION DYNAMIQUE (changement de langue) ──────────────
window.tcAfterLangChange = function(){
  if(currentContributor){
    var titleEl = document.getElementById('submit-title');
    if(titleEl){
      titleEl.textContent = t('nav_mon_profil') + ' — ';
      var nameSpan = document.createElement('span');
      nameSpan.style.color = 'var(--rouge)';
      nameSpan.textContent = formatPrenom(currentContributor.display_name);
      titleEl.appendChild(nameSpan);
    }
  }
};

// ── INIT PROFIL (appelé après login) ─────────────────────────
function initProfil(){
  if(!currentContributor) return;
  // Initiales avatar
  var prenom = formatPrenom(currentContributor.display_name);
  var parts = (currentContributor.display_name||'').split(' ');
  var nom = parts[parts.length-1];
  var initiales = (prenom.charAt(0)+(nom?nom.charAt(0):'')).toUpperCase();
  var initialesEl = document.getElementById('avatar-initiales');
  if(initialesEl) initialesEl.textContent = initiales;

  // Avatar existant
  if(currentContributor.avatar_url){
    var spAvatar = document.getElementById('sp-avatar');
    spAvatar.innerHTML = '';
    var img = document.createElement('img');
    img.alt = 'avatar';
    img.src = currentContributor.avatar_url;
    spAvatar.appendChild(img);
  }

  initMultiSelects();

  // Pré-remplir les formulaires d'édition
  var cc = currentContributor.cineaste_coeur;
  if(cc && Array.isArray(cc) && cc.length) favorisSelect.setSelected(cc);
  var ca = currentContributor.cineaste_autres;
  if(ca && Array.isArray(ca) && ca.length) autresSelect.setSelected(ca);
  var fc = currentContributor.film_coeur;
  if(fc && Array.isArray(fc) && fc.length)
    document.getElementById('films-fav-textarea').value = fc.join('\n');
  var fa = currentContributor.film_autres;
  if(fa && Array.isArray(fa) && fa.length)
    document.getElementById('autres-films-textarea').value = fa.join('\n');
  if(currentContributor.presentation){
    var presTa = document.getElementById('presentation-textarea');
    presTa.value = currentContributor.presentation;
    presTa.dispatchEvent(new Event('input'));
  }

  // Rendre les vues lecture
  refreshProfilViews();
}
