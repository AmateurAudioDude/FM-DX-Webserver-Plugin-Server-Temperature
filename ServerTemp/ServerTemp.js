/*
    Server Temperature Monitor v1.0.0 by AAD
    https://github.com/AmateurAudioDude/
*/

(function() {
    'use strict';

    const pluginName  = 'ServerTemp';

    // Configuration
    const ADMIN_ONLY = false;
    const UPDATE_INTERVAL = 10 * 60 * 1000; // 10 minutes
    const API_URL = '/server_temp';

    // Check if administrator code
    let isTuneAuthenticated = false;

    document.addEventListener('DOMContentLoaded', () => {
        checkAdminMode();
    });

    // Is the user administrator?
    function checkAdminMode() {
        const bodyText = document.body.textContent || document.body.innerText;
        isTuneAuthenticated = bodyText.includes("You are logged in as an administrator.") || bodyText.includes("You are logged in as an adminstrator.") || bodyText.includes("You are logged in and can control the receiver.");
    }

    /**
     * Fetch temperature data from server
     */
    function fetchTemperature() {
        fetch(API_URL + '?t=' + Date.now(), {
            method: 'GET',
            headers: {
                'X-Plugin-Name': 'ServerTempPlugin'
            }
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error('Failed to fetch temperature');
                }
                return response.json();
            })
            .then(tempData => {
                updateTemperatureDisplay(
                    tempData.temperature,
                    tempData.unit,
                    tempData.error
                );
            })
            .catch(error => {
                console.warn(`[${pluginName}] Failed to fetch temperature:`, error);
                updateTemperatureDisplay(null, null, error.message);
            });
    }


    /**
     * Update the temperature display in the UI
     */
    function updateTemperatureDisplay(temp, unit, error) {
        let tempElement = document.getElementById('server-temp-display');

        if (!tempElement) {
            // Create the temperature display element
            createTemperatureElement();
            tempElement = document.getElementById('server-temp-display');
        }

        if (tempElement) {
            if (ADMIN_ONLY && !isTuneAuthenticated) return;
            if (temp !== null && !isNaN(temp)) {
                const displayTemp = temp.toFixed(1);
                tempElement.innerHTML = `Server: ${displayTemp}\u00B0${unit || 'C'}`;
                tempElement.style.display = 'block';
                tempElement.style.marginBottom = '0';
                tempElement.title = `Last updated: ${new Date().toLocaleTimeString()}`;
                console.log(`[${pluginName}] Client-side temperature monitor updated: ${displayTemp}\u00B0${unit || 'C'}`);
            } else {
                tempElement.innerHTML = ''; // error
                tempElement.style.display = 'block';
                if (error) {
                    tempElement.title = `Error: ${error}`;
                }
            }
        }
    }

    /**
     * Create and insert the temperature display element
     */
    function createTemperatureElement() {
        if (ADMIN_ONLY && !isTuneAuthenticated) return;
        // Find the #current-ping element
        const currentPing = document.getElementById('current-ping');

        if (!currentPing) {
            console.warn(`[${pluginName}] Could not find current-ping element`);
            return;
        }

        // Create temperature display element
        const tempSpan = document.createElement('p');
        tempSpan.id = 'server-temp-display';
        tempSpan.className = 'text-small';
        tempSpan.style.color = 'var(--color-3)';
        tempSpan.style.display = 'block';
        tempSpan.style.marginBottom = '0';
        tempSpan.innerHTML = 'Server: Loading...';

        // Insert before the current-ping element
        currentPing.parentNode.insertBefore(tempSpan, currentPing);

        // Reduce spacing between temperature and ping
        currentPing.style.marginTop = '0';
    }

    /**
     * Initialise the temperature monitor
     */
    function init() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
            return;
        }

        console.log(`[${pluginName}] Client-side temperature monitor initialised`);

        // Initial fetch
        setTimeout(fetchTemperature, 1000);

        // Set up periodic updates
        setInterval(fetchTemperature, UPDATE_INTERVAL);
    }

    // Start the plugin
    init();
})();
