// The database setup screen (setup.html). Talks to main.js only through
// window.devoneSetup (setup-preload.js).
const $ = (id) => document.getElementById(id);
const form = $('form');
const status = $('status');
let firstRun = true;
let confirmKeyMismatch = false;

function mode() {
  return form.querySelector('input[name="mode"]:checked')?.value ?? 'builtin';
}

function input() {
  return {
    mode: mode(),
    host: $('host').value,
    port: $('port').value,
    database: $('database').value,
    user: $('user').value,
    password: $('password').value,
    ssl: $('ssl').value,
    encryptionKey: $('key').value,
    confirmKeyMismatch
  };
}

function showStatus(text, tone = '') {
  status.textContent = text;
  status.className = tone;
  if (text) status.scrollIntoView({ block: 'nearest' });
}

function render() {
  const external = mode() === 'external';
  $('external').hidden = !external;
  $('test').hidden = !external;
  $('save').textContent = firstRun ? 'Continue' : 'Save and restart';
}

function busy(value) {
  for (const id of ['test', 'save', 'cancel']) $(id).disabled = value;
}

/** Turns a connection test into a message, or null when there is nothing to warn about. */
function describe(result) {
  if (!result.ok) return [result.error, 'error'];
  const lines = [`Connected to PostgreSQL ${result.version}.`];
  if (result.keyMatches === false) {
    lines.push(
      "The encryption key doesn't match the one this database's tokens were saved with. Paste the key from the computer that set it up."
    );
    return [lines.join(' '), 'warn'];
  }
  lines.push(
    result.hasDevOne
      ? 'It already has DevOne data, which you will share.'
      : 'It is empty; DevOne will set it up.'
  );
  if (result.hasDevOne && result.keyMatches === null && !$('key').value.trim()) {
    lines.push('If someone else set it up, paste their encryption key below.');
  }
  return [lines.join(' '), 'ok'];
}

// Any edit takes back a "Save anyway" offered for the previous values.
function edited() {
  confirmKeyMismatch = false;
  render();
}
form.addEventListener('change', edited);
form.addEventListener('input', edited);

$('test').addEventListener('click', async () => {
  busy(true);
  showStatus('Connecting…');
  try {
    const result = await window.devoneSetup.test(input());
    const [text, tone] = describe(result);
    showStatus(text, tone);
  } finally {
    busy(false);
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  busy(true);
  showStatus(mode() === 'external' ? 'Connecting…' : 'Saving…');
  try {
    const result = await window.devoneSetup.save(input());
    if (result.ok) {
      showStatus(firstRun ? 'Starting DevOne…' : 'Restarting DevOne…', 'ok');
      return;
    }
    if (result.keyMismatch) {
      confirmKeyMismatch = true;
      showStatus(`${result.error}\nSelect "Save anyway" to use this key regardless.`, 'warn');
      $('save').textContent = 'Save anyway';
    } else {
      showStatus(result.error, 'error');
    }
  } finally {
    busy(false);
  }
});

$('cancel').addEventListener('click', () => window.devoneSetup.cancel());

$('copy-key').addEventListener('click', async () => {
  await window.devoneSetup.copyKey();
  $('copy-status').textContent = 'Copied. Keep it private: it unlocks saved tokens.';
});

(async () => {
  const state = await window.devoneSetup.load();
  firstRun = state.firstRun;
  if (!firstRun) {
    $('title').textContent = 'Database settings';
    $('cancel').textContent = 'Cancel';
  }
  if (state.reason) {
    $('reason').textContent = state.reason;
    $('reason').hidden = false;
  }
  const settings = state.settings ?? { mode: 'builtin' };
  form.querySelector(`input[name="mode"][value="${settings.mode}"]`).checked = true;
  if (settings.mode === 'external') {
    $('host').value = settings.host;
    $('port').value = settings.port;
    $('database').value = settings.database;
    $('user').value = settings.user;
    $('ssl').value = settings.ssl;
  }
  if (state.hasPassword) $('password').placeholder = 'Saved (leave empty to keep it)';
  render();
})();
