// ── PHOTOGRAMME ──────────────────────────────────────────────
// Module autonome (même schéma que "Mes tops") : suivi d'auth séparé,
// hook window.pgOnNavigate(), et son propre listener de clic basé sur
// data-pg-action (n'interfère jamais avec le switch data-action existant).
(function(){
  var sbPG = TC_SB;

  var pgCurrentUser = null;
  var pgCurrentContributor = null;
  var pgLoaded = false;
  var pgView = 'list'; // 'list' | 'create' | 'play' | 'manage' | 'results'
  var pgActiveSessionId = null;
  var pgActiveSession = null;
  var pgActiveImages = [];
  var pgActiveHints = {};
  var pgMyResponses = {};
  var pgActiveResponses = {};
  var pgChannel = null;
  var pgAutolaunchTimer = null;

  function pgRoot(){ return document.getElementById('pg-root'); }

  function pgFmtDateTime(iso){
    if(!iso) return '';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '';
    return d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'}) + ' à ' + d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
  }
  function pgFmtTime(iso){
    if(!iso) return '';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }
  function pgStatusLabel(status){ return t('pg_status_'+status) || status; }
  function pgIsOrganizer(session){ return !!(pgCurrentContributor && session && session.organizer_id === pgCurrentContributor.id); }

  // ── Realtime + filet de sécurité côté client ──────────────────
  function pgEnsureRealtime(){
    if(pgChannel) return;
    pgChannel = sbPG.channel('pg-live')
      .on('postgres_changes', { event:'*', schema:'public', table:'photogramme_sessions' }, function(payload){ pgHandleSessionChange(payload); })
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'photogramme_hints' }, function(payload){ pgHandleHintInsert(payload); })
      .subscribe();
  }
  function pgEnsureAutolaunch(){
    if(pgAutolaunchTimer) return;
    pgAutolaunchTimer = setInterval(function(){
      sbPG.rpc('tc_launch_due_photogramme_sessions').catch(function(){});
    }, TC_PHOTOGRAMME_AUTOLAUNCH_POLL_MS);
  }

  function pgHandleSessionChange(payload){
    var row = (payload.new && payload.new.id) ? payload.new : payload.old;
    if(!row) return;
    if(pgView === 'list'){ pgRenderList(); return; }
    if(pgActiveSessionId !== row.id) return;
    if(payload.new) pgActiveSession = payload.new;
    if(pgView === 'play' && pgActiveSession.status === 'closed'){ pgOpenResults(pgActiveSessionId); }
  }
  function pgHandleHintInsert(payload){
    var hint = payload.new;
    if(!hint) return;
    if(pgView === 'play' && pgActiveImages.some(function(im){ return im.id === hint.image_id; })){
      pgRefreshHintsFor(hint.image_id);
    }
  }

  // ── Entrée : appelée par navigate('photogramme') et au changement de langue ──
  window.pgOnNavigate = function(){
    pgEnsureRealtime();
    pgEnsureAutolaunch();
    pgLoaded = true;
    pgRenderList();
  };

  sbPG.auth.onAuthStateChange(function(event, session){
    if((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session){
      pgCurrentUser = session.user;
      sbPG.from('contributors').select('*').eq('auth_id', pgCurrentUser.id).single().then(function(r){
        if(r.data) pgCurrentContributor = r.data;
      });
    } else if(event === 'SIGNED_OUT'){
      pgCurrentUser = null;
      pgCurrentContributor = null;
    }
  });

  // ── LISTE DES SESSIONS ─────────────────────────────────────────
  function pgRenderList(){
    pgView = 'list'; pgActiveSessionId = null; pgActiveSession = null;
    var root = pgRoot();
    root.innerHTML = '<div class="empty-msg">'+t('pg_chargement')+'</div>';
    tcWithRetryTimeout(function(){
      return sbPG.from('photogramme_sessions').select('*, contributors(display_name)').order('created_at',{ascending:false});
    }).then(function(res){
      if(res.error){ root.innerHTML = '<div class="empty-msg">'+friendlyError(res.error)+'</div>'; return; }
      pgRenderListHtml(res.data || []);
    }).catch(function(e){
      root.innerHTML = '<div class="empty-msg">'+friendlyError(e)+'</div>';
    });
  }

  function pgRenderListHtml(sessions){
    var root = pgRoot();
    var live = sessions.filter(function(s){ return s.status === 'live'; });
    var scheduled = sessions.filter(function(s){ return s.status === 'scheduled'; });
    var drafts = pgCurrentContributor ? sessions.filter(function(s){ return s.status === 'draft' && s.organizer_id === pgCurrentContributor.id; }) : [];
    var closed = sessions.filter(function(s){ return s.status === 'closed'; });

    var html = '<div class="pg-toolbar">';
    if(pgCurrentContributor){
      html += '<button class="btn-primary" data-pg-action="pg-create-session">'+t('pg_creer_session')+'</button>';
    } else {
      html += '<div class="empty-msg">'+t('pg_connexion_requise_creer')+'</div>';
    }
    html += '</div>';

    var groups = pgRenderSessionGroup(t('pg_groupe_live'), live, '🔴')
      + pgRenderSessionGroup(t('pg_groupe_scheduled'), scheduled, '🕒')
      + pgRenderSessionGroup(t('pg_groupe_drafts'), drafts, '✏️')
      + pgRenderSessionGroup(t('pg_groupe_closed'), closed, '🏁');

    html += groups || ('<div class="empty-msg">'+t('pg_aucune_session')+'</div>');
    root.innerHTML = html;
  }

  function pgRenderSessionGroup(title, list, icon){
    if(!list.length) return '';
    var html = '<div class="pg-group-title">'+icon+' '+title+'</div>';
    html += '<div class="pg-session-list">'+list.map(pgSessionCard).join('')+'</div>';
    return html;
  }

  function pgSessionCard(s){
    var organizerName = (s.contributors && s.contributors.display_name) || '?';
    var isOwner = pgCurrentContributor && s.organizer_id === pgCurrentContributor.id;
    var meta = '';
    if(s.status === 'scheduled') meta = t('pg_programmee_pour', pgFmtDateTime(s.scheduled_at));
    else if(s.status === 'live') meta = t('pg_demarree_a', pgFmtDateTime(s.started_at));
    else if(s.status === 'closed') meta = t('pg_cloturee_a', pgFmtDateTime(s.closed_at));
    else meta = t('pg_brouillon_meta');

    var actionBtn = '';
    if(s.status === 'live'){
      actionBtn = isOwner
        ? '<button class="btn-primary" data-pg-action="pg-open-manage" data-pg-session="'+s.id+'">'+t('pg_gerer')+'</button>'
        : '<button class="btn-primary" data-pg-action="pg-open-play" data-pg-session="'+s.id+'">'+t('pg_jouer')+'</button>';
    } else if(s.status === 'closed'){
      actionBtn = '<button class="btn-secondary" data-pg-action="pg-open-results" data-pg-session="'+s.id+'">'+t('pg_voir_resultats')+'</button>';
    } else if(s.status === 'scheduled'){
      actionBtn = isOwner ? '<button class="btn-secondary" data-pg-action="pg-open-create" data-pg-session="'+s.id+'">'+t('pg_gerer')+'</button>' : '';
    } else if(s.status === 'draft' && isOwner){
      actionBtn = '<button class="btn-secondary" data-pg-action="pg-open-create" data-pg-session="'+s.id+'">'+t('pg_continuer_edition')+'</button>';
    }

    return '<div class="pg-session-card">'
      + '<div class="pg-session-main">'
      + '<div class="pg-session-title">'+t('pg_session_num',[s.id])+(s.titre?' — '+escapeHtml(s.titre):'')+'</div>'
      + '<div class="pg-session-meta">'+t('pg_par', escapeHtml(organizerName))+' · '+meta+'</div>'
      + '</div>'
      + '<div class="pg-session-actions">'+actionBtn+'</div>'
      + '</div>';
  }

  // ── CRÉATION / ÉDITION (organisateur) ──────────────────────────
  function pgCreateSession(){
    if(!pgCurrentContributor) return;
    tcWithRetryTimeout(function(){
      return sbPG.from('photogramme_sessions').insert({ organizer_id: pgCurrentContributor.id, titre: '', status: 'draft' }).select().single();
    }).then(function(res){
      if(res.error){ alert(friendlyError(res.error)); return; }
      pgOpenCreate(res.data.id);
    }).catch(function(e){ alert(friendlyError(e)); });
  }

  function pgOpenCreate(sessionId){
    pgView = 'create'; pgActiveSessionId = sessionId;
    var root = pgRoot();
    root.innerHTML = '<div class="empty-msg">'+t('pg_chargement')+'</div>';
    tcWithRetryTimeout(function(){
      return sbPG.from('photogramme_sessions').select('*').eq('id', sessionId).single();
    }).then(function(sRes){
      if(sRes.error || !sRes.data) throw sRes.error || new Error('not found');
      pgActiveSession = sRes.data;
      if(!pgIsOrganizer(pgActiveSession)){ root.innerHTML = '<div class="empty-msg">'+t('pg_non_autorise')+'</div>'; var err={__handled:true}; throw err; }
      return tcWithRetryTimeout(function(){
        return sbPG.from('photogramme_images').select('*').eq('session_id', sessionId).order('ordre',{ascending:true});
      });
    }).then(function(iRes){
      pgActiveImages = (iRes && iRes.data) || [];
      pgRenderCreate();
    }).catch(function(e){
      if(e && e.__handled) return;
      root.innerHTML = '<div class="empty-msg">'+friendlyError(e)+'</div>';
    });
  }

  function pgRenderCreate(){
    var s = pgActiveSession;
    var root = pgRoot();
    var canEditImages = (s.status === 'draft' || s.status === 'scheduled');
    var html = '';
    html += '<div class="pg-create-header">';
    html += '<button class="btn-secondary" data-pg-action="pg-back-to-list">'+t('pg_retour_liste')+'</button>';
    html += '<span class="pg-status-badge pg-status-'+s.status+'">'+pgStatusLabel(s.status)+'</span>';
    html += '</div>';

    html += '<div class="mt-block">';
    html += '<div class="mt-block-header"><div class="mt-block-step">1</div><div class="mt-block-title">'+t('pg_titre_session')+'</div></div>';
    html += '<input type="text" class="pg-input" id="pg-titre-input" placeholder="'+t('pg_titre_ph')+'" value="'+escapeHtml(s.titre||'')+'" '+(canEditImages?'':'disabled')+'>';
    html += '</div>';

    html += '<div class="mt-block">';
    html += '<div class="mt-block-header"><div class="mt-block-step">2</div><div class="mt-block-title">'+t('pg_photogrammes')+' ('+pgActiveImages.length+'/'+TC_PHOTOGRAMME_MAX_IMAGES+')</div></div>';
    html += '<div class="pg-images-grid" id="pg-images-grid">'+pgActiveImages.map(pgImageEditCard).join('')+'</div>';
    if(canEditImages && pgActiveImages.length < TC_PHOTOGRAMME_MAX_IMAGES){
      html += '<div class="pg-add-image-form">';
      html += '<input type="text" id="pg-new-titre-film" class="pg-input" placeholder="'+t('pg_titre_film_ph')+'">';
      html += '<input type="file" id="pg-new-image-file" accept="image/jpeg,image/png,image/webp">';
      html += '<button class="btn-primary" data-pg-action="pg-add-image">'+t('pg_ajouter_photogramme')+'</button>';
      html += '<span class="spinner" id="pg-add-spinner" style="display:none"></span>';
      html += '</div>';
    }
    html += '</div>';

    if(canEditImages){
      html += '<div class="mt-block">';
      html += '<div class="mt-block-header"><div class="mt-block-step mt-step-dark">3</div><div class="mt-block-title">'+t('pg_lancement')+'</div></div>';
      html += '<div class="pg-launch-row">';
      html += '<button class="btn-primary" data-pg-action="pg-launch-now" '+(pgActiveImages.length?'':'disabled')+'>'+t('pg_lancer_maintenant')+'</button>';
      html += '<span class="pg-launch-or">'+t('pg_ou')+'</span>';
      html += '<input type="datetime-local" id="pg-schedule-at" class="pg-input">';
      html += '<button class="btn-secondary" data-pg-action="pg-schedule" '+(pgActiveImages.length?'':'disabled')+'>'+t('pg_programmer')+'</button>';
      html += '</div>';
      html += '<button class="pg-delete-link" data-pg-action="pg-delete-session">'+t('pg_supprimer_session')+'</button>';
      html += '</div>';
    } else if(s.status === 'live'){
      html += '<div class="mt-block"><button class="btn-primary" data-pg-action="pg-open-manage" data-pg-session="'+s.id+'">'+t('pg_aller_a_la_gestion')+'</button></div>';
    }

    root.innerHTML = html;
    var titreInput = document.getElementById('pg-titre-input');
    if(titreInput){
      titreInput.addEventListener('change', function(){
        var val = this.value.trim();
        sbPG.from('photogramme_sessions').update({ titre: val }).eq('id', s.id).then(function(res){
          if(!res.error) pgActiveSession.titre = val;
        });
      });
    }
  }

  function pgImageEditCard(img){
    return '<div class="pg-image-card">'
      + '<img src="'+img.image_url+'" loading="lazy">'
      + '<div class="pg-image-card-ordre">N°'+img.ordre+'</div>'
      + '<div class="pg-image-card-titre">'+escapeHtml(img.titre_film)+'</div>'
      + '<button class="pg-image-card-del" data-pg-action="pg-delete-image" data-pg-image="'+img.id+'" title="'+t('pg_supprimer')+'">✕</button>'
      + '</div>';
  }

  function pgAddImage(){
    var fileInput = document.getElementById('pg-new-image-file');
    var titreInput = document.getElementById('pg-new-titre-film');
    var file = fileInput.files[0];
    var titre = titreInput.value.trim();
    if(!titre){ alert(t('pg_err_titre_film_requis')); return; }
    if(!file){ alert(t('pg_err_image_requise')); return; }
    var allowed = ['image/jpeg','image/png','image/webp'];
    if(!allowed.includes(file.type)){ alert(t('pg_err_format')); fileInput.value=''; return; }
    if(file.size > TC_PHOTOGRAMME_MAX_SIZE){ alert(t('pg_err_taille')); fileInput.value=''; return; }

    var spinner = document.getElementById('pg-add-spinner');
    var sliceReader = new FileReader();
    sliceReader.onload = function(ev){
      var bytes = new Uint8Array(ev.target.result);
      var valid = (
        (bytes[0]===0xFF&&bytes[1]===0xD8&&bytes[2]===0xFF) ||
        (bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4E&&bytes[3]===0x47) ||
        (bytes[0]===0x52&&bytes[1]===0x49&&bytes[2]===0x46&&bytes[3]===0x46)
      );
      if(!valid){ alert(t('pg_err_format')); fileInput.value=''; return; }
      spinner.style.display = 'inline-block';
      var ordre = pgActiveImages.length ? Math.max.apply(null, pgActiveImages.map(function(i){ return i.ordre; })) + 1 : 1;
      var ext = file.name.split('.').pop().toLowerCase();
      var path = pgCurrentContributor.id+'/'+pgActiveSessionId+'/'+ordre+'_'+Date.now()+'.'+ext;
      sbPG.storage.from('photogrammes').upload(path, file, { upsert: true, contentType: file.type }).then(function(upRes){
        if(upRes.error){ spinner.style.display='none'; alert(friendlyError(upRes.error)); return; }
        var publicUrl = sbPG.storage.from('photogrammes').getPublicUrl(path).data.publicUrl;
        return sbPG.from('photogramme_images').insert({ session_id: pgActiveSessionId, ordre: ordre, image_url: publicUrl, titre_film: titre }).select().single();
      }).then(function(insRes){
        spinner.style.display = 'none';
        if(!insRes) return;
        if(insRes.error){ alert(friendlyError(insRes.error)); return; }
        pgActiveImages.push(insRes.data);
        pgRenderCreate();
      }).catch(function(e){ spinner.style.display='none'; alert(friendlyError(e)); });
    };
    sliceReader.readAsArrayBuffer(file.slice(0,4));
  }

  function pgDeleteImage(imageId){
    if(!confirm(t('pg_confirm_supprimer_photogramme'))) return;
    sbPG.from('photogramme_images').delete().eq('id', imageId).then(function(res){
      if(res.error){ alert(friendlyError(res.error)); return; }
      pgActiveImages = pgActiveImages.filter(function(i){ return i.id !== imageId; });
      pgRenderCreate();
    });
  }

  function pgLaunchNow(){
    if(!pgActiveImages.length) return;
    if(!confirm(t('pg_confirm_lancer'))) return;
    sbPG.from('photogramme_sessions').update({ status: 'live' }).eq('id', pgActiveSessionId).select().single().then(function(res){
      if(res.error){ alert(friendlyError(res.error)); return; }
      pgOpenManage(pgActiveSessionId);
    });
  }

  function pgSchedule(){
    if(!pgActiveImages.length) return;
    var inputEl = document.getElementById('pg-schedule-at');
    if(!inputEl.value){ alert(t('pg_err_date_requise')); return; }
    var d = new Date(inputEl.value);
    if(isNaN(d.getTime()) || d.getTime() <= Date.now()){ alert(t('pg_err_date_future')); return; }
    sbPG.from('photogramme_sessions').update({ status: 'scheduled', scheduled_at: d.toISOString() }).eq('id', pgActiveSessionId).select().single().then(function(res){
      if(res.error){ alert(friendlyError(res.error)); return; }
      pgActiveSession = res.data;
      pgRenderCreate();
    });
  }

  function pgDeleteSession(){
    if(!confirm(t('pg_confirm_supprimer_session'))) return;
    sbPG.from('photogramme_sessions').delete().eq('id', pgActiveSessionId).then(function(res){
      if(res.error){ alert(friendlyError(res.error)); return; }
      pgRenderList();
    });
  }

  // ---------- VUE JEU (PLAY) ----------

  function pgOpenPlay(sessionId){
    pgView = 'play';
    pgActiveSessionId = sessionId;
    pgRoot().innerHTML = '<div class="spinner"></div>';
    sbPG.from('photogramme_sessions').select('*, contributors(display_name)').eq('id', sessionId).single().then(function(res){
      if(res.error || !res.data){ pgRoot().innerHTML = '<div class="empty-msg">'+t('pg_session_introuvable')+'</div>'; return; }
      pgActiveSession = res.data;
      if(pgActiveSession.status === 'closed'){ pgOpenResults(sessionId); return; }
      if(pgActiveSession.status !== 'live'){ pgRenderList(); return; }
      return sbPG.from('photogramme_images_public').select('*').eq('session_id', sessionId).order('ordre', { ascending: true }).then(function(imgRes){
        pgActiveImages = imgRes.data || [];
        var imgIds = pgActiveImages.map(function(i){ return i.id; });
        var p1 = pgCurrentContributor
          ? sbPG.from('photogramme_reponses').select('*').eq('session_id', sessionId).eq('contributor_id', pgCurrentContributor.id)
          : Promise.resolve({ data: [] });
        var p2 = imgIds.length
          ? sbPG.from('photogramme_hints_public').select('*').in('image_id', imgIds).order('revealed_at', { ascending: true })
          : Promise.resolve({ data: [] });
        return Promise.all([p1, p2]);
      });
    }).then(function(results){
      if(!results) return;
      var respRes = results[0], hintRes = results[1];
      pgMyResponses = {};
      (respRes.data||[]).forEach(function(r){ pgMyResponses[r.image_id] = r; });
      pgActiveHints = {};
      (hintRes.data||[]).forEach(function(h){
        if(!pgActiveHints[h.image_id]) pgActiveHints[h.image_id] = [];
        pgActiveHints[h.image_id].push(h);
      });
      pgRenderPlay();
    }).catch(function(e){ pgRoot().innerHTML = '<div class="empty-msg">'+escapeHtml(friendlyError(e))+'</div>'; });
  }

  function pgRenderPlay(){
    if(!pgCurrentContributor){
      pgRoot().innerHTML = '<div class="empty-msg">'+t('pg_connexion_requise_jouer')+'</div>';
      return;
    }
    var orgName = (pgActiveSession.contributors && pgActiveSession.contributors.display_name) || '?';
    var html = '';
    html += '<div class="pg-play-header">';
    html += '<div class="pg-play-title">'+t('pg_session_num',[pgActiveSession.id])+' — '+escapeHtml(pgActiveSession.titre||'')+'</div>';
    html += '<div class="pg-play-organizer">'+t('pg_organise_par',[escapeHtml(orgName)])+'</div>';
    html += '</div>';
    html += '<a href="#" data-pg-action="pg-back-to-list" class="pg-delete-link">&#8592; '+t('pg_retour_liste')+'</a>';
    html += '<div class="pg-photo-list">';
    pgActiveImages.forEach(function(img){ html += pgPhotoCard(img); });
    html += '</div>';
    pgRoot().innerHTML = html;
  }

  function pgPhotoCard(img){
    var myResp = pgMyResponses[img.id];
    var hints = pgActiveHints[img.id] || [];
    var html = '<div class="pg-photo-card" id="pg-photo-'+img.id+'">';
    html += '<div class="pg-photo-num">'+t('pg_photogramme_num',[img.ordre])+'</div>';
    html += '<img class="pg-photo-img" src="'+escapeHtml(img.image_url)+'" alt="">';
    html += pgHintsHtml(hints);
    if(myResp){
      html += '<div class="pg-answer-sent">'+t('pg_reponse_envoyee')+' : "'+escapeHtml(myResp.reponse_texte)+'"</div>';
    } else {
      html += '<div class="pg-answer-zone">';
      html += '<input type="text" class="pg-answer-input" id="pg-answer-input-'+img.id+'" data-pg-image="'+img.id+'" placeholder="'+escapeHtml(t('pg_reponse_ph'))+'" autocomplete="off">';
      html += '<button class="btn-primary" data-pg-action="pg-submit-answer" data-pg-image="'+img.id+'">'+t('pg_valider')+'</button>';
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function pgHintsHtml(hints){
    if(!hints.length) return '';
    var html = '<div class="pg-hints"><ul class="pg-hint-list">';
    hints.forEach(function(h){ html += '<li class="pg-hint-item">'+escapeHtml(h.texte)+'</li>'; });
    html += '</ul></div>';
    return html;
  }

  function pgSubmitAnswer(imageId){
    var inputEl = document.getElementById('pg-answer-input-'+imageId);
    if(!inputEl) return;
    var texte = inputEl.value.trim();
    if(!texte) return;
    inputEl.disabled = true;
    sbPG.rpc('submit_photogramme_answer', { p_image_id: imageId, p_reponse: texte }).then(function(res){
      if(res.error){ inputEl.disabled = false; alert(friendlyError(res.error)); return; }
      pgMyResponses[imageId] = res.data;
      var card = document.getElementById('pg-photo-'+imageId);
      if(card){
        var img = pgActiveImages.filter(function(i){ return i.id === imageId; })[0];
        if(img) card.outerHTML = pgPhotoCard(img);
      }
    }).catch(function(e){ inputEl.disabled = false; alert(friendlyError(e)); });
  }

  function pgRefreshHintsFor(imageId){
    sbPG.from('photogramme_hints_public').select('*').eq('image_id', imageId).order('revealed_at', { ascending: true }).then(function(res){
      pgActiveHints[imageId] = res.data || [];
      var card = document.getElementById('pg-photo-'+imageId);
      if(card){
        var img = pgActiveImages.filter(function(i){ return i.id === imageId; })[0];
        if(img) card.outerHTML = pgPhotoCard(img);
      }
    });
  }

  document.addEventListener('keydown', function(e){
    if(e.key !== 'Enter') return;
    var el = e.target;
    if(el && el.classList && el.classList.contains('pg-answer-input')){
      e.preventDefault();
      pgSubmitAnswer(parseInt(el.getAttribute('data-pg-image'), 10));
    }
  });

  // ---------- VUE GESTION (MANAGE) ----------

  function pgOpenManage(sessionId){
    pgView = 'manage';
    pgActiveSessionId = sessionId;
    pgRoot().innerHTML = '<div class="spinner"></div>';
    sbPG.from('photogramme_sessions').select('*, contributors(display_name)').eq('id', sessionId).single().then(function(res){
      if(res.error || !res.data){ pgRoot().innerHTML = '<div class="empty-msg">'+t('pg_session_introuvable')+'</div>'; return; }
      pgActiveSession = res.data;
      if(!pgIsOrganizer(pgActiveSession)){ pgRoot().innerHTML = '<div class="empty-msg">'+t('pg_non_autorise')+'</div>'; return; }
      return sbPG.from('photogramme_images').select('*').eq('session_id', sessionId).order('ordre', { ascending: true }).then(function(imgRes){
        pgActiveImages = imgRes.data || [];
        var imgIds = pgActiveImages.map(function(i){ return i.id; });
        var p1 = imgIds.length
          ? sbPG.from('photogramme_reponses').select('*, contributors(display_name)').in('image_id', imgIds).order('submitted_at', { ascending: true })
          : Promise.resolve({ data: [] });
        var p2 = imgIds.length
          ? sbPG.from('photogramme_hints').select('*').in('image_id', imgIds).order('revealed_at', { ascending: true })
          : Promise.resolve({ data: [] });
        return Promise.all([p1, p2]);
      });
    }).then(function(results){
      if(!results) return;
      var respRes = results[0], hintRes = results[1];
      pgActiveResponses = {};
      (respRes.data||[]).forEach(function(r){
        if(!pgActiveResponses[r.image_id]) pgActiveResponses[r.image_id] = [];
        pgActiveResponses[r.image_id].push(r);
      });
      pgActiveHints = {};
      (hintRes.data||[]).forEach(function(h){
        if(!pgActiveHints[h.image_id]) pgActiveHints[h.image_id] = [];
        pgActiveHints[h.image_id].push(h);
      });
      pgRenderManage();
    }).catch(function(e){ pgRoot().innerHTML = '<div class="empty-msg">'+escapeHtml(friendlyError(e))+'</div>'; });
  }

  function pgRenderManage(){
    var html = '';
    html += '<div class="pg-play-header">';
    html += '<div class="pg-play-title">'+t('pg_session_num',[pgActiveSession.id])+' — '+escapeHtml(pgActiveSession.titre||'')+'</div>';
    html += '<span class="pg-status-badge pg-status-'+pgActiveSession.status+'">'+pgStatusLabel(pgActiveSession.status)+'</span>';
    html += '</div>';
    html += '<a href="#" data-pg-action="pg-back-to-list" class="pg-delete-link">&#8592; '+t('pg_retour_liste')+'</a>';
    if(pgActiveSession.status === 'live'){
      html += '<button class="btn-secondary pg-close-btn" data-pg-action="pg-close-session">'+t('pg_cloturer_session')+'</button>';
    }
    pgActiveImages.forEach(function(img){ html += pgManageImageBlock(img); });
    pgRoot().innerHTML = html;
  }

  function pgManageImageBlock(img){
    var resps = pgActiveResponses[img.id] || [];
    var hints = pgActiveHints[img.id] || [];
    var html = '<div class="pg-manage-block">';
    html += '<div class="pg-manage-img-row">';
    html += '<img class="pg-manage-thumb" src="'+escapeHtml(img.image_url)+'" alt="">';
    html += '<div><div class="pg-photo-num">'+t('pg_photogramme_num',[img.ordre])+'</div>';
    html += '<div class="pg-session-meta">'+escapeHtml(img.titre_film)+'</div></div>';
    html += '</div>';
    html += '<div class="pg-manage-hints">';
    hints.forEach(function(h){ html += '<span class="pg-hint-item">'+escapeHtml(h.texte)+'</span>'; });
    if(pgActiveSession.status === 'live'){
      html += '<div class="pg-hint-add">';
      html += '<input type="text" class="pg-input" id="pg-hint-input-'+img.id+'" placeholder="'+escapeHtml(t('pg_indice_ph'))+'">';
      html += '<button class="btn-secondary" data-pg-action="pg-reveal-hint" data-pg-image="'+img.id+'">'+t('pg_reveler_indice')+'</button>';
      html += '</div>';
    }
    html += '</div>';
    if(!resps.length){
      html += '<div class="empty-msg">'+t('pg_aucune_reponse')+'</div>';
    } else {
      html += '<table class="pg-resp-table">';
      resps.forEach(function(r){ html += pgRespRow(r, img); });
      html += '</table>';
    }
    html += '</div>';
    return html;
  }

  function pgRespRow(r, img){
    var name = (r.contributors && r.contributors.display_name) || '?';
    var graded = r.is_correct !== null && r.is_correct !== undefined;
    var cls = graded ? (r.is_correct ? ' pg-resp-row-correct' : ' pg-resp-row-incorrect') : '';
    var html = '<tr class="pg-resp-row'+cls+'">';
    html += '<td class="pg-resp-name">'+escapeHtml(name)+'</td>';
    html += '<td class="pg-resp-text">'+escapeHtml(r.reponse_texte)+'</td>';
    html += '<td class="pg-resp-time">'+pgFmtTime(r.submitted_at)+(r.hint_given_before?' <span class="pg-hint-item">'+t('pg_avec_indice')+'</span>':'')+'</td>';
    if(graded){
      html += '<td class="pg-resp-points">'+(r.points||0)+'</td>';
    } else {
      html += '<td class="pg-resp-points">';
      html += '<button class="pg-resp-btn pg-resp-btn-ok" data-pg-action="pg-mark-correct" data-pg-response="'+r.id+'" data-pg-image="'+img.id+'">&#10003;</button>';
      html += '<button class="pg-resp-btn pg-resp-btn-ko" data-pg-action="pg-mark-incorrect" data-pg-response="'+r.id+'" data-pg-image="'+img.id+'">&#10007;</button>';
      html += '</td>';
    }
    html += '</tr>';
    return html;
  }

  function pgRevealHint(imageId){
    var inputEl = document.getElementById('pg-hint-input-'+imageId);
    if(!inputEl) return;
    var texte = inputEl.value.trim();
    if(!texte) return;
    sbPG.from('photogramme_hints').insert({ image_id: imageId, texte: texte }).select().single().then(function(res){
      if(res.error){ alert(friendlyError(res.error)); return; }
      if(!pgActiveHints[imageId]) pgActiveHints[imageId] = [];
      pgActiveHints[imageId].push(res.data);
      pgRenderManage();
    });
  }

  function pgMarkResponse(responseId, imageId, correct){
    var resp = (pgActiveResponses[imageId]||[]).filter(function(r){ return r.id === responseId; })[0];
    if(!resp) return;
    var points = correct ? (resp.hint_given_before ? 0.5 : 1) : 0;
    sbPG.from('photogramme_reponses').update({ is_correct: correct, points: points }).eq('id', responseId).select('*, contributors(display_name)').single().then(function(res){
      if(res.error){ alert(friendlyError(res.error)); return; }
      var list = pgActiveResponses[imageId];
      var idx = list.findIndex(function(r){ return r.id === responseId; });
      if(idx >= 0) list[idx] = res.data;
      pgRenderManage();
    });
  }

  function pgCloseSession(){
    if(!confirm(t('pg_confirm_cloturer'))) return;
    sbPG.from('photogramme_sessions').update({ status: 'closed' }).eq('id', pgActiveSessionId).select().single().then(function(res){
      if(res.error){ alert(friendlyError(res.error)); return; }
      pgActiveSession = res.data;
      pgRenderManage();
    });
  }

  // ---------- VUE RESULTATS ----------

  function pgOpenResults(sessionId){
    pgView = 'results';
    pgActiveSessionId = sessionId;
    pgRoot().innerHTML = '<div class="spinner"></div>';
    sbPG.from('photogramme_sessions').select('*, contributors(display_name)').eq('id', sessionId).single().then(function(res){
      if(res.error || !res.data){ pgRoot().innerHTML = '<div class="empty-msg">'+t('pg_session_introuvable')+'</div>'; return; }
      pgActiveSession = res.data;
      return sbPG.from('photogramme_leaderboard').select('*').eq('session_id', sessionId);
    }).then(function(res){
      if(!res) return;
      pgRenderResults(res.data || []);
    }).catch(function(e){ pgRoot().innerHTML = '<div class="empty-msg">'+escapeHtml(friendlyError(e))+'</div>'; });
  }

  function pgRenderResults(rows){
    rows.sort(function(a, b){
      if(b.total_points !== a.total_points) return b.total_points - a.total_points;
      var ta = (a.temps_cumule_secondes === null || a.temps_cumule_secondes === undefined) ? Infinity : a.temps_cumule_secondes;
      var tb = (b.temps_cumule_secondes === null || b.temps_cumule_secondes === undefined) ? Infinity : b.temps_cumule_secondes;
      return ta - tb;
    });
    var orgName = (pgActiveSession.contributors && pgActiveSession.contributors.display_name) || '?';
    var html = '';
    html += '<div class="pg-play-header">';
    html += '<div class="pg-play-title">'+t('pg_session_num',[pgActiveSession.id])+' — '+escapeHtml(pgActiveSession.titre||'')+'</div>';
    html += '<div class="pg-play-organizer">'+t('pg_organise_par',[escapeHtml(orgName)])+'</div>';
    html += '</div>';
    html += '<a href="#" data-pg-action="pg-back-to-list" class="pg-delete-link">&#8592; '+t('pg_retour_liste')+'</a>';
    if(!rows.length){
      html += '<div class="empty-msg">'+t('pg_aucun_resultat')+'</div>';
    } else {
      html += '<div class="pg-leaderboard">';
      rows.forEach(function(r, idx){
        var cls = idx === 0 ? ' pg-leaderboard-row-first' : '';
        html += '<div class="pg-leaderboard-row'+cls+'">';
        html += '<div class="pg-lb-rank">'+(idx+1)+'</div>';
        html += '<div class="pg-lb-name">'+escapeHtml(r.display_name||'?')+'</div>';
        html += '<div class="pg-lb-correct">'+t('pg_bonnes_reponses',[r.bonnes_reponses||0])+'</div>';
        html += '<div class="pg-lb-points">'+(r.total_points||0)+'</div>';
        html += '</div>';
      });
      html += '</div>';
    }
    pgRoot().innerHTML = html;
  }

  // ---------- DELEGATION CLICS ----------

  document.addEventListener('click', function(e){
    var openLink = e.target.closest && e.target.closest('[data-action="tc-actu-open-photogramme"]');
    if(openLink){
      e.preventDefault();
      var sid = parseInt(openLink.getAttribute('data-pg-session'), 10);
      navigate('photogramme');
      if(sid) pgOpenPlay(sid);
      return;
    }
    var el = e.target.closest && e.target.closest('[data-pg-action]');
    if(!el) return;
    e.preventDefault();
    var action = el.getAttribute('data-pg-action');
    var sid2 = parseInt(el.getAttribute('data-pg-session'), 10) || pgActiveSessionId;
    var imgId = parseInt(el.getAttribute('data-pg-image'), 10);
    var respId = parseInt(el.getAttribute('data-pg-response'), 10);
    switch(action){
      case 'pg-create-session': pgCreateSession(); break;
      case 'pg-back-to-list': pgRenderList(); break;
      case 'pg-open-create': pgOpenCreate(sid2); break;
      case 'pg-open-play': pgOpenPlay(sid2); break;
      case 'pg-open-manage': pgOpenManage(sid2); break;
      case 'pg-open-results': pgOpenResults(sid2); break;
      case 'pg-add-image': pgAddImage(); break;
      case 'pg-delete-image': pgDeleteImage(imgId); break;
      case 'pg-launch-now': pgLaunchNow(); break;
      case 'pg-schedule': pgSchedule(); break;
      case 'pg-delete-session': pgDeleteSession(); break;
      case 'pg-submit-answer': pgSubmitAnswer(imgId); break;
      case 'pg-reveal-hint': pgRevealHint(imgId); break;
      case 'pg-close-session': pgCloseSession(); break;
      case 'pg-mark-correct': pgMarkResponse(respId, imgId, true); break;
      case 'pg-mark-incorrect': pgMarkResponse(respId, imgId, false); break;
    }
  });
})();
