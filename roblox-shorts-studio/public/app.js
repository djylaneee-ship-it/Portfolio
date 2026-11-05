// Interface : onglets, tableau des Shorts en direct (SSE), planning, gameplay, réglages.
const $ = (id) => document.getElementById(id);
const api = (url, body) =>
  fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || r.status); return d; });

const STATUS = {
  queued: 'En attente', story: 'Écriture du script…', voice: 'Voix off…', images: 'Images IA…', render: 'Montage…',
  paused: 'En pause', ready: 'Prêt', uploading: 'Envoi YouTube…', scheduled: 'Programmé', published: 'Publié',
  stopped: 'Arrêté', error: 'Erreur',
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmtDate = (iso) => new Date(iso).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Onglets
document.querySelectorAll('nav button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('nav button, .tab').forEach((el) => el.classList.remove('active'));
    b.classList.add('active');
    $(b.dataset.tab).classList.add('active');
  }));

// Tableau des Shorts
function renderJobs(jobs) {
  if (!jobs.length) return ($('jobs').innerHTML = '<p class="empty">Aucun Short pour l\'instant.</p>');
  $('jobs').innerHTML = [...jobs].reverse().map((j) => {
    const busy = ['story', 'voice', 'images', 'render'].includes(j.status);
    return `<div class="job ${j.status}">
      <div class="job-head">
        <b>${esc(j.title || 'Roblox Short')}</b>
        <span class="tag">${STATUS[j.status] || j.status}</span>
      </div>
      <div class="bar"><div style="width:${j.progress || 0}%"></div></div>
      <div class="job-meta">
        ID ${j.id}${j.publishAt ? ` · ${j.status === 'published' ? 'publié' : 'publication'} ${fmtDate(j.publishAt)}` : ''}
        ${j.error ? `<span class="error">${esc(j.error)}</span>` : ''}
      </div>
      <div class="job-actions">
        ${busy ? `<button data-a="pause" data-id="${j.id}">Pause</button>` : ''}
        ${j.status === 'paused' ? `<button data-a="resume" data-id="${j.id}">Reprendre</button>` : ''}
        ${busy || j.status === 'paused' ? `<button data-a="stop" data-id="${j.id}" class="danger">Stop</button>` : ''}
        ${j.file ? `<a class="button" href="/output/${j.id}.mp4" target="_blank">Voir</a>` : ''}
        ${j.status === 'ready' ? `<button data-a="upload" data-id="${j.id}">Publier maintenant</button>` : ''}
        ${j.url ? `<a class="button" href="${esc(j.url)}" target="_blank">YouTube</a>` : ''}
        ${!busy && j.status !== 'paused' && j.status !== 'uploading' ? `<button data-a="remove" data-id="${j.id}" class="ghost">Retirer</button>` : ''}
      </div>
    </div>`;
  }).join('');
}
$('jobs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-a]');
  if (b) api(`/api/jobs/${b.dataset.id}/${b.dataset.a}`, {}).catch((err) => alert(err.message));
});
new EventSource('/api/events').onmessage = (e) => renderJobs(JSON.parse(e.data).jobs);

$('generate').onclick = async () => {
  await api('/api/settings', { topicPrompt: $('topicPrompt').value, imageStyle: $('imageStyle').value });
  await api('/api/generate', { count: Number($('count').value) }).catch((err) => alert(err.message));
};

// Planning
function renderTimes(times, perDay) {
  const list = Array.from({ length: perDay }, (_, i) => times[i] || '18:00');
  $('times').innerHTML = list.map((t) => `<input type="time" value="${t}">`).join('');
}
$('perDay').oninput = () => renderTimes([...$('times').querySelectorAll('input')].map((i) => i.value), Number($('perDay').value) || 1);
$('saveSchedule').onclick = async () => {
  await api('/api/settings', {
    schedule: {
      enabled: $('schEnabled').checked,
      perDay: Number($('perDay').value),
      times: [...$('times').querySelectorAll('input')].map((i) => i.value),
      timezone: $('timezone').value,
      bufferDays: Number($('bufferDays').value),
    },
  });
  load();
};

// Gameplay
$('gpFiles').onchange = async (e) => {
  for (const f of e.target.files) {
    await fetch(`/api/gameplay/upload?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
  }
  e.target.value = '';
  load();
};
function renderGameplay(list) {
  $('gpCount').textContent = `(${list.length} clips)`;
  $('gpTable').querySelector('tbody').innerHTML = list
    .map((g) => `<tr><td>${esc(g.name)}</td><td>${Math.round(g.duration)} s</td><td>${g.uses}</td></tr>`).join('');
}

// Réglages
$('saveSettings').onclick = async () => {
  await api('/api/settings', {
    keys: { groq: $('keyGroq').value, elevenlabs: $('keyEleven').value },
    groqModel: $('groqModel').value, language: $('language').value,
    voiceId: $('voiceId').value, speed: Number($('speed').value),
    youtube: { clientId: $('ytClientId').value, clientSecret: $('ytClientSecret').value },
  });
  load();
};

async function load() {
  const { settings: s, jobs, gameplay, schedule } = await api('/api/state');
  renderJobs(jobs);
  renderGameplay(gameplay);
  $('topicPrompt').value = s.topicPrompt;
  $('imageStyle').value = s.imageStyle;
  $('schEnabled').checked = s.schedule.enabled;
  $('perDay').value = s.schedule.perDay;
  renderTimes(s.schedule.times, s.schedule.perDay);
  $('timezone').value = s.schedule.timezone;
  $('bufferDays').value = s.schedule.bufferDays;
  $('nextSlots').innerHTML = schedule.enabled
    ? schedule.next.map((t) => `<li>${fmtDate(t)}</li>`).join('') || '<li>Aucun créneau</li>'
    : '<li>Planning désactivé</li>';
  $('schError').textContent = schedule.lastError || '';
  $('keyGroq').value = s.keys.groq;
  $('keyEleven').value = s.keys.elevenlabs;
  $('groqModel').value = s.groqModel;
  $('language').value = s.language;
  $('speed').value = s.speed;
  $('ytClientId').value = s.youtube.clientId;
  $('ytClientSecret').value = s.youtube.clientSecret;
  $('ytStatus').textContent = s.youtube.refreshToken ? 'connecté' : 'non connecté';
  if (s.youtube.refreshToken) api('/api/youtube/channel').then((r) => r.channel && ($('ytStatus').textContent = r.channel)).catch(() => {});
  if (s.keys.elevenlabs) {
    api('/api/voices')
      .then((voices) => {
        $('voiceId').innerHTML = voices.map((v) => `<option value="${v.id}" ${v.id === s.voiceId ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
      })
      .catch(() => { $('voiceId').innerHTML = `<option value="${esc(s.voiceId)}">${esc(s.voiceId) || '—'}</option>`; });
  }
}
load();

// Mises à jour de l'app (seulement dans l'app installée)
const UPDATE = { dev: '', idle: '', checking: 'Vérification…', latest: 'À jour', error: 'Erreur de mise à jour', ready: 'Prête : redémarre' };
async function refreshUpdate() {
  const u = await api('/api/update').catch(() => ({ state: 'dev' }));
  $('updateBtn').hidden = u.state === 'dev';
  $('updateState').textContent = u.state === 'downloading' ? `Téléchargement ${u.version} (${u.percent || 0} %)` : UPDATE[u.state] || '';
  $('updateBtn').textContent = u.state === 'ready' ? `Installer ${u.version}` : 'Mises à jour';
  $('updateBtn').dataset.state = u.state;
}
$('updateBtn').onclick = () =>
  api($('updateBtn').dataset.state === 'ready' ? '/api/update/install' : '/api/update/check', {}).then(refreshUpdate);
refreshUpdate();
setInterval(refreshUpdate, 5000);
