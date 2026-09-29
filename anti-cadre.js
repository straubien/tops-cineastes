// Protection contre le detournement de clics (clickjacking). Cf. audit A-20.
//
// La vraie protection serait un en-tete HTTP : X-Frame-Options, ou la
// directive CSP frame-ancestors. GitHub Pages n'en permet aucun, et la
// specification CSP impose d'IGNORER frame-ancestors lorsqu'elle est delivree
// par <meta>. Ce garde-fou JavaScript est donc le seul moyen disponible dans
// l'hebergement actuel. Il reste contournable - un cadre « bac a sable » peut
// neutraliser la sortie - c'est un durcissement, pas une fermeture.
//
// Ce code est dans un FICHIER et non en ligne dans la page : la politique
// script-src de ce site vaut 'self', sans 'unsafe-inline'. Un <script> ecrit
// directement dans le HTML serait bloque par le navigateur.
//
// La balise qui le charge ne porte NI defer NI async : il doit s'executer
// pendant l'analyse du <head>, donc avant tout rendu.
(function () {
  var encadre;
  try { encadre = (window.top !== window.self); }
  catch (e) { encadre = true; }   // acces refuse = cadre d'une autre origine
  if (!encadre) return;

  // Masquer AVANT tout rendu. Meme si la sortie du cadre echoue - les
  // navigateurs la bloquent souvent depuis une autre origine - il n'y a alors
  // plus rien a cliquer a l'aveugle.
  document.documentElement.style.display = 'none';
  try { window.top.location = window.self.location; } catch (e) {}

  document.addEventListener('DOMContentLoaded', function () {
    // Si on arrive ici, la sortie du cadre a echoue. On explique, plutot que
    // de laisser une page blanche. Le contenu reel reste dans le document mais
    // masque : les scripts de la page trouvent leurs elements et ne cassent pas.
    document.body.style.visibility = 'hidden';

    var msg = document.createElement('div');
    msg.setAttribute('style',
      'position:fixed;inset:0;z-index:2147483647;background:#fff;color:#111;' +
      'font:16px/1.6 system-ui,-apple-system,sans-serif;display:flex;' +
      'flex-direction:column;align-items:center;justify-content:center;' +
      'text-align:center;padding:24px');

    var p = document.createElement('p');
    p.textContent = "Cette page ne peut pas être affichée à l'intérieur d'un cadre.";

    var a = document.createElement('a');
    a.href = window.self.location.href;
    a.target = '_top';
    a.rel = 'noopener noreferrer';
    a.textContent = 'Ouvrir la page normalement';
    a.setAttribute('style', 'color:#b3261e;margin-top:12px');

    msg.appendChild(p);
    msg.appendChild(a);
    document.documentElement.appendChild(msg);
    document.documentElement.style.display = '';
  });
})();
