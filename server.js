const express = require('express');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Custom cookie-parser middleware
app.use((req, res, next) => {
    req.cookies = {};
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
        cookieHeader.split(';').forEach(cookie => {
            const parts = cookie.split('=');
            if (parts.length >= 2) {
                req.cookies[parts[0].trim()] = parts.slice(1).join('=').trim();
            }
        });
    }
    next();
});

// Middlewares to protect routes
async function requireUserAuth(req, res, next) {
    const sessionToken = req.cookies.user_session;
    const licenseKey = req.cookies.license_key;

    if (!sessionToken || !licenseKey) {
        return res.redirect('/login');
    }

    // Verify active session in DB
    try {
        const tokenData = await db.getToken(licenseKey);
        if (!tokenData || tokenData.status !== 'ACTIVE') {
            res.clearCookie('user_session');
            res.clearCookie('license_key');
            return res.redirect('/login');
        }

        const activeSession = tokenData.sessions.find(s => s.id === sessionToken);
        if (!activeSession || Date.now() > activeSession.expiresAt) {
            res.clearCookie('user_session');
            res.clearCookie('license_key');
            return res.redirect('/login');
        }

        next();
    } catch (err) {
        console.error(err);
        res.redirect('/login');
    }
}

function requireAdminAuth(req, res, next) {
    const adminSession = req.cookies.admin_session;
    if (adminSession !== 'authorized_riead_admin') {
        return res.redirect('/admin');
    }
    next();
}

// Page Routes
app.get('/', requireUserAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-login.html'));
});

app.get('/admin/dashboard', requireAdminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-dashboard.html'));
});

// API endpoints for User authentication
app.post('/api/login', async (req, res) => {
    const { licenseKey, name } = req.body;
    if (!name || !licenseKey) {
        return res.status(400).json({ success: false, message: "Name and License key are required." });
    }

    const sessionId = crypto.randomBytes(16).toString('hex');
    try {
        const result = await db.addSession(licenseKey, name, sessionId);
        if (result.success) {
            res.cookie('user_session', sessionId, { maxAge: 24 * 60 * 60 * 1000, httpOnly: true });
            res.cookie('license_key', licenseKey.toUpperCase(), { maxAge: 24 * 60 * 60 * 1000, httpOnly: true });
            return res.json({ success: true });
        } else {
            return res.status(401).json({ success: false, message: result.message });
        }
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/logout', async (req, res) => {
    const sessionToken = req.cookies.user_session;
    const licenseKey = req.cookies.license_key;
    if (licenseKey && sessionToken) {
        try {
            await db.removeSession(licenseKey, sessionToken);
        } catch (err) {
            console.error(err);
        }
    }
    res.clearCookie('user_session');
    res.clearCookie('license_key');
    res.json({ success: true });
});

// API endpoints for Admin Auth & Management
app.post('/api/admin/login', (req, res) => {
    const { passkey } = req.body;
    if (passkey === 'riead07@#%') {
        res.cookie('admin_session', 'authorized_riead_admin', { maxAge: 2 * 60 * 60 * 1000, httpOnly: true });
        return res.json({ success: true });
    }
    return res.status(401).json({ success: false, message: "Invalid Admin Passkey." });
});

app.post('/api/admin/logout', (req, res) => {
    res.clearCookie('admin_session');
    res.json({ success: true });
});

// Admin management operations (protected)
app.get('/api/admin/tokens', requireAdminAuth, async (req, res) => {
    try {
        const tokens = await db.getTokens();
        res.json(tokens);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/create-token', requireAdminAuth, async (req, res) => {
    const { key, termDays, maxDevices, allowChat } = req.body;
    if (!key) {
        return res.status(400).json({ success: false, message: "Token Key is required." });
    }
    try {
        const result = await db.createToken(key.toUpperCase(), termDays, maxDevices, allowChat);
        if (result.success) {
            return res.json({ success: true, token: result.token });
        } else {
            return res.status(400).json({ success: false, message: result.message });
        }
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/toggle-token', requireAdminAuth, async (req, res) => {
    const { key } = req.body;
    try {
        const result = await db.toggleTokenStatus(key);
        if (result.success) {
            return res.json({ success: true, token: result.token });
        }
        return res.status(400).json({ success: false, message: result.message });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/delete-token', requireAdminAuth, async (req, res) => {
    const { key } = req.body;
    try {
        const result = await db.deleteToken(key);
        if (result.success) {
            return res.json({ success: true });
        }
        return res.status(400).json({ success: false, message: result.message });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/clear-all', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.clearAllTokens();
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/clear-sessions', requireAdminAuth, async (req, res) => {
    const { key } = req.body;
    try {
        const result = await db.clearSessions(key);
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/toggle-chat', requireAdminAuth, async (req, res) => {
    const { key } = req.body;
    try {
        const result = await db.toggleChatPermission(key);
        if (result.success) {
            return res.json({ success: true, token: result.token });
        }
        return res.status(400).json({ success: false, message: result.message });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/admin/sessions', requireAdminAuth, async (req, res) => {
    try {
        const sessions = await db.getActiveSessions();
        res.json(sessions);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/kick-session', requireAdminAuth, async (req, res) => {
    const { sessionId } = req.body;
    try {
        const result = await db.kickSession(sessionId);
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/toggle-session-chat', requireAdminAuth, async (req, res) => {
    const { sessionId } = req.body;
    try {
        const result = await db.toggleSessionChat(sessionId);
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Settings operations
app.get('/api/settings', requireUserAuth, async (req, res) => {
    const licenseKey = req.cookies.license_key;
    const sessionToken = req.cookies.user_session;
    try {
        const tokenData = await db.getToken(licenseKey);
        const settings = await db.getSettings();
        if (!tokenData) {
            return res.status(401).json({ success: false, message: "Unauthorized." });
        }
        const activeSession = tokenData.sessions.find(s => s.id === sessionToken);
        const activeViewerCount = (await db.getActiveSessions()).length;
        const dbType = db.isMongo() ? 'MongoDB Atlas (Persistent)' : 'Local JSON File (Temporary)';
        res.json({
            ...settings,
            allowChat: activeSession ? !!activeSession.allowChat : false,
            viewerName: activeSession ? activeSession.name : "Viewer",
            activeViewerCount,
            dbType
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/admin/settings', requireAdminAuth, async (req, res) => {
    try {
        const settings = await db.getSettings();
        const dbType = db.isMongo() ? 'MongoDB Atlas (Persistent)' : 'Local JSON File (Temporary)';
        res.json({
            ...settings,
            dbType
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/settings', requireAdminAuth, async (req, res) => {
    const { isLive, streamType, streamTitle, whipKey, hlsUrl, youtubeUrl, thumbnailUrl, twitchChannel, kickChannel } = req.body;
    try {
        const result = await db.saveSettings({ isLive, streamType, streamTitle, whipKey, hlsUrl, youtubeUrl, thumbnailUrl, twitchChannel, kickChannel });
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Synchronized Chat operations
app.get('/api/chat', requireUserAuth, async (req, res) => {
    try {
        const chats = await db.getChatMessages();
        res.json(chats);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/chat', requireUserAuth, async (req, res) => {
    const { text } = req.body;
    if (!text || !text.trim()) {
        return res.status(400).json({ success: false, message: "Message text is required." });
    }
    const licenseKey = req.cookies.license_key;
    const sessionToken = req.cookies.user_session;
    try {
        const tokenData = await db.getToken(licenseKey);
        if (!tokenData) {
            return res.status(401).json({ success: false, message: "Unauthorized." });
        }
        const activeSession = tokenData.sessions.find(s => s.id === sessionToken);
        if (!activeSession || !activeSession.allowChat) {
            return res.status(403).json({ success: false, message: "You are not permitted to comment." });
        }
        const result = await db.addChatMessage(activeSession.name, text.trim());
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
