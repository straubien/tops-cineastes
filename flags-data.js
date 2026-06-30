// Données partagées pour les drapeaux de nationalité (fiches cinéastes + admin)
//
// - Codes ISO 3166-1 alpha-2 (minuscules) : pays existants, drapeau résolu via flagcdn.com
// - Codes historiques (majuscules) : pays/entités disparus, drapeau auto-hébergé dans /flags
//
// TC_COUNTRIES : liste affichée dans le sélecteur admin (code, libellé FR)
// TC_HISTORIC_FLAGS : codes historiques → chemin de l'image locale
// tcFlagUrl(code) : retourne l'URL du drapeau pour un code donné, ou null
// tcFlagHtml(code, opts) : retourne le HTML <img> du drapeau, ou '' si code vide/inconnu

var TC_HISTORIC_FLAGS = {
  'URSS':  'flags/URSS.svg',
  'RDA':   'flags/RDA.svg',
  'RFA':   'flags/RFA.svg',
  'TCH':   'flags/TCH.svg',
  'YOUG':  'flags/YOUG.svg',
  'SCG':   'flags/SCG.svg',
  'ZAIRE': 'flags/ZAIRE.svg'
};

var TC_HISTORIC_LABELS = {
  'URSS':  'URSS',
  'RDA':   'Allemagne de l’Est (RDA)',
  'RFA':   'Allemagne de l’Ouest (RFA)',
  'TCH':   'Tchécoslovaquie',
  'YOUG':  'Yougoslavie (RFSY)',
  'SCG':   'Serbie-et-Monténégro',
  'ZAIRE': 'Zaïre'
};

// Liste des pays ISO 3166-1 alpha-2 courants, libellés en français
var TC_ISO_COUNTRIES = {
  'af':'Afghanistan','za':'Afrique du Sud','al':'Albanie','dz':'Algérie','de':'Allemagne',
  'ad':'Andorre','ao':'Angola','sa':'Arabie saoudite','ar':'Argentine','am':'Arménie',
  'au':'Australie','at':'Autriche','az':'Azerbaïdjan','bs':'Bahamas','bh':'Bahreïn',
  'bd':'Bangladesh','be':'Belgique','bz':'Belize','bj':'Bénin','bt':'Bhoutan',
  'by':'Biélorussie','mm':'Birmanie','bo':'Bolivie','ba':'Bosnie-Herzégovine','bw':'Botswana',
  'br':'Brésil','bn':'Brunei','bg':'Bulgarie','bf':'Burkina Faso','bi':'Burundi',
  'kh':'Cambodge','cm':'Cameroun','ca':'Canada','cv':'Cap-Vert','cl':'Chili',
  'cn':'Chine','cy':'Chypre','co':'Colombie','km':'Comores','cg':'Congo',
  'cd':'Congo (RD)','kr':'Corée du Sud','kp':'Corée du Nord','cr':'Costa Rica','ci':'Côte d’Ivoire',
  'hr':'Croatie','cu':'Cuba','dk':'Danemark','dj':'Djibouti','eg':'Égypte',
  'ae':'Émirats arabes unis','ec':'Équateur','er':'Érythrée','es':'Espagne','ee':'Estonie',
  'us':'États-Unis','et':'Éthiopie','fi':'Finlande','fr':'France','ga':'Gabon',
  'gm':'Gambie','ge':'Géorgie','gh':'Ghana','gr':'Grèce','gt':'Guatemala',
  'gn':'Guinée','gw':'Guinée-Bissau','gq':'Guinée équatoriale','gy':'Guyana','ht':'Haïti',
  'hn':'Honduras','hu':'Hongrie','in':'Inde','id':'Indonésie','iq':'Irak',
  'ir':'Iran','ie':'Irlande','is':'Islande','il':'Israël','it':'Italie',
  'jm':'Jamaïque','jp':'Japon','jo':'Jordanie','kz':'Kazakhstan','ke':'Kenya',
  'kg':'Kirghizistan','kw':'Koweït','la':'Laos','ls':'Lesotho','lv':'Lettonie',
  'lb':'Liban','lr':'Libéria','ly':'Libye','li':'Liechtenstein','lt':'Lituanie',
  'lu':'Luxembourg','mk':'Macédoine du Nord','mg':'Madagascar','my':'Malaisie','mw':'Malawi',
  'mv':'Maldives','ml':'Mali','mt':'Malte','ma':'Maroc','mu':'Maurice',
  'mr':'Mauritanie','mx':'Mexique','md':'Moldavie','mc':'Monaco','mn':'Mongolie',
  'me':'Monténégro','mz':'Mozambique','na':'Namibie','np':'Népal','ni':'Nicaragua',
  'ne':'Niger','ng':'Nigeria','no':'Norvège','nz':'Nouvelle-Zélande','om':'Oman',
  'ug':'Ouganda','uz':'Ouzbékistan','pk':'Pakistan','pa':'Panama','pg':'Papouasie-Nouvelle-Guinée',
  'py':'Paraguay','nl':'Pays-Bas','pe':'Pérou','ph':'Philippines','pl':'Pologne',
  'pt':'Portugal','qa':'Qatar','do':'République dominicaine','cz':'République tchèque','ro':'Roumanie',
  'gb':'Royaume-Uni','ru':'Russie','rw':'Rwanda','sn':'Sénégal','rs':'Serbie',
  'sg':'Singapour','sk':'Slovaquie','si':'Slovénie','so':'Somalie','sd':'Soudan',
  'lk':'Sri Lanka','se':'Suède','ch':'Suisse','sr':'Suriname','sy':'Syrie',
  'tj':'Tadjikistan','tw':'Taïwan','tz':'Tanzanie','td':'Tchad','th':'Thaïlande',
  'tg':'Togo','tn':'Tunisie','tm':'Turkménistan','tr':'Turquie','ua':'Ukraine',
  'uy':'Uruguay','ve':'Venezuela','vn':'Vietnam','ye':'Yémen','zm':'Zambie',
  'zw':'Zimbabwe'
};

// Construit la liste complète { code, label, group } pour le sélecteur admin,
// triée alphabétiquement par libellé au sein de chaque groupe.
function tcCountrySelectOptions(){
  var iso = Object.keys(TC_ISO_COUNTRIES).map(function(code){
    return { code: code, label: TC_ISO_COUNTRIES[code], group: 'iso' };
  }).sort(function(a,b){ return a.label.localeCompare(b.label,'fr'); });
  var historic = Object.keys(TC_HISTORIC_LABELS).map(function(code){
    return { code: code, label: TC_HISTORIC_LABELS[code], group: 'historic' };
  }).sort(function(a,b){ return a.label.localeCompare(b.label,'fr'); });
  return { iso: iso, historic: historic };
}

function tcIsHistoricCode(code){
  return !!code && Object.prototype.hasOwnProperty.call(TC_HISTORIC_FLAGS, code);
}

function tcFlagUrl(code){
  if(!code) return null;
  if(tcIsHistoricCode(code)) return TC_HISTORIC_FLAGS[code];
  if(TC_ISO_COUNTRIES[code]) return 'https://flagcdn.com/h60/' + code + '.png';
  return null;
}

function tcCountryLabel(code){
  if(!code) return '';
  if(tcIsHistoricCode(code)) return TC_HISTORIC_LABELS[code];
  return TC_ISO_COUNTRIES[code] || code;
}

// Génère le HTML <img> du drapeau pour un code donné (ou '' si absent/inconnu)
function tcFlagHtml(code, cssClass){
  var url = tcFlagUrl(code);
  if(!url) return '';
  var label = tcCountryLabel(code);
  return '<img class="'+(cssClass||'tc-flag')+'" src="'+url+'" alt="'+escapeHtml(label)+'" title="'+escapeHtml(label)+'" loading="lazy">';
}
