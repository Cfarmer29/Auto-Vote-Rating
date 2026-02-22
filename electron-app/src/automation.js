'use strict';

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { EventEmitter } = require('events');

function loadAllProjects() {
    const paths = [
        path.join(process.resourcesPath || '', 'projects.js'),
        path.join(__dirname, '../../projects.js')
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) {
            const code = fs.readFileSync(p, 'utf8');
            const sandbox = {};
            try {
                vm.runInNewContext(code, sandbox);
                if (sandbox.allProjects) return sandbox.allProjects;
            } catch (e) {
                // projects.js may reference undefined globals during execution;
                // return whatever was partially assigned before the error
                if (sandbox.allProjects) return sandbox.allProjects;
            }
        }
    }
    return {};
}

class VoteAutomation extends EventEmitter {
    constructor(store) {
        super();
        this.store = store;
        this.browser = null;
        this.running = false;
        this._captchaWaiter = null;
        this._allProjects = null;
    }

    getAllProjects() {
        if (!this._allProjects) {
            this._allProjects = loadAllProjects();
        }
        return this._allProjects;
    }

    async start() {
        if (this.running) return;
        this.running = true;
        const settings = this.store.get('settings');

        try {
            this.browser = await chromium.launch({
                headless: settings.headless || false,
                args: ['--no-sandbox']
            });
        } catch (err) {
            this.log('Failed to launch browser: ' + err.message, 'error');
            this.running = false;
            this.emit('status', 'error');
            return;
        }

        this.emit('status', 'running');
        this.log('Automation started');

        this._runLoop().catch(err => {
            this.log('Automation loop error: ' + err.message, 'error');
            this.running = false;
            this.emit('status', 'stopped');
        });
    }

    async stop() {
        this.running = false;
        if (this._captchaWaiter) {
            this._captchaWaiter();
            this._captchaWaiter = null;
        }
        if (this.browser) {
            try { await this.browser.close(); } catch (e) {}
            this.browser = null;
        }
        this.emit('status', 'stopped');
        this.log('Automation stopped');
    }

    resolveCaptcha() {
        if (this._captchaWaiter) {
            this._captchaWaiter();
            this._captchaWaiter = null;
        }
    }

    async _runLoop() {
        while (this.running) {
            const project = this._getNextProject();

            if (!project) {
                const wait = this._getTimeUntilNextVote();
                if (wait > 0) {
                    this.log(`No projects ready. Next vote in ${Math.ceil(wait / 60000)} min`, 'info');
                    this.emit('status', 'waiting');
                    await this._sleep(Math.min(wait, 60000));
                } else {
                    await this._sleep(5000);
                }
                continue;
            }

            this.emit('status', 'voting');
            await this._voteForProject(project);

            if (!this.running) break;
            await this._sleep(2000);
        }

        if (this.running) {
            this.running = false;
            this.emit('status', 'stopped');
        }
    }

    _getNextProject() {
        const projects = this.store.get('projects', []);
        const now = Date.now();
        return projects.find(p => p.enabled !== false && (!p.nextVoteTime || p.nextVoteTime <= now));
    }

    _getTimeUntilNextVote() {
        const projects = this.store.get('projects', []);
        const now = Date.now();
        const enabled = projects.filter(p => p.enabled !== false && p.nextVoteTime > now);
        if (!enabled.length) return 0;
        return Math.min(...enabled.map(p => p.nextVoteTime - now));
    }

    async _voteForProject(project) {
        const allProjects = this.getAllProjects();
        const projectDef = allProjects[project.rating];

        if (!projectDef || !projectDef.voteURL) {
            this.log(`No definition found for rating: ${project.rating}`, 'error');
            this._updateProjectNextTime(project.key, Date.now() + 3600000);
            return;
        }

        let voteURL;
        try {
            voteURL = projectDef.voteURL(project);
        } catch (e) {
            this.log(`Failed to get vote URL for ${project.rating}/${project.id}: ${e.message}`, 'error');
            this._updateProjectNextTime(project.key, Date.now() + 3600000);
            return;
        }

        this.log(`Voting for ${project.rating} / ${project.id} at ${voteURL}`);

        const settings = this.store.get('settings');
        const timeout = settings.timeout || 30000;
        const timeoutVote = settings.timeoutVote || 120000;

        const scriptPaths = [
            path.join(process.resourcesPath || '', 'scripts', project.rating + '.js'),
            path.join(__dirname, '../../scripts', project.rating + '.js'),
            path.join(process.resourcesPath || '', 'scripts', (project.ratingMain || project.rating) + '.js'),
            path.join(__dirname, '../../scripts', (project.ratingMain || project.rating) + '.js')
        ];
        const scriptPath = scriptPaths.find(p => fs.existsSync(p));

        const apiPaths = [
            path.join(process.resourcesPath || '', 'scripts/main/api.js'),
            path.join(__dirname, '../../scripts/main/api.js')
        ];
        const apiPath = apiPaths.find(p => fs.existsSync(p));

        if (!scriptPath) {
            this.log(`Voting script not found for: ${project.rating}`, 'warn');
            this._updateProjectNextTime(project.key, Date.now() + 3600000);
            return;
        }

        let context;
        try {
            context = await this.browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            });
            const page = await context.newPage();

            // Inject mock chrome.runtime before page scripts run
            await page.addInitScript(() => {
                window.__avrResult__ = null;
                window.__avrMessageListeners__ = [];
                window.chrome = {
                    runtime: {
                        sendMessage: function (message) {
                            if (window.__avrResult__ === null) {
                                window.__avrResult__ = message;
                            }
                        },
                        onMessage: {
                            addListener: function (callback) {
                                window.__avrMessageListeners__.push(callback);
                            }
                        },
                        lastError: null,
                        getManifest: function () { return { version: '1.0.0' }; }
                    },
                    i18n: {
                        getMessage: function (key) { return key; }
                    },
                    dom: {
                        openOrClosedShadowRoot: function (el) { return el.shadowRoot; }
                    }
                };
                window.idb = undefined;
            });

            try {
                await page.goto(voteURL, { timeout, waitUntil: 'domcontentloaded' });
            } catch (navErr) {
                this.log(`Navigation error for ${project.rating}: ${navErr.message}`, 'error');
                this._updateProjectNextTime(project.key, Date.now() + 900000);
                await context.close();
                return;
            }

            await page.waitForTimeout(1000);

            const hasCaptcha = await this._detectManualCaptcha(page);
            if (hasCaptcha) {
                this.log(`CAPTCHA detected on ${project.rating} - pausing for manual solve`, 'warn');
                this.emit('captcha', {
                    projectName: `${project.rating}/${project.id}`,
                    url: page.url()
                });

                await new Promise(resolve => {
                    this._captchaWaiter = resolve;
                });

                if (!this.running) {
                    await context.close();
                    return;
                }

                this.log('Resuming after CAPTCHA...', 'info');
            }

            try {
                await page.addScriptTag({ path: scriptPath });
            } catch (e) {
                this.log(`Failed to inject voting script: ${e.message}`, 'error');
                this._updateProjectNextTime(project.key, Date.now() + 900000);
                await context.close();
                return;
            }

            if (apiPath) {
                try {
                    await page.addScriptTag({ path: apiPath });
                } catch (e) {
                    this.log(`Failed to inject api.js: ${e.message}`, 'warn');
                }
            }

            const settingsData = settings;
            await page.evaluate(({ proj, settingsData }) => {
                if (window.__avrMessageListeners__) {
                    window.__avrMessageListeners__.forEach(listener => {
                        try { listener({ sendProject: true, project: proj, settings: settingsData }); } catch (e) {}
                    });
                }
            }, { proj: project, settingsData });

            let result = null;
            try {
                await page.waitForFunction(
                    () => window.__avrResult__ !== null,
                    { timeout: timeoutVote }
                );
                result = await page.evaluate(() => window.__avrResult__);
            } catch (e) {
                result = null;
            }

            if (result) {
                this._handleVoteResult(result, project);
            } else {
                this.log(`Vote timeout for ${project.rating}/${project.id}`, 'warn');
                this._updateProjectNextTime(project.key, Date.now() + 900000);
                this.emit('vote-result', { project, result: 'timeout' });
            }

        } catch (err) {
            this.log(`Error voting for ${project.rating}/${project.id}: ${err.message}`, 'error');
            this._updateProjectNextTime(project.key, Date.now() + 900000);
        } finally {
            if (context) {
                try { await context.close(); } catch (e) {}
            }
        }
    }

    async _detectManualCaptcha(page) {
        try {
            return await page.evaluate(() => {
                const selectors = [
                    '#rc-imageselect',
                    '.h-captcha',
                    'iframe[src*="hcaptcha"]',
                    '#challenge-form',
                    '#challenge-body-text'
                ];
                return selectors.some(s => {
                    const el = document.querySelector(s);
                    return el && el.offsetParent !== null;
                });
            });
        } catch (e) {
            return false;
        }
    }

    _handleVoteResult(result, project) {
        if (result.successfully) {
            this.log(`✓ Voted successfully for ${project.rating}/${project.id}`, 'success');
            this.emit('vote-result', { project, result: 'success' });
            this._updateProjectNextTime(project.key, Date.now() + 3600000);
        } else if (result.later) {
            this.log(`⏱ Already voted for ${project.rating}/${project.id} - try later`, 'info');
            this.emit('vote-result', { project, result: 'later' });
            this._updateProjectNextTime(project.key, Date.now() + 3600000);
        } else if (result.captcha) {
            this.log(`CAPTCHA challenge for ${project.rating}/${project.id}`, 'warn');
            this.emit('captcha', {
                projectName: `${project.rating}/${project.id}`,
                url: ''
            });
            this._updateProjectNextTime(project.key, Date.now() + 900000);
        } else if (result.message) {
            this.log(`ℹ ${project.rating}/${project.id}: ${result.message}`, 'warn');
            this.emit('vote-result', { project, result: 'message', message: result.message });
            this._updateProjectNextTime(project.key, Date.now() + 900000);
        } else if (result.errorVote || result.errorVoteNoElement) {
            const msg = result.errorVote ? result.errorVote[0] : (result.errorVoteNoElement || 'unknown error');
            this.log(`✗ Vote error for ${project.rating}/${project.id}: ${msg}`, 'error');
            this.emit('vote-result', { project, result: 'error', message: msg });
            this._updateProjectNextTime(project.key, Date.now() + 900000);
        } else {
            this.log(`? Unknown result for ${project.rating}/${project.id}: ${JSON.stringify(result)}`, 'warn');
            this._updateProjectNextTime(project.key, Date.now() + 900000);
        }
    }

    _updateProjectNextTime(key, nextVoteTime) {
        const projects = this.store.get('projects', []);
        const idx = projects.findIndex(p => p.key === key);
        if (idx !== -1) {
            projects[idx].nextVoteTime = nextVoteTime;
            this.store.set('projects', projects);
        }
    }

    log(message, level = 'info') {
        const entry = { time: new Date().toLocaleTimeString(), level, message };
        this.emit('log', entry);

        const logs = this.store.get('logs', []);
        logs.push(entry);
        if (logs.length > 500) logs.splice(0, logs.length - 500);
        this.store.set('logs', logs);
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = VoteAutomation;
