# Device Activity Tracker - WhatsApp Edition 📱

> **A proof-of-concept tool demonstrating privacy vulnerabilities in WhatsApp through Round-Trip Time (RTT) analysis**

This project detects user activity patterns on WhatsApp by measuring message delivery acknowledgment times. The faster the acknowledgment, the more active the device. This demonstrates a significant privacy vulnerability that allows surveillance of messaging app usage patterns.

**Research Paper:** "Careless Whisper: Exploiting Silent Delivery Receipts to Monitor Users on Mobile Instant Messengers" by Gabriel K. Gegenhuber et al. (University of Vienna & SBA Research)

---

## What It Does 🔍

The tool connects to WhatsApp as a linked device and sends invisible probe messages every 2-3 seconds. By measuring the time it takes for WhatsApp to acknowledge these messages (RTT), it can detect:

- **Online (Green) 🟢:** Device actively in use - RTT < 500ms
- **Standby (Yellow) 🟡:** Device idle/locked - RTT 500-2000ms  
- **Offline (Red) 🔴:** Device unreachable - RTT timeout after 10 seconds

The RTT analysis creates a real-time graph showing device state changes and activity patterns over time.

---

## The WhatsApp Problem (And How We Fixed It) 🛠️

### The Original Issue

The research was based on the **Baileys library** (`@adiwajshing/baileys`), which reverse-engineers the WhatsApp Web protocol. However:

1. **Baileys v5 is unmaintained** - The original author abandoned the project
2. **WhatsApp actively blocks it** - They've hardened their servers to reject Baileys connections at the NOISE protocol level
3. **Existing forks were also dead** - Even the community-maintained `@whiskeysockets/baileys` couldn't get past WhatsApp's blocking

### Our Solution: Browser Automation (Puppeteer) 🤖

Instead of trying to reverse-engineer the protocol, we pivoted to **whatsapp-web.js**, which uses **Puppeteer to automate an actual Chrome browser** running WhatsApp Web.

**Why this works:**
- WhatsApp can't easily block a real browser (would break legitimate users)
- We run Chromium headless in Docker with full browser automation
- The connection looks identical to a real user linking their device
- No protocol-level blocking can stop it

**The trade-off:**
- Higher resource usage (requires Chromium in Docker)
- Slightly slower than protocol-level implementation
- But it actually **works** - unlike the original Baileys approach

---

## Installation 🚀

### Prerequisites 📦

- Docker & Docker Compose
- Node.js 20+ (for local development)
- 2GB+ free disk space (for Chromium)

### Quick Start (Docker - Recommended) 🐳

```bash
# Clone the repo
git clone https://github.com/yourusername/device-activity-tracker.git
cd device-activity-tracker

# Start all containers
docker compose up -d

# Access the web interface
# Frontend: http://localhost:3000
# Backend API: http://localhost:3001
```

### Linking WhatsApp 🔗

1. Open `http://localhost:3000` in your browser
2. You'll see a QR code for WhatsApp linking
3. Open WhatsApp on your phone
4. Go to **Settings > Linked Devices > Link a Device**
5. Scan the QR code with your phone
6. The backend will authenticate and you're ready to track

### Manual Setup (Local Development) 💻

```bash
# Backend
npm install
npm run start:server  # Starts on port 3001

# Frontend (in /client directory)
cd client
npm install
npm start  # Starts on port 3000
```

---

## Usage 🎯

### Web Interface 🖥️

1. **Link WhatsApp** - Scan the QR code to authenticate
2. **Enter Contact Number** - Input the phone number you want to track (e.g., 491701234567)
3. **Real-Time Monitoring** - Watch the RTT metrics update as messages are delivered
4. **Switch Probe Methods** - Toggle between "Delete" (covert) and "Reaction" (visible) probes

### What Each Metric Means 📊

| Metric | Description |
|--------|-------------|
| **Current Avg RTT** | Moving average of last 5 delivery times |
| **Median (50)** | Median RTT across all measurements |
| **Threshold** | 90% of median - detection boundary |
| **RTT History** | Graph showing RTT pattern over time |

### Probe Methods 🧪

- **Delete** (Default): Sends a delete request for a non-existent message - completely invisible
- **Reaction**: Sends a reaction emoji - may be visible depending on WhatsApp version

---

## How It Works Technically ⚙️

### Architecture 🧱

```
┌─────────────────┐
│  React Frontend │ (Port 3000)
│   + Socket.IO   │
└────────┬────────┘
         │
    ┌────▼─────────┐
    │   Nginx      │
    │  (Reverse    │
    │   Proxy)     │
    └────┬─────────┘
         │
    ┌────▼──────────────────┐
    │  Node.js Backend      │ (Port 3001)
    │  + Express            │
    │  + Socket.IO Server   │
    │  + WhatsApp Tracker   │
    └────┬──────────────────┘
         │
    ┌────▼──────────────────┐
    │  whatsapp-web.js      │
    │  + Puppeteer          │
    │  + Chromium Browser   │
    │  (WhatsApp Web)       │
    └───────────────────────┘
```

### RTT Measurement Flow ⏱️

1. **Backend** sends probe message to target contact every 2-3 seconds
2. **WhatsApp Server** delivers message to user's device
3. **Device** sends delivery acknowledgment (ACK) back
4. **Backend** measures time between send and ACK = RTT
5. **Frontend** displays metrics and updates graph in real-time

### Device State Detection Algorithm 🧠

```javascript
// Calculate threshold as 90% of median RTT
threshold = median * 0.9

// Compare moving average against threshold
if (avgRtt < threshold) {
  state = "Online"      // Device is active
} else {
  state = "Standby"     // Device is idle/locked
}

// Timeout after 10 seconds = Offline
```

---

## Docker Setup Details 🐋

### Why Chromium in Docker? 🌐

Whatsapp-web.js requires a real Chrome/Chromium browser to automate. The Dockerfile installs:
- **Chromium** - Lightweight Chrome alternative
- **Dependencies** - GTK, fonts, audio/video libs
- **Sandboxing flags** - `--no-sandbox` for container environment

### Building Custom Docker Images 🔨

```bash
# Rebuild everything
docker compose build --no-cache

# Rebuild specific service
docker compose build --no-cache backend
docker compose build --no-cache client

# View logs
docker logs device-activity-tracker-backend-1 -f
docker logs device-activity-tracker-client-1 -f
```

---

## Troubleshooting 🩺

### "WhatsApp is not connected" ❌
- The frontend doesn't see a successful WhatsApp connection
- Make sure you scanned the QR code completely
- Try re-linking by refreshing the page

### "Failed to send probe: Invalid value" ⚠️
- The message format was incorrect for the whatsapp-web.js library
- Restart the backend: `docker compose restart backend`

### "No RTT data appearing" 📉
- The backend is sending probes but not receiving ACKs
- Possible causes:
  - Contact doesn't exist or isn't on WhatsApp
  - WhatsApp Web is blocking the connection
  - Try restarting Docker: `docker compose down && docker compose up -d`

### Browser crashes on page load 💥
- React build might be cached
- Hard refresh: **Ctrl+Shift+R** (or **Cmd+Shift+R** on Mac)
- Or clear cache and rebuild client: `docker compose down && docker image rm device-activity-tracker-client:latest`

---

## Project Structure 🗂️

```
device-activity-tracker/
├── src/
│   ├── server.js           # Express + Socket.IO server
│   ├── tracker.js          # WhatsApp RTT tracking logic
│   └── index.js            # CLI interface (optional)
├── client/                 # React frontend
│   ├── src/
│   │   ├── App.tsx         # Main app component
│   │   └── components/
│   │       ├── Login.tsx   # WhatsApp/Signal login
│   │       └── Dashboard.tsx # Tracking dashboard
│   └── Dockerfile
├── Dockerfile              # Backend container
├── docker-compose.yml      # Orchestration
└── package.json
```

---

## Key Technologies 🧰

| Technology | Purpose |
|-----------|---------|
| **whatsapp-web.js** | WhatsApp Web automation |
| **Puppeteer** | Browser automation engine |
| **Chromium** | Headless browser |
| **Express.js** | REST API server |
| **Socket.IO** | Real-time WebSocket communication |
| **React** | Web frontend dashboard |
| **Docker** | Containerization & deployment |
| **Node.js** | JavaScript runtime |

---

## Security & Privacy Notes 🔐

⚠️ **This is a research proof-of-concept only.** Using this tool to track others without consent may violate:
- Computer Fraud and Abuse Act (CFAA)
- European Union Computer Misuse Directive
- Local privacy and surveillance laws

This project demonstrates a real vulnerability in WhatsApp's design. It should only be used for:
- Educational purposes
- Security research
- Personal device monitoring (your own devices)

---

## Contributing 🤝

Found improvements or fixes? Submit a PR! Areas we need help with:
- Better RTT analysis algorithms
- Performance optimization
- UI/UX improvements
- Docker optimization

---

## License 📄

MIT - See LICENSE file for details

---

## Acknowledgments 🙏

- **Original Research:** Gegenhuber et al. (University of Vienna & SBA Research)
- **Baileys Library:** The original reverse-engineering work (now archived)
- **whatsapp-web.js:** Community browser automation approach

---

## Disclaimer ⚠️

This tool is provided for educational and authorized security research only. Unauthorized access to computer systems or user surveillance is illegal. The authors assume no liability for misuse.

**For legal tracking:** Use official WhatsApp Business API with proper consent and compliance.
