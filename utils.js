// Utilitaires partagés entre index.html, submit.html et admin.html

function escapeHtml(s){
  if(!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function toTitleCase(s){
  var r=s.charAt(0).toUpperCase()+s.slice(1).toLowerCase();
  var acc={Thoracentese:'Thoracentèse',Frederic:'Frédéric',Clement:'Clément',Gregory:'Grégory'};
  return acc[r]||r;
}

function getInitiales(name){
  var parts=name.split(' ');
  if(parts.length>=2) return (parts[0].charAt(0)+parts[parts.length-1].charAt(0)).toUpperCase();
  return name.slice(0,2).toUpperCase();
}

function formatContribNamePlain(name){
  var p=name.trim().split(' ');
  if(p.length===1) return escapeHtml(p[0]);
  return escapeHtml(p.slice(0,-1).map(toTitleCase).join(' ')+' '+p[p.length-1]);
}

function formatContribName(name){
  var p=name.trim().split(' ');
  if(p.length===1) return '<span class="contrib-nom">'+escapeHtml(p[0])+'</span>';
  var prenom=escapeHtml(p.slice(0,-1).map(toTitleCase).join(' '));
  return '<span class="contrib-prenom">'+prenom+'</span> <span class="contrib-nom">'+escapeHtml(p[p.length-1])+'</span>';
}

function getAvatarFilename(name){
  if(!name) return 'avatar.jpg';
  return name.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')
    +'.jpg';
}

function normStr(s){
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
}

// Chemins candidats d'un portrait local (dossier /portraits) à partir du nom
// "NOM, Prénom", du plus spécifique au plus générique. Fonction mutualisée
// (utilisée par index.js et submit.js — auparavant dupliquée avec de légères
// variantes). Quand deux cinéastes partagent le même nom de famille (ex.
// Pasolini, Bergman), le fichier "Nom seul" appartient à l'un des deux : le
// second candidat "Nom, Prénom" désambiguïse automatiquement sans exception
// codée en dur, à condition que le fichier soit nommé ainsi sur le serveur.
// L'appelant essaie les candidats dans l'ordre (via l'événement onerror de
// l'<img>) et affiche un avatar vide si aucun n'existe.
function tcLocalPortraitCandidates(nom){
  if(!nom) return [];
  if(/straub/i.test(nom)&&/huillet/i.test(nom)) return ['portraits/portrait-Straub.jpg'];
  if(/reis/i.test(nom)&&/cordeiro/i.test(nom)) return ['portraits/portrait-Reis.jpg'];
  var titleCase=function(s){return s.split(' ').map(function(w){return w?w.charAt(0)+w.slice(1).toLowerCase():w;}).join(' ');};
  var hasComma=nom.indexOf(',')!==-1;
  var clean=nom.replace(/,.*$/,'');
  var prenom=hasComma?nom.split(',').slice(1).join(',').trim():'';
  var parts=clean.split(' ').filter(function(w){return w.length>=2&&w===w.toUpperCase();});
  var surnameUpper=parts.length?parts.join(' '):clean.trim().toUpperCase();
  if(!surnameUpper) return [];
  var surnameTitled=titleCase(surnameUpper);
  var candidates=['portraits/portrait-'+surnameTitled+'.jpg'];
  if(prenom) candidates.push('portraits/portrait-'+surnameTitled+', '+titleCase(prenom)+'.jpg');
  return candidates;
}

// Compat : premier candidat uniquement (utilisé là où un seul chemin suffit).
function tcLocalPortraitPath(nom){
  var candidates=tcLocalPortraitCandidates(nom);
  return candidates.length?candidates[0]:null;
}

// Cas générique "duo" pour le fallback local : en base, un couple de cinéastes
// partageant le même nom de famille est stocké sous la forme "NOM, Prénom1 &
// Prénom2" (ex. "COEN, Joel & Ethan", "HEIN, Wilhelm & Birgit" — un seul NOM,
// jamais répété). Quand ce duo ne correspond à aucun des couples à nom de
// famille distinct codés en dur ci-dessus (donc pas de fichier combiné du type
// portrait-Straub.jpg), chaque membre peut néanmoins avoir son propre portrait
// local (ex. portraits/portrait-Hein, Wilhelm.jpg et portraits/portrait-Hein,
// Birgit.jpg). Renvoie un tableau de deux listes de candidats (une par membre)
// si nom est bien un duo générique de ce type, sinon null.
function tcLocalPortraitDuoCandidates(nom){
  if(!nom) return null;
  if(/straub/i.test(nom)&&/huillet/i.test(nom)) return null;
  if(/reis/i.test(nom)&&/cordeiro/i.test(nom)) return null;
  if(/gianikian/i.test(nom)&&/ricci/i.test(nom)&&/lucchi/i.test(nom)) return [['portraits/portrait-Gianikian.jpg'],['portraits/portrait-Ricci Lucchi.jpg']];
  if(nom.indexOf(' & ')===-1) return null;
  var commaIdx=nom.indexOf(',');
  if(commaIdx===-1) return null;
  var surname=nom.slice(0,commaIdx).trim();
  var prenoms=nom.slice(commaIdx+1).split(' & ');
  if(prenoms.length!==2||!surname) return null;
  return [tcLocalPortraitCandidates(surname+', '+prenoms[0].trim()),tcLocalPortraitCandidates(surname+', '+prenoms[1].trim())];
}

// Détecte une erreur Supabase due à une session expirée / non authentifiée
// (JWT expiré, refresh échoué, 401). Permet d'afficher un message dédié plutôt
// qu'une erreur générique quand le token expire pendant la saisie d'un formulaire.
function tcIsAuthError(err){
  if(!err) return false;
  var msg = err.message || String(err);
  var code = err.code || err.status || '';
  return /JWT|session|expired|invalid.*token|not.*authenticated|refresh.*token/i.test(msg)
    || code === 401 || code === '401' || code === 'PGRST301';
}

// Signale clairement une session expirée et invite à se reconnecter, sans perdre
// la saisie en cours (bannière fixe non intrusive de shared.js). Le texte saisi
// dans les formulaires n'est pas effacé : l'utilisateur peut se reconnecter dans
// un autre onglet puis réessayer.
function tcNotifyAuthExpired(){
  var msg = (typeof t === 'function') ? t('tc_session_expired')
    : 'Votre session a expiré. Reconnectez-vous pour enregistrer vos changements.';
  if(typeof tcShowBanner === 'function') tcShowBanner('tc-auth-expired', msg, '#b3261e');
  else alert(msg);
}

// ── ERREURS SUPABASE : PANNE ≠ RÉSULTAT VIDE ─────────────────────────────
// supabase-js ne REJETTE JAMAIS ses promesses. Une requête en échec (RLS,
// réseau, jeton expiré, 5xx) résout normalement, avec { data: null, error }.
// Un code qui ne lit que `data` confond donc « le serveur est en panne » et
// « il n'y a rien à afficher » — et affiche le second dans les deux cas.
// tcSbError transforme l'erreur en exception : impossible de l'ignorer.
function tcSbError(err, source){
  var e = new Error('[' + source + '] ' + ((err && err.message) || 'erreur Supabase'));
  e.tcSource = source;
  e.tcCode = err && err.code;
  return e;
}

// Charge la table "cineastes" en totalité (paginé, db.max_rows plafonne à 1000 lignes/requête)
// Les colonnes courant/courant2/courant3 contiennent des id référençant la
// table "courants" (catalogue bilingue) — voir tcLoadCourants/tcCourantLabel.
function tcLoadAllCineastes(sbClient, offset, pageSize){
  offset = offset || 0;
  pageSize = pageSize || 1000;
  return sbClient.from('cineastes').select('nom,fbid,url_facebook,duo,naissance,deces,vivant,pays,pays2,photo_tmdb,courant,courant2,courant3')
    .order('id', { ascending: true })
    .range(offset, offset + pageSize - 1)
    .then(function(res){
      // Sans ce test, une panne renvoyait [] : l'index s'affichait vide, sans
      // bannière, sans retry, et le cache local valide était écrasé.
      if(res && res.error) throw tcSbError(res.error, 'cineastes');
      var rows = res.data || [];
      if(rows.length === pageSize){
        return tcLoadAllCineastes(sbClient, offset + pageSize, pageSize).then(function(more){ return rows.concat(more); });
      }
      return rows;
    });
}

// ── CATALOGUE DES COURANTS (table de référence bilingue "courants") ──────
// Chargé une fois et mis en cache ; résolu en libellé FR/EN au moment de
// l'affichage (comme tcCountryLabel pour les pays), pour que le changement
// de langue en cours de session reste correct sans recharger les données.
var _TC_COURANTS_CACHE = null;

function tcLoadCourants(sbClient){
  return sbClient.from('courants').select('id, nom_fr, nom_en, pays, annee_debut, annee_fin, type').then(function(res){
    // Le garde-fou de loadData (« results[3] vaut null si le fetch a échoué »)
    // ne pouvait pas fonctionner : sur res.error on retournait [], qui est
    // truthy. Le repli sur l'ancien catalogue n'était jamais atteint.
    if(res && res.error) throw tcSbError(res.error, 'courants');
    var rows = res.data || [];
    // Catalogue vide = on ne remplace pas celui déjà en mémoire : sinon
    // libellés et drapeaux de courants disparaissent de tout le site.
    if(!rows.length) return rows;
    var map = {};
    rows.forEach(function(row){ map[row.id] = row; });
    _TC_COURANTS_CACHE = map;
    return rows;
  });
}

// Drapeau du courant (pays d'origine), même rendu que pour un cinéaste.
function tcCourantFlagHtml(id, cssClass){
  if(!id || !_TC_COURANTS_CACHE) return '';
  var row = _TC_COURANTS_CACHE[id];
  if(!row) return '';
  return tcFlagHtml(row.pays, cssClass);
}

// Période du courant : "1958–1964", "depuis 1958" (fin absente) ou '' si aucune année.
function tcCourantYears(id){
  if(!id || !_TC_COURANTS_CACHE) return '';
  var row = _TC_COURANTS_CACHE[id];
  if(!row || !row.annee_debut) return '';
  return row.annee_fin ? (row.annee_debut + '–' + row.annee_fin) : String(row.annee_debut);
}

function tcCourantLabel(id){
  if(!id || !_TC_COURANTS_CACHE) return '';
  var row = _TC_COURANTS_CACHE[id];
  if(!row) return '';
  var lang = 'fr';
  try{ lang = localStorage.getItem('tc-lang') || 'fr'; }catch(e){}
  return (lang === 'en' && row.nom_en) ? row.nom_en : row.nom_fr;
}

// Retourne les id de courants renseignés pour un cinéaste (0 à 3), sans les vides.
function tcCourantIds(c){
  return [c.courant, c.courant2, c.courant3].filter(function(v){ return v; });
}

// Type d'une entrée du catalogue : 'courant' (mouvement daté) ou 'categorie'
// (transversale, ex. Cinéma Bis, Cinéma d'animation). Défaut 'courant' si absent.
function tcCourantType(id){
  if(!id || !_TC_COURANTS_CACHE) return 'courant';
  var row = _TC_COURANTS_CACHE[id];
  return (row && row.type === 'categorie') ? 'categorie' : 'courant';
}

function parseTopsBrut(texte){
  var films = [];
  var rang = 0;
  // Lignes non vides que l'analyseur n'a pas su lire. Elles etaient
  // abandonnees sans un mot : si 8 lignes sur 10 etaient numerotees, le top
  // partait ampute de 2 films et personne ne s'en apercevait avant la
  // moderation. Cf. audit A-15.
  var ignorees = [];
  // Une annee doit rester plausible. « (9999) » etait accepte tel quel.
  var anneeMax = new Date().getFullYear() + 3;
  texte.split('\n').forEach(function(line){
    line = line.trim();
    if(!line) return;
    var m = line.match(/^(\d+)[\.\-\)]\s*(.+)$/);
    if(!m){ ignorees.push(line); return; }
    rang++;
    var contenu = m[2].trim();
    var annee = null;
    var anneeM = contenu.match(/\((\d{4})\)\s*$/);
    if(anneeM){
      var valeur = parseInt(anneeM[1], 10);
      if(valeur >= 1888 && valeur <= anneeMax){
        annee = valeur;
        contenu = contenu.slice(0, anneeM.index).trim();
      }
      // Hors bornes : on ne la retire pas du titre. Le film ressort alors
      // dans l'avertissement « N films sans annee », donc visiblement.
    }
    films.push({ rang: rang, titre: contenu, annee: annee });
  });
  // Porte sur le tableau plutot que dans un objet enveloppe : aucun appelant
  // existant n'est casse, et JSON.stringify d'un tableau ignore cette
  // propriete, donc rien n'est ajoute aux soumissions envoyees en base.
  films.ignorees = ignorees;
  return films;
}

// Message d'avertissement pour les lignes non reconnues par parseTopsBrut.
// Retourne une chaine vide s'il n'y en a aucune. Cf. audit A-15.
function tcMessageLignesIgnorees(films){
  var ign = films && films.ignorees;
  if(!ign || !ign.length) return '';
  // Les guillemets sont poses par i18n.js : « » en francais, “ ” en anglais.
  var apercu = ign.slice(0, 3).map(function(l){
    return l.length > 40 ? l.slice(0, 40) + '\u2026' : l;
  });
  if(typeof t === 'function') return t('mt_lignes_ignorees', [ign.length, apercu, ign.length > 3]);
  return ign.length + ' ligne(s) non reconnue(s) : ' + apercu.join(' / ');
}

function formatPresentation(text){
  var s=escapeHtml(text);
  s=s.replace(/\*\*([\s\S]+?)\*\*/g,'<strong>$1</strong>');
  s=s.replace(/\*([\s\S]+?)\*/g,'<em>$1</em>');
  s=s.replace(/__([\s\S]+?)__/g,'<u>$1</u>');
  s=s.replace(/\n/g,'<br>');
  return s;
}

function friendlyError(err){
  if(!err) return 'Une erreur est survenue.';
  var msg = err.message || String(err);
  if(/JWT|session|expired|invalid.*token/i.test(msg)) return 'Votre session a expiré. Merci de vous reconnecter.';
  if(/duplicate key|unique constraint/i.test(msg)) return 'Cette entrée existe déjà.';
  if(/Failed to fetch|NetworkError|network|fetch|timeout|délai/i.test(msg)) return 'Problème de connexion. Vérifiez votre réseau et réessayez.';
  if(/permission|RLS|policy|row-level security/i.test(msg)) return 'Action non autorisée.';
  return 'Une erreur est survenue : ' + msg;
}

// Détecte si une erreur est de nature réseau/timeout (donc rejouable),
// par opposition aux erreurs de permission RLS ou de validation qui ne
// doivent jamais être retentées automatiquement.
function tcIsTransientNetworkError(err){
  if(!err) return false;
  if(err.name==='AbortError'||err.name==='TC_TIMEOUT') return true;
  var msg = err.message || String(err);
  if(/permission|RLS|policy|row-level security|duplicate key|unique constraint|JWT|invalid.*token|validation/i.test(msg)) return false;
  return /Failed to fetch|NetworkError|network|fetch|timeout|délai|ECONNRESET|ETIMEDOUT/i.test(msg);
}

// fetch() avec timeout via AbortController + retry léger sur erreurs transitoires.
// opts accepte les options fetch standard ; timeoutMs (def. 12000) et retries (def. 2).
function tcFetchWithTimeout(url, opts){
  opts = opts || {};
  var timeoutMs = opts.timeoutMs || 12000;
  var retries = opts.retries !== undefined ? opts.retries : 2;
  var delays = [500, 1500];
  function attempt(n){
    var controller = new AbortController();
    var timer = setTimeout(function(){ controller.abort(); }, timeoutMs);
    var fetchOpts = {};
    for(var k in opts){ if(k!=='timeoutMs'&&k!=='retries') fetchOpts[k]=opts[k]; }
    fetchOpts.signal = controller.signal;
    return fetch(url, fetchOpts).then(function(res){
      clearTimeout(timer);
      return res;
    }).catch(function(err){
      clearTimeout(timer);
      if(err.name==='AbortError'){
        err = new Error('Délai de connexion dépassé pour ' + url);
        err.name = 'TC_TIMEOUT';
      }
      if(n < retries && tcIsTransientNetworkError(err)){
        return new Promise(function(resolve){ setTimeout(resolve, delays[n]||1500); }).then(function(){ return attempt(n+1); });
      }
      throw err;
    });
  }
  return attempt(0);
}

// Enveloppe une promesse Supabase (ou autre) avec un timeout, et retente
// automatiquement en cas d'échec réseau/timeout (pas pour les erreurs de
// permission/validation, qui échouent immédiatement).
// promiseFactory : fonction sans argument qui RETOURNE une promesse (pas la promesse elle-même,
// pour pouvoir la relancer proprement à chaque tentative).
function tcWithRetryTimeout(promiseFactory, opts){
  opts = opts || {};
  var timeoutMs = opts.timeoutMs || 15000;
  var retries = opts.retries !== undefined ? opts.retries : 2;
  var delays = [500, 1500];
  function attempt(n){
    var timeoutErr = new Error('Délai de connexion dépassé.');
    timeoutErr.name = 'TC_TIMEOUT';
    var timer;
    var timeoutPromise = new Promise(function(_, reject){
      timer = setTimeout(function(){ reject(timeoutErr); }, timeoutMs);
    });
    return Promise.race([promiseFactory(), timeoutPromise]).then(function(res){
      clearTimeout(timer);
      if(res && res.error && tcIsTransientNetworkError(res.error) && n < retries){
        return new Promise(function(resolve){ setTimeout(resolve, delays[n]||1500); }).then(function(){ return attempt(n+1); });
      }
      return res;
    }).catch(function(err){
      clearTimeout(timer);
      if(n < retries && tcIsTransientNetworkError(err)){
        return new Promise(function(resolve){ setTimeout(resolve, delays[n]||1500); }).then(function(){ return attempt(n+1); });
      }
      throw err;
    });
  }
  return attempt(0);
}

// URL assainie pour la journalisation des erreurs.
//
// `location.href` transmettait l'adresse complete, fragment et query string
// compris. Or le flux d'authentification Supabase de ce site est en mode
// `implicit` (index.js:101, submit.js:4) : les liens de reinitialisation de
// mot de passe et d'invitation reviennent sous la forme
//   submit.html#access_token=...&refresh_token=...&type=recovery
// Toute erreur JS survenant pendant que l'utilisateur est sur cette adresse
// ecrivait ces jetons en clair dans `error_logs`. Cf. audit A-09.
//
// Regle retenue :
//   - la query string est toujours retiree : aucune valeur de diagnostic. Les
//     seules observees a ce jour etaient des `fbclid` de pistage Facebook ;
//   - le fragment est conserve, car il porte le routage du site
//     (#/cineaste/...) et donc l'information la plus utile au diagnostic,
//     SAUF s'il contient un `=`, signature d'un couple cle=valeur, donc d'un
//     jeton. Sur les 87 lignes deja enregistrees, 71 ont un fragment et
//     aucune ne contient de `=` : la regle ne perd aucun diagnostic existant.
function tcSafeUrl(){
  try{
    var base = location.origin + location.pathname;
    var frag = String(location.hash || '');
    if(frag.indexOf('=') !== -1) frag = '#[fragment-retire]';
    return (base + frag).slice(0, 500);
  }catch(e){ return ''; }
}

// Colonnes de `contributors` lisibles par un compte connecte.
//
// La colonne `email` en est volontairement absente : plus aucun role client
// n'a le droit de la lire (cf. audit A-01). Un `select('*')` echouerait donc
// desormais avec « permission denied for column email » : on enumere.
//
// SI VOUS AJOUTEZ UNE COLONNE a la table et qu'elle doit etre lue par le
// site, il faut la declarer a DEUX endroits : ici, et dans le GRANT cote
// base. Dans cet ordre-la, jamais l'inverse : une colonne demandee ici mais
// non accordee en base fait echouer toute la requete.
var TC_CONTRIB_COLONNES = 'id,name,display_name,auth_id,created_at,cineaste_coeur,cineaste_autres,film_coeur,film_autres,presentation,avatar_url,json_name,is_admin,can_validate_courants,last_seen_at';

// Envoi best-effort des erreurs JS vers la table Supabase `error_logs`.
// Ne doit jamais lancer d'exception ni bloquer l'UI : échecs ignorés silencieusement.
function tcReportErrorToSupabase(message, stack){
  try{
    if(typeof TC_SUPABASE_URL==='undefined'||typeof TC_SUPABASE_KEY==='undefined') return;
    // Timeout via AbortController : un envoi best-effort ne doit jamais rester
    // suspendu indéfiniment (réseau figé) et laisser une requête en attente.
    var _ctrl = new AbortController();
    var _timer = setTimeout(function(){ _ctrl.abort(); }, 8000);
    fetch(TC_SUPABASE_URL + '/rest/v1/error_logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': TC_SUPABASE_KEY,
        'Authorization': 'Bearer ' + TC_SUPABASE_KEY
      },
      body: JSON.stringify({
        message: String(message || '').slice(0, 2000),
        stack: String(stack || '').slice(0, 4000),
        url: tcSafeUrl(),
        user_agent: String(navigator.userAgent || '').slice(0, 400)
      }),
      signal: _ctrl.signal
    }).then(function(){ clearTimeout(_timer); }).catch(function(){ clearTimeout(_timer); });
  }catch(e){}
}

document.addEventListener('click',function(e){
  if(!e.target.closest('.autocomplete-wrap')){
    document.querySelectorAll('.autocomplete-dropdown.visible').forEach(function(dd){
      dd.classList.remove('visible');
      var inp=dd.parentElement&&dd.parentElement.querySelector('[role="combobox"]');
      if(inp){inp.setAttribute('aria-expanded','false');inp.removeAttribute('aria-activedescendant');}
    });
  }
});

function createAutocomplete(config){
  var inputId=config.inputId,dropdownId=config.dropdownId;
  var getItems=config.getItems,onSelect=config.onSelect;
  var minChars=config.minChars!==undefined?config.minChars:2;
  var maxItems=config.maxItems||(typeof TC_AUTOCOMPLETE_MAX!=='undefined'?TC_AUTOCOMPLETE_MAX:12);
  var _idx=-1;
  var _debounceTimer=null;
  function inp(){return document.getElementById(inputId);}
  function dd(){return document.getElementById(dropdownId);}
  function renderDebounced(){
    clearTimeout(_debounceTimer);
    _debounceTimer=setTimeout(render,130);
  }
  function render(){
    var el=inp(),dr=dd();if(!el||!dr)return;
    var q=normStr(el.value.trim());_idx=-1;
    if(q.length<minChars){dr.classList.remove('visible');dr.innerHTML='';el.setAttribute('aria-expanded','false');return;}
    var res=getItems().filter(function(n){return normStr(n).indexOf(q)!==-1;}).slice(0,maxItems);
    if(!res.length){dr.classList.remove('visible');dr.innerHTML='';el.setAttribute('aria-expanded','false');return;}
    dr.innerHTML='';
    res.forEach(function(nom,i){
      var ni=normStr(nom),at=ni.indexOf(q);
      var div=document.createElement('div');
      div.className='autocomplete-item';div.setAttribute('role','option');
      div.setAttribute('id',dropdownId+'-o'+i);div.setAttribute('aria-selected','false');
      div.setAttribute('data-nom',nom);
      div.appendChild(document.createTextNode(nom.slice(0,at)));
      var b=document.createElement('b');b.textContent=nom.slice(at,at+q.length);div.appendChild(b);
      div.appendChild(document.createTextNode(nom.slice(at+q.length)));
      div.addEventListener('mousedown',function(e){e.preventDefault();select(this.getAttribute('data-nom'));});
      dr.appendChild(div);
    });
    dr.classList.add('visible');el.setAttribute('aria-expanded','true');
  }
  function select(nom){
    var el=inp(),dr=dd();
    if(el)el.value=nom;
    if(dr){dr.classList.remove('visible');dr.innerHTML='';}
    if(el){el.setAttribute('aria-expanded','false');el.removeAttribute('aria-activedescendant');}
    _idx=-1;onSelect(nom);
  }
  function key(e){
    var el=inp(),dr=dd();var items=dr?dr.querySelectorAll('.autocomplete-item'):[];
    if(e.key==='ArrowDown'){e.preventDefault();_idx=Math.min(_idx+1,items.length-1);upd(items);}
    else if(e.key==='ArrowUp'){e.preventDefault();_idx=Math.max(_idx-1,0);upd(items);}
    else if(e.key==='Enter'&&_idx>=0){e.preventDefault();select(items[_idx].getAttribute('data-nom'));}
    else if(e.key==='Escape'){if(dr){dr.classList.remove('visible');}if(el){el.setAttribute('aria-expanded','false');}  _idx=-1;}
  }
  function upd(items){
    var el=inp();
    items.forEach(function(it,i){
      it.classList.toggle('selected',i===_idx);
      it.setAttribute('aria-selected',i===_idx?'true':'false');
    });
    if(_idx>=0&&el){
      el.setAttribute('aria-activedescendant',dropdownId+'-o'+_idx);
      if(items[_idx])items[_idx].scrollIntoView({block:'nearest'});
    }
    else if(el)el.removeAttribute('aria-activedescendant');
  }
  function setup(){
    var el=inp(),dr=dd();if(!el||!dr)return;
    el.setAttribute('role','combobox');el.setAttribute('aria-autocomplete','list');
    el.setAttribute('aria-expanded','false');el.setAttribute('aria-haspopup','listbox');
    el.setAttribute('aria-controls',dropdownId);dr.setAttribute('role','listbox');
    el.addEventListener('input',renderDebounced);el.addEventListener('keydown',key);
  }
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',setup);}else{setup();}
  return {select:select,render:render};
}
