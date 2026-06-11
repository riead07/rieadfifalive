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

    createToken: (key, termDays, maxDevices, allowChat = false) => {
        const data = readDb();
        if (data.tokens.some(t => t.key.toUpperCase() === key.toUpperCase())) {
            return { success: false, message: "Token already exists." };
        }
        const newToken = {
            key: key.trim(),
            termDays: parseInt(termDays) || 30,
            maxDevices: parseInt(maxDevices) || 1,
            allowChat: !!allowChat,
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
    addSession: (key, name, sessionId, expireDurationMs = 24 * 60 * 60 * 1000) => {
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
            existingSession.name = name.trim();
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
            name: name.trim(),
            loginTime: new Date().toISOString(),
            expiresAt: now + expireDurationMs,
            allowChat: !!token.allowChat
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
    },

    clearSessions: (key) => {
        const data = readDb();
        const token = data.tokens.find(t => t.key.toUpperCase() === key.toUpperCase());
        if (token) {
            token.sessions = [];
            writeDb(data);
            return { success: true };
        }
        return { success: false, message: "Token not found." };
    },

    getSettings: () => {
        const data = readDb();
        if (!data.settings) {
            data.settings = {
                isLive: false,
                streamType: "twitch",
                streamTitle: "FIFA World Cup 2026 Live",
                twitchChannel: "riead07",
                hlsUrl: "",
                thumbnailUrl: ""
            };
            writeDb(data);
        }
        return data.settings;
    },

    saveSettings: (settings) => {
        const data = readDb();
        data.settings = {
            isLive: !!settings.isLive,
            streamType: settings.streamType || "twitch",
            streamTitle: settings.streamTitle || "FIFA World Cup 2026 Live",
            twitchChannel: settings.twitchChannel || "",
            hlsUrl: settings.hlsUrl || "",
            thumbnailUrl: settings.thumbnailUrl || ""
        };
        writeDb(data);
        return { success: true, settings: data.settings };
    },

    toggleChatPermission: (key) => {
        const data = readDb();
        const token = data.tokens.find(t => t.key.toUpperCase() === key.toUpperCase());
        if (token) {
            token.allowChat = !token.allowChat;
            writeDb(data);
            return { success: true, token };
        }
        return { success: false, message: "Token not found." };
    },

    getActiveSessions: () => {
        const tokens = db.getTokens(); // Cleans expired sessions internally
        const activeSessions = [];
        tokens.forEach(t => {
            t.sessions.forEach(s => {
                activeSessions.push({
                    key: t.key,
                    sessionId: s.id,
                    name: s.name || "Unknown",
                    loginTime: s.loginTime || t.createdAt,
                    allowChat: !!s.allowChat
                });
            });
        });
        return activeSessions.sort((a, b) => new Date(b.loginTime) - new Date(a.loginTime));
    },

    kickSession: (sessionId) => {
        const data = readDb();
        let kicked = false;
        data.tokens.forEach(t => {
            const initialCount = t.sessions.length;
            t.sessions = t.sessions.filter(s => s.id !== sessionId);
            if (t.sessions.length < initialCount) {
                kicked = true;
            }
        });
        if (kicked) {
            writeDb(data);
            return { success: true };
        }
        return { success: false, message: "Session not found." };
    },
    toggleSessionChat: (sessionId) => {
        const data = readDb();
        let found = false;
        data.tokens.forEach(t => {
            const session = t.sessions.find(s => s.id === sessionId);
            if (session) {
                session.allowChat = !session.allowChat;
                found = true;
            }
        });
        if (found) {
            writeDb(data);
            return { success: true };
        }
        return { success: false, message: "Session not found." };
    },

    getChatMessages: () => {
        const data = readDb();
        if (!data.chat) {
            data.chat = [];
            writeDb(data);
        }
        return data.chat;
    },

    addChatMessage: (senderName, text) => {
        const data = readDb();
        if (!data.chat) {
            data.chat = [];
        }
        const message = {
            id: Math.random().toString(36).substring(2, 10),
            senderName: senderName,
            text: text,
            timestamp: new Date().toISOString()
        };
        data.chat.push(message);
        if (data.chat.length > 50) {
            data.chat = data.chat.slice(-50);
        }
        writeDb(data);
        return { success: true, message };
    }
};

initDb();

module.exports = db;
