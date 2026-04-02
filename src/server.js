/**
 * Device Activity Tracker - Web Server
 * Using whatsapp-web.js (Puppeteer-based)
 *
 * HTTP server with Socket.IO for real-time tracking visualization.
 * Provides REST API and WebSocket interface for the React frontend.
 *
 * For educational and research purposes only.
 */

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { WhatsAppTracker } = require('./tracker');
const { SignalTracker, getSignalAccounts, checkSignalNumber } = require('./signal-tracker');

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

let client;
let isWhatsAppConnected = false;
let isSignalConnected = false;
let signalAccountNumber = null;
let globalProbeMethod = 'delete';
let globalStealthMode = true;
let currentWhatsAppQr = null;
let signalLinkingInProgress = false;
let signalApiAvailable = false;
let currentSignalQrUrl = null;
const trackers = new Map();
const SIGNAL_API_URL = process.env.SIGNAL_API_URL || 'http://localhost:8080';
const WHATSAPP_RECONNECT_DELAY_MS = 15000;

function initializeClient() {
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            executablePath: '/usr/bin/chromium-browser'
        }
    });

    client.on('qr', (qr) => {
        console.log('QR Code received');
        currentWhatsAppQr = qr;

        // Convert to image and emit
        qrcode.toDataURL(qr, (err, url) => {
            if (!err) {
                io.emit('qr', url);
            }
        });
    });

    client.on('ready', () => {
        console.log('WhatsApp client is ready');
        isWhatsAppConnected = true;
        currentWhatsAppQr = null;
        io.emit('connection-open');
    });

    client.on('disconnected', (reason) => {
        console.log('WhatsApp client disconnected:', reason);
        isWhatsAppConnected = false;
        currentWhatsAppQr = null;
        io.emit('connection-close');

        // Reconnect after delay
        setTimeout(() => {
            console.log(`Attempting to reconnect in ${WHATSAPP_RECONNECT_DELAY_MS}ms...`);
            client.initialize().catch(err => console.error('Reconnection failed:', err));
        }, WHATSAPP_RECONNECT_DELAY_MS);
    });

    client.on('message', (message) => {
        for (const entry of trackers.values()) {
            if (entry.platform !== 'whatsapp') continue;
            if (entry.tracker && typeof entry.tracker.observeInboundMessage === 'function') {
                entry.tracker.observeInboundMessage(message);
            }
        }
    });

    client.on('incoming_call', (call) => {
        for (const entry of trackers.values()) {
            if (entry.platform !== 'whatsapp') continue;
            if (entry.tracker && typeof entry.tracker.observeIncomingCall === 'function') {
                entry.tracker.observeIncomingCall(call);
            }
        }
    });

    client.on('message_ack', (message, ack) => {
        for (const entry of trackers.values()) {
            if (entry.platform !== 'whatsapp') continue;
            if (entry.tracker && typeof entry.tracker.handleMessageAck === 'function') {
                entry.tracker.handleMessageAck(message, ack);
            }
        }
    });

    // Initialize
    client.initialize().catch(err => {
        console.error('Failed to initialize WhatsApp client:', err);
        setTimeout(() => initializeClient(), WHATSAPP_RECONNECT_DELAY_MS);
    });
}

initializeClient();

async function checkSignalApiAvailable() {
    try {
        const response = await fetch(`${SIGNAL_API_URL}/v1/about`, {
            signal: AbortSignal.timeout(2000)
        });
        return response.ok;
    } catch {
        return false;
    }
}

async function startSignalLinking() {
    if (signalLinkingInProgress || isSignalConnected) return;

    signalLinkingInProgress = true;
    console.log('[SIGNAL] Starting device linking...');

    try {
        const response = await fetch(`${SIGNAL_API_URL}/v1/qrcodelink?device_name=activity-tracker`);
        if (!response.ok) {
            console.log('[SIGNAL] Failed to start linking:', response.status);
            signalLinkingInProgress = false;
            return;
        }

        currentSignalQrUrl = `${SIGNAL_API_URL}/v1/qrcodelink?device_name=activity-tracker&t=${Date.now()}`;
        io.emit('signal-qr-image', currentSignalQrUrl);
        pollSignalLinkingStatus();
    } catch (err) {
        console.log('[SIGNAL] Error starting linking:', err);
        signalLinkingInProgress = false;
    }
}

function pollSignalLinkingStatus() {
    const checkInterval = setInterval(async () => {
        try {
            const accounts = await getSignalAccounts(SIGNAL_API_URL);
            if (accounts.length > 0) {
                clearInterval(checkInterval);
                signalLinkingInProgress = false;
                currentSignalQrUrl = null;
                isSignalConnected = true;
                signalAccountNumber = accounts[0];
                console.log(`[SIGNAL] Linking completed! Account: ${signalAccountNumber}`);
                io.emit('signal-connection-open', { number: signalAccountNumber });
            }
        } catch {
            // keep polling
        }
    }, 2000);

    setTimeout(() => {
        clearInterval(checkInterval);
        signalLinkingInProgress = false;
    }, 300000);
}

async function checkSignalConnection() {
    try {
        const available = await checkSignalApiAvailable();
        if (available !== signalApiAvailable) {
            signalApiAvailable = available;
            console.log(`[SIGNAL] API available: ${available}`);
            io.emit('signal-api-status', { available });
        }

        if (!available) {
            if (isSignalConnected) {
                isSignalConnected = false;
                signalAccountNumber = null;
                io.emit('signal-disconnected');
            }
            return;
        }

        const accounts = await getSignalAccounts(SIGNAL_API_URL);
        if (accounts.length > 0) {
            if (!isSignalConnected) {
                isSignalConnected = true;
                signalAccountNumber = accounts[0];
                signalLinkingInProgress = false;
                currentSignalQrUrl = null;
                console.log(`[SIGNAL] Connected with account: ${signalAccountNumber}`);
                io.emit('signal-connection-open', { number: signalAccountNumber });
            }
        } else {
            if (isSignalConnected) {
                isSignalConnected = false;
                signalAccountNumber = null;
                io.emit('signal-disconnected');
            }
            if (!signalLinkingInProgress) {
                startSignalLinking();
            }
        }
    } catch (err) {
        console.log('[SIGNAL] Error checking connection:', err);
        if (isSignalConnected) {
            isSignalConnected = false;
            signalAccountNumber = null;
            io.emit('signal-disconnected');
        }
    }
}

checkSignalConnection();
setInterval(checkSignalConnection, 15000);

io.on('connection', (socket) => {
    console.log('Client connected');

    if (currentWhatsAppQr) {
        qrcode.toDataURL(currentWhatsAppQr, (err, url) => {
            if (!err) {
                socket.emit('qr', url);
            }
        });
    }

    if (isWhatsAppConnected) {
        socket.emit('connection-open');
    }

    if (isSignalConnected && signalAccountNumber) {
        socket.emit('signal-connection-open', { number: signalAccountNumber });
    }

    socket.emit('signal-api-status', { available: signalApiAvailable });

    if (signalLinkingInProgress && currentSignalQrUrl) {
        socket.emit('signal-qr-image', currentSignalQrUrl);
    }

    socket.emit('probe-method', globalProbeMethod);
    socket.emit('stealth-mode', { enabled: globalStealthMode });

    socket.on('logout-whatsapp', async () => {
        try {
            for (const [id, entry] of [...trackers.entries()]) {
                if (entry.platform === 'whatsapp') {
                    entry.tracker.stopTracking();
                    trackers.delete(id);
                    io.emit('contact-removed', id);
                }
            }

            if (client) {
                try {
                    await client.logout();
                } catch (logoutErr) {
                    console.warn('[WHATSAPP] logout warning:', (logoutErr && logoutErr.message) || logoutErr);
                }

                try {
                    await client.destroy();
                } catch (destroyErr) {
                    console.warn('[WHATSAPP] destroy warning:', (destroyErr && destroyErr.message) || destroyErr);
                }
            }

            isWhatsAppConnected = false;
            currentWhatsAppQr = null;
            io.emit('connection-close');
            initializeClient();
        } catch (err) {
            console.error('[WHATSAPP] Failed to logout:', err);
            socket.emit('error', { message: 'Failed to logout WhatsApp session' });
        }
    });

    socket.on('get-tracked-contacts', () => {
        const trackedContacts = Array.from(trackers.entries()).map(([id, entry]) => ({
            id,
            platform: entry.platform
        }));
        socket.emit('tracked-contacts', trackedContacts);

        for (const [jid, entry] of trackers.entries()) {
            if (entry.contactName) {
                socket.emit('contact-name', { jid, name: entry.contactName });
            }

            if (entry.profilePic !== undefined) {
                socket.emit('profile-pic', { jid, url: entry.profilePic || null });
            }
        }
    });

    socket.on('add-contact', async (data) => {
        const platform = typeof data === 'string' ? 'whatsapp' : (data.platform || 'whatsapp');
        const number = typeof data === 'string' ? data : data.number;
        const cleanNumber = number.replace(/\D/g, '');

        if (platform === 'signal') {
            if (!isSignalConnected || !signalAccountNumber) {
                socket.emit('error', { message: 'Signal is not connected. Link Signal first.' });
                return;
            }

            const signalId = `signal:${cleanNumber}`;
            if (trackers.has(signalId)) {
                socket.emit('error', { jid: signalId, message: 'Already tracking this contact on Signal' });
                return;
            }

            try {
                const targetNumber = cleanNumber.startsWith('+') ? cleanNumber : `+${cleanNumber}`;
                const checkResult = await checkSignalNumber(SIGNAL_API_URL, signalAccountNumber, targetNumber);

                if (!checkResult.registered) {
                    socket.emit('error', {
                        jid: signalId,
                        message: checkResult.error || 'Number is not registered on Signal'
                    });
                    return;
                }

                const tracker = new SignalTracker(SIGNAL_API_URL, signalAccountNumber, targetNumber);
                tracker.setProbeMethod(globalProbeMethod === 'delete' ? 'reaction' : globalProbeMethod);
                trackers.set(signalId, {
                    tracker,
                    platform: 'signal',
                    contactName: cleanNumber,
                    profilePic: null
                });

                tracker.onUpdate = (updateData) => {
                    io.emit('tracker-update', {
                        jid: signalId,
                        platform: 'signal',
                        ...updateData
                    });
                };

                tracker.startTracking();

                socket.emit('contact-added', {
                    jid: signalId,
                    number: cleanNumber,
                    platform: 'signal'
                });

                io.emit('contact-name', { jid: signalId, name: cleanNumber });
            } catch (err) {
                console.error('[SIGNAL] Failed to start tracking:', err);
                socket.emit('error', { message: 'Failed to start Signal tracking' });
            }
            return;
        }

        if (!isWhatsAppConnected) {
            socket.emit('error', { message: 'WhatsApp is not connected. Scan QR code first.' });
            return;
        }

        console.log(`Request to track WhatsApp: ${number}`);

        try {
            const chatId = `${cleanNumber}@c.us`;

            if (trackers.has(chatId)) {
                socket.emit('error', { jid: chatId, message: 'Already tracking this contact' });
                return;
            }

            // Check if contact exists
            const contact = await client.getContactById(chatId);
            if (!contact) {
                socket.emit('error', { jid: chatId, message: 'Contact not found' });
                return;
            }

            const contactName = contact.name || contact.pushname || cleanNumber;
            console.log(`Found contact: ${contactName}`);

            // Determine exact JID to use (WhatsApp uses serialized IDs)
            const targetJid = (contact && contact.id && contact.id._serialized) ? contact.id._serialized : chatId;

            // Create tracker
            const tracker = new WhatsAppTracker(client, targetJid, cleanNumber);
            tracker.setProbeMethod(globalProbeMethod);
            tracker.setStealthMode(globalStealthMode);
            trackers.set(targetJid, {
                tracker,
                platform: 'whatsapp',
                contactName,
                profilePic: null
            });

            tracker.onUpdate = (updateData) => {
                io.emit('tracker-update', {
                    jid: targetJid,
                    platform: 'whatsapp',
                    ...updateData
                });
            };

            tracker.startTracking();

            socket.emit('contact-added', {
                jid: targetJid,
                number: cleanNumber,
                platform: 'whatsapp'
            });

            io.emit('contact-name', { jid: targetJid, name: contactName });

            try {
                const profilePic = await contact.getProfilePicUrl();
                const trackerEntry = trackers.get(targetJid);
                if (trackerEntry) {
                    trackerEntry.profilePic = profilePic || null;
                }
                io.emit('profile-pic', { jid: targetJid, url: profilePic || null });
            } catch (profileErr) {
                console.warn(`Failed to fetch profile picture for ${targetJid}:`, (profileErr && profileErr.message) || profileErr);
                io.emit('profile-pic', { jid: targetJid, url: null });
            }
        } catch (err) {
            console.error('Error tracking contact:', err);
            socket.emit('error', { message: 'Failed to track contact' });
        }
    });

    socket.on('remove-contact', (jid) => {
        console.log(`Request to stop tracking: ${jid}`);
        const entry = trackers.get(jid);
        if (entry) {
            entry.tracker.stopTracking();
            trackers.delete(jid);
            socket.emit('contact-removed', jid);
        }
    });

    socket.on('set-probe-method', (method) => {
        console.log(`Request to change probe method to: ${method}`);
        if (method !== 'delete' && method !== 'reaction' && method !== 'passive') {
            socket.emit('error', { message: 'Invalid probe method' });
            return;
        }

        globalProbeMethod = method;

        for (const entry of trackers.values()) {
            if (entry.platform === 'whatsapp') {
                entry.tracker.setProbeMethod(method);
            } else if (entry.platform === 'signal') {
                entry.tracker.setProbeMethod(method === 'delete' ? 'reaction' : method);
            }
        }

        io.emit('probe-method', method);
        console.log(`Probe method changed to: ${method}`);
    });

    socket.on('set-stealth-mode', (data) => {
        const enabled = data && typeof data.enabled === 'boolean' ? data.enabled : false;
        globalStealthMode = enabled;

        for (const entry of trackers.values()) {
            if (entry.platform === 'whatsapp') {
                entry.tracker.setStealthMode(enabled);
            }
        }

        io.emit('stealth-mode', { enabled });
        console.log(`Stealth mode ${enabled ? 'enabled' : 'disabled'}`);
    });
});

const PORT = parseInt(process.env.PORT || '3001', 10);
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
