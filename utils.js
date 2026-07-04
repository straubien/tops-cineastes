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

// Charge la table "cineastes" en totalité (paginé, db.max_rows plafonne à 1000 lignes/requête)
function tcLoadAllCineastes(sbClient, offset, pageSize){
  offset = offset || 0;
  pageSize = pageSize || 1000;
  return sbClient.from('cineastes').select('nom,fbid,url_facebook,duo,naissance,deces,vivant,tops_contributeurs,pays')
    .order('id', { ascending: true })
    .range(offset, offset + pageSize - 1)
    .then(function(res){
      var rows = res.data || [];
      if(rows.length === pageSize){
        return tcLoadAllCineastes(sbClient, offset + pageSize, pageSize).then(function(more){ return rows.concat(more); });
      }
      return rows;
    });
}

function parseTopsBrut(texte){
  var films = [];
  var rang = 0;
  texte.split('\n').forEach(function(line){
    line = line.trim();
    if(!line) return;
    var m = line.match(/^(\d+)[\.\-\)]\s*(.+)$/);
    if(!m) return;
    rang++;
    var contenu = m[2].trim();
    var annee = null;
    var anneeM = contenu.match(/\((\d{4})\)\s*$/);
    if(anneeM){
      annee = parseInt(anneeM[1]);
      contenu = contenu.slice(0, anneeM.index).trim();
    }
    films.push({ rang: rang, titre: contenu, annee: annee });
  });
  return films;
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
        url: location.href,
        user_agent: navigator.userAgent
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
