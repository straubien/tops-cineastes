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
  var films = [];
  var rang = 0;
  texte.split('\n').forEach(function(line){
    line = line.trim();
    if(!line) return;
    var m = line.match(/^(\d+)[\.\-\)]\s*(.+)$/);
    rang++;
    var contenu = m ? m[2].trim() : line;
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
  function inp(){return document.getElementById(inputId);}
  function dd(){return document.getElementById(dropdownId);}
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
    if(_idx>=0&&el)el.setAttribute('aria-activedescendant',dropdownId+'-o'+_idx);
    else if(el)el.removeAttribute('aria-activedescendant');
  }
  function setup(){
    var el=inp(),dr=dd();if(!el||!dr)return;
    el.setAttribute('role','combobox');el.setAttribute('aria-autocomplete','list');
    el.setAttribute('aria-expanded','false');el.setAttribute('aria-haspopup','listbox');
    el.setAttribute('aria-controls',dropdownId);dr.setAttribute('role','listbox');
    el.addEventListener('input',render);el.addEventListener('keydown',key);
  }
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',setup);}else{setup();}
  return {select:select,render:render};
}
