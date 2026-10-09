'use strict';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const STORAGE = 'moonlit-werewolf-room-v1';
const roles = {
  villager: {name: 'Villager', icon: '🏡', desc: 'Find the werewolves by talking, questioning and voting.', short: 'Talk & vote', flavour: 'Your only weapon is your instinct.'},
  doctor: {name: 'Doctor', icon: '🩺', desc: 'At night, secretly choose one person to protect from the werewolves.', short: 'Protect someone', flavour: 'One life might depend on you.'},
  seer: {name: 'Seer', icon: '🔮', desc: 'At night, secretly investigate one player to learn if they are a werewolf.', short: 'Investigate someone', flavour: 'See what others cannot.'},
  werewolf: {name: 'Werewolf', icon: '🐺', desc: 'At night, work with any other werewolves to choose a victim. By day, blend in.', short: 'Hunt in secret', flavour: 'Keep your true identity hidden.'},
};
const keys = ['villager', 'doctor', 'seer', 'werewolf'];
let session = null;
let game = null;
let currentScreen = 'home';
let revealed = false;
let knownRound = 0;
let inFlight = false;
let toastTimeout;
let pollTimer = null;
const invitedCode = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

function escapeHTML(v) { return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c])); }
function shareLink() { return `${location.origin}/?room=${encodeURIComponent(game.code)}`; }
function totalRoles() { return keys.reduce((n, key) => n + game.counts[key], 0); }
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toastEl.classList.remove('show'), 3100);
}
async function request(url, data, method = 'POST') {
  const options = method === 'GET' ? { method } : {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Something went wrong.');
  return result;
}
async function sessionPost(endpoint, extra = {}) {
  if (!session) throw new Error('Join a room first.');
  return request(`/api/${endpoint}`, { code: session.code, token: session.token, ...extra });
}
function saveSession(code, token) {
  session = {code, token};
  localStorage.setItem(STORAGE, JSON.stringify(session));
  history.replaceState(null, '', `/?room=${encodeURIComponent(code)}`);
}
function clearSession() {
  session = null;
  game = null;
  revealed = false;
  localStorage.removeItem(STORAGE);
  history.replaceState(null, '', location.pathname);
  stopPolling();
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    if (!session || document.hidden || inFlight) return;
    try {
      const latest = await request(`/api/state?code=${encodeURIComponent(session.code)}&token=${encodeURIComponent(session.token)}`, null, 'GET');
      useGame(latest);
    } catch (error) {
      if (/not in this room|Room not found/.test(error.message)) {
        const code = session.code;
        clearSession();
        currentScreen = 'join';
        render();
        const field = document.getElementById('code');
        if (field) field.value = code;
        toast('Room closed or you were removed.');
      }
    }
  }, 2000);
}
function useGame(newState) {
  if (knownRound !== newState.round || (game && game.phase !== newState.phase)) revealed = false;
  knownRound = newState.round;
  game = newState;
  render();
}
function landing() {
  return `
    <div class="eyebrow">THE NIGHT IS YOUNG</div>
    <h1>Trust no one.<br>Know your role.</h1>
    <p class="intro">The easiest way to deal Werewolf roles. Invite your mates, choose the characters and reveal your secret card on your own phone.</p>
    <div class="choice">
      <button class="choice-card" data-action="show-create"><span class="choice-icon">✦</span><span><strong>Create a room</strong><small>Set up the game and invite your friends</small></span><span class="choice-arrow">→</span></button>
      <button class="choice-card" data-action="show-join"><span class="choice-icon">↗</span><span><strong>Join a room</strong><small>Use a link or 6-character room code</small></span><span class="choice-arrow">→</span></button>
    </div>
    <p class="hint center">No accounts. No downloads. Everyone gets one secret card.</p>`;
}
function entryForm() {
  const create = currentScreen === 'create';
  return `
    <button class="back" data-action="show-home">← Back</button>
    <div class="eyebrow">${create ? 'MAKE YOUR LOBBY' : 'ENTER THE VILLAGE'}</div>
    <h1>${create ? 'Gather your pack.' : 'You’re invited.'}</h1>
    <p class="intro">${create ? 'You’ll be the host and a player too. Change the role counts whenever you like before dealing.' : 'Enter your details. Your role stays hidden from everyone else.'}</p>
    <section class="panel">
      <form id="${create ? 'create-form' : 'join-form'}">
        <div class="field"><label for="name" class="form-label">Your name</label><input id="name" name="name" type="text" placeholder="e.g. Liam" maxlength="24" autocomplete="nickname" required autofocus></div>
        ${create ? '' : `<div class="field"><label for="code" class="form-label">Room code</label><input id="code" name="code" type="text" placeholder="e.g. WOLF42" value="${escapeHTML(invitedCode)}" maxlength="6" autocapitalize="characters" autocomplete="off" spellcheck="false" required></div>`}
        <button class="btn btn-primary btn-full" type="submit" ${inFlight ? 'disabled' : ''}>${create ? 'Create room →' : 'Join game →'}</button>
      </form>
    </section>`;
}
function playerCards() {
  return `<div class="player-grid">${game.players.map(p => {
    const canRemove = game.you.isHost && game.phase === 'lobby' && p.id !== game.you.id;
    return `<div class="player"><span class="player-avatar">${escapeHTML(p.name.charAt(0).toUpperCase())}</span><strong title="${escapeHTML(p.name)}">${escapeHTML(p.name)}</strong>${p.isHost ? '<span class="host-crown" title="Host">♛</span>' : ''}${canRemove ? `<button class="remove" data-action="kick" data-player-id="${escapeHTML(p.id)}" aria-label="Remove ${escapeHTML(p.name)}" title="Remove player">×</button>` : ''}</div>`;
  }).join('')}</div>`;
}
function roleEditor() {
  return `<section class="panel">
    <div class="panel-heading"><h3>Choose your roles</h3><span class="pill">HOST CONTROL</span></div>
    ${keys.map(key => {
      const info = roles[key];
      return `<div class="role-row">
        <div class="role-left"><span class="role-em">${info.icon}</span><span><span class="role-label">${info.name}${key === 'werewolf' ? 's' : key === 'villager' ? 's' : ''}</span><span class="role-desc">${info.short}</span></span></div>
        <div class="stepper"><button class="step" data-action="decrement" data-role="${key}" aria-label="Remove ${info.name}" ${game.counts[key] <= 0 || inFlight ? 'disabled' : ''}>−</button><span class="stepper-value">${game.counts[key]}</span><button class="step" data-action="increment" data-role="${key}" aria-label="Add ${info.name}" ${totalRoles() >= game.maxPlayers || inFlight ? 'disabled' : ''}>+</button></div>
      </div>`;
    }).join('')}
    <div class="count-summary"><span>Total roles set</span><span class="count-number">${totalRoles()} / ${game.players.length} players joined</span></div>
  </section>`;
}
function invitePanel() {
  return `<section class="panel">
    <div class="panel-heading"><h3>Invite your friends</h3><span class="pill"><span class="pulse"></span> LOBBY OPEN</span></div>
    <div class="code-wrap"><div><div class="room-code">${game.code}</div><div class="hint">Your room code</div></div><button class="btn btn-outline btn-small" data-action="copy">Copy link ↗</button></div>
    <div class="share-url">${escapeHTML(shareLink())}</div>
    <div class="actions"><button class="btn btn-quiet btn-small" data-action="share">Share invite</button><button class="btn btn-quiet btn-small" data-action="copy-code">Copy code</button></div>
  </section>`;
}
function lobby() {
  const isHost = game.you.isHost;
  const correct = totalRoles() === game.players.length;
  const enough = game.players.length >= 3;
  const teams = game.counts.werewolf > 0 && game.counts.villager + game.counts.doctor + game.counts.seer > 0;
  const canStart = correct && enough && teams && !inFlight;
  let issue = !enough ? 'At least 3 players need to join.' : !correct ? `You have ${game.players.length} players but ${totalRoles()} roles. Match these before dealing.` : !teams ? 'Include at least one werewolf and one good player.' : 'Ready to deal! Everyone gets one random, secret role.';
  return `
    <div class="room-header"><div><div class="eyebrow">${isHost ? 'YOUR LOBBY' : 'WAITING FOR THE HOST'}</div><h1>The village</h1><div class="room-meta">Room ${game.code} · ${game.players.length} player${game.players.length !== 1 ? 's' : ''} here</div></div><span class="pill">${isHost ? '♛ HOST' : 'PLAYER'}</span></div>
    ${invitePanel()}
    <section class="panel"><div class="panel-heading"><h3>Players joined</h3><span class="pill">${game.players.length} HERE</span></div>${playerCards()}</section>
    ${isHost ? roleEditor() : `<section class="panel"><h3>Tonight’s roles</h3><div class="hint">The host is choosing roles for ${totalRoles()} players.</div><div class="rule"></div>${keys.filter(key => game.counts[key] > 0).map(key => `<div class="role-row"><div class="role-left"><span class="role-em">${roles[key].icon}</span><span class="role-label">${roles[key].name}${game.counts[key] > 1 ? 's' : ''}</span></div><strong>${game.counts[key]}</strong></div>`).join('')}</section>`}
    <div class="notice ${canStart || !isHost ? 'good' : ''}">${isHost ? issue : 'Keep this page open. Your role appears automatically when the host deals the cards.'}</div>
    ${isHost ? `<button class="btn btn-primary btn-full" data-action="start" ${!canStart ? 'disabled' : ''}>Deal secret roles ↗</button>` : '<div class="hint center"><span class="pulse"></span> Waiting for host to start…</div>'}
    <div class="actions"><button class="btn btn-quiet btn-small" data-action="leave">${isHost ? 'Close room' : 'Leave room'}</button></div>`;
}
function gameStarted() {
  const role = roles[game.you.role];
  const card = revealed ? `
    <div class="role-card revealed ${game.you.role}">
      <div class="tag">YOUR SECRET ROLE</div><div class="symbol">${role.icon}</div><h2>${role.name}</h2><p>${role.desc}</p><div class="hint role-flavour">${role.flavour}</div>
      <button class="btn btn-outline" data-action="conceal">Hide role 👁</button>
    </div>` : `
    <div class="role-card"><div class="tag">TOP SECRET · ONLY FOR YOU</div><div class="concealed">✦</div><div class="hidden-name">Your role awaits</div><p>Make sure nobody is looking at your screen.</p><button class="btn btn-primary" data-action="reveal">Tap to reveal your role</button></div>`;
  return `<div class="room-header"><div><div class="eyebrow">ROUND ${game.round} · GAME STARTED</div><h1>Night falls.</h1><div class="room-meta">${escapeHTML(game.you.name)} · Room ${game.code}</div></div><span class="pill">${game.you.isHost ? '♛ HOST' : 'PLAYER'}</span></div>
    ${card}
    <section class="panel spaced-panel"><div class="panel-heading"><h3>How to play</h3><span class="pill">QUICK GUIDE</span></div>
      <ol class="instructions"><li>Everyone secretly checks their role.</li><li>One person narrates the night: <strong>Werewolves</strong> choose a target; <strong>Doctor</strong> protects; <strong>Seer</strong> investigates.</li><li>In the morning, everyone discusses and votes on who is suspicious.</li><li>Repeat until all werewolves are out, or the werewolves match/outnumber the others.</li></ol>
      <p class="hint">This app deals roles; the group still runs the night and voting together.</p>
    </section>
    ${game.you.isHost ? '<div class="notice">Starting a new round hides everyone’s cards and lets you change the roles. All players stay in the room.</div><button class="btn btn-primary btn-full" data-action="reset">Set up next round ↻</button>' : '<p class="hint center">Keep your role secret. Trust no one.</p>'}
    <div class="actions"><button class="btn btn-quiet btn-small" data-action="leave">${game.you.isHost ? 'Close room' : 'Leave room'}</button></div>`;
}
function render() {
  if (!session || !game) {
    app.innerHTML = currentScreen === 'home' ? landing() : entryForm();
    return;
  }
  app.innerHTML = game.phase === 'lobby' ? lobby() : gameStarted();
}
async function guarded(fn) {
  if (inFlight) return;
  inFlight = true;
  try { await fn(); }
  catch (error) { toast(error.message); }
  finally { inFlight = false; render(); }
}

app.addEventListener('submit', event => {
  const form = event.target.closest('form');
  if (!form) return;
  event.preventDefault();
  const name = form.querySelector('#name').value.trim();
  guarded(async () => {
    const creating = form.id === 'create-form';
    const codeField = form.querySelector('#code');
    const code = codeField ? codeField.value.trim().toUpperCase() : '';
    const result = await request(creating ? '/api/create' : '/api/join', creating ? {name} : {name, code});
    saveSession(result.code, result.token);
    useGame(result.state);
    startPolling();
    toast(creating ? 'Room created! Invite your mates.' : 'You’re in!');
  });
});

app.addEventListener('click', event => {
  const btn = event.target.closest('[data-action]');
  if (!btn || btn.disabled) return;
  const action = btn.dataset.action;
  if (action.startsWith('show-')) {
    currentScreen = action.substring(5);
    render();
    return;
  }
  if (action === 'reveal' || action === 'conceal') {
    revealed = action === 'reveal';
    render();
    return;
  }
  if (action === 'copy' || action === 'copy-code') {
    const value = action === 'copy' ? shareLink() : game.code;
    (async () => {
      try { await navigator.clipboard.writeText(value); toast(action === 'copy' ? 'Invite link copied!' : 'Room code copied!'); }
      catch { toast('Long-press the link or room code to copy it.'); }
    })();
    return;
  }
  if (action === 'share') {
    const url = shareLink();
    if (navigator.share) {
      navigator.share({title: 'Join my Werewolf game', text: `Join my Werewolf room ${game.code}!`, url}).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(() => toast('Invite link copied!')).catch(() => toast('Long-press the invite link to copy it.'));
    }
    return;
  }
  if (action === 'increment' || action === 'decrement') {
    const role = btn.dataset.role;
    if (!keys.includes(role)) return;
    const change = action === 'increment' ? 1 : -1;
    const counts = {...game.counts, [role]: game.counts[role] + change};
    guarded(async () => useGame(await sessionPost('config', {counts})));
    return;
  }
  if (action === 'kick') {
    const player = game.players.find(p => p.id === btn.dataset.playerId);
    if (!player || !confirm(`Remove ${player.name} from the room?`)) return;
    guarded(async () => useGame(await sessionPost('kick', {playerId: player.id})));
    return;
  }
  if (action === 'start') {
    guarded(async () => { useGame(await sessionPost('start')); toast('Roles dealt! Keep yours secret.'); });
    return;
  }
  if (action === 'reset') {
    if (!confirm('Set up a new round? Everyone’s current role will be cleared.')) return;
    guarded(async () => { useGame(await sessionPost('reset')); toast('New round ready!'); });
    return;
  }
  if (action === 'leave') {
    const isHost = game.you.isHost;
    if (!confirm(isHost ? 'Close this room for everyone?' : 'Leave this room?')) return;
    guarded(async () => {
      await sessionPost('leave');
      clearSession();
      currentScreen = 'home';
      render();
    });
  }
});

(async function initialise() {
  try {
    const previous = JSON.parse(localStorage.getItem(STORAGE) || 'null');
    if (previous && typeof previous.code === 'string' && typeof previous.token === 'string' && (!invitedCode || invitedCode === previous.code)) {
      session = previous;
      const state = await request(`/api/state?code=${encodeURIComponent(session.code)}&token=${encodeURIComponent(session.token)}`, null, 'GET');
      useGame(state);
      startPolling();
      return;
    }
  } catch { localStorage.removeItem(STORAGE); session = null; }
  currentScreen = invitedCode ? 'join' : 'home';
  render();
})();
