// Rovex Hub personnalisable : thèmes de couleurs, fond d'écran (image, GIF, vidéo, dégradé animé), verre des
// panneaux, police, taille du texte, animations et CSS libre. Le réglage est gardé par l'app (Réglages
// → Personnaliser) et aussi dans ce navigateur pour s'appliquer dès l'ouverture, sans flash.
(function () {
  const PRESETS = {
    violet: { label: 'Violet', accent: '#7C3AED', accent2: '#A78BFA', accent3: '#C4B5FD', bg: '#09070F', aurora: ['#7C3AED', '#A21CAF', '#2563EB'] },
    ocean: { label: 'Océan', accent: '#0EA5E9', accent2: '#38BDF8', accent3: '#7DD3FC', bg: '#050B12', aurora: ['#0EA5E9', '#14B8A6', '#6366F1'] },
    sunset: { label: 'Sunset', accent: '#F97316', accent2: '#FB923C', accent3: '#FDBA74', bg: '#110805', aurora: ['#F97316', '#EC4899', '#EAB308'] },
    emerald: { label: 'Émeraude', accent: '#10B981', accent2: '#34D399', accent3: '#6EE7B7', bg: '#04100B', aurora: ['#10B981', '#22D3EE', '#84CC16'] },
    crimson: { label: 'Crimson', accent: '#E11D48', accent2: '#FB7185', accent3: '#FDA4AF', bg: '#100508', aurora: ['#E11D48', '#9333EA', '#F97316'] },
    gold: { label: 'Or', accent: '#D97706', accent2: '#FBBF24', accent3: '#FDE68A', bg: '#0F0B04', aurora: ['#D97706', '#F59E0B', '#B45309'] },
    candy: { label: 'Candy', accent: '#DB2777', accent2: '#F472B6', accent3: '#F9A8D4', bg: '#10060D', aurora: ['#DB2777', '#8B5CF6', '#06B6D4'] },
    midnight: { label: 'Midnight', accent: '#4F46E5', accent2: '#818CF8', accent3: '#C7D2FE', bg: '#05060F', aurora: ['#4F46E5', '#0EA5E9', '#7C3AED'] },
    mono: { label: 'Mono', accent: '#A1A1AA', accent2: '#D4D4D8', accent3: '#F4F4F5', bg: '#09090B', aurora: ['#52525B', '#71717A', '#3F3F46'] },
  };
  const FONTS = {
    inter: { label: 'Inter', css: "Inter, system-ui, 'Segoe UI', sans-serif" },
    poppins: { label: 'Poppins', css: "Poppins, system-ui, sans-serif", g: 'Poppins:wght@400;500;600;700' },
    nunito: { label: 'Nunito', css: "Nunito, system-ui, sans-serif", g: 'Nunito:wght@400;600;700;800' },
    grotesk: { label: 'Space Grotesk', css: "'Space Grotesk', system-ui, sans-serif", g: 'Space+Grotesk:wght@400;500;600;700' },
    fredoka: { label: 'Fredoka', css: "Fredoka, system-ui, sans-serif", g: 'Fredoka:wght@400;500;600;700' },
    mono: { label: 'JetBrains Mono', css: "'JetBrains Mono', Consolas, monospace" },
    system: { label: 'Système', css: "system-ui, 'Segoe UI', sans-serif" },
  };
  const DEFAULT = {
    theme: 'violet', accent: '', accent2: '', accent3: '', bgColor: '',
    bg: { type: 'aurora', src: '', fit: 'cover', dim: 0.45, blur: 0 }, // aurora | none | gradient | image | video
    glass: 0.82, font: 'inter', scale: 1, radius: 18, animations: true, css: '',
  };

  const hex = (h) => { const m = String(h || '').replace('#', '').match(/^([0-9a-f]{6})$/i); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const toHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));
  const rgba = (h, a) => { const c = hex(h); return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`; };

  function merge(c) {
    const out = { ...DEFAULT, ...(c || {}) };
    out.bg = { ...DEFAULT.bg, ...((c && c.bg) || {}) };
    return out;
  }

  function layer() {
    let el = document.getElementById('bg-layer');
    if (!el) {
      el = document.createElement('div');
      el.id = 'bg-layer';
      el.setAttribute('aria-hidden', 'true');
      document.body.prepend(el);
    }
    return el;
  }

  function loadFont(f) {
    if (!f || !f.g || document.querySelector(`link[data-font="${f.g}"]`)) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.dataset.font = f.g;
    l.href = `https://fonts.googleapis.com/css2?family=${f.g}&display=swap`;
    document.head.append(l);
  }

  function apply(input) {
    const c = merge(input);
    const p = PRESETS[c.theme] || PRESETS.violet;
    const accent = hex(c.accent) ? c.accent : p.accent;
    const accent2 = hex(c.accent2) ? c.accent2 : p.accent2;
    const accent3 = hex(c.accent3) ? c.accent3 : p.accent3;
    const bg = hex(c.bgColor) ? c.bgColor : p.bg;
    const media = ['image', 'video', 'gradient'].includes(c.bg.type) && (c.bg.type === 'gradient' || c.bg.src);
    const glass = media ? Math.max(0.2, Math.min(1, Number(c.glass) || DEFAULT.glass)) : 1;
    const r = document.documentElement.style;
    const panel = mix(bg, accent, 0.06);
    const panel2 = mix(bg, accent, 0.11);
    const vars = {
      '--bg': bg, '--side': mix(bg, accent, 0.03), '--panel': media ? rgba(panel, glass) : panel, '--panel2': media ? rgba(panel2, glass) : panel2,
      '--line': mix(bg, accent, 0.16), '--line2': mix(bg, accent, 0.22), '--accent': accent, '--accent2': accent2, '--accent3': accent3,
      '--accent-bg': mix(bg, accent, 0.2), '--radius': `${Math.max(4, Math.min(30, Number(c.radius) || 18))}px`,
      '--side-bg': media ? rgba(mix(bg, accent, 0.03), Math.min(0.92, glass)) : rgba(mix(bg, accent, 0.03), 0.92),
      '--top-bg': media ? 'transparent' : bg,
    };
    for (const [k, v] of Object.entries(vars)) r.setProperty(k, v);
    const font = FONTS[c.font] || FONTS.inter;
    loadFont(font);
    document.body.style.fontFamily = font.css;
    document.body.style.fontSize = `${14 * Math.max(0.85, Math.min(1.25, Number(c.scale) || 1))}px`;
    document.body.classList.toggle('no-anim', c.animations === false);
    document.body.classList.toggle('has-bg', Boolean(media));
    // Fond : aurore (par défaut), aucun, dégradé animé, image / GIF, vidéo.
    const aurora = document.querySelector('.aurora');
    if (aurora) {
      aurora.hidden = c.bg.type !== 'aurora';
      aurora.querySelectorAll('i').forEach((i, n) => { i.style.background = p.aurora[n] || accent; });
      if (hex(c.accent)) aurora.querySelector('i').style.background = accent;
    }
    const L = layer();
    const key = JSON.stringify([c.bg.type, c.bg.src, c.bg.fit]);
    if (L.dataset.key !== key) {
      L.dataset.key = key;
      L.innerHTML = '';
      if (c.bg.type === 'image' && c.bg.src) {
        const img = document.createElement('img');
        img.src = c.bg.src;
        img.alt = '';
        L.append(img);
      } else if (c.bg.type === 'video' && c.bg.src) {
        const v = document.createElement('video');
        Object.assign(v, { src: c.bg.src, autoplay: true, loop: true, muted: true, playsInline: true });
        v.setAttribute('muted', '');
        // Vidéo que le lecteur ne sait pas lire (souvent HEVC / H.265) : on prévient l'app.
        v.addEventListener('error', () => window.dispatchEvent(new CustomEvent('rovex-bg-error')));
        L.append(v);
        v.play().catch(() => {});
      } else if (c.bg.type === 'gradient') {
        L.append(Object.assign(document.createElement('div'), { className: 'bg-gradient' }));
      }
      const veil = Object.assign(document.createElement('div'), { className: 'bg-veil' });
      L.append(veil);
    }
    L.hidden = !media;
    L.style.setProperty('--fit', c.bg.fit === 'contain' ? 'contain' : 'cover');
    L.style.setProperty('--dim', String(Math.max(0, Math.min(0.95, Number(c.bg.dim)))));
    L.style.setProperty('--blur', `${Math.max(0, Math.min(30, Number(c.bg.blur) || 0))}px`);
    L.style.setProperty('--g1', accent);
    L.style.setProperty('--g2', p.aurora[1]);
    L.style.setProperty('--g3', p.aurora[2]);
    // CSS libre (mode développeur ou réglages avancés).
    let st = document.getElementById('custom-css');
    if (!st) { st = document.createElement('style'); st.id = 'custom-css'; document.head.append(st); }
    st.textContent = String(c.css || '');
    try { localStorage.setItem('rovex-custom', JSON.stringify(c)); } catch {}
    return c;
  }

  function cached() {
    try { return JSON.parse(localStorage.getItem('rovex-custom') || 'null'); } catch { return null; }
  }

  window.RovexTheme = { PRESETS, FONTS, DEFAULT, apply, merge, cached };
  // Dès le chargement : le dernier thème connu (l'app relit ensuite celui enregistré).
  const start = () => { const c = cached(); if (c) apply(c); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
