const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = 3456;

// Track connected WebSocket clients
const clients = new Set();

// HTTP server for static files + event endpoint
const server = http.createServer((req, res) => {
  // CORS headers for local development
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Debug/status endpoint
  if (req.url === '/status' || req.url === '/debug') {
    const status = {
      server: 'running',
      connectedClients: clients.size,
      recentEvents: global.recentEvents || [],
      help: 'POST events to /event with {type, tool, sessionId, title}'
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status, null, 2));
    return;
  }

  // Setup instructions endpoint - returns plain text for Claude to read
  if (req.url === '/setup') {
    const host = req.headers.host || `localhost:${PORT}`;
    const serverUrl = `http://${host}`;

    const instructions = `
AI HQ SETUP INSTRUCTIONS
================================

This is a pixel art office that visualizes Claude Code sessions in real-time.
Server URL: ${serverUrl}

Follow these steps EXACTLY to connect your Claude Code session:


STEP 1: Create the PowerShell script
------------------------------------
Create a new file and save it. On Windows, a good location is:
  C:\\Users\\<YOUR_USERNAME>\\ai-hq\\send-event.ps1

Copy this ENTIRE script into the file:

--- START OF SCRIPT (copy from line below) ---
param([string]$Type, [string]$Tool = "")
$serverUrl = "${serverUrl}"
$cwd = if ($env:CLAUDE_CWD) { $env:CLAUDE_CWD } else { (Get-Location).Path }
$sessionKey = "$env:COMPUTERNAME-$cwd"
$sessionId = [System.BitConverter]::ToString([System.Security.Cryptography.MD5]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($sessionKey))).Replace("-","").Substring(0,12)
$title = Split-Path $cwd -Leaf
$body = @{ type = $Type; tool = $Tool; sessionId = $sessionId; title = $title } | ConvertTo-Json
try { Invoke-RestMethod -Uri "$serverUrl/event" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 2 | Out-Null } catch {}
--- END OF SCRIPT (copy to line above) ---


STEP 2: Test the script works
-----------------------------
Open PowerShell and run this command (replace the path with your actual script path):

  powershell -ExecutionPolicy Bypass -File "C:\\Users\\<YOUR_USERNAME>\\ai-hq\\send-event.ps1" -Type tool_start -Tool Test

If successful, you should see a character appear in the AI HQ at ${serverUrl}


STEP 3: Configure Claude Code hooks
-----------------------------------
Open (or create) the file: ~/.claude/settings.json
  On Windows this is: C:\\Users\\<YOUR_USERNAME>\\.claude\\settings.json

Replace <YOUR_USERNAME> with your actual Windows username and add or merge this configuration:

{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "powershell -ExecutionPolicy Bypass -Command \"& 'C:/Users/<YOUR_USERNAME>/ai-hq/send-event.ps1' -Type tool_start -Tool $env:CLAUDE_TOOL_NAME\""
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "powershell -ExecutionPolicy Bypass -Command \"& 'C:/Users/<YOUR_USERNAME>/ai-hq/send-event.ps1' -Type tool_end -Tool $env:CLAUDE_TOOL_NAME\""
          }
        ]
      }
    ]
  }
}

NOTE: The Stop hook is intentionally omitted - session_end events are ignored by the server.
Characters stay at their desks between actions, which looks more natural.

IMPORTANT NOTES:
- Replace <YOUR_USERNAME> with your actual Windows username in ALL places (3 times in the hooks)
- Use FORWARD SLASHES (/) in the paths, not backslashes
- If you have existing settings, merge the "hooks" section into your existing file
- The settings.json file must be valid JSON


STEP 4: Restart Claude Code
---------------------------
Close and reopen Claude Code (or start a new session with "claude" command).
Every tool use will now send events to the AI HQ server.


TROUBLESHOOTING
---------------
If it's not working:

1. Test network connectivity:
   curl ${serverUrl}/setup
   (or open ${serverUrl} in a browser)

2. Test the script manually:
   powershell -ExecutionPolicy Bypass -File "YOUR_SCRIPT_PATH" -Type tool_start -Tool Test

3. Check the script path is correct and the file exists

4. Verify settings.json is valid JSON (no trailing commas, proper quotes)

5. Make sure you restarted Claude Code after changing settings.json

6. Check Windows Firewall isn't blocking the connection


QUICK COPY-PASTE CHECKLIST
--------------------------
[ ] Created send-event.ps1 with the script above
[ ] Replaced <YOUR_USERNAME> in the script path
[ ] Tested the script manually in PowerShell
[ ] Created/updated ~/.claude/settings.json
[ ] Replaced <YOUR_USERNAME> in settings.json (3 places)
[ ] Restarted Claude Code
`;

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(instructions);
    return;
  }

  // Restart endpoint - triggers server restart
  if (req.url === '/restart') {
    console.log('[Server] Restart requested...');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: 'Restarting...' }));
    setTimeout(() => process.exit(0), 100);
    return;
  }

  // Event endpoint - Claude Code hooks POST here
  if (req.method === 'POST' && req.url === '/event') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const event = JSON.parse(body);
        console.log(`[Event] ${event.type} | tool=${event.tool || ''} | session=${event.sessionId} | title=${event.title}`);

        // Ignore session_end events - characters stay at desks between actions
        // This prevents premature "leaving" when hooks fire unexpectedly
        if (event.type === 'session_end') {
          console.log(`[Event] Ignoring session_end (characters persist)`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, ignored: true }));
          return;
        }

        // Track recent events for debugging
        if (!global.recentEvents) global.recentEvents = [];
        global.recentEvents.unshift({
          time: new Date().toISOString(),
          type: event.type,
          tool: event.tool,
          sessionId: event.sessionId,
          title: event.title
        });
        if (global.recentEvents.length > 20) global.recentEvents.pop();

        // Broadcast to all WebSocket clients
        const message = JSON.stringify(event);
        clients.forEach(client => {
          if (client.readyState === 1) { // OPEN
            client.send(message);
          }
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // Static file serving
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, filePath);

  const ext = path.extname(filePath);
  const contentTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json'
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
    res.end(content);
  });
});

// WebSocket server for real-time updates to webpage
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  clients.add(ws);

  // Send initial state
  ws.send(JSON.stringify({ type: 'connected' }));

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
    clients.delete(ws);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  // Get local IP addresses for display
  const os = require('os');
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  const localIP = ips[0] || 'YOUR_IP';

  console.log(`
╔════════════════════════════════════════════════════╗
║            AI HQ SERVER                     ║
╠════════════════════════════════════════════════════╣
║  Local:    http://localhost:${PORT}                   ║
║  Network:  http://${localIP}:${PORT}                   ║
║  Events:   POST http://${localIP}:${PORT}/event        ║
║  WS:       ws://${localIP}:${PORT}                     ║
╚════════════════════════════════════════════════════╝

Waiting for Claude Code events...
`);
});
