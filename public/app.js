const root = document.querySelector('#app');
const logout = document.querySelector('#logout');
let state = null;
let users = [];
let revealing = false;
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
async function api(path, method = 'GET', data) {
  const response = await fetch(`/api${path}`, { method, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: data === undefined ? undefined : JSON.stringify(data) });
  const result = await response.json().catch(() => ({ error: 'No pudimos conectar con el servidor.' }));
  if (!response.ok) {
    if (response.status === 401 && path !== '/login') { state = null; renderLogin(); }
    throw new Error(result.error || 'Inténtalo de nuevo.');
  }
  return result;
}
async function busy(form, action, errorSelector = '.error') {
  const button = form.querySelector('[type=submit]');
  const error = form.querySelector(errorSelector);
  error.textContent = '';
  button.disabled = true;
  try { await action(); } catch (e) { error.textContent = e.message; } finally { button.disabled = false; }
}
function renderLogin() {
  logout.classList.add('hidden');
  document.querySelector('.header-note').classList.remove('hidden');
  root.innerHTML = `<div class="login-layout"><section class="intro"><div class="eyebrow">AMIGO SECRETO</div><h1>Lo bonito está<br>en <em>no saber.</em></h1><p>Alguien tiene una sorpresa para ti.<br>Y tú estás a punto de descubrir para quién será la tuya.</p><div class="ticket"><span class="ticket-icon" aria-hidden="true">✳</span><div><strong>Un nombre. Un regalo. Nuestro secreto.</strong><small>La sorpresa empieza contigo.</small></div></div><div class="steps"><b>01 &nbsp; Entra</b><i></i><span>02 &nbsp; Descubre</span><i></i><span>03 &nbsp; Sorprende</span></div></section><section class="login-card"><div class="card-top"><span class="mini-label">TU LUGAR EN EL JUEGO</span><span class="small-star" aria-hidden="true">✳</span></div><h2>Qué bueno tenerte aquí.</h2><p class="subtext">Ingresa con la cuenta que te compartió<br>el organizador.</p><form id="login-form"><label>Usuario<input name="username" placeholder="Tu nombre de usuario" autocomplete="username" required maxlength="40" autocapitalize="none" spellcheck="false"></label><label>Contraseña<span class="password-wrap"><input name="password" type="password" placeholder="Tu contraseña" autocomplete="current-password" required maxlength="128"><button type="button" class="password-toggle" aria-label="Mostrar contraseña">Ver</button></span></label><p class="error" role="alert"></p><button class="primary" type="submit">Entrar al juego <span>↗</span></button></form><p class="login-note">¿Aún no tienes tu cuenta?<br><strong>Pídesela al organizador de tu grupo.</strong></p></section></div>`;
  document.querySelector('.password-toggle').onclick = event => {
    const input = document.querySelector('[name=password]');
    input.type = input.type === 'password' ? 'text' : 'password';
    event.target.textContent = input.type === 'password' ? 'Ver' : 'Ocultar';
    event.target.setAttribute('aria-label', input.type === 'password' ? 'Mostrar contraseña' : 'Ocultar contraseña');
  };
  document.querySelector('#login-form').onsubmit = event => {
    event.preventDefault();
    const form = event.currentTarget;
    busy(form, async () => { await api('/login', 'POST', Object.fromEntries(new FormData(form))); await refresh(); });
  };
}
async function refresh() {
  state = await api('/me');
  logout.classList.remove('hidden');
  document.querySelector('.header-note').classList.add('hidden');
  if (state.user.mustChangePassword) return renderPassword();
  if (state.user.role === 'admin') { users = (await api('/admin/users')).users; renderAdmin(); } else renderGame();
}
function renderPassword(optional = false) {
  root.innerHTML = `<section class="center-page"><div class="eyebrow">SOLO TÚ LO SABES</div><h1>${optional ? 'Tu contraseña, tu secreto.' : 'Primero, hazla tuya.'}</h1><p>${optional ? 'Elige una contraseña que no uses en otros sitios.' : 'Cambia la contraseña inicial por una que solo tú conozcas. Así protegemos tu sorpresa.'}</p><div class="login-card"><form id="password-form"><label>Contraseña actual<input type="password" name="currentPassword" required autocomplete="current-password" maxlength="128"></label><label>Contraseña nueva<input type="password" name="newPassword" required minlength="12" maxlength="128" autocomplete="new-password"></label><label>Repite la contraseña nueva<input type="password" name="confirm" required minlength="12" maxlength="128" autocomplete="new-password"></label><p class="hint">Mínimo 12 caracteres. Puedes usar una frase fácil de recordar.</p><p class="error" role="alert"></p><button class="primary" type="submit">Guardar y continuar <span>↗</span></button></form></div>${optional ? '<button class="quiet" id="back">Volver al juego</button>' : ''}</section>`;
  document.querySelector('#password-form').onsubmit = event => {
    event.preventDefault(); const form = event.currentTarget;
    busy(form, async () => { const values = Object.fromEntries(new FormData(form)); if (values.newPassword !== values.confirm) throw new Error('Las contraseñas no coinciden.'); await api('/password', 'POST', values); await refresh(); });
  };
  document.querySelector('#back')?.addEventListener('click', () => refresh().catch(showPageError));
}
function renderGame() {
  const { user, game, recipient } = state;
  const drawn = game.locked;
  const waiting = game.total < 3 ? 'Estamos reuniendo al grupo. Se necesitan al menos 3 participantes.'
    : game.ready < game.total ? `Estamos preparando la sorpresa: ${game.ready} de ${game.total} participantes están listos.`
    : 'Todo el grupo está listo. Esperando a que el organizador inicie el sorteo.';
  root.innerHTML = `<section class="center-page"><div class="eyebrow">TU AMIGO SECRETO</div><h1>Hola, ${escapeHtml(user.name.split(' ')[0])}.</h1><p>${recipient ? 'Ya tienes a quién sacarle una sonrisa.' : 'Una pequeña sorpresa.<br>Una persona muy especial.'}</p><div id="secret-surface">${recipient ? recipientCard(recipient) : `<div class="secret-card"><span class="card-caption">HAY UN NOMBRE ESPERÁNDOTE</span><span class="mystery-symbol" aria-hidden="true">?</span><p>Cuando lo descubras, será tu amigo secreto.<br>Tu resultado se mantiene durante este sorteo.</p><button id="reveal" class="primary" ${drawn ? '' : 'disabled'}>Descubrir mi amigo secreto <span>✳</span></button></div>`}</div>${!drawn && !recipient ? `<div class="notice">${waiting}<br><button class="quiet" id="check-ready">Actualizar estado ↻</button></div>` : ''}<p class="error" id="game-error" role="alert"></p><p class="privacy-note">${recipient ? 'Tu resultado corresponde al sorteo actual.' : 'Tu resultado es privado y cifrado. Ni el organizador puede verlo.'}</p><button class="quiet" id="change-password">Cambiar mi contraseña</button></section>`;
  document.querySelector('#reveal')?.addEventListener('click', () => reveal().catch(() => {}));
  document.querySelector('#check-ready')?.addEventListener('click', () => refresh().catch(showPageError));
  document.querySelector('#change-password').onclick = () => renderPassword(true);
  const update = document.createElement('button');
  update.type = 'button'; update.className = 'quiet'; update.textContent = 'Actualizar sorteo ↻';
  update.onclick = () => refresh().catch(showPageError);
  document.querySelector('#change-password').before(update);
  addPreferencesEntry(document.querySelector('#change-password'));
}
function addPreferencesEntry(before) {
  const section = document.createElement('section');
  section.className = 'preferences-entry';
  section.innerHTML = `<h2>Dulces y regalos</h2><p>Cuéntale al grupo qué te gusta y encuentra ideas para sorprender.</p><button type="button" class="primary" id="open-preferences"><span aria-hidden="true">▦</span> Ver tabla de preferencias</button>`;
  before.before(section);
  section.querySelector('button').onclick = async event => {
    const button = event.currentTarget;
    if (revealing) return;
    button.disabled = true;
    try { const result = await api('/preferences'); if (section.isConnected && !revealing) renderPreferences(result.participants); }
    catch (error) { showPageError(error); }
    finally { button.disabled = false; }
  };
}
function renderPreferences(participants) {
  const own = participants.find(person => person.id === state.user.id);
  const group = (key, title) => `<fieldset><legend>${title}</legend><div id="${key}-inputs"></div><button type="button" class="quiet" data-add="${key}">+ Agregar ${key === 'sweets' ? 'dulce' : 'regalo'}</button></fieldset>`;
  root.innerHTML = `<section class="admin-page preferences-page"><button type="button" class="quiet" id="preferences-back">← Volver al ${state.user.role === 'admin' ? 'panel' : 'juego'}</button><div class="eyebrow">IDEAS PARA SORPRENDER</div><h1>Dulces y regalos</h1><p>Estas preferencias las pueden consultar todos los participantes y el organizador.</p>${own ? `<form id="preferences-form" class="preferences-editor"><h2>Mis preferencias</h2><p class="hint">Agrega hasta 10 dulces y 10 regalos. Máximo 120 caracteres por opción. Puedes cambiarlos incluso después del sorteo.</p><div class="preferences-fields">${group('sweets', 'Dulces que me gustan')}${group('gifts', 'Regalos que me gustaría recibir')}</div><p class="error" role="alert"></p><p id="preferences-saved" role="status"></p><button type="submit" class="primary">Guardar mis preferencias</button></form>` : ''}<div class="preferences-table-heading"><h2>Preferencias del grupo</h2><button type="button" class="quiet" id="refresh-preferences">Actualizar tabla ↻</button></div><p class="error" id="preferences-error" role="alert"></p><div class="table-wrap" tabindex="0" role="region" aria-label="Preferencias de todos los participantes"><table class="preferences-table"><caption>Dulces y regalos de cada participante</caption><thead><tr><th scope="col">Participante</th><th scope="col">Dulces preferidos</th><th scope="col">Regalos deseados</th></tr></thead><tbody id="preferences-rows"></tbody></table></div></section>`;
  const page = root.firstElementChild;
  const rows = page.querySelector('#preferences-rows');
  const renderRows = () => {
    const cell = values => values.length ? `<ul>${values.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul>` : '<span class="hint">Sin preferencias todavía</span>';
    rows.innerHTML = participants.map(person => `<tr${person.id === state.user.id ? ' class="own-preferences"' : ''}><th scope="row">${escapeHtml(person.name)}${person.id === state.user.id ? ' (tú)' : ''}<small>@${escapeHtml(person.username)}</small></th><td>${cell(person.sweets)}</td><td>${cell(person.gifts)}</td></tr>`).join('') || '<tr><td colspan="3">Todavía no hay participantes.</td></tr>';
  };
  renderRows();
  page.querySelector('#preferences-back').onclick = () => refresh().catch(showPageError);
  page.querySelector('#refresh-preferences').onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    page.querySelector('#preferences-error').textContent = '';
    try { const result = await api('/preferences'); if (page.isConnected) { participants = result.participants; renderRows(); } }
    catch (error) { if (page.isConnected) showPageError(error); }
    finally { button.disabled = false; }
  };
  if (!own) return;
  const form = page.querySelector('#preferences-form');
  const saved = form.querySelector('#preferences-saved');
  function addInput(key, value = '', focus = false) {
    const container = form.querySelector(`#${key}-inputs`);
    const add = form.querySelector(`[data-add="${key}"]`);
    if (container.children.length >= 10) return;
    const row = document.createElement('div');
    row.className = 'preference-input';
    row.innerHTML = `<label>${key === 'sweets' ? 'Dulce' : 'Regalo'}<input name="${key}" maxlength="120" placeholder="${key === 'sweets' ? 'Ej. Chocolatina' : 'Ej. Carro de control remoto'}"></label><button type="button" class="row-action danger" aria-label="Quitar ${key === 'sweets' ? 'dulce' : 'regalo'}">Quitar</button>`;
    row.querySelector('input').value = value;
    row.querySelector('button').onclick = () => { row.remove(); add.disabled = false; saved.textContent = ''; add.focus(); };
    container.append(row);
    add.disabled = container.children.length >= 10;
    if (focus) row.querySelector('input').focus();
  }
  for (const key of ['sweets', 'gifts']) {
    (own[key].length ? own[key] : ['']).forEach(value => addInput(key, value));
    form.querySelector(`[data-add="${key}"]`).onclick = () => { addInput(key, '', true); saved.textContent = ''; };
  }
  form.oninput = () => { saved.textContent = ''; };
  form.onsubmit = event => {
    event.preventDefault();
    busy(form, async () => {
      saved.textContent = '';
      const data = Object.fromEntries(['sweets', 'gifts'].map(key => [key, [...form.querySelectorAll(`input[name="${key}"]`)].map(input => input.value.trim()).filter(Boolean)]));
      const controls = [...form.querySelectorAll('input, button')];
      const disabled = controls.map(control => control.disabled);
      controls.forEach(control => { control.disabled = true; });
      try {
        const result = await api('/preferences', 'PUT', data);
        if (!page.isConnected) return;
        Object.assign(participants.find(person => person.id === state.user.id), result);
        renderRows();
        saved.textContent = 'Preferencias guardadas. Ya aparecen en la tabla del grupo.';
      } finally { controls.forEach((control, index) => { control.disabled = disabled[index]; }); }
    });
  };
}
function recipientCard(name) { return `<div class="secret-card reveal-card"><span class="card-caption">TU AMIGO SECRETO ES</span><div><span class="success-seal" aria-hidden="true">✳</span></div><h2>${escapeHtml(name)}</h2><p>Ahora viene lo mejor: pensar en su regalo.<br>Guarda el secreto hasta el gran día.</p></div>`; }
async function reveal() {
  if (revealing || !state || state.user.role !== 'participant') return;
  revealing = true;
  const button = document.querySelector('#reveal');
  if (button) button.disabled = true;
  document.querySelector('#game-error').textContent = '';
  try {
    const result = await api('/reveal', 'POST', {});
    const surface = document.querySelector('#secret-surface');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    surface.innerHTML = '<div class="secret-card"><span class="card-caption">LA SORPRESA ESTÁ POR LLEGAR</span><div class="roulette" aria-hidden="true">• • •</div><p role="status">Preparando tu sorpresa…</p></div>';
    logout.disabled = true;
    document.querySelector('#change-password').disabled = true;
    if (!reduced) {
      const interval = setInterval(() => { const node = document.querySelector('.roulette'); if (node) node.textContent = Array.from(crypto.getRandomValues(new Uint8Array(3)), n => n % 10).join(' '); }, 75);
      await new Promise(resolve => setTimeout(resolve, 2300)); clearInterval(interval);
    }
    state.recipient = result.recipient; state.game.locked = true;
    renderGame();
    if (!reduced) celebrate();
    return { recipient: result.recipient };
  } catch (error) { const node = document.querySelector('#game-error'); if (node) node.textContent = error.message; if (button) button.disabled = false; throw error; }
  finally { revealing = false; logout.disabled = false; }
}
function celebrate() {
  const card = document.querySelector('.reveal-card');
  for (let i = 0; i < 36; i++) { const piece = document.createElement('i'); piece.className = 'confetti'; piece.style.left = `${Math.random() * 100}%`; piece.style.animationDelay = `${Math.random() * .8}s`; piece.setAttribute('aria-hidden', 'true'); card.append(piece); }
  setTimeout(() => document.querySelectorAll('.confetti').forEach(node => node.remove()), 4200);
}
function renderAdmin() {
  const locked = state.game.locked;
  const missing = users.length - state.game.ready;
  const canDraw = !locked && users.length >= 3 && missing === 0;
  const drawText = users.length < 3 ? 'Se necesitan al menos 3 participantes para sortear.'
    : missing ? `${missing === 1 ? 'Falta 1 persona' : `Faltan ${missing} personas`} por estar lista${missing === 1 ? '' : 's'}: cada una debe cambiar su contraseña inicial${users.some(u => u.relogin) ? ' o volver a iniciar sesión' : ''}.`
    : 'Todo el grupo está listo. Al iniciar el sorteo la lista se cierra y cada persona podrá descubrir su amigo secreto.';
  const status = u => u.pending ? 'Contraseña inicial' : u.relogin ? 'Debe volver a entrar' : 'Lista para jugar';
  root.innerHTML = `<section class="admin-page"><div class="eyebrow">PANEL DEL ORGANIZADOR</div><div class="admin-heading"><div><h1>La sorpresa empieza aquí.</h1><p>Reúne al grupo. Nosotros guardamos el secreto.</p></div><button id="add-user" class="primary" ${locked ? 'disabled' : ''}>Añadir participante <span>+</span></button></div><div class="admin-stats"><div class="stat"><span>Participantes</span><strong>${users.length}</strong></div><div class="stat"><span>Cuentas listas</span><strong>${state.game.ready} / ${users.length}</strong></div><div class="stat"><span>Sorteo</span><strong>${locked ? 'Hecho' : 'Pendiente'}</strong></div></div>${locked ? '<div class="notice">El sorteo ya se hizo. Las asignaciones quedaron fijas y cifradas: ni este panel ni la base de datos muestran quién le tocó a quién.</div>' : `<div class="notice draw-box"><span>${drawText}</span><button id="start-draw" class="primary" ${canDraw ? '' : 'disabled'}>Iniciar sorteo <span>✳</span></button></div>`}<p class="error" id="admin-error" role="alert"></p><div class="table-wrap"><table><thead><tr><th>Participante</th><th>Usuario</th><th>Cuenta</th><th>Acciones</th></tr></thead><tbody>${users.map(u => `<tr><td><span class="person-name"><span class="avatar">${escapeHtml(u.name.slice(0, 2).toUpperCase())}</span>${escapeHtml(u.name)}</span></td><td>${escapeHtml(u.username)}</td><td><span class="status-pill ${u.pending || u.relogin ? 'pending' : ''}">${status(u)}</span></td><td>${locked ? '<span class="hint">Lista cerrada</span>' : `<button class="row-action" data-edit="${u.id}">Editar</button><button class="row-action danger" data-delete="${u.id}">Quitar</button>`}</td></tr>`).join('')}</tbody></table>${users.length ? '' : '<div class="empty">Todavía no hay participantes. Añade al primero.</div>'}</div><div class="admin-bottom"><span class="hint">El administrador organiza; los participantes descubren.</span><button class="quiet" id="refresh-users">Actualizar lista ↻</button><button class="quiet" id="admin-password">Cambiar mi contraseña</button></div></section>`;
  document.querySelector('#start-draw')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    if (!confirm('¿Iniciar el sorteo ahora?\n\nLa lista se cerrará y los participantes podrán consultar su resultado. Para cambiar participantes después, tendrás que archivar este sorteo y reabrir la lista.')) return;
    button.disabled = true; button.firstChild.textContent = 'Sorteando… ';
    try { await api('/admin/draw', 'POST', {}); await refresh(); } catch (e) { showPageError(e); button.disabled = false; button.firstChild.textContent = 'Iniciar sorteo '; }
  });
  document.querySelector('#add-user').onclick = () => openAccount();
  document.querySelectorAll('[data-edit]').forEach(button => button.onclick = () => openAccount(users.find(u => u.id === button.dataset.edit)));
  document.querySelectorAll('[data-delete]').forEach(button => button.onclick = async () => {
    const user = users.find(u => u.id === button.dataset.delete);
    if (!confirm(`¿Quitar a ${user.name} del grupo? Su cuenta se eliminará.`)) return;
    button.disabled = true;
    try { await api(`/admin/users/${user.id}`, 'DELETE', {}); await refresh(); } catch (e) { showPageError(e); button.disabled = false; }
  });
  document.querySelector('#refresh-users').onclick = () => refresh().catch(showPageError);
  document.querySelector('#admin-password').onclick = () => renderPassword(true);
  if (locked) {
    const notice = document.querySelector('.admin-page > .notice');
    notice.classList.add('draw-box');
    notice.innerHTML = `<span>Sorteo ${state.game.round} en curso. Puedes archivarlo para editar la lista y preparar uno nuevo. Las preferencias y el historial se conservan.</span><button type="button" class="primary" id="reopen-draw">Reabrir sorteo</button>`;
    notice.querySelector('button').onclick = async event => {
      if (!confirm('¿Archivar el sorteo actual y reabrir la lista?\n\nLos resultados actuales dejarán de estar vigentes. Se conservarán en el historial cifrado, junto con los participantes y sus preferencias.\n\nPodrás agregar, quitar o restablecer cuentas. El nuevo sorteo NO se hará hasta que pulses «Iniciar sorteo».')) return;
      const button = event.currentTarget;
      button.disabled = true;
      try { await api('/admin/reopen', 'POST', { round: state.game.round }); await refresh(); }
      catch (error) { showPageError(error); button.disabled = false; }
    };
  }
  const history = document.createElement('section');
  history.className = 'notice';
  history.innerHTML = '<h2>Historial de sorteos</h2><button type="button" class="quiet">Consultar historial</button><div class="history-content"></div>';
  document.querySelector('.admin-bottom').before(history);
  history.querySelector('button').onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const { rounds } = await api('/admin/draw-history');
      history.querySelector('.history-content').innerHTML = rounds.length ? `<ul>${rounds.map(round => `<li>Sorteo ${round.round} · ${round.total} participantes · archivado el ${escapeHtml(new Date(round.archived_at).toLocaleString('es-CO'))}</li>`).join('')}</ul><p class="hint">Los resultados se conservan cifrados. El organizador no puede consultar las parejas.</p>` : '<p>No hay sorteos archivados.</p>';
    } catch (error) { showPageError(error); }
    finally { button.disabled = false; }
  };
  addPreferencesEntry(document.querySelector('.admin-bottom'));
}
function openAccount(user) {
  const form = document.querySelector('#account-form'); form.reset();
  form.elements.id.value = user?.id || ''; form.elements.name.value = user?.name || ''; form.elements.username.value = user?.username || '';
  form.elements.password.required = !user;
  document.querySelector('#dialog-title').textContent = user ? 'Editar participante' : 'Nuevo participante';
  document.querySelector('#password-label').textContent = user ? 'Nueva contraseña inicial (opcional)' : 'Contraseña inicial';
  document.querySelector('#account-hint').textContent = user ? 'Déjala vacía para conservar la contraseña. Una nueva contraseña exige que la persona vuelva a cambiarla.' : 'Mínimo 12 caracteres. Entrégala de forma privada.';
  document.querySelector('#dialog-error').textContent = '';
  document.querySelector('#account-dialog').showModal();
}
document.querySelector('#close-dialog').onclick = () => document.querySelector('#account-dialog').close();
document.querySelector('#account-form').onsubmit = event => {
  event.preventDefault(); const form = event.currentTarget;
  busy(form, async () => {
    const data = Object.fromEntries(new FormData(form)); const id = data.id; delete data.id;
    await api(`/admin/users${id ? `/${id}` : ''}`, id ? 'PATCH' : 'POST', data);
    document.querySelector('#account-dialog').close(); form.reset(); await refresh();
  });
};
function showPageError(error) { const target = document.querySelector('#admin-error, #game-error, #preferences-error'); if (target) target.textContent = error.message; }
logout.onclick = async () => { logout.disabled = true; try { await api('/logout', 'POST', {}); state = null; renderLogin(); } catch (e) { showPageError(e); } finally { logout.disabled = false; } };
try { await refresh(); } catch (e) { renderLogin(); if (!e.message.includes('Inicia sesión') && !e.message.includes('sesión terminó')) document.querySelector('.error').textContent = e.message; }
if (document.modelContext?.registerTool) {
  Promise.resolve(document.modelContext.registerTool({ name: 'reveal_my_secret_friend', title: 'Descubrir mi amigo secreto', description: 'Revela el amigo secreto del participante autenticado, una vez que el organizador inició el sorteo. El resultado se mantiene durante el sorteo actual.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false }, async execute(input) {
    if (!input || Object.keys(input).length) throw new Error('No se admiten parámetros.');
    if (!state || state.user.role !== 'participant' || state.user.mustChangePassword) throw new Error('Inicia sesión como participante y cambia tu contraseña inicial.');
    if (revealing) throw new Error('La revelación está en curso.');
    await refresh();
    if (state.recipient) return { recipient: state.recipient };
    return reveal();
  } })).catch(() => {});
}
