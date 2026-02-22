'use strict';

// ── State ────────────────────────────────────────────────────────────────────
let projects = [];
let isRunning = false;
const MAX_LOG_LINES = 500;

// ── DOM refs ─────────────────────────────────────────────────────────────────
const toggleBtn      = document.getElementById('toggle-btn');
const statusDot      = document.getElementById('status-dot');
const statusText     = document.getElementById('status-text');
const projectsTbody  = document.getElementById('projects-tbody');
const addRating      = document.getElementById('add-rating');
const addId          = document.getElementById('add-id');
const addNick        = document.getElementById('add-nick');
const addBtn         = document.getElementById('add-btn');
const sHeadless      = document.getElementById('s-headless');
const sTimeout       = document.getElementById('s-timeout');
const sTimeoutVote   = document.getElementById('s-timeout-vote');
const sDebug         = document.getElementById('s-debug');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const settingsSaved  = document.getElementById('settings-saved');
const logOutput      = document.getElementById('log-output');
const clearLogsBtn   = document.getElementById('clear-logs-btn');
const captchaOverlay = document.getElementById('captcha-overlay');
const captchaProject = document.getElementById('captcha-project');
const captchaResume  = document.getElementById('captcha-resume-btn');

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatNextVote(nextVoteTime) {
    if (!nextVoteTime || nextVoteTime <= Date.now()) {
        return { text: 'Ready now', cls: 'ready' };
    }
    const diff = nextVoteTime - Date.now();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const parts = [];
    if (h > 0) parts.push(`${h}h`);
    parts.push(`${m}m`);
    return { text: 'in ' + parts.join(' '), cls: 'waiting' };
}

function appendLog(entry) {
    const lines = logOutput.querySelectorAll('.log-entry');
    if (lines.length >= MAX_LOG_LINES) {
        lines[0].remove();
    }
    const div = document.createElement('div');
    div.className = `log-entry ${entry.level || 'info'}`;
    div.textContent = `[${entry.time}] ${entry.message}`;
    logOutput.appendChild(div);
    logOutput.scrollTop = logOutput.scrollHeight;
}

function setStatus(status) {
    statusDot.className = '';
    statusText.textContent = status;

    if (status === 'running' || status === 'voting') {
        statusDot.classList.add('running');
        isRunning = true;
        toggleBtn.textContent = 'Stop';
        toggleBtn.classList.add('stop');
        toggleBtn.disabled = false;
    } else if (status === 'waiting') {
        statusDot.classList.add('waiting');
        // still running
        isRunning = true;
        toggleBtn.textContent = 'Stop';
        toggleBtn.classList.add('stop');
        toggleBtn.disabled = false;
    } else {
        // stopped / error
        isRunning = false;
        toggleBtn.textContent = 'Start';
        toggleBtn.classList.remove('stop');
        toggleBtn.disabled = false;
    }
}

// ── Projects rendering ────────────────────────────────────────────────────────
function renderProjects() {
    if (!projects.length) {
        projectsTbody.innerHTML = '<tr><td colspan="6" class="empty-state">No projects configured yet.</td></tr>';
        return;
    }
    projectsTbody.innerHTML = '';
    projects.forEach(p => {
        const nv = formatNextVote(p.nextVoteTime);
        const tr = document.createElement('tr');
        tr.dataset.key = p.key;
        tr.innerHTML = `
            <td>${escHtml(p.rating)}</td>
            <td>${escHtml(p.id)}</td>
            <td>${escHtml(p.nick || '')}</td>
            <td class="next-vote ${nv.cls}">${nv.text}</td>
            <td><input type="checkbox" class="toggle-check" ${p.enabled !== false ? 'checked' : ''} title="Enable/Disable" /></td>
            <td><button class="btn-remove">Remove</button></td>
        `;
        tr.querySelector('.toggle-check').addEventListener('change', () => {
            window.avr.toggleProject(p.key).then(newEnabled => {
                const proj = projects.find(x => x.key === p.key);
                if (proj && newEnabled !== null) proj.enabled = newEnabled;
            });
        });
        tr.querySelector('.btn-remove').addEventListener('click', async () => {
            await window.avr.removeProject(p.key);
            projects = projects.filter(x => x.key !== p.key);
            renderProjects();
        });
        projectsTbody.appendChild(tr);
    });
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Periodically refresh next-vote times in the table ────────────────────────
setInterval(() => {
    if (!projects.length) return;
    const rows = projectsTbody.querySelectorAll('tr[data-key]');
    rows.forEach(row => {
        const p = projects.find(x => x.key === row.dataset.key);
        if (!p) return;
        const nv = formatNextVote(p.nextVoteTime);
        const td = row.querySelector('.next-vote');
        if (td) {
            td.textContent = nv.text;
            td.className = `next-vote ${nv.cls}`;
        }
    });
}, 30000);

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
});

// ── Start / Stop ──────────────────────────────────────────────────────────────
toggleBtn.addEventListener('click', async () => {
    toggleBtn.disabled = true;
    if (!isRunning) {
        toggleBtn.textContent = 'Starting…';
        await window.avr.startAutomation();
    } else {
        toggleBtn.textContent = 'Stopping…';
        await window.avr.stopAutomation();
    }
});

// ── Add project ───────────────────────────────────────────────────────────────
addBtn.addEventListener('click', async () => {
    const rating = addRating.value.trim();
    const id     = addId.value.trim();
    const nick   = addNick.value.trim();
    if (!rating || !id) {
        addId.focus();
        return;
    }
    const newProject = await window.avr.addProject({ rating, id, nick });
    projects.push(newProject);
    renderProjects();
    addId.value   = '';
    addNick.value = '';
});

// ── Settings ──────────────────────────────────────────────────────────────────
saveSettingsBtn.addEventListener('click', async () => {
    const settings = {
        headless:     sHeadless.checked,
        timeout:      parseInt(sTimeout.value, 10) || 30000,
        timeoutVote:  parseInt(sTimeoutVote.value, 10) || 120000,
        debug:        sDebug.checked
    };
    await window.avr.saveSettings(settings);
    settingsSaved.style.display = 'inline';
    setTimeout(() => { settingsSaved.style.display = 'none'; }, 2000);
});

// ── Clear logs ────────────────────────────────────────────────────────────────
clearLogsBtn.addEventListener('click', async () => {
    await window.avr.clearLogs();
    logOutput.innerHTML = '';
});

// ── CAPTCHA overlay ───────────────────────────────────────────────────────────
captchaResume.addEventListener('click', async () => {
    captchaOverlay.classList.remove('visible');
    await window.avr.captchaResolved();
});

// ── Event listeners from main process ────────────────────────────────────────
window.avr.onLog(entry => appendLog(entry));

window.avr.onStatus(status => setStatus(status));

window.avr.onCaptcha(data => {
    captchaProject.textContent = data.projectName || '';
    captchaOverlay.classList.add('visible');
});

window.avr.onVoteResult(data => {
    // Update the project's nextVoteTime in local state and re-render the row
    if (data && data.project) {
        const proj = projects.find(p => p.key === data.project.key);
        if (proj && data.project.nextVoteTime !== undefined) {
            proj.nextVoteTime = data.project.nextVoteTime;
        }
        // Refresh next-vote display for that row
        const row = projectsTbody.querySelector(`tr[data-key="${data.project.key}"]`);
        if (row) {
            const p = projects.find(x => x.key === data.project.key);
            if (p) {
                const nv = formatNextVote(p.nextVoteTime);
                const td = row.querySelector('.next-vote');
                if (td) { td.textContent = nv.text; td.className = `next-vote ${nv.cls}`; }
            }
        }
    }
});

// ── Initialise ────────────────────────────────────────────────────────────────
async function init() {
    // Load projects
    projects = await window.avr.getProjects();
    renderProjects();

    // Load settings
    const settings = await window.avr.getSettings();
    if (settings) {
        sHeadless.checked   = !!settings.headless;
        sTimeout.value      = settings.timeout      || 30000;
        sTimeoutVote.value  = settings.timeoutVote  || 120000;
        sDebug.checked      = !!settings.debug;
    }

    // Load persisted logs
    const logs = await window.avr.getLogs();
    if (logs && logs.length) {
        logs.forEach(entry => appendLog(entry));
    }
}

init();
