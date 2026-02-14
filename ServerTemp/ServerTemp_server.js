/*
    Server Temperature Monitor v1.0.1 by AAD
    https://github.com/AmateurAudioDude/FM-DX-Webserver-Plugin-Server-Temperature

    //// Server-side code ////
*/

/**
 * Reads system temperature using vcgencmd and stores it in memory
 */

const pluginName  = 'ServerTemp';

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { logInfo, logError, logWarn } = require('./../../server/console');

// Configuration
const UPDATE_INTERVAL = 10 * 60 * 1000; // 10 minutes

let consoleLogged = false;
let temperatureSupported = true; // Flag to track if temperature reading is supported
let updateIntervalId = null; // Store interval ID so we can clear it

// Track which methods have failed to avoid retrying them
let failedMethods = {
    vcgencmd: false,
    thermal_zone: false,
    sensors: false
};

// Track which method is working
let workingMethod = null;

// Store temperature in memory
let currentTemperature = {
    temperature: null,
    timestamp: null,
    unit: 'C',
    error: null
};

/**
 * Read temperature from the system
 * Uses vcgencmd on Broadcom-based devices, falls back to other methods on different systems
 */
function readTemperature(callback) {
    if (!consoleLogged) logInfo(`[${pluginName}] Attempting to read temperature...`);

    // Use working method directly if it works
    if (workingMethod) {
        switch (workingMethod) {
            case 'vcgencmd':
                tryVcgencmd(callback);
                return;
            case 'thermal_zone':
                tryThermalZone(callback);
                return;
            case 'sensors':
                trySensors(callback);
                return;
        }
    }

    // Otherwise, try methods that haven't failed yet
    tryNextMethod(callback);
}

/**
 * Try the next available temperature reading method
 */
function tryNextMethod(callback) {
    if (!failedMethods.vcgencmd) {
        tryVcgencmd((error, temp) => {
            if (!error) {
                workingMethod = 'vcgencmd';
                callback(null, temp);
            } else {
                failedMethods.vcgencmd = true;
                tryNextMethod(callback);
            }
        });
    } else if (!failedMethods.thermal_zone) {
        tryThermalZone((error, temp) => {
            if (!error) {
                workingMethod = 'thermal_zone';
                callback(null, temp);
            } else {
                failedMethods.thermal_zone = true;
                tryNextMethod(callback);
            }
        });
    } else if (!failedMethods.sensors) {
        trySensors((error, temp) => {
            if (!error) {
                workingMethod = 'sensors';
                callback(null, temp);
            } else {
                failedMethods.sensors = true;
                tryNextMethod(callback);
            }
        });
    } else {
        // All methods have failed
        logError(`[${pluginName}] All temperature reading methods failed`);
        callback(new Error('Unable to read temperature from system'));
    }
}

/**
 * Try reading temperature via vcgencmd (Broadcom-based devices)
 */
function tryVcgencmd(callback) {
    exec('vcgencmd measure_temp', (error, stdout, stderr) => {
        if (!error && stdout) {
            const match = stdout.match(/temp=([\d.]+)/);
            if (match) {
                const temp = parseFloat(match[1]);
                if (!consoleLogged) logInfo(`[${pluginName}] Temperature read via vcgencmd: ` + temp + '\u00B0C');
                callback(null, temp);
                return;
            }
        }
        if (!consoleLogged) logWarn(`[${pluginName}] vcgencmd failed: ` + (error ? error.message : 'no output'));
        callback(new Error('vcgencmd failed'));
    });
}

/**
 * Try reading temperature via thermal_zone0 (Linux)
 */
function tryThermalZone(callback) {
    exec('cat /sys/class/thermal/thermal_zone0/temp', (error, stdout, stderr) => {
        if (!error && stdout) {
            const temp = parseFloat(stdout) / 1000;
            if (!isNaN(temp)) {
                if (!consoleLogged) logInfo(`[${pluginName}] Temperature read via thermal_zone0: ` + temp + '\u00B0C');
                callback(null, temp);
                return;
            }
        }
        if (!consoleLogged) logWarn(`[${pluginName}] thermal_zone0 failed: ` + (error ? error.message : 'no output'));
        callback(new Error('thermal_zone0 failed'));
    });
}

/**
 * Try reading temperature via sensors command (lm-sensors)
 */
function trySensors(callback) {
    exec('sensors -A 2>&1', (error, stdout, stderr) => {
        if (!error && stdout) {
            const match = stdout.match(/Core \d+:\s+\+([\d.]+)\u00B0C/);
            if (match) {
                const temp = parseFloat(match[1]);
                if (!consoleLogged) logInfo(`[${pluginName}] Temperature read via sensors: ` + temp + '\u00B0C');
                callback(null, temp);
                return;
            }
        }
        if (!consoleLogged) logWarn(`[${pluginName}] sensors failed: ` + (error ? error.message : 'no output'));
        callback(new Error('sensors failed'));
    });
}

/**
 * Update temperature in memory
 */
function updateTemperature() {
    // If temperature reading is not supported, don't try again
    if (!temperatureSupported) {
        return;
    }

    readTemperature((error, temp) => {
        if (error) {
            logWarn(`[${pluginName}] ` + error.message);
            currentTemperature = {
                temperature: null,
                timestamp: Date.now(),
                unit: 'C',
                error: error.message
            };

            // If this is the first attempt and it failed, disable future attempts
            if (!consoleLogged) {
                temperatureSupported = false;
                if (updateIntervalId) {
                    clearInterval(updateIntervalId);
                    updateIntervalId = null;
                }
                logWarn(`[${pluginName}] Temperature reading not supported on this system, monitoring disabled.`);
            }
            consoleLogged = true;
            return;
        }

        // Store temperature in memory
        currentTemperature = {
            temperature: temp,
            timestamp: Date.now(),
            unit: 'C',
            error: null
        };

        if (!consoleLogged) {
            logInfo(`[ServerTemp] Temperature updated: ${temp.toFixed(1)}\u00B0C`);
            if (workingMethod) {
                logInfo(`[ServerTemp] Using method: ${workingMethod}`);
            }
        }
        consoleLogged = true;
    });
}

/**
 * Get current temperature data
 * This function is called by the API endpoint
 */
function getTemperatureData() {
    return currentTemperature;
}

// API endpoint
try {
    const endpointsRouter = require('../../server/endpoints');

    // Add our temperature endpoint to the router
    endpointsRouter.get('/server_temp', (req, res) => {
        const pluginHeader = req.get('X-Plugin-Name') || 'NoPlugin';

        if (pluginHeader === 'ServerTempPlugin') {
            res.json(currentTemperature);
        } else {
            res.status(403).json({ error: 'Unauthorised' });
        }
    });

    logInfo('[ServerTemp] API endpoint registered at /server_temp');
} catch (err) {
    logError('[ServerTemp] Failed to register API endpoint:', err);
}

// Initial temperature read
if (!consoleLogged) logInfo('[ServerTemp] Server Temperature Monitor started');
updateTemperature();

// Set up periodic updates if temperature reading is supported
updateIntervalId = setInterval(updateTemperature, UPDATE_INTERVAL);

logInfo(`[ServerTemp] Temperature will be updated every ${(UPDATE_INTERVAL / 60000).toFixed(1)} minutes`);

// Export the function so it can be used by the API endpoint
module.exports = {
    getTemperatureData
};
