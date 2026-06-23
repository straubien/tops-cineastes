// ── MODE SOMBRE (anti-flash + bascule) ──────────────────────────
// Doit s'exécuter avant le premier rendu pour éviter un flash de
// couleurs claires sur les pages en mode sombre.
(function(){
  var stored=localStorage.getItem('tc-dark');
  var dark=stored==='1'||(stored===null&&window.matchMedia('(prefers-color-scheme:dark)').matches);
  document.documentElement.classList.toggle('dark',dark);
})();

function toggleDark(){
  var on=document.documentElement.classList.contains('dark');
  document.documentElement.classList.toggle('dark',!on);
  localStorage.setItem('tc-dark',on?'0':'1');
}
