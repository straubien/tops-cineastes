// ── MODE SOMBRE (anti-flash + bascule) ──────────────────────────
// Doit s'exécuter avant le premier rendu pour éviter un flash de
// couleurs claires sur les pages en mode sombre.
(function(){
  var stored=null;
  try{ stored=localStorage.getItem('tc-dark'); }catch(e){}
  var dark=stored==='1'||(stored===null&&window.matchMedia('(prefers-color-scheme:dark)').matches);
  document.documentElement.classList.toggle('dark',dark);
})();

function toggleDark(){
  var on=document.documentElement.classList.contains('dark');
  document.documentElement.classList.toggle('dark',!on);
  try{ localStorage.setItem('tc-dark',on?'0':'1'); }catch(e){}
}

// ── BANNIÈRE D'ÉTAT (erreurs / hors-ligne) ──────────────────────
// Bannière discrète mais visible, injectée en JS pur (pas de dépendance CSS
// externe) pour ne pas avoir à modifier style.css.
function tcShowBanner(id,text,bg){
  var el=document.getElementById(id);
  if(!el){
    el=document.createElement('div');
    el.id=id;
    el.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:99999;padding:8px 16px;'
      +'font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#fff;'
      +'text-align:center;box-shadow:0 -1px 6px rgba(0,0,0,.2)';
    document.body.appendChild(el);
  }
  el.style.background=bg;
  el.textContent=text;
  el.style.display='block';
}
function tcHideBanner(id){
  var el=document.getElementById(id);
  if(el) el.style.display='none';
}

// ── GESTIONNAIRE D'ERREURS GLOBAL ───────────────────────────────
var _tcErrorBannerTimer=null;
function tcHandleGlobalError(message,stack){
  console.error(message,stack||'');
  tcShowBanner('tc-error-banner','Une erreur est survenue, rechargez la page si le problème persiste.','#b3261e');
  clearTimeout(_tcErrorBannerTimer);
  _tcErrorBannerTimer=setTimeout(function(){ tcHideBanner('tc-error-banner'); },8000);
  if(typeof tcReportErrorToSupabase==='function') tcReportErrorToSupabase(message,stack);
}
window.addEventListener('error',function(e){
  tcHandleGlobalError(e.message||'Erreur inconnue',e.error&&e.error.stack);
});
window.addEventListener('unhandledrejection',function(e){
  var reason=e.reason;
  var msg=(reason&&reason.message)||String(reason);
  tcHandleGlobalError(msg,reason&&reason.stack);
});

// ── DÉTECTION HORS-LIGNE / EN LIGNE ──────────────────────────────
function tcUpdateOnlineBanner(){
  if(navigator.onLine===false){
    tcShowBanner('tc-offline-banner','Vous êtes hors ligne.','#5a5a5a');
  }else{
    tcHideBanner('tc-offline-banner');
  }
}
window.addEventListener('offline',tcUpdateOnlineBanner);
window.addEventListener('online',tcUpdateOnlineBanner);
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',tcUpdateOnlineBanner);
}else{
  tcUpdateOnlineBanner();
}
