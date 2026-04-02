// WhatsApp Tracker - RTT-based activity detection
class WhatsAppTracker {
    constructor(client, jid, number) {
        this.client = client;
        this.jid = jid;
        this.number = number;
        this.isTracking = false;
        this.probeMethod = 'delete';
        this.stealthMode = true;
        
        // RTT tracking
        this.probeStartTimes = new Map(); // messageId -> timestamp
        this.rttHistory = [];
        this.recentRtts = [];
        this.deviceState = 'Calibrating...';
        this.lastRtt = 0;
        this.activityEvents = [];
        this.lastInboundAt = null;
        this.lastCallAt = null;
    }

    setProbeMethod(method) {
        this.probeMethod = method;
        console.log(`Probe method changed to: ${method}`);
    }

    setStealthMode(enabled) {
        this.stealthMode = enabled;
        console.log(`Stealth mode ${enabled ? 'enabled' : 'disabled'} for ${this.number}`);
    }

    pruneActivity(now = Date.now()) {
        const dayAgo = now - 86400000;
        this.activityEvents = this.activityEvents.filter((event) => event.timestamp >= dayAgo);
    }

    registerActivity(type, actorId) {
        const now = Date.now();
        this.activityEvents.push({
            type,
            actorId: actorId || this.number,
            timestamp: now
        });
        this.pruneActivity(now);
        if (type === 'message') {
            this.lastInboundAt = now;
        } else if (type === 'call') {
            this.lastCallAt = now;
        }
    }

    getActivityAnalytics() {
        const now = Date.now();
        const hourAgo = now - 3600000;
        this.pruneActivity(now);

        let messageCount1h = 0;
        let messageCount24h = 0;
        let callCount1h = 0;
        let callCount24h = 0;
        const actorCounts = new Map();
        const callerCounts = new Map();

        for (const event of this.activityEvents) {
            if (event.type === 'message') {
                messageCount24h += 1;
                if (event.timestamp >= hourAgo) messageCount1h += 1;
            }

            if (event.type === 'call') {
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
            lastInboundAt: this.lastInboundAt,
            lastCallAt: this.lastCallAt
        };
    }

    observeInboundMessage(message) {
        if (!message || message.fromMe) return;
        const incomingId = message.from || message.author || '';
        if (incomingId === this.jid) {
            this.registerActivity('message', this.number);
            this.emitUpdate();
        }
    }

    observeIncomingCall(call) {
        if (!call) return;
        const callerId = call.from || call.peerJid || '';
        if (callerId === this.jid) {
            this.registerActivity('call', this.number);
            this.emitUpdate();
        }
    }

    async startTracking() {
        if (this.isTracking) return;
        this.isTracking = true;
        console.log(`Started tracking ${this.number} on WhatsApp`);

        // Listen for message acknowledgments
        this.client.on('message_ack', (message, ack) => {
            this.handleMessageAck(message, ack);
        });

        // Start probe loop
        this.probeLoop();
    }

    async probeLoop() {
        while (this.isTracking) {
            try {
                await this.sendProbe();
            } catch (err) {
                console.error('Error in probe loop:', err.message);
            }
            // Send probe every 2-3 seconds
            const delay = Math.random() * 1000 + 2000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    async sendProbe() {
        try {
            const startTime = Date.now();
            
            // Send a simple text message as probe (space character)
            const msg = await this.client.sendMessage(this.jid, ' ');
            
            if (msg && msg.id) {
                this.probeStartTimes.set(msg.id.id, startTime);
                console.log(`[PROBE] Sent probe ${msg.id.id} to ${this.number}`);
            }

            // Set timeout - if no ACK in 10 seconds, mark as offline
            if (msg && msg.id) {
                setTimeout(() => {
                    if (this.probeStartTimes.has(msg.id.id)) {
                        console.log(`[TIMEOUT] No ACK for ${msg.id.id} - marking offline`);
                        this.probeStartTimes.delete(msg.id.id);
                        this.markOffline();
                    }
                }, 10000);
            }

        } catch (err) {
            console.error('Failed to send probe:', err.message);
        }
    }

    handleMessageAck(message, ack) {
        // ack values: 1=pending, 2=sent, 3=delivered, 4=read
        if (!message || !message.id) return;

        const msgId = message.id.id;
        const startTime = this.probeStartTimes.get(msgId);

        if (startTime && ack >= 3) { // Only care about delivered (3) or read (4)
            const rtt = Date.now() - startTime;
            this.probeStartTimes.delete(msgId);

            console.log(`[ACK] Message ${msgId} delivered with RTT: ${rtt}ms, State: ${ack}`);
            this.addMeasurement(rtt);
        }
    }

    addMeasurement(rtt) {
        // Filter outliers
        if (rtt > 15000) return;

        // Add to recent RTTs (for moving average)
        this.recentRtts.push(rtt);
        if (this.recentRtts.length > 5) {
            this.recentRtts.shift();
        }

        // Add to history
        this.rttHistory.push(rtt);
        if (this.rttHistory.length > 100) {
            this.rttHistory.shift();
        }

        this.lastRtt = rtt;
        this.determineState();
        this.emitUpdate();
    }

    determineState() {
        if (this.rttHistory.length < 3) {
            this.deviceState = 'Calibrating...';
            return;
        }

        const avgRtt = this.recentRtts.reduce((a, b) => a + b, 0) / this.recentRtts.length;
        const sorted = [...this.rttHistory].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const threshold = median * 0.9;

        if (avgRtt < threshold) {
            this.deviceState = 'Online';
        } else {
            this.deviceState = 'Standby';
        }
    }

    markOffline() {
        this.deviceState = 'Offline';
        this.emitUpdate();
        console.log(`[STATUS] ${this.number} marked as OFFLINE`);
    }

    emitUpdate() {
        if (this.onUpdate) {
            const avgRtt = this.recentRtts.length > 0 
                ? this.recentRtts.reduce((a, b) => a + b, 0) / this.recentRtts.length
                : 0;
            
            const sorted = this.rttHistory.length > 0 
                ? [...this.rttHistory].sort((a, b) => a - b)
                : [];
            const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;

            this.onUpdate({
                state: this.deviceState,
                lastRtt: this.lastRtt,
                avgRtt: Math.round(avgRtt),
                median: Math.round(median),
                measurements: this.rttHistory.length,
                analytics: this.getActivityAnalytics()
            });
        }
    }

    stopTracking() {
        this.isTracking = false;
        this.probeStartTimes.clear();
        console.log(`Stopped tracking ${this.number}`);
    }
}

module.exports = { WhatsAppTracker };
