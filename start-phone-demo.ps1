# ===========================================================================
#  e-Samagri - restore the phone demo   (STAGING ONLY)
#
#  WHAT THIS DOES - in order, and it tells you the result of each step
#    1. Shows your laptop's current IPv4 address (it may have changed).
#    2. Shows what is listening on port 5175 and port 3000, and whether it
#       is reachable from the phone or only from the laptop.
#    3. Stops the port-5175 preview ONLY IF it is verifiably a node/vite
#       process. If it is anything else it REFUSES and stops.
#    4. Starts the preview again in its own window, bound to 0.0.0.0.
#    5. Tests the new address from the laptop and reports PASS or FAIL.
#    6. Reads (never changes) the Windows Firewall and Wi-Fi network type,
#       and tells you exactly what to do if the firewall is the blocker.
#    7. Prints the exact URL to type on your phone.
#
#  WHAT IT NEVER DOES
#    - Never touches port 3000 (your API keeps running).
#    - Never touches C:\esamagri\esamagri-app (the original project).
#    - Never rebuilds. Never touches the database or any .env file.
#    - Never changes firewall, network or any security setting - it only
#      reads them and reports.
#    - Never stops a process it has not positively identified.
#
#  HOW TO RUN: right-click this file -> "Run with PowerShell".
#    If the window closes instantly, open PowerShell and paste:
#      powershell -ExecutionPolicy Bypass -File "C:\esamagri\staging-esamagri-app\start-phone-demo.ps1"
# ===========================================================================

$StagingWeb = 'C:\esamagri\staging-esamagri-app\apps\customer-web'
$Port       = 5175

function Line { Write-Host ('-' * 70) -ForegroundColor DarkGray }
function Stop-Here { param([string]$Msg)
  Write-Host ''
  if ($Msg) { Write-Host "  $Msg" -ForegroundColor Red }
  Write-Host ''
  Read-Host '  Press Enter to close'
  exit 1
}

Write-Host ''
Write-Host '  e-Samagri - restore phone demo (staging only)' -ForegroundColor Cyan
Line

# --- 1. Current IPv4 address ----------------------------------------------
Write-Host ''
Write-Host '1. YOUR LAPTOP IP ADDRESSES' -ForegroundColor Yellow
$ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
         Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } |
         Select-Object IPAddress, InterfaceAlias, PrefixOrigin)

if ($ips.Count -eq 0) { Stop-Here 'No network address found. Is Wi-Fi connected?' }
$ips | Format-Table -AutoSize | Out-String | Write-Host

$wifi = $ips | Where-Object { $_.InterfaceAlias -match 'Wi-?Fi|Wireless|WLAN' } | Select-Object -First 1
if ($null -eq $wifi) { $wifi = $ips | Select-Object -First 1 }
$MyIp = $wifi.IPAddress

Write-Host "   Address your phone must use:  $MyIp" -ForegroundColor Green
if ($MyIp -ne '192.168.31.58') {
  Write-Host "   NOTE: this is NOT 192.168.31.58 - your laptop's IP has CHANGED." -ForegroundColor Magenta
  Write-Host "   That by itself explains the phone saying 'site can't be reached'." -ForegroundColor Magenta
}

# --- 2. What is listening -------------------------------------------------
Write-Host ''
Write-Host '2. WHAT IS LISTENING' -ForegroundColor Yellow
foreach ($p in @($Port, 3000)) {
  $conns = @(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
  if ($conns.Count -eq 0) {
    Write-Host ("   port {0} : nothing is listening" -f $p) -ForegroundColor Red
    continue
  }
  foreach ($c in $conns) {
    $addr = $c.LocalAddress
    if ($addr -eq '0.0.0.0' -or $addr -eq '::') {
      $scope = 'ALL interfaces - phone CAN reach it'
    } elseif ($addr -eq '127.0.0.1' -or $addr -eq '::1') {
      $scope = 'localhost ONLY - phone CANNOT reach it'
    } else {
      $scope = "bound to $addr only"
    }
    $cmd = $null
    try {
      $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $($c.OwningProcess)" -ErrorAction SilentlyContinue).CommandLine
    } catch { }
    Write-Host ("   port {0} : {1,-15} PID {2,-7} {3}" -f $p, $addr, $c.OwningProcess, $scope)
    if ($cmd) {
      Write-Host ("            command: " + $cmd.Substring(0, [Math]::Min(150, $cmd.Length))) -ForegroundColor DarkGray
    }
  }
}

# --- 3. Verify, then stop, the port-5175 preview --------------------------
#
#  IDENTITY RULE: the process is stopped ONLY if a command line positively
#  proves it is the Vite preview for
#      C:\esamagri\staging-esamagri-app\apps\customer-web
#  All FIVE of these must be true of that command line:
#      a) it names a vite program file under the STAGING project root
#      b) it names the customer-web project path (or the vite file sits
#         inside customer-web's own node_modules)
#      c) it contains the word  preview
#      d) it contains the port number 5175
#      e) it does NOT mention the ORIGINAL project C:\esamagri\esamagri-app
#  ...and the listening process itself must be node.
#  Proof may come from the process's own command line, or from the command
#  line of the process that launched it (up to 4 steps up the chain), which
#  is where the project folder normally appears. If none of them proves it,
#  the script REFUSES to stop anything and tells you what to do instead.
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host "3. CHECKING THE PROCESS ON PORT $Port" -ForegroundColor Yellow

$StagingRootLower  = 'c:\esamagri\staging-esamagri-app'
$CustomerWebLower  = 'c:\esamagri\staging-esamagri-app\apps\customer-web'
$OriginalRootLower = 'c:\esamagri\esamagri-app'

function Get-ProcInfo { param($ProcId)
  try { return Get-CimInstance Win32_Process -Filter "ProcessId = $ProcId" -ErrorAction Stop }
  catch { return $null }
}

function Get-NormalizedCmd { param([string]$Raw)
  if ([string]::IsNullOrWhiteSpace($Raw)) { return '' }
  return ($Raw -replace '/', '\').ToLower()
}

# Pull the absolute path of the vite program out of a command line, if present.
function Get-VitePathFromCmd { param([string]$Raw)
  $n = Get-NormalizedCmd $Raw
  if ($n -eq '') { return $null }
  $m = [regex]::Match($n, '([a-z]:\\[^"'']*?\\node_modules\\(?:\.bin\\vite(?:\.cmd|\.ps1|\.exe)?|vite\\bin\\vite\.js))')
  if ($m.Success) { return $m.Groups[1].Value }
  return $null
}

# Evaluate one command line against the five identity conditions.
function Test-StagingVitePreview { param([string]$Raw)
  $n  = Get-NormalizedCmd $Raw
  $vp = Get-VitePathFromCmd $Raw
  $r = [pscustomobject]@{
    VitePath       = $vp
    UnderStaging   = $false   # (a)
    ProjectAnchor  = $false   # (b)
    IsPreview      = $false   # (c)
    HasPort        = $false   # (d)
    TouchesOriginal= $false   # (e)
    Verified       = $false
  }
  if ($n -eq '') { return $r }
  if ($vp) { $r.UnderStaging = $vp.StartsWith($StagingRootLower + '\') }
  $r.ProjectAnchor   = $n.Contains($CustomerWebLower) -or
                       ($vp -and $vp.StartsWith($CustomerWebLower + '\'))
  $r.IsPreview       = ($n -match '(^|\s|\\)preview(\s|$)')
  $r.HasPort         = $n.Contains([string]$Port)
  $r.TouchesOriginal = $n.Contains($OriginalRootLower)
  $r.Verified = ($r.UnderStaging -and $r.ProjectAnchor -and $r.IsPreview -and
                 $r.HasPort -and -not $r.TouchesOriginal)
  return $r
}

function Show-IdentityResult { param($R, [string]$Label)
  function YN { param($b) if ($b) { 'yes' } else { 'NO' } }
  Write-Host "   Identity checks against $Label :" -ForegroundColor DarkGray
  Write-Host ("     a) vite program under staging root : {0}  {1}" -f (YN $R.UnderStaging), $(if ($R.VitePath) { $R.VitePath } else { '(no vite path found)' })) -ForegroundColor DarkGray
  Write-Host ("     b) customer-web project path       : {0}" -f (YN $R.ProjectAnchor))    -ForegroundColor DarkGray
  Write-Host ("     c) the word 'preview'              : {0}" -f (YN $R.IsPreview))        -ForegroundColor DarkGray
  Write-Host ("     d) port {0}                      : {1}" -f $Port, (YN $R.HasPort))     -ForegroundColor DarkGray
  Write-Host ("     e) does NOT mention original proj  : {0}" -f (YN (-not $R.TouchesOriginal))) -ForegroundColor DarkGray
}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -First 1

if ($null -eq $listener) {
  Write-Host "   Nothing on port $Port - nothing to stop. Will just start it." -ForegroundColor Green
} else {
  $targetPid = $listener.OwningProcess
  $proc = Get-ProcInfo $targetPid
  if ($null -eq $proc) {
    Stop-Here "Could not read process $targetPid. REFUSING to stop it. Nothing changed."
  }
  $cmd  = [string]$proc.CommandLine
  $name = [string]$proc.Name
  Write-Host "   PID     : $targetPid"
  Write-Host "   Name    : $name"
  Write-Host "   Command : $cmd" -ForegroundColor DarkGray
  Write-Host ''

  $isNode   = $name -match '^node(\.exe)?$'
  Write-Host ("   Listening process is node : {0}" -f $(if ($isNode) { 'yes' } else { 'NO' })) -ForegroundColor DarkGray

  $evidence   = $null
  $provenPath = $null
  $chain      = @()

  if ($isNode) {
    $own = Test-StagingVitePreview $cmd
    Show-IdentityResult $own 'its own command line'
    if ($own.Verified) {
      $evidence   = 'its own command line'
      $provenPath = $own.VitePath
    } else {
      # The project folder usually appears on the launching command line
      # (npm/npx/shell), so check up to four steps up the chain.
      $walkPid = $proc.ParentProcessId
      for ($hop = 1; $hop -le 4; $hop++) {
        if (-not $walkPid -or $walkPid -le 0) { break }
        $anc = Get-ProcInfo $walkPid
        if ($null -eq $anc) { break }
        $ancCmd = [string]$anc.CommandLine
        $chain += ("     step {0}: PID {1}  {2}  {3}" -f $hop, $walkPid, $anc.Name,
                   $(if ($ancCmd) { $ancCmd.Substring(0, [Math]::Min(120, $ancCmd.Length)) } else { '(command line not readable)' }))
        $acheck = Test-StagingVitePreview $ancCmd
        if ($acheck.Verified) {
          Write-Host ''
          Show-IdentityResult $acheck ("the launching process, PID $walkPid ($($anc.Name))")
          $evidence   = "the command line of its launching process (PID $walkPid, $($anc.Name))"
          $provenPath = $acheck.VitePath
          break
        }
        $walkPid = $anc.ParentProcessId
      }
    }
  }

  if ($null -eq $evidence) {
    Write-Host ''
    Write-Host '   COULD NOT VERIFY that this is the Vite preview for' -ForegroundColor Red
    Write-Host '   C:\esamagri\staging-esamagri-app\apps\customer-web' -ForegroundColor Red
    Write-Host '   REFUSING to stop it. NOTHING has been changed.' -ForegroundColor Red
    if ($chain.Count -gt 0) {
      Write-Host ''
      Write-Host '   What launched it (for reference):' -ForegroundColor DarkGray
      $chain | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray }
    }
    Write-Host ''
    Write-Host '   WHAT TO DO:' -ForegroundColor Yellow
    Write-Host '   1. Look along your taskbar for a PowerShell or Command Prompt'
    Write-Host '      window showing lines like  "Local: http://localhost:5175".'
    Write-Host '      Click that window, press Ctrl+C once, wait for the prompt to'
    Write-Host '      come back, then close it. Now run this file again - it will'
    Write-Host '      find port 5175 free and start the app cleanly.'
    Write-Host '   2. If there is no such window, do NOT end any process yourself.'
    Write-Host '      Copy the PID / Name / Command lines above (and the "What'
    Write-Host '      launched it" lines) and send them to Claude.'
    Write-Host '   3. If you need the demo immediately, you can tell Claude to use'
    Write-Host '      a different free port instead - that needs nothing stopped.'
    Stop-Here 'Stopped without changing anything.'
  }

  Write-Host ''
  Write-Host "   VERIFIED via $evidence" -ForegroundColor Green
  if ($provenPath) { Write-Host "   vite program : $provenPath" -ForegroundColor Green }
  Write-Host '   Stopping only this one process...' -ForegroundColor Green
  try { Stop-Process -Id $targetPid -ErrorAction Stop } catch { Stop-Here "Could not stop PID $targetPid : $_" }
  Start-Sleep -Seconds 2
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    Stop-Here "Port $Port is still busy. Wait 5 seconds and run this file again."
  }
  Write-Host "   Port $Port is free." -ForegroundColor Green
}

# --- 4. Start the preview on all interfaces -------------------------------
Write-Host ''
Write-Host '4. STARTING THE PREVIEW (bound to 0.0.0.0)' -ForegroundColor Yellow
if (-not (Test-Path (Join-Path $StagingWeb 'dist\index.html'))) {
  Stop-Here "dist\index.html is missing under $StagingWeb. Tell Claude - do not rebuild blindly."
}
Write-Host '   Serving: ' -NoNewline
Write-Host (Join-Path $StagingWeb 'dist') -ForegroundColor Green

$inner = "Set-Location '$StagingWeb'; " +
         "Write-Host 'e-Samagri customer app - LEAVE THIS WINDOW OPEN' -ForegroundColor Yellow; " +
         "npx vite preview --port $Port --strictPort --host 0.0.0.0"
Start-Process -FilePath 'powershell.exe' `
              -ArgumentList '-NoExit', '-NoProfile', '-Command', $inner `
              -WorkingDirectory $StagingWeb | Out-Null

Write-Host '   A SECOND WINDOW has opened and is running the app.' -ForegroundColor Green
Write-Host '   Leave that second window open for the whole demo.' -ForegroundColor Green
Write-Host '   Waiting up to 25 seconds for it to come up...'

$up = $null
for ($i = 1; $i -le 25; $i++) {
  Start-Sleep -Seconds 1
  $up = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
  if ($up) { break }
}

if ($null -eq $up) {
  Write-Host ''
  Write-Host '   It did not start. Look at the SECOND window - it will show the error.' -ForegroundColor Red
  Stop-Here 'Screenshot that second window and send it to Claude.'
}

Write-Host ("   Listening on {0} (PID {1})" -f $up.LocalAddress, $up.OwningProcess) -ForegroundColor Green
if ($up.LocalAddress -ne '0.0.0.0' -and $up.LocalAddress -ne '::') {
  Write-Host '   WARNING: it is NOT on all interfaces. The phone still cannot reach it.' -ForegroundColor Red
}

# --- 5. Prove it from the laptop, using the phone's address ---------------
Write-Host ''
Write-Host '5. TESTING THE PHONE ADDRESS FROM THIS LAPTOP' -ForegroundColor Yellow
$selfTestOk = $false
try {
  $r = Invoke-WebRequest -Uri ("http://{0}:{1}/" -f $MyIp, $Port) -UseBasicParsing -TimeoutSec 10
  Write-Host ("   http://{0}:{1}/  ->  HTTP {2}   PASS" -f $MyIp, $Port, $r.StatusCode) -ForegroundColor Green
  $selfTestOk = $true
} catch {
  Write-Host ("   http://{0}:{1}/  ->  FAILED: {2}" -f $MyIp, $Port, $_.Exception.Message) -ForegroundColor Red
}
if ($selfTestOk) {
  Write-Host '   So the app IS being served on that address. If the phone still' -ForegroundColor DarkGray
  Write-Host '   cannot reach it, the cause is the firewall or the Wi-Fi network.' -ForegroundColor DarkGray
}

# --- 6. READ-ONLY firewall and network-type report ------------------------
Write-Host ''
Write-Host '6. FIREWALL AND NETWORK TYPE (read-only - nothing is changed)' -ForegroundColor Yellow
try {
  Get-NetConnectionProfile -ErrorAction Stop |
    Select-Object InterfaceAlias, NetworkCategory |
    Format-Table -AutoSize | Out-String | Write-Host
  $publicNet = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue |
                 Where-Object { $_.NetworkCategory -eq 'Public' })
  if ($publicNet.Count -gt 0) {
    Write-Host '   Your Wi-Fi is set to PUBLIC. Windows blocks incoming connections' -ForegroundColor Magenta
    Write-Host '   on public networks, which stops your phone from reaching the app.' -ForegroundColor Magenta
    Write-Host '   Fix (you do this, it is a Windows security setting):' -ForegroundColor Magenta
    Write-Host '     Settings > Network & Internet > Wi-Fi > click your network name' -ForegroundColor White
    Write-Host '     > Network profile type > choose "Private".' -ForegroundColor White
  }
} catch {
  Write-Host '   Could not read the network profile.' -ForegroundColor DarkGray
}

try {
  Get-NetFirewallProfile -ErrorAction Stop |
    Select-Object Name, Enabled, DefaultInboundAction |
    Format-Table -AutoSize | Out-String | Write-Host
} catch {
  Write-Host '   Could not read the firewall profiles.' -ForegroundColor DarkGray
}

$hasRule = $false
try {
  $pf = @(Get-NetFirewallPortFilter -ErrorAction Stop | Where-Object { $_.LocalPort -eq "$Port" })
  foreach ($f in $pf) {
    $rule = $f | Get-NetFirewallRule -ErrorAction SilentlyContinue
    if ($rule -and $rule.Direction -eq 'Inbound' -and $rule.Enabled -eq 'True' -and $rule.Action -eq 'Allow') {
      Write-Host ("   Existing inbound ALLOW rule for port {0}: {1}" -f $Port, $rule.DisplayName) -ForegroundColor Green
      $hasRule = $true
    }
  }
} catch { }

if (-not $hasRule) {
  Write-Host ("   No inbound allow rule found for port {0}." -f $Port) -ForegroundColor Magenta
  Write-Host '   Windows may be silently blocking your phone. If the phone still' -ForegroundColor Magenta
  Write-Host '   fails after this, open PowerShell AS ADMINISTRATOR and paste this' -ForegroundColor Magenta
  Write-Host '   ONE line. It opens only this one port, only on private networks:' -ForegroundColor Magenta
  Write-Host ''
  Write-Host ("     New-NetFirewallRule -DisplayName 'e-Samagri demo {0}' -Direction Inbound -Action Allow -Protocol TCP -LocalPort {0} -Profile Private" -f $Port) -ForegroundColor White
  Write-Host ''
  Write-Host '   That is a firewall change, so this script will NOT do it for you.' -ForegroundColor DarkGray
  Write-Host '   To remove it after the demo:' -ForegroundColor DarkGray
  Write-Host ("     Remove-NetFirewallRule -DisplayName 'e-Samagri demo {0}'" -f $Port) -ForegroundColor DarkGray
}

# --- 7. The phone URL -----------------------------------------------------
Write-Host ''
Line
Write-Host '  OPEN THIS ON YOUR PHONE:' -ForegroundColor Cyan
Write-Host ("     http://{0}:{1}" -f $MyIp, $Port) -ForegroundColor White
Write-Host ''
Write-Host '  If it is still blank or unreachable, open this diagnostic page'
Write-Host '  on the phone instead and send Claude a screenshot of it:'
Write-Host ("     http://{0}:{1}/phone-check.html" -f $MyIp, $Port) -ForegroundColor White
Line
Write-Host ''
Write-Host '  Also make sure the phone is on the SAME Wi-Fi network as this' -ForegroundColor Yellow
Write-Host '  laptop, and that mobile data is OFF on the phone.' -ForegroundColor Yellow
Write-Host ''
Write-Host '  The app runs in the SECOND window. Closing it stops the app.' -ForegroundColor Yellow
Write-Host ''
Read-Host '  Press Enter to close this window (the app keeps running)'
