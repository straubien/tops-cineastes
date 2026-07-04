(function(){
  var btnLang=document.getElementById('btn-lang');
  if(btnLang) btnLang.addEventListener('click', toggleLang);
})();

if('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js?v=20260623').catch(function(){});
}

var CONTRIB_DATA=[];
var FAVORIS={};
var AVATAR_URLS={};
var SUPABASE_TOPS={}; // json_name → { cineaste_nom → [{titre,annee}] }
var IMPORTED_COUNTS={}; // json_name → {tops:N, films:N}
var activeFilter=null; // null | 'sans-tops' | 'non-couvert'
var currentUserJsonName=null;
var currentUserContribId=null; // id (contributors.id) du cinéphile connecté
var currentUserIsAdmin=false;

var DATA=null,currentLetter='A';
var _dataReadyResolve;
var DATA_READY=new Promise(function(res){_dataReadyResolve=res;}); // résolue une fois DATA.cineastes chargé (la pagination Supabase peut prendre plus d'un aller-retour)
var PHOTOS_TMDB={}; // nom cinéaste → profile_path TMDB (ou [path1,path2] pour les duos)
function buildPhotoHtml(photoVal,cls,size){
  if(Array.isArray(photoVal)){
    var single=photoVal[0]&&!photoVal[1]?photoVal[0]:(!photoVal[0]&&photoVal[1]?photoVal[1]:null);
    if(single) return '<img class="'+cls+'" src="https://image.tmdb.org/t/p/w'+size+escapeHtml(single)+'" alt="" loading="lazy">';
    return '<div class="'+cls+'-duo">'
      +(photoVal[0]?'<img class="'+cls+'" src="https://image.tmdb.org/t/p/w'+size+escapeHtml(photoVal[0])+'" alt="" loading="lazy">':'<div class="'+cls+' '+cls+'-empty"></div>')
      +(photoVal[1]?'<img class="'+cls+'" src="https://image.tmdb.org/t/p/w'+size+escapeHtml(photoVal[1])+'" alt="" loading="lazy">':'<div class="'+cls+' '+cls+'-empty"></div>')
      +'</div>';
  }
  return photoVal?'<img class="'+cls+'" src="https://image.tmdb.org/t/p/w'+size+escapeHtml(photoVal)+'" alt="" loading="lazy">':'<div class="'+cls+' '+cls+'-empty"></div>';
}
var MUZARD_DATA=null; // index par nom de cinéaste
var CNUDDE_DATA=null;  // index Karine Cnudde
var MUZARD_TOPS=null; // liste brute des tops importés Muzard
var CNUDDE_TOPS=null; // liste brute des tops importés Cnudde
var _impPanelItems=[];
var _impPanelSortMode='alpha';
var _impPanelOwnerName=null;
var _impPanelLetter=null;

var TC_SB=tcCreateClient({auth:{flowType:'implicit',detectSessionInUrl:false}});

// ── PRÉSENCE EN LIGNE ───────────────────────────────────────────
var TC_ONLINE_IDS=new Set();
var tcPresenceChannel=null;
function tcInitPresence(){
  if(tcPresenceChannel)return;
  tcPresenceChannel=TC_SB.channel('tc-online-presence');
  tcPresenceChannel.on('presence',{event:'sync'},function(){
    var state=tcPresenceChannel.presenceState();
    var ids=new Set();
    Object.keys(state).forEach(function(k){
      state[k].forEach(function(p){if(p.contributor_id)ids.add(String(p.contributor_id));});
    });
    TC_ONLINE_IDS=ids;
    tcRefreshOnlineBadges();
  });
  tcPresenceChannel.subscribe(function(status){
    if(status==='SUBSCRIBED'&&currentUserContribId)tcPresenceTrackSelf();
  });
}
function tcPresenceTrackSelf(){
  if(!tcPresenceChannel||!currentUserContribId)return;
  tcPresenceChannel.track({contributor_id:currentUserContribId});
}
function tcPresenceUntrackSelf(){
  if(tcPresenceChannel)tcPresenceChannel.untrack();
}
function tcRefreshOnlineBadges(){
  document.querySelectorAll('.contrib-bubble').forEach(function(div){
    var nm=div.getAttribute('data-name');
    var c=CONTRIB_DATA.find(function(x){return x.display_name===nm;});
    var dot=div.querySelector('.online-dot');
    if(dot)dot.style.display=(c&&TC_ONLINE_IDS.has(String(c.id)))?'':'none';
  });
  var profilDot=document.getElementById('profil-online-dot');
  if(profilDot)profilDot.style.display=(_currentContribData&&_currentContribData.id&&TC_ONLINE_IDS.has(String(_currentContribData.id)))?'':'none';
}
tcInitPresence();

function loadAllCineastes(offset,pageSize){
  return tcLoadAllCineastes(TC_SB,offset,pageSize);
}

// Charge TOUTES les soumissions approuvées en paginant (PostgREST plafonne à
// db.max_rows ~1000 lignes/requête, quel que soit le volume). Sans cette
// pagination, le fil d'actualités et la fusion des tops seraient tronqués
// silencieusement au-delà de ~1000 soumissions approuvées. Cf. audit 1.8.
// Retourne { data: [...toutes les lignes], error: null|err }.
function tcLoadAllApprovedSubmissions(selectStr, offset, pageSize){
  offset = offset || 0;
  pageSize = pageSize || 1000;
  return tcWithRetryTimeout(function(){
    return TC_SB.from('submissions').select(selectStr)
      .eq('status', 'approved')
      .order('submitted_at', { ascending: true })
      .range(offset, offset + pageSize - 1);
  }).then(function(res){
    if(res && res.error) return { data: [], error: res.error };
    var rows = (res && res.data) || [];
    if(rows.length === pageSize){
      return tcLoadAllApprovedSubmissions(selectStr, offset + pageSize, pageSize).then(function(more){
        return { data: rows.concat(more.data || []), error: more.error };
      });
    }
    return { data: rows, error: null };
  });
}

function loadData(){
  var listEl=document.getElementById('cineaste-list');
  if(listEl)listEl.innerHTML='<div class="empty-msg">Chargement…</div>';
  Promise.all([
    tcWithRetryTimeout(function(){ return loadAllCineastes(0,1000); }),
    tcFetchWithTimeout('muzard.json').then(function(r){return r.json()}).catch(function(){return null;}),
    tcFetchWithTimeout('cnudde.json').then(function(r){return r.json()}).catch(function(){return null;}),
    tcFetchWithTimeout('photos-tmdb.json').then(function(r){return r.json()}).catch(function(){return null;})
  ]).then(function(results){
  var cineastes=results[0]||[];
  var muzard=results[1];
  var cnudde=results[2];
  PHOTOS_TMDB=results[3]||{};

  DATA={cineastes:cineastes};
  _dataReadyResolve();
  if(!muzard||!cnudde){
    var warnEl=document.getElementById('data-load-warning');
    if(warnEl){
      warnEl.textContent='Certains tops n\'ont pas pu être chargés (' + (!muzard?'muzard.json':'') + (!muzard&&!cnudde?', ':'') + (!cnudde?'cnudde.json':'') + '). Rechargez la page.';
      warnEl.style.display='block';
    }
  }
  DATA.cineastes.forEach(function(c){
    if(Array.isArray(c.tops_contributeurs)){
      c.tops_contributeurs=c.tops_contributeurs.map(function(t){
        if(t==='MAT'||t==='MAT ')return 'MATHIEU MUZARD';
        if(t==='THOMAS F. FLAVIER')return 'THOMAS FLAVIER';
        if(t==='VINZ ORLOV')return 'VINZ J. ORLOV';
        if(t==='THOMAS D. DEMAEREL')return 'THOMAS DEMAEREL';
        return t;
      });
    }
  });

  // Construire un index nom cinéaste → liste de films à partir d'un objet tops
  function buildTopIndex(data){
    var idx={};
    if(!data||!data.tops)return idx;
    data.tops.forEach(function(top){
      var _key=top&&top.cineaste;
      if(typeof _key!=='string')return;
      var _normKey=_key.replace(/[\u2018\u2019\u02BC]/g,"'");
      idx[_key]=top.films;
      if(_normKey!==_key)idx[_normKey]=top.films;
      var a=top.cineaste.split('&');
      if(a.length>1){
        var k=a.map(function(p){return p.trim().split(',')[0].trim()}).join(' & ');
        if(!idx[k])idx[k]=top.films;
      }
    });
    return idx;
  }

  if(muzard&&muzard.tops){
    MUZARD_DATA=buildTopIndex(muzard);
    MUZARD_TOPS=muzard.tops;
    IMPORTED_COUNTS['MATHIEU MUZARD']={tops:muzard.tops.length,films:muzard.tops.reduce(function(s,t){return s+(t.films?t.films.length:0);},0)};
  }
  if(cnudde&&cnudde.tops){
    CNUDDE_DATA=buildTopIndex(cnudde);
    CNUDDE_TOPS=cnudde.tops;
    IMPORTED_COUNTS['KARINE CNUDDE']={tops:cnudde.tops.length,films:cnudde.tops.reduce(function(s,t){return s+(t.films?t.films.length:0);},0)};
  }

  init();
  }).catch(function(){
    var listEl=document.getElementById('cineaste-list');
    if(listEl)listEl.innerHTML='<div class="empty-msg">Erreur de chargement. <button class="btn-secondary" style="font-size:12px;padding:4px 12px;margin-left:8px" data-action="retry-load">Réessayer</button></div>';
  });
}
loadData();

function enterSite(){
  document.getElementById('splash').classList.add('hidden');
  document.getElementById('main-wrapper').classList.add('visible');
  history.replaceState({entered:true},'');
  sessionStorage.setItem('tc-entered','1');
  var savedPage=sessionStorage.getItem('tc-page');
  setTimeout(function(){navigate(savedPage||'index');},50);
}

function init(){
  buildAlpha();selectLetter('A');
  var _savedPage=sessionStorage.getItem('tc-page');
  if(_savedPage==='statistiques'){renderStatistiques();}
  // renderProfil is called after CONTRIB_DATA loads in the sbAuth block
}

// toTitleCase, escapeHtml, formatContribNamePlain, getAvatarFilename,
// getInitiales, formatContribName → définis dans utils.js

function formatNom(nom){
  if(nom.includes(' & ')){
    var parts=nom.split(' & ');
    var hasComma=parts.some(function(p){return p.includes(',');});
    return parts.map(function(p){
      if(p.includes(',')){var i=p.indexOf(',');return '<b>'+escapeHtml(p.slice(0,i))+'</b>'+escapeHtml(p.slice(i));}
      if(hasComma) return escapeHtml(p);
      return '<b>'+escapeHtml(p)+'</b>';   
    }).join(' & ');
  }
  if(nom.includes(',')){var i=nom.indexOf(',');return '<b>'+escapeHtml(nom.slice(0,i))+'</b>'+escapeHtml(nom.slice(i))}
  return '<b>'+escapeHtml(nom)+'</b>';
}
function formatDateSimple(n,d,v){
  if(!n)return '';if(d)return n+'\u2013'+d;if(v)return String(n);return String(n);
}
function formatDates(c){
  if(c.duo&&Array.isArray(c.naissance)){
    var d1=formatDateSimple(c.naissance[0],Array.isArray(c.deces)?c.deces[0]:null,Array.isArray(c.vivant)?c.vivant[0]:null);
    var d2=formatDateSimple(c.naissance[1],Array.isArray(c.deces)?c.deces[1]:null,Array.isArray(c.vivant)?c.vivant[1]:null);
    if(d1||d2)return(d1||'?')+'\u2002/\u2002'+(d2||'?');return '';
  }
  return formatDateSimple(c.naissance,c.deces,c.vivant);
}

function navigateProfil(name){
  sessionStorage.setItem('tc-profil',name);
  history.pushState({page:'profil',profil:name},'','#profil/'+encodeURIComponent(name));
  navigate('profil',true);
  renderProfil(name);
}

var _profilCineasteAll=false,_profilFilmsAll=false,_currentContribData=null,_currentProfilName=null;

function parseFilmStr(s){
  // Cas plage d'années : TITRE (REAL, AAAA-AA) ou (REAL, AAAA-AAAA)
  var m2=s.match(/^(.*?)\s*\(([^,()]+),\s*(\d{4})[\-\u2013](\d{2,4})\)\s*$/);
  if(m2){
    var debut=m2[3];var fin=m2[4];
    if(fin.length===2)fin=debut.slice(0,2)+fin;
    return{titre:m2[1].trim(),realisateur:m2[2].trim(),annee:debut+'\u2013'+fin};
  }
  // Cas sans virgule avant année avec plage: TITRE (REAL AAAA-AA)
  var m3=s.match(/^(.*?)\s*\(([^()]+?)\s+(\d{4})[\-\u2013](\d{2,4})\)\s*$/);
  if(m3){
    var debut=m3[3];var fin=m3[4];
    if(fin.length===2)fin=debut.slice(0,2)+fin;
    return{titre:m3[1].trim(),realisateur:m3[2].trim(),annee:debut+'\u2013'+fin};
  }
  // Cas avec parenthèses dans le titre : HISTOIRE(S) DU CINEMA (GODARD, 1988-98)
  var m5=s.match(/^(.*\))\s*\(([^,()]+),\s*(\d{4})[\-\u2013](\d{2,4})\)\s*$/);
  if(m5){
    var debut=m5[3];var fin=m5[4];
    if(fin.length===2)fin=debut.slice(0,2)+fin;
    return{titre:m5[1].trim(),realisateur:m5[2].trim(),annee:debut+'\u2013'+fin};
  }
  var m6=s.match(/^(.*\))\s*\(([^,()]+),\s*(\d{4})\)\s*$/);
  if(m6)return{titre:m6[1].trim(),realisateur:m6[2].trim(),annee:m6[3]};
  // Cas standard : TITRE (REALISATEUR, ANNEE)
  var m=s.match(/^(.*?)\s*\(([^,()]+),\s*(\d{4})\)\s*$/);
  if(m)return{titre:m[1].trim(),realisateur:m[2].trim(),annee:m[3]};
  // Cas sans année : TITRE (REALISATEUR)
  var m4=s.match(/^(.*?)\s*\(([^,()\\.\\d]+)\)\s*$/);
  if(m4)return{titre:m4[1].trim(),realisateur:m4[2].trim(),annee:''};
  return{titre:s,realisateur:'',annee:''};
}

function formatFavName(f){
  // "Mizoguchi, Kenji" → "Kenji Mizoguchi"
  if(f.indexOf(',')!==-1){
    var p=f.split(',');
    return p.slice(1).join(',').trim()+' '+p[0].trim();
  }
  return f;
}

function buildPortraitSrc(f){
  var particles=['De','Van','von','Von','Du','du','Di','di','Da','da','Le','La','del','Del','Della','lo','Lo'];
  if(f==='Straub/Huillet'||(/straub/i.test(f)&&/huillet/i.test(f)))return{src:'portraits/portrait-Straub.jpg',initials:'S'};
  if(/reis/i.test(f)&&/cordeiro/i.test(f))return{src:'portraits/portrait-Reis.jpg',initials:'R'};
  var normalized=f;
  if(f.indexOf(',')!==-1){normalized=f.split(',')[0].trim();}
  if(normalized.indexOf(' & ')!==-1){normalized=normalized.split(' & ')[0].trim();}
  var parts=normalized.split(' ');
  var last=parts[parts.length-1];
  var secondLast=parts.length>1?parts[parts.length-2]:'';
  var lastName=particles.indexOf(secondLast)!==-1?secondLast+' '+last:last;
  return{src:'portraits/portrait-'+lastName+'.jpg',initials:lastName.charAt(0)};
}

function renderProfilFavs(favs){
  var grid=document.getElementById('profil-favs-grid');grid.innerHTML='';
  if(!favs.length){grid.innerHTML='<div class="empty-msg">Aucun cinéaste favori renseigné</div>';return}
  favs.forEach(function(f,fi){
    var p=buildPortraitSrc(f);
    var isFirst=fi===0;
    var item=document.createElement('div');item.className='profil-fav-item';
    var imgClass='profil-fav-portrait'+(isFirst?' profil-fav-first':'');
    var initClass='profil-fav-initials'+(isFirst?' profil-fav-first':'');
    item.innerHTML='<img class="'+imgClass+'" src="'+escapeHtml(p.src)+'" alt="'+escapeHtml(f)+'" loading="lazy">'
      +'<div class="'+initClass+'" style="display:none">'+escapeHtml(p.initials)+'</div>'
      +'<div class="profil-fav-name">'+
      ((/straub/i.test(f)&&/huillet/i.test(f))?'Straub/Huillet':escapeHtml(formatFavName(f)))+'</div>';
    var favImg=item.querySelector('img');
    favImg.addEventListener('error',function(){this.style.display='none';this.nextElementSibling.style.display='flex';});
    grid.appendChild(item);
  });
}

function normalizeAutreNom(n){
  if(n.indexOf('STRAUB')!==-1&&n.indexOf('HUILLET')!==-1)return 'STRAUB/HUILLET';
  if(n.indexOf('REIS')!==-1&&n.indexOf('CORDEIRO')!==-1)return 'REIS/CORDEIRO';
  if(n.indexOf('POWELL')!==-1&&n.indexOf('PRESSBURGER')!==-1)return 'POWELL/PRESSBURGER';
  return n;
}
function formatAutreNom(n){
  n=normalizeAutreNom(n);
  // Convertir "NOM, Prénom" → "Prénom NOM"
  var idx=n.indexOf(',');
  if(idx!==-1){
    var last=n.slice(0,idx).trim();
    var first=n.slice(idx+1).trim();
    return first?first+' '+last:last;
  }
  return n;
}
function renderAutresCineaste(list,showAll){
  var el=document.getElementById('profil-autres-cineaste');
  var btn=document.getElementById('profil-autres-cineaste-btn');
  var shown=showAll?list:list.slice(0,10);
  el.innerHTML=shown.map(function(n,i){
    var display=formatAutreNom(n);
    var cls='profil-autre-item'+(display.length>22?' profil-autre-small':'');
    return '<div class="'+cls+'"><span class="profil-autre-num">'+(i+1)+'</span> '+escapeHtml(display)+'</div>';
  }).join('');
  if(list.length<=10){btn.style.display='none';}
  else{btn.style.display='inline-flex';btn.textContent=showAll?t('voir_moins_btn'):t('voir_plus_btn',list.length-10);}
}

function renderFilmsBlock(elId,list,showAll,limit,btnId){
  var el=document.getElementById(elId);
  var btn=document.getElementById(btnId);
  var shown=showAll?list:list.slice(0,limit);
  el.innerHTML=shown.map(function(s){
    var f=parseFilmStr(s);
    var info=escapeHtml(f.realisateur)+(f.annee?', '+escapeHtml(f.annee):'');
    return'<div class="profil-film-item"><div class="profil-film-titre">'+escapeHtml(f.titre)+'</div>'+(info?'<div class="profil-film-info">'+info+'</div>':'')+'</div>';
  }).join('');
  if(list.length<=limit){btn.style.display='none';}
  else{btn.style.display='inline-flex';btn.textContent=showAll?t('voir_moins_btn'):t('voir_plus_btn',list.length-limit);}
}

function toggleVoirPlus(type){
  if(type==='cineaste'){
    _profilCineasteAll=!_profilCineasteAll;
    renderAutresCineaste(_currentContribData.cineaste_autres,_profilCineasteAll);
  } else {
    _profilFilmsAll=!_profilFilmsAll;
    renderFilmsBlock('profil-films-autres',_currentContribData.film_autres,_profilFilmsAll,6,'profil-films-autres-btn');
  }
}

function renderProfil(name){
  _currentProfilName=name;
  // Reset avatarToken to cancel any in-flight image loads from a previous profile
  var _av=document.getElementById('profil-avatar');
  if(_av)_av.dataset.avatarToken='';
  var cin=DATA.cineastes.filter(function(c){return c.tops_contributeurs&&c.tops_contributeurs.indexOf(name)!==-1});
  var nameEl=document.getElementById('profil-name');
  nameEl.innerHTML=formatContribName(name);
  nameEl.style.fontSize='';
  for(var fs=40;fs>=18;fs--){nameEl.style.fontSize=fs+'px';if(nameEl.scrollWidth<=nameEl.offsetWidth)break;}
  var imp=IMPORTED_COUNTS[name]||{tops:0,films:0};
  var statHtml='<span>'+t('tops_postes',cin.length)+'</span>'
    +'<span style="opacity:.5"> &nbsp;·&nbsp; </span>'
    +'<span>'+t('films_dans_tops',imp.films)+'</span>';
  document.getElementById('profil-stat').innerHTML=statHtml;
  var listeTopsWrap=document.getElementById('profil-liste-tops-wrap');
  if(imp.tops>0){
    listeTopsWrap.style.display='';
    listeTopsWrap.innerHTML='<button class="profil-liste-tops-btn" data-imp-name="'+escapeHtml(name)+'">'+t('liste_des_tops')+'</button>';
  } else {
    listeTopsWrap.style.display='none';
    listeTopsWrap.innerHTML='';
  }
  _profilCineasteAll=false;_profilFilmsAll=false;

  var contrib=null;
  for(var i=0;i<CONTRIB_DATA.length;i++){if(CONTRIB_DATA[i].json_name===name){contrib=CONTRIB_DATA[i];break}}
  _currentContribData=contrib||{cineaste_coeur:[],cineaste_autres:[],film_coeur:[],film_autres:[],presentation:null};

  var avatarEl=document.getElementById('profil-avatar');
  if(avatarEl){
    avatarEl.innerHTML='';avatarEl.textContent=getInitiales(name);
    var avatarUrl=_currentContribData.avatar_url||AVATAR_URLS[name];
    if(avatarUrl){
      // Estampiller le chargement pour ignorer les réponses tardives d'un profil précédent
      var loadToken=Date.now();
      avatarEl.dataset.avatarToken=loadToken;
      var img=new Image();
      img.onload=function(){
        var el=document.getElementById('profil-avatar');
        if(el&&String(el.dataset.avatarToken)===String(loadToken)){
          var imgEl=document.createElement('img');imgEl.src=avatarUrl;imgEl.alt=escapeHtml(name);
          el.innerHTML='';el.appendChild(imgEl);
        }
      };
      img.src=avatarUrl;
    }
  }

  renderProfilFavs(FAVORIS[name]||[]);

  var autresBlock=document.getElementById('profil-autres-cineaste-block');
  if(_currentContribData.cineaste_autres&&_currentContribData.cineaste_autres.length){
    autresBlock.style.display='';
    var titreAutres=autresBlock.querySelector('.profil-section-title');
    if(titreAutres){titreAutres.textContent=t('profil_autres_cin');}
    renderAutresCineaste(_currentContribData.cineaste_autres,false);
  } else {autresBlock.style.display='none';}

  var filmsCoeurBlock=document.getElementById('profil-films-coeur-block');
  if(_currentContribData.film_coeur&&_currentContribData.film_coeur.length){
    filmsCoeurBlock.style.display='';
    var elFC=document.getElementById('profil-films-coeur');
    elFC.innerHTML=_currentContribData.film_coeur.map(function(s){
      var f=parseFilmStr(s);var info=escapeHtml(f.realisateur)+(f.annee?', '+escapeHtml(f.annee):'');
      return'<div class="profil-film-item"><div class="profil-film-titre">'+escapeHtml(f.titre)+'</div>'+(info?'<div class="profil-film-info">'+info+'</div>':'')+'</div>';
    }).join('');
  } else {filmsCoeurBlock.style.display='none';}

  var filmsAutresBlock=document.getElementById('profil-films-autres-block');
  if(_currentContribData.film_autres&&_currentContribData.film_autres.length){
    filmsAutresBlock.style.display='';
    renderFilmsBlock('profil-films-autres',_currentContribData.film_autres,false,6,'profil-films-autres-btn');
  } else {filmsAutresBlock.style.display='none';}

  var presBlock=document.getElementById('profil-presentation-block');
  if(_currentContribData.presentation){
    presBlock.style.display='';
    document.getElementById('profil-presentation-text').innerHTML=formatPresentation(_currentContribData.presentation);
  } else {presBlock.style.display='none';}

  tcRefreshOnlineBadges();
}

function showImportedPanel(name){
  var items=[];
  var rawTops=name==='MATHIEU MUZARD'?MUZARD_TOPS:(name==='KARINE CNUDDE'?CNUDDE_TOPS:null);
  if(rawTops){
    items=rawTops.map(function(top){return{cineaste:top.cineaste,count:top.films?top.films.length:0,films:top.films||[]};});
  } else if(SUPABASE_TOPS[name]){
    items=Object.keys(SUPABASE_TOPS[name]).map(function(cinNom){
      var films=SUPABASE_TOPS[name][cinNom]||[];
      return{cineaste:cinNom,count:films.length,films:films};
    });
  }
  if(!items.length)return;
  _impPanelItems=items;
  _impPanelSortMode='alpha';
  _impPanelOwnerName=name;
  _impPanelLetter=null;
  var html='<div class="fiche-header">'
    +'<button class="imp-panel-back" data-action="close-fiche" title="Retour">&#8592;</button>'
    +'<div class="fiche-name"><b>'+formatContribName(name)+'</b></div>'
    +'</div>'
    +'<div class="alpha-bar" id="imp-panel-alpha"></div>'
    +'<div class="imp-panel-content">'
    +'<div class="imp-panel-controls">'
    +'<span class="imp-panel-meta"></span>'
    +'<button id="imp-sort-btn" class="btn-secondary" style="font-size:13px;padding:6px 16px;color:#000;border-color:#000" data-action="imp-toggle-sort">↓ Films</button>'
    +'</div>'
    +'<div id="imp-panel-body"></div>'
    +'</div>';
  document.getElementById('fiche-content').innerHTML=html;
  _lastFocused=document.activeElement;
  var overlay=document.getElementById('fiche-overlay');
  overlay.classList.add('visible');
  document.body.style.overflow='hidden';
  _renderImpPanel();
  var _tcLang='fr';
  try{ _tcLang=localStorage.getItem('tc-lang')||'fr'; }catch(e){}
  applyLang(_tcLang);
}
function _buildImpAlpha(){
  var bar=document.getElementById('imp-panel-alpha');
  if(!bar)return;
  bar.innerHTML='';
  var letters={};
  _impPanelItems.forEach(function(it){letters[it.cineaste.charAt(0).toUpperCase()]=true;});
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(function(l){
    if(!letters[l])return;
    var col=document.createElement('div');
    col.className='alpha-col has-data'+(l===_impPanelLetter?' active':'');
    col.innerHTML='<div class="alpha-char">'+l+'</div>';
    col.onclick=function(){_impPanelLetter=(_impPanelLetter===l?null:l);_renderImpPanel();};
    bar.appendChild(col);
  });
}
function _renderImpPanel(){
  _buildImpAlpha();
  var sorted=_impPanelItems.slice().filter(function(it){
    return !_impPanelLetter||it.cineaste.charAt(0).toUpperCase()===_impPanelLetter;
  }).sort(function(a,b){
    if(_impPanelSortMode==='alpha')return a.cineaste.localeCompare(b.cineaste,'fr');
    var dir=_impPanelSortMode==='desc'?-1:1;
    return dir*(b.count-a.count);
  });
  var rows=sorted.map(function(it,i){
    var hasFilms=it.films&&it.films.length>0;
    var blockId='imp-b-'+i;
    var toggleHtml=hasFilms?'<span class="imp-panel-toggle">&#9660;</span>':'';
    var editHtml=(_impPanelOwnerName===currentUserJsonName)?('<button class="btn-secondary imp-panel-edit-btn" data-action="tc-edit-top" data-cineaste="'+escapeHtml(it.cineaste)+'">'+window.t('mt_fiche_btn_edit')+'</button>'):'';
    var rowHtml='<div class="imp-panel-row"><span class="imp-panel-cin">'+escapeHtml(it.cineaste)+'</span>'+editHtml+'<span class="imp-panel-count">'+it.count+' film'+(it.count!==1?'s':'')+'</span>'+toggleHtml+'</div>';
    var filmsHtml='';
    if(hasFilms){
      filmsHtml='<ol class="fiche-contrib-films">'+it.films.map(function(f){
        var s1='<span class="fiche-muzard-film">'+escapeHtml(f.titre)+'</span>'+(f.note?'<span class="film-note">('+escapeHtml(f.note)+')</span>':'');
        var s2='<span class="fiche-muzard-annee">'+escapeHtml(f.annee||'')+'</span>';
        return'<li>'+s1+s2+'</li>';
      }).join('')+'</ol>';
    }
    return'<div class="imp-panel-block'+(hasFilms?' has-films':'')+'" id="'+blockId+'"'+(hasFilms?' data-action="toggle-accordeon" data-block-id="'+blockId+'"':'')+'>'+rowHtml+filmsHtml+'</div>';
  }).join('');
  var bodyEl=document.getElementById('imp-panel-body');
  var metaEl=document.querySelector('.imp-panel-meta');
  var sortBtn=document.getElementById('imp-sort-btn');
  if(bodyEl)bodyEl.innerHTML=rows;
  if(metaEl)metaEl.textContent=sorted.length+' cinéaste'+(sorted.length!==1?'s':'');
  if(sortBtn)sortBtn.textContent=_impPanelSortMode==='desc'?'↓ Films':(_impPanelSortMode==='asc'?'↑ Films':'A→Z');
}
function impPanelToggleSort(){
  _impPanelSortMode=_impPanelSortMode==='alpha'?'desc':(_impPanelSortMode==='desc'?'asc':'alpha');
  _renderImpPanel();
}

function navigate(page,skipHash){
  var _prevPage=sessionStorage.getItem('tc-page');
  if(_prevPage==='index'&&page!=='index'){
    var _si=document.getElementById('search-input');
    if(_si&&_si.value)selectLetter(currentLetter);
  }
  sessionStorage.setItem('tc-page',page);
  if(!skipHash){
    var hash=page==='index'?'#index':'#'+page;
    history.pushState({page:page},'',hash);
  }
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('visible');p.classList.remove('page-active');});
  var el=document.getElementById('page-'+page);
  if(!el)return;
  el.classList.add('page-active');
  void el.offsetWidth;
  el.classList.add('visible');
  document.querySelectorAll('.nav a').forEach(function(a){a.classList.remove('active')});
  var navEl=document.getElementById('nav-'+page);
  if(navEl)navEl.classList.add('active');
  if(page==='actualites')renderActualites();
  if(page==='contributeurs')renderContributeurs();
  if(page==='statistiques')renderStatistiques();
  if(page==='profil'&&DATA&&!_currentProfilName){var _sp=sessionStorage.getItem('tc-profil');if(_sp)renderProfil(_sp);}
  if(page==='mes-tops'&&typeof window.mtOnNavigate==='function')window.mtOnNavigate();
  var bottomNav=document.getElementById('bottom-nav');
  if(bottomNav)bottomNav.style.display=(page==='profil'?'flex':'none');
  window.scrollTo(0,0);
}

window.addEventListener('popstate',function(e){
  var hash=location.hash;
  if(hash.startsWith('#profil/')){
    var name=decodeURIComponent(hash.slice(8));
    sessionStorage.setItem('tc-profil',name);
    navigate('profil',true);
    if(DATA)renderProfil(name);
  } else if(hash==='#actualites'||hash==='#contributeurs'||hash==='#statistiques'||hash==='#mes-tops'){
    navigate(hash.slice(1),true);
  } else {
    navigate('index',true);
  }
});

function getLetterData(l){return DATA?DATA.cineastes.filter(function(c){return c.nom.charAt(0).toUpperCase()===l}):[]}

function buildAlpha(){
  var bar=document.getElementById('alpha-bar');bar.innerHTML='';
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(function(l){
    var items=getLetterData(l);
    if(!items.length)return;
    var col=document.createElement('div');
    col.className='alpha-col has-data'+(l===currentLetter?' active':'');
    col.innerHTML='<div class="alpha-char">'+l+'</div>';
    col.onclick=function(){selectLetter(l)};
    bar.appendChild(col);
  });
}

function selectLetter(l){
  currentLetter=l;document.getElementById('search-input').value='';
  if(activeFilter!=='non-couvert'){activeFilter=null;updateFilterBtns();}
  document.querySelectorAll('.alpha-col').forEach(function(col){
    var char=col.querySelector('.alpha-char');
    col.classList.toggle('active',char&&char.textContent===l);
  });
  var items=getLetterData(l);items.sort(function(a,b){return a.nom.localeCompare(b.nom,'fr')});
  if(activeFilter==='non-couvert'){var covered=getCoveredCineastes();items=items.filter(function(c){return!covered.has(c.nom);});}
  renderList(items);
}

function renderList(items){
  var list=document.getElementById('cineaste-list'),count=document.getElementById('list-count');
  list.innerHTML='';
  if(!items.length){list.innerHTML='<div class="empty-msg">'+t('aucun_resultat')+'</div>';count.textContent='';return}
  count.textContent=t('cin_count',items.length);
  var maxTops=1;items.forEach(function(c){var n=(c.tops_contributeurs||[]).length;if(n>maxTops)maxTops=n});
  items.forEach(function(c){
    var row=document.createElement('div');row.className='cineaste-row';
    var nb=(c.tops_contributeurs||[]).length;
    var dates=formatDates(c);
    var datesHtml=dates?'<span class="c-dates">'+dates+'</span>':'';
    var photoPath=PHOTOS_TMDB[c.nom];
    var photoHtml=buildPhotoHtml(photoPath,'c-photo',92);
    row.innerHTML='<div class="c-bar"></div>'
      +photoHtml
      +'<div class="c-info"><span class="c-name">'+formatNom(c.nom)+'</span>'+datesHtml+'</div>'
      +'<div class="c-badge">'+nb+'</div>';
    row.onclick=function(){openFiche(c)};list.appendChild(row);
  });
}

function filterList(){
  var q=normStr(document.getElementById('search-input').value.trim());
  if(!q){if(activeFilter)applyFilter();else selectLetter(currentLetter);return}
  activeFilter=null;updateFilterBtns();
  var r=DATA.cineastes.filter(function(c){return normStr(c.nom).indexOf(q)!==-1;});
  r.sort(function(a,b){return a.nom.localeCompare(b.nom,'fr')});
  document.querySelectorAll('.alpha-col').forEach(function(col){col.classList.remove('active')});
  renderList(r);
}

function updateFilterBtns(){
  document.querySelectorAll('.filter-btn').forEach(function(b){
    b.classList.toggle('active',b.id==='filter-'+activeFilter);
  });
}

function getCoveredCineastes(){
  if(!currentUserJsonName)return new Set();
  if(currentUserJsonName==='MATHIEU MUZARD'&&MUZARD_DATA)return new Set(Object.keys(MUZARD_DATA));
  if(currentUserJsonName==='KARINE CNUDDE'&&CNUDDE_DATA)return new Set(Object.keys(CNUDDE_DATA));
  if(SUPABASE_TOPS[currentUserJsonName])return new Set(Object.keys(SUPABASE_TOPS[currentUserJsonName]));
  return new Set();
}

function applyFilter(){
  if(!DATA)return;
  var items;
  if(activeFilter==='sans-tops'){
    items=DATA.cineastes.filter(function(c){return(c.tops_contributeurs||[]).length===0;});
  } else if(activeFilter==='non-couvert'){
    var covered=getCoveredCineastes();
    items=DATA.cineastes.filter(function(c){return!covered.has(c.nom);});
  } else {selectLetter(currentLetter);return;}
  items.sort(function(a,b){return a.nom.localeCompare(b.nom,'fr');});
  document.querySelectorAll('.alpha-col').forEach(function(col){col.classList.remove('active');});
  document.getElementById('search-input').value='';
  renderList(items);
}

function toggleFilter(type){
  activeFilter=(activeFilter===type?null:type);
  updateFilterBtns();
  if(activeFilter)applyFilter();else selectLetter(currentLetter);
}

function updateCurrentUser(){
  var dn=null;
  try{ dn=localStorage.getItem('tc-display-name'); }catch(e){}
  if(!dn||!CONTRIB_DATA.length)return;
  var found=CONTRIB_DATA.find(function(c){return c.display_name===dn;});
  if(found){
    currentUserJsonName=found.json_name;
    currentUserContribId=found.id;
    currentUserIsAdmin=!!found.is_admin;
    var f2=document.getElementById('filter-non-couvert');if(f2)f2.style.display='';
  }
}

function openFiche(c){
  var nb=(c.tops_contributeurs||[]).length;
  var fbUrlSafe=(c.url_facebook&&/^https:\/\//i.test(c.url_facebook))?c.url_facebook:'';
  var fbHtml=fbUrlSafe?'<a class="fiche-fb-link" href="'+escapeHtml(fbUrlSafe)+'" target="_blank" rel="noopener noreferrer">Voir la fiche sur Facebook &#8599;</a>':'';

  // Construire la liste des contributeurs avec leurs films si disponibles
  var contribsDiv=document.createElement('div');
  if(nb>0){
    c.tops_contributeurs.slice().sort(function(a,b){
      var fa=(MUZARD_DATA&&a==='MATHIEU MUZARD'?MUZARD_DATA[c.nom]:CNUDDE_DATA&&a==='KARINE CNUDDE'?
    CNUDDE_DATA[c.nom]:SUPABASE_TOPS[a]?SUPABASE_TOPS[a][c.nom]:null)||[];
      var fb=(MUZARD_DATA&&b==='MATHIEU MUZARD'?MUZARD_DATA[c.nom]:CNUDDE_DATA&&b==='KARINE CNUDDE'?
    CNUDDE_DATA[c.nom]:SUPABASE_TOPS[b]?SUPABASE_TOPS[b][c.nom]:null)||[];
      return fb.length-fa.length;
    }).forEach(function(t){
      var films=null;
      if(MUZARD_DATA&&t==='MATHIEU MUZARD')films=MUZARD_DATA[c.nom]||null;
      else if(CNUDDE_DATA&&t==='KARINE CNUDDE')films=CNUDDE_DATA[c.nom]||null;
      else if(SUPABASE_TOPS[t])films=(SUPABASE_TOPS[t][c.nom])||null;
      var contribNom=formatContribNamePlain(t);
      var hasFilms=films&&films.length>0;
      var blockId='cb-'+t.replace(/[^a-zA-Z0-9]/g,'');
      var block=document.createElement('div');
      block.className='fiche-contrib-block'+(hasFilms?' has-films':'');
      block.id=blockId;
      var header=document.createElement('div');
      header.className='fiche-contrib-header';
      var nameEl=document.createElement('div');
      nameEl.className='fiche-contrib-name';
      nameEl.innerHTML=contribNom+(hasFilms?' <span class="fiche-contrib-count">('+films.length+')</span>':'');
      header.appendChild(nameEl);
      if(hasFilms){
        var tog=document.createElement('span');
        tog.className='fiche-contrib-toggle';
        tog.innerHTML='&#9660;';
        header.appendChild(tog);
        block.setAttribute('data-block-id',blockId);
        header.onclick=function(e){e.stopPropagation();toggleAccordeon(this.parentElement.getAttribute('data-block-id'));};
      } else {
        block.setAttribute('data-contrib-name',t);
        header.onclick=function(e){e.stopPropagation();openContribDetail(this.parentElement.getAttribute('data-contrib-name'));};
      }
      block.appendChild(header);
      if(hasFilms){
        var ol=document.createElement('ol');
        ol.className='fiche-contrib-films';
        films.forEach(function(f){
          var li=document.createElement('li');
          var s1=document.createElement('span');s1.className='fiche-muzard-film';s1.textContent=f.titre;
          if(f.note){var sn=document.createElement('span');sn.className='film-note';sn.textContent='('+f.note+')';li.appendChild(s1);li.appendChild(sn);}else{li.appendChild(s1);}
          var s2=document.createElement('span');s2.className='fiche-muzard-annee';s2.textContent=f.annee||'';
          li.appendChild(s2);ol.appendChild(li);
        });
        block.appendChild(ol);
      }
      var ownerId=tcContribIdByName(t);
      if(ownerId&&hasFilms){
        var cmWrap=document.createElement('div');
        cmWrap.className='tc-comments-wrap';
        cmWrap.innerHTML=tcCommentsToggleHtml(blockId+'-cm',ownerId,c.nom);
        block.appendChild(cmWrap);
      }
      contribsDiv.appendChild(block);
    });
  }

  var fichePhotoPath=PHOTOS_TMDB[c.nom];
  var fichePhotoHtml=buildPhotoHtml(fichePhotoPath,'fiche-photo',185);

  document.getElementById('fiche-content').innerHTML=
    '<div class="fiche-header">'
      +'<button class="profil-header-back" data-action="close-fiche" title="'+t('retour_contributeurs_title')+'">&#8592;</button>'
      +'<div class="fiche-header-top">'
        +fichePhotoHtml
        +'<div class="fiche-header-text">'
          +'<div class="fiche-name">'+formatNom(c.nom)+tcFlagHtml(c.pays,'fiche-flag')+'</div>'
          +'<div class="fiche-dates">'+formatDates(c)+'</div>'
        +'</div>'
      +'</div>'
    +'</div>'
    +'<div class="fiche-body">'
      +'<div class="fiche-stat-block">'
        +'<div class="fiche-stat-number">'+nb+'</div>'
        +'<div class="fiche-stat-bar"></div>'
        +'<div class="fiche-stat-label">'+t('fiche_stat_label')+'</div>'
      +'</div>'
      +'<div class="fiche-contribs"><div class="fiche-section">'+t('tops_postes_par')+'</div>'
        +'<div class="contrib-blocks" id="contribs-inner"></div>'
      +'</div>'
      +(currentUserJsonName?('<button class="btn-primary fiche-submit-top-btn" data-action="tc-submit-top" data-cineaste="'+escapeHtml(c.nom)+'">'+t('mt_fiche_btn_submit')+'</button>'):'')
    +'</div>'
    +fbHtml;

  var inner=document.getElementById('contribs-inner');
  if(nb>0){inner.appendChild(contribsDiv);}else{inner.innerHTML='<div class="empty-msg">'+t('aucun_top_poste_cin')+'</div>';}
  _lastFocused=document.activeElement;
  var overlay=document.getElementById('fiche-overlay');
  overlay.classList.add('visible');
  document.body.style.overflow='hidden';
  setTimeout(function(){var f=overlay.querySelector('[tabindex="0"],button,a');if(f)f.focus();},50);
}

function toggleAccordeon(id){
  var block=document.getElementById(id);
  if(!block)return;
  block.classList.toggle('open');
}

function closeFiche(){document.getElementById('fiche-overlay').classList.remove('visible');document.body.style.overflow='';if(_lastFocused&&_lastFocused.focus){try{_lastFocused.focus();}catch(e){}}}

// ── COMMENTAIRES SOUS LES TOPS ─────────────────────────────────
var TC_COMMENTS={}; // uid → { ownerId, cineasteNom, loaded, rows, replyTo:{id,author,snippet}|null, editingId }
var TC_EMOJIS=['😀','😂','😍','😉','👍','👏','🎬','🍿','❤️','😮','😢','😡','🤔','🙌','🔥','✨','🤣','😎','😱','👀'];

function tcContribIdByName(name){
  var c=CONTRIB_DATA.find(function(x){return x.json_name===name;});
  return c?c.id:null;
}
function tcContribById(id){
  return CONTRIB_DATA.find(function(x){return x.id===id;})||null;
}
function tcAuthorLabel(id){
  var c=tcContribById(id);
  if(!c)return 'Cinéphile';
  return c.display_name||c.json_name||'Cinéphile';
}
function tcAuthorAvatarHtml(id){
  var c=tcContribById(id);
  var jsonName=c?c.json_name:null;
  var url=jsonName?AVATAR_URLS[jsonName]:null;
  var initials=getInitiales(tcAuthorLabel(id));
  if(url)return '<span class="tc-cm-avatar"><img src="'+escapeHtml(url)+'" alt="" loading="lazy"></span>';
  return '<span class="tc-cm-avatar">'+escapeHtml(initials)+'</span>';
}
function tcActuAvatarHtml(id,fallbackName){
  var c=tcContribById(id);
  var jsonName=c?c.json_name:null;
  var url=jsonName?AVATAR_URLS[jsonName]:null;
  var initials=getInitiales(c?tcAuthorLabel(id):(fallbackName||'?'));
  if(url)return '<span class="actu-avatar"><img src="'+escapeHtml(url)+'" alt="" loading="lazy"></span>';
  return '<span class="actu-avatar">'+escapeHtml(initials)+'</span>';
}
function tcFormatDate(iso){
  try{
    var d=new Date(iso);
    return d.toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'})+' à '+d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
  }catch(e){return '';}
}
function tcRenderCommentBody(raw){
  return formatPresentation(raw);
}

function tcBubbleIconSvg(){
  return '<svg class="tc-cm-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3.2" y="4.5" width="17.6" height="11.5" rx="2"/><path d="M8.5 16l-1.8 3.6 4.6-3.6" stroke-linejoin="round"/></svg>';
}

function tcCommentsToggleHtml(uid,ownerId,cineasteNom){
  return '<button type="button" class="tc-cm-toggle-btn" title="'+t('tc_cm_voir')+'" aria-label="'+t('tc_cm_voir')+'" data-action="tc-toggle-comments" data-uid="'+uid+'" data-owner-id="'+ownerId+'" data-cineaste="'+escapeHtml(cineasteNom)+'" id="'+uid+'-btn">'+tcBubbleIconSvg()+'</button>'
    +'<div class="tc-cm-body" id="'+uid+'" data-loaded="0"></div>';
}

function tcToggleComments(uid,ownerId,cineasteNom){
  var body=document.getElementById(uid);
  if(!body)return;
  var open=body.classList.toggle('open');
  if(open&&body.getAttribute('data-loaded')!=='1'){
    tcLoadComments(uid,ownerId,cineasteNom);
  }
}

function tcLoadComments(uid,ownerId,cineasteNom){
  var body=document.getElementById(uid);
  if(!body)return;
  body.innerHTML='<div class="tc-cm-loading">'+t('tc_cm_chargement')+'</div>';
  tcWithRetryTimeout(function(){
    return TC_SB.from('comments').select('*')
      .eq('top_contributor_id',ownerId).eq('cineaste_nom',cineasteNom)
      .order('created_at',{ascending:true});
  })
    .then(function(res){
      var rows=res.data||[];
      TC_COMMENTS[uid]={ownerId:ownerId,cineasteNom:cineasteNom,loaded:true,rows:rows,replyTo:null,editingId:null};
      body.setAttribute('data-loaded','1');
      tcRenderComments(uid);
    },function(){
      body.innerHTML='<div class="tc-cm-error">'+t('tc_cm_erreur_chargement')+'</div>';
    });
}

function tcRenderComments(uid){
  var st=TC_COMMENTS[uid];
  var body=document.getElementById(uid);
  if(!st||!body)return;
  var btn=document.getElementById(uid+'-btn');
  if(btn)btn.innerHTML=tcBubbleIconSvg()+(st.rows.length?'<span class="tc-cm-count">'+st.rows.length+'</span>':'');
  var topLevel=st.rows.filter(function(r){return !r.parent_comment_id;});
  var byParent={};
  st.rows.forEach(function(r){
    if(r.parent_comment_id){
      if(!byParent[r.parent_comment_id])byParent[r.parent_comment_id]=[];
      byParent[r.parent_comment_id].push(r);
    }
  });
  var html='<div class="tc-cm-list">';
  if(!topLevel.length){
    html+='<div class="tc-cm-empty">'+t('tc_cm_aucun')+'</div>';
  }
  topLevel.forEach(function(cm){
    html+=tcCommentRowHtml(uid,cm,false,null);
    (byParent[cm.id]||[]).forEach(function(reply){
      html+=tcCommentRowHtml(uid,reply,true,cm);
    });
  });
  html+='</div>';
  html+=tcComposerHtml(uid);
  body.innerHTML=html;
  tcFocusComposerIfNeeded(uid);
}

function tcCommentRowHtml(uid,cm,isReply,parentCm){
  var isOwn=currentUserContribId&&cm.author_contributor_id===currentUserContribId;
  var canDelete=isOwn||currentUserIsAdmin;
  var st=TC_COMMENTS[uid];
  if(st&&st.editingId===cm.id){
    return '<div class="tc-cm-row'+(isReply?' tc-cm-reply':'')+'" id="tc-cm-row-'+cm.id+'">'+tcEditFormHtml(uid,cm)+'</div>';
  }
  var quoteHtml='';
  if(isReply&&parentCm){
    var snippet=parentCm.body.length>100?parentCm.body.slice(0,100)+'…':parentCm.body;
    quoteHtml='<div class="tc-cm-quote"><span class="tc-cm-quote-author">'+escapeHtml(tcAuthorLabel(parentCm.author_contributor_id))+'</span><span class="tc-cm-quote-text">'+escapeHtml(snippet)+'</span></div>';
  }
  var editedHtml=cm.updated_at?(' <span class="tc-cm-edited">('+t('tc_cm_modifie')+')</span>'):'';
  var actions='';
  if(currentUserContribId&&!isReply){
    actions+='<button type="button" class="tc-cm-action" data-action="tc-start-reply" data-uid="'+uid+'" data-comment-id="'+cm.id+'">'+t('tc_cm_repondre')+'</button>';
  }
  if(isOwn){
    actions+='<button type="button" class="tc-cm-action" data-action="tc-start-edit" data-uid="'+uid+'" data-comment-id="'+cm.id+'">'+t('tc_cm_modifier')+'</button>';
  }
  if(canDelete){
    actions+='<button type="button" class="tc-cm-action tc-cm-action-danger" data-action="tc-delete-comment" data-uid="'+uid+'" data-comment-id="'+cm.id+'">'+t('tc_cm_supprimer')+'</button>';
  }
  return '<div class="tc-cm-row'+(isReply?' tc-cm-reply':'')+'" id="tc-cm-row-'+cm.id+'">'
    +tcAuthorAvatarHtml(cm.author_contributor_id)
    +'<div class="tc-cm-main">'
      +'<div class="tc-cm-meta"><span class="tc-cm-author">'+escapeHtml(tcAuthorLabel(cm.author_contributor_id))+'</span><span class="tc-cm-date">'+tcFormatDate(cm.created_at)+'</span>'+editedHtml+'</div>'
      +quoteHtml
      +'<div class="tc-cm-text">'+tcRenderCommentBody(cm.body)+'</div>'
      +(actions?'<div class="tc-cm-actions">'+actions+'</div>':'')
    +'</div>'
  +'</div>';
}

function tcToolbarHtml(taId,uid){
  return '<div class="tc-cm-toolbar">'
    +'<button type="button" title="'+t('tc_cm_gras')+'" data-action="tc-insert-fmt" data-ta-id="'+taId+'" data-before="**" data-after="**"><b>G</b></button>'
    +'<button type="button" title="'+t('tc_cm_italique')+'" data-action="tc-insert-fmt" data-ta-id="'+taId+'" data-before="*" data-after="*"><i>I</i></button>'
    +'<button type="button" title="'+t('tc_cm_souligne')+'" data-action="tc-insert-fmt" data-ta-id="'+taId+'" data-before="__" data-after="__"><u>S</u></button>'
    +'<button type="button" title="'+t('tc_cm_emoji')+'" data-action="tc-toggle-emoji" data-uid="'+uid+'">🙂</button>'
    +'</div>'
    +'<div class="tc-cm-emoji-panel" id="'+uid+'-emoji" style="display:none">'
      +TC_EMOJIS.map(function(em){return '<button type="button" data-action="tc-insert-emoji" data-ta-id="'+taId+'" data-emoji="'+em+'">'+em+'</button>';}).join('')
    +'</div>';
}

function tcComposerHtml(uid){
  var st=TC_COMMENTS[uid];
  if(!currentUserContribId){
    return '<div class="tc-cm-login-msg">'+t('tc_cm_connexion_requise')+' <a href="submit.html?v=2">'+t('tc_cm_se_connecter')+'</a></div>';
  }
  var taId=uid+'-ta';
  var quoteHtml='';
  if(st&&st.replyTo){
    quoteHtml='<div class="tc-cm-replying-to"><span>'+t('tc_cm_en_reponse_a')+' <b>'+escapeHtml(st.replyTo.author)+'</b> : « '+escapeHtml(st.replyTo.snippet)+' »</span><button type="button" data-action="tc-cancel-reply" data-uid="'+uid+'">✕</button></div>';
  }
  return '<div class="tc-cm-composer">'
    +quoteHtml
    +tcToolbarHtml(taId,uid)
    +'<textarea id="'+taId+'" class="tc-cm-textarea" rows="2" placeholder="'+t('tc_cm_placeholder')+'" maxlength="4000"></textarea>'
    +'<div class="tc-cm-composer-actions"><button type="button" class="btn-primary" style="padding:8px 18px;font-size:13px" data-action="tc-submit-comment" data-uid="'+uid+'">'+t('tc_cm_publier')+'</button></div>'
  +'</div>';
}

function tcEditFormHtml(uid,cm){
  var taId=uid+'-edit-'+cm.id;
  return '<div class="tc-cm-main tc-cm-edit-form">'
    +tcToolbarHtml(taId,uid+'-edit-'+cm.id)
    +'<textarea id="'+taId+'" class="tc-cm-textarea" rows="2" maxlength="4000">'+escapeHtml(cm.body)+'</textarea>'
    +'<div class="tc-cm-composer-actions">'
      +'<button type="button" class="btn-secondary" style="padding:6px 14px;font-size:13px" data-action="tc-cancel-edit" data-uid="'+uid+'">'+t('tc_cm_annuler')+'</button>'
      +'<button type="button" class="btn-primary" style="padding:6px 14px;font-size:13px" data-action="tc-save-edit" data-uid="'+uid+'" data-comment-id="'+cm.id+'">'+t('tc_cm_enregistrer')+'</button>'
    +'</div>'
  +'</div>';
}

function tcInsertFmt(taId,before,after){
  var ta=document.getElementById(taId);
  if(!ta)return;
  var s=ta.selectionStart,e=ta.selectionEnd;
  var v=ta.value;
  ta.value=v.slice(0,s)+before+v.slice(s,e)+after+v.slice(e);
  ta.focus();
  ta.setSelectionRange(s+before.length,e+before.length);
}
function tcInsertEmoji(taId,emoji){
  var ta=document.getElementById(taId);
  if(!ta)return;
  var s=ta.selectionStart,e=ta.selectionEnd;
  var v=ta.value;
  ta.value=v.slice(0,s)+emoji+v.slice(e);
  var pos=s+emoji.length;
  ta.focus();
  ta.setSelectionRange(pos,pos);
}
function tcToggleEmojiPanel(uid){
  var panel=document.getElementById(uid+'-emoji');
  if(panel)panel.style.display=(panel.style.display==='none'?'flex':'none');
}

function tcFocusComposerIfNeeded(uid){
  var st=TC_COMMENTS[uid];
  if(st&&st.replyTo){
    var ta=document.getElementById(uid+'-ta');
    if(ta)ta.focus();
  }
}

function tcStartReply(uid,parentId){
  var st=TC_COMMENTS[uid];
  if(!st)return;
  var parent=st.rows.find(function(r){return r.id===parentId;});
  if(!parent)return;
  var snippet=parent.body.length>100?parent.body.slice(0,100)+'…':parent.body;
  st.replyTo={id:parentId,author:tcAuthorLabel(parent.author_contributor_id),snippet:snippet};
  tcRenderComments(uid);
}
function tcCancelReply(uid){
  var st=TC_COMMENTS[uid];
  if(!st)return;
  st.replyTo=null;
  tcRenderComments(uid);
}

function tcSubmitComment(uid){
  var st=TC_COMMENTS[uid];
  if(!st||!currentUserContribId)return;
  var ta=document.getElementById(uid+'-ta');
  if(!ta)return;
  var body=ta.value.trim();
  if(!body)return;
  var payload={
    top_contributor_id:st.ownerId,
    cineaste_nom:st.cineasteNom,
    author_contributor_id:currentUserContribId,
    parent_comment_id:st.replyTo?st.replyTo.id:null,
    body:body
  };
  ta.disabled=true;
  // INSERT non-idempotent : timeout sans relance auto (évite un doublon de commentaire).
  tcWithRetryTimeout(function(){ return TC_SB.from('comments').insert(payload).select('*').single(); }, { retries: 0 }).then(function(res){
    ta.disabled=false;
    if(res.error){alert(t('tc_cm_erreur_envoi'));return;}
    st.rows.push(res.data);
    st.replyTo=null;
    tcRenderComments(uid);
    // Confirmation visible du succès (cf. audit 7.1) : aucune action ne doit
    // rester sans retour explicite. Bannière verte éphémère, cohérente avec
    // les notices du back-office.
    if(typeof tcShowBanner==='function'){
      tcShowBanner('tc-cm-ok', t('tc_cm_published'), '#1a6b3a');
      setTimeout(function(){ if(typeof tcHideBanner==='function') tcHideBanner('tc-cm-ok'); }, 2500);
    }
  },function(){ta.disabled=false;alert(t('tc_cm_erreur_envoi'));});
}

function tcStartEdit(uid,commentId){
  var st=TC_COMMENTS[uid];
  if(!st)return;
  st.editingId=commentId;
  tcRenderComments(uid);
}
function tcCancelEdit(uid){
  var st=TC_COMMENTS[uid];
  if(!st)return;
  st.editingId=null;
  tcRenderComments(uid);
}
function tcSaveEdit(uid,commentId){
  var st=TC_COMMENTS[uid];
  if(!st)return;
  var taId=uid+'-edit-'+commentId;
  var ta=document.getElementById(taId);
  if(!ta)return;
  var body=ta.value.trim();
  if(!body)return;
  tcWithRetryTimeout(function(){ return TC_SB.from('comments').update({body:body,updated_at:new Date().toISOString()}).eq('id',commentId).select('*').single(); }).then(function(res){
    if(res.error){alert(t('tc_cm_erreur_envoi'));return;}
    var idx=st.rows.findIndex(function(r){return r.id===commentId;});
    if(idx!==-1)st.rows[idx]=res.data;
    st.editingId=null;
    tcRenderComments(uid);
  },function(){alert(t('tc_cm_erreur_envoi'));});
}

function tcDeleteComment(uid,commentId){
  var st=TC_COMMENTS[uid];
  if(!st)return;
  if(!confirm(t('tc_cm_confirmer_suppression')))return;
  tcWithRetryTimeout(function(){ return TC_SB.from('comments').delete().eq('id',commentId).select('id'); }).then(function(res){
    if(res.error){alert(t('tc_cm_erreur_envoi'));return;}
    if(!res.data||!res.data.length){alert(t('tc_cm_erreur_envoi'));return;}
    st.rows=st.rows.filter(function(r){return r.id!==commentId&&r.parent_comment_id!==commentId;});
    tcRenderComments(uid);
  },function(){alert(t('tc_cm_erreur_envoi'));});
}

function _tcGoToMesTops(cineaste,cb){
  closeFiche();
  navigate('mes-tops');
  var tabBtn=document.querySelector('.mt-tab-btn[data-mt-tab="tops"]');
  if(tabBtn&&!tabBtn.classList.contains('active'))tabBtn.click();
  var ready=(typeof window.mtOnNavigate==='function')?window.mtOnNavigate():Promise.resolve();
  Promise.resolve(ready).then(function(){cb(cineaste);});
}
function tcSubmitTopFor(cineaste){
  var hasExisting=currentUserJsonName&&(
    (SUPABASE_TOPS[currentUserJsonName]&&SUPABASE_TOPS[currentUserJsonName][cineaste])||
    (currentUserJsonName==='MATHIEU MUZARD'&&MUZARD_DATA&&MUZARD_DATA[cineaste])||
    (currentUserJsonName==='KARINE CNUDDE'&&CNUDDE_DATA&&CNUDDE_DATA[cineaste])
  );
  if(hasExisting){
    _tcGoToMesTops(cineaste,function(c){if(window.mtGoEditTop)window.mtGoEditTop(c);});
  } else {
    _tcGoToMesTops(cineaste,function(c){if(window.mtSetCineaste)window.mtSetCineaste(c);});
  }
}
function tcEditTop(cineaste){_tcGoToMesTops(cineaste,function(c){if(window.mtGoEditTop)window.mtGoEditTop(c);});}
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeFiche()});
// Raccourci "/" : focus la recherche (sauf si un champ texte est déjà actif)
document.addEventListener('keydown',function(e){
  if(e.key!=='/') return;
  var tag=document.activeElement&&document.activeElement.tagName;
  if(tag==='INPUT'||tag==='TEXTAREA') return;
  var fiche=document.getElementById('fiche-overlay');
  if(fiche&&fiche.classList.contains('visible')) return;
  var si=document.getElementById('search-input');
  if(si){ e.preventDefault(); si.focus(); }
});

var _contribs=[];
var _lastFocused=null;

// ── ACTUALITÉS ──────────────────────────────────────────────
function tcActuFormatDate(iso){
  if(!iso)return'';
  var d=new Date(iso);
  if(isNaN(d.getTime()))return'';
  return d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'});
}

function tcActuTopKey(contributorId,cineaste){return contributorId+'|'+cineaste;}

function tcActuLoadLegacyTopsKeys(offset,pageSize){
  return TC_SB.from('tops').select('contributor_id, cineaste_nom')
    .order('id',{ascending:true})
    .range(offset,offset+pageSize-1)
    .then(function(res){
      var rows=res.data||[];
      var keys=rows.filter(function(r){return r.contributor_id&&r.cineaste_nom;})
        .map(function(r){return tcActuTopKey(r.contributor_id,r.cineaste_nom);});
      if(rows.length===pageSize){
        return tcActuLoadLegacyTopsKeys(offset+pageSize,pageSize).then(function(more){return keys.concat(more);});
      }
      return keys;
    });
}

function tcActuOpenCineaste(nom){
  if(!DATA||typeof nom!=='string')return;
  var c=DATA.cineastes.find(function(x){return typeof x.nom==='string'&&x.nom.toLowerCase()===nom.toLowerCase();});
  if(c)openFiche(c);
}

function renderActualites(){
  var feed=document.getElementById('actu-feed');
  feed.innerHTML='<div class="empty-msg">'+t('actu_chargement')+'</div>';
  Promise.all([
    tcWithRetryTimeout(function(){ return TC_SB.from('cineaste_proposals').select('*').in('status',['pending','approved']).order('submitted_at',{ascending:false}).limit(20); }).then(function(r){return r.data||[];}).catch(function(){return[];}),
    tcLoadAllApprovedSubmissions('*, contributors(display_name)').then(function(r){return r.data||[];}).catch(function(){return[];}),
    tcWithRetryTimeout(function(){ return TC_SB.from('comments').select('*').is('parent_comment_id',null).order('created_at',{ascending:false}).limit(20); }).then(function(r){return r.data||[];}).catch(function(){return[];}),
    tcActuLoadLegacyTopsKeys(0,1000).catch(function(){return[];})
  ]).then(function(results){
    var props=results[0],subs=results[1],coms=results[2],legacyKeys=new Set(results[3]);
    var items=[];
    props.forEach(function(p){
      var nomComplet=((p.prenom?p.prenom+' ':'')+p.nom).trim();
      var label=p.status==='approved'?t('actu_proposition_validee',escapeHtml(nomComplet)):t('actu_proposition',escapeHtml(nomComplet));
      items.push({date:p.reviewed_at||p.submitted_at,html:'<span class="actu-icon">🎬</span> '+label});
    });
    // Détection nouveau/modification : la 1ère soumission approuvée pour un
    // couple (contributeur, cinéaste) est un "nouveau top", les suivantes
    // (ou toute soumission dont la clé existe déjà dans la table tops
    // historique) sont des "modifications".
    var seenKeys=new Set();
    subs.forEach(function(s){
      var dn=(s.contributors&&s.contributors.display_name)||(s.contributor_name||'?');
      var cin=(s.parsed_json&&s.parsed_json.cineaste)||'';
      var key=s.contributor_id&&cin?tcActuTopKey(s.contributor_id,cin):null;
      var isModif=(s.parsed_json&&(s.parsed_json.isModification||s.parsed_json.approvalCount>1))||(key&&(legacyKeys.has(key)||seenKeys.has(key)));
      if(key)seenKeys.add(key);
      var label=isModif?t('actu_top_modifie',[escapeHtml(dn),formatNom(cin)]):t('actu_top_nouveau',[escapeHtml(dn),formatNom(cin)]);
      items.push({date:s.reviewed_at||s.submitted_at,html:tcActuAvatarHtml(s.contributor_id,dn)+' '+label,cineaste:cin});
    });
    coms.forEach(function(c){
      var dn=tcAuthorLabel(c.author_contributor_id);
      items.push({date:c.created_at,html:'<span class="actu-icon">💬</span> '+t('actu_commentaire',[escapeHtml(dn),formatNom(c.cineaste_nom||'')]),cineaste:c.cineaste_nom});
    });
    items.sort(function(a,b){return new Date(b.date)-new Date(a.date);});
    items=items.slice(0,40);
    if(!items.length){feed.innerHTML='<div class="empty-msg">'+t('actu_vide')+'</div>';return;}
    feed.innerHTML=items.map(function(it){
      var clickable=it.cineaste&&getLetterData(it.cineaste.charAt(0).toUpperCase()).some(function(c){return c.nom.toLowerCase()===it.cineaste.toLowerCase();});
      var cls=clickable?' actu-item-clickable':'';
      var attr=clickable?' data-action="tc-actu-open" data-cineaste="'+escapeHtml(it.cineaste)+'"':'';
      return'<div class="actu-item'+cls+'"'+attr+'><div class="actu-text">'+it.html+'</div><div class="actu-date">'+tcActuFormatDate(it.date)+'</div></div>';
    }).join('');
  }).catch(function(){
    feed.innerHTML='<div class="empty-msg">'+t('actu_erreur')+'</div>';
  });
}

function renderContributeurs(){
  if(!DATA)return;
  var list=document.getElementById('contrib-list');
  _contribs=CONTRIB_DATA
    .filter(function(c){return c.json_name;})
    .map(function(c){
      var dn=c.json_name;var nb=0;
      DATA.cineastes.forEach(function(x){if(x.tops_contributeurs&&x.tops_contributeurs.indexOf(dn)!==-1)nb++});
      return{name:dn,tops:nb};
    });
  _contribs.sort(function(a,b){return b.tops-a.tops});
  var maxTops=_contribs.length>0?_contribs[0].tops:1;

  list.innerHTML='';
  _contribs.forEach(function(c){
    var ratio=c.tops/maxTops;
    var tier=ratio>0.75?4:ratio>0.5?3:ratio>0.25?2:1;
    var div=document.createElement('div');
    div.className='contrib-bubble';
    div.setAttribute('data-tops-tier',tier);
    div.setAttribute('data-name',c.name);
    var initiales=getInitiales(c.name);
    var avatarFilename=getAvatarFilename(c.name);
    var avId='av-'+c.name.replace(/[^a-zA-Z0-9]/g,'_');
    var avatarHtml='<div class="contrib-avatar-wrap"><div class="contrib-avatar-placeholder" id="'+avId+'">'+initiales+'</div><span class="online-dot" style="display:none"></span></div>';
    var imp=IMPORTED_COUNTS[c.name]||{tops:0,films:0};
    div.innerHTML='<div class="contrib-bubble-band"></div>'
      +'<div class="contrib-bubble-body">'
      +'<div class="contrib-bubble-content">'
      +'<div class="contrib-card-name">'+formatContribName(c.name)+'</div>'
      +'<div class="contrib-card-stat">'
      +'<span class="contrib-card-stat-num">'+c.tops+'</span>'
      +'<span class="contrib-card-stat-label">'+t('card_tops_postes',c.tops)+'</span>'
      +'</div>'
      +'<div class="contrib-card-stat contrib-card-stat-imported">'
      +'<span class="contrib-card-stat-num">'+imp.tops+'</span>'
      +'<span class="contrib-card-stat-label">'+t('card_tops_importes',imp.tops)+'</span>'
      +'</div></div>'
      +avatarHtml
      +'</div>';

    div.onclick=function(){navigateProfil(this.getAttribute('data-name'));};
    list.appendChild(div);
    // Charger la photo depuis Supabase si disponible
    if(AVATAR_URLS[c.name]){
      (function(id,url,name){
        var img=new Image();
        img.onload=function(){
          var el=document.getElementById(id);
          if(el){
            var imgEl=document.createElement('img');
            imgEl.className='contrib-avatar';
            imgEl.src=url;
            imgEl.alt=name;
            imgEl.loading='lazy';
            el.parentNode.replaceChild(imgEl,el);
          }
        };
        img.src=url;
      })(avId,AVATAR_URLS[c.name],c.name);
    }
  });
  tcRefreshOnlineBadges();
}
function openContribDetail(name){
  var cin=DATA.cineastes.filter(function(c){return c.tops_contributeurs&&c.tops_contributeurs.indexOf(name)!==-1});
  cin.sort(function(a,b){return a.nom.localeCompare(b.nom,'fr')});
  var favs=FAVORIS[name]||[];
  var favsHtml=favs.length
    ?'<div class="fiche-section" style="margin:1.2rem 1.8rem 0.5rem">'+t('profil_cin_favoris')+'</div>'
     +'<div class="contrib-grid" style="padding:0 1.8rem">'+favs.map(function(f){return '<span class="contrib-tag" style="cursor:default">&#10084; '+escapeHtml(f)+'</span>'}).join('')+'</div>'
    :'';
  var listDiv=document.createElement('div');
  listDiv.className='cineaste-list';
  listDiv.style.marginTop='1rem';
  cin.forEach(function(c){
    var dates=formatDates(c);var dh=dates?'<span class="c-dates">'+dates+'</span>':'';
    var row=document.createElement('div');
    row.className='cineaste-row';
    row.innerHTML='<div class="c-bar"></div>'
      +'<div class="c-info"><span class="c-name">'+formatNom(c.nom)+'</span>'+dh+'</div>';
    row.setAttribute('data-fbid',c.fbid);
    row.onclick=function(){
      var fbid=this.getAttribute('data-fbid');
      closeFiche();
      var found=DATA.cineastes.find(function(x){return x.fbid===fbid;});
      if(found)openFiche(found);
    };
    listDiv.appendChild(row);
  });
    var sqW=Math.max(20,Math.min(80,Math.round(20+(cin.length/24)*60)))+'px';
  document.getElementById('fiche-content').innerHTML=
    '<div class="fiche-back" data-action="close-fiche">\u2190 Retour</div>'
    +'<div class="fiche-header" style="--sq:'+sqW+'">' 
      +'<div class="fiche-name" style="font-size:30px">'+formatContribNamePlain(name)+'</div>'
      +'<div class="fiche-dates">'+t('tops_postes',cin.length)+'</div>'
    +'</div>'
    +favsHtml
    +'<div class="fiche-section" style="margin:1.2rem 1.8rem 0.5rem">'+t('cin_classes')+'</div>'
    +'<div id="contrib-detail-list"></div>';

  document.getElementById('contrib-detail-list').appendChild(listDiv);
  _lastFocused=document.activeElement;
  var overlay2=document.getElementById('fiche-overlay');
  overlay2.classList.add('visible');
  document.body.style.overflow='hidden';
  setTimeout(function(){var f=overlay2.querySelector('[tabindex="0"],button,a');if(f)f.focus();},50);
}

function renderStatistiques(){
  if(!DATA)return;
  var totalC=DATA.cineastes.length;
  var totalContribs=CONTRIB_DATA.filter(function(c){return c.json_name;}).length;
  var enA=0,dec=0,st=0,tt=0;
  DATA.cineastes.forEach(function(c){var nb=(c.tops_contributeurs||[]).length;tt+=nb;if(c.vivant===true)enA++;if(c.vivant===false)dec++;if(nb===0)st++});
  var totalFilms=Object.keys(IMPORTED_COUNTS).reduce(function(s,k){return s+IMPORTED_COUNTS[k].films;},0);

  document.getElementById('stats-hero').innerHTML=
    mkHero(totalC,t('stat_cin'),t('stat_en_activite',enA))
    +mkHero(tt,t('stat_tops_postes'),t('stat_moy',Math.round(tt/Math.max(totalContribs,1))))
    +mkHero(totalContribs,t('stat_contrib'),t('stat_deces',dec))
    +mkHero(st,t('stat_cin_sans_tops'),t('stat_sans_tops',st))
    +mkHero(totalFilms,t('stat_films'),t('stat_films_sub'));

  var topsParCinephile=Object.keys(IMPORTED_COUNTS).map(function(k){return IMPORTED_COUNTS[k].tops;}).filter(function(n){return n>0;});
  var moyTops=0,medTops=0;
  if(topsParCinephile.length){
    moyTops=topsParCinephile.reduce(function(s,n){return s+n;},0)/topsParCinephile.length;
    var sortedTops=topsParCinephile.slice().sort(function(a,b){return a-b;});
    var mid=Math.floor(sortedTops.length/2);
    medTops=sortedTops.length%2!==0?sortedTops[mid]:(sortedTops[mid-1]+sortedTops[mid])/2;
  }
  document.getElementById('stats-secondary').innerHTML=
    mkSecondary(moyTops.toFixed(1),t('stat_tops_moyenne'))
    +mkSecondary(medTops.toFixed(1),t('stat_tops_mediane'));

  var shuffled=DATA.cineastes.slice();
  for(var si=shuffled.length-1;si>0;si--){
    var sj=Math.floor(Math.random()*(si+1));
    var stmp=shuffled[si];shuffled[si]=shuffled[sj];shuffled[sj]=stmp;
  }
  var ranked=shuffled
    .sort(function(a,b){return(b.tops_contributeurs||[]).length-(a.tops_contributeurs||[]).length})
    .slice(0,22);

  var rankEl=document.getElementById('ranking-cineastes');
  rankEl.innerHTML='';
  ranked.forEach(function(c,i){
    var nb=(c.tops_contributeurs||[]).length;
    var rankClass=i<3?'ranking-rank top3':'ranking-rank';
    var row=document.createElement('div');
    row.className='ranking-row';
    row.innerHTML='<div class="'+rankClass+'">'+(i+1)+'</div>'
      +'<div class="ranking-name">'+formatNom(c.nom)+'</div>'
      +'<div class="ranking-value">'+nb+' '+t('tops_in_ranking')+'</div>';
    rankEl.appendChild(row);
  });

  var filmsRanking=[];
  Object.keys(IMPORTED_COUNTS).forEach(function(name){
    var imp=IMPORTED_COUNTS[name];
    if(imp.films>0)filmsRanking.push({name:name,films:imp.films});
  });
  filmsRanking.sort(function(a,b){return b.films-a.films;});
  var filmsRankEl=document.getElementById('ranking-films-contrib');
  filmsRankEl.innerHTML='';
  if(!filmsRanking.length){
    filmsRankEl.innerHTML='<div class="empty-msg">'+t('aucun_import')+'</div>';
  } else {
    filmsRanking.forEach(function(c,i){
      var rankClass=i<3?'ranking-rank top3':'ranking-rank';
      var row=document.createElement('div');
      row.className='ranking-row';
      row.style.cursor='default';
      row.innerHTML='<div class="'+rankClass+'">'+(i+1)+'</div>'
        +'<div class="ranking-name">'+formatContribNamePlain(c.name)+'</div>'
        +'<div class="ranking-value">'+c.films+' '+t('films_in_ranking')+'</div>';
      filmsRankEl.appendChild(row);
    });
  }
}
function mkHero(v,l,sub){
  return '<div class="stat-hero-item"><span class="stat-hero-value">'+v+'</span><span class="stat-hero-label">'+l+'</span>'+(sub?'<span class="stat-hero-sublabel">'+sub+'</span>':'')+'</div>';
}
function mkSecondary(v,l){
  return '<div class="stat-secondary-item"><span class="stat-secondary-value">'+v+'</span><span class="stat-secondary-label">'+l+'</span></div>';
}
// ── SCROLL TO TOP ─────────────────────────────────────────────
window.addEventListener('scroll',function(){
  var btn=document.getElementById('scroll-top');
  if(btn)btn.classList.toggle('visible',window.scrollY>400);
},{passive:true});
// ── Re-render dynamique après changement de langue ───────────
window.tcAfterLangChange = function(){
  var p=sessionStorage.getItem('tc-page')||'index';
  if(p==='index'){if(document.getElementById('search-input').value.trim()){filterList();}else{selectLetter(currentLetter);}}
  else if(p==='contributeurs'){renderContributeurs();}
  else if(p==='statistiques'){renderStatistiques();}
  else if(p==='actualites'){renderActualites();}
  else if(p==='profil'&&_currentProfilName){renderProfil(_currentProfilName);}
};

// ── Wiring événements statiques — zéro onclick inline ────────
document.getElementById('btn-splash-enter').addEventListener('click',function(){enterSite();});
document.getElementById('logo-home').addEventListener('click',function(){navigate('index');});
document.getElementById('nav-index').addEventListener('click',function(){navigate('index');});
document.getElementById('nav-actualites').addEventListener('click',function(){navigate('actualites');});
document.getElementById('nav-contributeurs').addEventListener('click',function(){navigate('contributeurs');});
document.getElementById('nav-statistiques').addEventListener('click',function(){navigate('statistiques');});
document.getElementById('nav-mes-tops').addEventListener('click',function(){navigate('mes-tops');});
document.getElementById('mt-page-back').addEventListener('click',function(){navigate('index');});
document.getElementById('nav-dark').addEventListener('click',function(){toggleDark();});
document.getElementById('nav-dark').addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleDark();}});
document.getElementById('profil-autres-cineaste-btn').addEventListener('click',function(){toggleVoirPlus('cineaste');});
document.getElementById('profil-films-autres-btn').addEventListener('click',function(){toggleVoirPlus('films');});
document.getElementById('fiche-overlay').addEventListener('click',function(e){if(e.target===this)closeFiche();});
document.getElementById('profil-liste-tops-wrap').addEventListener('click',function(e){
  var btn=e.target.closest('.profil-liste-tops-btn');
  if(btn)showImportedPanel(btn.getAttribute('data-imp-name'));
});
document.getElementById('btn-back-contrib').addEventListener('click',function(){navigate('contributeurs');});
document.getElementById('scroll-top').addEventListener('click',function(){window.scrollTo({top:0,behavior:'smooth'});});
document.getElementById('search-input').addEventListener('input',(function(){
  var t;return function(){clearTimeout(t);t=setTimeout(function(){filterList();},150);};
})());
document.getElementById('profil-header-back').addEventListener('click',function(){navigate('contributeurs');});
document.getElementById('filter-sans-tops').addEventListener('click',function(){toggleFilter('sans-tops');});
document.getElementById('filter-non-couvert').addEventListener('click',function(){toggleFilter('non-couvert');});

// ── Délégation des actions générées dynamiquement (data-action) ──
// Remplace les anciens onclick="..." injectés via innerHTML : un seul
// listener ici gère tous les boutons/blocks recréés à chaque rendu.
document.addEventListener('click',function(e){
  var el=e.target.closest('[data-action]');
  if(!el)return;
  var action=el.getAttribute('data-action');
  switch(action){
    case 'retry-load':
      loadData();
      break;
    case 'close-fiche':
      closeFiche();
      break;
    case 'imp-toggle-sort':
      impPanelToggleSort();
      break;
    case 'tc-edit-top':
      e.stopPropagation();
      tcEditTop(el.getAttribute('data-cineaste'));
      break;
    case 'toggle-accordeon':
      toggleAccordeon(el.getAttribute('data-block-id'));
      break;
    case 'tc-submit-top':
      tcSubmitTopFor(el.getAttribute('data-cineaste'));
      break;
    case 'tc-toggle-comments':
      e.stopPropagation();
      tcToggleComments(el.getAttribute('data-uid'),el.getAttribute('data-owner-id'),el.getAttribute('data-cineaste'));
      break;
    case 'tc-start-reply':
      tcStartReply(el.getAttribute('data-uid'),Number(el.getAttribute('data-comment-id')));
      break;
    case 'tc-start-edit':
      tcStartEdit(el.getAttribute('data-uid'),Number(el.getAttribute('data-comment-id')));
      break;
    case 'tc-delete-comment':
      tcDeleteComment(el.getAttribute('data-uid'),Number(el.getAttribute('data-comment-id')));
      break;
    case 'tc-insert-fmt':
      tcInsertFmt(el.getAttribute('data-ta-id'),el.getAttribute('data-before'),el.getAttribute('data-after'));
      break;
    case 'tc-toggle-emoji':
      tcToggleEmojiPanel(el.getAttribute('data-uid'));
      break;
    case 'tc-insert-emoji':
      tcInsertEmoji(el.getAttribute('data-ta-id'),el.getAttribute('data-emoji'));
      break;
    case 'tc-cancel-reply':
      tcCancelReply(el.getAttribute('data-uid'));
      break;
    case 'tc-submit-comment':
      tcSubmitComment(el.getAttribute('data-uid'));
      break;
    case 'tc-cancel-edit':
      tcCancelEdit(el.getAttribute('data-uid'));
      break;
    case 'tc-save-edit':
      tcSaveEdit(el.getAttribute('data-uid'),Number(el.getAttribute('data-comment-id')));
      break;
    case 'tc-actu-open':
      tcActuOpenCineaste(el.getAttribute('data-cineaste'));
      break;
  }
});

// ── Auto-enter si l'utilisateur a déjà passé le splash ───────
if(sessionStorage.getItem('tc-entered')){ enterSite(); }

// ── AUTH SUPABASE — indicateur de session ─────────────────────
(function(){
  var sbAuth = TC_SB;

  // Charger les profils contributeurs depuis Supabase
  sbAuth.from('contributors').select('id,json_name,display_name,cineaste_coeur,cineaste_autres,film_coeur,film_autres,presentation,avatar_url,is_admin').then(function(res){
    if(res.data && res.data.length){
      CONTRIB_DATA = res.data;
      // Construire FAVORIS à partir de cineaste_coeur
      res.data.forEach(function(c){
        if(c.cineaste_coeur && Array.isArray(c.cineaste_coeur) && c.cineaste_coeur.length && c.json_name){
          FAVORIS[c.json_name] = c.cineaste_coeur.map(function(name){
            // Convertir "Pier Paolo PASOLINI" → "Pier Paolo Pasolini"
            return name.replace(/\b([A-ZÀ-Ü]{2,})\b/g, function(m){
              return m.charAt(0) + m.slice(1).toLowerCase();
            });
          });
        }
        if(c.avatar_url && c.json_name) AVATAR_URLS[c.json_name] = c.avatar_url;
      });
      // Mettre à jour les avatars déjà rendus si la page contributeurs est visible
      res.data.forEach(function(c){
        if(!c.avatar_url || !c.json_name) return;
        var avId='av-'+c.json_name.replace(/[^a-zA-Z0-9]/g,'_');
        var el=document.getElementById(avId);
        if(el){
          var img=new Image();
          img.onload=function(){
            var cur=document.getElementById(avId);
            if(cur){var imgEl=document.createElement('img');imgEl.className='contrib-avatar';imgEl.src=c.avatar_url;imgEl.alt=c.json_name;imgEl.loading='lazy';cur.parentNode.replaceChild(imgEl,cur);}
          };
          img.src=c.avatar_url;
        }
      });
      // Identifier l'utilisateur courant pour les filtres
      updateCurrentUser();
      updateNavAvatar();
      // Charger les tops approuvés maintenant que CONTRIB_DATA est disponible
      var idToName={};
      res.data.forEach(function(c){if(c.id){
        if(c.json_name) idToName[c.id]=c.json_name;
        else if(c.display_name) idToName[c.id]=c.display_name.toUpperCase();
      }});
      tcLoadAllApprovedSubmissions('*, contributors(display_name)').then(function(res2){
        // Attendre que DATA.cineastes soit chargé avant de fusionner les tops soumis
        // via l'interface : la pagination Supabase peut être plus lente que cette requête,
        // et sans cette attente la fusion ci-dessous serait silencieusement ignorée.
        return DATA_READY.then(function(){
        if(!res2.data||!res2.data.length)return;
        res2.data.forEach(function(s){
          var jsonName=(s.contributor_name?s.contributor_name.toUpperCase():null)||(s.contributors&&s.contributors.display_name?s.contributors.display_name.toUpperCase():null)||(s.contributor_id&&idToName[s.contributor_id]?idToName[s.contributor_id]:null);
          if(!jsonName||!s.parsed_json)return;
          var cinNom=s.parsed_json.cineaste;
          var films=s.parsed_json.films||[];
          if(!cinNom)return;
          if(!SUPABASE_TOPS[jsonName])SUPABASE_TOPS[jsonName]={};
          SUPABASE_TOPS[jsonName][cinNom]=films;
          if(!IMPORTED_COUNTS[jsonName])IMPORTED_COUNTS[jsonName]={tops:0,films:0};
          IMPORTED_COUNTS[jsonName].tops++;
          IMPORTED_COUNTS[jsonName].films+=films.length;
          if(DATA){
            var cin=DATA.cineastes.find(function(c){return c.nom===cinNom;});
            if(cin){
              if(!cin.tops_contributeurs)cin.tops_contributeurs=[];
              if(cin.tops_contributeurs.indexOf(jsonName)===-1)cin.tops_contributeurs.push(jsonName);
            }
          }
        });
        var _cp2=sessionStorage.getItem('tc-page');
        if(_cp2==='index'){selectLetter(currentLetter);}
        else if(_cp2==='contributeurs'&&document.getElementById('page-contributeurs').classList.contains('visible')){renderContributeurs();}
        else if(_cp2==='statistiques'){renderStatistiques();}
        // Charger aussi les tops importés manuellement (table tops, submission_id = NULL)
        // Note : Supabase/PostgREST plafonne le nombre de lignes renvoyées par requête
        // (db.max_rows, souvent 1000) quel que soit le .limit() demandé côté client.
        // On pagine donc avec .range() jusqu'à récupérer toutes les lignes.
        function loadAllTops(offset, pageSize){
          return TC_SB.from('tops').select('contributor_id, cineaste_nom, films')
            .order('id', { ascending: true })
            .range(offset, offset + pageSize - 1)
            .then(function(res3){
              var rows = res3.data || [];
              rows.forEach(function(top){
                var jsonName=idToName[top.contributor_id];
                if(!jsonName)return;
                var cinNom=top.cineaste_nom;
                var films=top.films||[];
                if(!cinNom)return;
                // Ne pas écraser un top déjà chargé via submissions
                if(SUPABASE_TOPS[jsonName]&&SUPABASE_TOPS[jsonName][cinNom])return;
                if(!SUPABASE_TOPS[jsonName])SUPABASE_TOPS[jsonName]={};
                SUPABASE_TOPS[jsonName][cinNom]=films;
                if(!IMPORTED_COUNTS[jsonName])IMPORTED_COUNTS[jsonName]={tops:0,films:0};
                IMPORTED_COUNTS[jsonName].tops++;
                IMPORTED_COUNTS[jsonName].films+=films.length;
                if(DATA){
                  var cin=DATA.cineastes.find(function(c){return c.nom===cinNom;});
                  if(cin){
                    if(!cin.tops_contributeurs)cin.tops_contributeurs=[];
                    if(cin.tops_contributeurs.indexOf(jsonName)===-1)cin.tops_contributeurs.push(jsonName);
                  }
                }
              });
              if(rows.length===pageSize){
                return loadAllTops(offset+pageSize, pageSize);
              }
            });
        }
        loadAllTops(0, 1000).then(function(){
          var _cp3=sessionStorage.getItem('tc-page');
          if(_cp3==='index'){selectLetter(currentLetter);}
          else if(_cp3==='contributeurs'&&document.getElementById('page-contributeurs').classList.contains('visible')){renderContributeurs();}
          else if(_cp3==='statistiques'){renderStatistiques();}
        }).catch(function(err){
          console.error('Erreur de chargement des tops importés :', err);
        });
        });
      }).catch(function(err){
        console.error('Erreur de chargement des soumissions approuvées :', err);
      });
      // Re-rendre la page courante si elle attendait les données Supabase
      var _curPage=sessionStorage.getItem('tc-page');
      if(_curPage==='contributeurs'&&document.getElementById('page-contributeurs').classList.contains('visible')){
        renderContributeurs();
      }
      if(_curPage==='profil'&&_currentProfilName){
        renderProfil(_currentProfilName);
      }
      // Mettre à jour l'avatar de la page profil si elle est visible
      if(_currentProfilName){
        var profilContrib=res.data.find(function(c){return c.json_name===_currentProfilName;});
        if(profilContrib&&profilContrib.avatar_url){
          var profilAv=document.getElementById('profil-avatar');
          if(profilAv&&!profilAv.querySelector('img')){
            var pToken=Date.now();
            profilAv.dataset.avatarToken=pToken;
            var pImg=new Image();
            pImg.onload=function(){
              var el=document.getElementById('profil-avatar');
              if(el&&String(el.dataset.avatarToken)===String(pToken)){
                var imgEl=document.createElement('img');imgEl.src=profilContrib.avatar_url;imgEl.alt=escapeHtml(_currentProfilName);
                el.innerHTML='';el.appendChild(imgEl);
              }
            };
            pImg.src=profilContrib.avatar_url;
          }
        }
      }
    }
  }).catch(function(err){
    console.error('Erreur de chargement des contributeurs Supabase :', err);
  });

  function formatPrenomNav(displayName){
    if(!displayName) return '';
    var prenom = displayName.split(' ')[0];
    return prenom.charAt(0).toUpperCase() + prenom.slice(1).toLowerCase();
  }

  function buildNavAvatarHtml(jsonName, displayName){
    var url = jsonName ? AVATAR_URLS[jsonName] : null;
    var initials = displayName ? getInitiales(displayName) : '?';
    if(url) return '<span class="nav-user-avatar"><img src="'+escapeHtml(url)+'" alt=""></span>';
    return '<span class="nav-user-avatar">'+escapeHtml(initials)+'</span>';
  }

  function setNavConnecte(displayName){
    updateCurrentUser();
    var link = document.getElementById('nav-submit');
    var prenom = formatPrenomNav(displayName);
    link.innerHTML = buildNavAvatarHtml(currentUserJsonName, displayName) + (prenom || 'Mon espace');
    link.title = 'Session active';
    link.removeAttribute('href');
    link.style.cursor = 'default';
    link.style.opacity = '0.7';
    link.style.color = '';
    document.getElementById('nav-user-wrap').classList.add('connected');
    document.getElementById('nav-soumettre').style.display = '';
    document.getElementById('nav-mes-tops').style.display = '';
    tcPresenceTrackSelf();
  }

  function updateNavAvatar(){
    if(!currentUserJsonName) return;
    var url = AVATAR_URLS[currentUserJsonName];
    if(!url) return;
    var avatarEl = document.querySelector('#nav-submit .nav-user-avatar');
    if(!avatarEl) return;
    avatarEl.innerHTML = '<img src="'+escapeHtml(url)+'" alt="">';
  }

  function setNavDeconnecte(){
    var link = document.getElementById('nav-submit');
    link.textContent = t('nav_se_connecter');
    link.title = '';
    link.setAttribute('href', 'submit.html?v=2');
    link.style.cursor = '';
    link.style.opacity = '';
    link.style.color = '';
    document.getElementById('nav-user-wrap').classList.remove('connected');
    document.getElementById('nav-soumettre').style.display = 'none';
    document.getElementById('nav-mes-tops').style.display = 'none';
    tcPresenceUntrackSelf();
  }

  sbAuth.auth.onAuthStateChange(function(event, session){
    if(event === 'INITIAL_SESSION'){
      if(session){
        var displayName=null;
        try{ displayName = localStorage.getItem('tc-display-name'); }catch(e){}
        setNavConnecte(displayName);
      }
      return;
    }
    if(event === 'SIGNED_IN' && session){
      var displayName=null;
      try{ displayName = localStorage.getItem('tc-display-name'); }catch(e){}
      setNavConnecte(displayName);
    } else if(event === 'SIGNED_OUT'){
      currentUserContribId=null;
      currentUserIsAdmin=false;
      setNavDeconnecte();
    }
  });

  document.getElementById('nav-logout-tip').addEventListener('click', function(){
    try{ localStorage.removeItem('tc-display-name'); }catch(e){}
    sbAuth.auth.signOut();
  });

  // Tooltip déconnexion : JS avec délai pour éviter la disparition prématurée
  (function(){
    var wrap = document.getElementById('nav-user-wrap');
    var tip = document.getElementById('nav-logout-tip');
    var hideTimer;
    function showTip(){ if(!wrap.classList.contains('connected'))return; clearTimeout(hideTimer); tip.style.display='block'; }
    function hideTip(){ hideTimer=setTimeout(function(){ tip.style.display='none'; },200); }
    wrap.addEventListener('mouseenter', showTip);
    wrap.addEventListener('mouseleave', hideTip);
    tip.addEventListener('mouseenter', function(){ clearTimeout(hideTimer); });
    tip.addEventListener('mouseleave', hideTip);
  })();
})();

// ── MES TOPS ─────────────────────────────────────────────────
(function(){
  var sbMT = TC_SB;

  var mtCurrentUser = null;
  var mtCurrentContributor = null;
  var mtSelectedCineaste = null;
  var mtParsedFilms = null;
  var mtAcSelectedIdx = -1;
  var mtLoaded = false;
  var mtLastSubmissions = [];
  var mtEditBypassCineaste = null;
  var mtUnseenNotifications = [];

  // ── NOTIFICATIONS DE STATUT ──────────────────────────────────
  function mtDismissedKey(){
    return 'tc-dismissed-notifs-' + (mtCurrentContributor ? mtCurrentContributor.id : '');
  }
  function mtGetDismissedIds(){
    try{ return JSON.parse(localStorage.getItem(mtDismissedKey())) || []; }
    catch(e){ return []; }
  }
  var MT_DISMISSED_MAX = 50;
  function mtAddDismissedId(kind, id){
    var ids = mtGetDismissedIds();
    var key = kind + ':' + id;
    if(ids.indexOf(key) === -1){
      ids.push(key);
      if(ids.length > MT_DISMISSED_MAX) ids = ids.slice(ids.length - MT_DISMISSED_MAX);
      try{ localStorage.setItem(mtDismissedKey(), JSON.stringify(ids)); }catch(e){}
    }
  }

  var MT_NOTIF_CACHE_TTL = 25000;
  var _mtNotifCacheTs = 0;
  function mtInvalidateNotifCache(){ _mtNotifCacheTs = 0; }
  async function mtCheckNotifications(force){
    if(!mtCurrentContributor) return;
    if(!force && _mtNotifCacheTs && (Date.now() - _mtNotifCacheTs) < MT_NOTIF_CACHE_TTL) return;
    var spinner = document.getElementById('mt-notif-spinner');
    if(spinner) spinner.style.display = 'inline-block';
    try{
      await mtFlushPendingSeen();
      // Lectures enveloppées dans un timeout/retry : évite un spinner bloqué et
      // les échecs transitoires qui empêcheraient l'affichage des notifications.
      var myOwnComments = await tcWithRetryTimeout(function(){ return sbMT.from('comments').select('id').eq('author_contributor_id', mtCurrentContributor.id); });
      var myOwnIds = (myOwnComments.data || []).map(function(r){ return r.id; });

      var queryFactories = [
        function(){ return sbMT.from('submissions').select('id, status, parsed_json')
          .eq('contributor_id', mtCurrentContributor.id)
          .in('status', ['approved', 'rejected'])
          .is('seen_at', null); },
        function(){ return sbMT.from('cineaste_proposals').select('id, nom, prenom')
          .eq('contributor_id', mtCurrentContributor.id)
          .eq('status', 'approved')
          .is('seen_at', null); },
        function(){ return sbMT.from('comments').select('id, author_contributor_id, cineaste_nom')
          .eq('top_contributor_id', mtCurrentContributor.id)
          .is('parent_comment_id', null)
          .neq('author_contributor_id', mtCurrentContributor.id)
          .is('seen_at', null); }
      ];
      if(myOwnIds.length){
        queryFactories.push(function(){ return sbMT.from('comments').select('id, author_contributor_id, cineaste_nom')
          .in('parent_comment_id', myOwnIds)
          .neq('author_contributor_id', mtCurrentContributor.id)
          .is('seen_at', null); });
      }
      var results = await Promise.all(queryFactories.map(function(f){ return tcWithRetryTimeout(f); }));
      var subRes = results[0];
      var propRes = results[1];
      var commentNotifs = (results[2].data || []).concat(myOwnIds.length ? (results[3].data || []) : []);

    var MT_TYPE_LABELS = {
      top: 'top', favoris: 'liste de cinéastes favoris',
      autres_cineastes: 'liste d\'autres cinéastes',
      films_favoris: 'liste de films favoris', autres_films: 'liste d\'autres films',
      presentation: 'présentation'
    };
    mtUnseenNotifications = [];
    var dismissedIds = mtGetDismissedIds();
    (subRes.data || []).forEach(function(s){
      var type = (s.parsed_json && s.parsed_json.type) || 'top';
      if(dismissedIds.indexOf('submission:' + s.id) !== -1) return;
      var cineaste = s.parsed_json && s.parsed_json.cineaste;
      var label = type === 'top' && cineaste
        ? ('top pour ' + cineaste)
        : (MT_TYPE_LABELS[type] || type);
      mtUnseenNotifications.push({
        kind: 'submission', id: s.id, status: s.status,
        text: s.status === 'approved'
          ? (t ? t('mt_notif_submission_approved', label) : ('Votre ' + label + ' a été validé(e).'))
          : (t ? t('mt_notif_submission_rejected', label) : ('Votre ' + label + ' a été refusé(e).'))
      });
    });
    (propRes.data || []).forEach(function(p){
      if(dismissedIds.indexOf('proposal:' + p.id) !== -1) return;
      var nomComplet = (p.prenom ? p.prenom + ' ' : '') + p.nom;
      mtUnseenNotifications.push({
        kind: 'proposal', id: p.id, status: 'approved',
        text: t ? t('mt_notif_proposal_approved', nomComplet) : ('Votre suggestion de cinéaste "' + nomComplet + '" a été validée.')
      });
    });
    commentNotifs.forEach(function(cm){
      if(dismissedIds.indexOf('comment:' + cm.id) !== -1) return;
      mtUnseenNotifications.push({
        kind: 'comment', id: cm.id, status: 'approved', cineaste: cm.cineaste_nom,
        text: t ? t('mt_notif_comment', [tcAuthorLabel(cm.author_contributor_id), cm.cineaste_nom]) : (tcAuthorLabel(cm.author_contributor_id) + ' a commenté le top "' + cm.cineaste_nom + '".')
      });
    });

      // Marquer seen_at en base dès l'affichage (pas seulement au clic ✕) :
      // garantit la persistance même si le localStorage est vidé avant le dismiss.
      mtUnseenNotifications.forEach(function(n){
        sbMT.rpc('mark_notification_seen', { p_kind: n.kind, p_id: String(n.id) })
          .then(function(res){
            if(!res || res.error || res.data !== true) mtQueuePendingSeen(n.kind, n.id);
          })
          .catch(function(){ mtQueuePendingSeen(n.kind, n.id); });
      });

      var hasNotif = mtUnseenNotifications.length > 0;
      var navMesTops = document.getElementById('nav-mes-tops');
      var navSoumettre = document.getElementById('nav-soumettre');
      if(navMesTops) navMesTops.classList.toggle('has-notif', hasNotif);
      if(navSoumettre) navSoumettre.classList.toggle('has-notif', hasNotif);
      var countEl = document.getElementById('nav-mes-tops-count');
      if(countEl) countEl.textContent = hasNotif ? String(mtUnseenNotifications.length) : '';
      _mtNotifCacheTs = Date.now();
    } catch(err){
      // Ne jamais laisser une erreur réseau propager un rejet non géré (qui
      // déclencherait la bannière d'erreur globale). On conserve les
      // notifications déjà affichées ; comme _mtNotifCacheTs n'est pas mis à
      // jour, un nouvel essai aura lieu à la prochaine navigation/refresh.
      console.error('mtCheckNotifications: échec réseau, réessai différé', err);
    } finally {
      if(spinner) spinner.style.display = 'none';
    }
  }

  function mtRenderNotifBanner(){
    var banner = document.getElementById('mt-notif-banner');
    if(!banner) return;
    banner.innerHTML = '';
    mtUnseenNotifications.forEach(function(n){
      var item = document.createElement('div');
      item.className = 'mt-notif-item ' + n.status;
      var span = document.createElement('span'); span.textContent = n.text;
      if(n.kind === 'comment'){
        span.style.cursor = 'pointer';
        span.addEventListener('click', function(){
          var cin = DATA && DATA.cineastes ? DATA.cineastes.find(function(x){ return x.nom === n.cineaste; }) : null;
          navigate('index', true);
          if(cin) openFiche(cin);
        });
      }
      var closeBtn = document.createElement('button');
      closeBtn.className = 'mt-notif-item-close'; closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', function(){ mtDismissNotification(n, item); });
      item.appendChild(span); item.appendChild(closeBtn);
      banner.appendChild(item);
    });
  }

  function mtSeenTableFor(kind){
    return kind === 'submission' ? 'submissions' : (kind === 'comment' ? 'comments' : 'cineaste_proposals');
  }

  // File d'attente persistée des écritures "seen_at" qui ont échoué (ex: coupure
  // réseau, erreur serveur) afin de pouvoir les retenter à la prochaine visite —
  // sans cette file, le localStorage de dismissedIds restait la seule protection
  // et une notification déjà fermée pouvait réapparaître si ce cache était vidé.
  function mtPendingSeenKey(){
    return 'tc-pending-seen-' + (mtCurrentContributor ? mtCurrentContributor.id : '');
  }
  function mtGetPendingSeen(){
    try{ return JSON.parse(localStorage.getItem(mtPendingSeenKey())) || []; }
    catch(e){ return []; }
  }
  var MT_PENDING_SEEN_MAX_ATTEMPTS = 5;
  function mtQueuePendingSeen(kind, id){
    var list = mtGetPendingSeen();
    if(!list.some(function(p){ return p.kind === kind && p.id === id; })){
      list.push({ kind: kind, id: id, attempts: 0 });
      try{ localStorage.setItem(mtPendingSeenKey(), JSON.stringify(list)); }catch(e){}
    }
  }
  function mtClearPendingSeen(kind, id){
    var list = mtGetPendingSeen().filter(function(p){ return !(p.kind === kind && p.id === id); });
    try{ localStorage.setItem(mtPendingSeenKey(), JSON.stringify(list)); }catch(e){}
  }
  async function mtFlushPendingSeen(){
    var list = mtGetPendingSeen();
    if(!list.length) return;
    var now = new Date().toISOString();
    for(var i=0;i<list.length;i++){
      var p = list[i];
      var res = await sbMT.rpc('mark_notification_seen', { p_kind: p.kind, p_id: String(p.id) });
      if(res.error){
        console.error('Échec persistant de la synchronisation seen_at pour', p.kind, p.id, res.error.message);
      } else {
        mtClearPendingSeen(p.kind, p.id);
      }
    }
  }

  async function mtDismissNotification(n, item){
    mtInvalidateNotifCache();
    mtAddDismissedId(n.kind, n.id);
    mtUnseenNotifications = mtUnseenNotifications.filter(function(u){ return !(u.kind === n.kind && u.id === n.id); });
    item.remove();
    var hasNotif = mtUnseenNotifications.length > 0;
    var navMesTops = document.getElementById('nav-mes-tops');
    var navSoumettre = document.getElementById('nav-soumettre');
    if(navMesTops) navMesTops.classList.toggle('has-notif', hasNotif);
    if(navSoumettre) navSoumettre.classList.toggle('has-notif', hasNotif);
    var countEl = document.getElementById('nav-mes-tops-count');
    if(countEl) countEl.textContent = hasNotif ? String(mtUnseenNotifications.length) : '';
    var success = false;
    for(var attempt = 0; attempt < 3 && !success; attempt++){
      try{
        var res = await sbMT.rpc('mark_notification_seen', { p_kind: n.kind, p_id: String(n.id) });
        if(res && !res.error && res.data === true) success = true;
      } catch(e){}
    }
    if(!success) mtQueuePendingSeen(n.kind, n.id);
  }

  // Exposed for navigate()
  var mtLoadPromise = Promise.resolve();
  window.mtOnNavigate = function(){
    if(!mtLoaded && mtCurrentContributor){
      mtLoaded = true;
      mtLoadPromise = mtLoadPrevSubmissions();
    }
    return mtLoadPromise.then(function(){
      return mtCheckNotifications();
    }).then(function(){
      mtRenderNotifBanner();
    });
  };

  // Init contributor when auth is confirmed
  sbMT.auth.onAuthStateChange(function(event, session){
    if((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session){
      mtCurrentUser = session.user;
      // Timeout/retry + gestion d'échec : une coupure réseau au login ne doit
      // pas casser « Mes tops »/notifications pour toute la session, ni laisser
      // un rejet non géré (qui déclencherait la bannière d'erreur globale).
      tcWithRetryTimeout(function(){ return sbMT.from('contributors').select('*').eq('auth_id', mtCurrentUser.id).single(); }).then(function(r){
        if(r && r.data){
          mtCurrentContributor = r.data;
          mtCheckNotifications();
          // If already on the page, load now
          if(document.getElementById('page-mes-tops').classList.contains('visible')){
            mtLoaded = true;
            mtLoadPrevSubmissions();
          }
        }
      }).catch(function(err){ console.error('mes-tops: chargement du profil contributeur échoué', err); });
    } else if(event === 'SIGNED_OUT'){
      mtCurrentUser = null;
      mtCurrentContributor = null;
      mtLoaded = false;
      mtUnseenNotifications = [];
      // Nettoyage du localStorage à la déconnexion (cf. audit 2.2) : on purge le
      // cache d'affichage « déjà vu » (tc-dismissed-notifs-*) — la source de
      // vérité est désormais seen_at côté serveur. On CONSERVE volontairement
      // tc-pending-seen-* : ces écritures seen_at en échec doivent être rejouées
      // à la prochaine connexion, sinon des notifications pourraient réapparaître.
      try{
        var _toRemove = [];
        for(var _i = 0; _i < localStorage.length; _i++){
          var _k = localStorage.key(_i);
          if(_k && _k.indexOf('tc-dismissed-notifs-') === 0) _toRemove.push(_k);
        }
        _toRemove.forEach(function(k){ localStorage.removeItem(k); });
      }catch(e){}
    }
  });

  // ── STEPPER VISUEL ───────────────────────────────────────────
  function mtUpdateStepper(step){
    [1, 2, 3].forEach(function(n){
      var el = document.getElementById('mt-stepper-' + n);
      if(!el) return;
      el.classList.remove('active', 'done');
      if(n < step) el.classList.add('done');
      else if(n === step) el.classList.add('active');
    });
  }

  // ── AUTOCOMPLETE ─────────────────────────────────────────────
  var _mtAc = createAutocomplete({
    inputId: 'mt-cineaste-input',
    dropdownId: 'mt-cineaste-dropdown',
    getItems: function(){ return DATA && DATA.cineastes ? DATA.cineastes.map(function(c){ return c.nom; }) : []; },
    onSelect: function(nom){ mtSelectedCineaste = nom; mtUpdateStepper(2); }
  });
  document.getElementById('mt-cineaste-input').addEventListener('input', function(){
    mtUpdateStepper(this.value.trim() ? 2 : 1);
  });

  // Une soumission est-elle DÉJÀ EN ATTENTE pour ce cinéaste ?
  // (on ne veut pas en créer une seconde — on renverra vers son édition)
  function mtHasPendingSubmission(cineaste){
    return mtLastSubmissions.some(function(s){
      return s.status === 'pending' && s.parsed_json && s.parsed_json.cineaste && normStr(s.parsed_json.cineaste) === normStr(cineaste);
    });
  }
  // Un top est-il DÉJÀ PUBLIÉ pour ce cinéaste ? (table "tops" via SUPABASE_TOPS)
  // Dans ce cas, une nouvelle soumission est autorisée : c'est une MODIFICATION.
  function mtHasPublishedTop(cineaste){
    return !!(mtCurrentContributor && SUPABASE_TOPS[mtCurrentContributor.json_name] && SUPABASE_TOPS[mtCurrentContributor.json_name][cineaste]);
  }

  function mtParseTops(){
    var cineaste = mtSelectedCineaste || document.getElementById('mt-cineaste-input').value.trim();
    var texte = document.getElementById('mt-tops-textarea').value.trim();
    if(!cineaste){ alert(t('mt_no_cin_alert')); return; }
    if(!texte){ alert(t('mt_no_texte_alert')); return; }

    var dupMsg = document.getElementById('mt-duplicate-msg');
    var isBypass = mtEditBypassCineaste && normStr(mtEditBypassCineaste) === normStr(cineaste);

    // Cas 1 : une soumission est déjà EN ATTENTE pour ce cinéaste. On n'en crée
    // pas une seconde ; on propose de modifier celle en attente (lien cliquable).
    if(!isBypass && mtHasPendingSubmission(cineaste)){
      if(dupMsg){
        dupMsg.textContent = t('mt_dup_pending') + ' ';
        var editLink = document.createElement('button');
        editLink.type = 'button';
        editLink.textContent = t('mt_dup_edit_pending');
        editLink.style.cssText = 'background:none;border:none;padding:0;margin-left:4px;color:var(--rouge,#A33025);text-decoration:underline;cursor:pointer;font:inherit;';
        editLink.addEventListener('click', function(){ if(window.mtGoEditTop) window.mtGoEditTop(cineaste); });
        dupMsg.appendChild(editLink);
        dupMsg.style.display = 'block';
      }
      return;
    }

    // Cas 2 : un top est déjà PUBLIÉ pour ce cinéaste. On NE bloque PLUS : la
    // nouvelle liste saisie est acceptée comme MODIFICATION (le back-office gère
    // la détection « Modification » et la suppression de l'ancien doublon).
    if(!isBypass && mtHasPublishedTop(cineaste)){
      mtEditBypassCineaste = cineaste; // débloque la soumission-modification
      if(dupMsg){ dupMsg.textContent = t('mt_dup_will_replace'); dupMsg.style.display = 'block'; }
    } else if(dupMsg && !isBypass){
      dupMsg.style.display = 'none';
    }

    var btn = document.getElementById('mt-btn-parse');
    btn.disabled = true; btn.textContent = t('mt_analyse_loading');
    document.getElementById('mt-loading-bar').classList.add('visible');
    document.getElementById('mt-result-wrap').classList.remove('visible');
    document.getElementById('mt-success-msg').classList.remove('visible');

    var films = parseTopsBrut(texte);
    btn.disabled = false; btn.textContent = t('mt_analyser');
    document.getElementById('mt-loading-bar').classList.remove('visible');

    if(!films.length){ alert(t('mt_no_films_alert')); return; }

    mtParsedFilms = films;
    mtRenderResult(cineaste, films);
  }

  function mtRenderResult(cineaste, films){
    var parts = cineaste.trim().split(' ');
    var nom = parts[parts.length - 1].toUpperCase();
    var prenom = parts.slice(0, -1).join(' ');
    var resultEl = document.getElementById('mt-result-cineaste');
    resultEl.textContent = prenom ? prenom + ' ' : '';
    var strongEl = document.createElement('strong');
    strongEl.textContent = nom;
    resultEl.appendChild(strongEl);

    var list = document.getElementById('mt-films-list');
    list.innerHTML = '';
    films.forEach(function(f){
      var li = document.createElement('li');
      var titreEl = document.createElement('span'); titreEl.className = 'film-titre'; titreEl.textContent = f.titre;
      li.appendChild(titreEl);
      if(f.annee){ var anneeEl = document.createElement('span'); anneeEl.className = 'film-annee'; anneeEl.textContent = f.annee; li.appendChild(anneeEl); }
      list.appendChild(li);
    });

    var sansAnnee = films.filter(function(f){ return !f.annee; }).length;
    var warn = document.getElementById('mt-parse-warning');
    if(sansAnnee > 0){ warn.textContent = t('mt_sans_annee', sansAnnee); warn.style.display = 'block'; }
    else { warn.style.display = 'none'; }

    document.getElementById('mt-result-wrap').classList.add('visible');
    mtUpdateStepper(3);
  }

  // ── SOUMISSION ────────────────────────────────────────────────
  async function mtSubmitTops(){
    if(!mtParsedFilms || !mtCurrentContributor) return;
    var cineaste = document.getElementById('mt-cineaste-input').value.trim();
    var rawText = document.getElementById('mt-tops-textarea').value.trim();
    var btn = document.getElementById('mt-btn-submit');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'+t('mt_envoi');

    // DÉDOUBLONNAGE : un seul top par (contributeur, cinéaste). Si une soumission
    // existe déjà pour ce cinéaste (quel que soit son statut), on met à jour cette
    // ligne et on la repasse "pending" au lieu de créer un doublon. Le filtre sur
    // parsed_json->>'cineaste' n'étant pas exploitable via l'API REST, on récupère
    // les soumissions du contributeur et on filtre côté client (normStr).
    // Lecture en échec = non bloquante : on retombe sur un INSERT classique.
    var mtExisting = null;
    try {
      var mtDup = await tcWithRetryTimeout(function(){
        return sbMT.from('submissions').select('id, parsed_json, status')
          .eq('contributor_id', mtCurrentContributor.id)
          .limit(200);
      });
      if(mtDup && !mtDup.error && mtDup.data){
        mtExisting = mtDup.data.find(function(row){
          return row.parsed_json && row.parsed_json.cineaste
            && normStr(row.parsed_json.cineaste) === normStr(cineaste);
        }) || null;
      }
    } catch(dupErr){
      console.warn('mtSubmitTops: vérification doublon impossible, on poursuit', dupErr);
    }

    // INSERT non-idempotent : timeout sans relance auto (évite une double soumission).
    // UPDATE idempotent (valeurs fixes) : relance sûre.
    var res;
    try {
      res = await tcWithRetryTimeout(function(){
        if(mtExisting){
          var mergedJson = Object.assign({}, mtExisting.parsed_json, { cineaste: cineaste, films: mtParsedFilms });
          return sbMT.from('submissions')
            .update({ raw_text: rawText, parsed_json: mergedJson, status: 'pending', seen_at: null })
            .eq('id', mtExisting.id)
            .select('id');
        }
        return sbMT.from('submissions').insert({
          contributor_id: mtCurrentContributor.id,
          raw_text: rawText,
          parsed_json: { cineaste: cineaste, films: mtParsedFilms },
          status: 'pending'
        }).select('id');
      }, mtExisting ? {} : { retries: 0 });
    } catch(err){
      alert(t('mt_err_submit') + friendlyError(err)); btn.disabled = false; btn.textContent = t('mt_soumettre'); return;
    }

    if(res.error){ alert(t('mt_err_submit') + friendlyError(res.error)); btn.disabled = false; btn.textContent = t('mt_soumettre'); return; }
    if(!res.data || !res.data.length){ alert(t('mt_err_submit') + 'Droits insuffisants.'); btn.disabled = false; btn.textContent = t('mt_soumettre'); return; }

    // Message de succès : distinct si l'on a mis à jour un top déjà existant.
    var mtOkH3 = document.querySelector('#mt-success-msg h3');
    var mtOkP = document.querySelector('#mt-success-msg p');
    if(mtExisting){
      if(mtOkH3) mtOkH3.textContent = t('mt_maj_h3');
      if(mtOkP) mtOkP.textContent = t('mt_maj_p');
    } else {
      if(mtOkH3) mtOkH3.textContent = t('mt_success_h3');
      if(mtOkP) mtOkP.textContent = t('mt_success_p');
    }

    document.getElementById('mt-result-wrap').classList.remove('visible');
    document.getElementById('mt-success-msg').classList.add('visible');
    btn.disabled = false; btn.textContent = t('mt_soumettre');
    mtLoadPrevSubmissions();
    mtResetForm();
    mtUpdateStepper(1);
  }

  // ── SOUMISSIONS PRÉCÉDENTES ───────────────────────────────────
  async function mtLoadPrevSubmissions(){
    if(!mtCurrentContributor) return;
    var res;
    try {
      res = await tcWithRetryTimeout(function(){ return sbMT.from('submissions').select('id, parsed_json, status, submitted_at').eq('contributor_id', mtCurrentContributor.id).order('submitted_at', { ascending: false }).limit(50); });
    } catch(err){
      // Erreur réseau : on NE masque PAS silencieusement la section (on conserve
      // l'affichage précédent). Nouvel essai à la prochaine ouverture de l'onglet.
      console.error('mtLoadPrevSubmissions: échec réseau', err);
      return;
    }
    // Distingue une erreur (on garde l'état actuel) d'un vrai vide (on masque).
    if(res && res.error){ console.error('mtLoadPrevSubmissions:', res.error.message); return; }
    if(!res.data || !res.data.length){ mtLastSubmissions = []; document.getElementById('mt-prev-section').style.display = 'none'; return; }

    mtLastSubmissions = res.data;
    document.getElementById('mt-prev-section').style.display = 'block';
    var list = document.getElementById('mt-prev-list');
    list.innerHTML = '';

    res.data.forEach(function(s){
      var cineaste = s.parsed_json && s.parsed_json.cineaste ? s.parsed_json.cineaste : '—';
      var films = (s.parsed_json && s.parsed_json.films) || [];
      var nbFilms = films.length;
      var date = new Date(s.submitted_at).toLocaleDateString('fr-FR');
      var statusLabel = {pending: t('mt_status_pending'), approved: t('mt_status_approved'), rejected: t('mt_status_rejected')}[s.status] || s.status;

      var item = document.createElement('div'); item.className = 'prev-item'; item.setAttribute('data-sub-id', s.id);
      var row = document.createElement('div'); row.className = 'prev-item-row';

      var nameSpan = document.createElement('span'); nameSpan.className = 'prev-name'; nameSpan.textContent = cineaste + ' ';
      var metaSpan = document.createElement('span'); metaSpan.style.cssText = 'opacity:0.45;font-size:14px'; metaSpan.textContent = '(' + nbFilms + ' film' + (nbFilms > 1 ? 's' : '') + ' · ' + date + ')'; nameSpan.appendChild(metaSpan);

      var actionsDiv = document.createElement('div'); actionsDiv.className = 'prev-item-actions';
      var statusSpan = document.createElement('span'); statusSpan.className = 'prev-status ' + s.status; statusSpan.textContent = statusLabel;
      var editBtn = document.createElement('button'); editBtn.className = 'prev-btn'; editBtn.textContent = t('mt_modifier');
      var delBtn = document.createElement('button'); delBtn.className = 'prev-btn delete'; delBtn.textContent = 'Supprimer';
      actionsDiv.appendChild(statusSpan); actionsDiv.appendChild(editBtn); actionsDiv.appendChild(delBtn);
      row.appendChild(nameSpan); row.appendChild(actionsDiv);

      var editZone = document.createElement('div'); editZone.className = 'prev-edit-zone';
      var filmsText = films.map(function(f, i){ return (i + 1) + '. ' + f.titre + (f.annee ? ' (' + f.annee + ')' : ''); }).join('\n');
      var ta = document.createElement('textarea'); ta.value = filmsText;
      var editActions = document.createElement('div'); editActions.className = 'prev-edit-actions';
      var saveBtn = document.createElement('button'); saveBtn.className = 'btn-primary'; saveBtn.style.cssText = 'font-size:13px;padding:7px 18px'; saveBtn.textContent = t('mt_sauvegarder');
      var cancelBtn = document.createElement('button'); cancelBtn.className = 'btn-secondary'; cancelBtn.style.cssText = 'font-size:13px;padding:7px 18px'; cancelBtn.textContent = t('mt_annuler');
      var note = document.createElement('div'); note.className = 'prev-edit-note'; note.textContent = t('mt_edit_note');
      editActions.appendChild(saveBtn); editActions.appendChild(cancelBtn);
      editZone.appendChild(ta); editZone.appendChild(editActions); editZone.appendChild(note);
      item.appendChild(row); item.appendChild(editZone);
      list.appendChild(item);

      editBtn.addEventListener('click', function(){ var open = editZone.classList.toggle('visible'); editBtn.textContent = open ? t('mt_fermer') : t('mt_modifier'); });
      cancelBtn.addEventListener('click', function(){ editZone.classList.remove('visible'); editBtn.textContent = t('mt_modifier'); ta.value = filmsText; });
      saveBtn.addEventListener('click', async function(){
        saveBtn.disabled = true; saveBtn.textContent = t('mt_enregistrement');
        var newFilms = ta.value.split('\n').filter(function(l){ return l.trim(); }).map(function(line, i){
          line = line.replace(/^\d+[.\-)\s]+/, '').trim();
          var am = line.match(/\((\d{4})\)\s*$/);
          var annee = am ? parseInt(am[1]) : null;
          var titre = line.replace(/\(\d{4}\)\s*$/, '').trim();
          return { rang: i + 1, titre: titre, annee: annee };
        });
        var newParsedJson = Object.assign({}, s.parsed_json, { films: newFilms });
        var r;
        try {
          // UPDATE idempotent : timeout + relance sûrs.
          r = await tcWithRetryTimeout(function(){ return sbMT.from('submissions').update({ parsed_json: newParsedJson, status: 'pending', seen_at: null }).eq('id', s.id).select('id'); });
        } catch(err){ alert(t('mt_err_submit') + friendlyError(err)); saveBtn.disabled = false; saveBtn.textContent = t('mt_sauvegarder'); return; }
        if(r.error){ alert(t('mt_err_submit') + friendlyError(r.error)); saveBtn.disabled = false; saveBtn.textContent = t('mt_sauvegarder'); return; }
        if(!r.data || !r.data.length){ alert(t('mt_err_submit') + 'Droits insuffisants.'); saveBtn.disabled = false; saveBtn.textContent = t('mt_sauvegarder'); return; }
        mtLoadPrevSubmissions();
      });
      delBtn.addEventListener('click', async function(){
        if(!confirm(t('mt_confirm_del', cineaste))) return;
        delBtn.disabled = true;
        var r;
        try {
          // DELETE idempotent (par id) : timeout + relance sûrs.
          r = await tcWithRetryTimeout(function(){ return sbMT.from('submissions').delete().eq('id', s.id).select('id'); });
        } catch(err){ alert('Erreur : ' + friendlyError(err)); delBtn.disabled = false; return; }
        if(r.error){ alert('Erreur : ' + friendlyError(r.error)); delBtn.disabled = false; return; }
        if(!r.data || !r.data.length){ alert('Erreur : droits insuffisants.'); delBtn.disabled = false; return; }
        mtLoadPrevSubmissions();
      });
    });
  }

  // ── RESET ─────────────────────────────────────────────────────
  function mtResetForm(){
    document.getElementById('mt-cineaste-input').value = '';
    document.getElementById('mt-tops-textarea').value = '';
    document.getElementById('mt-result-wrap').classList.remove('visible');
    document.getElementById('mt-cineaste-dropdown').classList.remove('visible');
    var dupMsg = document.getElementById('mt-duplicate-msg');
    if(dupMsg) dupMsg.style.display = 'none';
    mtSelectedCineaste = null;
    mtParsedFilms = null;
    mtEditBypassCineaste = null;
    mtUpdateStepper(1);
  }

  // ── Pré-remplissage depuis une fiche cinéaste ──────────────────
  window.mtSetCineaste = function(cineaste){
    mtResetForm();
    mtSelectedCineaste = cineaste;
    var inp = document.getElementById('mt-cineaste-input');
    if(inp) inp.value = cineaste;
    mtUpdateStepper(2);
  };

  window.mtGoEditTop = function(cineaste){
    mtResetForm();
    var existing = mtLastSubmissions.find(function(s){
      return s.parsed_json && s.parsed_json.cineaste && normStr(s.parsed_json.cineaste) === normStr(cineaste);
    });
    if(existing){
      var item = document.querySelector('.prev-item[data-sub-id="' + existing.id + '"]');
      if(item){
        var editBtn = item.querySelector('.prev-btn:not(.delete)');
        if(editBtn) editBtn.click();
        item.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }
    // Top issu de l'ancienne table "tops" : reconstruire le texte brut pour permettre une nouvelle soumission
    mtEditBypassCineaste = cineaste;
    mtSelectedCineaste = cineaste;
    var inp = document.getElementById('mt-cineaste-input');
    if(inp) inp.value = cineaste;
    var films = (mtCurrentContributor && SUPABASE_TOPS[mtCurrentContributor.json_name] && SUPABASE_TOPS[mtCurrentContributor.json_name][cineaste]) || [];
    var raw = films.map(function(f, i){ return (i + 1) + '. ' + f.titre + (f.annee ? ' (' + f.annee + ')' : ''); }).join('\n');
    var ta = document.getElementById('mt-tops-textarea');
    if(ta) ta.value = raw;
    mtUpdateStepper(2);
  };

  document.getElementById('mt-btn-parse').addEventListener('click', mtParseTops);
  document.getElementById('mt-btn-reset').addEventListener('click', function(){ mtResetForm(); document.getElementById('mt-success-msg').classList.remove('visible'); });
  document.getElementById('mt-btn-submit').addEventListener('click', mtSubmitTops);

  // ── TABS MES TOPS ─────────────────────────────────────────────
  var mtActiveTab = 'tops';
  document.querySelectorAll('.mt-tab-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      mtActiveTab = btn.getAttribute('data-mt-tab');
      document.querySelectorAll('.mt-tab-btn').forEach(function(b){ b.classList.remove('active'); });
      document.querySelectorAll('.mt-tab-panel').forEach(function(p){ p.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('mt-panel-' + mtActiveTab).classList.add('active');
      if(mtActiveTab === 'propositions') mtLoadProposals();
    });
  });

  // ── PROPOSITIONS ──────────────────────────────────────────────
  async function mtLoadProposals(){
    var listEl = document.getElementById('prop-list');
    listEl.innerHTML = '<div class="prop-empty">' + t('prop_loading') + '</div>';

    var res;
    try {
      res = await tcWithRetryTimeout(function(){
        return sbMT.from('cineaste_proposals')
          .select('*, cineaste_proposal_votes(contributor_id, contributors(display_name))')
          .eq('status', 'pending')
          .order('submitted_at', { ascending: false });
      });
    } catch(err){ listEl.innerHTML = '<div class="prop-empty">' + t('prop_err_loading') + '</div>'; return; }

    if(res.error){ listEl.innerHTML = '<div class="prop-empty">' + t('prop_err_loading') + '</div>'; return; }
    if(!res.data || !res.data.length){ listEl.innerHTML = '<div class="prop-empty">' + t('prop_empty') + '</div>'; return; }

    listEl.innerHTML = '';
    res.data.forEach(function(p){
      var votes = p.cineaste_proposal_votes || [];
      var myContribId = mtCurrentContributor && mtCurrentContributor.id;
      var myVote = myContribId && votes.some(function(v){ return v.contributor_id === myContribId; });
      var voterNames = votes.map(function(v){ return v.contributors && v.contributors.display_name ? v.contributors.display_name : '?'; });

      var nomComplet = (p.prenom ? p.prenom + ' ' : '') + p.nom;
      var annees = [];
      if(p.annee_naissance) annees.push(t('prop_ne_en', p.annee_naissance));
      if(p.annee_deces) annees.push(t('prop_decede_en', p.annee_deces));

      var card = document.createElement('div');
      card.className = 'prop-card';

      var nameEl = document.createElement('div'); nameEl.className = 'prop-card-name'; nameEl.textContent = nomComplet;
      var metaEl = document.createElement('div'); metaEl.className = 'prop-card-meta'; metaEl.textContent = annees.length ? annees.join(', ') : t('prop_annees_non_renseignees');
      var footer = document.createElement('div'); footer.className = 'prop-card-footer';

      var voteBtn = document.createElement('button');
      voteBtn.className = 'prop-vote-btn' + (myVote ? ' voted' : '');
      voteBtn.textContent = t('prop_votes', votes.length);
      voteBtn.setAttribute('data-voted', myVote ? '1' : '0');

      var votersEl = document.createElement('span'); votersEl.className = 'prop-voters';
      votersEl.textContent = voterNames.length ? voterNames.join(', ') : '';

      var byEl = document.createElement('span'); byEl.className = 'prop-by';
      byEl.textContent = t('prop_by', p.contributor_name || '?');

      footer.appendChild(voteBtn);
      footer.appendChild(votersEl);
      footer.appendChild(byEl);
      card.appendChild(nameEl); card.appendChild(metaEl); card.appendChild(footer);
      listEl.appendChild(card);

      (function(proposalId, btn){
        var voted = myVote;
        btn.addEventListener('click', function(){
          if(!mtCurrentContributor){ alert(t('prop_alert_login_vote')); return; }
          btn.disabled = true;
          mtToggleVote(proposalId, voted).then(function(){ mtLoadProposals(); }).catch(function(err){ btn.disabled = false; alert(t('prop_err_err') + friendlyError(err)); });
          voted = !voted;
        });
      })(p.id, voteBtn);
    });
  }

  async function mtToggleVote(proposalId, currentlyVoted){
    if(currentlyVoted){
      // DELETE idempotent : timeout + relance sûrs.
      var res = await tcWithRetryTimeout(function(){
        return sbMT.from('cineaste_proposal_votes')
          .delete()
          .eq('proposal_id', proposalId)
          .eq('contributor_id', mtCurrentContributor.id)
          .select('proposal_id');
      });
      if(res.error) throw new Error(res.error.message);
      if(!res.data || !res.data.length) throw new Error('Droits insuffisants.');
    } else {
      // INSERT non-idempotent : timeout sans relance auto (l'index unique
      // empêche les doublons, mais on évite un aller-retour d'erreur inutile).
      var res = await tcWithRetryTimeout(function(){
        return sbMT.from('cineaste_proposal_votes').insert({
          proposal_id: proposalId,
          contributor_id: mtCurrentContributor.id
        }).select('proposal_id');
      }, { retries: 0 });
      if(res.error) throw new Error(res.error.message);
      if(!res.data || !res.data.length) throw new Error('Droits insuffisants.');
    }
  }

  document.getElementById('prop-btn-submit').addEventListener('click', async function(){
    if(!mtCurrentContributor){ alert(t('prop_alert_login_submit')); return; }
    var prenom = document.getElementById('prop-prenom').value.trim();
    var nom = document.getElementById('prop-nom').value.trim().toUpperCase();
    var naissanceVal = document.getElementById('prop-naissance').value;
    var decesVal = document.getElementById('prop-deces').value;
    var naissance = naissanceVal ? parseInt(naissanceVal) : null;
    var deces = decesVal ? parseInt(decesVal) : null;

    if(!nom){ alert(t('prop_alert_nom_required')); return; }

    var nomComplet = (prenom ? prenom + ' ' : '') + nom;
    var dejaListe = DATA && DATA.cineastes ? DATA.cineastes.some(function(c){ return normStr(c.nom) === normStr(nomComplet); }) : false;
    if(dejaListe){ alert(t('prop_alert_already_listed')); return; }

    var btn = this;
    btn.disabled = true; btn.textContent = t('prop_envoi');

    var dupRes;
    try {
      dupRes = await tcWithRetryTimeout(function(){ return sbMT.from('cineaste_proposals').select('id, nom').eq('status', 'pending').ilike('nom', nom); });
    } catch(err){ btn.disabled = false; btn.textContent = t('prop_btn_submit'); alert(t('prop_err_err') + friendlyError(err)); return; }
    if(!dupRes.error && dupRes.data && dupRes.data.some(function(p){ return normStr(p.nom || '') === normStr(nom); })){
      btn.disabled = false; btn.textContent = t('prop_btn_submit');
      alert(t('prop_alert_already_pending'));
      return;
    }

    // INSERT non-idempotent : timeout sans relance auto (évite une double suggestion).
    var res;
    try {
      res = await tcWithRetryTimeout(function(){
        return sbMT.from('cineaste_proposals').insert({
          contributor_id: mtCurrentContributor.id,
          contributor_name: mtCurrentContributor.display_name || mtCurrentContributor.json_name,
          nom: nom,
          prenom: prenom,
          annee_naissance: naissance,
          annee_deces: deces,
          status: 'pending'
        }).select('id');
      }, { retries: 0 });
    } catch(err){ btn.disabled = false; btn.textContent = t('prop_btn_submit'); alert(t('prop_err_err') + friendlyError(err)); return; }

    btn.disabled = false; btn.textContent = t('prop_btn_submit');

    if(res.error){ alert(t('prop_err_err') + friendlyError(res.error)); return; }
    if(!res.data || !res.data.length){ alert(t('prop_err_err') + 'Droits insuffisants.'); return; }

    document.getElementById('prop-prenom').value = '';
    document.getElementById('prop-nom').value = '';
    document.getElementById('prop-naissance').value = '';
    document.getElementById('prop-deces').value = '';
    var successEl = document.getElementById('prop-success');
    successEl.style.display = 'block';
    setTimeout(function(){ successEl.style.display = 'none'; }, 3000);
    mtLoadProposals();
  });
})()
