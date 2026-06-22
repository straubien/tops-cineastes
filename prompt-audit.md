# AUDIT COMPLET — TOPS/CINÉASTES

Tu vas effectuer un audit complet du site TOPS/CINÉASTES, un site statique
vanilla JS (HTML/CSS/JS) avec Supabase comme backend.

ATTENTION : tu ne dois utiliser aucun sous-agent. Tu dois lire toi-même
chaque fichier concerné avant de produire ton rapport. Ne produis le rapport
qu'une fois TOUS les fichiers lus.

---

## CONTEXTE TECHNIQUE

STACK :
- 3 fichiers HTML principaux : index.html, submit.html, admin.html
  (chacun ~1600-1700 lignes, JS inline dans des balises `<script>`)
- CSS global : style.css
- JS partagés : utils.js, i18n.js (FR/EN), config.js (credentials Supabase),
  auth-shared.js (login/popstate mutualisé)
- Backend : Supabase (Auth + PostgreSQL + Storage + RLS)
- Données locales : cineastes.json (49 000+ lignes), muzard.json, cnudde.json
- Aucun framework, aucun build tool, aucun bundler, aucun test

ARCHITECTURE :
- SPA sans routing : chaque "page" est une div affichée/cachée par JS
- Navigation par hash (#connexion, #mon-profil, #dashboard, etc.)
- Auth Supabase email/password, sessions gérées via le SDK Supabase
  (localStorage côté navigateur)
- Rôles : visiteur public / contributeur authentifié / admin (admin.html)
- Clé Supabase anon publique dans config.js (intentionnel, protégé par RLS)
- Le site utilise Supabase JS SDK v2.45.4 chargé depuis CDN

HISTORIQUE DE BUGS CORRIGÉS (à vérifier qu'ils n'ont pas régressé) :
- Échecs silencieux Supabase ("phantom writes") : un `update()` ou `insert()`
  bloqué par RLS retournait `{ data: null, error: null }` sans que le code
  ne détecte l'échec. Corrigé par ajout de `.select('id')` + vérification
  `if (!res.data || !res.data.length)` sur 19 appels d'écriture.
- Notifications réapparaissant après déconnexion/reconnexion malgré le clic
  sur ✕ (absence de backup localStorage avant l'appel DB).

MISSION : auditer sans modifier l'essence ni l'apparence actuelle du site.

---

## PÉRIMÈTRE DE L'AUDIT

### 1. FIABILITÉ DES ÉCHANGES AVEC SUPABASE

C'est la catégorie la plus critique — les bugs les plus vicieux du site
étaient dans cette catégorie.

- **Échecs silencieux (phantom writes)** : vérifier que CHAQUE appel
  `insert()`, `update()`, `delete()`, `upsert()` est suivi de `.select()`
  ET que le code vérifie `if (!res.data || !res.data.length)` pour détecter
  un blocage RLS silencieux. Lister tout appel d'écriture qui ne suit pas
  ce pattern.
- **Gestion des erreurs réseau** : que se passe-t-il si Supabase est down,
  si la connexion est coupée, si un appel timeout ? Chercher les `.then()`
  sans `.catch()` et les `await` sans `try/catch`.
- **Race conditions** : double-clic sur un bouton de validation/soumission,
  appels async concurrents qui se chevauchent, états intermédiaires
  incohérents. Les boutons sont-ils désactivés pendant le traitement ?
- **Retries et timeouts** : y a-t-il une stratégie de retry sur les appels
  critiques ? Un timeout côté client ?
- **Cohérence des données reçues** : le code vérifie-t-il que les champs
  attendus existent dans la réponse Supabase avant de les utiliser ?
  (ex: `res.data[0].id` sans vérifier que `res.data[0]` existe)
- **Appels Supabase redondants** : mêmes données rechargées plusieurs fois
  inutilement (ex: liste des contributeurs rechargée à chaque navigation)

### 2. BUGS FONCTIONNELS ET DE NAVIGATION

- Logique de navigation (show/hide des divs) : états incohérents possibles,
  double-initialisation de composants, transitions manquantes, div qui
  reste visible quand elle ne devrait pas
- Bouton retour/suivant du navigateur : le hash est-il correctement géré ?
  `popstate` correctement écouté ? L'état visuel correspond-il au hash ?
- Comportement à la déconnexion/reconnexion : l'état de l'UI est-il
  correctement réinitialisé ? Des données d'un utilisateur peuvent-elles
  "fuiter" vers un autre ?
- Gestion du localStorage : que se passe-t-il si le quota est dépassé ?
  Si le navigateur est en mode privé et refuse le stockage ? Les clés
  localStorage sont-elles correctement nettoyées à la déconnexion ?
- Fuites mémoire : event listeners ajoutés mais jamais retirés,
  `setInterval` sans `clearInterval`, références DOM orphelines après
  un changement de "page"

### 3. SÉCURITÉ

- **XSS** : chercher TOUTES les insertions `innerHTML`, `outerHTML`,
  `insertAdjacentHTML`, et vérifier que `escapeHtml()` est
  systématiquement appliqué sur les données provenant de l'utilisateur
  ou de Supabase. Lister chaque occurrence avec son statut (protégé /
  non protégé / partiellement protégé).
- **formatPresentation()** : cette fonction convertit du markdown en HTML.
  Vérifier qu'elle ne permet pas d'injecter du HTML/JS arbitraire
  (balises `<script>`, `<img onerror>`, `javascript:` URLs, etc.)
- **Contrôle d'accès** : un contributeur peut-il modifier les données
  d'un autre via la console JS ? La protection repose-t-elle uniquement
  sur RLS ou y a-t-il aussi des vérifications côté client ?
- **admin.html** : le contenu admin est-il visible sans authentification
  côté client (même si Supabase RLS protège les données) ?
- **Upload d'avatar** : validation du type MIME côté client uniquement ?
  Taille maximale respectée ? Nom de fichier assaini ?
- **Données sensibles exposées** : clés, emails, tokens, logs `console.log`
  avec des données utilisateur en production
- **Dépendances CDN** : les scripts chargés depuis CDN utilisent-ils des
  attributs `integrity` (SRI) ? Que se passe-t-il si un CDN est compromis ?

### 4. BUGS VISUELS ET CSS

- Éléments qui débordent ou se superposent (overflow, z-index)
- Responsive mobile : tester mentalement les breakpoints existants,
  chercher les largeurs fixes qui casseraient sur petit écran
- Dark mode : couleurs manquantes, texte illisible sur fond sombre,
  images/icônes non adaptées
- Polices de secours si Google Fonts ou WOFF2 ne chargent pas
- Animations/transitions cassées ou incohérentes

### 5. REDONDANCES ET QUALITÉ DE CODE

- Fonctions dupliquées entre les 3 fichiers HTML (code copié-collé qui
  devrait être mutualisé comme l'a été auth-shared.js)
- Sélecteurs CSS redondants ou morts dans style.css
- Variables i18n inutilisées, en double, ou manquantes dans une langue
- Code mort : fonctions jamais appelées, variables assignées mais jamais lues
- Conventions incohérentes : mélange `var`/`let`/`const`, nommage
  incohérent (camelCase vs snake_case vs autre)

### 6. ROBUSTESSE ET CAS LIMITES

- **Dépendances externes** : que se passe-t-il si un CDN (Supabase JS,
  Google Fonts, etc.) ne répond pas ? Le site affiche-t-il un état dégradé
  ou reste-t-il bloqué sur un écran blanc ?
- **cineastes.json (49 000+ lignes)** : chargé à chaque visite ? Mis en
  cache ? Impact sur le temps de chargement initial, surtout sur mobile/3G ?
- **Limites Supabase** : pagination des résultats (défaut 1000 lignes),
  rate limiting, taille max des uploads
- **Formulaires** : validation côté client uniquement ? Que se passe-t-il
  avec des entrées vides, très longues, ou contenant des caractères spéciaux ?
- **Sessions expirées** : que se passe-t-il si le token Supabase expire
  pendant que l'utilisateur remplit un formulaire ? Le travail est-il perdu ?

### 7. EXPÉRIENCE UTILISATEUR ET ERGONOMIE

- Indicateurs de chargement : sont-ils présents partout où une requête
  async est lancée ? (spinners, skeleton screens, messages)
- Feedback utilisateur : après chaque action (soumission, validation,
  suppression), l'utilisateur sait-il si ça a marché ou échoué ?
- Autocomplete cinéastes : pertinence du tri, comportement avec des
  accents/casses différentes, accessibilité clavier (flèches, Entrée, Échap)
- Navigation au clavier : Tab, Entrée, Échap sur les modales et dropdowns
- Messages d'erreur : localisés FR/EN ? Compréhensibles pour un non-dev ?
- Accessibilité de base : aria-labels, contraste, rôles sémantiques,
  focus visible

### 8. ARCHITECTURE ET MAINTENABILITÉ

- Tout le JS inline dans les HTML : conséquences sur la maintenabilité,
  impossibilité d'appliquer une Content Security Policy stricte
- Absence de tests : quelles parties du code sont les plus risquées
  à modifier sans filet de sécurité ?
- Absence de routing réel : conséquences sur le partage de liens, le SEO,
  les bookmarks
- Supabase anon key dans config.js versionné : le dépôt Git est-il public ?
  (si oui, la clé est dans l'historique même si on la retire)

---

## FORMAT DU RAPPORT

### Structure attendue :

1. **Résumé exécutif** (10 lignes max) : état général du site, les 3-4
   problèmes les plus graves, le niveau de risque global.

2. **Tableau de synthèse** : nombre de problèmes par catégorie et sévérité.

3. **Détail par catégorie** (dans l'ordre ci-dessus) : pour chaque problème,
   indiquer :
   - **Fichier et ligne(s)** concernés
   - **Sévérité** : 🔴 Critique (bug bloquant ou faille de sécurité) /
     🟠 Important (bug impactant l'UX ou risque modéré) /
     🟡 Mineur (amélioration souhaitable)
   - **Description** du problème en langage simple
   - **Impact concret** : que vit l'utilisateur quand ce bug se produit ?
   - **Suggestion de correction** (décrire sans implémenter)

4. **Top 10 des corrections prioritaires** : liste ordonnée des actions
   les plus impactantes, avec pour chacune une estimation d'effort
   (rapide / modéré / conséquent).

5. **Points positifs** : lister aussi ce qui fonctionne bien et ne doit
   pas être changé.

### Règles de rédaction :

- Le propriétaire du site n'est pas développeur : langage clair, pas de
  jargon inutile, mais précision technique dans les suggestions de correction.
- Ne pas noyer les problèmes critiques dans une liste interminable de
  détails mineurs : les 🔴 doivent sauter aux yeux.
- Si un même pattern de bug se répète à N endroits, le décrire une fois
  puis lister les N occurrences — ne pas répéter la même explication N fois.
- Distinguer clairement les vrais bugs des améliorations souhaitables.
