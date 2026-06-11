const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.json');
let isMongo = !!process.env.MONGODB_URI;

// MongoDB Schema Definitions
let TokenModel, SettingsModel, ChatModel;

if (isMongo) {
    mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 5000 // fail fast in 5s instead of hanging
    })
        .then(async () => {
            console.log("Connected to MongoDB Atlas");
            // Auto initialize default RIEAD token if collection is empty
            try {
                const count = await TokenModel.countDocuments({});
                if (count === 0) {
                    const defaultToken = new TokenModel({
                        key: "RIEAD",
                        termDays: 36500,
                        maxDevices: 100,
                        status: "ACTIVE",
                        sessions: []
                    });
                    await defaultToken.save();
                    console.log("Default RIEAD token initialized in MongoDB Atlas.");
                }
            } catch (err) {
                console.error("Error auto-initializing default token:", err);
            }
        })
        .catch(err => {
            console.error("MongoDB Atlas connection error, falling back to local JSON storage:", err);
            isMongo = false;
        });

    const TokenSchema = new mongoose.Schema({
        key: { type: String, required: true, unique: true, uppercase: true },
        termDays: { type: Number, default: 30 },
        maxDevices: { type: Number, default: 1 },
        allowChat: { type: Boolean, default: false },
        status: { type: String, default: "ACTIVE" }, // ACTIVE, BLOCKED, EXPIRED
        createdAt: { type: String, default: () => new Date().toISOString() },
        sessions: [{
            id: String,
            name: String,
            loginTime: String,
            expiresAt: Number, // timestamp
            allowChat: Boolean
        }]
    });
    TokenModel = mongoose.model('Token', TokenSchema);

    const SettingsSchema = new mongoose.Schema({
        isLive: { type: Boolean, default: false },
        streamType: { type: String, default: "whip" },
        streamTitle: { type: String, default: "FIFA World Cup 2026 Live" },
        whipKey: { type: String, default: "rieadfifa26" },
        hlsUrl: { type: String, default: "" },
        youtubeUrl: { type: String, default: "" },
        thumbnailUrl: { type: String, default: "" },
        twitchChannel: { type: String, default: "" },
        kickChannel: { type: String, default: "" }
    });
    SettingsModel = mongoose.model('Settings', SettingsSchema);

    const ChatSchema = new mongoose.Schema({
        id: String,
        senderName: String,
        text: String,
        timestamp: { type: String, default: () => new Date().toISOString() }
    });
    ChatModel = mongoose.model('Chat', ChatSchema);
}

// Local JSON Storage Helpers
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

// Unified db exports
const db = {
    isMongo: () => isMongo,

    getTokens: async () => {
        const now = Date.now();
        if (isMongo) {
            try {
                const tokens = await TokenModel.find({});
                // Clean expired sessions
                for (let t of tokens) {
                    const initialCount = t.sessions.length;
                    t.sessions = t.sessions.filter(s => s.expiresAt > now);
                    if (t.sessions.length !== initialCount) {
                        await t.save();
                    }
                }
                return tokens.map(t => t.toObject());
            } catch (err) {
                console.error("MongoDB Atlas getTokens error, falling back to local JSON:", err);
            }
        }
        // Local JSON Storage
        const data = readDb();
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

    getToken: async (key) => {
        if (!key) return null;
        const uKey = key.toUpperCase();
        if (isMongo) {
            try {
                const token = await TokenModel.findOne({ key: uKey });
                if (token) {
                    const now = Date.now();
                    const initialCount = token.sessions.length;
                    token.sessions = token.sessions.filter(s => s.expiresAt > now);
                    if (token.sessions.length !== initialCount) {
                        await token.save();
                    }
                    return token.toObject();
                }
                return null;
            } catch (err) {
                console.error("MongoDB Atlas getToken error, falling back to local JSON:", err);
            }
        }
        const tokens = await db.getTokens();
        return tokens.find(t => t.key.toUpperCase() === uKey);
    },

    createToken: async (key, termDays, maxDevices, allowChat = false) => {
        const uKey = key.trim().toUpperCase();
        if (isMongo) {
            try {
                const exists = await TokenModel.findOne({ key: uKey });
                if (exists) {
                    return { success: false, message: "Token already exists." };
                }
                const newToken = new TokenModel({
                    key: uKey,
                    termDays: parseInt(termDays) || 30,
                    maxDevices: parseInt(maxDevices) || 1,
                    allowChat: !!allowChat,
                    status: "ACTIVE",
                    sessions: []
                });
                await newToken.save();
                return { success: true, token: newToken.toObject() };
            } catch (err) {
                console.error("MongoDB Atlas createToken error, falling back to local JSON:", err);
            }
        }
        const data = readDb();
        if (data.tokens.some(t => t.key.toUpperCase() === uKey)) {
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

    toggleTokenStatus: async (key) => {
        const uKey = key.toUpperCase();
        if (isMongo) {
            try {
                const token = await TokenModel.findOne({ key: uKey });
                if (token) {
                    token.status = token.status === "ACTIVE" ? "BLOCKED" : "ACTIVE";
                    if (token.status === "BLOCKED") {
                        token.sessions = [];
                    }
                    await token.save();
                    return { success: true, token: token.toObject() };
                }
                return { success: false, message: "Token not found." };
            } catch (err) {
                console.error("MongoDB Atlas toggleTokenStatus error, falling back to local JSON:", err);
            }
        }
        const data = readDb();
        const token = data.tokens.find(t => t.key.toUpperCase() === uKey);
        if (token) {
            token.status = token.status === "ACTIVE" ? "BLOCKED" : "ACTIVE";
            if (token.status === "BLOCKED") {
                token.sessions = [];
            }
            writeDb(data);
            return { success: true, token };
        }
        return { success: false, message: "Token not found." };
    },

    deleteToken: async (key) => {
        const uKey = key.toUpperCase();
        if (isMongo) {
            try {
                const res = await TokenModel.deleteOne({ key: uKey });
                if (res.deletedCount > 0) {
                    return { success: true };
                }
                return { success: false, message: "Token not found." };
            } catch (err) {
                console.error("MongoDB Atlas deleteToken error, falling back to local JSON:", err);
            }
        }
        const data = readDb();
        const initialLength = data.tokens.length;
        data.tokens = data.tokens.filter(t => t.key.toUpperCase() !== uKey);
        if (data.tokens.length < initialLength) {
            writeDb(data);
            return { success: true };
        }
        return { success: false, message: "Token not found." };
    },

    clearAllTokens: async () => {
        if (isMongo) {
            try {
                await TokenModel.deleteMany({});
                await ChatModel.deleteMany({});
                await SettingsModel.deleteMany({});
                return { success: true };
            } catch (err) {
                console.error("MongoDB Atlas clearAllTokens error, falling back to local JSON:", err);
            }
        }
        const data = { tokens: [], settings: null, chat: [] };
        writeDb(data);
        return { success: true };
    },

    addSession: async (key, name, sessionId, expireDurationMs = 24 * 60 * 60 * 1000) => {
        const uKey = key.toUpperCase();
        const now = Date.now();
        if (isMongo) {
            try {
                const token = await TokenModel.findOne({ key: uKey });
                if (!token) return { success: false, message: "Invalid license key." };
                if (token.status === "BLOCKED") return { success: false, message: "License key is blocked." };

                const createdTime = new Date(token.createdAt).getTime();
                const licenseExpireTime = createdTime + (token.termDays * 24 * 60 * 60 * 1000);
                if (Date.now() > licenseExpireTime) {
                    token.status = "EXPIRED";
                    await token.save();
                    return { success: false, message: "License key has expired." };
                }

                token.sessions = token.sessions.filter(s => s.expiresAt > now);

                const existingSession = token.sessions.find(s => s.id === sessionId);
                if (existingSession) {
                    existingSession.expiresAt = now + expireDurationMs;
                    existingSession.name = name.trim();
                    await token.save();
                    return { success: true };
                }

                if (token.sessions.length >= token.maxDevices) {
                    return { success: false, message: "Device limit reached. Log out of other devices first." };
                }

                token.sessions.push({
                    id: sessionId,
                    name: name.trim(),
                    loginTime: new Date().toISOString(),
                    expiresAt: now + expireDurationMs,
                    allowChat: !!token.allowChat
                });
                await token.save();
                return { success: true };
            } catch (err) {
                console.error("MongoDB Atlas addSession error, falling back to local JSON:", err);
            }
        }
        const data = readDb();
        const token = data.tokens.find(t => t.key.toUpperCase() === uKey);
        if (!token) return { success: false, message: "Invalid license key." };
        if (token.status === "BLOCKED") return { success: false, message: "License key is blocked." };

        const createdTime = new Date(token.createdAt).getTime();
        const licenseExpireTime = createdTime + (token.termDays * 24 * 60 * 60 * 1000);
        if (Date.now() > licenseExpireTime) {
            token.status = "EXPIRED";
            writeDb(data);
            return { success: false, message: "License key has expired." };
        }

        token.sessions = token.sessions.filter(s => s.expiresAt > now);

        const existingSession = token.sessions.find(s => s.id === sessionId);
        if (existingSession) {
            existingSession.expiresAt = now + expireDurationMs;
            existingSession.name = name.trim();
            writeDb(data);
            return { success: true };
        }

        if (token.sessions.length >= token.maxDevices) {
            return { success: false, message: "Device limit reached. Log out of other devices first." };
        }

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

    removeSession: async (key, sessionId) => {
        const uKey = key.toUpperCase();
        if (isMongo) {
            try {
                const token = await TokenModel.findOne({ key: uKey });
                if (token) {
                    token.sessions = token.sessions.filter(s => s.id !== sessionId);
                    await token.save();
                    return { success: true };
                }
                return { success: false };
            } catch (err) {
                console.error("MongoDB Atlas removeSession error, falling back to local JSON:", err);
            }
        }
        const data = readDb();
        const token = data.tokens.find(t => t.key.toUpperCase() === uKey);
        if (token) {
            token.sessions = token.sessions.filter(s => s.id !== sessionId);
            writeDb(data);
            return { success: true };
        }
        return { success: false };
    },

    clearSessions: async (key) => {
        const uKey = key.toUpperCase();
        if (isMongo) {
            try {
                const token = await TokenModel.findOne({ key: uKey });
                if (token) {
                    token.sessions = [];
                    await token.save();
                    return { success: true };
                }
                return { success: false, message: "Token not found." };
            } catch (err) {
                console.error("MongoDB Atlas clearSessions error, falling back to local JSON:", err);
            }
        }
        const data = readDb();
        const token = data.tokens.find(t => t.key.toUpperCase() === uKey);
        if (token) {
            token.sessions = [];
            writeDb(data);
            return { success: true };
        }
        return { success: false, message: "Token not found." };
    },

    getSettings: async () => {
        if (isMongo) {
            try {
                let settings = await SettingsModel.findOne({});
                if (!settings) {
                    settings = new SettingsModel({
                        isLive: false,
                        streamType: "whip",
                        streamTitle: "FIFA World Cup 2026 Live",
                        whipKey: "rieadfifa26",
                        hlsUrl: "",
                        youtubeUrl: "",
                        thumbnailUrl: "",
                        twitchChannel: "",
                        kickChannel: ""
                    });
                    await settings.save();
                }
                return settings.toObject();
            } catch (err) {
                console.error("MongoDB Atlas getSettings error, falling back to local JSON:", err);
            }
        }
        const data = readDb();
        if (!data.settings) {
            data.settings = {
                isLive: false,
                streamType: "whip",
                streamTitle: "FIFA World Cup 2026 Live",
                whipKey: "rieadfifa26",
                hlsUrl: "",
                youtubeUrl: "",
                thumbnailUrl: "",
                twitchChannel: "",
                kickChannel: ""
            };
            writeDb(data);
        }
        return data.settings;
    },

    saveSettings: async (settings) => {
        if (isMongo) {
            try {
                let doc = await SettingsModel.findOne({});
                if (!doc) {
                    doc = new SettingsModel();
                }
                doc.isLive = !!settings.isLive;
                doc.streamType = settings.streamType || "whip";
                doc.streamTitle = settings.streamTitle || "FIFA World Cup 2026 Live";
                doc.whipKey = settings.whipKey || "rieadfifa26";
                doc.hlsUrl = settings.hlsUrl || "";
                doc.youtubeUrl = settings.youtubeUrl || "";
                doc.thumbnailUrl = settings.thumbnailUrl || "";
                doc.twitchChannel = settings.twitchChannel || "";
                doc.kickChannel = settings.kickChannel || "";
                await doc.save();
                return { success: true, settings: doc.toObject() };
            } catch (err) {
                console.error("MongoDB Atlas saveSettings error, falling back to local JSON:", err);
            }
        }
        const data = readDb();
        data.settings = {
            isLive: !!settings.isLive,
            streamType: settings.streamType || "whip",
            streamTitle: settings.streamTitle || "FIFA World Cup 2026 Live",
            whipKey: settings.whipKey || "rieadfifa26",
            hlsUrl: settings.hlsUrl || "",
            youtubeUrl: settings.youtubeUrl || "",
            thumbnailUrl: settings.thumbnailUrl || "",
            twitchChannel: settings.twitchChannel || "",
            kickChannel: settings.kickChannel || ""
        };
        writeDb(data);
        return { success: true, settings: data.settings };
    },

    toggleChatPermission: async (key) => {
        const uKey = key.toUpperCase();
        if (isMongo) {
            try {
                const token = await TokenModel.findOne({ key: uKey });
                if (token) {
                    token.allowChat = !token.allowChat;
                    await token.save();
                    return { success: true, token: token.toObject() };
                }
                return { success: false, message: "Token not found." };
            } catch (err) {
                console.error("MongoDB Atlas toggleChatPermission error, falling back to local JSON:", err);
            }
        }
        const data = readDb();
        const token = data.tokens.find(t => t.key.toUpperCase() === uKey);
        if (token) {
            token.allowChat = !token.allowChat;
            writeDb(data);
            return { success: true, token };
        }
        return { success: false, message: "Token not found." };
    },

    getActiveSessions: async () => {
        const tokens = await db.getTokens();
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

    kickSession: async (sessionId) => {
        if (isMongo) {
            try {
                const tokens = await TokenModel.find({});
                let kicked = false;
                for (let t of tokens) {
                    const initialCount = t.sessions.length;
                    t.sessions = t.sessions.filter(s => s.id !== sessionId);
                    if (t.sessions.length < initialCount) {
                        await t.save();
                        kicked = true;
                    }
                }
                if (kicked) return { success: true };
                return { success: false, message: "Session not found." };
            } catch (err) {
                console.error("MongoDB Atlas kickSession error, falling back to local JSON:", err);
            }
        }
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

    toggleSessionChat: async (sessionId) => {
        if (isMongo) {
            try {
                const tokens = await TokenModel.find({});
                let found = false;
                for (let t of tokens) {
                    const session = t.sessions.find(s => s.id === sessionId);
                    if (session) {
                        session.allowChat = !session.allowChat;
                        await t.save();
                        found = true;
                    }
                }
                if (found) return { success: true };
                return { success: false, message: "Session not found." };
            } catch (err) {
                console.error("MongoDB Atlas toggleSessionChat error, falling back to local JSON:", err);
            }
        }
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

    getChatMessages: async () => {
        if (isMongo) {
            try {
                const chats = await ChatModel.find({}).sort({ timestamp: 1 }).limit(50);
                return chats.map(c => c.toObject());
            } catch (err) {
                console.error("MongoDB Atlas getChatMessages error, falling back to local JSON:", err);
            }
        }
        const data = readDb();
        if (!data.chat) {
            data.chat = [];
            writeDb(data);
        }
        return data.chat;
    },

    addChatMessage: async (senderName, text) => {
        if (isMongo) {
            try {
                const chatMsg = new ChatModel({
                    id: Math.random().toString(36).substring(2, 10),
                    senderName: senderName,
                    text: text.trim()
                });
                await chatMsg.save();
                
                // Clean old chats (> 50 messages)
                const count = await ChatModel.countDocuments({});
                if (count > 50) {
                    const oldest = await ChatModel.find({}).sort({ timestamp: 1 }).limit(count - 50);
                    const idsToDelete = oldest.map(o => o._id);
                    await ChatModel.deleteMany({ _id: { $in: idsToDelete } });
                }
                return { success: true, message: chatMsg.toObject() };
            } catch (err) {
                console.error("MongoDB Atlas addChatMessage error, falling back to local JSON:", err);
            }
        }
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

// Auto initialize local JSON DB on start
if (!isMongo) {
    initDb();
}

module.exports = db;
