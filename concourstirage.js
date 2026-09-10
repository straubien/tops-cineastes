// ═══════════════════════════════════════════════════════════════
// JEU-CONCOURS — outil de tirage au sort (page admin non liée dans le menu)
// ═══════════════════════════════════════════════════════════════

// ── À MODIFIER : mêmes dates que la constante identique dans concours-banner.js ──
var CONCOURS_DATE_DEBUT = '2026-09-10T00:00:00';
var CONCOURS_DATE_FIN   = '2026-09-24T23:59:59';
// ──────────────────────────────────────────────────────────────────────────────

var sb = tcCreateClient();
var currentUser = null;
var currentContributor = null;
// Un élément par cinéphile du site (éligible ou non) :
// { id, nom, avatar, hasAvatar, nbSoumissions, eligible, tickets }
var ctParticipants = [];
var ctWinnerIds = [];      // ids déjà tirés dans cette session

function afficherPeriode(){
  var debut = new Date(CONCOURS_DATE_DEBUT);
  var fin = new Date(CONCOURS_DATE_FIN);
  var el = document.getElementById('ct-periode-dates');
  if(!el) return;
  var opts = { day: 'numeric', month: 'long', year: 'numeric' };
  var txt = isNaN(debut.getTime()) || isNaN(fin.getTime())
    ? '(dates invalides — vérifier CONCOURS_DATE_DEBUT / CONCOURS_DATE_FIN)'
    : debut.toLocaleDateString('fr-FR', opts) + ' → ' + fin.toLocaleDateString('fr-FR', opts);
  el.textContent = txt;
}

// ═══════════════════════════════════════════════════════════════
// AUTH (réservé aux comptes contributors.is_admin = true)
// ═══════════════════════════════════════════════════════════════
function login(){
  return tcLogin(sb, {
    noFields: 'Merci de renseigner votre email et votre mot de passe.',
    connecting: 'Connexion…',
    loginBtn: 'Se connecter',
    loginError: 'Identifiants incorrects, ou compte non administrateur.'
  });
}

async function onLogin(user){
  currentUser = user;
  var res;
  try {
    res = await tcWithRetryTimeout(function(){ return sb.from('contributors').select('*').eq('auth_id', user.id).single(); });
  } catch(err){
    currentUser = null;
    document.getElementById('section-login').style.display = 'block';
    showError('Connexion établie, mais le profil n\'a pas pu être chargé (problème réseau). Rechargez la page et réessayez.');
    return;
  }
  if(res.error || !res.data || !res.data.is_admin){
    showError('Ce compte n\'a pas accès à l\'outil de tirage au sort.');
    await sb.auth.signOut();
    return;
  }
  currentContributor = res.data;
  document.getElementById('section-login').style.display = 'none';
  document.getElementById('section-tirage').style.display = 'block';
  document.getElementById('btn-logout').style.display = 'inline-block';
  afficherPeriode();
}

function onLogout(){
  currentUser = null;
  currentContributor = null;
  ctParticipants = [];
  ctWinnerIds = [];
  document.getElementById('section-tirage').style.display = 'none';
  document.getElementById('btn-logout').style.display = 'none';
  document.getElementById('section-login').style.display = 'block';
}

(async function(){
  var session = (await sb.auth.getSession()).data.session;
  if(session){ await onLogin(session.user); }
  else { document.getElementById('section-login').style.display = 'block'; }
  sb.auth.onAuthStateChange(async function(ev, sess){
    if(ev === 'SIGNED_IN' && sess) await onLogin(sess.user);
    if(ev === 'SIGNED_OUT') onLogout();
  });
})();

document.getElementById('btn-login').addEventListener('click', login);
document.getElementById('btn-logout').addEventListener('click', function(){ sb.auth.signOut(); });
['login-email','login-password'].forEach(function(id){
  document.getElementById(id).addEventListener('keydown', function(e){ if(e.key === 'Enter') login(); });
});

// ═══════════════════════════════════════════════════════════════
// CHARGEMENT DE TOUS LES CINÉPHILES + DÉTAIL DES CONDITIONS
// ═══════════════════════════════════════════════════════════════
document.getElementById('btn-charger').addEventListener('click', chargerParticipants);
document.getElementById('chk-only-eligible').addEventListener('change', function(){
  if(ctParticipants.length) renderParticipants();
});

async function chargerParticipants(){
  var btn = document.getElementById('btn-charger');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Chargement…';

  var onlyApproved = document.getElementById('chk-approved-only').checked;

  try {
    // Tous les cinéphiles du site (jusqu'à 5000, largement au-dessus de la
    // taille attendue de la table `contributors`).
    var contribRes = await tcWithRetryTimeout(function(){
      return sb.from('contributors').select('id, display_name, json_name, avatar_url').range(0, 4999);
    });
    if(contribRes.error) throw contribRes.error;

    var submQuery = sb.from('submissions')
      .select('contributor_id, submitted_at, status')
      .gte('submitted_at', CONCOURS_DATE_DEBUT)
      .lte('submitted_at', CONCOURS_DATE_FIN);
    if(onlyApproved) submQuery = submQuery.eq('status', 'approved');
    var submRes = await tcWithRetryTimeout(function(){ return submQuery; });
    if(submRes.error) throw submRes.error;

    var nbSoumissionsParContributeur = {};
    (submRes.data || []).forEach(function(row){
      nbSoumissionsParContributeur[row.contributor_id] = (nbSoumissionsParContributeur[row.contributor_id] || 0) + 1;
    });

    ctParticipants = (contribRes.data || []).map(function(c){
      var nbSoumissions = nbSoumissionsParContributeur[c.id] || 0;
      var hasAvatar = !!c.avatar_url;
      var eligible = nbSoumissions > 0;
      return {
        id: c.id,
        nom: c.display_name || c.json_name || ('Cinéphile #' + c.id),
        avatar: c.avatar_url || null,
        hasAvatar: hasAvatar,
        nbSoumissions: nbSoumissions,
        eligible: eligible,
        tickets: eligible ? (hasAvatar ? 2 : 1) : 0
      };
    }).sort(function(a,b){
      if(a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return a.nom.localeCompare(b.nom, 'fr');
    });
    ctWinnerIds = [];

    document.getElementById('ct-historique-wrap').style.display = 'none';
    document.getElementById('ct-historique').innerHTML = '';
    document.getElementById('ct-gagnant').innerHTML = '';

    if(!ctParticipants.length){
      document.getElementById('ct-resultats').style.display = 'none';
      document.getElementById('ct-empty').style.display = 'block';
    } else {
      document.getElementById('ct-empty').style.display = 'none';
      document.getElementById('ct-resultats').style.display = 'block';
      renderParticipants();
    }
  } catch(err){
    console.error('chargerParticipants:', err);
    alert('Erreur lors du chargement des cinéphiles. Vérifiez votre connexion et réessayez.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Charger les cinéphiles';
  }
}

function condCell(ok, texteOk, texteKo){
  var span = document.createElement('span');
  span.className = 'ct-cond';
  var pastille = document.createElement('span');
  pastille.className = ok ? 'ct-cond-ok' : 'ct-cond-ko';
  pastille.textContent = ok ? '✓' : '✕';
  span.appendChild(pastille);
  span.appendChild(document.createTextNode(ok ? texteOk : texteKo));
  return span;
}

function renderParticipants(){
  var eligibles = ctParticipants.filter(function(p){ return p.eligible; });
  var totalTickets = eligibles.reduce(function(sum,p){ return sum + p.tickets; }, 0);
  document.getElementById('ct-stat-participants').textContent = eligibles.length;
  document.getElementById('ct-stat-total').textContent = ctParticipants.length;
  document.getElementById('ct-stat-tickets').textContent = totalTickets;

  var onlyEligible = document.getElementById('chk-only-eligible').checked;
  var liste = onlyEligible ? eligibles : ctParticipants;

  var body = document.getElementById('ct-table-body');
  body.innerHTML = '';
  liste.forEach(function(p){
    var tr = document.createElement('tr');
    if(ctWinnerIds.indexOf(p.id) !== -1) tr.className = 'ct-gagnant';
    else if(!p.eligible) tr.className = 'ct-inelig';

    var tdNom = document.createElement('td');
    if(p.avatar){
      var img = document.createElement('img');
      img.className = 'ct-avatar';
      img.src = p.avatar;
      img.alt = '';
      tdNom.appendChild(img);
    }
    tdNom.appendChild(document.createTextNode(p.nom));
    tr.appendChild(tdNom);

    var tdSoumis = document.createElement('td');
    tdSoumis.appendChild(condCell(p.eligible, p.nbSoumissions + ' top(s)', 'Aucun'));
    tr.appendChild(tdSoumis);

    var tdAvatar = document.createElement('td');
    tdAvatar.appendChild(condCell(p.hasAvatar, 'Oui', 'Non'));
    tr.appendChild(tdAvatar);

    var tdTickets = document.createElement('td');
    var badge = document.createElement('span');
    badge.className = 'ct-ticket-badge' + (p.tickets > 1 ? ' double' : (p.tickets === 0 ? ' zero' : ''));
    badge.textContent = p.tickets === 0 ? 'non éligible' : (p.tickets + (p.tickets > 1 ? ' tickets (avatar)' : ' ticket'));
    tdTickets.appendChild(badge);
    tr.appendChild(tdTickets);

    body.appendChild(tr);
  });
}

// ═══════════════════════════════════════════════════════════════
// TIRAGE AU SORT (entièrement côté navigateur, rien n'est écrit en base)
// ═══════════════════════════════════════════════════════════════
document.getElementById('btn-tirer').addEventListener('click', tirerAuSort);

function tirerAuSort(){
  var pool = ctParticipants.filter(function(p){ return p.eligible && ctWinnerIds.indexOf(p.id) === -1; });

  var bag = [];
  pool.forEach(function(p){
    for(var i = 0; i < p.tickets; i++) bag.push(p);
  });
  if(!bag.length){
    document.getElementById('ct-gagnant').innerHTML = '<p class="ct-gagnant-rang">Tous les cinéphiles éligibles ont déjà été tirés.</p>';
    return;
  }
  var winner = bag[Math.floor(Math.random() * bag.length)];
  ctWinnerIds.push(winner.id);

  var rang = ctWinnerIds.length;
  var label = rang === 1 ? 'Gagnant·e' : 'Gagnant·e suppléant·e n°' + rang;
  var html = '<div class="ct-gagnant-rang">' + label + '</div>';
  html += '<div class="ct-gagnant-nom">' + escapeHtml(winner.nom) + '</div>';
  document.getElementById('ct-gagnant').innerHTML = html;

  var histWrap = document.getElementById('ct-historique-wrap');
  var hist = document.getElementById('ct-historique');
  var li = document.createElement('li');
  li.textContent = label + ' — ' + winner.nom;
  hist.appendChild(li);
  histWrap.style.display = 'block';

  renderParticipants();
}

function escapeHtml(s){
  var div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
