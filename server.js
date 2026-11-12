
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

app.use(express.json({ limit: "32kb" }));

const PORT = Number(process.env.PORT || 10000);
const SERVER_TOKEN = process.env.SERVER_TOKEN || "CHANGE_THIS_SECRET";

const devices = new Map();
const offlineMessages = new Map();

let totalMessages = 0;
let totalConnections = 0;

// ===============================
// HTTP API
// ===============================

app.get("/", (req, res) => {
  res.json({
    name: "ESP32-S3 Online Messenger",
    status: "running",
    websocket: "/ws",
    version: "1.0.0"
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "running",
    online: devices.size,
    totalConnections,
    totalMessages,
    queuedMessages: [...offlineMessages.values()]
      .reduce((n, list) => n + list.length, 0),
    uptime: Math.floor(process.uptime())
  });
});

app.get("/api/online", (req, res) => {
  res.json({
    count: devices.size,
    devices: [...devices.values()].map(d => ({
      id: d.id,
      name: d.name,
      online: true,
      connectedAt: d.connectedAt
    }))
  });
});

// ===============================
// UTILITIES
// ===============================

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
    return true;
  }
  return false;
}

function broadcast(data, excludeId = null) {
  for (const [id, device] of devices) {
    if (id !== excludeId) {
      send(device.ws, data);
    }
  }
}

function queueMessage(deviceId, message) {
  if (!offlineMessages.has(deviceId)) {
    offlineMessages.set(deviceId, []);
  }

  const queue = offlineMessages.get(deviceId);

  // Giới hạn 500 tin nhắn mỗi thiết bị
  if (queue.length >= 500) {
    queue.shift();
  }

  queue.push(message);
}

function deliverOffline(deviceId) {
  const device = devices.get(deviceId);
  const queue = offlineMessages.get(deviceId);

  if (!device || !queue || queue.length === 0) return;

  for (const message of queue) {
    send(device.ws, {
      type: "message",
      ...message,
      offline: true
    });
  }
}

// ===============================
// WEBSOCKET
// ===============================

wss.on("connection", (ws) => {
  let deviceId = null;
  let authenticated = false;

  totalConnections++;

  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  const authTimeout = setTimeout(() => {
    if (!authenticated) {
      ws.close(4001, "Authentication timeout");
    }
  }, 10000);

  ws.on("message", (raw) => {
    let data;

    try {
      data = JSON.parse(raw.toString());
    } catch {
      return send(ws, {
        type: "error",
        message: "Invalid JSON"
      });
    }

    // =============================
    // DEVICE AUTHENTICATION
    // =============================

    if (!authenticated) {
      if (
        data.type !== "auth" ||
        data.token !== SERVER_TOKEN ||
        typeof data.deviceId !== "string" ||
        !/^[a-zA-Z0-9_-]{1,40}$/.test(data.deviceId)
      ) {
        ws.close(4003, "Authentication failed");
        return;
      }

      deviceId = data.deviceId;

      // Ngắt kết nối cũ nếu cùng ID
      const oldDevice = devices.get(deviceId);

      if (oldDevice && oldDevice.ws !== ws) {
        oldDevice.ws.close(4002, "Device reconnected");
      }

      authenticated = true;
      clearTimeout(authTimeout);

      devices.set(deviceId, {
        id: deviceId,
        name: String(data.name || deviceId).slice(0, 32),
        ws,
        connectedAt: Date.now()
      });

      send(ws, {
        type: "auth_ok",
        deviceId,
        online: true
      });

      broadcast({
        type: "presence",
        deviceId,
        name: devices.get(deviceId).name,
        online: true
      }, deviceId);

      send(ws, {
        type: "online_list",
        devices: [...devices.values()].map(d => ({
          id: d.id,
          name: d.name
        }))
      });

      // Gửi tin nhắn đang chờ
      deliverOffline(deviceId);

      console.log("ONLINE:", deviceId);
      return;
    }

    // =============================
    // PING
    // =============================

    if (data.type === "ping") {
      return send(ws, {
        type: "pong",
        time: Date.now()
      });
    }

    // =============================
    // MESSAGE
    // =============================

    if (data.type === "message") {
      const to = String(data.to || "");

      if (!/^[a-zA-Z0-9_-]{1,40}$/.test(to)) {
        return send(ws, {
          type: "error",
          message: "Invalid recipient"
        });
      }

      const text = String(data.text || "").slice(0, 2000);

      if (!text.trim()) {
        return send(ws, {
          type: "error",
          message: "Empty message"
        });
      }

      const message = {
        id: crypto.randomUUID(),
        from: deviceId,
        to,
        text,
        timestamp: Date.now()
      };

      totalMessages++;

      const recipient = devices.get(to);

      if (recipient) {
        send(recipient.ws, {
          type: "message",
          ...message,
          offline: false
        });

        send(ws, {
          type: "sent",
          id: message.id,
          delivered: true
        });
      } else {
        queueMessage(to, message);

        send(ws, {
          type: "sent",
          id: message.id,
          delivered: false,
          queued: true
        });
      }

      console.log("MESSAGE:", deviceId, "->", to);
      return;
    }

    // =============================
    // ACKNOWLEDGEMENT
    // =============================

    if (data.type === "ack") {
      const messageId = String(data.id || "");

      const queue = offlineMessages.get(deviceId);

      if (queue) {
        offlineMessages.set(
          deviceId,
          queue.filter(m => m.id !== messageId)
        );
      }

      send(ws, {
        type: "ack_ok",
        id: messageId
      });

      return;
    }

    // =============================
    // RENAME
    // =============================

    if (data.type === "rename") {
      const device = devices.get(deviceId);

      if (device) {
        device.name = String(data.name || deviceId).slice(0, 32);

        broadcast({
          type: "rename",
          deviceId,
          name: device.name
        });
      }

      return;
    }

    send(ws, {
      type: "error",
      message: "Unknown command"
    });
  });

  ws.on("close", () => {
    clearTimeout(authTimeout);

    if (deviceId && devices.get(deviceId)?.ws === ws) {
      const device = devices.get(deviceId);

      devices.delete(deviceId);

      broadcast({
        type: "presence",
        deviceId,
        name: device.name,
        online: false
      });

      console.log("OFFLINE:", deviceId);
    }
  });

  ws.on("error", (err) => {
    console.log("WS ERROR:", err.message);
  });
});

// ===============================
// HEARTBEAT
// ===============================

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }

    ws.isAlive = false;
    ws.ping();
  }
}, 25000);

server.listen(PORT, "0.0.0.0", () => {
  console.log("Messenger server running:", PORT);
});

server.on("close", () => clearInterval(heartbeat));
