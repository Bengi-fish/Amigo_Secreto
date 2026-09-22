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
  const ready = game.total >= 3 && game.ready === game.total;
  root.innerHTML = `<section class="center-page"><div class="eyebrow">TU AMIGO SECRETO</div><h1>Hola, ${escapeHtml(user.name.split(' ')[0])}.</h1><p>${recipient ? 'Ya tienes a quién sacarle una sonrisa.' : 'Una pequeña sorpresa.<br>Una persona muy especial.'}</p><div id="secret-surface">${recipient ? recipientCard(recipient) : `<div class="secret-card"><span class="card-caption">HAY UN NOMBRE ESPERÁNDOTE</span><span class="mystery-symbol" aria-hidden="true">?</span><p>Cuando lo descubras, será tu amigo secreto.<br>Un solo sorteo. La misma persona, siempre.</p><button id="reveal" class="primary" ${ready ? '' : 'disabled'}>Descubrir mi amigo secreto <span>✳</span></button></div>`}</div>${!ready && !recipient ? `<div class="notice">${game.total < 3 ? 'Estamos reuniendo al grupo. Se necesitan al menos 3 participantes.' : `Estamos preparando la sorpresa: ${game.ready} de ${game.total} participantes ya cambiaron su contraseña.`}<br><button class="quiet" id="check-ready">Actualizar estado ↻</button></div>` : ''}<p class="error" id="game-error" role="alert"></p><p class="privacy-note">${recipient ? 'Puedes volver cuando quieras. Tu amigo secreto seguirá aquí.' : 'Tu resultado es privado. El panel del organizador no puede verlo.'}</p><button class="quiet" id="change-password">Cambiar mi contraseña</button></section>`;
  document.querySelector('#reveal')?.addEventListener('click', () => reveal().catch(() => {}));
  document.querySelector('#check-ready')?.addEventListener('click', () => refresh().catch(showPageError));
  document.querySelector('#change-password').onclick = () => renderPassword(true);
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
  root.innerHTML = `<section class="admin-page"><div class="eyebrow">PANEL DEL ORGANIZADOR</div><div class="admin-heading"><div><h1>La sorpresa empieza aquí.</h1><p>Reúne al grupo. Nosotros guardamos el secreto.</p></div><button id="add-user" class="primary" ${locked ? 'disabled' : ''}>Añadir participante <span>+</span></button></div><div class="admin-stats"><div class="stat"><span>Participantes</span><strong>${users.length}</strong></div><div class="stat"><span>Cuentas listas</span><strong>${state.game.ready} / ${users.length}</strong></div><div class="stat"><span>Sorteo</span><strong>${locked ? 'Cerrado' : 'Pendiente'}</strong></div></div><div class="notice">${locked ? 'El primer secreto ya se reveló. Las cuentas y asignaciones quedaron fijas. Este panel nunca muestra quién le tocó a quién.' : 'Añade a todos antes de empezar. Cada persona debe cambiar su contraseña inicial. Al descubrir el primer amigo secreto, la lista se cierra y las asignaciones quedan fijas.'}</div><p class="error" id="admin-error" role="alert"></p><div class="table-wrap"><table><thead><tr><th>Participante</th><th>Usuario</th><th>Cuenta</th><th>Acciones</th></tr></thead><tbody>${users.map(u => `<tr><td><span class="person-name"><span class="avatar">${escapeHtml(u.name.slice(0, 2).toUpperCase())}</span>${escapeHtml(u.name)}</span></td><td>${escapeHtml(u.username)}</td><td><span class="status-pill ${u.pending ? 'pending' : ''}">${u.pending ? 'Contraseña inicial' : 'Lista para jugar'}</span></td><td>${locked ? '<span class="hint">Lista cerrada</span>' : `<button class="row-action" data-edit="${u.id}">Editar</button><button class="row-action danger" data-delete="${u.id}">Quitar</button>`}</td></tr>`).join('')}</tbody></table>${users.length ? '' : '<div class="empty">Todavía no hay participantes. Añade al primero.</div>'}</div><div class="admin-bottom"><span class="hint">El administrador organiza; los participantes descubren.</span><button class="quiet" id="refresh-users">Actualizar lista ↻</button><button class="quiet" id="admin-password">Cambiar mi contraseña</button></div></section>`;
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
function showPageError(error) { const target = document.querySelector('#admin-error, #game-error'); if (target) target.textContent = error.message; }
logout.onclick = async () => { logout.disabled = true; try { await api('/logout', 'POST', {}); state = null; renderLogin(); } catch (e) { showPageError(e); } finally { logout.disabled = false; } };
try { await refresh(); } catch (e) { renderLogin(); if (!e.message.includes('Inicia sesión') && !e.message.includes('sesión terminó')) document.querySelector('.error').textContent = e.message; }
if (document.modelContext?.registerTool) {
  Promise.resolve(document.modelContext.registerTool({ name: 'reveal_my_secret_friend', title: 'Descubrir mi amigo secreto', description: 'Revela permanentemente el amigo secreto del participante autenticado. El primer sorteo cierra la lista para todos.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false }, async execute(input) {
    if (!input || Object.keys(input).length) throw new Error('No se admiten parámetros.');
    if (!state || state.user.role !== 'participant' || state.user.mustChangePassword) throw new Error('Inicia sesión como participante y cambia tu contraseña inicial.');
    if (state.recipient) return { recipient: state.recipient };
    if (revealing) throw new Error('La revelación está en curso.');
    return reveal();
  } })).catch(() => {});
}
