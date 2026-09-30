// ─────────────────────────────────────────────────────────────────────────
//  Controle automatique du JavaScript — TOPS / CINEASTES
//
//  UNIQUEMENT des regles de CORRECTION : chacune signale du code qui a de
//  fortes chances d'etre un vrai defaut.
//
//  AUCUNE regle de style (indentation, guillemets, points-virgules) : elles
//  produiraient un ecart de plusieurs milliers de lignes sur le code
//  existant, sans rien apporter. Ne les activez pas.
//
//  Lancer :  npm run lint
//  Cf. audit B-30, actions A-053 a A-056.
// ─────────────────────────────────────────────────────────────────────────

// Les fichiers sont charges les uns apres les autres par les pages HTML :
// ils partagent une seule portee globale. On declare donc ici les noms
// definis dans un fichier et utilises dans un autre, sinon `no-undef`
// signalerait des centaines de faux positifs.
const globauxDuProjet = {
  // config.js
  TC_SUPABASE_URL: 'readonly', TC_SUPABASE_KEY: 'readonly', tcCreateClient: 'readonly',
  TC_AUTOCOMPLETE_MAX: 'readonly', TC_AVATAR_MAX_SIZE: 'readonly',
  // i18n.js
  TC_TRANSLATIONS: 'readonly', t: 'readonly', applyLang: 'readonly', toggleLang: 'readonly',
  // shared.js
  toggleDark: 'readonly', tcShowBanner: 'readonly', tcHideBanner: 'readonly',
  tcHandleGlobalError: 'readonly', tcUpdateOnlineBanner: 'readonly',
  // flagsdata.js
  TC_FLAGS: 'readonly', TC_FLAGS_HISTORIQUES: 'readonly', tcFlagHtml: 'readonly',
  tcCountryLabel: 'readonly', tcCountrySelectOptions: 'readonly',
  // auth-shared.js
  showError: 'readonly', tcLogin: 'readonly', tcSyncAuthHashOnPopstate: 'readonly',
  // utils.js
  escapeHtml: 'readonly', toTitleCase: 'readonly', getInitiales: 'readonly',
  formatContribName: 'readonly', formatContribNamePlain: 'readonly', getAvatarFilename: 'readonly',
  normStr: 'readonly', tcLocalPortraitPath: 'readonly', tcLocalPortraitCandidates: 'readonly',
  tcLocalPortraitDuoCandidates: 'readonly', tcIsAuthError: 'readonly', tcNotifyAuthExpired: 'readonly',
  tcSbError: 'readonly', tcIsTransientNetworkError: 'readonly', tcLoadAllCineastes: 'readonly',
  tcChargerPageCineastes: 'readonly', tcLoadAllCineastesSequentiel: 'readonly',
  TC_CINEASTES_COLONNES: 'readonly', tcLoadCourants: 'readonly', tcCourantLabel: 'readonly',
  tcCourantLabelFromName: 'readonly', tcCourantFlagHtml: 'readonly', tcCourantYears: 'readonly',
  tcCourantIds: 'readonly', tcCourantType: 'readonly', tcCourantTypeFromName: 'readonly',
  _TC_COURANTS_CACHE: 'writable',
  parseTopsBrut: 'readonly', parseFilmStr: 'readonly', tcMessageLignesIgnorees: 'readonly',
  formatPresentation: 'readonly', friendlyError: 'readonly', tcFetchWithTimeout: 'readonly',
  tcWithRetryTimeout: 'readonly', tcSafeUrl: 'readonly', TC_CONTRIB_COLONNES: 'readonly',
  tcReportErrorToSupabase: 'readonly', createAutocomplete: 'readonly',
  tcRendreActivable: 'readonly', tcAnnoncer: 'readonly', tcFondInerte: 'readonly',
  tcBarreRoving: 'readonly', tcBarreRovingMaj: 'readonly',
  // bibliotheque externe (jsDelivr)
  supabase: 'readonly'
};

export default [
  {
    files: ['*.js'],
    languageOptions: {
      // async/await est utilise dans index.js, admin.js et submit.js : il
      // faut donc au moins ES2017. On declare 2022, sans consequence.
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: Object.assign({
        window: 'readonly', document: 'readonly', console: 'readonly',
        localStorage: 'readonly', sessionStorage: 'readonly', navigator: 'readonly',
        location: 'readonly', history: 'readonly', performance: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly',
        fetch: 'readonly', Promise: 'readonly', Set: 'readonly', Map: 'readonly',
        AbortController: 'readonly', Image: 'readonly', FileReader: 'readonly',
        MutationObserver: 'readonly', IntersectionObserver: 'readonly',
        caches: 'readonly', self: 'readonly', URL: 'readonly', Blob: 'readonly',
        Intl: 'readonly', alert: 'readonly', confirm: 'readonly', prompt: 'readonly',
        getComputedStyle: 'readonly', requestAnimationFrame: 'readonly',
        Event: 'readonly', CustomEvent: 'readonly', FormData: 'readonly'
      }, globauxDuProjet)
    },
    rules: {
      // builtinGlobals:false — sans cette option, une fonction declaree
      // ci-dessus comme globale du projet ET definie dans son fichier serait
      // signalee a tort. On ne veut que les VRAIES redeclarations locales.
      'no-redeclare': ['error', { builtinGlobals: false }],
      'no-undef': 'error',            // nom utilise mais jamais defini (faute de frappe)
      'no-dupe-keys': 'error',        // meme cle deux fois dans un objet
      'no-dupe-args': 'error',        // meme parametre deux fois
      'no-dupe-else-if': 'error',     // meme condition deux fois dans un if/else if
      'no-duplicate-case': 'error',   // meme cas deux fois dans un switch
      'no-unreachable': 'error',      // code place apres un return : jamais execute
      'no-cond-assign': 'error',      // « = » ecrit a la place de « == » dans un if
      'no-func-assign': 'error',      // fonction ecrasee par une valeur
      'no-self-assign': 'error',      // x = x
      'no-sparse-arrays': 'error',    // [1, , 2] : trou involontaire
      'use-isnan': 'error',           // comparaison avec NaN, qui est toujours fausse
      'valid-typeof': 'error',        // typeof mal orthographie
      'no-compare-neg-zero': 'error',
      'no-unsafe-negation': 'error',
      'no-unsafe-finally': 'error',
      'no-async-promise-executor': 'error',
      'no-constant-binary-expression': 'error',
      // allowProperties:true — sans cette option, la regle signale toute
      // ecriture de PROPRIETE apres une attente (par ex. listEl.innerHTML),
      // ce qui donne 14 faux positifs ici : un element du DOM recupere en
      // variable locale ne peut pas changer pendant l'attente. On ne garde
      // que les reaffectations de VARIABLES, ou le risque est reel.
      'require-atomic-updates': ['warn', { allowProperties: true }],
      'no-empty': ['warn', { allowEmptyCatch: true }]
    }
  },
  {
    // Le service worker s'execute dans un contexte different du site.
    files: ['sw.js'],
    languageOptions: { globals: { self: 'readonly', caches: 'readonly', fetch: 'readonly', URL: 'readonly', Promise: 'readonly' } }
  },
  {
    // Les tests tournent dans Node, pas dans un navigateur.
    files: ['_tests/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { require: 'readonly', module: 'readonly', __dirname: 'readonly', console: 'readonly', process: 'readonly' } }
  }
];
