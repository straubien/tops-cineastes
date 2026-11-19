// ═══════════════════════════════════════════════════════════════════════════
//  TÉLÉCHARGEMENT DES TOPS D'UN CINÉPHILE — Word (.docx) et PDF
// ═══════════════════════════════════════════════════════════════════════════
//
//  Chargé par index.html seulement. Le bouton n'apparaît que sur SON propre
//  profil (cf. renderProfil dans index.js) : on n'exporte pas les tops d'un
//  autre.
//
//  Seuls les tops enregistrés dans Supabase sont concernés. Les deux
//  collections importées à la main — muzard.json et cnudde.json — restent en
//  dehors : la première EST le document Word qui a servi de modèle ici, et la
//  seconde n'a plus de propriétaire pour la réclamer. tcExportTopsPossible()
//  le vérifie, et le bouton ne s'affiche pas sur ces deux profils.
//
//  AUCUNE BIBLIOTHÈQUE EXTERNE. Le site est servi par GitHub Pages sous une
//  CSP stricte (« default-src 'self' ») : tout est écrit ici, en vanilla.
//  Les deux formats sont fabriqués dans le navigateur, puis remis au visiteur
//  par un Blob et un <a download>, ce qui ne demande aucune autorisation
//  supplémentaire dans la CSP.
//
//  ── LA MISE EN PAGE SUIT LE MODÈLE WORD « Tops cinéastes (v8.0) » ────────
//
//  Relevé fait sur le document fourni, et reproduit à l'identique :
//
//    page       B4 paysage (20636 × 14570 twips, w:code="12")
//    marges     1 cm (567 twips) sur les quatre côtés
//    colonnes   2, séparées de 1,25 cm (708 twips)
//    titre      « Tops cinéastes » souligné, Imprint MT Shadow 48 pt
//    lettre     Imprint MT Shadow 96 pt
//    cinéaste   Bookman Old Style gras 15 pt
//    film       « 1. Titre (année) » Times New Roman 14 pt
//    note       « (co-réal. …) » Times New Roman italique 12 pt, à la suite
//    non classé un paragraphe vide, « vus mais non classés: » en italique,
//               puis « - Titre (année) », sans numéro
//    espacement « après » à zéro partout, un paragraphe vide entre deux tops
//
//  ── UN TOP NE SE COUPE PAS EN DEUX ─────────────────────────────────────
//
//  Le modèle porte 167 sauts de page et de colonne posés à la main, pour
//  qu'un top ne soit pas coupé entre deux colonnes. La règle, elle, se
//  programme : chaque top forme un BLOC — son intertitre de lettre, son nom
//  de cinéaste, ses films, sa partie non classée — et le bloc se place d'un
//  seul tenant.
//
//    · Un top qui tient dans une colonne n'est jamais coupé : s'il n'a plus
//      la place là où on en est, il passe entier à la colonne suivante.
//    · Un top plus haut qu'une colonne entière — il y en a quelques-uns —
//      commence en haut d'une colonne neuve et se poursuit sur la suivante.
//      C'est le seul cas où il se coupe, comme dans le modèle.
//
//  Côté Word, ce sont « keepNext » (enchaîne toutes les lignes d'un top) et
//  « keepLines » (ne coupe pas un paragraphe replié sur deux lignes) : Word
//  et LibreOffice posent eux-mêmes les sauts qu'il faut, et retombent sur une
//  coupure quand le bloc dépasse la colonne. Côté PDF, la composition fait le
//  même calcul, hauteur de bloc à l'appui.
//
//  ── UN SEUL ÉCART AVEC LE MODÈLE ───────────────────────────────────────
//
//  Le PDF n'utilise que les polices garanties par le format (Times,
//     Helvetica, Courier). Imprint MT Shadow et Bookman Old Style sont des
//     polices Microsoft, qu'on ne peut ni embarquer ni supposer présentes :
//     elles sont remplacées par Times gras. Le .docx, lui, les demande par
//     leur nom, exactement comme le modèle.
//
//  ── CE QUI EST EXPORTÉ ──────────────────────────────────────────────────
//
//  Tous les tops du cinéphile, de A à Z (tri localeCompare 'fr', comme
//  partout sur le site), puis une section « Tops thématiques ». Les films
//  « vus mais non classés » (drapeau nc) gardent leur place dans le même
//  tableau films, sans numéro, sous leur intertitre — cf. README.
//
//  Appel unique depuis index.js :   tcExportTops(jsonName, 'docx'|'pdf')
// ═══════════════════════════════════════════════════════════════════════════

// ── Géométrie, reprise du modèle ───────────────────────────────────────────
// En twips (1/1440 pouce) pour Word, convertis en points (1/72 pouce) pour le
// PDF : 1 point = 20 twips.
var TC_EXP_PAGE = {
  largeurTw: 20636, hauteurTw: 14570, codeFormat: 12, orientation: 'landscape',
  margeTw: 567, enTeteTw: 709, piedTw: 709,
  colonnes: 2, colEspaceTw: 708, grillePas: 360
};

// ── Les styles, un par nature de ligne ─────────────────────────────────────
// tailleDemiPt : ce que Word écrit dans <w:sz> (demi-points).
// interligne   : hauteur de ligne en points, pour le PDF (Word la calcule
//                lui-même, en simple interligne).
var TC_EXP_STYLES = {
  titre:       { police:'Imprint MT Shadow', pdf:'gras',     tailleDemiPt:96,  interligne:58 },
  soustitre:   { police:'Times New Roman',   pdf:'italique', tailleDemiPt:22,  interligne:15 },
  lettre:      { police:'Imprint MT Shadow', pdf:'gras',     tailleDemiPt:192, interligne:104 },
  section:     { police:'Imprint MT Shadow', pdf:'gras',     tailleDemiPt:96,  interligne:58 },
  cineaste:    { police:'Bookman Old Style', pdf:'gras',     tailleDemiPt:30,  interligne:18, gras:true },
  film:        { police:'Times New Roman',   pdf:'normal',   tailleDemiPt:28,  interligne:17 },
  note:        { police:'Times New Roman',   pdf:'italique', tailleDemiPt:24,  interligne:17, italique:true },
  ncintertitre:{ police:'Times New Roman',   pdf:'italique', tailleDemiPt:28,  interligne:17, italique:true },
  vide:        { police:'Times New Roman',   pdf:'normal',   tailleDemiPt:28,  interligne:17 }
};

var _tcExpEnCours = false;   // un seul export à la fois

// ═══════════════════════════════════════════════════════════════════════════
//  1. COLLECTE DES DONNÉES
// ═══════════════════════════════════════════════════════════════════════════

// Ce cinéphile a-t-il des tops exportables, et est-ce bien le sien ?
// Appelé par renderProfil (index.js) pour décider d'afficher les boutons.
function tcExportTopsPossible(jsonName){
  if(!jsonName || jsonName !== window.currentUserJsonName) return false;
  var sb = window.SUPABASE_TOPS && window.SUPABASE_TOPS[jsonName];
  return !!sb && Object.keys(sb).length > 0;
}

// Les tops d'un cinéphile, triés par cinéaste. Les listes de films sont
// chargées à la demande : on les réclame avant de commencer, sinon le fichier
// ne contiendrait que des noms de cinéastes.
function _tcExpCollecterTops(jsonName){
  var sb = window.SUPABASE_TOPS && window.SUPABASE_TOPS[jsonName];
  if(!sb) return Promise.resolve([]);
  var attendre = (typeof window.tcFilmsCinephileCharges === 'function'
                  && window.tcFilmsCinephileCharges(jsonName))
    ? Promise.resolve()
    : (typeof window.tcChargerFilmsDuCinephile === 'function'
        ? window.tcChargerFilmsDuCinephile(jsonName)
        : Promise.resolve());
  return attendre.then(function(){
    var tops = window.SUPABASE_TOPS[jsonName] || {};
    return Object.keys(tops).map(function(cinNom){
      var films = tops[cinNom];
      return {
        cineaste: cinNom,
        films: (typeof window.tcFilmsCharges === 'function' && !window.tcFilmsCharges(films)) ? [] : (films || [])
      };
    });
  });
}

// Les tops thématiques validés du cinéphile connecté. Au mieux : si la
// requête échoue, le reste du fichier part quand même, et l'appelant
// prévient. On ne lit que ses propres tops (contributor_id), et seulement
// ceux qui sont publiés (status approved), comme la page Thèmes.
function _tcExpCollecterThematiques(){
  var id = window.currentUserContribId;
  if(!id || typeof window.TC_SB === 'undefined' || !window.TC_SB){
    return Promise.resolve({ liste: [], echec: false });
  }
  var requete = function(){
    return window.TC_SB.from('thematic_tops')
      .select('theme_nom, films')
      .eq('contributor_id', id)
      .eq('status', 'approved')
      .order('theme_nom', { ascending: true });
  };
  var promesse = (typeof window.tcWithRetryTimeout === 'function')
    ? window.tcWithRetryTimeout(requete) : requete();
  return Promise.resolve(promesse).then(function(res){
    if(!res || res.error) return { liste: [], echec: true };
    return {
      liste: (res.data || []).map(function(row){
        var films = Array.isArray(row.films) ? row.films : [];
        return {
          theme: row.theme_nom || '',
          // La colonne films accepte des chaînes comme des objets.
          films: films.map(function(f){
            return (typeof f === 'string') ? { titre: f } : (f || {});
          })
        };
      }),
      echec: false
    };
  }).catch(function(){ return { liste: [], echec: true }; });
}

// ═══════════════════════════════════════════════════════════════════════════
//  2. MISE EN LIGNES — une seule fois, pour les deux formats
// ═══════════════════════════════════════════════════════════════════════════
//
//  Chaque ligne est { k: nature, runs: [ { txt, st, souligne } ] } :
//  « k » sert aux décisions de mise en page (veuves, changement de colonne),
//  « st » nomme le style de chaque morceau de texte.

// « JEANNE DUPONT » → « Jeanne DUPONT ». Même règle que formatContribName
// (prénom en casse de titre, nom de famille tel quel), mais en texte brut :
// formatContribNamePlain passe par escapeHtml, ce qui n'a pas de sens dans un
// fichier Word ou PDF.
function _tcExpNomClair(jsonName){
  var p = String(jsonName || '').trim().split(' ');
  if(p.length === 1) return p[0];
  var prenom = p.slice(0, -1).map(function(m){
    return (typeof toTitleCase === 'function') ? toTitleCase(m)
         : m.charAt(0).toUpperCase() + m.slice(1).toLowerCase();
  }).join(' ');
  return prenom + ' ' + p[p.length - 1];
}

// L'initiale d'un cinéaste, pour les intertitres A → Z. Les accents sont
// retirés : « ÁLVAREZ » va sous A, et non dans une section « Á » à lui seul.
function _tcExpLettre(nom){
  var c = String(nom || '').charAt(0).toUpperCase();
  try{ c = c.normalize('NFD').replace(/[̀-ͯ]/g, ''); }catch(e){}
  return /^[A-Z]$/.test(c) ? c : '#';
}

// « 1. Titre (1955) » ou « - Titre (1955) » pour un film non classé.
function _tcExpFilmTexte(f, numero){
  var titre = (f && f.titre) ? String(f.titre) : '';
  var annee = (f && f.annee) ? ' (' + f.annee + ')' : '';
  return (numero ? numero + '. ' : '- ') + titre + annee;
}

function _tcExpLignes(data){
  var lignes = [];
  // « bloc » : le numéro du top auquel la ligne appartient — 0 pour l'en-tête
  // et les lignes de séparation, qui ne se rattachent à rien. C'est lui qui
  // tient un top d'un seul tenant, dans Word comme dans le PDF.
  var bloc = 0, compteur = 0;
  function ajout(k, runs){ lignes.push({ k: k, runs: runs, bloc: bloc }); }
  function vide(){ ajout('vide', [{ txt: '', st: 'vide' }]); }

  // En-tête : la ligne du modèle, puis une ligne discrète qui dit de qui et
  // de quand vient le fichier — un export daté, lui, en a besoin.
  ajout('titre', [
    { txt: t('exp_titre_doc'), st: 'titre', souligne: true },
    { txt: ' (' + data.nomClair + ')', st: 'titre' }
  ]);
  ajout('soustitre', [{ txt: data.sousTitre, st: 'soustitre' }]);
  vide();

  // Les films d'un top : les classés numérotés, puis, sous leur intertitre,
  // les « vus mais non classés » — sans numéro, précédés d'un tiret.
  function poserFilms(films){
    var numero = 0, nonClasses = [];
    (films || []).forEach(function(f){
      if(f && f.nc){ nonClasses.push(f); return; }
      numero++;
      var runs = [{ txt: _tcExpFilmTexte(f, numero) + (f && f.note ? ' ' : ''), st: 'film' }];
      if(f && f.note) runs.push({ txt: '(' + f.note + ')', st: 'note' });
      ajout('film', runs);
    });
    if(!nonClasses.length) return;
    vide();
    ajout('ncintertitre', [{ txt: tcTexte('nc_intertitre', 'Vus mais non classés') + ':', st: 'ncintertitre' }]);
    nonClasses.forEach(function(f){
      var runs = [{ txt: _tcExpFilmTexte(f, 0) + (f && f.note ? ' ' : ''), st: 'film' }];
      if(f && f.note) runs.push({ txt: '(' + f.note + ')', st: 'note' });
      ajout('film', runs);
    });
  }

  var tops = data.tops.slice().sort(function(a, b){
    return a.cineaste.localeCompare(b.cineaste, 'fr');
  });
  var lettre = null;
  tops.forEach(function(top){
    bloc = ++compteur;
    var L = _tcExpLettre(top.cineaste);
    // L'intertitre de lettre fait partie du bloc du premier top qu'il ouvre :
    // un « M » ne reste donc jamais seul en bas d'une colonne.
    if(L !== lettre){ lettre = L; ajout('lettre', [{ txt: L, st: 'lettre' }]); }
    ajout('cineaste', [{ txt: top.cineaste, st: 'cineaste' }]);
    poserFilms(top.films);
    bloc = 0;
    vide();
  });

  if(data.thematiques.length){
    bloc = ++compteur;
    ajout('section', [{ txt: t('page_thematiques_h'), st: 'section' }]);
    data.thematiques.forEach(function(th, i){
      if(i > 0) bloc = ++compteur;
      ajout('cineaste', [{ txt: th.theme, st: 'cineaste' }]);
      poserFilms(th.films);
      bloc = 0;
      vide();
    });
  }
  return lignes;
}

// ═══════════════════════════════════════════════════════════════════════════
//  3. LE FICHIER WORD (.docx)
// ═══════════════════════════════════════════════════════════════════════════
//
//  Un .docx est une archive ZIP de fichiers XML. On écrit les cinq parties
//  qu'une lecture par Word, LibreOffice ou Google Docs réclame, et rien de
//  plus.

function _tcExpXml(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// « keepNext » enchaîne une ligne à la suivante tant qu'elles appartiennent
// au même top : Word garde alors le top entier dans une colonne, et le
// repousse à la suivante s'il n'y tient pas. « keepLines » interdit en plus
// de couper un paragraphe replié sur deux lignes. Quand un bloc est plus haut
// qu'une colonne, Word retombe de lui-même sur une coupure.
function _tcExpParagrapheXml(ligne, suivante){
  var ensemble = ligne.bloc && suivante && suivante.bloc === ligne.bloc;
  var pPr = '<w:pPr>'
    + (ensemble ? '<w:keepNext/>' : '')
    + '<w:keepLines/>'
    + '<w:spacing w:after="0"/></w:pPr>';
  var runs = ligne.runs.map(function(r){
    var st = TC_EXP_STYLES[r.st] || TC_EXP_STYLES.film;
    return '<w:r><w:rPr>'
      + '<w:rFonts w:ascii="' + st.police + '" w:hAnsi="' + st.police + '" w:cs="' + st.police + '"/>'
      + (st.gras ? '<w:b/>' : '') + (st.italique ? '<w:i/>' : '')
      + '<w:sz w:val="' + st.tailleDemiPt + '"/><w:szCs w:val="' + st.tailleDemiPt + '"/>'
      + (r.souligne ? '<w:u w:val="single"/>' : '')
      + '</w:rPr><w:t xml:space="preserve">' + _tcExpXml(r.txt) + '</w:t></w:r>';
  }).join('');
  return '<w:p>' + pPr + runs + '</w:p>';
}

function _tcExpDocumentXml(lignes){
  var P = TC_EXP_PAGE;
  var sectPr = '<w:sectPr>'
    + '<w:pgSz w:w="' + P.largeurTw + '" w:h="' + P.hauteurTw + '" w:orient="' + P.orientation + '" w:code="' + P.codeFormat + '"/>'
    + '<w:pgMar w:top="' + P.margeTw + '" w:right="' + P.margeTw + '" w:bottom="' + P.margeTw + '" w:left="' + P.margeTw
    + '" w:header="' + P.enTeteTw + '" w:footer="' + P.piedTw + '" w:gutter="0"/>'
    + '<w:cols w:num="' + P.colonnes + '" w:space="' + P.colEspaceTw + '"/>'
    + '<w:docGrid w:linePitch="' + P.grillePas + '"/>'
    + '</w:sectPr>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:body>' + lignes.map(function(l, i){ return _tcExpParagrapheXml(l, lignes[i + 1]); }).join('')
    + sectPr + '</w:body></w:document>';
}

function _tcExpDocxParties(lignes, data){
  var NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  var NS_OFF = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return [
    { nom: '[Content_Types].xml', texte:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + '</Types>' },
    { nom: '_rels/.rels', texte:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Relationships xmlns="' + NS_REL + '">'
      + '<Relationship Id="rId1" Type="' + NS_OFF + '/officeDocument" Target="word/document.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
      + '</Relationships>' },
    { nom: 'word/_rels/document.xml.rels', texte:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Relationships xmlns="' + NS_REL + '">'
      + '<Relationship Id="rId1" Type="' + NS_OFF + '/styles" Target="styles.xml"/>'
      + '</Relationships>' },
    // Chaque paragraphe porte ses propres réglages ; ces valeurs par défaut
    // ne servent qu'à garantir l'interligne simple et l'absence d'espacement.
    { nom: 'word/styles.xml', texte:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + '<w:docDefaults><w:rPrDefault><w:rPr>'
      + '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>'
      + '<w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:rPrDefault>'
      + '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault>'
      + '</w:docDefaults>'
      + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
      + '</w:styles>' },
    { nom: 'docProps/core.xml', texte:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
      + ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"'
      + ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
      + '<dc:title>' + _tcExpXml(t('exp_titre_doc') + ' (' + data.nomClair + ')') + '</dc:title>'
      + '<dc:creator>' + _tcExpXml(data.nomClair) + '</dc:creator>'
      + '<cp:lastModifiedBy>' + _tcExpXml(data.nomClair) + '</cp:lastModifiedBy>'
      + '<dcterms:created xsi:type="dcterms:W3CDTF">' + data.iso + '</dcterms:created>'
      + '<dcterms:modified xsi:type="dcterms:W3CDTF">' + data.iso + '</dcterms:modified>'
      + '</cp:coreProperties>' },
    { nom: 'word/document.xml', texte: _tcExpDocumentXml(lignes) }
  ];
}

// ── L'archive ZIP ──────────────────────────────────────────────────────────
// Écrite à la main : en-tête local, répertoire central, fin de répertoire.
// Les parties sont compressées quand le navigateur sait le faire
// (CompressionStream, méthode « deflate-raw » = méthode 8 du format ZIP), et
// simplement stockées sinon (méthode 0). Un .docx de 1 300 tops passe ainsi
// de ~6 Mo à moins de 1 Mo, sans qu'aucun lecteur n'y voie de différence.

var _tcExpCrcTable = null;
function _tcExpCrc32(u8){
  if(!_tcExpCrcTable){
    _tcExpCrcTable = new Array(256);
    for(var n = 0; n < 256; n++){
      var c = n;
      for(var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      _tcExpCrcTable[n] = c >>> 0;
    }
  }
  var crc = 0xFFFFFFFF;
  for(var i = 0; i < u8.length; i++) crc = (crc >>> 8) ^ _tcExpCrcTable[(crc ^ u8[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Renvoie les octets compressés, ou null si le navigateur ne sait pas faire.
function _tcExpComprimer(u8, format){
  if(typeof window.CompressionStream !== 'function' || typeof window.Response !== 'function'){
    return Promise.resolve(null);
  }
  try{
    var flux = new window.CompressionStream(format);
    var plume = flux.writable.getWriter();
    plume.write(u8);
    plume.close();
    return new window.Response(flux.readable).arrayBuffer()
      .then(function(b){ return new Uint8Array(b); })
      .catch(function(){ return null; });
  }catch(e){ return Promise.resolve(null); }
}

function _tcExpLatin1(s){
  var u = new Uint8Array(s.length);
  for(var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xFF;
  return u;
}

function _tcExpConcat(liste){
  var n = 0, i;
  for(i = 0; i < liste.length; i++) n += liste[i].length;
  var out = new Uint8Array(n), p = 0;
  for(i = 0; i < liste.length; i++){ out.set(liste[i], p); p += liste[i].length; }
  return out;
}

function _tcExpZip(parties){
  var enc = new window.TextEncoder();
  var entrees = parties.map(function(p){
    return { nomOctets: enc.encode(p.nom), brut: enc.encode(p.texte) };
  });
  return Promise.all(entrees.map(function(e){
    e.crc = _tcExpCrc32(e.brut);
    return _tcExpComprimer(e.brut, 'deflate-raw').then(function(z){
      if(z && z.length < e.brut.length){ e.methode = 8; e.corps = z; }
      else { e.methode = 0; e.corps = e.brut; }
    });
  })).then(function(){
    var i, taille = 22;
    for(i = 0; i < entrees.length; i++){
      taille += 30 + entrees[i].nomOctets.length + entrees[i].corps.length
              + 46 + entrees[i].nomOctets.length;
    }
    var buf = new Uint8Array(taille), vue = new DataView(buf.buffer), pos = 0;
    var d = new Date();
    var heure = (((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF);
    var date  = ((((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF);
    for(i = 0; i < entrees.length; i++){
      var e = entrees[i];
      e.offset = pos;
      vue.setUint32(pos, 0x04034b50, true); pos += 4;   // en-tête local
      vue.setUint16(pos, 20, true); pos += 2;           // version nécessaire
      vue.setUint16(pos, 0, true);  pos += 2;           // indicateurs
      vue.setUint16(pos, e.methode, true); pos += 2;
      vue.setUint16(pos, heure, true); pos += 2;
      vue.setUint16(pos, date, true);  pos += 2;
      vue.setUint32(pos, e.crc, true); pos += 4;
      vue.setUint32(pos, e.corps.length, true); pos += 4;
      vue.setUint32(pos, e.brut.length, true);  pos += 4;
      vue.setUint16(pos, e.nomOctets.length, true); pos += 2;
      vue.setUint16(pos, 0, true); pos += 2;            // champ « extra »
      buf.set(e.nomOctets, pos); pos += e.nomOctets.length;
      buf.set(e.corps, pos);     pos += e.corps.length;
    }
    var debutCentral = pos;
    for(i = 0; i < entrees.length; i++){
      var c = entrees[i];
      vue.setUint32(pos, 0x02014b50, true); pos += 4;   // répertoire central
      vue.setUint16(pos, 20, true); pos += 2;           // version d'écriture
      vue.setUint16(pos, 20, true); pos += 2;           // version nécessaire
      vue.setUint16(pos, 0, true);  pos += 2;
      vue.setUint16(pos, c.methode, true); pos += 2;
      vue.setUint16(pos, heure, true); pos += 2;
      vue.setUint16(pos, date, true);  pos += 2;
      vue.setUint32(pos, c.crc, true); pos += 4;
      vue.setUint32(pos, c.corps.length, true); pos += 4;
      vue.setUint32(pos, c.brut.length, true);  pos += 4;
      vue.setUint16(pos, c.nomOctets.length, true); pos += 2;
      vue.setUint16(pos, 0, true); pos += 2;            // extra
      vue.setUint16(pos, 0, true); pos += 2;            // commentaire
      vue.setUint16(pos, 0, true); pos += 2;            // disque
      vue.setUint16(pos, 0, true); pos += 2;            // attributs internes
      vue.setUint32(pos, 0, true); pos += 4;            // attributs externes
      vue.setUint32(pos, c.offset, true); pos += 4;
      buf.set(c.nomOctets, pos); pos += c.nomOctets.length;
    }
    var tailleCentral = pos - debutCentral;
    vue.setUint32(pos, 0x06054b50, true); pos += 4;     // fin de répertoire
    vue.setUint16(pos, 0, true); pos += 2;              // numéro de ce disque
    vue.setUint16(pos, 0, true); pos += 2;              // disque du répertoire
    vue.setUint16(pos, entrees.length, true); pos += 2; // entrées sur ce disque
    vue.setUint16(pos, entrees.length, true); pos += 2; // entrées en tout
    vue.setUint32(pos, tailleCentral, true); pos += 4;
    vue.setUint32(pos, debutCentral, true); pos += 4;
    vue.setUint16(pos, 0, true); pos += 2;              // commentaire d'archive
    return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  4. LE FICHIER PDF
// ═══════════════════════════════════════════════════════════════════════════
//
//  Écrit à la main lui aussi, pour la même raison : aucune bibliothèque.
//  Le PDF n'emploie que trois des quatorze polices que tout lecteur PDF
//  possède d'office — Times-Roman, Times-Bold, Times-Italic — avec l'encodage
//  WinAnsi, qui couvre tout l'alphabet latin occidental. Sur les 9 982 films
//  des deux collections du site, un seul caractère en sort (un rond noir
//  décoratif) : les rares cas sont ramenés à leur forme sans accent, et à
//  défaut à « ? », plutôt que de produire un fichier illisible.

// Les 27 caractères que WinAnsi place entre 0x80 et 0x9F, là où Unicode met
// des caractères de commande.
var _TC_EXP_WINANSI = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
  0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
  0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
  0x017E: 0x9E, 0x0178: 0x9F
};

function _tcExpOctetWinAnsi(ch){
  var c = ch.charCodeAt(0);
  if(c >= 0x20 && c <= 0x7E) return c;
  if(c >= 0xA0 && c <= 0xFF) return c;
  if(_TC_EXP_WINANSI[c] !== undefined) return _TC_EXP_WINANSI[c];
  return -1;
}

// Un texte prêt à être posé entre parenthèses dans le PDF : encodé en
// WinAnsi, puis protégé (« \ », « ( » et « ) » ont un sens dans le format).
function _tcExpPdfTexte(txt){
  var out = '', i, j;
  var s = String(txt == null ? '' : txt);
  for(i = 0; i < s.length; i++){
    var ch = s.charAt(i), b = _tcExpOctetWinAnsi(ch);
    if(b < 0){
      var plat = '';
      try{ plat = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }catch(e){}
      if(plat && plat !== ch){
        for(j = 0; j < plat.length; j++){
          var b2 = _tcExpOctetWinAnsi(plat.charAt(j));
          out += String.fromCharCode(b2 < 0 ? 63 : b2);
        }
        continue;
      }
      b = 63;   // « ? »
    }
    out += String.fromCharCode(b);
  }
  return out.replace(/[\\()]/g, '\\$&').replace(/[\r\n\t]/g, ' ');
}

// La police PDF d'un style, et son numéro de ressource.
function _tcExpPolicePdf(stNom){
  var st = TC_EXP_STYLES[stNom] || TC_EXP_STYLES.film;
  if(st.pdf === 'gras') return 'F2';
  if(st.pdf === 'italique') return 'F3';
  return 'F1';
}

// ── Mesure des textes ──────────────────────────────────────────────────────
// Times New Roman — et les polices libres qui le remplacent sous Linux — ont
// les mêmes largeurs de caractères que la police Times du PDF : mesurer ici
// avec un canvas donne donc les largeurs du fichier produit. Sans canvas, on
// retombe sur une estimation, qui ne sert qu'à décider des retours à la ligne.
var _tcExpCtx;
function _tcExpContexte(){
  if(_tcExpCtx === undefined){
    try{
      var c = document.createElement('canvas');
      _tcExpCtx = (c && c.getContext) ? c.getContext('2d') : null;
    }catch(e){ _tcExpCtx = null; }
  }
  return _tcExpCtx;
}

function _tcExpTaille(stNom){
  return (TC_EXP_STYLES[stNom] || TC_EXP_STYLES.film).tailleDemiPt / 2;
}

function _tcExpLargeur(txt, stNom){
  var st = TC_EXP_STYLES[stNom] || TC_EXP_STYLES.film;
  var taille = st.tailleDemiPt / 2;
  var ctx = _tcExpContexte();
  if(!ctx) return String(txt).length * taille * 0.5;
  ctx.font = (st.pdf === 'italique' ? 'italic ' : '')
           + (st.pdf === 'gras' ? 'bold ' : '')
           + taille + 'px "Times New Roman", Times, serif';
  return ctx.measureText(String(txt)).width;
}

function _tcExpGeometrie(){
  var P = TC_EXP_PAGE;
  var largeur = P.largeurTw / 20, hauteur = P.hauteurTw / 20;
  var marge = P.margeTw / 20, espace = P.colEspaceTw / 20;
  var colLargeur = (largeur - 2 * marge - espace * (P.colonnes - 1)) / P.colonnes;
  var colonnesX = [];
  for(var i = 0; i < P.colonnes; i++) colonnesX.push(marge + i * (colLargeur + espace));
  return { largeur: largeur, hauteur: hauteur, colLargeur: colLargeur,
           colonnesX: colonnesX, hautY: hauteur - marge, basY: marge };
}

// Découpe une ligne logique en lignes visibles, dans la largeur d'une colonne.
// Les morceaux gardent leur style : le titre d'un film et sa note en italique
// se suivent sur la même ligne, et se coupent ensemble s'il faut.
function _tcExpDecouper(runs, largeurMax){
  var lignes = [], cour = [], x = 0, i, total = 0;
  for(i = 0; i < runs.length; i++) total += _tcExpLargeur(runs[i].txt, runs[i].st);
  if(total <= largeurMax){
    for(i = 0; i < runs.length; i++){
      cour.push({ txt: runs[i].txt, st: runs[i].st, souligne: runs[i].souligne, x: x });
      x += _tcExpLargeur(runs[i].txt, runs[i].st);
    }
    return [cour];
  }
  runs.forEach(function(r){
    String(r.txt).split(/(\s+)/).forEach(function(m){
      if(m === '') return;
      var blanc = /^\s+$/.test(m);
      var w = _tcExpLargeur(m, r.st);
      if(!blanc && x + w > largeurMax && cour.length){ lignes.push(cour); cour = []; x = 0; }
      if(blanc && !cour.length) return;
      cour.push({ txt: m, st: r.st, souligne: r.souligne, x: x });
      x += w;
    });
  });
  if(cour.length) lignes.push(cour);
  return lignes.length ? lignes : [[]];
}

// Recolle les morceaux voisins de même style : un « Tj » par style et par
// ligne, au lieu d'un par mot.
function _tcExpFusionner(segments){
  var out = [];
  segments.forEach(function(s){
    var d = out[out.length - 1];
    if(d && d.st === s.st && !!d.souligne === !!s.souligne) d.txt += s.txt;
    else out.push({ txt: s.txt, st: s.st, souligne: s.souligne, x: s.x });
  });
  return out;
}

function _tcExpNombre(v){
  return String(Math.round(v * 100) / 100);
}

// Compose les lignes en pages à deux colonnes, et renvoie le flux de dessin
// de chaque page.
function _tcExpComposer(lignes){
  var G = _tcExpGeometrie();
  var colHauteur = G.hautY - G.basY;
  var pages = [], flux = null, col = 0, y = 0;

  function nouvellePage(){ flux = []; pages.push(flux); col = 0; y = G.hautY; }
  function colonneSuivante(){
    col++;
    if(col >= TC_EXP_PAGE.colonnes) nouvellePage();
    else y = G.hautY;
  }
  nouvellePage();

  // Découpe et hauteur de chaque ligne, calculées une seule fois : la
  // hauteur des blocs s'en déduit, et la composition les relit telles quelles.
  var mesures = lignes.map(function(ligne){
    var stNom = ligne.runs[0] ? ligne.runs[0].st : 'film';
    var inter = (TC_EXP_STYLES[stNom] || TC_EXP_STYLES.film).interligne;
    var visuelles = _tcExpDecouper(ligne.runs, G.colLargeur).map(_tcExpFusionner);
    return { inter: inter, visuelles: visuelles, hauteur: visuelles.length * inter };
  });
  var hauteurBloc = {};
  lignes.forEach(function(ligne, i){
    if(ligne.bloc) hauteurBloc[ligne.bloc] = (hauteurBloc[ligne.bloc] || 0) + mesures[i].hauteur;
  });

  var blocCommence = {};
  lignes.forEach(function(ligne, i){
    var m = mesures[i];
    // Au premier vers d'un top : ou bien il tient dans ce qui reste de la
    // colonne, ou bien il passe entier à la suivante.
    //
    // Un top plus haut qu'une colonne entière sera coupé de toute façon : le
    // repousser lui ferait perdre une colonne pour rien. On le commence donc
    // là où on en est, à condition qu'il reste de quoi poser son nom et cinq
    // films — sinon il part à la colonne suivante, pour ne pas s'ouvrir sur
    // deux lignes perdues en bas de page.
    if(ligne.bloc && !blocCommence[ligne.bloc]){
      blocCommence[ligne.bloc] = true;
      var reste = y - G.basY;
      var h = hauteurBloc[ligne.bloc];
      var minimum = TC_EXP_STYLES.cineaste.interligne + 5 * TC_EXP_STYLES.film.interligne;
      var besoin = (h > colHauteur) ? Math.min(minimum, colHauteur) : h;
      if(y < G.hautY && besoin > reste) colonneSuivante();
    }
    // Une ligne de séparation ne s'ouvre pas en haut d'une colonne.
    if(ligne.k === 'vide' && y >= G.hautY) return;

    m.visuelles.forEach(function(segs){
      y -= m.inter;
      if(y < G.basY){ colonneSuivante(); y -= m.inter; }
      var xCol = G.colonnesX[col];
      segs.forEach(function(s){
        if(s.txt === '') return;
        var taille = _tcExpTaille(s.st);
        flux.push('BT /' + _tcExpPolicePdf(s.st) + ' ' + _tcExpNombre(taille)
          + ' Tf 1 0 0 1 ' + _tcExpNombre(xCol + s.x) + ' ' + _tcExpNombre(y)
          + ' Tm (' + _tcExpPdfTexte(s.txt) + ') Tj ET');
        if(s.souligne){
          flux.push(_tcExpNombre(xCol + s.x) + ' ' + _tcExpNombre(y - taille * 0.14) + ' '
            + _tcExpNombre(_tcExpLargeur(s.txt, s.st)) + ' ' + _tcExpNombre(taille * 0.05) + ' re f');
        }
      });
    });
  });
  return { pages: pages, geo: G };
}

function _tcExpPdfDate(d){
  function p2(n){ return (n < 10 ? '0' : '') + n; }
  return 'D:' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate())
       + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
}

// Assemble le fichier. Les flux de dessin sont compressés quand le navigateur
// le permet (CompressionStream « deflate » = /FlateDecode), ce qui divise le
// poids par cinq ou six ; sinon ils partent en clair, et le fichier reste
// parfaitement valide.
function _tcExpPdf(lignes, data){
  var compose = _tcExpComposer(lignes);
  var G = compose.geo;
  var flux = compose.pages.map(function(p){ return p.join('\n') + '\n'; });
  return Promise.all(flux.map(function(txt){
    var brut = _tcExpLatin1(txt);
    return _tcExpComprimer(brut, 'deflate').then(function(z){
      return (z && z.length < brut.length) ? { corps: z, zip: true } : { corps: brut, zip: false };
    });
  })).then(function(contenus){
    var nbPages = contenus.length;
    var PREMIER = 7;                       // 1 catalogue, 2 pages, 3-5 polices, 6 infos
    var objets = [];                       // objets[n-1] = octets de l'objet n
    var kids = [];
    for(var i = 0; i < nbPages; i++) kids.push((PREMIER + i * 2) + ' 0 R');

    objets[0] = _tcExpLatin1('<< /Type /Catalog /Pages 2 0 R >>');
    objets[1] = _tcExpLatin1('<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + nbPages + ' >>');
    ['Times-Roman', 'Times-Bold', 'Times-Italic'].forEach(function(nom, k){
      objets[2 + k] = _tcExpLatin1('<< /Type /Font /Subtype /Type1 /BaseFont /' + nom
        + ' /Encoding /WinAnsiEncoding >>');
    });
    objets[5] = _tcExpLatin1('<< /Title (' + _tcExpPdfTexte(t('exp_titre_doc') + ' (' + data.nomClair + ')')
      + ') /Author (' + _tcExpPdfTexte(data.nomClair) + ')'
      + ' /Creator (' + _tcExpPdfTexte(t('exp_titre_doc')) + ')'
      + ' /CreationDate (' + _tcExpPdfDate(data.date) + ') >>');

    for(i = 0; i < nbPages; i++){
      objets[PREMIER - 1 + i * 2] = _tcExpLatin1('<< /Type /Page /Parent 2 0 R'
        + ' /MediaBox [0 0 ' + _tcExpNombre(G.largeur) + ' ' + _tcExpNombre(G.hauteur) + ']'
        + ' /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >>'
        + ' /Contents ' + (PREMIER + 1 + i * 2) + ' 0 R >>');
      objets[PREMIER + i * 2] = _tcExpConcat([
        _tcExpLatin1('<< /Length ' + contenus[i].corps.length
          + (contenus[i].zip ? ' /Filter /FlateDecode' : '') + ' >>\nstream\n'),
        contenus[i].corps,
        _tcExpLatin1('\nendstream')
      ]);
    }

    var morceaux = [_tcExpLatin1('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
    var position = morceaux[0].length, offsets = [];
    for(i = 0; i < objets.length; i++){
      var tete = _tcExpLatin1((i + 1) + ' 0 obj\n');
      var queue = _tcExpLatin1('\nendobj\n');
      offsets.push(position);
      morceaux.push(tete, objets[i], queue);
      position += tete.length + objets[i].length + queue.length;
    }
    var xref = 'xref\n0 ' + (objets.length + 1) + '\n0000000000 65535 f \n';
    for(i = 0; i < offsets.length; i++){
      xref += ('0000000000' + offsets[i]).slice(-10) + ' 00000 n \n';
    }
    xref += 'trailer\n<< /Size ' + (objets.length + 1) + ' /Root 1 0 R /Info 6 0 R >>\n'
          + 'startxref\n' + position + '\n%%EOF\n';
    morceaux.push(_tcExpLatin1(xref));
    return new Blob([_tcExpConcat(morceaux)], { type: 'application/pdf' });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  5. REMISE DU FICHIER
// ═══════════════════════════════════════════════════════════════════════════

// « Mathieu Muzard » → « mathieu-muzard ».
function _tcExpSlug(s){
  var v = String(s || '');
  try{ v = v.normalize('NFD').replace(/[̀-ͯ]/g, ''); }catch(e){}
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'tops';
}

// Un Blob et un <a download> : rien ne part sur le réseau, et la CSP du site
// n'a pas besoin d'être touchée.
function _tcExpRemettre(blob, nomFichier){
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = nomFichier;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // On laisse au navigateur le temps de prendre le fichier avant de libérer.
  setTimeout(function(){
    if(a.parentNode) a.parentNode.removeChild(a);
    URL.revokeObjectURL(url);
  }, 30000);
}

// ═══════════════════════════════════════════════════════════════════════════
//  POINT D'ENTRÉE — le seul nom appelé depuis index.js
// ═══════════════════════════════════════════════════════════════════════════
//  tcExportTops('JEANNE DUPONT', 'docx' | 'pdf') → Promise
//
//  Fabrique le fichier et le remet au visiteur. Les erreurs ne remontent pas :
//  elles s'affichent dans une bannière, comme partout ailleurs sur le site.

function tcExportTops(jsonName, format){
  // Un seul export à la fois : fabriquer 1 300 tops prend une seconde ou deux,
  // et deux clics de suite ne doivent pas lancer deux fabrications.
  if(_tcExpEnCours) return Promise.resolve();
  // Chacun n'exporte que ses propres tops, et seulement s'ils viennent de
  // Supabase. Le bouton n'est posé qu'à cette condition (cf. renderProfil) ;
  // ce test ne fait que l'écrire noir sur blanc.
  if(!tcExportTopsPossible(jsonName)) return Promise.resolve();

  _tcExpEnCours = true;
  tcShowBanner('tc-exp-banner', t('exp_en_cours'), '#4a4a4a');

  return Promise.all([_tcExpCollecterTops(jsonName), _tcExpCollecterThematiques()])
    .then(function(res){
      var collecte = res[0], them = res[1];
      // Un top sans films est un top dont la liste n'est pas arrivée : on ne
      // met pas dans le fichier un nom de cinéaste suivi de rien.
      var tops = collecte.filter(function(top){ return top.films && top.films.length; });
      var manquants = collecte.length - tops.length;
      if(!tops.length && !them.liste.length){
        tcShowBanner('tc-exp-banner', t('exp_vide'), '#8a6d1f');
        setTimeout(function(){ tcHideBanner('tc-exp-banner'); }, 5000);
        return;
      }
      var nbFilms = 0;
      tops.forEach(function(top){ nbFilms += top.films.length; });
      var maintenant = new Date();
      var data = {
        nomClair: _tcExpNomClair(jsonName),
        tops: tops,
        thematiques: them.liste,
        date: maintenant,
        iso: maintenant.toISOString().replace(/\.\d+Z$/, 'Z'),
        sousTitre: t('exp_sous_titre', {
          tops: tops.length, films: nbFilms,
          date: tcDate(maintenant.toISOString(), { year: 'numeric', month: 'long', day: 'numeric' })
        })
      };
      var lignes = _tcExpLignes(data);
      var nomFichier = _tcExpSlug(t('exp_titre_doc')) + '-' + _tcExpSlug(data.nomClair)
        + '-' + maintenant.toISOString().slice(0, 10) + '.' + (format === 'pdf' ? 'pdf' : 'docx');
      var fabrique = (format === 'pdf')
        ? _tcExpPdf(lignes, data)
        : _tcExpZip(_tcExpDocxParties(lignes, data));
      return fabrique.then(function(blob){
        _tcExpRemettre(blob, nomFichier);
        var avertissement = manquants > 0 ? t('exp_partiel', manquants)
                          : (them.echec ? t('exp_theme_absent') : null);
        if(avertissement){
          tcShowBanner('tc-exp-banner', avertissement, '#8a6d1f');
          setTimeout(function(){ tcHideBanner('tc-exp-banner'); }, 8000);
        } else {
          tcHideBanner('tc-exp-banner');
        }
      });
    })
    .catch(function(err){
      console.error('export des tops : échec', err);
      tcShowBanner('tc-exp-banner', t('exp_erreur'), '#8a2a1f');
      setTimeout(function(){ tcHideBanner('tc-exp-banner'); }, 8000);
    })
    .then(function(){ _tcExpEnCours = false; });
}
