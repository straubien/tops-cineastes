// ===========================================================================
//  JEU DU PHOTOGRAMME — TOPS / CINEASTES
// ===========================================================================
//
//  Une partie : quelqu'un depose des images de films, fixe une heure de
//  debut et de fin, et les autres ecrivent les titres le plus vite possible.
//
//  CE QUI GOUVERNE CE FICHIER, D'UN BOUT A L'AUTRE : LA FLUIDITE.
//  Dans ce jeu, une demi-seconde d'attente se paie au classement. D'ou :
//
//   * AUCUNE INTERROGATION EN BOUCLE. Le classement, les reponses a arbitrer
//     et les indices arrivent par Realtime (postgres_changes). Les smileys et
//     les presences passent par Broadcast, qui ne touche meme pas la base.
//
//   * L'HORLOGE EST CELLE DU SERVEUR. On mesure une fois l'ecart avec la
//     montre de l'appareil (jpSynchroniser) et on s'en sert partout. Sans
//     cela, un navigateur en avance de trois minutes afficherait un faux
//     compte a rebours — et surtout, deux joueurs ne verraient pas la meme
//     partie commencer au meme moment.
//
//   * LES IMAGES SONT PRECHARGEES. Des que les chemins sont lisibles (quinze
//     secondes avant le depart, par defaut), les dix images sont telechargees
//     et decodees en parallele. Passer d'un photogramme a l'autre ne fait
//     ensuite que changer la source d'une balise <img> deja en cache.
//
//   * L'AFFICHAGE EST OPTIMISTE. La reponse apparait a l'instant ou on appuie
//     sur Entree, puis se confirme. On ne regarde jamais un sablier.
//
//  CE QUE CE FICHIER NE SAIT PAS, ET NE DOIT PAS SAVOIR :
//  les titres attendus. Ils ne descendent jamais jusqu'ici. La verification
//  se fait dans Postgres (`jeu_repondre`), qui ne renvoie qu'un verdict.
//  Voir photogramme.sql pour le detail du dispositif.
// ===========================================================================


// ── 1. ÉTAT ────────────────────────────────────────────────────────────────

var JP_SB = tcCreateClient({ auth: { flowType: 'implicit', detectSessionInUrl: false } });

var JP_USER      = null;   // la session d'authentification
var JP_MOI       = null;   // la ligne `contributors` correspondante
var JP_DECALAGE  = 0;      // ecart entre l'horloge du serveur et celle d'ici (ms)
var JP_VUE       = '';     // vue affichee
var JP_FILTRE    = 'en_cours';
var JP_PARTIES   = [];     // les parties chargees pour la liste

var JP_PARTIE    = null;   // la partie ouverte
var JP_PHOTOS    = [];     // ses photogrammes, dans l'ordre
var JP_URLS      = {};     // photogramme_id -> adresse de l'image
var JP_MES       = {};     // photogramme_id -> { statut, texte, points }
var JP_INDICES   = {};     // photogramme_id -> [ { rang, texte } ]
var JP_SECRETS   = {};     // photogramme_id -> titre attendu (CRÉATEUR SEUL)
var JP_SCORES    = [];     // le classement
var JP_GENS      = {};     // contributor_id -> { display_name, avatar_url }
var JP_IDX       = 0;      // le photogramme regarde
var JP_CANAL     = null;   // le canal Realtime de la partie
var JP_HORLOGE   = null;   // le minuteur d'affichage du chrono
var JP_ETAT      = '';     // etat de la partie tel qu'affiche
var JP_PRECHARGE = false;
var JP_JETON     = 0;      // invalide les chargements d'une partie quittee
var JP_BROUILLON = null;   // la partie en cours de preparation dans le studio

var JP_SMILEYS = ['😮', '😂', '🤯', '❤️',
                  '🎬', '👏', '🔥', '😭'];

// Un seul <img> pour toute la partie : on ne fait que changer sa source.
// Creer une nouvelle balise a chaque photogramme provoquerait un recalcul de
// mise en page, donc un clignotement, a chaque fleche.
var JP_IMG = null;


// ── 2. L'HORLOGE DU SERVEUR ────────────────────────────────────────────────

// On demande l'heure au serveur et on retranche la moitie de l'aller-retour.
// L'approximation vaut quelques dizaines de millisecondes : sans commune
// mesure avec la derive d'une horloge d'appareil, qui se compte en minutes.
function jpSynchroniser(){
  var t0 = Date.now();
  return JP_SB.rpc('jeu_maintenant').then(function(res){
    if(!res || res.error || !res.data) return;
    var t1 = Date.now();
    var serveur = Date.parse(res.data);
    if(isNaN(serveur)) return;
    JP_DECALAGE = serveur + (t1 - t0) / 2 - t1;
  }, function(){ /* panne reseau : on garde l'horloge locale */ });
}

function jpMaintenant(){ return Date.now() + JP_DECALAGE; }

// L'onglet a dormi : son horloge a pu deriver pendant la mise en veille.
document.addEventListener('visibilitychange', function(){
  if(document.visibilityState === 'visible') jpSynchroniser();
});


// ── 3. PETITS OUTILS ───────────────────────────────────────────────────────

function jpEl(id){ return document.getElementById(id); }

function jpVider(el){ while(el && el.firstChild) el.removeChild(el.firstChild); }

// Ecrit du texte dans la zone lue par les lecteurs d'ecran. Tout ce qui se
// voit dans ce jeu doit aussi s'entendre : le verdict, le chrono qui
// s'epuise, un indice qui tombe.
function jpAnnoncer(msg){
  var el = jpEl('jp-annonce');
  if(el) el.textContent = msg;
}

// « 04:32 », « 1 h 12 », « 3 j 4 h » selon l'ordre de grandeur.
function jpDuree(ms){
  if(ms < 0) ms = 0;
  var s = Math.floor(ms / 1000);
  var j = Math.floor(s / 86400);
  var h = Math.floor((s % 86400) / 3600);
  var m = Math.floor((s % 3600) / 60);
  var r = s % 60;
  if(j > 0) return j + ' ' + t('jp_u_jour') + ' ' + h + ' ' + t('jp_u_heure');
  if(h > 0) return h + ' ' + t('jp_u_heure') + ' ' + (m < 10 ? '0' : '') + m;
  return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
}

// « 42 s », « 3 min 07 » — le temps mis pour trouver.
function jpChrono(ms){
  var s = Math.round(ms / 1000);
  if(s < 60) return s + ' ' + t('jp_u_sec');
  var m = Math.floor(s / 60);
  var r = s % 60;
  return m + ' ' + t('jp_u_min') + ' ' + (r < 10 ? '0' : '') + r;
}

function jpAlerte(id, msg, genre){
  var el = jpEl(id);
  if(!el) return;
  el.textContent = msg || '';
  el.className = 'jp-alerte' + (genre ? ' jp-alerte-' + genre : '') + (msg ? '' : ' jp-alerte-cache');
}

// Message d'erreur lisible. `friendlyError` (utils.js) traduit deja les
// pannes reseau ; on garde le message de la base pour le reste, parce que
// « La partie est terminee » en dit plus que « une erreur est survenue ».
function jpErreur(err){
  if(!err) return t('jp_err_inconnue');
  if(tcIsAuthError && tcIsAuthError(err)){ tcNotifyAuthExpired(); return t('jp_err_session'); }
  var msg = err.message || String(err);
  if(tcIsTransientNetworkError(err)) return friendlyError(err);
  return msg;
}

// Etat d'une partie, calcule ICI a partir de l'horloge du serveur. La base
// applique exactement la meme regle (fonction `jeu_etat`) : les deux ne
// peuvent donc pas diverger.
function jpEtat(p){
  if(!p) return '';
  if(p.annulee) return 'annulee';
  if(!p.publiee) return 'brouillon';
  var n = jpMaintenant();
  var fin = Date.parse(p.cloture_at || p.fin_at);
  var debut = Date.parse(p.debut_at);
  if(n >= fin) return 'terminee';
  if(n >= debut) return 'en_cours';
  if(n >= debut - (p.preroll_secondes || 0) * 1000) return 'preroll';
  return 'a_venir';
}

function jpPastille(gens, grande){
  var d = document.createElement('div');
  d.className = 'jp-pastille';
  var nom = (gens && gens.display_name) || '?';
  if(gens && gens.avatar_url){
    var img = document.createElement('img');
    img.src = gens.avatar_url;
    img.alt = '';
    img.loading = 'lazy';
    d.appendChild(img);
  } else {
    d.textContent = getInitiales(nom);
  }
  if(grande) d.style.width = d.style.height = grande + 'px';
  return d;
}

// Identifiant aleatoire pour un nom de fichier. C'est lui qui rend l'adresse
// d'une image indevinable : le reste du chemin (cinephile, partie) est connu.
function jpAlea(){
  try{
    var a = new Uint8Array(16);
    crypto.getRandomValues(a);
    var s = '';
    for(var i = 0; i < a.length; i++) s += (a[i] + 0x100).toString(16).slice(1);
    return s;
  }catch(e){
    return String(Date.now()) + Math.random().toString(36).slice(2, 14);
  }
}

// Une date ISO vers la valeur attendue par <input type="datetime-local">,
// dans le fuseau de l'appareil.
function jpVersChamp(iso){
  var d = iso ? new Date(iso) : new Date();
  if(isNaN(d.getTime())) d = new Date();
  function p(n){ return (n < 10 ? '0' : '') + n; }
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
       + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function jpDepuisChamp(v){
  if(!v) return null;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}


// ── 4. AUTHENTIFICATION ────────────────────────────────────────────────────

function jpConnecte(){ return !!(JP_USER && JP_MOI); }

function jpMajEntete(){
  var hu = jpEl('header-user'), bl = jpEl('btn-logout');
  if(jpConnecte()){
    jpEl('header-name').textContent = formatContribNamePlain(JP_MOI.display_name);
    hu.style.display = '';
    bl.style.display = '';
  } else {
    hu.style.display = 'none';
    bl.style.display = 'none';
  }
  var inv = jpEl('jp-invite-connexion');
  if(inv) inv.style.display = jpConnecte() ? 'none' : '';
  var om = jpEl('jp-onglet-miennes');
  if(om) om.style.display = jpConnecte() ? '' : 'none';
}

// Charge la fiche `contributors` du compte connecte. Un compte sans fiche
// (PGRST116) est un cas legitime : on laisse la page en lecture seule plutot
// que d'afficher une panne.
function jpChargerMoi(){
  if(!JP_USER) { JP_MOI = null; return Promise.resolve(); }
  return tcWithRetryTimeout(function(){
    return JP_SB.from('contributors').select(TC_CONTRIB_COLONNES).eq('auth_id', JP_USER.id).single();
  }).then(function(r){
    if(r && r.error && r.error.code !== 'PGRST116') throw tcSbError(r.error, 'contributors/photogramme');
    JP_MOI = (r && r.data) || null;
    if(JP_MOI) JP_GENS[String(JP_MOI.id)] = JP_MOI;
  }).catch(function(e){
    console.error('photogramme : profil illisible', e);
    JP_MOI = null;
  });
}

// Realtime applique la RLS a partir du jeton porte par la connexion : sans
// ce rappel, un createur ne recevrait pas en direct les reponses a arbitrer,
// que seule sa session a le droit de lire.
function jpAuthRealtime(session){
  try{
    if(JP_SB.realtime && typeof JP_SB.realtime.setAuth === 'function'){
      JP_SB.realtime.setAuth(session ? session.access_token : null);
    }
  }catch(e){ /* version de la bibliotheque sans cette methode */ }
}


// ── 5. ROUTAGE ─────────────────────────────────────────────────────────────

var JP_VUES = ['parties', 'connexion', 'studio', 'jeu', 'resultats'];

// Libelle de chaque etat. Table explicite plutot que 'jp_etat_' + etat :
// une cle construite par concatenation echappe au controle de traduction,
// qui ne verrait passer qu'un prefixe. Ici, chaque cle est ecrite en clair.
var JP_LIBELLE_ETAT = {
  brouillon: 'jp_etat_brouillon',
  a_venir:   'jp_etat_a_venir',
  preroll:   'jp_etat_preroll',
  en_cours:  'jp_etat_en_cours',
  terminee:  'jp_etat_terminee',
  annulee:   'jp_etat_annulee'
};

function jpAfficher(vue){
  JP_VUE = vue;
  JP_VUES.forEach(function(v){
    var el = jpEl('jp-vue-' + v);
    if(el) el.classList.toggle('jp-visible', v === vue);
  });
  var ch = jpEl('jp-chargement');
  if(ch) ch.style.display = 'none';
  window.scrollTo(0, 0);
}

function jpAller(ancre){
  if(location.hash === ancre) jpRouter();
  else location.hash = ancre;
}

function jpRouter(){
  var h = location.hash.replace(/^#/, '');

  // On quitte une partie : on coupe le canal et le minuteur, sinon ils
  // continueraient a tourner dans le vide.
  if(h.indexOf('partie/') !== 0) jpQuitterPartie();

  if(h === '' || h === 'parties'){ jpAfficher('parties'); jpChargerParties(); return; }
  if(h === 'connexion'){ jpAfficher('connexion'); return; }
  if(h === 'creer'){ jpOuvrirStudio(null); return; }
  if(h.indexOf('studio/') === 0){ jpOuvrirStudio(h.slice(7)); return; }
  if(h.indexOf('partie/') === 0){ jpOuvrirPartie(h.slice(7)); return; }
  jpAller('#parties');
}

window.addEventListener('hashchange', jpRouter);

// Garde l'adresse en cas de connexion necessaire, pour y revenir apres.
var JP_RETOUR = '';
function jpExigeConnexion(){
  if(jpConnecte()) return true;
  JP_RETOUR = location.hash || '#parties';
  jpAller('#connexion');
  return false;
}


// ── 6. LA LISTE DES PARTIES ────────────────────────────────────────────────

var JP_COLONNES_PARTIE =
  'id,code,titre,description,createur_id,debut_at,fin_at,cloture_at,publiee,annulee,'
  + 'essais_max,preroll_secondes,classement_live,points_base,bonus_vitesse_max,tolerance_fautes,'
  + 'cloture_manuelle,created_at';

// La colonne « cloture_manuelle » arrive avec le fichier SQL n° 6. Si les
// fichiers du site sont poses AVANT que ce fichier soit passe dans Supabase,
// chaque lecture de partie echouerait sur « column does not exist » et la
// page resterait desesperement vide. On regarde donc une fois, au demarrage,
// si la colonne est la ; sinon on s'en passe, la cloture a la main est
// simplement indisponible, et la console dit pourquoi.
var JP_SANS_CLOTURE_MANUELLE = false;

function jpVerifierColonnes(){
  return JP_SB.from('jeu_sessions').select('cloture_manuelle').limit(1).then(function(r){
    if(!r || !r.error) return;
    JP_SANS_CLOTURE_MANUELLE = true;
    JP_COLONNES_PARTIE = JP_COLONNES_PARTIE.replace('cloture_manuelle,', '');
    var ligne = jpEl('jp-f-manuelle');
    if(ligne && ligne.parentNode) ligne.parentNode.style.display = 'none';
    console.warn('photogramme : la colonne « cloture_manuelle » est absente de la base. '
      + 'Passez le fichier A-FAIRE-DANS-SUPABASE-6.sql dans Supabase pour activer la '
      + 'cloture a la main. Message de la base : ' + (r.error.message || ''));
  }, function(){});
}

function jpChargerParties(){
  var liste = jpEl('jp-liste');
  if(!liste) return Promise.resolve();
  if(!JP_PARTIES.length) liste.innerHTML = '<p class="jp-attente">' + escapeHtml(t('jp_chargement')) + '</p>';

  return tcWithRetryTimeout(function(){
    return JP_SB.from('jeu_sessions').select(JP_COLONNES_PARTIE)
             .order('debut_at', { ascending: false }).limit(120);
  }).then(function(r){
    if(r && r.error) throw tcSbError(r.error, 'jeu_sessions');
    JP_PARTIES = (r && r.data) || [];
    var ids = [];
    JP_PARTIES.forEach(function(p){ if(ids.indexOf(p.createur_id) === -1) ids.push(p.createur_id); });
    return jpChargerGens(ids);
  }).then(function(){
    jpRendreParties();
  }).catch(function(e){
    liste.innerHTML = '<p class="jp-vide">' + escapeHtml(jpErreur(e)) + '</p>';
  });
}

// Les noms et avatars, en une seule requete pour toute la page.
function jpChargerGens(ids){
  var manquants = ids.filter(function(id){ return id && !JP_GENS[String(id)]; });
  if(!manquants.length) return Promise.resolve();
  return JP_SB.from('contributors').select('id,display_name,avatar_url,json_name')
           .in('id', manquants).then(function(r){
    ((r && r.data) || []).forEach(function(c){ JP_GENS[String(c.id)] = c; });
  }, function(){ /* sans nom, on affichera les initiales */ });
}

function jpRendreParties(){
  var liste = jpEl('jp-liste');
  var vide  = jpEl('jp-liste-vide');
  if(!liste) return;

  var paquets = { en_cours: [], a_venir: [], terminee: [], miennes: [] };
  JP_PARTIES.forEach(function(p){
    var e = jpEtat(p);
    if(JP_MOI && String(p.createur_id) === String(JP_MOI.id)) paquets.miennes.push(p);
    if(e === 'en_cours' || e === 'preroll') paquets.en_cours.push(p);
    else if(e === 'a_venir') paquets.a_venir.push(p);
    else if(e === 'terminee') paquets.terminee.push(p);
  });
  // Les parties a venir se lisent de la plus proche a la plus lointaine.
  paquets.a_venir.sort(function(a, b){ return Date.parse(a.debut_at) - Date.parse(b.debut_at); });

  ['en_cours', 'a_venir', 'terminee', 'miennes'].forEach(function(k){
    var c = jpEl('jp-compte-' + k);
    if(c) c.textContent = paquets[k].length ? '(' + paquets[k].length + ')' : '';
    var o = jpEl('jp-onglet-' + k);
    if(o) o.setAttribute('aria-selected', k === JP_FILTRE ? 'true' : 'false');
  });

  var lot = paquets[JP_FILTRE] || [];
  jpVider(liste);
  lot.forEach(function(p){ liste.appendChild(jpCarte(p)); });
  if(vide) vide.style.display = lot.length ? 'none' : '';
}

function jpCarte(p){
  var etat = jpEtat(p);
  // Un <div> activable, et non un <button> : la carte accueille maintenant
  // un vrai bouton « Gerer », et un bouton dans un bouton n'est pas du HTML
  // valide (les navigateurs le reparent n'importe comment). tcRendreActivable
  // (utils.js) lui rend le clavier, exactement comme aux lignes de l'index.
  var el = document.createElement('div');
  el.className = 'jp-carte' + (etat === 'terminee' ? ' jp-carte-finie' : '');

  var h = document.createElement('h3');
  h.className = 'jp-carte-titre';
  h.textContent = p.titre;
  el.appendChild(h);

  var meta = document.createElement('p');
  meta.className = 'jp-carte-meta';
  if((etat === 'en_cours' || etat === 'preroll') && p.cloture_manuelle && !p.cloture_at){
    // Pas d'heure de fin annoncee : on ne peut pas dire « finit dans ».
    meta.innerHTML = '<strong>' + escapeHtml(t('jp_sans_fin')) + '</strong>';
  } else if(etat === 'en_cours' || etat === 'preroll'){
    meta.innerHTML = '<strong>' + escapeHtml(t('jp_fin_dans')) + ' '
      + escapeHtml(jpDuree(Date.parse(p.cloture_at || p.fin_at) - jpMaintenant())) + '</strong>';
  } else if(etat === 'a_venir'){
    meta.innerHTML = escapeHtml(t('jp_depart')) + ' <strong>' + escapeHtml(tcDateHeure(p.debut_at)) + '</strong>';
  } else if(etat === 'terminee'){
    meta.textContent = t('jp_jouee_le') + ' ' + tcDateHeure(p.debut_at);
  } else {
    meta.textContent = t('jp_depart') + ' ' + tcDateHeure(p.debut_at);
  }
  el.appendChild(meta);

  if(p.description){
    var d = document.createElement('p');
    d.className = 'jp-carte-meta';
    d.style.marginTop = '7px';
    d.textContent = p.description.length > 130 ? p.description.slice(0, 130) + '…' : p.description;
    el.appendChild(d);
  }

  var pied = document.createElement('div');
  pied.className = 'jp-carte-pied';
  var aut = document.createElement('div');
  aut.className = 'jp-carte-auteur';
  var gens = JP_GENS[String(p.createur_id)];
  aut.appendChild(jpPastille(gens));
  var nom = document.createElement('span');
  nom.textContent = gens ? formatContribNamePlain(gens.display_name) : '…';
  aut.appendChild(nom);
  pied.appendChild(aut);

  var badge = document.createElement('span');
  badge.className = 'jp-etat jp-etat-' + etat;
  badge.textContent = t(JP_LIBELLE_ETAT[etat] || 'jp_etat_a_venir');
  pied.appendChild(badge);
  el.appendChild(pied);

  // Le createur retrouve sa partie, quel que soit son etat : c'est le seul
  // chemin vers le studio une fois la partie publiee.
  if(JP_MOI && String(p.createur_id) === String(JP_MOI.id) && etat !== 'brouillon'){
    var ger = document.createElement('button');
    ger.type = 'button';
    ger.className = 'jp-btn jp-btn-petit';
    ger.textContent = t('jp_gerer');
    // On arrete la propagation : sans cela, le clic (ou Entree) remonterait
    // jusqu'a la carte, qui ouvrirait la partie par-dessus le studio.
    ger.addEventListener('click', function(ev){ ev.stopPropagation(); jpAller('#studio/' + p.id); });
    ger.addEventListener('keydown', function(ev){ ev.stopPropagation(); });
    pied.appendChild(ger);
  }

  tcRendreActivable(el, function(){
    if(etat === 'brouillon') jpAller('#studio/' + p.id);
    else jpAller('#partie/' + p.code);
  }, p.titre);
  return el;
}


// ── 7. LE STUDIO ───────────────────────────────────────────────────────────

function jpOuvrirStudio(id){
  if(!jpExigeConnexion()) return;
  jpAfficher('studio');
  jpAlerte('jp-studio-msg', '');
  jpEl('jp-studio-photos').style.display = id ? '' : 'none';

  if(!id){
    JP_BROUILLON = null;
    JP_PHOTOS = [];
    JP_SECRETS = {};
    jpEl('jp-f-titre').value = '';
    jpEl('jp-f-desc').value  = '';
    // Par defaut : ce soir a 20 h, pendant quinze minutes.
    var d = new Date(jpMaintenant());
    d.setHours(20, 0, 0, 0);
    if(d.getTime() <= jpMaintenant()) d.setDate(d.getDate() + 1);
    jpEl('jp-f-debut').value = jpVersChamp(d.toISOString());
    jpEl('jp-f-fin').value   = jpVersChamp(new Date(d.getTime() + 30 * 60000).toISOString());
    jpEl('jp-f-essais').value    = '0';
    jpEl('jp-f-tolerance').value = '0';
    jpEl('jp-f-preroll').value   = '0';
    jpEl('jp-f-base').value      = '1';
    jpEl('jp-f-bonus').value     = '0';
    jpEl('jp-f-live').checked    = true;
    jpEl('jp-f-manuelle').checked = false;
    // Venir d'une partie deja commencee laissait les champs grises : ils y
    // sont desactives, et rien ne les rouvrait pour la partie suivante.
    ['jp-f-debut', 'jp-f-fin', 'jp-f-essais', 'jp-f-tolerance', 'jp-f-preroll',
     'jp-f-base', 'jp-f-bonus', 'jp-f-live', 'jp-f-manuelle'].forEach(function(k){
      jpEl(k).disabled = false;
    });
    jpEl('jp-depot').style.display = '';
    jpAlerte('jp-studio-etape', '');
    jpMajManuelle();
    jpEl('jp-studio-etat').textContent = '';
    jpEl('jp-f-titre').focus();
    return;
  }

  tcWithRetryTimeout(function(){
    return JP_SB.from('jeu_sessions').select(JP_COLONNES_PARTIE).eq('id', id).single();
  }).then(function(r){
    if(r && r.error) throw tcSbError(r.error, 'jeu_sessions/studio');
    JP_BROUILLON = r.data;
    jpRemplirStudio(JP_BROUILLON);
    return jpChargerPhotosStudio(JP_BROUILLON.id);
  }).catch(function(e){
    jpAlerte('jp-studio-msg', jpErreur(e));
  });
}

function jpRemplirStudio(p){
  jpEl('jp-f-titre').value     = p.titre || '';
  jpEl('jp-f-desc').value      = p.description || '';
  jpEl('jp-f-debut').value     = jpVersChamp(p.debut_at);
  jpEl('jp-f-fin').value       = jpVersChamp(p.fin_at);
  jpEl('jp-f-essais').value    = String(p.essais_max);
  jpEl('jp-f-tolerance').value = String(p.tolerance_fautes);
  jpEl('jp-f-preroll').value   = String(p.preroll_secondes);
  jpEl('jp-f-base').value      = String(p.points_base);
  jpEl('jp-f-bonus').value     = String(p.bonus_vitesse_max);
  jpEl('jp-f-live').checked    = !!p.classement_live;
  jpEl('jp-f-manuelle').checked = !!p.cloture_manuelle;
  jpEl('jp-studio-photos').style.display = '';
  jpEl('jp-btn-publier').style.display = p.publiee ? 'none' : '';
  jpEl('jp-studio-etat').textContent = p.publiee ? t('jp_deja_publiee') : t('jp_brouillon_enregistre');

  // Une partie publiee et commencee ne se remanie plus : la base le refuse,
  // autant le dire ici plutot que de laisser cliquer dans le vide.
  var etatPartie = jpEtat(p);
  var fige = p.publiee && etatPartie !== 'a_venir';
  ['jp-f-debut', 'jp-f-fin', 'jp-f-essais', 'jp-f-tolerance', 'jp-f-preroll',
   'jp-f-base', 'jp-f-bonus', 'jp-f-live', 'jp-f-manuelle'].forEach(function(k){
    jpEl(k).disabled = fige;
  });
  jpMajManuelle();
  jpEl('jp-depot').style.display = fige ? 'none' : '';

  // On annonce franchement ce qui reste modifiable. Un createur qui revient
  // sur une partie deja jouee doit comprendre tout de suite pourquoi la
  // moitie des champs est grisee, plutot que de cliquer dans le vide en se
  // demandant si quelque chose est casse.
  if(etatPartie === 'terminee' || etatPartie === 'annulee'){
    jpAlerte('jp-studio-etape', t('jp_etape_terminee'), 'info');
  } else if(fige){
    jpAlerte('jp-studio-etape', t('jp_etape_commencee'), 'info');
  } else if(p.publiee){
    jpAlerte('jp-studio-etape', t('jp_etape_publiee'), 'info');
  } else {
    jpAlerte('jp-studio-etape', '');
  }

  // Une partie deja publiee ne se « prepare » plus et ne se publie plus :
  // les intitules suivent, sinon le studio raconte autre chose que ce qu'il
  // propose.
  jpEl('jp-titre-studio').textContent = p.publiee ? t('jp_studio_titre_modif') : t('jp_studio_titre');
  jpEl('jp-studio-sous').style.display = p.publiee ? 'none' : '';
  jpEl('jp-studio-s3').textContent     = p.publiee ? t('jp_studio_s3_gerer') : t('jp_studio_s3');
  jpEl('jp-aide-publier').style.display = p.publiee ? 'none' : '';
}

// Le filet de securite d'une partie close a la main : sept jours. La base
// exige une heure de fin ; on en met une assez lointaine pour qu'elle ne
// tombe jamais pendant la soiree, et assez proche pour qu'une partie oubliee
// finisse par se refermer toute seule.
var JP_FILET_MANUEL_MS = 7 * 24 * 3600 * 1000;

function jpLireFormulaire(){
  var debut    = jpDepuisChamp(jpEl('jp-f-debut').value);
  var manuelle = jpEl('jp-f-manuelle').checked;
  var fin      = manuelle
    ? (debut ? new Date(Date.parse(debut) + JP_FILET_MANUEL_MS).toISOString() : null)
    : jpDepuisChamp(jpEl('jp-f-fin').value);
  var titre = jpEl('jp-f-titre').value.trim();
  if(titre.length < 3) return { erreur: t('jp_err_titre') };
  if(!debut)           return { erreur: t('jp_err_dates') };
  if(!manuelle){
    if(!fin) return { erreur: t('jp_err_dates') };
    if(Date.parse(fin) <= Date.parse(debut)) return { erreur: t('jp_err_ordre') };
  }
  function n(id, min, max, def){
    var v = parseInt(jpEl(id).value, 10);
    if(isNaN(v)) v = def;
    return Math.max(min, Math.min(max, v));
  }
  var charge = {
    titre: titre,
    description: jpEl('jp-f-desc').value.trim() || null,
    debut_at: debut,
    fin_at: fin,
    essais_max:        n('jp-f-essais', 0, 50, 5),
    tolerance_fautes:  n('jp-f-tolerance', 0, 4, 2),
    preroll_secondes:  n('jp-f-preroll', 0, 300, 15),
    points_base:       n('jp-f-base', 1, 1000, 100),
    // Sans heure de fin, la rapidite n'a rien a quoi se comparer : le serveur
    // calculerait un bonus presque entier pour tout le monde, puisque chacun
    // repondrait au tout debut d'une partie longue de sept jours. On le met
    // donc a zero, et le studio l'annonce.
    bonus_vitesse_max: manuelle ? 0 : n('jp-f-bonus', 0, 1000, 100),
    classement_live:   jpEl('jp-f-live').checked
  };
  // Tant que la colonne n'existe pas dans la base, on ne l'envoie pas : la
  // case est masquee de toute facon.
  if(!JP_SANS_CLOTURE_MANUELLE) charge.cloture_manuelle = manuelle;
  return charge;
}

// La case « je clôture moi-même » commande le champ « Fin » : il n'a plus de
// sens quand elle est cochee.
function jpMajManuelle(){
  var manuelle = jpEl('jp-f-manuelle').checked;
  var fin  = jpEl('jp-f-fin');
  var aide = jpEl('jp-aide-manuelle');
  var bonus = jpEl('jp-f-bonus');
  if(fin){
    fin.disabled = manuelle || jpEl('jp-f-manuelle').disabled;
    fin.closest('.jp-champ').style.opacity = manuelle ? '0.45' : '';
  }
  if(bonus) bonus.disabled = manuelle || jpEl('jp-f-manuelle').disabled;
  if(aide) aide.style.display = manuelle ? '' : 'none';
  // « La partie s'ouvre et se ferme toute seule » devient faux : on retire
  // la phrase plutot que de laisser deux explications se contredire.
  var horaires = jpEl('jp-aide-horaires');
  if(horaires) horaires.style.display = manuelle ? 'none' : '';
}

function jpEnregistrerPartie(){
  if(!jpExigeConnexion()) return;
  var f = jpLireFormulaire();
  if(f.erreur){ jpAlerte('jp-studio-msg', f.erreur); return; }

  var btn = jpEl('jp-btn-enregistrer');
  btn.disabled = true;
  jpAlerte('jp-studio-msg', '');

  var promesse;
  if(JP_BROUILLON){
    // Une fois la partie commencee, la base refuse tout changement d'horaire
    // ou de regle. On n'envoie donc QUE ce qui reste permis : renvoyer les
    // champs grises, meme inchanges, suffirait a faire echouer la correction
    // d'un simple titre (le champ datetime-local perd les secondes, et la
    // valeur relue ne serait plus tout a fait l'ancienne).
    var charge = f;
    if(JP_BROUILLON.publiee && jpEtat(JP_BROUILLON) !== 'a_venir'){
      charge = { titre: f.titre, description: f.description };
    }
    // Une modification est idempotente : on peut la rejouer sans risque.
    promesse = tcWithRetryTimeout(function(){
      return JP_SB.from('jeu_sessions').update(charge).eq('id', JP_BROUILLON.id).select(JP_COLONNES_PARTIE).single();
    });
  } else {
    // Une creation, elle, n'est JAMAIS rejouee automatiquement : une reponse
    // perdue creerait une partie en double. Meme regle que dans submit.js.
    f.createur_id = JP_MOI.id;
    promesse = JP_SB.from('jeu_sessions').insert(f).select(JP_COLONNES_PARTIE).single();
  }

  promesse.then(function(r){
    btn.disabled = false;
    if(r && r.error) throw tcSbError(r.error, 'jeu_sessions/enregistrer');
    var neuve = !JP_BROUILLON;
    // On FUSIONNE au lieu de remplacer. La reponse d'un UPDATE ne contient
    // que les colonnes demandees : si l'une venait a manquer, remplacer
    // l'objet entier ferait oublier au studio que la partie est publiee —
    // et il reproposerait alors les boutons d'une partie en brouillon.
    JP_BROUILLON = Object.assign({}, JP_BROUILLON || {}, r.data);
    jpRemplirStudio(JP_BROUILLON);
    jpAlerte('jp-studio-msg', t('jp_enregistree'), 'ok');
    if(neuve){
      history.replaceState(null, '', '#studio/' + JP_BROUILLON.id);
      JP_PHOTOS = [];
      jpRendreFiches();
    }
  }).catch(function(e){
    btn.disabled = false;
    jpAlerte('jp-studio-msg', jpErreur(e));
  });
}

function jpChargerPhotosStudio(sid){
  return Promise.all([
    JP_SB.from('jeu_photogrammes').select('id,session_id,position,image_path').eq('session_id', sid).order('position'),
    JP_SB.from('jeu_photogrammes_secret').select('photogramme_id,titre_attendu,realisateur,variantes,indices').eq('session_id', sid)
  ]).then(function(res){
    if(res[0] && res[0].error) throw tcSbError(res[0].error, 'jeu_photogrammes');
    JP_PHOTOS = (res[0] && res[0].data) || [];
    JP_SECRETS = {};
    ((res[1] && res[1].data) || []).forEach(function(s){ JP_SECRETS[String(s.photogramme_id)] = s; });
    JP_PHOTOS.forEach(function(p){ JP_URLS[String(p.id)] = jpUrlImage(p.image_path); });
    jpRendreFiches();
  });
}

function jpUrlImage(chemin){
  try{ return JP_SB.storage.from('photogrammes').getPublicUrl(chemin).data.publicUrl; }
  catch(e){ return ''; }
}


// ── 8. LES FICHES DE PHOTOGRAMME (studio) ──────────────────────────────────

function jpRendreFiches(){
  var hote = jpEl('jp-fiches');
  if(!hote) return;
  jpVider(hote);
  if(!JP_PHOTOS.length){
    var v = document.createElement('p');
    v.className = 'jp-vide';
    v.textContent = t('jp_aucun_photogramme');
    hote.appendChild(v);
    return;
  }

  // « Tout enregistrer » : sur une partie de dix a trente photogrammes,
  // cliquer trente fois etait le vrai cout du studio. La barre est posee EN
  // HAUT ET EN BAS de la liste : sur trente fiches, celle du haut est a
  // plusieurs ecrans de la derniere que l'on vient de remplir.
  function barre(place){
    var b = document.createElement('div');
    b.className = 'jp-actions jp-fiches-barre jp-fiches-barre-' + place;
    var bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'jp-btn';
    bouton.textContent = t('jp_tout_enregistrer');
    var etat = document.createElement('span');
    etat.className = 'jp-fiche-etat';
    b.appendChild(bouton);
    b.appendChild(etat);
    return { bloc: b, bouton: bouton, etat: etat };
  }

  var haut = barre('haut');
  hote.appendChild(haut.bloc);

  var fiches = JP_PHOTOS.map(function(p, i){
    var f = jpFiche(p, i);
    hote.appendChild(f);
    return f;
  });

  var bas = barre('bas');
  hote.appendChild(bas.bloc);

  // Les deux barres commandent la meme chose et disent la meme chose : on
  // les mene ensemble, sinon celle que l'on ne regarde pas raconterait
  // l'etat d'avant.
  var barres = [haut, bas];
  function dire(txt, fini){
    barres.forEach(function(x){
      x.etat.textContent = txt;
      x.etat.classList.toggle('jp-fiche-etat-ok', !!fini);
    });
  }
  function bloquer(oui){
    barres.forEach(function(x){ x.bouton.disabled = oui; });
  }

  function toutEnregistrer(){
    var aFaire = fiches.filter(function(f){ return typeof f.jpEnregistrer === 'function'; });
    if(!aFaire.length) return;
    bloquer(true);
    var faits = 0, echecs = 0, vides = 0;
    dire(t('jp_tout_en_cours', [0, aFaire.length]), false);
    // Une fiche apres l'autre : trente requetes simultanees se genent, et la
    // premiere erreur rendrait les suivantes illisibles.
    var suite = Promise.resolve();
    aFaire.forEach(function(f){
      suite = suite.then(function(){
        return f.jpEnregistrer().then(function(r){
          if(!r.rempli) vides++;
          else if(r.ok) faits++;
          else echecs++;
          dire(t('jp_tout_en_cours', [faits + echecs + vides, aFaire.length]), false);
        });
      });
    });
    suite.then(function(){
      bloquer(false);
      if(echecs || vides) dire(t('jp_tout_partiel', [faits, echecs + vides]), false);
      else dire(t('jp_tout_fait', faits), true);
    });
  }

  barres.forEach(function(x){ x.bouton.addEventListener('click', toutEnregistrer); });
}

function jpFiche(p, i){
  var sec = JP_SECRETS[String(p.id)] || { titre_attendu: '', realisateur: '', variantes: [], indices: [] };
  var fige = JP_BROUILLON && JP_BROUILLON.publiee && jpEtat(JP_BROUILLON) !== 'a_venir';

  var f = document.createElement('div');
  f.className = 'jp-fiche';

  // Colonne image
  var gauche = document.createElement('div');
  gauche.className = 'jp-fiche-img-wrap';
  var img = document.createElement('img');
  img.className = 'jp-fiche-img';
  img.src = JP_URLS[String(p.id)] || '';
  img.alt = t('jp_photogramme_n', p.position);
  img.loading = 'lazy';
  gauche.appendChild(img);
  var pos = document.createElement('span');
  pos.className = 'jp-fiche-pos';
  pos.textContent = p.position;
  gauche.appendChild(pos);

  var etatImg = document.createElement('div');
  etatImg.className = 'jp-fiche-etat';

  if(!fige){
    var outils = document.createElement('div');
    outils.className = 'jp-fiche-outils';
    outils.appendChild(jpBoutonNu('↑', t('jp_monter'), function(){ jpDeplacer(i, -1); }, i === 0));
    outils.appendChild(jpBoutonNu('↓', t('jp_descendre'), function(){ jpDeplacer(i, 1); }, i === JP_PHOTOS.length - 1));
    outils.appendChild(jpBoutonNu('✕', t('jp_retirer'), function(){ jpRetirerPhoto(p); }));
    gauche.appendChild(outils);

    // Remplacer l'image SANS perdre la place du photogramme dans l'ordre.
    // Supprimer puis redeposer marchait deja, mais renvoyait l'image en fin
    // de liste : sur une partie de dix photogrammes montee avec soin, c'est
    // tout l'ordre a refaire pour une seule image a changer.
    var champImg = document.createElement('input');
    champImg.type = 'file';
    champImg.accept = 'image/jpeg,image/png,image/webp,image/bmp';
    champImg.style.display = 'none';
    champImg.setAttribute('aria-label', t('jp_remplacer_image'));
    var bRemp = document.createElement('button');
    bRemp.type = 'button';
    bRemp.className = 'jp-btn jp-btn-petit';
    bRemp.style.marginTop = '6px';
    bRemp.textContent = t('jp_remplacer_image');
    bRemp.addEventListener('click', function(){ champImg.click(); });
    champImg.addEventListener('change', function(){
      if(this.files && this.files[0]) jpRemplacerImage(p, this.files[0], img, etatImg, bRemp);
      this.value = '';
    });
    gauche.appendChild(bRemp);
    gauche.appendChild(champImg);
  } else {
    // Apres le depart, l'image est figee : la remplacer falsifierait ce que
    // les joueurs ont vu, et le classement etabli dessus.
    etatImg.textContent = t('jp_image_figee');
  }
  gauche.appendChild(etatImg);
  f.appendChild(gauche);

  // Colonne saisie
  var droite = document.createElement('div');
  droite.className = 'jp-fiche-corps';

  var ligne = document.createElement('div');
  ligne.className = 'jp-fiche-ligne';
  var cTitre = jpChamp('text', t('jp_ph_attendu'), sec.titre_attendu || '', 200);
  var cReal  = jpChamp('text', t('jp_ph_real'), sec.realisateur || '', 120);
  ligne.appendChild(cTitre); ligne.appendChild(cReal);
  droite.appendChild(ligne);

  // Variantes acceptees
  var lblV = document.createElement('div');
  lblV.className = 'jp-label';
  lblV.textContent = t('jp_l_variantes');
  droite.appendChild(lblV);
  var puces = document.createElement('div');
  puces.className = 'jp-puces';
  droite.appendChild(puces);

  var vars = (sec.variantes || []).slice();
  function dessinerPuces(){
    jpVider(puces);
    vars.forEach(function(v, k){
      var pc = document.createElement('span');
      pc.className = 'jp-puce';
      pc.appendChild(document.createTextNode(v));
      var x = document.createElement('button');
      x.type = 'button';
      x.textContent = '✕';
      x.setAttribute('aria-label', t('jp_retirer_variante', v));
      x.addEventListener('click', function(){ vars.splice(k, 1); dessinerPuces(); });
      pc.appendChild(x);
      puces.appendChild(pc);
    });
    var ajout = jpChamp('text', t('jp_ph_variante'), '', 200);
    ajout.style.maxWidth = '230px';
    ajout.addEventListener('keydown', function(ev){
      if(ev.key !== 'Enter') return;
      ev.preventDefault();
      var v = ajout.value.trim();
      if(v && vars.indexOf(v) === -1 && vars.length < 20){ vars.push(v); dessinerPuces(); }
    });
    puces.appendChild(ajout);
  }
  dessinerPuces();

  // Indices
  var lblI = document.createElement('div');
  lblI.className = 'jp-label';
  lblI.style.marginTop = '12px';
  lblI.textContent = t('jp_l_indices');
  droite.appendChild(lblI);
  var zoneI = document.createElement('div');
  droite.appendChild(zoneI);

  var inds = (sec.indices || []).slice();
  function dessinerIndices(){
    jpVider(zoneI);
    inds.forEach(function(ind, k){
      var l = document.createElement('div');
      l.className = 'jp-indice-ligne';
      var ct = jpChamp('text', t('jp_ph_indice'), ind.texte || '', 240);
      var cs = jpChamp('number', t('jp_ph_apres'), ind.apres == null ? '' : String(ind.apres), 4);
      cs.min = '0'; cs.max = '86400';
      ct.addEventListener('input', function(){ inds[k].texte = ct.value; });
      cs.addEventListener('input', function(){ inds[k].apres = parseInt(cs.value, 10) || 0; });
      l.appendChild(ct); l.appendChild(cs);
      l.appendChild(jpBoutonNu('✕', t('jp_retirer'), function(){ inds.splice(k, 1); dessinerIndices(); }));
      zoneI.appendChild(l);
    });
    if(inds.length < 5){
      var plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'jp-btn jp-btn-petit';
      plus.textContent = t('jp_ajouter_indice');
      plus.addEventListener('click', function(){ inds.push({ texte: '', apres: 0 }); dessinerIndices(); });
      zoneI.appendChild(plus);
    }
  }
  dessinerIndices();

  var aide = document.createElement('p');
  aide.className = 'jp-aide';
  aide.textContent = t('jp_aide_indice');
  droite.appendChild(aide);

  // Enregistrement de la fiche
  var barre = document.createElement('div');
  barre.className = 'jp-actions';
  barre.style.margin = '12px 0 0';
  var bOk = document.createElement('button');
  bOk.type = 'button';
  bOk.className = 'jp-btn jp-btn-petit';
  bOk.textContent = t('jp_enregistrer');
  var etat = document.createElement('span');
  etat.className = 'jp-fiche-etat';
  etat.textContent = sec.titre_attendu ? t('jp_fiche_prete') : t('jp_fiche_sans_titre');
  if(sec.titre_attendu) etat.classList.add('jp-fiche-etat-ok');

  // Enregistrer cette fiche. Rendue sur l'element lui-meme (f.jpEnregistrer)
  // pour que le bouton « Tout enregistrer » puisse la rappeler sans dupliquer
  // une ligne de cette logique. Renvoie une promesse : « rempli » dit si la
  // fiche avait un titre, « ok » si l'enregistrement a abouti.
  function enregistrer(){
    var titre = cTitre.value.trim();
    if(!titre){
      etat.textContent = t('jp_err_attendu');
      etat.classList.remove('jp-fiche-etat-ok');
      return Promise.resolve({ rempli: false, ok: false });
    }
    bOk.disabled = true;
    etat.textContent = t('jp_enregistrement');
    etat.classList.remove('jp-fiche-etat-ok');
    var charge = {
      photogramme_id: p.id,
      session_id: p.session_id,
      titre_attendu: titre,
      realisateur: cReal.value.trim() || null,
      variantes: vars,
      indices: inds.filter(function(x){ return x.texte && x.texte.trim(); })
                   .map(function(x){ return { texte: x.texte.trim(), apres: Math.max(0, x.apres || 0) }; })
    };
    return tcWithRetryTimeout(function(){
      return JP_SB.from('jeu_photogrammes_secret').upsert(charge, { onConflict: 'photogramme_id' }).select().single();
    }).then(function(r){
      bOk.disabled = false;
      if(r && r.error) throw tcSbError(r.error, 'jeu_photogrammes_secret');
      JP_SECRETS[String(p.id)] = r.data;
      etat.textContent = t('jp_fiche_prete');
      etat.classList.add('jp-fiche-etat-ok');
      return { rempli: true, ok: true };
    }).catch(function(e){
      bOk.disabled = false;
      etat.textContent = jpErreur(e);
      return { rempli: true, ok: false };
    });
  }
  f.jpEnregistrer = enregistrer;
  bOk.addEventListener('click', enregistrer);

  barre.appendChild(bOk);
  barre.appendChild(etat);
  droite.appendChild(barre);
  f.appendChild(droite);
  return f;
}

function jpChamp(type, placeholder, valeur, max){
  var i = document.createElement('input');
  i.type = type;
  i.className = 'jp-saisie-simple';
  i.placeholder = placeholder;
  i.setAttribute('aria-label', placeholder);
  i.value = valeur;
  if(max) i.maxLength = max;
  return i;
}

function jpBoutonNu(texte, libelle, action, desactive){
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'jp-btn-nu';
  b.textContent = texte;
  b.title = libelle;
  b.setAttribute('aria-label', libelle);
  b.disabled = !!desactive;
  b.addEventListener('click', action);
  return b;
}

// Echanger deux positions demande un detour : la contrainte d'unicite
// (session, position) refuse le passage par un etat ou deux lignes portent
// le meme numero. On gare donc la premiere sur une position libre.
function jpDeplacer(i, sens){
  var j = i + sens;
  if(j < 0 || j >= JP_PHOTOS.length) return;
  var a = JP_PHOTOS[i], b = JP_PHOTOS[j];
  // Position de garage, hors de la plage reellement utilisee (1 a 30) mais
  // dans celle qu'autorise la contrainte (1 a 999).
  var garage = 900 + i;
  JP_SB.from('jeu_photogrammes').update({ position: garage }).eq('id', a.id)
    .then(function(){ return JP_SB.from('jeu_photogrammes').update({ position: a.position }).eq('id', b.id); })
    .then(function(){ return JP_SB.from('jeu_photogrammes').update({ position: b.position }).eq('id', a.id); })
    .then(function(){
      var tmp = a.position; a.position = b.position; b.position = tmp;
      JP_PHOTOS.sort(function(x, y){ return x.position - y.position; });
      jpRendreFiches();
    }, function(e){ jpAlerte('jp-studio-msg', jpErreur(e)); });
}

function jpRetirerPhoto(p){
  if(!confirm(t('jp_confirme_retrait'))) return;
  JP_SB.from('jeu_photogrammes').delete().eq('id', p.id).then(function(r){
    if(r && r.error){ jpAlerte('jp-studio-msg', jpErreur(r.error)); return; }
    // Le fichier aussi : sans cela, le seau se remplit d'images orphelines.
    JP_SB.storage.from('photogrammes').remove([p.image_path]).then(function(){}, function(){});
    JP_PHOTOS = JP_PHOTOS.filter(function(x){ return x.id !== p.id; });
    delete JP_SECRETS[String(p.id)];
    jpRendreFiches();
    // Retirer le 3 d'une serie de cinq laissait 1, 2, 4, 5. On renumerote.
    jpRenumeroter();
  }, function(e){ jpAlerte('jp-studio-msg', jpErreur(e)); });
}

// Redonne aux photogrammes les numeros 1, 2, 3… sans trou.
//
// POINT DELICAT : deux photogrammes d'une meme partie ne peuvent pas porter
// le meme numero. On les traite donc du plus petit au plus grand : chaque
// numero vise vient d'etre libere par celui d'avant, ou l'etait deja. Dans ce
// sens-la, et dans celui-la seulement, aucune collision n'est possible — on
// n'a pas besoin des positions de garage de « jpDeplacer », qui, lui, echange
// deux numeros tous les deux occupes.
function jpRenumeroter(){
  var aFaire = [];
  JP_PHOTOS.forEach(function(x, i){
    if(x.position !== i + 1) aFaire.push({ photo: x, vise: i + 1 });
  });
  if(!aFaire.length) return Promise.resolve();

  var suite = Promise.resolve();
  aFaire.forEach(function(w){
    suite = suite.then(function(){
      return JP_SB.from('jeu_photogrammes').update({ position: w.vise }).eq('id', w.photo.id)
        .then(function(r){
          if(r && r.error) throw tcSbError(r.error, 'jeu_photogrammes/renumerotation');
          w.photo.position = w.vise;
        });
    });
  });
  return suite.then(function(){
    jpRendreFiches();
  }, function(e){
    // La renumerotation a echoue a mi-chemin : on le dit, et on redessine
    // ce que la base contient reellement plutot que de laisser croire a un
    // ordre qui n'existe pas.
    jpAlerte('jp-studio-msg', jpErreur(e));
    if(JP_BROUILLON) jpChargerPhotosStudio(JP_BROUILLON.id).catch(function(){});
  });
}


// Remplace l'image d'un photogramme en gardant sa position.
//
// POINT DELICAT : on envoie le fichier sous un chemin NEUF, jamais par-dessus
// l'ancien. Le seau est public, donc servi par un cache de diffusion :
// reecrire a la meme adresse laisserait reapparaitre l'ancienne image, chez
// les uns ou les autres, parfois pendant des heures. Une adresse neuve n'a
// pas ce probleme. L'ancien fichier, lui, est retire juste apres.
function jpRemplacerImage(p, fichier, imgEl, etatEl, btn){
  var cheminNeuf = null;
  var ancien = p.image_path;
  btn.disabled = true;
  etatEl.classList.remove('jp-fiche-etat-ok');
  etatEl.textContent = t('jp_prepare');

  jpVraieImage(fichier).then(function(ok){
    if(!ok) throw new Error(t('jp_err_format'));
    return jpReduire(fichier);
  }).then(function(red){
    var ext = red.type === 'image/webp' ? 'webp' : 'jpg';
    cheminNeuf = JP_MOI.id + '/' + p.session_id + '/' + jpAlea() + '.' + ext;
    return tcWithRetryTimeout(function(){
      return JP_SB.storage.from('photogrammes').upload(cheminNeuf, red.blob, { contentType: red.type, upsert: false });
    }, { timeoutMs: 45000 }).then(function(r){
      if(r && r.error) throw tcSbError(r.error, 'storage/remplacement');
      return tcWithRetryTimeout(function(){
        return JP_SB.from('jeu_photogrammes')
          .update({ image_path: cheminNeuf, largeur: red.largeur, hauteur: red.hauteur })
          .eq('id', p.id).select().single();
      });
    });
  }).then(function(r){
    if(r && r.error) throw tcSbError(r.error, 'jeu_photogrammes/remplacement');
    // L'ancienne image ne sert plus a rien : on la retire du seau.
    if(ancien) JP_SB.storage.from('photogrammes').remove([ancien]).then(function(){}, function(){});
    p.image_path = cheminNeuf;
    if(r.data){ p.largeur = r.data.largeur; p.hauteur = r.data.hauteur; }
    JP_URLS[String(p.id)] = jpUrlImage(cheminNeuf);
    imgEl.src = JP_URLS[String(p.id)];
    btn.disabled = false;
    etatEl.textContent = t('jp_image_remplacee');
    etatEl.classList.add('jp-fiche-etat-ok');
  }).catch(function(e){
    // L'envoi a reussi mais l'enregistrement a echoue : on ne laisse pas de
    // fichier orphelin derriere nous.
    if(cheminNeuf) JP_SB.storage.from('photogrammes').remove([cheminNeuf]).then(function(){}, function(){});
    btn.disabled = false;
    etatEl.textContent = jpErreur(e);
  });
}


// ── 9. L'ENVOI DES IMAGES ──────────────────────────────────────────────────

// Un photogramme sorti d'un lecteur vidéo pèse souvent 3 à 6 Mo. Tel quel,
// il coûte dix secondes d'envoi au créateur, et surtout une attente au
// joueur, au moment précis où elle se paie. On le réduit donc ICI, dans le
// navigateur, avant même de partir : 1600 px de large au plus, en WebP.
// Un fichier de 5 Mo descend ainsi autour de 250 Ko sans perte visible à
// l'écran.
var JP_IMG_MAX = 1600;
var JP_IMG_QUALITE = 0.82;

function jpWebpDispo(){
  try{
    var c = document.createElement('canvas');
    c.width = c.height = 1;
    return c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
  }catch(e){ return false; }
}

function jpReduire(fichier){
  return new Promise(function(resolve, reject){
    var url = URL.createObjectURL(fichier);
    var im = new Image();
    im.onload = function(){
      try{
        var ech = Math.min(1, JP_IMG_MAX / Math.max(im.naturalWidth, im.naturalHeight));
        var l = Math.max(1, Math.round(im.naturalWidth * ech));
        var h = Math.max(1, Math.round(im.naturalHeight * ech));
        var c = document.createElement('canvas');
        c.width = l; c.height = h;
        var ctx = c.getContext('2d');
        ctx.drawImage(im, 0, 0, l, h);
        var type = jpWebpDispo() ? 'image/webp' : 'image/jpeg';
        c.toBlob(function(blob){
          URL.revokeObjectURL(url);
          if(!blob){ reject(new Error(t('jp_err_image'))); return; }
          resolve({ blob: blob, type: type, largeur: l, hauteur: h });
        }, type, JP_IMG_QUALITE);
      }catch(e){
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    im.onerror = function(){ URL.revokeObjectURL(url); reject(new Error(t('jp_err_image'))); };
    im.src = url;
  });
}

// On verifie les premiers octets, pas l'extension : un fichier renomme en
// .jpg n'est pas une image. Meme garde-fou que pour les avatars (submit.js).
//
// Le BMP est accepte depuis l'ajout du format : il entre tel quel, mais il
// ne RESTE pas en BMP. Comme les autres, il passe par le canevas de
// jpReduire() qui le redessine en WebP (ou en JPEG) : un BMP de 12 Mo repart
// a quelques centaines de ko. Rien d'autre a changer dans la chaine.
function jpVraieImage(fichier){
  return new Promise(function(resolve){
    var fr = new FileReader();
    fr.onload = function(ev){
      var o = new Uint8Array(ev.target.result);
      resolve(
        (o[0] === 0xFF && o[1] === 0xD8 && o[2] === 0xFF) ||            // JPEG
        (o[0] === 0x89 && o[1] === 0x50 && o[2] === 0x4E && o[3] === 0x47) || // PNG
        (o[0] === 0x52 && o[1] === 0x49 && o[2] === 0x46 && o[3] === 0x46) || // RIFF (WebP)
        (o[0] === 0x42 && o[1] === 0x4D)                                 // BMP (« BM »)
      );
    };
    fr.onerror = function(){ resolve(false); };
    fr.readAsArrayBuffer(fichier.slice(0, 4));
  });
}

function jpEnvoyerFichiers(fichiers){
  if(!JP_BROUILLON){ jpAlerte('jp-studio-msg', t('jp_err_enregistrer_dabord')); return; }
  var reste = 30 - JP_PHOTOS.length;
  var lot = Array.prototype.slice.call(fichiers, 0, Math.max(0, reste));
  if(!lot.length){ jpAlerte('jp-studio-msg', t('jp_err_trop_images')); return; }

  var zone = jpEl('jp-envois');
  // Les envois s'enchainent un par un : dix requetes simultanees sur un
  // telephone en 4G se gelent les unes les autres, et on perd la barre de
  // progression. L'un apres l'autre est plus lent sur le papier, plus sur
  // dans la vraie vie.
  var suite = Promise.resolve();
  lot.forEach(function(f){
    var ligne = document.createElement('div');
    ligne.className = 'jp-aide';
    ligne.textContent = f.name + ' — ' + t('jp_prepare');
    var jauge = document.createElement('div');
    jauge.className = 'jp-jauge';
    var barre = document.createElement('div');
    barre.className = 'jp-jauge-barre';
    jauge.appendChild(barre);
    ligne.appendChild(jauge);
    zone.appendChild(ligne);

    suite = suite.then(function(){
      barre.style.width = '15%';
      return jpVraieImage(f).then(function(ok){
        if(!ok) throw new Error(t('jp_err_format'));
        barre.style.width = '35%';
        return jpReduire(f);
      }).then(function(red){
        barre.style.width = '55%';
        var ext = red.type === 'image/webp' ? 'webp' : 'jpg';
        var chemin = JP_MOI.id + '/' + JP_BROUILLON.id + '/' + jpAlea() + '.' + ext;
        return tcWithRetryTimeout(function(){
          return JP_SB.storage.from('photogrammes').upload(chemin, red.blob, { contentType: red.type, upsert: false });
        }, { timeoutMs: 45000 }).then(function(r){
          if(r && r.error) throw tcSbError(r.error, 'storage/photogrammes');
          barre.style.width = '80%';
          var pos = JP_PHOTOS.length ? Math.max.apply(null, JP_PHOTOS.map(function(x){ return x.position; })) + 1 : 1;
          return JP_SB.from('jeu_photogrammes').insert({
            session_id: JP_BROUILLON.id, position: pos,
            image_path: chemin, largeur: red.largeur, hauteur: red.hauteur
          }).select().single();
        });
      }).then(function(r){
        if(r && r.error) throw tcSbError(r.error, 'jeu_photogrammes/insert');
        barre.style.width = '100%';
        JP_PHOTOS.push(r.data);
        JP_URLS[String(r.data.id)] = jpUrlImage(r.data.image_path);
        ligne.parentNode.removeChild(ligne);
        jpRendreFiches();
      }).catch(function(e){
        ligne.textContent = f.name + ' — ' + jpErreur(e);
        barre.style.background = 'var(--rouge)';
      });
    });
  });
  return suite;
}


// ── 10. PUBLIER, SUPPRIMER ─────────────────────────────────────────────────

function jpPublier(){
  if(!JP_BROUILLON) return;
  var sans = JP_PHOTOS.filter(function(p){
    var s = JP_SECRETS[String(p.id)];
    return !s || !s.titre_attendu;
  });
  if(!JP_PHOTOS.length){ jpAlerte('jp-studio-msg', t('jp_err_sans_photo')); return; }
  if(sans.length){ jpAlerte('jp-studio-msg', t('jp_err_sans_titre', sans.length)); return; }
  if(!confirm(t('jp_confirme_publier'))) return;

  var btn = jpEl('jp-btn-publier');
  btn.disabled = true;
  tcWithRetryTimeout(function(){
    return JP_SB.from('jeu_sessions').update({ publiee: true }).eq('id', JP_BROUILLON.id).select(JP_COLONNES_PARTIE).single();
  }).then(function(r){
    btn.disabled = false;
    if(r && r.error) throw tcSbError(r.error, 'jeu_sessions/publier');
    JP_BROUILLON = r.data;
    jpRemplirStudio(JP_BROUILLON);
    jpAlerte('jp-studio-msg', t('jp_publiee', JP_BROUILLON.code), 'ok');
    JP_PARTIES = [];
  }).catch(function(e){
    btn.disabled = false;
    jpAlerte('jp-studio-msg', jpErreur(e));
  });
}

function jpSupprimerPartie(){
  if(!JP_BROUILLON) return;
  // Une partie jamais publiee ne coute rien a personne. Une partie jouee
  // emporte avec elle les reponses et LE CLASSEMENT PUBLIC : on ne demande
  // pas la meme chose dans les deux cas.
  var etat = jpEtat(JP_BROUILLON);
  var question = (etat === 'brouillon' || etat === 'a_venir')
    ? t('jp_confirme_suppression')
    : t('jp_confirme_suppression_jouee');
  if(!confirm(question)) return;
  var chemins = JP_PHOTOS.map(function(p){ return p.image_path; });
  JP_SB.from('jeu_sessions').delete().eq('id', JP_BROUILLON.id).then(function(r){
    if(r && r.error){ jpAlerte('jp-studio-msg', jpErreur(r.error)); return; }
    if(chemins.length) JP_SB.storage.from('photogrammes').remove(chemins).then(function(){}, function(){});
    JP_BROUILLON = null;
    JP_PARTIES = [];
    jpAller('#parties');
  }, function(e){ jpAlerte('jp-studio-msg', jpErreur(e)); });
}


// ── 11. OUVRIR UNE PARTIE ──────────────────────────────────────────────────

function jpQuitterPartie(){
  JP_MESSAGES = [];
  JP_CHAT_CHARGE = false;
  JP_REVELE = {};
  JP_TROUVES_EN_VOL = false;
  JP_TROUVES_A_REFAIRE = false;
  JP_JETON++;
  ['jp-gerer-avant', 'jp-gerer-resultats'].forEach(function(id){
    var b = jpEl(id);
    if(b) b.style.display = 'none';
  });
  if(JP_CANAL){ try{ JP_SB.removeChannel(JP_CANAL); }catch(e){} JP_CANAL = null; }
  if(JP_HORLOGE){ clearInterval(JP_HORLOGE); JP_HORLOGE = null; }
  JP_PARTIE = null;
  JP_PHOTOS = [];
  JP_MES = {};
  JP_INDICES = {};
  JP_SCORES = [];
  JP_SECRETS = {};
  JP_PRECHARGE = false;
  JP_ETAT = '';
}

function jpOuvrirPartie(code){
  // Changer de partie sans fermer la precedente laissait son canal Realtime
  // ouvert, et `jpAbonner` renoncait a s'abonner a la nouvelle : on recevait
  // le direct d'une partie qu'on ne regardait plus.
  if(JP_PARTIE && JP_PARTIE.code !== code) jpQuitterPartie();
  var jeton = ++JP_JETON;
  jpAfficher('jeu');
  jpEl('jp-avant').style.display = '';
  jpEl('jp-pendant').style.display = 'none';
  jpEl('jp-avant-chrono').textContent = '…';
  jpEl('jp-avant-titre').textContent = '';

  tcWithRetryTimeout(function(){
    return JP_SB.from('jeu_sessions').select(JP_COLONNES_PARTIE).eq('code', code).single();
  }).then(function(r){
    if(jeton !== JP_JETON) return;
    if(r && r.error) throw tcSbError(r.error, 'jeu_sessions/ouvrir');
    JP_PARTIE = r.data;
    return jpChargerGens([JP_PARTIE.createur_id]).then(function(){
      if(jeton !== JP_JETON) return;
      jpDemarrerPartie(jeton);
    });
  }).catch(function(e){
    if(jeton !== JP_JETON) return;
    jpEl('jp-avant-titre').textContent = t('jp_partie_introuvable');
    jpEl('jp-avant-chrono').textContent = '';
    jpEl('jp-avant-note').textContent = jpErreur(e);
  });
}

// La partie en cours n'a-t-elle pas d'heure de fin annoncee ?
function jpSansFin(){
  return !!(JP_PARTIE && JP_PARTIE.cloture_manuelle && !JP_PARTIE.cloture_at);
}

function jpSuisCreateur(){
  return !!(JP_MOI && JP_PARTIE && String(JP_PARTIE.createur_id) === String(JP_MOI.id));
}

function jpDemarrerPartie(jeton){
  var etat = jpEtat(JP_PARTIE);
  jpEl('jp-avant-titre').textContent = JP_PARTIE.titre;
  jpEl('jp-jeu-titre').textContent = JP_PARTIE.titre;
  jpEl('jp-res-titre').textContent = JP_PARTIE.titre;

  jpAbonner();
  jpChargerChat();
  jpBoucleHorloge(jeton);

  if(etat === 'terminee' || etat === 'annulee'){ jpMontrerResultats(jeton); return; }
  if(etat === 'brouillon'){ jpAller('#studio/' + JP_PARTIE.id); return; }

  jpBasculerEtat(jeton, etat);
}

// Le passage « à venir → préchargement → en cours → terminée » se fait ici,
// à la seconde près, sans rien demander au serveur : chaque navigateur
// connaît l'heure du serveur et les horaires de la partie. Tout le monde
// bascule donc au même instant.
function jpBasculerEtat(jeton, etat){
  if(jeton !== JP_JETON || JP_ETAT === etat) return;
  JP_ETAT = etat;

  if(etat === 'a_venir'){
    jpEl('jp-avant').style.display = '';
    jpEl('jp-pendant').style.display = 'none';
    jpEl('jp-avant-note').textContent = t('jp_avant_note', JP_PARTIE.titre);
    jpEl('jp-gerer-avant').style.display = jpSuisCreateur() ? '' : 'none';
    return;
  }

  if(etat === 'preroll' || etat === 'en_cours'){
    if(!JP_PRECHARGE){ JP_PRECHARGE = true; jpChargerJeu(jeton); }
    if(etat === 'preroll'){
      jpEl('jp-avant-note').textContent = t('jp_preroll_note');
      return;
    }
    jpEl('jp-avant').style.display = 'none';
    jpEl('jp-pendant').style.display = '';
    jpPreparerJeu();
    return;
  }

  if(etat === 'terminee'){ jpMontrerResultats(jeton); }
}

function jpBoucleHorloge(jeton){
  if(JP_HORLOGE) clearInterval(JP_HORLOGE);
  function battre(){
    if(jeton !== JP_JETON || !JP_PARTIE){ clearInterval(JP_HORLOGE); JP_HORLOGE = null; return; }
    var etat = jpEtat(JP_PARTIE);
    if(etat !== JP_ETAT) jpBasculerEtat(jeton, etat);

    var n = jpMaintenant();
    if(etat === 'a_venir' || etat === 'preroll'){
      var av = jpEl('jp-avant-chrono');
      if(av) av.textContent = jpDuree(Date.parse(JP_PARTIE.debut_at) - n);
    } else if(etat === 'en_cours'){
      var ch = jpEl('jp-chrono');
      if(!ch) return;
      // Cloture a la main : il n'y a pas de compte a rebours a montrer. On
      // affiche le temps ECOULE, qui est ce dont l'animateur a besoin pour
      // decider du moment d'arreter.
      if(jpSansFin()){
        var depuis = jpDuree(n - Date.parse(JP_PARTIE.debut_at));
        if(ch.textContent !== depuis){
          ch.textContent = depuis;
          ch.classList.remove('jp-chrono-urgent');
        }
        return;
      }
      var reste = Date.parse(JP_PARTIE.cloture_at || JP_PARTIE.fin_at) - n;
      var txt = jpDuree(reste);
      if(ch.textContent !== txt){
        ch.textContent = txt;
        ch.classList.toggle('jp-chrono-urgent', reste < 60000);
        // Les dernieres minutes sont annoncees, pas seulement affichees.
        var s = Math.round(reste / 1000);
        if(s === 60 || s === 30 || s === 10) jpAnnoncer(t('jp_reste', txt));
      }
    }
  }
  battre();
  // 250 ms : assez serre pour que la bascule tombe a la bonne seconde, assez
  // large pour ne rien couter. Chaque battement recalcule tout a partir de
  // l'horloge du serveur : aucune derive ne s'accumule.
  JP_HORLOGE = setInterval(battre, 250);
}


// ── 12. CHARGER LE JEU ─────────────────────────────────────────────────────

function jpChargerJeu(jeton){
  var requetes = [
    JP_SB.from('jeu_photogrammes').select('id,session_id,position,image_path,largeur,hauteur')
      .eq('session_id', JP_PARTIE.id).order('position'),
    JP_SB.rpc('jeu_indices', { p_session_id: JP_PARTIE.id })
  ];
  if(jpConnecte()){
    requetes.push(JP_SB.from('jeu_reponses')
      .select('id,photogramme_id,texte,statut,points,elapsed_ms,submitted_at')
      .eq('session_id', JP_PARTIE.id).eq('contributor_id', JP_MOI.id));
  }
  if(jpSuisCreateur()){
    requetes.push(JP_SB.from('jeu_photogrammes_secret')
      .select('photogramme_id,titre_attendu,realisateur,indices')
      .eq('session_id', JP_PARTIE.id));
  }

  return Promise.all(requetes).then(function(res){
    if(jeton !== JP_JETON) return;
    if(res[0] && res[0].error) throw tcSbError(res[0].error, 'jeu_photogrammes/jeu');
    JP_PHOTOS = (res[0] && res[0].data) || [];
    JP_PHOTOS.forEach(function(p){ JP_URLS[String(p.id)] = jpUrlImage(p.image_path); });

    JP_INDICES = {};
    ((res[1] && res[1].data) || []).forEach(function(i){
      var k = String(i.photogramme_id);
      (JP_INDICES[k] = JP_INDICES[k] || []).push(i);
    });

    var i = 2;
    if(jpConnecte()){
      JP_MES = {};
      ((res[i] && res[i].data) || []).forEach(function(r){
        var k = String(r.photogramme_id);
        // On garde l'etat le plus avance : accepte > en attente > refuse.
        var a = JP_MES[k];
        if(!a || r.statut === 'accepte' || (a.statut === 'refuse' && r.statut === 'en_attente')){
          JP_MES[k] = { statut: r.statut, texte: r.texte, points: r.points, elapsed_ms: r.elapsed_ms };
        }
      });
      i++;
    }
    if(jpSuisCreateur()){
      JP_SECRETS = {};
      ((res[i] && res[i].data) || []).forEach(function(s){ JP_SECRETS[String(s.photogramme_id)] = s; });
    }

    jpPrecharger();
    jpChargerScores();
    if(jpSuisCreateur()) jpChargerArbitrage();
    if(JP_ETAT === 'en_cours') jpPreparerJeu();
    // Ce qui est deja tombe, pour qui arrive en cours de partie ou recharge
    // la page : sans cela, il chercherait des photogrammes finis. Une fois
    // la liste connue, on le place sur le premier photogramme encore en jeu.
    jpChargerTrouves().then(function(){
      if(jeton === JP_JETON && JP_ETAT === 'en_cours') jpAllerPhoto(jpPremierNonTrouve());
    });
  }).catch(function(e){
    if(jeton !== JP_JETON) return;
    var at = jpEl('jp-scene-attente');
    if(at) at.textContent = jpErreur(e);
  });
}

// Le préchargement. Les dix images partent en même temps, et `decode()`
// garantit qu'elles sont non seulement reçues mais DÉCODÉES avant d'être
// affichées : sans lui, la première image saccade au moment du départ,
// pendant que le navigateur la déplie.
function jpPrecharger(){
  JP_PHOTOS.forEach(function(p){
    var url = JP_URLS[String(p.id)];
    if(!url) return;
    var im = new Image();
    im.decoding = 'async';
    im.src = url;
    if(typeof im.decode === 'function') im.decode().catch(function(){});
  });
}


// ── 13. LE JEU ─────────────────────────────────────────────────────────────

function jpPreparerJeu(){
  if(!JP_PHOTOS.length) return;
  JP_IMG = jpEl('jp-image');
  jpEl('jp-scene-attente').style.display = 'none';
  JP_IMG.style.display = '';

  jpRendrePellicule();
  jpRendreEmojis();
  jpAllerPhoto(jpPremierNonTrouve());

  var createur = jpSuisCreateur();

  // Les deux etiquettes du bandeau dependent de la partie et du role. On
  // change l'attribut « data-i18n » plutot que le seul texte : sans cela,
  // passer en anglais pendant la partie les remettrait a leur valeur d'origine.
  var etiqT = jpEl('jp-trouves-etiq');
  if(etiqT){
    etiqT.setAttribute('data-i18n', createur ? 'jp_trouves_table' : 'jp_trouves');
    etiqT.textContent = t(createur ? 'jp_trouves_table' : 'jp_trouves');
  }
  var etiqR = jpEl('jp-restant-etiq');
  if(etiqR){
    etiqR.setAttribute('data-i18n', jpSansFin() ? 'jp_depuis' : 'jp_restant');
    etiqR.textContent = t(jpSansFin() ? 'jp_depuis' : 'jp_restant');
  }
  jpMajScoreBandeau();
  jpEl('jp-panneau-arbitrage').style.display = createur ? '' : 'none';
  jpEl('jp-panneau-createur').style.display  = createur ? '' : 'none';
  jpEl('jp-gerer-avant').style.display = 'none';
  jpEl('jp-reponse').disabled = createur || !jpConnecte();
  JP_SAISIE_OUVERTE = !(createur || !jpConnecte());
  jpEl('jp-btn-valider').disabled = !JP_SAISIE_OUVERTE;
  if(createur){
    jpEl('jp-verdict-txt').textContent = t('jp_vous_animez');
    jpRendreCommandesCreateur();
  } else if(!jpConnecte()){
    jpEl('jp-verdict-txt').textContent = t('jp_connectez_vous_pour_jouer');
  } else {
    jpEl('jp-reponse').focus();
  }

  var masque = !JP_PARTIE.classement_live && !createur;
  jpEl('jp-panneau-classement').style.display = '';
  jpEl('jp-rangs').style.display = masque ? 'none' : '';
  jpEl('jp-classement-masque').style.display = masque ? '' : 'none';
}

function jpPremierNonTrouve(){
  for(var i = 0; i < JP_PHOTOS.length; i++){
    var m = JP_MES[String(JP_PHOTOS[i].id)];
    // Ni trouve par moi, ni tombe par un autre : c'est la qu'il faut aller.
    if((!m || m.statut !== 'accepte') && !JP_REVELE[JP_PHOTOS[i].position]) return i;
  }
  // Tout est tombe : on reste ou l'on est plutot que de sauter au premier.
  return JP_IDX;
}

function jpRendrePellicule(){
  var pel = jpEl('jp-pellicule');
  jpVider(pel);
  JP_PHOTOS.forEach(function(p, i){
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'jp-vignette';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-label', t('jp_photogramme_n', p.position));
    b.setAttribute('data-ph', p.id);
    var url = JP_URLS[String(p.id)];
    if(url) b.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
    var num = document.createElement('span');
    num.className = 'jp-vignette-num';
    num.textContent = p.position;
    b.appendChild(num);
    var et = document.createElement('span');
    et.className = 'jp-vignette-etat';
    b.appendChild(et);
    b.addEventListener('click', function(){ jpAllerPhoto(i); });
    pel.appendChild(b);
    jpMajVignette(p.id);
  });
}

function jpMajVignette(phId){
  var b = document.querySelector('.jp-vignette[data-ph="' + phId + '"]');
  if(!b) return;
  var m = JP_MES[String(phId)];
  b.classList.remove('jp-vignette-ok', 'jp-vignette-attente', 'jp-vignette-non');
  var et = b.querySelector('.jp-vignette-etat');
  if(!m){ if(et) et.textContent = ''; return; }
  if(m.statut === 'accepte'){ b.classList.add('jp-vignette-ok'); if(et) et.textContent = '✓'; }
  else if(m.statut === 'en_attente'){ b.classList.add('jp-vignette-attente'); if(et) et.textContent = '?'; }
  else { b.classList.add('jp-vignette-non'); if(et) et.textContent = '✕'; }
}

function jpAllerPhoto(i){
  if(i < 0) i = JP_PHOTOS.length - 1;
  if(i >= JP_PHOTOS.length) i = 0;
  JP_IDX = i;
  var p = JP_PHOTOS[i];
  if(!p) return;

  // On ne touche qu'a la source : l'image est deja en cache, l'echange est
  // immediat et ne redessine rien d'autre.
  if(JP_IMG){
    JP_IMG.src = JP_URLS[String(p.id)] || '';
    JP_IMG.alt = t('jp_photogramme_n', p.position);
  }
  jpEl('jp-scene-num').textContent = p.position;

  document.querySelectorAll('.jp-vignette').forEach(function(b){
    b.setAttribute('aria-current', b.getAttribute('data-ph') === String(p.id) ? 'true' : 'false');
  });
  var active = document.querySelector('.jp-vignette[aria-current="true"]');
  if(active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'center' });

  jpRendreIndices(p);
  jpRendreVerdictCourant(p);
  jpRendreTrouve(p);
  jpMajPlein();

  jpMajSaisie(p, true);
  jpAnnoncer(t('jp_photogramme_n', p.position));
}

// ── LE PLEIN ECRAN ─────────────────────────────────────────────────────────
// Un simple voile par-dessus la page, pas l'API « fullscreen » du navigateur :
// celle-ci demande un geste, peut etre refusee, et sort de la page — ici on
// veut un aller-retour instantane, qui laisse le jeu tourner derriere.
var JP_PLEIN = false;

function jpOuvrirPlein(){
  var p = JP_PHOTOS[JP_IDX];
  var voile = jpEl('jp-plein');
  var img = jpEl('jp-plein-img');
  if(!p || !voile || !img) return;
  img.src = JP_URLS[String(p.id)] || '';
  img.alt = t('jp_photogramme_n', p.position);
  voile.hidden = false;
  JP_PLEIN = true;
  jpRendrePleinBande(p);
  var fermer = jpEl('jp-plein-fermer');
  if(fermer) fermer.focus();
  jpAnnoncer(t('jp_agrandi', p.position));
}

function jpFermerPlein(){
  var voile = jpEl('jp-plein');
  if(!voile) return;
  voile.hidden = true;
  JP_PLEIN = false;
  var loupe = jpEl('jp-loupe');
  if(loupe) loupe.focus();
}

function jpBasculerPlein(){
  if(JP_PLEIN) jpFermerPlein(); else jpOuvrirPlein();
}

// Changer de photogramme pendant que l'agrandissement est ouvert : l'image
// suit, sans fermeture ni clignotement.
function jpMajPlein(){
  if(!JP_PLEIN) return;
  var p = JP_PHOTOS[JP_IDX];
  var img = jpEl('jp-plein-img');
  if(p && img){ img.src = JP_URLS[String(p.id)] || ''; img.alt = t('jp_photogramme_n', p.position); }
  jpRendrePleinBande(p);
}

// La meme bande qu'en petit : un photogramme trouve le dit aussi en grand.
function jpRendrePleinBande(p){
  var bande = jpEl('jp-plein-trouve');
  if(!bande) return;
  jpVider(bande);
  var r = p && JP_REVELE[p.position];
  var sec = p && JP_SECRETS[String(p.id)];
  var titre = r ? r.titre : (jpSuisCreateur() && sec ? sec.titre_attendu : '');
  if(!titre){ bande.hidden = true; return; }
  bande.hidden = false;
  var t1 = document.createElement('span');
  t1.className = 'jp-trouve-titre';
  t1.textContent = titre;
  bande.appendChild(t1);
  var t2 = document.createElement('span');
  t2.className = 'jp-trouve-par';
  t2.textContent = r
    ? (jpTrouveParMoi(p) ? t('jp_par_vous') : t('jp_par_nom', r.nom))
    : t('jp_bande_attendu');
  bande.appendChild(t2);
}

// Le bandeau pose sur l'image (point 1). Des qu'un photogramme est trouve,
// il porte le TITRE ATTENDU et le NOM de celui qui l'a donne, et il y reste :
// c'est a cela que les autres voient, sans rien lire ailleurs, que ce
// photogramme est fini.
//
// Il ne recouvre pas l'image : une bande en bas, assez sombre pour que le
// texte se lise sur n'importe quel plan. On veut l'information ET le film.
function jpRendreTrouve(p){
  var bande = jpEl('jp-trouve');
  if(!bande) return;
  jpVider(bande);
  var r = p && JP_REVELE[p.position];
  var sec = p && JP_SECRETS[String(p.id)];

  // L'animateur voit le titre attendu des le debut : c'est lui qui arbitre.
  // Tant que personne n'a trouve, la bande le dit ainsi ; des qu'un joueur
  // trouve, elle devient la bande de tout le monde.
  var titre = r ? r.titre : (jpSuisCreateur() && sec ? sec.titre_attendu : '');
  if(!titre){ bande.hidden = true; return; }

  bande.hidden = false;
  bande.className = 'jp-trouve' + (r ? '' : ' jp-trouve-attendu');
  var t1 = document.createElement('span');
  t1.className = 'jp-trouve-titre';
  t1.textContent = titre;
  bande.appendChild(t1);
  var t2 = document.createElement('span');
  t2.className = 'jp-trouve-par';
  t2.textContent = r
    ? (jpTrouveParMoi(p) ? t('jp_par_vous') : t('jp_par_nom', r.nom))
    : t('jp_bande_attendu');
  bande.appendChild(t2);
}

function jpRendreIndices(p){
  var zone = jpEl('jp-indices');
  jpVider(zone);
  (JP_INDICES[String(p.id)] || []).forEach(function(i){
    var d = document.createElement('div');
    d.className = 'jp-indice';
    var puce = document.createElement('span');
    puce.className = 'jp-indice-puce';
    puce.textContent = '💡';
    d.appendChild(puce);
    var txt = document.createElement('span');
    txt.textContent = i.texte;
    d.appendChild(txt);
    zone.appendChild(d);
  });
}

function jpRendreVerdictCourant(p){
  var m = JP_MES[String(p.id)];
  var txt = jpEl('jp-verdict-txt');
  var ess = jpEl('jp-essais');
  var v = jpEl('jp-verdict');
  v.className = 'jp-verdict';
  if(jpSuisCreateur()){
    // L'animateur a le titre attendu sous les yeux, mais sur la bande posee
    // au bas de l'image : inutile de le repeter ici.
    txt.textContent = t('jp_vous_animez');
    ess.textContent = '';
    return;
  }
  // Tombe par quelqu'un d'autre : la course est finie pour ce photogramme.
  // Le titre et le nom sont sur la bande, au bas de l'image ; ici on dit
  // seulement qu'il n'y a plus rien a chercher, et on ferme la saisie.
  var tombe = jpTombeParUnAutre(p);
  if(tombe){
    v.classList.add('jp-verdict-tombe');
    txt.textContent = t('jp_tombe', tombe.nom);
    ess.textContent = '';
    return;
  }
  if(!m){ txt.textContent = ''; ess.textContent = ''; return; }
  if(m.statut === 'accepte'){
    v.classList.add('jp-verdict-ok');
    txt.textContent = t('jp_trouve_en', [jpChrono(m.elapsed_ms || 0), m.points || 0]);
  } else if(m.statut === 'en_attente'){
    v.classList.add('jp-verdict-attente');
    txt.textContent = t('jp_en_arbitrage', m.texte);
  } else {
    v.classList.add('jp-verdict-non');
    txt.textContent = t('jp_refuse', m.texte);
  }
  ess.textContent = '';
}

// Envoi d'une réponse. Trois choses s'enchaînent sans se gêner :
// l'affichage change tout de suite, le champ se vide tout de suite, et la
// base tranche ensuite. Si elle contredit l'affichage, l'affichage se
// corrige — ce qui n'arrive qu'en cas de panne.
function jpRepondre(){
  if(!jpConnecte()){ jpExigeConnexion(); return; }
  var saisie = jpEl('jp-reponse');
  var texte = saisie.value.trim();
  if(!texte) return;
  var p = JP_PHOTOS[JP_IDX];
  if(!p) return;
  var k = String(p.id);
  if(JP_MES[k] && JP_MES[k].statut === 'accepte') return;

  saisie.value = '';
  var v = jpEl('jp-verdict');
  var txt = jpEl('jp-verdict-txt');
  v.className = 'jp-verdict';
  txt.textContent = t('jp_envoi', texte);

  // `jeu_repondre` est idempotente : renvoyer deux fois le meme titre rend
  // le verdict precedent sans consommer d'essai. On peut donc, ici et
  // seulement ici, rejouer un envoi perdu sans rien fausser.
  tcWithRetryTimeout(function(){
    return JP_SB.rpc('jeu_repondre', { p_photogramme_id: p.id, p_texte: texte });
  }, { timeoutMs: 12000 }).then(function(r){
    if(r && r.error) throw tcSbError(r.error, 'jeu_repondre');
    var d = r.data || {};
    if(d.statut === 'deja') return;

    JP_MES[k] = {
      statut: d.statut, texte: texte,
      points: d.points || 0, elapsed_ms: d.elapsed_ms || 0
    };
    jpMajVignette(p.id);
    jpMajScoreBandeau();

    var ess = jpEl('jp-essais');
    v.className = 'jp-verdict jp-verdict-anime';
    if(d.statut === 'accepte'){
      v.classList.add('jp-verdict-ok');
      txt.textContent = t('jp_bravo', d.points || 0);
      jpAnnoncer(t('jp_bravo', d.points || 0));
      jpAnnoncerTrouvaille(p.position);
      // On enchaine : le joueur n'a pas a chercher lui-meme l'image
      // suivante. 850 ms, le temps de voir le vert.
      setTimeout(function(){
        if(JP_PHOTOS[JP_IDX] && String(JP_PHOTOS[JP_IDX].id) === k) jpAllerPhoto(jpPremierNonTrouve());
      }, 850);
    } else if(d.statut === 'en_attente'){
      v.classList.add('jp-verdict-attente');
      txt.textContent = d.repete ? t('jp_deja_propose') : t('jp_soumis_arbitrage');
      jpAnnoncer(txt.textContent);
    } else {
      v.classList.add('jp-verdict-non');
      txt.textContent = t('jp_pas_ca');
      jpAnnoncer(txt.textContent);
    }
    ess.textContent = (d.essais_restants === null || d.essais_restants === undefined)
      ? '' : t('jp_essais_restants', d.essais_restants);
    jpEl('jp-reponse').focus();
  }).catch(function(e){
    v.className = 'jp-verdict jp-verdict-non';
    txt.textContent = jpErreur(e);
    // Le texte est rendu : la frappe d'un joueur ne se perd pas sur une
    // coupure reseau.
    if(!saisie.value) saisie.value = texte;
    saisie.focus();
  });
}

// Le compteur du bandeau.
//
// Pour un joueur : SES trouvailles. Pour l'animateur, qui ne joue pas, ce
// chiffre valait toujours zero — c'etait le defaut signale. Il voit desormais
// ce qui a ete trouve A LA TABLE, c'est-a-dire le nombre de photogrammes
// tombes, qui est la seule chose qui l'interesse pendant la partie.
function jpMajScoreBandeau(){
  var total = JP_PHOTOS.length;

  if(jpSuisCreateur()){
    var tombes = 0;
    JP_PHOTOS.forEach(function(p){ if(JP_REVELE[p.position]) tombes++; });
    var ce = jpEl('jp-score-trouves');
    if(ce) ce.textContent = tombes + '/' + total;
    return;
  }

  var local = 0;
  JP_PHOTOS.forEach(function(p){
    var m = JP_MES[String(p.id)];
    if(m && m.statut === 'accepte') local++;
  });

  // Ma ligne de `jeu_scores` sert de filet : elle rattrape un evenement
  // perdu, par exemple un arbitrage. Mais elle est relue toutes les quinze
  // secondes seulement : juste apres une bonne reponse, elle est en retard
  // d'un cran. Prendre le plus grand des deux, c'est afficher la trouvaille
  // a l'instant ou elle a lieu, sans rien perdre de la correction du
  // serveur — c'etait le defaut signale : le compteur restait sur l'ancien
  // chiffre jusqu'a la relecture suivante.
  var trouves = local;
  if(JP_MOI){
    for(var i = 0; i < JP_SCORES.length; i++){
      if(String(JP_SCORES[i].contributor_id) === String(JP_MOI.id)){
        if(typeof JP_SCORES[i].trouves === 'number'){
          trouves = Math.max(local, JP_SCORES[i].trouves);
        }
        break;
      }
    }
  }
  var a = jpEl('jp-score-trouves');
  if(a) a.textContent = trouves + '/' + total;
}


// ── 14. LES ÉMOJIS DE LA DISCUSSION ──────────────────────────
// Les emojis etaient une rangee sous la pellicule : on cliquait, une bulle
// montait a l'ecran de tout le monde, et il n'en restait rien. Ils sont
// desormais dans la discussion, ou ils servent : un clic les ecrit dans le
// message en cours, a l'endroit du curseur, et ils partent avec lui.

function jpRendreEmojis(){
  var zone = jpEl('jp-chat-emojis');
  if(!zone || zone.getAttribute('data-pret')) return;
  JP_SMILEYS.forEach(function(e){
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'jp-emoji';
    b.textContent = e;
    b.setAttribute('aria-label', t('jp_emoji_ajouter', e));
    b.setAttribute('title', t('jp_emoji_ajouter', e));
    b.addEventListener('click', function(){ jpAjouterEmoji(e); });
    zone.appendChild(b);
  });
  zone.setAttribute('data-pret', '1');
}

function jpAjouterEmoji(emoji){
  var champ = jpEl('jp-chat-texte');
  if(!champ || champ.disabled) return;
  // A l'endroit du curseur, et le curseur reste juste apres : on peut en
  // poser trois de suite, ou en glisser un au milieu d'une phrase deja ecrite.
  var d = champ.selectionStart, f = champ.selectionEnd;
  if(typeof d === 'number' && typeof f === 'number'){
    champ.value = champ.value.slice(0, d) + emoji + champ.value.slice(f);
    var apres = d + emoji.length;
    try{ champ.setSelectionRange(apres, apres); }catch(e){}
  } else {
    champ.value += emoji;
  }
  champ.focus();
}


// ── LE CHAT DE LA PARTIE (point 10) ────────────────────────────────────────
// Les messages passent tous par la fonction « jeu_dire » de la base : c'est
// elle, et elle seule, qui a le droit d'ecrire dans la table. La raison est
// le filtre des titres — il ne peut pas vivre ici, puisque le navigateur
// d'un joueur n'a pas le droit de connaitre les titres attendus. S'il
// vivait ici, il suffirait d'ouvrir la console pour le contourner.
var JP_MESSAGES = [];
var JP_CHAT_CHARGE = false;

function jpChargerChat(){
  if(!JP_PARTIE) return Promise.resolve();
  return JP_SB.from('jeu_messages')
    .select('id,session_id,contributor_id,texte,created_at')
    .eq('session_id', JP_PARTIE.id)
    .order('created_at', { ascending: false })
    .limit(100)
    .then(function(r){
      if(!r || r.error) return;
      JP_MESSAGES = (r.data || []).slice().reverse();
      JP_CHAT_CHARGE = true;
      var manquants = JP_MESSAGES.map(function(m){ return m.contributor_id; })
        .filter(function(id){ return id && !JP_GENS[String(id)]; });
      if(manquants.length) return jpChargerGens(manquants).then(jpRendreChat);
      jpRendreChat();
    }, function(){});
}

function jpAjouterMessage(m){
  if(!m || !m.id) return;
  for(var i = 0; i < JP_MESSAGES.length; i++){ if(String(JP_MESSAGES[i].id) === String(m.id)) return; }
  JP_MESSAGES.push(m);
  if(JP_MESSAGES.length > 200) JP_MESSAGES.shift();
  if(m.contributor_id && !JP_GENS[String(m.contributor_id)]){
    jpChargerGens([m.contributor_id]).then(jpRendreChat);
    return;
  }
  jpRendreChat();
}

function jpRetirerMessage(id){
  for(var i = 0; i < JP_MESSAGES.length; i++){
    if(String(JP_MESSAGES[i].id) === String(id)){ JP_MESSAGES.splice(i, 1); break; }
  }
  jpRendreChat();
}

function jpRendreChat(){
  jpRendreEmojis();
  var ul = jpEl('jp-chat');
  var vide = jpEl('jp-chat-vide');
  if(!ul) return;
  // On ne redescend l'ascenseur que si l'on y etait deja : sinon on
  // arracherait des yeux un message qu'on etait en train de lire.
  var enBas = ul.scrollHeight - ul.scrollTop - ul.clientHeight < 40;
  jpVider(ul);
  if(vide) vide.style.display = JP_MESSAGES.length ? 'none' : '';
  var createur = jpSuisCreateur();
  JP_MESSAGES.forEach(function(m){
    var g = JP_GENS[String(m.contributor_id)] || {};
    var moi = JP_MOI && String(m.contributor_id) === String(JP_MOI.id);
    var li = document.createElement('li');
    li.className = 'jp-chat-ligne' + (moi ? ' jp-chat-moi' : '');
    var nom = document.createElement('span');
    nom.className = 'jp-chat-nom';
    nom.textContent = formatContribNamePlain(g.display_name || '…');
    li.appendChild(nom);
    var txt = document.createElement('span');
    txt.className = 'jp-chat-txt';
    txt.textContent = m.texte;
    li.appendChild(txt);
    if(createur){
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'jp-chat-retirer';
      x.textContent = '✕';
      x.setAttribute('aria-label', t('jp_chat_retirer'));
      x.addEventListener('click', function(){
        JP_SB.from('jeu_messages').delete().eq('id', m.id).then(function(){ jpRetirerMessage(m.id); }, function(){});
      });
      li.appendChild(x);
    }
    ul.appendChild(li);
  });
  if(enBas) ul.scrollTop = ul.scrollHeight;
}

function jpChatEtat(msg, duree){
  var el = jpEl('jp-chat-etat');
  if(!el) return;
  el.textContent = msg || '';
  if(msg) jpAnnoncer(msg);
  if(duree) setTimeout(function(){ if(el.textContent === msg) el.textContent = ''; }, duree);
}

function jpDire(){
  if(!jpConnecte()){ jpExigeConnexion(); return; }
  if(!JP_PARTIE) return;
  var champ = jpEl('jp-chat-texte');
  var bouton = jpEl('jp-chat-envoyer');
  var texte = (champ.value || '').trim();
  if(!texte) return;

  champ.disabled = true; if(bouton) bouton.disabled = true;
  jpChatEtat(t('jp_chat_envoi'));
  tcWithRetryTimeout(function(){
    return JP_SB.rpc('jeu_dire', { p_session_id: JP_PARTIE.id, p_texte: texte });
  }, { retries: 0, timeoutMs: 12000 }).then(function(r){
    champ.disabled = false; if(bouton) bouton.disabled = false;
    if(r && r.error) throw tcSbError(r.error, 'jeu_dire');
    var d = r.data || {};
    if(d.ok){
      champ.value = '';
      jpChatEtat('');
      champ.focus();
      return;
    }
    // Le message n'est pas parti : on le laisse dans le champ, il n'y a
    // qu'a le corriger.
    if(d.raison === 'titre')            jpChatEtat(t('jp_chat_err_titre'), 8000);
    else if(d.raison === 'trop_vite')   jpChatEtat(t('jp_chat_err_vite'), 4000);
    else if(d.raison === 'non_connecte')jpChatEtat(t('jp_chat_err_connexion'), 6000);
    else                                jpChatEtat(t('jp_chat_err'), 6000);
    champ.focus();
  }).catch(function(e){
    champ.disabled = false; if(bouton) bouton.disabled = false;
    jpChatEtat(jpErreur(e), 8000);
    champ.focus();
  });
}


// ── 15. LE DIRECT (Realtime) ───────────────────────────────────────────────

function jpAbonner(){
  if(JP_CANAL || !JP_PARTIE) return;
  var sid = JP_PARTIE.id;
  var moi = JP_MOI ? String(JP_MOI.id) : 'visiteur-' + jpAlea().slice(0, 8);

  JP_CANAL = JP_SB.channel('jeu:' + sid, {
    config: { presence: { key: moi }, broadcast: { self: false } }
  });

  // Le classement : la seule table qui change souvent, et la plus legere.
  JP_CANAL.on('postgres_changes',
    { event: '*', schema: 'public', table: 'jeu_scores', filter: 'session_id=eq.' + sid },
    function(msg){ jpSurScore(msg.new || msg.old, msg.eventType); });

  // Les reponses : la RLS fait que seul le createur en recoit d'autres que
  // les siennes. C'est ce qui alimente son plateau d'arbitrage, en direct.
  JP_CANAL.on('postgres_changes',
    { event: '*', schema: 'public', table: 'jeu_reponses', filter: 'session_id=eq.' + sid },
    function(msg){ jpSurReponse(msg.new, msg.eventType); });

  JP_CANAL.on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'jeu_indices_reveles', filter: 'session_id=eq.' + sid },
    function(){ jpRafraichirIndices(); });

  // La partie elle-meme : une cloture anticipee arrive ainsi chez tout le
  // monde a la seconde, sans que personne ait rien a demander.
  JP_CANAL.on('postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'jeu_sessions', filter: 'id=eq.' + sid },
    function(msg){ if(msg.new) { JP_PARTIE = msg.new; } });

  // Un photogramme vient de tomber : on ne croit pas l'annonce sur parole,
  // elle sert seulement de signal. C'est la base qui dit QUOI et PAR QUI.
  JP_CANAL.on('broadcast', { event: 'trouvaille' }, function(msg){
    if((msg.payload || {}).p) jpChargerTrouves();
  });

  JP_CANAL.on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'jeu_messages', filter: 'session_id=eq.' + sid },
    function(msg){ if(msg.new) jpAjouterMessage(msg.new); });

  JP_CANAL.on('postgres_changes',
    { event: 'DELETE', schema: 'public', table: 'jeu_messages', filter: 'session_id=eq.' + sid },
    function(msg){ if(msg.old && msg.old.id) jpRetirerMessage(msg.old.id); });

  JP_CANAL.on('presence', { event: 'sync' }, jpRendrePresents);

  JP_CANAL.subscribe(function(statut){
    if(statut !== 'SUBSCRIBED') return;
    // On dessine le panneau tout de suite. L'evenement « sync » n'arrive que
    // lorsque la liste CHANGE : sans cet appel, un visiteur seul sur la page
    // (ou non connecte, qui ne s'annonce pas) resterait devant un panneau
    // vide, sans meme le « personne pour l'instant ».
    jpRendrePresents();
    if(jpConnecte()){
      try{
        JP_CANAL.track({
          id: String(JP_MOI.id),
          nom: formatContribNamePlain(JP_MOI.display_name),
          avatar: JP_MOI.avatar_url || null
        });
      }catch(e){}
    }
  });
}

// ── LES FILMS TROUVÉS (points 1, 3 et 7) ────────────────────────
// Dès qu'un photogramme tombe, trois choses doivent être vraies pour TOUT LE
// MONDE : le titre attendu s'affiche, le nom de qui l'a trouvé aussi, et le
// photogramme sort du jeu — c'est une course, le premier marque.
//
// D'où vient le titre. PAS du joueur qui a trouvé : il a pu écrire une
// variante (« Breathless » pour « À bout de souffle »), et celui qui arrive
// en retard ou qui recharge la page n'aurait rien entendu. Il vient de la
// base, par « jeu_trouves », qui ne rend que les photogrammes DÉJÀ tombes —
// les seuls dont le titre ne soit plus un secret.
//
// L'annonce sur le canal ne sert donc plus qu'à une chose : prévenir les
// autres tout de suite, sans attendre la relecture périodique.
var JP_REVELE = {};              // position -> { nom, titre }
var JP_TROUVES_EN_VOL = false;   // une relecture est deja en route
var JP_TROUVES_A_REFAIRE = false;// une annonce est arrivee pendant celle-ci

// La saisie m'est-elle ouverte dans cette partie ? (l'animateur ne joue pas,
// un visiteur non connecte non plus). Retenu pour ne pas rouvrir par
// megarde un champ que l'etat de la partie avait ferme.
var JP_SAISIE_OUVERTE = false;

function jpAnnoncerTrouvaille(position){
  if(JP_CANAL){
    try{
      JP_CANAL.send({ type: 'broadcast', event: 'trouvaille', payload: { p: position } });
    }catch(e){ /* l'annonce est un agrement : son echec ne gene pas la partie */ }
  }
  jpChargerTrouves();
}

// Relit la liste des photogrammes tombes. C'est la base qui fait foi.
//
// Deux annonces peuvent tomber coup sur coup. On n'en lance pas deux a la
// fois : la seconde se contente de demander une relecture de plus des que la
// premiere est revenue — sans quoi une trouvaille pouvait etre perdue.
function jpChargerTrouves(){
  if(!JP_PARTIE) return Promise.resolve();
  if(JP_TROUVES_EN_VOL){ JP_TROUVES_A_REFAIRE = true; return Promise.resolve(); }
  JP_TROUVES_EN_VOL = true;
  JP_TROUVES_A_REFAIRE = false;
  var jeton = JP_JETON;
  var fini = function(){
    JP_TROUVES_EN_VOL = false;
    if(JP_TROUVES_A_REFAIRE && jeton === JP_JETON){
      JP_TROUVES_A_REFAIRE = false;
      jpChargerTrouves();
    }
  };
  return JP_SB.rpc('jeu_trouves', { p_session_id: JP_PARTIE.id }).then(function(r){
    if(jeton === JP_JETON && r && !r.error) jpNoterTrouves(r.data || []);
    fini();
  }, fini);
}

function jpNoterTrouves(lignes){
  var neuves = [];
  (lignes || []).forEach(function(x){
    var pos = Number(x && x.pos);
    if(!pos) return;
    if(!JP_REVELE[pos]) neuves.push(pos);
    JP_REVELE[pos] = {
      nom: x.nom ? formatContribNamePlain(x.nom) : '',
      titre: x.titre || ''
    };
  });
  jpRendreTrouves();
  jpMajVignettesRevelees();
  jpMajScoreBandeau();
  var courant = JP_PHOTOS[JP_IDX];
  if(courant){
    jpRendreVerdictCourant(courant);
    jpRendreTrouve(courant);
    jpMajSaisie(courant, false);
  }
  jpMajPlein();
  // Pour qui ne voit pas l'ecran : on annonce ce qui vient de tomber, sauf
  // ce que l'on vient de trouver soi-meme (deja annonce par le verdict).
  neuves.forEach(function(pos){
    var ph = jpPhotoPosition(pos);
    if(ph && jpTrouveParMoi(ph)) return;
    var r = JP_REVELE[pos];
    jpAnnoncer(r.titre ? t('jp_journal_ligne_titre', [r.nom, pos, r.titre])
                       : t('jp_journal_ligne', [r.nom, pos]));
  });
}

function jpPhotoPosition(pos){
  for(var i = 0; i < JP_PHOTOS.length; i++){
    if(JP_PHOTOS[i].position === pos) return JP_PHOTOS[i];
  }
  return null;
}

function jpTrouveParMoi(p){
  var m = p && JP_MES[String(p.id)];
  return !!(m && m.statut === 'accepte');
}

// Un photogramme tombe se ferme pour tout le monde : sa vignette le montre,
// et on ne peut plus y repondre.
function jpMajVignettesRevelees(){
  JP_PHOTOS.forEach(function(p){
    if(!JP_REVELE[p.position]) return;
    var b = document.querySelector('.jp-vignette[data-ph="' + p.id + '"]');
    if(b) b.classList.add('jp-vignette-tombe');
  });
}

// Ouvre ou ferme le champ de reponse selon le photogramme affiche. Appelee
// au changement d'image, mais aussi quand un photogramme tombe pendant qu'on
// le regarde : sans cela, on continuait a taper une reponse sur un
// photogramme deja pris.
function jpMajSaisie(p, replacerLeCurseur){
  var saisie = jpEl('jp-reponse');
  var valider = jpEl('jp-btn-valider');
  if(!saisie) return;
  var ferme = !!jpTombeParUnAutre(p);
  // On ne reactive pas un champ que l'etat de la partie a desactive
  // (animateur, visiteur non connecte) : on n'ajoute que la fermeture
  // propre aux photogrammes tombes.
  if(ferme){
    saisie.disabled = true;
    if(valider) valider.disabled = true;
  } else if(JP_SAISIE_OUVERTE){
    saisie.disabled = false;
    if(valider) valider.disabled = false;
  }
  if(replacerLeCurseur && !saisie.disabled){ saisie.value = ''; saisie.focus(); }
}

// Le photogramme affiche est-il hors jeu pour moi ? (tombe par un autre)
function jpTombeParUnAutre(p){
  var r = p && JP_REVELE[p.position];
  if(!r) return null;
  if(jpTrouveParMoi(p)) return null;   // c'est moi qui l'ai trouve
  return r;
}

// Le panneau de droite : les films trouves, dans l'ordre des photogrammes
// (et non dans l'ordre des decouvertes), avec le titre ATTENDU.
function jpRendreTrouves(){
  var ul = jpEl('jp-journal');
  var vide = jpEl('jp-journal-vide');
  if(!ul) return;
  jpVider(ul);
  var n = 0;
  JP_PHOTOS.forEach(function(p){
    var r = JP_REVELE[p.position];
    if(!r) return;
    n++;
    var li = document.createElement('li');
    li.className = 'jp-journal-ligne' + (jpTrouveParMoi(p) ? ' jp-journal-moi' : '');
    // La pastille porte le numero pour l'oeil ; elle ne dit rien a un lecteur
    // d'ecran, qui recevrait « 3 » sans savoir de quoi il s'agit. On la lui
    // cache, et on lui donne la phrase entiere dans un texte invisible.
    // (Un « aria-label » sur le <li> serait refuse : cet attribut n'est pas
    // permis sur un element sans role — le controle d'accessibilite le
    // signalait.)
    var num = document.createElement('span');
    num.className = 'jp-journal-num';
    num.setAttribute('aria-hidden', 'true');
    num.textContent = p.position;
    li.appendChild(num);

    var corps = document.createElement('span');
    corps.className = 'jp-journal-corps';
    corps.setAttribute('aria-hidden', 'true');
    var ti = document.createElement('span');
    ti.className = 'jp-journal-titre';
    ti.textContent = r.titre || t('jp_journal_sans_titre');
    corps.appendChild(ti);
    var par = document.createElement('span');
    par.className = 'jp-journal-par';
    par.textContent = jpTrouveParMoi(p) ? t('jp_par_vous') : t('jp_par_nom', r.nom);
    corps.appendChild(par);
    li.appendChild(corps);

    var lu = document.createElement('span');
    lu.className = 'jp-lu-seulement';
    lu.textContent = r.titre ? t('jp_journal_ligne_titre', [r.nom, p.position, r.titre])
                             : t('jp_journal_ligne', [r.nom, p.position]);
    li.appendChild(lu);
    ul.appendChild(li);
  });
  if(vide) vide.style.display = n ? 'none' : '';
}

function jpRendrePresents(){
  var zone = jpEl('jp-presents');
  if(!zone || !JP_CANAL) return;
  var etat = {};
  try{ etat = JP_CANAL.presenceState() || {}; }catch(e){ return; }
  var vus = {}, gens = [];
  Object.keys(etat).forEach(function(k){
    (etat[k] || []).forEach(function(g){
      if(!g || !g.id || vus[g.id]) return;
      vus[g.id] = 1;
      gens.push(g);
    });
  });
  jpVider(zone);
  if(!gens.length){
    var v = document.createElement('span');
    v.className = 'jp-aide';
    v.textContent = t('jp_personne_ici');
    zone.appendChild(v);
    return;
  }
  gens.forEach(function(g){
    var s = document.createElement('span');
    s.className = 'jp-present';
    s.appendChild(jpPastille({ display_name: g.nom, avatar_url: g.avatar }));
    s.appendChild(document.createTextNode(g.nom || '?'));
    zone.appendChild(s);
  });
}

function jpSurScore(ligne, type){
  if(!ligne || !ligne.contributor_id) return;
  var id = String(ligne.contributor_id);
  var i = -1;
  for(var k = 0; k < JP_SCORES.length; k++){ if(String(JP_SCORES[k].contributor_id) === id){ i = k; break; } }
  if(type === 'DELETE'){ if(i >= 0) JP_SCORES.splice(i, 1); }
  else if(i >= 0) JP_SCORES[i] = ligne;
  else JP_SCORES.push(ligne);

  if(!JP_GENS[id]){
    jpChargerGens([ligne.contributor_id]).then(function(){
      jpRendreClassement('jp-rangs', id);
      jpMajScoreBandeau();
    });
    return;
  }
  jpRendreClassement('jp-rangs', id);
  jpMajScoreBandeau();
  // Quelqu'un vient de trouver : on le dit, sans dire QUOI.
  if(JP_MOI && id !== String(JP_MOI.id) && type !== 'DELETE'){
    var g = JP_GENS[id];
    if(g) jpAnnoncer(t('jp_a_trouve', formatContribNamePlain(g.display_name)));
  }
}

function jpSurReponse(ligne, type){
  if(!ligne) return;
  // Ma propre reponse arbitree par le createur : l'affichage suit.
  if(JP_MOI && String(ligne.contributor_id) === String(JP_MOI.id)){
    var k = String(ligne.photogramme_id);
    var avant = JP_MES[k];
    if(!avant || avant.statut !== 'accepte' || ligne.statut === 'accepte'){
      JP_MES[k] = { statut: ligne.statut, texte: ligne.texte, points: ligne.points, elapsed_ms: ligne.elapsed_ms };
      jpMajVignette(ligne.photogramme_id);
      jpMajScoreBandeau();
      var p = JP_PHOTOS[JP_IDX];
      if(p && String(p.id) === k) jpRendreVerdictCourant(p);
      if(ligne.statut === 'accepte' && avant && avant.statut === 'en_attente'){
        jpAnnoncer(t('jp_arbitre_accepte'));
        var ph = null;
        for(var z = 0; z < JP_PHOTOS.length; z++){ if(String(JP_PHOTOS[z].id) === k){ ph = JP_PHOTOS[z]; break; } }
        if(ph) jpAnnoncerTrouvaille(ph.position);
      }
    }
  }
  if(jpSuisCreateur() && type !== 'DELETE'){
    jpChargerArbitrage();
    // L'animateur voit passer toutes les reponses : si celle-ci est bonne,
    // un photogramme vient de tomber, et son compteur doit le dire tout de
    // suite plutot qu'a la relecture suivante.
    if(ligne.statut === 'accepte') jpChargerTrouves();
  }
}

function jpRafraichirIndices(){
  if(!JP_PARTIE) return;
  JP_SB.rpc('jeu_indices', { p_session_id: JP_PARTIE.id }).then(function(r){
    if(!r || r.error) return;
    JP_INDICES = {};
    (r.data || []).forEach(function(i){
      var k = String(i.photogramme_id);
      (JP_INDICES[k] = JP_INDICES[k] || []).push(i);
    });
    var p = JP_PHOTOS[JP_IDX];
    if(p) jpRendreIndices(p);
  }, function(){});
}

// Les indices à retardement ne déclenchent aucun événement : personne ne
// les « publie », ils deviennent simplement dus. On rappelle donc la liste
// de temps en temps — c'est la seule interrogation périodique du jeu, et la
// plus légère : une poignée de lignes toutes les vingt secondes.
setInterval(function(){
  if(JP_PARTIE && JP_ETAT === 'en_cours' && document.visibilityState === 'visible') jpRafraichirIndices();
}, 20000);

// Meme filet pour les scores. Le direct reste la source normale — c'est lui
// qui donne la seconde pres. Mais un evenement peut toujours se perdre : une
// reconnexion, un passage en veille, un reseau qui hoquette. Relire la table
// toutes les quinze secondes garantit que le nombre de films trouves finit
// par etre juste, au lieu de rester fige jusqu'a la fin de la partie.
setInterval(function(){
  if(!JP_PARTIE || JP_ETAT !== 'en_cours' || document.visibilityState !== 'visible') return;
  jpChargerScores().then(function(){
    jpRendreClassement('jp-rangs');
    jpMajScoreBandeau();
  }, function(){});
  jpChargerTrouves();
}, 15000);

// Le retour d'un onglet mis en veille : le navigateur a pu couper le direct
// pendant tout ce temps. On remet les compteurs d'aplomb sans attendre le
// prochain quart de minute.
document.addEventListener('visibilitychange', function(){
  if(document.visibilityState !== 'visible') return;
  if(!JP_PARTIE || JP_ETAT !== 'en_cours') return;
  jpRafraichirIndices();
  jpChargerScores().then(function(){
    jpRendreClassement('jp-rangs');
    jpMajScoreBandeau();
  }, function(){});
  jpChargerTrouves();
});


// ── 16. LE CLASSEMENT ──────────────────────────────────────────────────────

function jpChargerScores(){
  if(!JP_PARTIE) return Promise.resolve();
  return JP_SB.from('jeu_scores').select('session_id,contributor_id,trouves,points,temps_total_ms,dernier_at')
    .eq('session_id', JP_PARTIE.id).then(function(r){
      if(!r || r.error) return;
      JP_SCORES = r.data || [];
      return jpChargerGens(JP_SCORES.map(function(s){ return s.contributor_id; })).then(function(){
        jpRendreClassement('jp-rangs');
      });
    }, function(){});
}

function jpTrier(){
  return JP_SCORES.slice().sort(function(a, b){
    if(b.points !== a.points) return b.points - a.points;
    if(a.temps_total_ms !== b.temps_total_ms) return a.temps_total_ms - b.temps_total_ms;
    return b.trouves - a.trouves;
  });
}

function jpRendreClassement(cible, idAnime){
  var ol = jpEl(cible);
  if(!ol) return;
  var lot = jpTrier();
  jpVider(ol);
  if(!lot.length){
    if(cible === 'jp-res-rangs'){
      var vide = jpEl('jp-res-rangs-vide');
      if(vide) vide.style.display = '';
    }
    if(cible === 'jp-rangs'){
      var p = document.createElement('li');
      p.className = 'jp-aide';
      p.textContent = t('jp_classement_vide');
      ol.appendChild(p);
    }
    return;
  }
  var vide2 = jpEl('jp-res-rangs-vide');
  if(vide2 && cible === 'jp-res-rangs') vide2.style.display = 'none';

  lot.forEach(function(s, i){
    var g = JP_GENS[String(s.contributor_id)] || {};
    var li = document.createElement('li');
    li.className = 'jp-rang jp-rang-' + (i + 1);
    if(JP_MOI && String(s.contributor_id) === String(JP_MOI.id)) li.classList.add('jp-rang-moi');
    if(idAnime && String(s.contributor_id) === idAnime) li.classList.add('jp-rang-neuf');

    var pos = document.createElement('span');
    pos.className = 'jp-rang-pos';
    pos.textContent = (i + 1);
    li.appendChild(pos);

    li.appendChild(jpPastille(g));

    var nom = document.createElement('span');
    nom.className = 'jp-rang-nom';
    nom.textContent = formatContribNamePlain(g.display_name || '…');
    li.appendChild(nom);

    var pts = document.createElement('span');
    pts.className = 'jp-rang-pts';
    pts.textContent = s.points;
    var det = document.createElement('span');
    det.className = 'jp-rang-detail';
    det.textContent = s.trouves + (JP_PHOTOS.length ? '/' + JP_PHOTOS.length : '');
    pts.appendChild(det);
    li.appendChild(pts);

    ol.appendChild(li);
  });
}


// ── 17. L'ARBITRAGE (créateur) ─────────────────────────────────────────────

function jpChargerArbitrage(){
  if(!JP_PARTIE || !jpSuisCreateur()) return;
  JP_SB.from('jeu_reponses')
    .select('id,photogramme_id,contributor_id,texte,submitted_at,elapsed_ms')
    .eq('session_id', JP_PARTIE.id).eq('statut', 'en_attente')
    .order('submitted_at', { ascending: true }).limit(60)
    .then(function(r){
      if(!r || r.error) return;
      var lot = r.data || [];
      return jpChargerGens(lot.map(function(x){ return x.contributor_id; })).then(function(){
        jpRendreArbitrage(lot);
      });
    }, function(){});
}

function jpRendreArbitrage(lot){
  var ul = jpEl('jp-arbitrage');
  var vide = jpEl('jp-arbitrage-vide');
  var cpt = jpEl('jp-arbitrage-compte');
  if(!ul) return;
  jpVider(ul);
  if(cpt) cpt.textContent = lot.length ? '(' + lot.length + ')' : '';
  if(vide) vide.style.display = lot.length ? 'none' : '';

  lot.forEach(function(r){
    var ph = null;
    for(var i = 0; i < JP_PHOTOS.length; i++){ if(String(JP_PHOTOS[i].id) === String(r.photogramme_id)) { ph = JP_PHOTOS[i]; break; } }
    var sec = JP_SECRETS[String(r.photogramme_id)];
    var g = JP_GENS[String(r.contributor_id)] || {};

    var li = document.createElement('li');
    li.className = 'jp-arb';

    var haut = document.createElement('div');
    haut.className = 'jp-arb-haut';
    var num = document.createElement('span');
    num.className = 'jp-arb-num';
    num.textContent = '#' + (ph ? ph.position : '?');
    haut.appendChild(num);
    haut.appendChild(document.createTextNode(formatContribNamePlain(g.display_name || '…')));
    haut.appendChild(document.createTextNode(' · ' + jpChrono(r.elapsed_ms || 0)));
    li.appendChild(haut);

    var prop = document.createElement('div');
    prop.className = 'jp-arb-propose';
    prop.textContent = '« ' + r.texte + ' »';
    li.appendChild(prop);

    if(sec){
      var att = document.createElement('div');
      att.className = 'jp-arb-attendu';
      att.appendChild(document.createTextNode(t('jp_attendu') + ' '));
      var b = document.createElement('b');
      b.textContent = sec.titre_attendu;
      att.appendChild(b);
      li.appendChild(att);
    }

    var btns = document.createElement('div');
    btns.className = 'jp-arb-boutons';
    btns.appendChild(jpBoutonArb(t('jp_accepter'), 'jp-btn-oui', function(){ jpArbitrer(r.id, true, false, li); }));
    btns.appendChild(jpBoutonArb(t('jp_accepter_toujours'), 'jp-btn-oui', function(){ jpArbitrer(r.id, true, true, li); }));
    btns.appendChild(jpBoutonArb(t('jp_refuser'), 'jp-btn-non', function(){ jpArbitrer(r.id, false, false, li); }));
    li.appendChild(btns);

    ul.appendChild(li);
  });
}

function jpBoutonArb(texte, classe, action){
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'jp-btn jp-btn-petit ' + classe;
  b.textContent = texte;
  b.addEventListener('click', action);
  return b;
}

function jpArbitrer(id, accepte, variante, li){
  li.style.opacity = '0.45';
  li.querySelectorAll('button').forEach(function(b){ b.disabled = true; });
  tcWithRetryTimeout(function(){
    return JP_SB.rpc('jeu_arbitrer', {
      p_reponse_id: id, p_accepte: accepte, p_ajouter_variante: !!variante
    });
  }).then(function(r){
    if(r && r.error) throw tcSbError(r.error, 'jeu_arbitrer');
    if(li.parentNode) li.parentNode.removeChild(li);
    jpChargerArbitrage();
  }).catch(function(e){
    li.style.opacity = '';
    li.querySelectorAll('button').forEach(function(b){ b.disabled = false; });
    jpAnnoncer(jpErreur(e));
    alert(jpErreur(e));
  });
}

function jpRendreCommandesCreateur(){
  var zone = jpEl('jp-indices-commandes');
  if(!zone) return;
  jpVider(zone);
  var rien = true;
  JP_PHOTOS.forEach(function(p){
    var sec = JP_SECRETS[String(p.id)];
    if(!sec || !sec.indices || !sec.indices.length) return;
    var deja = (JP_INDICES[String(p.id)] || []).length;
    sec.indices.forEach(function(ind, k){
      if(k < deja) return;             // deja devoile
      rien = false;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'jp-btn jp-btn-petit';
      b.style.margin = '0 5px 5px 0';
      b.textContent = t('jp_devoiler', [p.position, k + 1]);
      b.title = ind.texte;
      b.addEventListener('click', function(){
        b.disabled = true;
        JP_SB.rpc('jeu_reveler_indice', { p_photogramme_id: p.id, p_rang: k + 1 }).then(function(r){
          if(r && r.error){ b.disabled = false; alert(jpErreur(r.error)); return; }
          jpRafraichirIndices();
          jpRendreCommandesCreateur();
        }, function(e){ b.disabled = false; alert(jpErreur(e)); });
      });
      zone.appendChild(b);
    });
  });
  if(rien){
    var p2 = document.createElement('p');
    p2.className = 'jp-aide';
    p2.textContent = t('jp_aucun_indice_restant');
    zone.appendChild(p2);
  }
}

function jpClore(){
  if(!JP_PARTIE || !confirm(t('jp_confirme_clore'))) return;
  JP_SB.from('jeu_sessions').update({ cloture_at: new Date(jpMaintenant()).toISOString() })
    .eq('id', JP_PARTIE.id).select(JP_COLONNES_PARTIE).single().then(function(r){
      if(r && r.error){ alert(jpErreur(r.error)); return; }
      JP_PARTIE = r.data;
    }, function(e){ alert(jpErreur(e)); });
}


// ── 18. LES RÉSULTATS ──────────────────────────────────────────────────────

function jpMontrerResultats(jeton){
  jpAfficher('resultats');
  jpEl('jp-gerer-resultats').style.display = jpSuisCreateur() ? '' : 'none';
  jpEl('jp-res-titre').textContent = JP_PARTIE.titre;
  var g = JP_GENS[String(JP_PARTIE.createur_id)];
  jpEl('jp-res-sous').textContent =
    t('jp_res_sous', [g ? formatContribNamePlain(g.display_name) : '…', tcDateHeure(JP_PARTIE.debut_at)]);

  Promise.all([
    JP_SB.from('jeu_scores').select('session_id,contributor_id,trouves,points,temps_total_ms,dernier_at')
      .eq('session_id', JP_PARTIE.id),
    JP_SB.rpc('jeu_solutions', { p_session_id: JP_PARTIE.id }),
    JP_SB.rpc('jeu_statistiques', { p_session_id: JP_PARTIE.id }),
    JP_SB.from('jeu_photogrammes').select('id,position,image_path').eq('session_id', JP_PARTIE.id).order('position'),
    jpConnecte()
      ? JP_SB.from('jeu_reponses').select('photogramme_id,statut,points,elapsed_ms')
          .eq('session_id', JP_PARTIE.id).eq('contributor_id', JP_MOI.id)
      : Promise.resolve({ data: [] })
  ]).then(function(res){
    if(jeton !== JP_JETON) return;
    JP_SCORES = (res[0] && res[0].data) || [];
    var solutions = (res[1] && res[1].data) || [];
    var stats = {};
    ((res[2] && res[2].data) || []).forEach(function(s){ stats[String(s.photogramme_id)] = s; });
    JP_PHOTOS = (res[3] && res[3].data) || [];
    JP_PHOTOS.forEach(function(p){ JP_URLS[String(p.id)] = jpUrlImage(p.image_path); });
    JP_MES = {};
    ((res[4] && res[4].data) || []).forEach(function(r){
      var k = String(r.photogramme_id);
      if(!JP_MES[k] || r.statut === 'accepte') JP_MES[k] = r;
    });

    return jpChargerGens(JP_SCORES.map(function(s){ return s.contributor_id; })).then(function(){
      if(jeton !== JP_JETON) return;
      jpRendrePodium();
      jpRendreClassement('jp-res-rangs');
      jpRendreSolutions(solutions, stats);
    });
  }).catch(function(e){
    if(jeton !== JP_JETON) return;
    jpEl('jp-res-sous').textContent = jpErreur(e);
  });
}

function jpRendrePodium(){
  var zone = jpEl('jp-podium');
  jpVider(zone);
  var lot = jpTrier().slice(0, 3);
  if(lot.length < 1){ zone.style.display = 'none'; return; }
  zone.style.display = '';
  // Ordre d'affichage : 2, 1, 3 — le vainqueur au milieu, surélevé, comme
  // un vrai podium. À deux, on s'en tient à l'ordre naturel : le vainqueur
  // à droite d'un second surprendrait plus qu'autre chose.
  var ordre = lot.length >= 3 ? [1, 0, 2] : (lot.length === 2 ? [0, 1] : [0]);
  ordre.forEach(function(i){
    var s = lot[i];
    if(!s) return;
    var g = JP_GENS[String(s.contributor_id)] || {};
    var d = document.createElement('div');
    d.className = 'jp-marche jp-marche-' + (i + 1);
    d.appendChild(jpCoupe(i + 1));
    var place = document.createElement('span');
    place.className = 'jp-lu-seulement';
    place.textContent = t('jp_place', i + 1);
    d.appendChild(place);
    d.appendChild(jpPastille(g, 54));
    var nom = document.createElement('div');
    nom.className = 'jp-marche-nom';
    nom.textContent = formatContribNamePlain(g.display_name || '…');
    d.appendChild(nom);
    var pts = document.createElement('div');
    pts.className = 'jp-marche-pts';
    pts.textContent = s.points + ' ' + t('jp_u_pts');
    d.appendChild(pts);
    var det = document.createElement('div');
    det.className = 'jp-marche-det';
    det.textContent = t('jp_trouves_sur', [s.trouves, JP_PHOTOS.length]);
    d.appendChild(det);
    zone.appendChild(d);
  });
}

// Les coupes du podium (point 5) : or, argent, bronze. Un dessin plutot
// qu'un emoji — un emoji garde la couleur que lui donne le systeme, et c'est
// justement la couleur qui porte le sens ici.
function jpCoupe(rang){
  var NS = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '30');
  svg.setAttribute('height', '30');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'jp-coupe jp-coupe-' + rang);
  ['M6 2.6h12V8a6 6 0 0 1-12 0V2.6Z',
   'M11 13.6h2v2.8h-2z',
   'M9.3 16.4h5.4l.9 3.1H8.4z',
   'M7.4 19.5h9.2v1.9H7.4z'].forEach(function(d){
    var pa = document.createElementNS(NS, 'path');
    pa.setAttribute('d', d);
    pa.setAttribute('fill', 'currentColor');
    svg.appendChild(pa);
  });
  var anses = document.createElementNS(NS, 'path');
  anses.setAttribute('d', 'M6 4.4H3.4v1.7A3.6 3.6 0 0 0 7 9.7M18 4.4h2.6v1.7A3.6 3.6 0 0 1 17 9.7');
  anses.setAttribute('fill', 'none');
  anses.setAttribute('stroke', 'currentColor');
  anses.setAttribute('stroke-width', '1.5');
  svg.appendChild(anses);
  return svg;
}

// « Anne », « Anne et Bruno », « Anne, Bruno et Claire ».
function jpListeNoms(noms){
  if(noms.length <= 1) return noms[0] || '';
  return noms.slice(0, -1).join(', ') + ' ' + t('jp_et') + ' ' + noms[noms.length - 1];
}

function jpRendreSolutions(solutions, stats){
  var zone = jpEl('jp-solutions');
  jpVider(zone);
  var joueurs = JP_SCORES.length;
  solutions.forEach(function(s){
    var k = String(s.photogramme_id);
    var d = document.createElement('div');
    d.className = 'jp-solution';

    var img = document.createElement('img');
    img.className = 'jp-solution-img';
    img.src = JP_URLS[k] || '';
    img.alt = s.titre;
    img.loading = 'lazy';
    d.appendChild(img);

    var corps = document.createElement('div');
    corps.className = 'jp-solution-corps';
    var num = document.createElement('div');
    num.className = 'jp-solution-num';
    num.textContent = t('jp_photogramme_n', s.pos);
    corps.appendChild(num);
    var ti = document.createElement('div');
    ti.className = 'jp-solution-titre';
    ti.textContent = s.titre;
    corps.appendChild(ti);
    if(s.realisateur){
      var me = document.createElement('div');
      me.className = 'jp-solution-meta';
      me.textContent = s.realisateur;
      corps.appendChild(me);
    }
    var st = stats[k];
    if(st){
      var ligne = document.createElement('div');
      ligne.className = 'jp-solution-stat';
      var noms = (st.trouveurs || []).map(function(n){ return formatContribNamePlain(n); });
      if(!st.trouve_par){
        ligne.textContent = t('jp_personne_trouve');
      } else if(noms.length){
        ligne.textContent = t('jp_trouve_par', jpListeNoms(noms));
      } else {
        // La base compte des reponses acceptees mais ne rend aucun nom (une
        // fiche effacee, par exemple) : on s'en tient au nombre.
        ligne.textContent = t('jp_trouve_par_n', [st.trouve_par, joueurs]);
      }
      corps.appendChild(ligne);
    }
    var mien = JP_MES[k];
    if(mien){
      var b = document.createElement('span');
      b.className = 'jp-etat jp-solution-perso' + (mien.statut === 'accepte' ? '' : ' jp-solution-perso-rate');
      b.textContent = mien.statut === 'accepte'
        ? t('jp_vous_trouve', jpChrono(mien.elapsed_ms || 0))
        : t('jp_vous_rate');
      corps.appendChild(b);
    }
    d.appendChild(corps);
    zone.appendChild(d);
  });
}


// ── 19. CLAVIER ────────────────────────────────────────────────────────────

// La saisie est le point le plus sensible du jeu : tout doit se faire au
// clavier, sans jamais quitter le champ. Les flèches ne changent de
// photogramme que si le champ est VIDE — sinon elles déplacent le curseur,
// comme partout ailleurs, et corriger une faute deviendrait un supplice.
function jpClavier(ev){
  if(JP_VUE !== 'jeu' || JP_ETAT !== 'en_cours') return;
  // Agrandissement ouvert : Echap le referme, les fleches changent d'image.
  if(JP_PLEIN){
    if(ev.key === 'Escape'){ ev.preventDefault(); jpFermerPlein(); return; }
    if(ev.key === 'ArrowLeft'){ ev.preventDefault(); jpAllerPhoto(JP_IDX - 1); return; }
    if(ev.key === 'ArrowRight'){ ev.preventDefault(); jpAllerPhoto(JP_IDX + 1); return; }
  }
  var saisie = jpEl('jp-reponse');
  var dansLaSaisie = document.activeElement === saisie;

  if(ev.key === 'Enter' && dansLaSaisie){ ev.preventDefault(); jpRepondre(); return; }
  if(ev.key === 'Escape' && dansLaSaisie){ saisie.value = ''; return; }

  var ailleurs = document.activeElement
    && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')
    && !dansLaSaisie;
  if(ailleurs) return;
  if(dansLaSaisie && saisie.value !== '') return;

  if(ev.key === 'ArrowLeft'){ ev.preventDefault(); jpAllerPhoto(JP_IDX - 1); }
  else if(ev.key === 'ArrowRight'){ ev.preventDefault(); jpAllerPhoto(JP_IDX + 1); }
}


// ── 20. DÉMARRAGE ──────────────────────────────────────────────────────────

// ── LES IMAGES NE SE PRENNENT PAS (point 5) ──────────────────────
// Le geste que l'on veut empecher est precis : clic droit sur le
// photogramme, « Rechercher l'image avec Google », et la partie est finie.
// On coupe donc le menu contextuel, le glisser-deposer vers un autre onglet
// et la copie, sur la scene, sur l'agrandissement et sur la pellicule. Le
// CSS fait le reste (selection impossible, pas de menu au appui long).
//
// CE QUE CELA NE FAIT PAS, et il faut le savoir : une capture d'ecran marche
// toujours, et l'adresse de l'image reste lisible dans les outils de
// developpement du navigateur. Pour afficher une image, il faut bien la lui
// donner. Ceci arrete le geste facile, pas quelqu'un de determine.
//
// Le studio et la page de resultats ne sont PAS proteges : l'animateur doit
// pouvoir manipuler ses images, et apres la partie il n'y a plus rien a
// cacher.
function jpProtegerImages(){
  ['jp-scene', 'jp-plein', 'jp-pellicule'].forEach(function(id){
    var zone = jpEl(id);
    if(!zone) return;
    ['contextmenu', 'dragstart', 'copy', 'cut'].forEach(function(ev){
      zone.addEventListener(ev, function(e){ e.preventDefault(); });
    });
  });
}

function jpBrancher(){
  jpEl('btn-dark').addEventListener('click', toggleDark);
  jpEl('btn-lang').addEventListener('click', toggleLang);
  jpEl('btn-logout').addEventListener('click', function(){
    try{ localStorage.removeItem('tc-display-name'); }catch(e){}
    JP_SB.auth.signOut();
  });

  jpEl('btn-login').addEventListener('click', jpSeConnecter);
  jpEl('login-password').addEventListener('keydown', function(ev){ if(ev.key === 'Enter') jpSeConnecter(); });
  jpEl('login-email').addEventListener('keydown', function(ev){ if(ev.key === 'Enter') jpSeConnecter(); });

  document.querySelectorAll('.pwd-toggle').forEach(function(b){
    b.addEventListener('click', function(){
      var i = jpEl(this.getAttribute('data-for'));
      if(!i) return;
      var cache = i.type === 'password';
      i.type = cache ? 'text' : 'password';
      this.style.color = cache ? 'var(--rouge)' : '';
    });
  });

  ['jp-retour-connexion', 'jp-retour-studio', 'jp-retour-avant', 'jp-retour-resultats'].forEach(function(id){
    var b = jpEl(id);
    if(b) b.addEventListener('click', function(){ jpAller('#parties'); });
  });

  jpEl('jp-btn-creer').addEventListener('click', function(){
    if(!jpExigeConnexion()) return;
    jpAller('#creer');
  });

  document.querySelectorAll('.jp-onglet').forEach(function(b){
    b.addEventListener('click', function(){
      JP_FILTRE = this.getAttribute('data-filtre');
      jpRendreParties();
    });
  });

  jpEl('jp-f-manuelle').addEventListener('change', jpMajManuelle);
  jpEl('jp-btn-enregistrer').addEventListener('click', jpEnregistrerPartie);
  jpEl('jp-btn-publier').addEventListener('click', jpPublier);
  jpEl('jp-btn-supprimer').addEventListener('click', jpSupprimerPartie);

  var depot = jpEl('jp-depot'), champFichiers = jpEl('jp-fichiers');
  tcRendreActivable(depot, function(){ champFichiers.click(); }, t('jp_depot_aria'));
  champFichiers.addEventListener('change', function(){
    if(this.files && this.files.length) jpEnvoyerFichiers(this.files);
    this.value = '';
  });
  ['dragenter', 'dragover'].forEach(function(e){
    depot.addEventListener(e, function(ev){ ev.preventDefault(); depot.classList.add('jp-survol'); });
  });
  ['dragleave', 'drop'].forEach(function(e){
    depot.addEventListener(e, function(ev){ ev.preventDefault(); depot.classList.remove('jp-survol'); });
  });
  depot.addEventListener('drop', function(ev){
    if(ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) jpEnvoyerFichiers(ev.dataTransfer.files);
  });

  ['jp-gerer-avant', 'jp-gerer-resultats', 'jp-gerer-jeu'].forEach(function(id){
    var b = jpEl(id);
    if(b) b.addEventListener('click', function(){
      if(JP_PARTIE) jpAller('#studio/' + JP_PARTIE.id);
    });
  });

  jpEl('jp-btn-valider').addEventListener('click', jpRepondre);
  jpEl('jp-prec').addEventListener('click', function(){ jpAllerPhoto(JP_IDX - 1); });
  jpEl('jp-suiv').addEventListener('click', function(){ jpAllerPhoto(JP_IDX + 1); });

  // Agrandissement : la loupe, l'image elle-meme, et le voile pour refermer.
  jpEl('jp-chat-envoyer').addEventListener('click', jpDire);
  jpEl('jp-chat-texte').addEventListener('keydown', function(ev){
    if(ev.key === 'Enter'){ ev.preventDefault(); jpDire(); }
  });

  jpEl('jp-loupe').addEventListener('click', jpBasculerPlein);
  jpEl('jp-image').addEventListener('click', jpOuvrirPlein);
  jpEl('jp-plein-fermer').addEventListener('click', jpFermerPlein);
  jpEl('jp-plein').addEventListener('click', function(ev){
    // Un clic n'importe ou sur le voile referme ; sauf sur les fleches, si
    // l'on en ajoutait un jour.
    if(ev.target === this || ev.target.id === 'jp-plein-img') jpFermerPlein();
  });
  jpEl('jp-btn-quitter').addEventListener('click', function(){ jpAller('#parties'); });
  jpEl('jp-btn-clore').addEventListener('click', jpClore);

  jpProtegerImages();
  document.addEventListener('keydown', jpClavier);
}

function jpSeConnecter(){
  // Memes libelles que submit.html : un seul vocabulaire de connexion
  // pour tout le site.
  tcLogin(JP_SB, {
    noFields:   t('sp_err_no_fields'),
    connecting: t('login_btn') + '\u2026',
    loginBtn:   t('login_btn'),
    loginError: t('sp_err_login')
  });
}

// Le changement de langue redessine ce qui est deja a l'ecran : sans cela,
// la page resterait a moitie traduite jusqu'au prochain rechargement.
window.tcAfterLangChange = function(){
  // Le studio ecrit certains libelles a la main (titre, 3e section) : sans ce
  // rappel, ils resteraient dans l'ancienne langue.
  if(JP_VUE === 'studio' && JP_BROUILLON){ jpRemplirStudio(JP_BROUILLON); jpRendreFiches(); }
  if(JP_VUE === 'parties') jpRendreParties();
  else if(JP_VUE === 'jeu' && JP_PHOTOS.length){
    jpRendrePellicule();
    var p = JP_PHOTOS[JP_IDX];
    if(p){ jpRendreIndices(p); jpRendreVerdictCourant(p); }
    jpRendreClassement('jp-rangs');
  }
};

JP_SB.auth.onAuthStateChange(function(evenement, session){
  // Le jeton d'acces est renouvele en silence toutes les heures. Le direct
  // garde celui qu'on lui a donne au depart : passe l'expiration, le serveur
  // cesse de lui envoyer les lignes que la regle de securite protege — donc
  // les scores des AUTRES joueurs. Le classement se figeait sans rien dire.
  if(evenement === 'TOKEN_REFRESHED'){
    JP_USER = session ? session.user : JP_USER;
    jpAuthRealtime(session);
    return;
  }
  if(evenement === 'INITIAL_SESSION' || evenement === 'SIGNED_IN'){
    JP_USER = session ? session.user : null;
    jpAuthRealtime(session);
    jpChargerMoi().then(function(){
      jpMajEntete();
      if(evenement === 'SIGNED_IN' && JP_VUE === 'connexion'){
        var vers = JP_RETOUR || '#parties';
        JP_RETOUR = '';
        jpAller(vers);
      } else if(JP_VUE === 'parties'){
        jpRendreParties();
      }
    });
  } else if(evenement === 'SIGNED_OUT'){
    JP_USER = null;
    JP_MOI = null;
    jpAuthRealtime(null);
    jpMajEntete();
    jpAller('#parties');
  }
});

// On synchronise l'horloge AVANT d'afficher quoi que ce soit : tous les
// etats de partie en dependent, et un premier affichage faux (« a venir »
// alors que la partie tourne) serait pire qu'un dixieme de seconde
// d'attente.
Promise.all([jpSynchroniser(), jpVerifierColonnes()]).then(function(){
  jpBrancher();
  jpRouter();
});
