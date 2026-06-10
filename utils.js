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

function parseTopsBrut(texte){
  var films=[];var rang=0;
  texte.split('\n').forEach(function(line){
    line=line.trim();if(!line)return;
    line=line.replace(/[\u{1F300}-\u{1FFFF}]/gu,'').trim();
    line=line.replace(/[☀-➿]/gu,'').trim();
    var m=line.match(/^(\d+)[.\-\)]\s*(.+)$/);if(!m)return;
    rang++;var contenu=m[2].trim();
    var annee=null;
    var anneeM=contenu.match(/\((\d{4})\)\s*(?:–.*)?$/);
    if(anneeM){annee=parseInt(anneeM[1]);contenu=contenu.slice(0,anneeM.index).trim();}
    contenu=contenu.replace(/\s*[–—]\s*à revoir.*$/i,'').trim();
    contenu=contenu.replace(/\(à revoir.*?\)/i,'').trim();
    contenu=contenu.replace(/\s*❤.*$/,'').trim();
    var titreFr=contenu.replace(/\([^0-9][^)]*\)/g,'').trim();
    titreFr=titreFr.replace(/\s*[-–—]+\s*$/,'').trim();
    if(titreFr)films.push({rang:rang,titre:titreFr,annee:annee});
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
