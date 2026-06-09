// Utilitaires partagés entre index.html, submit.html et admin.html

function escapeHtml(s){
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
  return name.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-|-$/g,'')
    +'.jpg';
}
