const WebSocket = require('ws');

class TrackerLogger {
    constructor(debugMode = false) {
        this.isDebugMode = debugMode;
    }

    setDebugMode(enabled) {
        this.isDebugMode = enabled;
    }

    debug(...args) {
        if (this.isDebugMode) {
            console.log('[SIGNAL]', ...args);
        }
    }

    info(...args) {
        console.log('[SIGNAL]', ...args);
    }
}

const logger = new TrackerLogger(true);

class SignalTracker {
    constructor(apiUrl, senderNumber, targetNumber, debugMode = false) {
        this.apiUrl = apiUrl.replace(/\/$/, '');
        this.senderNumber = senderNumber;
        this.targetNumber = targetNumber;
        this.isTracking = false;
        this.deviceMetrics = new Map();
        this.globalRttHistory = [];
        this.probeMethod = 'reaction';
        this.ws = null;
        this.reconnectTimeout = null;
        this.onUpdate = undefined;
        this.pendingProbeStartTime = null;
        this.pendingProbeTimeout = null;
        this.probeResolve = null;
        this.activityEvents = [];
        this.passiveHeartbeatTimer = null;
        this.passiveConfidence = 20;
        this.passiveConfidenceLabel = 'Low';
        this.lastInboundAt = 0;
        this.lastCallAt = 0;
        this.lastSource = 'unknown';
        logger.setDebugMode(debugMode);
    }

    setProbeMethod(method) {
        if (method !== 'reaction' && method !== 'message' && method !== 'passive') {
            return;
        }
        this.probeMethod = method;
        if (method === 'passive') {
            this.pendingProbeStartTime = null;
            if (this.pendingProbeTimeout) {
                clearTimeout(this.pendingProbeTimeout);
                this.pendingProbeTimeout = null;
            }
            this.updatePassiveState();
            this.sendUpdate();
        }
        logger.info(`Probe method changed to: ${method}`);
    }

    getProbeMethod() {
        return this.probeMethod;
    }

    async startTracking() {
        if (this.isTracking) return;
        this.isTracking = true;
        logger.info(`Tracking started for ${this.targetNumber}`);
        logger.info(`Probe method: ${this.probeMethod}`);

        if (!this.deviceMetrics.has(this.targetNumber)) {
            this.deviceMetrics.set(this.targetNumber, {
                rttHistory: [],
                recentRtts: [],
                state: this.probeMethod === 'passive' ? 'Unknown' : 'Calibrating...',
                lastRtt: 0,
                lastUpdate: Date.now()
            });
        }

        if (this.onUpdate) {
            this.onUpdate({
                devices: [{
                    jid: this.targetNumber,
                    state: this.probeMethod === 'passive' ? 'Unknown' : 'Calibrating...',
                    rtt: 0,
                    avg: 0
                }],
                deviceCount: 1,
                presence: null,
                median: 0,
                threshold: 0
            });
        }

        this.connectWebSocket();
        this.passiveHeartbeatTimer = setInterval(() => {
            if (!this.isTracking) return;
            if (this.probeMethod === 'passive') {
                this.updatePassiveState();
            }
            this.sendUpdate();
        }, 12000);

        if (this.probeMethod !== 'passive') {
            this.probeLoop();
        } else {
            this.updatePassiveState();
            this.sendUpdate();
        }
    }

    pruneActivity(now) {
        const dayAgo = now - 86400000;
        this.activityEvents = this.activityEvents.filter((event) => event.timestamp >= dayAgo);
    }

    registerActivity(type, actorId) {
        const now = Date.now();
        this.activityEvents.push({
            type,
            actorId: actorId || this.targetNumber,
            timestamp: now
        });
        this.pruneActivity(now);
    }

    getActivityAnalytics() {
        const now = Date.now();
        this.pruneActivity(now);
        const hourAgo = now - 3600000;

        let messageCount1h = 0;
        let callCount1h = 0;
        let messageCount24h = 0;
        let callCount24h = 0;
        const actorCounts = new Map();
        const callerCounts = new Map();

        for (const event of this.activityEvents) {
            if (event.type === 'message') {
                messageCount24h += 1;
                if (event.timestamp >= hourAgo) messageCount1h += 1;
            } else if (event.type === 'call') {
                callCount24h += 1;
                if (event.timestamp >= hourAgo) callCount1h += 1;
            }

            actorCounts.set(event.actorId, (actorCounts.get(event.actorId) || 0) + 1);
            if (event.type === 'call') {
                callerCounts.set(event.actorId, (callerCounts.get(event.actorId) || 0) + 1);
            }
        }

        let topSource = null;
        let topSourceCount = 0;
        for (const [actorId, count] of actorCounts.entries()) {
            if (count > topSourceCount) {
                topSource = actorId;
                topSourceCount = count;
            }
        }

        let repeatedCaller = null;
        let repeatedCallerCount = 0;
        for (const [actorId, count] of callerCounts.entries()) {
            if (count > repeatedCallerCount) {
                repeatedCaller = actorId;
                repeatedCallerCount = count;
            }
        }

        const fingerprint = (value) => {
            if (!value) return null;
            return value.replace(/\D/g, '').slice(-6).padStart(6, '*');
        };

        return {
            messageCount1h,
            messageCount24h,
            callCount1h,
            callCount24h,
            repeatedCallerFingerprint: fingerprint(repeatedCaller),
            repeatedCallerCount,
            topSourceFingerprint: fingerprint(topSource),
            topSourceEvents24h: topSourceCount,
            lastInboundAt: this.lastInboundAt || null,
            lastCallAt: this.lastCallAt || null
        };
    }

    setPassiveConfidence(value) {
        const clamped = Math.max(10, Math.min(95, Math.round(value)));
        this.passiveConfidence = clamped;
        if (clamped >= 75) {
            this.passiveConfidenceLabel = 'High';
        } else if (clamped >= 50) {
            this.passiveConfidenceLabel = 'Medium';
        } else {
            this.passiveConfidenceLabel = 'Low';
        }
    }

    updatePassiveState() {
        const now = Date.now();
        const timeSinceInbound = this.lastInboundAt ? now - this.lastInboundAt : Infinity;
        const timeSinceCall = this.lastCallAt ? now - this.lastCallAt : Infinity;
        const recentActivityMs = Math.min(timeSinceInbound, timeSinceCall);

        const metrics = this.deviceMetrics.get(this.targetNumber);
        if (!metrics) return;

        if (recentActivityMs <= 45000) {
            metrics.state = 'Likely Active';
            this.setPassiveConfidence(76);
        } else if (recentActivityMs <= 180000) {
            metrics.state = 'Inconclusive';
            this.setPassiveConfidence(56);
        } else if (recentActivityMs <= 900000) {
            metrics.state = 'Likely Idle';
            this.setPassiveConfidence(42);
        } else {
            metrics.state = 'Unknown';
            this.setPassiveConfidence(28);
        }
    }

    connectWebSocket() {
        if (!this.isTracking) return;

        const wsUrl = this.apiUrl.replace('http', 'ws') + '/v1/receive/' + encodeURIComponent(this.senderNumber);
        logger.debug(`Connecting WebSocket to ${wsUrl}`);

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.on('open', () => {
                logger.info('WebSocket connected for receiving receipts');
            });

            this.ws.on('message', (data) => {
                try {
                    const raw = data.toString();
                    logger.debug('WebSocket raw message:', raw.substring(0, 500));
                    const message = JSON.parse(raw);
                    this.processJsonRpcMessage(message);
                } catch (err) {
                    logger.debug('Error parsing WebSocket message:', err);
                }
            });

            this.ws.on('close', () => {
                logger.debug('WebSocket closed');
                this.scheduleReconnect();
            });

            this.ws.on('error', (err) => {
                logger.debug('WebSocket error:', err);
                this.scheduleReconnect();
            });
        } catch (err) {
            logger.debug('Error creating WebSocket:', err);
            this.scheduleReconnect();
        }
    }

    scheduleReconnect() {
        if (!this.isTracking || this.reconnectTimeout) return;

        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            if (this.isTracking) {
                logger.debug('Reconnecting WebSocket...');
                this.connectWebSocket();
            }
        }, 5000);
    }

    processJsonRpcMessage(message) {
        const envelope = message.params?.envelope || message.envelope;

        if (!envelope) {
            logger.debug('No envelope in message');
            return;
        }

        const sourceNumber = envelope.sourceNumber || envelope.source;
        const isTargetSource = sourceNumber === this.targetNumber;

        if (isTargetSource && envelope.dataMessage) {
            this.lastInboundAt = Date.now();
            this.lastSource = 'phone';
            this.registerActivity('message', sourceNumber);
            if (!this.deviceMetrics.has(this.targetNumber)) {
                this.deviceMetrics.set(this.targetNumber, {
                    rttHistory: [],
                    recentRtts: [],
                    state: 'Calibrating...',
                    lastRtt: 0,
                    lastUpdate: Date.now()
                });
            }
            if (this.probeMethod === 'passive') {
                this.updatePassiveState();
                this.sendUpdate();
            }
        }

        if (isTargetSource && envelope.callMessage) {
            this.lastCallAt = Date.now();
            this.lastSource = 'phone';
            this.registerActivity('call', sourceNumber);
            if (this.probeMethod === 'passive') {
                this.updatePassiveState();
                this.sendUpdate();
            }
        }

        if (envelope.receiptMessage?.isDelivery) {
            logger.debug(`Delivery receipt from ${sourceNumber}`);

            if (this.pendingProbeStartTime !== null && sourceNumber === this.targetNumber) {
                const receiptTime = Date.now();
                const rtt = receiptTime - this.pendingProbeStartTime;

                logger.info(`Delivery receipt matched! RTT: ${rtt}ms`);

                if (this.pendingProbeTimeout) {
                    clearTimeout(this.pendingProbeTimeout);
                    this.pendingProbeTimeout = null;
                }

                this.addMeasurementForDevice(this.targetNumber, rtt);

                this.pendingProbeStartTime = null;
                if (this.probeResolve) {
                    this.probeResolve();
                    this.probeResolve = null;
                }
            }
        }
    }

    async probeLoop() {
        while (this.isTracking) {
            if (this.probeMethod === 'passive') {
                await new Promise((resolve) => setTimeout(resolve, 2500));
                continue;
            }

            try {
                await this.sendSerializedProbe();
            } catch (err) {
                logger.debug('Error sending probe:', err);
            }

            const delay = Math.floor(Math.random() * 1000) + 1000;
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }

    async sendSerializedProbe() {
        return new Promise(async (resolve) => {
            this.probeResolve = resolve;
            this.pendingProbeStartTime = Date.now();

            await this.sendProbe();

            this.pendingProbeTimeout = setTimeout(() => {
                if (this.pendingProbeStartTime !== null) {
                    const elapsed = Date.now() - this.pendingProbeStartTime;
                    logger.debug(`Probe timeout after ${elapsed}ms`);
                    this.markDeviceOffline(this.targetNumber, elapsed);
                    this.pendingProbeStartTime = null;
                    this.pendingProbeTimeout = null;
                    if (this.probeResolve) {
                        this.probeResolve();
                        this.probeResolve = null;
                    }
                }
            }, 15000);
        });
    }

    async sendProbe() {
        if (this.probeMethod === 'reaction') {
            await this.sendReactionProbe();
        } else {
            await this.sendMessageProbe();
        }
    }

    async sendReactionProbe() {
        const timestamp = Date.now();
        const reactions = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
        const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];

        try {
            const response = await fetch(`${this.apiUrl}/v1/reactions/${encodeURIComponent(this.senderNumber)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    reaction: randomReaction,
                    recipient: this.targetNumber,
                    target_author: this.targetNumber,
                    timestamp: timestamp - 86400000
                })
            });

            if (!response.ok && response.status !== 204) {
                const errorText = await response.text();
                logger.debug(`Failed to send reaction probe: ${response.status} - ${errorText}`);
            }
        } catch (err) {
            logger.debug('Error sending reaction probe:', err);
        }
    }

    async sendMessageProbe() {
        try {
            const response = await fetch(`${this.apiUrl}/v2/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    number: this.senderNumber,
                    recipients: [this.targetNumber],
                    message: '\u200B'
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                logger.debug(`Failed to send message probe: ${response.status} - ${errorText}`);
            }
        } catch (err) {
            logger.debug('Error sending message probe:', err);
        }
    }

    markDeviceOffline(identifier, timeout) {
        if (!this.deviceMetrics.has(identifier)) {
            this.deviceMetrics.set(identifier, {
                rttHistory: [],
                recentRtts: [],
                state: 'OFFLINE',
                lastRtt: timeout,
                lastUpdate: Date.now()
            });
        } else {
            const metrics = this.deviceMetrics.get(identifier);
            metrics.state = 'OFFLINE';
            metrics.lastRtt = timeout;
            metrics.lastUpdate = Date.now();
        }

        logger.info(`Device ${identifier} marked as OFFLINE (no receipt after ${timeout}ms)`);
        this.sendUpdate();
    }

    addMeasurementForDevice(identifier, rtt) {
        if (!this.deviceMetrics.has(identifier)) {
            this.deviceMetrics.set(identifier, {
                rttHistory: [],
                recentRtts: [],
                state: 'Calibrating...',
                lastRtt: rtt,
                lastUpdate: Date.now()
            });
        }

        const metrics = this.deviceMetrics.get(identifier);

        if (rtt <= 5000) {
            metrics.recentRtts.push(rtt);
            if (metrics.recentRtts.length > 3) {
                metrics.recentRtts.shift();
            }

            metrics.rttHistory.push(rtt);
            if (metrics.rttHistory.length > 2000) {
                metrics.rttHistory.shift();
            }

            this.globalRttHistory.push(rtt);
            if (this.globalRttHistory.length > 2000) {
                this.globalRttHistory.shift();
            }

            metrics.lastRtt = rtt;
            metrics.lastUpdate = Date.now();

            this.determineDeviceState(identifier);
        }

        this.sendUpdate();
    }

    determineDeviceState(identifier) {
        const metrics = this.deviceMetrics.get(identifier);
        if (!metrics) return;

        if (metrics.state === 'OFFLINE') {
            if (metrics.lastRtt <= 5000 && metrics.recentRtts.length > 0) {
                logger.debug(`Device ${identifier} came back online (RTT: ${metrics.lastRtt}ms)`);
            } else {
                return;
            }
        }

        const movingAvg = metrics.recentRtts.reduce((a, b) => a + b, 0) / metrics.recentRtts.length;
        let median = 0;
        let threshold = 0;

        if (this.globalRttHistory.length >= 3) {
            const sorted = [...this.globalRttHistory].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
            threshold = median * 0.9;

            metrics.state = movingAvg < threshold ? 'Online' : 'Standby';
        } else {
            metrics.state = 'Calibrating...';
        }

        logger.info(`${identifier}: ${metrics.state} (RTT: ${metrics.lastRtt}ms, Avg: ${movingAvg.toFixed(0)}ms)`);
    }

    sendUpdate() {
        const devices = Array.from(this.deviceMetrics.entries()).map(([id, metrics]) => ({
            jid: id,
            state: metrics.state,
            rtt: metrics.lastRtt,
            avg: metrics.recentRtts.length > 0
                ? metrics.recentRtts.reduce((a, b) => a + b, 0) / metrics.recentRtts.length
                : 0
        }));

        const globalMedian = this.calculateGlobalMedian();
        const globalThreshold = globalMedian * 0.9;

        const data = {
            devices,
            deviceCount: 1,
            presence: null,
            median: globalMedian,
            threshold: globalThreshold,
            source: this.lastSource,
            confidence: this.probeMethod === 'passive' ? this.passiveConfidence : undefined,
            confidenceLabel: this.probeMethod === 'passive' ? this.passiveConfidenceLabel : undefined,
            probeMode: this.probeMethod === 'passive' ? 'passive' : 'active',
            analytics: this.getActivityAnalytics(),
            timestamp: Date.now()
        };

        if (this.onUpdate) {
            this.onUpdate(data);
        }
    }

    calculateGlobalMedian() {
        if (this.globalRttHistory.length < 3) return 0;

        const sorted = [...this.globalRttHistory].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    stopTracking() {
        this.isTracking = false;

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        if (this.pendingProbeTimeout) {
            clearTimeout(this.pendingProbeTimeout);
            this.pendingProbeTimeout = null;
        }
        if (this.passiveHeartbeatTimer) {
            clearInterval(this.passiveHeartbeatTimer);
            this.passiveHeartbeatTimer = null;
        }

        this.pendingProbeStartTime = null;

        if (this.probeResolve) {
            this.probeResolve();
            this.probeResolve = null;
        }

        logger.info('Tracking stopped');
    }
}

async function getSignalAccounts(apiUrl) {
    try {
        const response = await fetch(`${apiUrl}/v1/accounts`);
        if (response.ok) {
            const data = await response.json();
            return data.map((acc) => acc.number || acc);
        }
    } catch (err) {
        console.error('[SIGNAL] Failed to get accounts:', err);
    }

    return [];
}

function getSignalQrLinkUrl(apiUrl, deviceName = 'activity-tracker') {
    return `${apiUrl}/v1/qrcodelink?device_name=${encodeURIComponent(deviceName)}`;
}

async function checkSignalNumber(apiUrl, senderNumber, targetNumber) {
    try {
        const response = await fetch(
            `${apiUrl}/v1/search/${encodeURIComponent(senderNumber)}?numbers=${encodeURIComponent(targetNumber)}`,
            { signal: AbortSignal.timeout(30000) }
        );

        if (response.ok) {
            const results = await response.json();
            if (Array.isArray(results) && results.length > 0) {
                const result = results[0];
                if (result.registered) {
                    return { registered: true };
                }

                return {
                    registered: false,
                    error: 'Number is not registered on Signal or has privacy settings blocking discovery'
                };
            }
        }

        return { registered: false, error: 'Failed to check Signal registration status' };
    } catch (err) {
        return { registered: false, error: `Signal API error: ${err}` };
    }
}

module.exports = {
    SignalTracker,
    getSignalAccounts,
    getSignalQrLinkUrl,
    checkSignalNumber
};
