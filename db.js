const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.json');

// Initialize database with default template if it doesn't exist
function initDb() {
    if (!fs.existsSync(DB_PATH)) {
        const defaultData = {
            tokens: [
                {
                    key: "RIEAD",
                    termDays: 36500, // Long term
                    maxDevices: 100,
                    status: "ACTIVE", // ACTIVE or BLOCKED
                    createdAt: new Date().toISOString(),
                    sessions: [] // List of active session IDs
                }
            ]
        };
        fs.writeFileSync(DB_PATH, JSON.stringify(defaultData, null, 4));
    }
}

function readDb() {
    initDb();
    try {
        const data = fs.readFileSync(DB_PATH, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error("Database read error, recreating:", e);
        const defaultData = { tokens: [] };
        fs.writeFileSync(DB_PATH, JSON.stringify(defaultData, null, 4));
        return defaultData;
    }
}

function writeDb(data) {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 4));
        return true;
    } catch (e) {
        console.error("Database write error:", e);
        return false;
    }
}

// Token management
const db = {
    getTokens: () => {
        const data = readDb();
        // Clean expired sessions on fetch
        const now = Date.now();
        let updated = false;
        data.tokens.forEach(t => {
            const initialCount = t.sessions.length;
            t.sessions = t.sessions.filter(s => s.expiresAt > now);
            if (t.sessions.length !== initialCount) {
                updated = true;
            }
        });
        if (updated) {
            writeDb(data);
        }
        return data.tokens;
    },

    getToken: (key) => {
        const tokens = db.getTokens();
        return tokens.find(t => t.key.toUpperCase() === key.toUpperCase());
    },

    createToken: (key, termDays, maxDevices) => {
        const data = readDb();
        if (data.tokens.some(t => t.key.toUpperCase() === key.toUpperCase())) {
            return { success: false, message: "Token already exists." };
        }
        const newToken = {
            key: key.trim(),
            termDays: parseInt(termDays) || 30,
            maxDevices: parseInt(maxDevices) || 1,
            status: "ACTIVE",
            createdAt: new Date().toISOString(),
            sessions: []
        };
        data.tokens.push(newToken);
        writeDb(data);
        return { success: true, token: newToken };
    },

    toggleTokenStatus: (key) => {
        const data = readDb();
        const token = data.tokens.find(t => t.key.toUpperCase() === key.toUpperCase());
        if (token) {
            token.status = token.status === "ACTIVE" ? "BLOCKED" : "ACTIVE";
            // If blocked, clear all active sessions immediately
            if (token.status === "BLOCKED") {
                token.sessions = [];
            }
            writeDb(data);
            return { success: true, token };
        }
        return { success: false, message: "Token not found." };
    },

    deleteToken: (key) => {
        const data = readDb();
        const initialLength = data.tokens.length;
        data.tokens = data.tokens.filter(t => t.key.toUpperCase() !== key.toUpperCase());
        if (data.tokens.length < initialLength) {
            writeDb(data);
            return { success: true };
        }
        return { success: false, message: "Token not found." };
    },

    clearAllTokens: () => {
        const data = { tokens: [] };
        writeDb(data);
        return { success: true };
    },

    // Session validation
    addSession: (key, sessionId, expireDurationMs = 24 * 60 * 60 * 1000) => {
        const data = readDb();
        const token = data.tokens.find(t => t.key.toUpperCase() === key.toUpperCase());
        if (!token) return { success: false, message: "Invalid license key." };
        if (token.status === "BLOCKED") return { success: false, message: "License key is blocked." };

        // Check expiration of the license key itself
        const createdTime = new Date(token.createdAt).getTime();
        const licenseExpireTime = createdTime + (token.termDays * 24 * 60 * 60 * 1000);
        if (Date.now() > licenseExpireTime) {
            token.status = "EXPIRED";
            writeDb(data);
            return { success: false, message: "License key has expired." };
        }

        // Clean expired sessions
        const now = Date.now();
        token.sessions = token.sessions.filter(s => s.expiresAt > now);

        // Check if user is already registered in active sessions (refreshing page)
        const existingSession = token.sessions.find(s => s.id === sessionId);
        if (existingSession) {
            existingSession.expiresAt = now + expireDurationMs; // Extend session
            writeDb(data);
            return { success: true };
        }

        // Check device limit
        if (token.sessions.length >= token.maxDevices) {
            return { success: false, message: "Device limit reached. Log out of other devices first." };
        }

        // Add new session
        token.sessions.push({
            id: sessionId,
            expiresAt: now + expireDurationMs
        });
        writeDb(data);
        return { success: true };
    },

    removeSession: (key, sessionId) => {
        const data = readDb();
        const token = data.tokens.find(t => t.key.toUpperCase() === key.toUpperCase());
        if (token) {
            token.sessions = token.sessions.filter(s => s.id !== sessionId);
            writeDb(data);
            return { success: true };
        }
        return { success: false };
    }
};

initDb();

module.exports = db;
