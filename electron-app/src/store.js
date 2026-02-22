const Store = require('electron-store');

const store = new Store({
    name: 'avr-config',
    defaults: {
        projects: [],
        settings: {
            headless: false,
            timeout: 30000,
            timeoutVote: 120000,
            debug: false
        },
        logs: []
    }
});

module.exports = store;
