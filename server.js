
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({
  server,
  path: "/ws",
  maxPayload: 16384
});

app.use(express.json({ limit: "32kb" }));

const PORT = Number(process.env.PORT || 10000);
const SERVER_TOKEN = process.env.SERVER_TOKEN || "CHANGE_THIS_SECRET";

const devices = new Map();
const offlineMessages = new Map();

let totalMessages = 0;
let totalConnections = 0;

// ==================================================
// HTTP API
// ==================================================

app.get("/", (req, res) => {
  res.json({
    name: "BEERUSS CHAT SERVER",
    status: "running",
    websocket: "/ws",
    webTest: "/test",
    version: "2.0.0"
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

// ==================================================
// WEB CHAT TEST
// ==================================================

app.get("/test", (req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BEERUSS CHAT</title>
<style>
*{box-sizing:border-box}
body{
 margin:0;padding:20px;background:#080a12;
 color:white;font-family:Arial,sans-serif
}
header{text-align:center;margin:15px 0 25px}
h1{color:#a78bfa;letter-spacing:3px}
.sub{color:#9295a8;font-size:12px}
.top{
 max-width:900px;margin:20px auto;
 display:flex;gap:8px
}
input,button{
 border:1px solid #303349;border-radius:9px;
 background:#151827;color:white;padding:12px;
 font-size:14px
}
input{min-width:0}
.top input{flex:1}
button{cursor:pointer;background:#7040ff;border:0}
button:hover{opacity:.8}
.devices{
 max-width:900px;margin:auto;
 display:grid;grid-template-columns:1fr 1fr;gap:15px
}
.device{
 background:#111522;border:1px solid #292d42;
 border-radius:15px;padding:15px;min-width:0
}
.device h3{margin:0 0 10px}
.status{font-size:12px;color:#ff6464;margin-bottom:12px}
.status.on{color:#4ade80}
.messages{
 height:350px;overflow-y:auto;
 background:#090d18;border-radius:10px;
 padding:10px;margin-bottom:10px;
 display:flex;flex-direction:column;gap:8px
}
.msg{
 max-width:90%;padding:10px 12px;
 border-radius:12px;background:#292d42;
 overflow-wrap:anywhere;font-size:14px
}
.msg.me{align-self:flex-end;background:#7040ff}
.msg small{display:block;color:#ddd;font-size:10px;margin-top:5px}
.send{display:flex;gap:6px}
.send input{flex:1}
.send button{padding:10px}
.actions{display:flex;gap:6px;margin-top:8px}
.actions button{flex:1;background:#303349}
.info{
 max-width:900px;margin:20px auto;
 color:#9295a8;font-size:12px;text-align:center
}
@media(max-width:600px){
 body{padding:10px}
 .devices{grid-template-columns:1fr}
 .messages{height:260px}
}
</style>
</head>
<body>

<header>
<h1>BEERUSS CHAT</h1>
<div class="sub">ESP32-S3 ONLINE MESSENGER</div>
</header>

<div class="top">
<input id="token" type="password" placeholder="SERVER_TOKEN">
<button onclick="connectAll()">KẾT NỐI CẢ 2</button>
</div>

<div class="devices">

<section class="device">
<h3>📱 BEERUSS 001</h3>
<div id="status1" class="status">OFFLINE</div>
<div class="messages" id="messages1"></div>
<div class="send">
<input id="input1" placeholder="Nhập tin nhắn...">
<button onclick="sendMessage(1)">GỬI</button>
</div>
<div class="actions">
<button onclick="disconnect(1)">NGẮT KẾT NỐI</button>
<button onclick="connect(1)">KẾT NỐI</button>
</div>
</section>

<section class="device">
<h3>📱 BEERUSS 002</h3>
<div id="status2" class="status">OFFLINE</div>
<div class="messages" id="messages2"></div>
<div class="send">
<input id="input2" placeholder="Nhập tin nhắn...">
<button onclick="sendMessage(2)">GỬI</button>
</div>
<div class="actions">
<button onclick="disconnect(2)">NGẮT KẾT NỐI</button>
<button onclick="connect(2)">KẾT NỐI</button>
</div>
</section>

</div>

<div class="info">
WebSocket: <span id="wsurl"></span><br>
BEERUSS ONLINE MESSENGER v2.0.0
</div>

<script>
const URL_WS =
(location.protocol==="https:"?"wss://":"ws://")
+location.host+"/ws";

document.getElementById("wsurl").textContent=URL_WS;

const clients={1:null,2:null};

const ids={
 1:"BEERUSS_001",
 2:"BEERUSS_002"
};

function status(n,online,message){
 const el=document.getElementById("status"+n);
 el.textContent=message||(online?"ONLINE":"OFFLINE");
 el.className=online?"status on":"status";
}

function log(n,text,mine=false){
 const box=document.getElementById("messages"+n);
 const item=document.createElement("div");
 item.className="msg"+(mine?" me":"");

 const content=document.createElement("span");
 content.textContent=text;

 const time=document.createElement("small");
 time.textContent=new Date().toLocaleTimeString();

 item.append(content,time);
 box.appendChild(item);
 box.scrollTop=box.scrollHeight;
}

function connect(n){
 disconnect(n,false);

 const token=document.getElementById("token").value.trim();

 if(!token){
  alert("Nhập SERVER_TOKEN!");
  return;
 }

 status(n,false,"ĐANG KẾT NỐI...");

 const ws=new WebSocket(URL_WS);
 clients[n]=ws;

 ws.onopen=()=>{
  ws.send(JSON.stringify({
   type:"auth",
   deviceId:ids[n],
   name:"Beeruss "+n,
   token
  }));
 };

 ws.onmessage=(event)=>{
  let data;
  try{data=JSON.parse(event.data)}catch{return}

  if(data.type==="auth_ok"){
   status(n,true,"ONLINE · ĐÃ XÁC THỰC");
   log(n,"Đăng nhập server thành công");
  }

  if(data.type==="message"){
   log(n,data.from+": "+data.text);
   ws.send(JSON.stringify({
    type:"ack",
    id:data.id
   }));
  }

  if(data.type==="sent"){
   log(n,data.queued?
    "Tin nhắn đã lưu chờ":
    "Server đã chuyển tin nhắn");
  }

  if(data.type==="presence"){
   log(n,data.deviceId+
    (data.online?" đã online":" đã offline"));
  }

  if(data.type==="online_list"){
   log(n,"Có "+data.devices.length+" thiết bị online");
  }

  if(data.type==="error"){
   log(n,"LỖI: "+data.message);
  }
 };

 ws.onclose=()=>{
  if(clients[n]===ws){
   clients[n]=null;
   status(n,false,"OFFLINE · MẤT KẾT NỐI");
  }
 };

 ws.onerror=()=>{
  status(n,false,"LỖI KẾT NỐI");
 };
}

function disconnect(n,show=true){
 const ws=clients[n];
 clients[n]=null;

 if(ws){
  ws.close();
 }

 status(n,false,"OFFLINE");

 if(show) log(n,"Đã ngắt kết nối");
}

function connectAll(){
 connect(1);
 connect(2);
}

function sendMessage(n){
 const ws=clients[n];
 const input=document.getElementById("input"+n);
 const text=input.value.trim();

 if(!text)return;

 if(!ws||ws.readyState!==WebSocket.OPEN){
  log(n,"Thiết bị chưa kết nối!");
  return;
 }

 const other=n===1?2:1;

 ws.send(JSON.stringify({
  type:"message",
  to:ids[other],
  text
 }));

 log(n,"Bạn: "+text,true);
 input.value="";
}

[1,2].forEach(n=>{
 document.getElementById("input"+n)
 .addEventListener("keydown",e=>{
  if(e.key==="Enter")sendMessage(n);
 });
});
</script>
</body>
</html>`);
});

// ==================================================
// UTILITIES
// ==================================================

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
    return true;
  }
  return false;
}

function broadcast(data, excludeId = null) {
  for (const [id, device] of devices) {
    if (id !== excludeId) send(device.ws, data);
  }
}

function queueMessage(deviceId, message) {
  if (!offlineMessages.has(deviceId)) {
    offlineMessages.set(deviceId, []);
  }

  const queue = offlineMessages.get(deviceId);

  if (queue.length >= 500) queue.shift();

  queue.push(message);
}

function deliverOffline(deviceId) {
  const device = devices.get(deviceId);
  const queue = offlineMessages.get(deviceId);

  if (!device || !queue) return;

  for (const message of queue) {
    send(device.ws, {
      type: "message",
      ...message,
      offline: true
    });
  }
}

// ==================================================
// WEBSOCKET SERVER
// ==================================================

wss.on("connection", ws => {
  let deviceId = null;
  let authenticated = false;

  totalConnections++;
  ws.isAlive = true;

  const authTimeout = setTimeout(() => {
    if (!authenticated) ws.close(4001, "Authentication timeout");
  }, 10000);

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", raw => {
    let data;

    try {
      data = JSON.parse(raw.toString());
    } catch {
      return send(ws, {
        type: "error",
        message: "Invalid JSON"
      });
    }

    // AUTHENTICATION

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

      const old = devices.get(deviceId);

      if (old && old.ws !== ws) {
        old.ws.close(4002, "Device reconnected");
      }

      authenticated = true;
      clearTimeout(authTimeout);

      devices.set(deviceId, {
        id: deviceId,
        name: String(data.name || deviceId).slice(0,32),
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

      deliverOffline(deviceId);

      console.log("ONLINE:", deviceId);
      return;
    }

    // PING

    if (data.type === "ping") {
      return send(ws, {
        type: "pong",
        time: Date.now()
      });
    }

    // MESSAGE

    if (data.type === "message") {
      const to = String(data.to || "");

      if (!/^[a-zA-Z0-9_-]{1,40}$/.test(to)) {
        return send(ws, {
          type: "error",
          message: "Invalid recipient"
        });
      }

      const text = String(data.text || "").slice(0,2000);

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

      return;
    }

    // ACK

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

    // RENAME

    if (data.type === "rename") {
      const device = devices.get(deviceId);

      if (device) {
        device.name = String(data.name || deviceId).slice(0,32);

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

  ws.on("error", err => {
    console.log("WS ERROR:", err.message);
  });
});

// ==================================================
// HEARTBEAT
// ==================================================

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
  console.log("BEERUSS CHAT SERVER RUNNING:", PORT);
});

server.on("close", () => clearInterval(heartbeat));
