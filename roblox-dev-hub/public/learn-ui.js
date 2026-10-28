// ---------- Atelier d'apprentissage : des vidéos et des images que Claude étudie pour en tirer des recettes ----------
// Les images clés sont tirées ici (comme dans le Chat Claude), envoyées par lots, puis Claude les étudie par MCP
// (lesson_frames → lesson_save). L'utilisateur relit, corrige et valide ; Claude retrouve ensuite les recettes
// validées avec find_lessons et load_skill. Utilise les outils de app.js.
const LN_STATUS = { pending: '⏳', draft: '📝', validated: '✅' };
let LN_FILTER = { status: '', category: '' };

async function lnVideoFrames(file, count, onStep) {
  const url = URL.createObjectURL(file);
  const v = Object.assign(document.createElement('video'), { muted: true, preload: 'auto', playsInline: true, src: url });
  try {
    await new Promise((ok, ko) => { v.onloadeddata = ok; v.onerror = () => ko(new Error(t('ln.badVideo', { name: file.name }))); });
    const d = v.duration;
    if (!isFinite(d) || !v.videoWidth) throw new Error(t('ln.badVideo', { name: file.name }));
    const n = Math.max(1, Math.min(count, Math.round(d * 2) || 1));
    const frames = [];
    for (let i = 0; i < n; i++) {
      const at = n === 1 ? 0 : d * (i + 0.5) / n;
      await agSeek(v, at);
      frames.push({ src: agEncode(v, v.videoWidth, v.videoHeight, 768), t: Math.round(at * 10) / 10 });
      if (onStep) onStep(i + 1, n);
    }
    return { frames, duration: Math.round(d) };
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}

async function lnUpload(id, frames) {
  for (let i = 0; i < frames.length; i += 6) await api(`/lessons/${id}/frames`, { method: 'POST', body: { frames: frames.slice(i, i + 6) } });
}

async function lnAnalyze(id) {
  try {
    await api(`/lessons/${id}/analyze`, { method: 'POST' });
    toast(t('ln.sent'));
  } catch (e) { toast(e.message, true); }
}

async function renderLearn(params) {
  if (params.get('id')) return renderLesson(params.get('id'));
  const { items } = await api('/lessons');
  const cats = META.categories.filter((c) => c.id !== 'gameplay');
  const shown = items.filter((l) => (!LN_FILTER.status || l.status === LN_FILTER.status) && (!LN_FILTER.category || l.category === LN_FILTER.category));
  const count = (st) => items.filter((l) => l.status === st).length;
  view.innerHTML = `
    ${pageHead(t('ln.eyebrow'), t('nav.learn'), t('ln.sub'))}
    <div class="flow">
      ${[['🎬', 'ln.f1'], ['🧠', 'ln.f2'], ['✅', 'ln.f3']].map(([ico, k], i) => `<div class="flow-step" style="--i:${i}"><span>${ico}</span><b>${t(k + 't')}</b><small>${t(k)}</small></div>`).join('<i class="flow-arrow">→</i>')}
    </div>
    <form class="panel ln-new" id="ln-form" data-spot>
      <h3>➕ ${t('ln.newTitle')}</h3>
      <label class="ln-drop" id="ln-drop"><input type="file" id="ln-file" accept="video/*,image/*" multiple hidden>
        <b>${t('ln.drop')}</b><small>${t('ln.dropHelp')}</small><span id="ln-picked"></span></label>
      <div class="ln-fields">
        <label>${t('ln.title')}<input class="input" id="ln-title" maxlength="120" placeholder="${t('ln.titlePh')}"></label>
        <label>${t('ln.category')}<select class="select" id="ln-cat">${cats.map((c) => `<option value="${c.id}" ${c.id === 'modeling' ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>
        <label>${t('ln.software')}<select class="select" id="ln-soft"><option value="Blender">Blender</option><option value="Roblox Studio">Roblox Studio</option><option value="">${t('ln.other')}</option></select></label>
        <label>${t('ln.frames')}<select class="select" id="ln-count">${[16, 24, 32, 48, 64].map((n) => `<option value="${n}" ${n === 32 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <label class="ln-note">${t('ln.note')}<textarea class="input" id="ln-note" rows="2" placeholder="${t('ln.notePh')}"></textarea></label>
      <div class="row"><button class="btn primary" id="ln-go">${t('ln.add')}</button><span class="sub" id="ln-progress"></span></div>
    </form>
    <div class="row ln-filters">
      <div class="chips">${[['', t('ln.all') + ' · ' + items.length], ['pending', `${LN_STATUS.pending} ${t('ln.st.pending')} · ${count('pending')}`], ['draft', `${LN_STATUS.draft} ${t('ln.st.draft')} · ${count('draft')}`], ['validated', `${LN_STATUS.validated} ${t('ln.st.validated')} · ${count('validated')}`]]
        .map(([v, label]) => `<button class="chip ${LN_FILTER.status === v ? 'on' : ''}" data-st="${v}">${label}</button>`).join('')}</div>
      <select class="select" id="ln-fcat"><option value="">${t('ln.allCats')}</option>${cats.map((c) => `<option value="${c.id}" ${LN_FILTER.category === c.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select>
    </div>
    ${shown.length ? `<div class="ln-grid">${shown.map((l) => `<a class="ln-card" href="#/learn?id=${l.id}" style="--c:${cat(l.category).color}">
        <span class="ln-cover" ${l.cover ? `style="background-image:url('/media/${esc(l.cover)}')"` : ''}>${l.cover ? '' : '🎬'}</span>
        <span class="ln-badge st ${l.status === 'validated' ? 'validated' : l.status === 'draft' ? 'review' : 'draft'}">${LN_STATUS[l.status]} ${t('ln.st.' + l.status)}</span>
        <b>${esc(l.title)}</b>
        <small><span class="dot" style="background:${cat(l.category).color}"></span>${esc(cat(l.category).label)}${l.software ? ' · ' + esc(l.software) : ''}${l.source && l.source.kind === 'shared' ? ' · 🌍' : ''}</small>
        <small>${l.steps ? t('ln.nSteps', { n: l.steps }) : t('ln.nFrames', { n: l.frames })}</small>
      </a>`).join('')}</div>`
      : `<div class="empty"><b>${t('ln.emptyTitle')}</b>${t('ln.emptyText')}</div>`}`;
  stagger($('.ln-grid') || view);
  let picked = [];
  const showPicked = () => {
    $('#ln-picked').textContent = picked.length ? picked.map((f) => f.name).join(', ') : '';
    if (picked.length && !$('#ln-title').value) $('#ln-title').value = picked[0].name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 100);
  };
  $('#ln-file').onchange = (e) => { picked = [...e.target.files]; showPicked(); };
  const drop = $('#ln-drop');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); picked = [...e.dataTransfer.files].filter((f) => /^(video|image)\//.test(f.type)); showPicked(); };
  $$('[data-st]').forEach((b) => b.onclick = () => { LN_FILTER.status = b.dataset.st; renderLearn(params); });
  $('#ln-fcat').onchange = (e) => { LN_FILTER.category = e.target.value; renderLearn(params); };
  $('#ln-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!picked.length) return toast(t('ln.pickFirst'), true);
    const go = $('#ln-go');
    const prog = $('#ln-progress');
    go.disabled = true;
    const base = { category: $('#ln-cat').value, software: $('#ln-soft').value, note: $('#ln-note').value };
    const count = Number($('#ln-count').value) || 32;
    const videos = picked.filter((f) => /^video\//.test(f.type));
    const images = picked.filter((f) => /^image\//.test(f.type)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    let last = null;
    try {
      // Une leçon par vidéo ; toutes les images ensemble forment une leçon (dans l'ordre choisi).
      for (const [i, file] of videos.entries()) {
        prog.textContent = t('ln.extract', { name: file.name, i: i + 1, n: videos.length });
        const { frames, duration } = await lnVideoFrames(file, count, (k, n) => { prog.textContent = t('ln.extractN', { name: file.name, k, n }); });
        const title = videos.length === 1 && $('#ln-title').value.trim() ? $('#ln-title').value.trim() : file.name.replace(/\.[^.]+$/, '');
        const l = await api('/lessons', { method: 'POST', body: { ...base, title, kind: 'video', name: file.name, duration } });
        prog.textContent = t('ln.uploading', { name: file.name });
        await lnUpload(l.id, frames);
        last = l.id;
      }
      if (images.length) {
        prog.textContent = t('ln.uploading', { name: images[0].name });
        const frames = [];
        for (const f of images) {
          const img = await agImage(f).catch(() => null);
          if (img) frames.push({ src: img.frames[0], t: 0, label: f.name.slice(0, 80) });
        }
        const l = await api('/lessons', { method: 'POST', body: { ...base, title: $('#ln-title').value.trim() || images[0].name.replace(/\.[^.]+$/, ''), kind: 'images', name: `${images.length} images` } });
        await lnUpload(l.id, frames);
        last = l.id;
      }
      toast(t('ln.added'));
      if (last) location.hash = `#/learn?id=${last}`;
    } catch (er) {
      toast(er.message, true);
      go.disabled = false;
      prog.textContent = '';
    }
  };
}

// ---------- Une leçon : images clés, recette à relire / corriger, validation ----------
async function renderLesson(id) {
  let l;
  try { l = await api('/lessons/' + id); } catch (e) { toast(e.message, true); location.hash = '#/learn'; return; }
  const r = l.recipe || { summary: '', steps: [], tips: [], tags: [] };
  const readOnly = l.fromShare && !isAdmin();
  const frameImg = (n, cls = '') => l.frames[n] ? `<button type="button" class="ln-frame ${cls}" data-frame="${n}" title="#${n}${l.frames[n].t ? ' · ' + l.frames[n].t + ' s' : ''}"><img src="/media/${esc(l.frames[n].file)}" alt="" loading="lazy"><i>${n}</i></button>` : '';
  const step = (s, i) => `<div class="ln-step" data-step="${i}">
      <div class="ln-step-head"><span class="ln-num">${i + 1}</span><input class="input" data-f="title" value="${esc(s.title)}" ${readOnly ? 'readonly' : ''}>
        ${readOnly ? '' : `<button type="button" class="icon-btn small" data-up="${i}" title="↑">↑</button><button type="button" class="icon-btn small" data-down="${i}" title="↓">↓</button><button type="button" class="icon-btn small" data-del="${i}" title="${t('delete')}">×</button>`}</div>
      <textarea class="input" data-f="detail" rows="3" ${readOnly ? 'readonly' : ''}>${esc(s.detail)}</textarea>
      ${(s.frames || []).length ? `<div class="ln-step-frames">${s.frames.map((n) => frameImg(n, 'sm')).join('')}</div>` : ''}
      <details><summary>${t('ln.code')}${s.code ? ' ✓' : ''}</summary><textarea class="input mono" data-f="code" rows="6" ${readOnly ? 'readonly' : ''}>${esc(s.code || '')}</textarea></details>
    </div>`;
  view.innerHTML = `
    <div class="ln-head">
      <a class="btn small" href="#/learn">←</a>
      <span class="st ${l.status === 'validated' ? 'validated' : l.status === 'draft' ? 'review' : 'draft'}">${LN_STATUS[l.status]} ${t('ln.st.' + l.status)}</span>
      <h1 class="cw-title">${esc(l.title)}</h1>
      <small class="sub"><span class="dot" style="background:${cat(l.category).color}"></span> ${esc(cat(l.category).label)}${l.software ? ' · ' + esc(l.software) : ''} · ${t('ln.nFrames', { n: l.frames.length })}${l.source && l.source.duration ? ' · ' + Math.round(l.source.duration / 60) + ' min' : ''}${l.shared ? ' · 🌍 ' + t('ln.isShared') : ''}</small>
    </div>
    <div class="row ln-actions">
      ${readOnly ? '' : `<button class="btn ${l.status === 'pending' ? 'primary' : ''}" id="ln-an">🧠 ${t(l.recipe ? 'ln.reanalyze' : 'ln.analyze')}</button>`}
      ${readOnly || !l.recipe ? '' : l.status === 'validated' ? `<button class="btn" id="ln-unval">↺ ${t('ln.toDraft')}</button>` : `<button class="btn primary" id="ln-val">✅ ${t('ln.validate')}</button>`}
      ${isAdmin() && l.status === 'validated' && !l.fromShare ? `<button class="btn" id="ln-share">🌍 ${t(l.shared ? 'ln.unshare' : 'ln.share')}</button>` : ''}
      ${readOnly ? '' : `<button class="btn danger" id="ln-del">${t('delete')}</button>`}
    </div>
    ${l.status === 'pending' ? `<div class="panel ln-tip" data-spot>💡 ${t('ln.pendingHelp')}</div>` : ''}
    <div class="ln-strip cw-scroll">${l.frames.map((_, n) => frameImg(n)).join('')}</div>
    ${l.recipe ? `<form class="panel ln-recipe" id="ln-recipe" data-spot>
      <label class="ln-l">${t('ln.summary')}<textarea class="input" id="ln-sum" rows="3" ${readOnly ? 'readonly' : ''}>${esc(r.summary)}</textarea></label>
      <h3>${t('ln.steps')} · ${r.steps.length}</h3>
      <div id="ln-steps">${r.steps.map(step).join('')}</div>
      ${readOnly ? '' : `<button type="button" class="btn small" id="ln-addstep">+ ${t('ln.addStep')}</button>`}
      <label class="ln-l">${t('ln.tips')}<textarea class="input" id="ln-tips" rows="4" ${readOnly ? 'readonly' : ''} placeholder="${t('ln.tipsPh')}">${esc(r.tips.join('\n'))}</textarea></label>
      <label class="ln-l">${t('ln.tags')}<input class="input" id="ln-tags" value="${esc(r.tags.join(', '))}" ${readOnly ? 'readonly' : ''}></label>
      ${readOnly ? '' : `<div class="row"><button class="btn primary">${t('save')}</button></div>`}
    </form>` : ''}`;
  // Recette lue depuis le formulaire (étapes dans l'ordre affiché).
  const collect = () => ({
    summary: $('#ln-sum').value,
    steps: $$('.ln-step').map((el) => ({
      title: $('[data-f="title"]', el).value, detail: $('[data-f="detail"]', el).value, code: $('[data-f="code"]', el).value,
      frames: (r.steps[Number(el.dataset.step)] || {}).frames || [],
    })),
    tips: $('#ln-tips').value.split('\n').map((x) => x.trim()).filter(Boolean),
    tags: $('#ln-tags').value.split(',').map((x) => x.trim()).filter(Boolean),
  });
  const save = async (extra = {}) => {
    try { await api('/lessons/' + id, { method: 'PUT', body: { ...(l.recipe && !readOnly ? { recipe: collect() } : {}), ...extra } }); return true; }
    catch (e) { toast(e.message, true); return false; }
  };
  $$('.ln-frame').forEach((b) => b.onclick = () => {
    const n = Number(b.dataset.frame);
    openModal(`<h2 class="att-title">#${n}${l.frames[n].t ? ` · ${l.frames[n].t} s` : ''}</h2><div class="att-view"><figure><img src="/media/${esc(l.frames[n].file)}" alt=""></figure></div>`);
  });
  if (readOnly) return;
  const an = $('#ln-an');
  if (an) an.onclick = () => lnAnalyze(id);
  const form = $('#ln-recipe');
  if (form) {
    form.onsubmit = async (e) => { e.preventDefault(); if (await save()) { toast(t('toast.saved')); renderLesson(id); } };
    const move = async (i, d) => {
      const rec = collect();
      const [x] = rec.steps.splice(i, 1);
      rec.steps.splice(i + d, 0, x);
      try { await api('/lessons/' + id, { method: 'PUT', body: { recipe: rec } }); } catch (er) { toast(er.message, true); }
      renderLesson(id);
    };
    $$('[data-up]').forEach((b) => b.onclick = () => { const i = Number(b.dataset.up); if (i > 0) move(i, -1); });
    $$('[data-down]').forEach((b) => b.onclick = () => { const i = Number(b.dataset.down); if (i < r.steps.length - 1) move(i, 1); });
    $$('[data-del]').forEach((b) => b.onclick = async () => {
      const rec = collect();
      rec.steps.splice(Number(b.dataset.del), 1);
      try { await api('/lessons/' + id, { method: 'PUT', body: { recipe: rec } }); } catch (er) { toast(er.message, true); }
      renderLesson(id);
    });
    $('#ln-addstep').onclick = async () => {
      const rec = collect();
      rec.steps.push({ title: t('ln.newStep'), detail: '…', frames: [] });
      try { await api('/lessons/' + id, { method: 'PUT', body: { recipe: rec } }); } catch (er) { toast(er.message, true); }
      renderLesson(id);
    };
  }
  const val = $('#ln-val');
  if (val) val.onclick = async () => { if (await save({ status: 'validated' })) { toast(t('ln.validated')); renderLesson(id); } };
  const unval = $('#ln-unval');
  if (unval) unval.onclick = async () => { if (await save({ status: 'draft' })) renderLesson(id); };
  const share = $('#ln-share');
  if (share) share.onclick = async () => {
    share.disabled = true;
    try {
      const thumbs = [];
      let sent = [];
      if (!l.shared) {
        // 4 petites images : la première image clé des premières étapes.
        const picks = [...new Set([...(l.recipe.steps || []).map((s) => (s.frames || [])[0]).filter((n) => n !== undefined), 0])].slice(0, 4);
        for (const n of picks) {
          if (!l.frames[n]) continue;
          const img = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = '/media/' + l.frames[n].file; });
          if (img) { thumbs.push(agEncode(img, img.naturalWidth, img.naturalHeight, 320)); sent.push(n); }
        }
      }
      await api(`/lessons/${id}/share`, { method: 'POST', body: l.shared ? { remove: true } : { thumbs, picks: sent } });
      toast(t(l.shared ? 'ln.unshared' : 'ln.shared'));
      renderLesson(id);
    } catch (e) { toast(e.message, true); share.disabled = false; }
  };
  $('#ln-del').onclick = async () => {
    if (!confirm(t('ln.confirmDel', { title: l.title }))) return;
    await api('/lessons/' + id, { method: 'DELETE' }).catch((e) => toast(e.message, true));
    location.hash = '#/learn';
  };
}
