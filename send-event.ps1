# Send event to AI HQ server
param(
    [string]$Type,
    [string]$Tool = "",
    [string]$Server = ""
)

# Server URL - can be set via parameter, env var, or defaults to localhost
$serverUrl = $Server
if (-not $serverUrl) {
    $serverUrl = $env:AI_HQ_SERVER
}
if (-not $serverUrl) {
    $serverUrl = "http://localhost:3456"
}

# Get working directory
$cwd = $env:CLAUDE_CWD
if (-not $cwd) {
    $cwd = (Get-Location).Path
}

# Create a stable session ID from hostname + working directory
# This ensures the same session always has the same ID
$sessionKey = "$env:COMPUTERNAME-$cwd"
$sessionId = [System.BitConverter]::ToString(
    [System.Security.Cryptography.MD5]::Create().ComputeHash(
        [System.Text.Encoding]::UTF8.GetBytes($sessionKey)
    )
).Replace("-", "").Substring(0, 12)

# Extract just the folder name for cleaner display
$title = Split-Path $cwd -Leaf

$body = @{
    type = $Type
    tool = $Tool
    sessionId = "$sessionId"
    title = $title
    timestamp = (Get-Date -Format "o")
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri "$serverUrl/event" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 2 | Out-Null
} catch {
    # Silently fail if server not running
}
