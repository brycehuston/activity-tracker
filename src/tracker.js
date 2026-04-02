// WhatsApp Tracker - RTT-based activity detection
class WhatsAppTracker {
    constructor(client, jid, number) {
        this.client = client;
        this.jid = jid;
        this.number = number;
        this.isTracking = false;
        this.probeMethod = 'delete';
        
        // RTT tracking
        this.probeStartTimes = new Map(); // messageId -> timestamp
        this.rttHistory = [];
        this.recentRtts = [];
        this.deviceState = 'Calibrating...';
        this.lastRtt = 0;
    }

    setProbeMethod(method) {
        this.probeMethod = method;
        console.log(`Probe method changed to: ${method}`);
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
                measurements: this.rttHistory.length
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
