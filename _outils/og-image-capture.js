// ===========================================================================
//  og-image-capture.js
//  FABRIQUE L'IMAGE DE PARTAGE A PARTIR DU SITE EN LIGNE
// ===========================================================================
//
//  OUTIL DE FABRICATION, pas un fichier du site. Il vit dans _outils/, que
//  Jekyll ne publie pas.
//
//  ── CE QU'IL FAIT ───────────────────────────────────────────────────────
//
//  Il ouvre https://straubien.github.io/tops-cineastes/ dans un navigateur
//  sans fenetre, regle pour produire exactement 2400 x 1260, puis :
//
//    * il FIGE le mur de visages. Sur le site, chaque tuile fait alterner
//      deux portraits en fondu : une capture prise au mauvais moment
//      tomberait au milieu d'une transition.
//    * il EFFACE le titre et le bouton « Explorer l'index », et recompose le
//      titre par-dessus, bien plus gros. C'est tout l'objet de ce script,
//      et la raison est au point suivant.
//    * il ECARTE les deux blocs rouges, qui se chevauchent a ce format.
//    * il capture, et recommence autant de fois qu'on le lui demande : le
//      mur tire ses visages au hasard parmi les 91 de la liste Supabase, si
//      bien que chaque passage donne un tirage different.
//
//  ── POURQUOI LE TITRE EST REECRIT PLUS GROS ─────────────────────────────
//
//  Sur la page d'accueil, le titre occupe environ la moitie de la largeur.
//  C'est juste pour un ecran. Mais dans un fil Facebook, la vignette est
//  affichee a 500 px de large : la hauteur des capitales tombe alors a une
//  vingtaine de pixels, et l'Imprint MT Shadow — une romaine OMBREE, aux
//  delies tres fins — se desagrege. Ni la reduction ni le reencodage JPEG
//  de Facebook ne lui laissent sa chance.
//
//  AUGMENTER LA DEFINITION DE L'IMAGE N'Y CHANGE RIEN : le texte est du
//  vectoriel, il est deja parfait dans le fichier. Ce qui compte, c'est la
//  PART DE LA LARGEUR que le titre occupe une fois l'image reduite. Ici il
//  en occupe 86 %, contre ~50 % sur la page d'accueil.
//
//  Une page d'accueil se lit en plein ecran, une vignette de partage se lit
//  a 500 px. Les deux ne peuvent pas avoir les memes proportions.
//
//  ── COMMENT S'EN SERVIR ─────────────────────────────────────────────────
//
//      npm install playwright        (une seule fois)
//      node _outils/og-image-capture.js            -> 1 tirage
//      node _outils/og-image-capture.js 6          -> 6 tirages, numerotes
//
//  Les fichiers sortent dans le dossier courant : og-capture-1.png, etc.
//  Choisissez celui qui vous plait, renommez-le, et mettez le nouveau nom
//  dans les balises og:image d'index.html ET de photogramme.html.
//
//  ── ATTENTION, DEUX CHOSES ──────────────────────────────────────────────
//
//  1. CHANGEZ LE NOM DU FICHIER a chaque nouvelle image. Facebook garde en
//     cache ce qu'il a lu pour une adresse donnee : reecrire un fichier sans
//     le renommer laisse l'ancienne image s'afficher pendant des semaines.
//     On en est a og-image-3.png ; la prochaine sera og-image-4.png.
//     Et NE SUPPRIMEZ PAS les anciennes : des publications pointent dessus.
//
//  2. CE SCRIPT NE REPRODUIT PAS UN TIRAGE DONNE. Les visages sont tires au
//     hasard a chaque passage. L'image publiee aujourd'hui (og-image-3.png)
//     est un tirage precis, qui ne se retrouvera pas en relancant ceci. Si
//     vous tenez a une selection de visages, il faut la figer — demandez, ou
//     modifiez la liste « splash_mur » dans app_settings.
// ===========================================================================

const { chromium } = require('playwright');

const ADRESSE = 'https://straubien.github.io/tops-cineastes/';
const NB = Math.max(1, parseInt(process.argv[2], 10) || 1);

// Tout ce qu'on impose a la page. Les tailles sont en pixels CSS : la capture
// se fait en densite 2, donc un titre de 90 px ici donne 180 px dans le
// fichier de 2400 px.
const RETOUCHE = `
  /* On fige le fondu croise sur le premier visage de chaque tuile. */
  .splash-mur > i::before { animation: none !important; opacity: 1 !important; }
  .splash-mur > i::after  { animation: none !important; opacity: 0 !important; }
  .splash, .splash-center,
  .splash-geo-v1, .splash-geo-sq1, .splash-geo-sq2 { animation: none !important; }

  /* Le titre d'origine et le bouton s'effacent : on recompose par-dessus.
     Un bouton sur lequel on ne peut pas cliquer n'a rien a faire dans une
     vignette, et reduit a 500 px il n'est plus qu'une tache grise. */
  .splash-title, .splash-enter { display: none !important; }

  /* Les deux blocs rouges sont positionnes en % de la HAUTEUR, calcules pour
     un ecran. Sur un format large ils se rejoignent et se lisent comme une
     seule forme en escalier : on leur rend leur ecart. */
  .splash-geo-sq1 { top: 9%  !important; right: 16% !important; }
  .splash-geo-sq2 { top: 32% !important; right: 9%  !important; }

  /* Voile central un peu plus dense que sur le site : les lettres claires
     doivent se detacher de visages qui, eux, restent lisibles. */
  .splash-mur::after { background:
    radial-gradient(ellipse 68% 54% at 50% 48%, rgba(6,6,6,.94) 0%, rgba(6,6,6,.70) 55%, rgba(6,6,6,.40) 100%),
    linear-gradient(to bottom, rgba(8,8,8,.46) 0%, rgba(8,8,8,.06) 34%, rgba(8,8,8,.06) 64%, rgba(8,8,8,.56) 100%)
    !important; }

  /* Le titre de la vignette. 90 px CSS en densite 2 = 180 px dans le fichier,
     soit 86 % de la largeur. C'est le maximum raisonnable : au-dela, le titre
     touche les bords. */
  .og-titre {
    font-family: 'ImprintMTShadow', serif;
    font-size: 90px; letter-spacing: .12em; line-height: 1;
    color: #f7f3ec; white-space: nowrap; margin-bottom: 26px;
    /* Ombre resserree : une ombre tres diffuse adoucit le bord des lettres
       au lieu de les detacher. Un lisere net, puis un halo large. */
    text-shadow: 0 1px 6px rgba(0,0,0,.92), 0 0 22px rgba(0,0,0,.7);
  }
  .og-titre .b {
    display: inline-block; background: #A33025; color: #f7f3ec;
    padding: 0 15.5px; margin: 0 7px; font-size: 69.5px; font-weight: 400;
    vertical-align: middle; line-height: 1.2;
  }
  .og-sub {
    font-family: 'GoudyOldStyle', Georgia, serif;
    font-size: 22px; text-transform: uppercase; color: #f7f3ec;
    letter-spacing: .38em; text-indent: .38em; opacity: .92;
    text-shadow: 0 1px 6px rgba(0,0,0,.92);
  }
`;

(async () => {
  const navigateur = await chromium.launch();
  for (let i = 1; i <= NB; i++) {
    // UN CONTEXTE NEUF A CHAQUE FOIS. Le site retient dans sessionStorage les
    // visages deja montres, pour ne pas les repeter d'une page a l'autre.
    // Repartir d'un contexte vierge garantit un tirage independant.
    const contexte = await navigateur.newContext({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 2            // -> fichier de 2400 x 1260
    });
    const page = await contexte.newPage();
    await page.goto(ADRESSE, { waitUntil: 'networkidle', timeout: 60000 });

    // Le mur ne vient pas du CSS mais d'un reglage lu dans Supabase : il faut
    // lui laisser le temps d'arriver, puis aux images d'etre decodees.
    await page.waitForTimeout(4000);

    await page.addStyleTag({ content: RETOUCHE });
    await page.evaluate(() => {
      const centre = document.querySelector('.splash-center');
      centre.innerHTML =
        '<div class="og-titre">TOPS<span class="b">/</span>CINÉASTES</div>' +
        '<div class="og-sub">INDEX COLLABORATIF</div>';
    });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1500);

    const nom = NB === 1 ? 'og-capture.png' : 'og-capture-' + i + '.png';
    await page.screenshot({ path: nom });

    const large = await page.evaluate(() =>
      Math.round(document.querySelector('.og-titre').getBoundingClientRect().width));
    console.log(nom + '  —  titre : ' + Math.round(large / 12) + ' % de la largeur');

    await contexte.close();
  }
  await navigateur.close();
})();
