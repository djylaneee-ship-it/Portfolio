#!/usr/bin/env python3
"""Regroupe tout le site (3 pages, style, script, images) dans un seul fichier : rovex-hub.html.

Les pages deviennent des sections affichées selon l'adresse (#download, #docs, #pricing…),
les images sont intégrées en base64. Usage : python3 site/build-single.py
"""
import base64
import io
import pathlib
import re

from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / 'rovex-hub.html'


def read(name):
    return (HERE / name).read_text(encoding='utf-8')


def between(html, start, end):
    i = html.index(start)
    j = html.index(end, i)
    return html[i:j + len(end)]


def data_uri(path):
    p = HERE / path
    if p.suffix == '.jpg':
        im = Image.open(p).convert('RGB')
        im.thumbnail((1600, 1600))
        buf = io.BytesIO()
        im.save(buf, 'JPEG', quality=76, optimize=True, progressive=True)
        return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()
    return 'data:image/png;base64,' + base64.b64encode(p.read_bytes()).decode()


def links(html):
    # Liens entre pages → ancres de la page unique.
    html = re.sub(r'href="index\.html#', 'href="#', html)
    html = re.sub(r'href="docs\.html#', 'href="#', html)
    html = html.replace('href="index.html"', 'href="#home"').replace('href="download.html"', 'href="#download"').replace('href="docs.html"', 'href="#docs"')
    return html.replace(' class="on" data-i18n', ' data-i18n')


index, download, docs = read('index.html'), read('download.html'), read('docs.html')
head = between(index, '<head>', '</head>')
nav = between(index, '<header class="nav">', '</header>')
footer = between(index, '<footer>', '</footer>')
home = between(index, '<main>', '</main>')[len('<main>'):-len('</main>')]
dl = between(download, '<main class="wrap">', '</main>')
doc = between(docs, '<main class="wrap docs">', '</main>')

ROUTER_CSS = """
/* Page unique : une seule section visible à la fois. */
.page { display: none; }
.page.on { display: block; animation: pagein .5s cubic-bezier(.16, 1, .3, 1); }
@keyframes pagein { from { opacity: 0; transform: translateY(14px); } }
"""

ROUTER_JS = """
// ---------- Page unique : #download et #docs ouvrent leur section, le reste est sur l'accueil ----------
(function () {
  const pages = [...document.querySelectorAll('.page')];
  function pageOf(el) { return el && el.closest('.page'); }
  function route() {
    let h = decodeURIComponent(location.hash.slice(1)) || 'home';
    let target = document.getElementById(h);
    // Doc en français : #install → #fr-install
    if (target && LANG === 'fr' && target.closest('[data-lang-block="en"]') && document.getElementById('fr-' + h)) target = document.getElementById('fr-' + h);
    if (LANG === 'en' && h.startsWith('fr-') && document.getElementById(h.slice(3))) target = document.getElementById(h.slice(3));
    const page = (target && (target.classList.contains('page') ? target : pageOf(target))) || pages[0];
    const changed = !page.classList.contains('on');
    pages.forEach((p) => p.classList.toggle('on', p === page));
    document.querySelectorAll('.nav-links a').forEach((a) => {
      const href = a.getAttribute('href');
      a.classList.toggle('on', (href === '#download' && page.id === 'download') || (href === '#docs' && page.id === 'docs'));
    });
    if (!target || target === page) window.scrollTo({ top: 0, behavior: changed ? 'auto' : 'smooth' });
    else setTimeout(() => target.scrollIntoView({ behavior: changed ? 'auto' : 'smooth' }), changed ? 30 : 0);
    if (page.id === 'download' && typeof loadRelease === 'function' && !window.__dlLoaded) { window.__dlLoaded = true; loadRelease(); }
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('DOMContentLoaded', route);
})();
"""

head = head.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + read('style.css') + ROUTER_CSS + '</style>')
head = head.replace('<meta property="og:image" content="assets/app-home.jpg">\n', '')

js = read('main.js')
# Le lien de téléchargement est chargé quand on ouvre la section Télécharger.
js = js.replace("  if ($('[data-download]')) loadRelease();\n", '')
# Les ancres de la doc française sont gérées par le routeur.
js = re.sub(r"  // Doc en français : les liens #install.*?\n  \}\n", '', js, flags=re.S)

body = f"""<body>
  <div class="aurora" aria-hidden="true"><i></i><i></i><i></i></div>
  {nav}
  <main class="page" id="home">{home}</main>
  <div class="page" id="download">{dl}</div>
  <div class="page" id="docs">{doc}</div>
  {footer}
  <script>
{js}
{ROUTER_JS}
  </script>
</body>"""

html = '<!doctype html>\n<html lang="en">\n' + head + '\n' + links(body) + '\n</html>\n'
# Chaque image n'est intégrée qu'une fois : les <img> la reçoivent au chargement (data-img).
assets = sorted(set(re.findall(r'assets/[\w.-]+\.(?:jpg|png)', html)))
html = re.sub(r'src="(assets/[\w.-]+)"', r'data-img="\1"', html)
html = html.replace('<link rel="icon" href="assets/icon.png">', '<link rel="icon" href="' + data_uri('assets/icon.png') + '">')
table = ',\n'.join(f'  "{a}": "{data_uri(a)}"' for a in assets)
loader = '<script>\nconst IMG = {\n' + table + '\n};\ndocument.querySelectorAll("img[data-img]").forEach((i) => { i.src = IMG[i.dataset.img]; });\n</script>\n'
html = html.replace('  <script>\n', loader + '  <script>\n', 1)
assert not re.search(r'(src|href)="assets/', html), 'image non intégrée'
OUT.write_text(html, encoding='utf-8')
print(f'OK : {OUT} ({OUT.stat().st_size // 1024} Ko)')
