// Logique d'authentification partagée entre submit.html et admin.html
// (login Supabase, affichage des erreurs, synchronisation de l'URL avec
// l'état de connexion). Ne change aucun comportement existant : c'est
// une extraction du code qui était dupliqué à l'identique dans les deux
// pages.

function showError(msg){
  var el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.display = 'block';
}

// sbClient : client Supabase de la page appelante
// texts : { noFields, connecting, loginBtn, loginError }
function tcLogin(sbClient, texts){
  var email = document.getElementById('login-email').value.trim();
  var password = document.getElementById('login-password').value;
  var btn = document.getElementById('btn-login');
  var errEl = document.getElementById('login-error');

  if(!email || !password){
    showError(texts.noFields);
    return Promise.resolve();
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>' + texts.connecting;
  errEl.style.display = 'none';

  return sbClient.auth.signInWithPassword({ email: email, password: password }).then(function(res){
    if(res.error){
      btn.disabled = false;
      btn.textContent = texts.loginBtn;
      showError(texts.loginError);
    }
    return res;
  });
}

// Garde l'URL cohérente avec l'état de connexion réel quand l'utilisateur
// utilise le bouton précédent/suivant du navigateur (ne déclenche jamais
// de déconnexion : c'est purement un rattrapage visuel de l'URL).
// connectedHash : ex. '#mon-profil' ou '#dashboard'
// isLoggedIn : fonction sans argument retournant true/false
function tcSyncAuthHashOnPopstate(connectedHash, isLoggedIn){
  window.addEventListener('popstate', function(){
    if(location.hash === '#connexion' && isLoggedIn()){
      history.pushState(null, '', connectedHash);
    } else if(location.hash === connectedHash && !isLoggedIn()){
      history.pushState(null, '', '#connexion');
    }
  });
}
