# Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

# Installs the Windows build on the Windows this runs on and uses it the way a
# player does: installed, started, installed over while it is open, updated
# from the release before, uninstalled.
#
# The rest of what is known about the Windows build was seen on Linux, under
# wine, and wine answers some of these questions in its own way or not at all:
# what Windows does with a file that is in use, whether the installer can
# close a launcher that is open, how long a secret the Credential Manager
# takes. Here Windows answers them itself.
#
#   pwsh .github/scripts/verify-windows-install.ps1 `
#     -Installer <the installer this run built> `
#     -Previous <the installer of the last release under the older names> `
#     -Evidence <a folder for the logs and the pictures of the screen>
#
# It installs into the account it runs as, removes what it installed, deletes
# the launcher's data on the way and puts nothing back. It is for a machine
# that is thrown away afterwards — the packaging job's — and it refuses to
# start on one where a launcher or its data is already to be found.
#
# Exit codes: 0 everything held, 1 something did not, 2 the check itself could
# not be made.

[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $Installer,
  [Parameter(Mandatory)] [string] $Previous,
  [Parameter(Mandatory)] [string] $Evidence
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $IsWindows) {
  Write-Host '::error::this is a check of the Windows build, for a Windows'
  exit 2
}
foreach ($file in $Installer, $Previous) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
    Write-Host "::error::no installer at $file"
    exit 2
  }
}
$Installer = (Resolve-Path -LiteralPath $Installer).Path
$Previous = (Resolve-Path -LiteralPath $Previous).Path
$null = New-Item -ItemType Directory -Force -Path $Evidence
$Evidence = (Resolve-Path -LiteralPath $Evidence).Path

# ── What is where ────────────────────────────────────────────────────────────

$ExeName = 'Raven Forge Launcher.exe'
$UninstallerName = 'Uninstall Raven Forge Launcher.exe'
$ShortcutName = 'Raven Forge Launcher.lnk'

# The launcher has gone by two names. Up to 0.7.1 its folder and its data were
# named after the product, spaces and all; since then after the package.
$Programs = Join-Path $env:LOCALAPPDATA 'Programs'
$Folder = @{
  Now    = Join-Path $Programs 'raven-forge-launcher'
  Before = Join-Path $Programs 'Raven Forge Launcher'
}
$Data = @{
  Now    = Join-Path $env:APPDATA 'raven-forge-launcher'
  Before = Join-Path $env:APPDATA 'Raven Forge Launcher'
}
$UpdaterCache = Join-Path $env:LOCALAPPDATA 'raven-forge-launcher-updater'

# The name keytar files the launcher's secrets under, one entry an account.
$Vault = 'com.ravenforge.launcher'

# Where a debugger would listen, were one to open.
$InspectPort = 9229
$DevToolsPort = 9222

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace RavenForge -Name Windows -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)]
public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }

[DllImport("user32.dll")]
public static extern bool GetWindowRect(IntPtr window, out Rect rect);

[DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
static extern bool CredRead(string target, int type, int flags, out IntPtr credential);

[DllImport("advapi32.dll")]
static extern void CredFree(IntPtr credential);

// How many bytes the secret kept under a name is, or -1 when none is kept.
public static int SecretLength(string target) {
  IntPtr credential;
  if (!CredRead(target, 1, 0, out credential)) return -1;
  try {
    // CREDENTIALW: Flags and Type, two pointers, a FILETIME, and then the size.
    return Marshal.ReadInt32(credential, 8 + 2 * IntPtr.Size + 8);
  } finally {
    CredFree(credential);
  }
}
'@

# ── Saying what was seen ─────────────────────────────────────────────────────

$script:Failures = [System.Collections.Generic.List[string]]::new()
$script:InScene = $false

function Scene([string] $Title) {
  if ($script:InScene) { Write-Host '::endgroup::' }
  Write-Host "::group::$Title"
  $script:InScene = $true
}

# One thing that has to hold. It is said either way, and the run goes on: what
# comes after is usually still worth seeing.
function Expect {
  param($Holds, [string] $What, [string] $Instead = '')
  if ([bool] $Holds) {
    Write-Host "  OK      $What"
    return
  }
  $said = if ($Instead) { "$What — $Instead" } else { $What }
  $script:Failures.Add($said)
  Write-Host "::error::$said"
}

# Something measured and not judged.
function Note([string] $What) {
  Write-Host "  note    $What"
}

function Wait-Until {
  param([scriptblock] $Is, [int] $Seconds, [int] $EveryMs = 250)
  $until = [DateTime]::UtcNow.AddSeconds($Seconds)
  while ($true) {
    if (& $Is) { return $true }
    if ([DateTime]::UtcNow -ge $until) { return $false }
    Start-Sleep -Milliseconds $EveryMs
  }
}

# ── The installer and the uninstaller ────────────────────────────────────────

function Invoke-Setup {
  param([string] $File, [string[]] $Switches, [int] $Seconds = 600)
  $setup = Start-Process -FilePath $File -ArgumentList $Switches -PassThru
  # Asked for now, or the exit code is not there to be read afterwards.
  $null = $setup.Handle
  if (-not $setup.WaitForExit($Seconds * 1000)) {
    Stop-Process -Id $setup.Id -Force
    throw "$(Split-Path -Leaf $File) $Switches was still running after $Seconds s"
  }
  return $setup.ExitCode
}

# Without its pages, with the line Windows keeps for removing a program that
# way. NSIS copies an uninstaller out of the folder it is about to delete and
# carries on from the copy, so the program started here is back long before
# the work is done: what is waited for is the work.
function Invoke-Uninstall {
  param([string] $From, [string[]] $Switches = @(), [int] $Seconds = 180)
  $uninstaller = Join-Path $From $UninstallerName
  if (-not (Test-Path -LiteralPath $uninstaller)) { throw "no uninstaller in $From" }
  $run = Start-Process -FilePath $uninstaller -ArgumentList (@('/currentuser', '/S') + $Switches) -PassThru
  $null = $run.WaitForExit(60000)
  return (Wait-Until { -not (Test-Path -LiteralPath $From) -and @(Get-Listed).Count -eq 0 } $Seconds 500)
}

# The launcher's entries among the installed programs, as Settings → Apps
# shows them.
function Get-Listed {
  $under = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
  if (-not (Test-Path $under)) { return @() }
  return @(
    Get-ChildItem $under |
      ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath } |
      Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -like 'Raven Forge Launcher*' }
  )
}

# The folder an entry's uninstaller is in, which is the folder it is installed in.
function Get-ListedFolder($Entry) {
  if ($Entry.UninstallString -match '^"([^"]+)"') { return (Split-Path -Parent $Matches[1]) }
  return ''
}

function Get-ShortcutPath([string] $Place) {
  return (Join-Path ([Environment]::GetFolderPath($Place)) $ShortcutName)
}

# What a shortcut starts, or '' when the shortcut is not there.
function Get-ShortcutTarget([string] $Place) {
  $link = Get-ShortcutPath $Place
  if (-not (Test-Path -LiteralPath $link)) { return '' }
  return (New-Object -ComObject WScript.Shell).CreateShortcut($link).TargetPath
}

function Expect-Installed {
  param([string] $In, [string] $NotIn)
  Expect (Test-Path -LiteralPath (Join-Path $In $ExeName)) "the launcher is in $In"
  Expect (-not (Test-Path -LiteralPath $NotIn)) "and there is no $NotIn beside it"
  $listed = @(Get-Listed)
  Expect ($listed.Count -eq 1) 'Windows lists it once among the installed programs' "listed $($listed.Count) times"
  if ($listed.Count -gt 0) {
    $named = Get-ListedFolder $listed[0]
    Expect ($named -eq $In) 'and the uninstaller it names is the one in that folder' "it names $named"
  }
  foreach ($place in 'Desktop', 'Programs') {
    $target = Get-ShortcutTarget $place
    $where = if ($place -eq 'Desktop') { 'on the desktop' } else { 'in the Start menu' }
    Expect ($target -eq (Join-Path $In $ExeName)) "the shortcut $where starts it" "it starts '$target'"
  }
}

function Expect-Removed {
  param([string] $From)
  Expect (-not (Test-Path -LiteralPath $From)) "$From is gone"
  Expect (@(Get-Listed).Count -eq 0) 'Windows no longer lists the launcher'
  foreach ($place in 'Desktop', 'Programs') {
    Expect (-not (Test-Path -LiteralPath (Get-ShortcutPath $place))) "no shortcut is left in $([Environment]::GetFolderPath($place))"
  }
  Expect (-not (Test-Path -LiteralPath $UpdaterCache)) "nor the updater's own copy of the installer"
}

# ── The launcher ─────────────────────────────────────────────────────────────

# Every process of the launcher: it is several, as any Electron program is.
function Get-LauncherProcesses {
  return @(Get-Process -Name ([System.IO.Path]::GetFileNameWithoutExtension($ExeName)) -ErrorAction SilentlyContinue)
}

# The one that is the launcher itself: the one started as no `--type` of helper.
function Get-Launcher {
  $main = @(
    Get-CimInstance Win32_Process -Filter "Name = '$ExeName'" |
      Where-Object { $_.CommandLine -and $_.CommandLine -notmatch '--type=' }
  )
  if ($main.Count -eq 0) { return $null }
  $launcher = Get-Process -Id $main[0].ProcessId -ErrorAction SilentlyContinue
  if ($launcher) { $null = $launcher.Handle }
  return $launcher
}

function Get-LauncherFolder {
  $main = @(
    Get-CimInstance Win32_Process -Filter "Name = '$ExeName'" |
      Where-Object { $_.CommandLine -and $_.CommandLine -notmatch '--type=' }
  )
  if ($main.Count -eq 0 -or -not $main[0].ExecutablePath) { return '' }
  return (Split-Path -Parent $main[0].ExecutablePath)
}

# `-Heard` keeps what it writes to its output and its errors, in two files. A
# launcher started that way holds this script's own output open for as long as
# it runs, so every one of them is closed again before the scene is over.
function Start-Launcher {
  param([string] $From, [string[]] $Switches = @(), [string] $Heard = '')
  $start = @{ FilePath = (Join-Path $From $ExeName); WorkingDirectory = $From; PassThru = $true }
  if ($Switches.Count -gt 0) { $start.ArgumentList = $Switches }
  if ($Heard) {
    $start.RedirectStandardOutput = "$Heard.out.txt"
    $start.RedirectStandardError = "$Heard.err.txt"
  }
  $launcher = Start-Process @start
  $null = $launcher.Handle
  return $launcher
}

# The launcher's log, read while the launcher has it open.
function Get-Log([string] $Of) {
  $file = Join-Path $Of 'logs\main.log'
  if (-not (Test-Path -LiteralPath $file)) { return @() }
  $stream = [System.IO.File]::Open($file, 'Open', 'Read', 'ReadWrite, Delete')
  try {
    return @([System.IO.StreamReader]::new($stream).ReadToEnd() -split "`r?`n")
  } finally {
    $stream.Dispose()
  }
}

# The lines of the log that hold a text. The text as it stands, not a pattern:
# a level is written in square brackets, which a pattern would read as a set.
function Get-Said([string] $Of, [string] $Text) {
  return @(Get-Log $Of | Where-Object { $_.Contains($Text) })
}

# A start has finished when the log says so; the log is one file for every
# start, so it is the count of that line that tells one start from the next.
function Get-Started([string] $Of) {
  return @(Get-Said $Of 'Raven Forge Launcher ready.').Count
}

function Wait-Started {
  param([string] $In, [int] $Before, [int] $Seconds = 120)
  return (Wait-Until { (Get-Started $In) -gt $Before } $Seconds 500)
}

# Closed as a player closes it: by its window. One that has no window to ask
# is ended, and the answer says which it was.
function Close-Launcher {
  param([System.Diagnostics.Process] $Launcher, [int] $Seconds = 30)
  $Launcher.Refresh()
  $asked = $false
  if (-not $Launcher.HasExited -and $Launcher.MainWindowHandle -ne [IntPtr]::Zero) {
    $asked = $Launcher.CloseMainWindow()
  }
  $left = $asked -and $Launcher.WaitForExit($Seconds * 1000)
  if (-not $left -and -not $Launcher.HasExited) {
    Stop-Process -Id $Launcher.Id -Force
    $null = $Launcher.WaitForExit(10000)
  }
  $code = if ($Launcher.HasExited) { $Launcher.ExitCode } else { $null }
  $none = Wait-Until { @(Get-LauncherProcesses).Count -eq 0 } 20
  return [pscustomobject]@{ Asked = $asked; Left = $left; ExitCode = $code; NoneLeft = $none }
}

function Expect-Closed {
  param($Closed)
  Expect $Closed.Asked 'its window takes a request to close'
  Expect $Closed.Left 'and the launcher leaves when it is closed'
  Expect ($Closed.ExitCode -eq 0) 'with nothing to report' "it left with $($Closed.ExitCode)"
  Expect $Closed.NoneLeft 'and none of its processes stays behind'
}

function Stop-Launchers {
  foreach ($process in Get-LauncherProcesses) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
  $null = Wait-Until { @(Get-LauncherProcesses).Count -eq 0 } 20
}

# ── The machine ──────────────────────────────────────────────────────────────

function Test-Listening([int] $Port) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    return ($client.ConnectAsync('127.0.0.1', $Port).Wait(1500) -and $client.Connected)
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

# What a browser's debugger says of itself when asked, or nothing.
function Get-Debugger([int] $Port) {
  try {
    return (Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 3)
  } catch {
    return $null
  }
}

function Save-Screen([string] $As) {
  try {
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $picture = [System.Drawing.Bitmap]::new($screen.Width, $screen.Height)
    $canvas = [System.Drawing.Graphics]::FromImage($picture)
    try {
      $canvas.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
      $picture.Save((Join-Path $Evidence "$As.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $canvas.Dispose()
      $picture.Dispose()
    }
    Note "the screen as it was then is in $As.png"
  } catch {
    Note "no picture of the screen could be taken: $($_.Exception.Message)"
  }
}

function Save-Log([string] $Of, [string] $As) {
  $file = Join-Path $Of 'logs\main.log'
  if (Test-Path -LiteralPath $file) { Copy-Item -LiteralPath $file -Destination (Join-Path $Evidence "$As.log") -Force }
}

# ── The run ──────────────────────────────────────────────────────────────────

# Before anything is touched: this deletes a launcher's data further down, and
# must never meet data that is somebody's.
$found = @($Folder.Now, $Folder.Before, $Data.Now, $Data.Before | Where-Object { Test-Path -LiteralPath $_ })
if ($found.Count -gt 0 -or @(Get-Listed).Count -gt 0) {
  Write-Host "::error::a launcher or its data is already on this machine ($($found -join ', ')) — this check is for one that is thrown away"
  exit 2
}

try {
  Scene 'The machine'
  Note "$((Get-CimInstance Win32_OperatingSystem).Caption), build $([Environment]::OSVersion.Version.Build), as $([Environment]::UserName)"
  Note "a desktop somebody could be sitting at: $([System.Windows.Forms.SystemInformation]::UserInteractive); session $((Get-Process -Id $PID).SessionId)"
  try {
    # The screen a runner comes with is smaller than the launcher's window.
    $null = Set-DisplayResolution -Width 1920 -Height 1080 -Force
  } catch {
    Note "the screen keeps its size: $($_.Exception.Message)"
  }
  $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  Note "the screen is $($screen.Width) by $($screen.Height)"
  foreach ($port in $InspectPort, $DevToolsPort) {
    if (Test-Listening $port) { throw "something already listens on port $port, so nothing could be told from it" }
  }

  # ── 1 ──
  Scene 'On a Windows that has never had the launcher'
  $code = Invoke-Setup $Installer @('/S')
  Expect ($code -eq 0) 'the installer, run without its pages, ends well' "it ended with $code"
  Expect-Installed -In $Folder.Now -NotIn $Folder.Before

  $before = Get-Started $Data.Now
  Start-Process -FilePath (Get-ShortcutPath 'Desktop')
  $up = Wait-Started $Data.Now $before
  Expect $up 'started from the shortcut on the desktop, the launcher comes up' 'its log never said that it was ready'
  if (-not $up) { throw 'the launcher does not start, and nothing more can be seen without it' }
  $launcher = Get-Launcher
  if ($null -eq $launcher) { throw 'the launcher said it was ready and is not running' }
  Expect ((Get-LauncherFolder) -eq $Folder.Now) "from $($Folder.Now)" "from '$(Get-LauncherFolder)'"
  Expect (Test-Path -LiteralPath (Join-Path $Data.Now 'settings.json')) "its settings are saved in $($Data.Now)"
  Expect (-not (Test-Path -LiteralPath $Data.Before)) 'and nothing is made under the older name'
  $halfWritten = @(Get-ChildItem -LiteralPath $Data.Now -Filter '*.tmp' -File)
  Expect ($halfWritten.Count -eq 0) 'no half-written file is left beside them' (@($halfWritten | ForEach-Object Name) -join ', ')
  $windowed = Wait-Until { $launcher.Refresh(); $launcher.MainWindowHandle -ne [IntPtr]::Zero } 20
  Expect $windowed 'it has a window'
  if ($windowed) {
    $rect = [RavenForge.Windows+Rect]::new()
    $null = [RavenForge.Windows]::GetWindowRect($launcher.MainWindowHandle, [ref] $rect)
    Note "its window is $($rect.Right - $rect.Left) by $($rect.Bottom - $rect.Top) and is titled '$($launcher.MainWindowTitle)'"
  }
  # Long enough for the page to have drawn what it draws.
  Start-Sleep -Seconds 4
  Save-Screen 'first-start'
  Expect-Closed (Close-Launcher $launcher)
  $errors = @(Get-Said $Data.Now '] [error]')
  Expect ($errors.Count -eq 0) 'its log holds no error' ($errors -join ' | ')
  foreach ($line in Get-Said $Data.Now '] [warn]') { Note "warned: $line" }

  # ── 2 ──
  Scene 'Nothing but the launcher'
  # Told to be Node.js, an Electron program runs the script it is handed and
  # leaves with that script's 42; told to open a debugger, it says where it
  # listens. The installed launcher is to do neither.
  $env:ELECTRON_RUN_AS_NODE = '1'
  try {
    $asNode = Start-Launcher $Folder.Now @('-e', 'process.exit(42)')
  } finally {
    Remove-Item Env:ELECTRON_RUN_AS_NODE
  }
  $ranIt = $asNode.WaitForExit(15000) -and $asNode.ExitCode -eq 42
  Expect (-not $ranIt) 'told to be Node.js, it does not run the script it is handed'
  Stop-Launchers

  $before = Get-Started $Data.Now
  $heard = Join-Path $Evidence 'started-with-debugger-switches'
  $launcher = Start-Launcher $Folder.Now @("--inspect=127.0.0.1:$InspectPort", "--remote-debugging-port=$DevToolsPort") $heard
  $up = Wait-Started $Data.Now $before
  Expect $up 'started with both of the switches that open a debugger, it comes up all the same'
  # A debugger that was going to listen is listening by now.
  Start-Sleep -Seconds 5
  Expect (-not (Test-Listening $InspectPort)) '--inspect opens nothing on the launcher itself'
  Expect (-not (Test-Listening $DevToolsPort)) '--remote-debugging-port opens nothing on the browser inside it'
  Expect (-not (Test-Path -LiteralPath (Join-Path $Data.Now 'browser\DevToolsActivePort'))) 'and the browser has written down no port'
  Expect-Closed (Close-Launcher $launcher)
  $said = (Get-Content -LiteralPath "$heard.err.txt", "$heard.out.txt" -Raw -ErrorAction SilentlyContinue) -join "`n"
  Expect ($said -notmatch 'Debugger listening|DevTools listening') 'nor has either said that it listens'

  # ── 3 ──
  Scene 'The installer, run while the launcher is open'
  $before = Get-Started $Data.Now
  $launcher = Start-Launcher $Folder.Now
  if (-not (Wait-Started $Data.Now $before)) { throw 'the launcher did not start again' }
  $code = Invoke-Setup $Installer @('/S')
  Expect ($code -eq 0) 'the installer ends well' "it ended with $code"
  Expect ($launcher.WaitForExit(5000)) 'having closed the launcher that was open by itself'
  Expect (@(Get-LauncherProcesses).Count -eq 0) 'and started no other in its place'
  Expect-Installed -In $Folder.Now -NotIn $Folder.Before
  Stop-Launchers

  # ── 4 ──
  Scene 'Secrets in the Credential Manager'
  # A sign-in cannot be made here, and what it would leave can: secrets in the
  # account file, which is where an older build kept them and where the
  # launcher lifts them from at its next start. Of several lengths, because
  # Windows takes a secret only up to a size and no token says how long it
  # will be. No account is listed with them: nothing is to be signed in.
  $lengths = 512, 1024, 2048, 2560, 2561, 4096
  $session = 1536
  $store = [ordered]@{
    accounts        = @()
    activeAccountId = $null
    refreshTokens   = [ordered]@{}
    mcSessions      = [ordered]@{ 'probe-session' = [ordered]@{ expiresAt = 1; accessToken = 's' * $session } }
  }
  foreach ($length in $lengths) { $store.refreshTokens["probe-$length"] = 'r' * $length }
  $accounts = Join-Path $Data.Now 'auth.json'
  Expect (-not (Test-Path -LiteralPath $accounts)) 'no account file has been written while nobody signed in'
  [System.IO.File]::WriteAllText($accounts, ($store | ConvertTo-Json -Depth 5))
  $movedBefore = @(Get-Said $Data.Now 'into the OS keychain').Count

  $before = Get-Started $Data.Now
  $launcher = Start-Launcher $Folder.Now
  if (-not (Wait-Started $Data.Now $before)) { throw 'the launcher did not start again' }
  $moved = Wait-Until { @(Get-Said $Data.Now 'into the OS keychain').Count -gt $movedBefore } 45 500
  Expect $moved 'the launcher moves secrets it finds in its account file into the Credential Manager'
  foreach ($line in @(Get-Said $Data.Now 'into the OS keychain') | Select-Object -Last 1) { Note "its log: $line" }
  Expect-Closed (Close-Launcher $launcher)

  $kept = Get-Content -LiteralPath $accounts -Raw | ConvertFrom-Json
  $stillInFile = @($kept.refreshTokens.PSObject.Properties | ForEach-Object Name)
  $fits = 0
  foreach ($length in $lengths) {
    $inVault = [RavenForge.Windows]::SecretLength("$Vault/msRefresh:probe-$length")
    $inFile = $stillInFile -contains "probe-$length"
    if ($inVault -eq $length -and -not $inFile) {
      Note "a secret of $length characters is in the Credential Manager, whole, and out of the file"
      $fits = $length
    } elseif ($inVault -eq -1 -and $inFile) {
      Note "a secret of $length characters was refused by Windows and is still in the file"
    } else {
      Expect $false "a secret of $length characters is in one place, whole" "$inVault bytes of it in the Credential Manager, in the file: $inFile"
    }
  }
  Expect ($fits -ge 2048) 'a secret of two thousand characters fits, which is several times a token' "the longest that fitted was $fits"
  $inVault = [RavenForge.Windows]::SecretLength("$Vault/mcAccess:probe-session")
  $sessionKept = $kept.mcSessions.'probe-session'
  Expect ($inVault -eq $session -and -not $sessionKept.PSObject.Properties['accessToken']) 'a game session is moved the same way' "$inVault bytes of it in the Credential Manager"
  Expect ($sessionKept.expiresAt -eq 1) 'and when it runs out stays in the file, which is no secret'

  foreach ($name in @($lengths | ForEach-Object { "msRefresh:probe-$_" }) + 'mcAccess:probe-session') {
    $null = & cmdkey.exe "/delete:$Vault/$name" 2>&1
  }
  Remove-Item -LiteralPath $accounts -Force

  # ── 5 ──
  Scene 'Uninstalled, the data kept'
  Save-Log $Data.Now 'installed-fresh'
  Expect (Invoke-Uninstall $Folder.Now) 'the uninstaller, run without its pages, finishes'
  Expect-Removed -From $Folder.Now
  Expect (Test-Path -LiteralPath (Join-Path $Data.Now 'settings.json')) 'the data is where it was: nobody was asked, so nothing was deleted'

  # ── 6 ──
  Scene 'Installed again, and uninstalled with its data'
  $code = Invoke-Setup $Installer @('/S')
  Expect ($code -eq 0) 'the installer ends well' "it ended with $code"
  Expect-Installed -In $Folder.Now -NotIn $Folder.Before
  $before = Get-Started $Data.Now
  $launcher = Start-Launcher $Folder.Now
  Expect (Wait-Started $Data.Now $before) 'the launcher comes up on the data that was kept'
  Expect-Closed (Close-Launcher $launcher)
  Save-Log $Data.Now 'installed-again'
  Expect (Invoke-Uninstall $Folder.Now @('--delete-app-data')) 'the uninstaller, told to take the data with it, finishes'
  Expect-Removed -From $Folder.Now
  Expect (-not (Test-Path -LiteralPath $Data.Now)) 'and the data is gone with it'

  # ── 7 ──
  Scene 'The release before, as a player has it'
  $code = Invoke-Setup $Previous @('/S')
  Expect ($code -eq 0) 'its installer ends well' "it ended with $code"
  Expect-Installed -In $Folder.Before -NotIn $Folder.Now
  $heard = Join-Path $Evidence 'release-before'
  $before = Get-Started $Data.Before
  $older = Start-Launcher $Folder.Before @("--remote-debugging-port=$DevToolsPort") $heard
  if (-not (Wait-Started $Data.Before $before)) { throw 'the release before does not start, so there is nothing to update from' }
  # The other half of scene 2. That release opens a debugger when asked, and
  # here it is asked in the same words: an answer from it is what makes the
  # silence above mean something on this machine.
  $script:answer = $null
  $null = Wait-Until { $script:answer = Get-Debugger $DevToolsPort; $null -ne $script:answer } 20 500
  Expect ($null -ne $script:answer) 'asked for a debugger in the same words, that release opens one'
  if ($script:answer) { Note "it answers as $($script:answer.Browser)" }
  Start-Sleep -Seconds 4
  Save-Screen 'release-before'

  # Something of the player's, to be found again afterwards.
  $world = 'profiles\probe\.minecraft\saves\World\level.dat'
  $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent (Join-Path $Data.Before $world))
  Set-Content -LiteralPath (Join-Path $Data.Before $world) -Value 'a world'
  Note "that release keeps in its folder: $(@(Get-ChildItem -LiteralPath $Data.Before -Force | ForEach-Object Name) -join ', ')"

  # ── 8 ──
  Scene 'Updated the way the launcher updates itself'
  # With the older launcher still open, which is the hard case of it: the
  # updater starts the installer as the launcher is leaving, not after.
  $programBefore = (Get-FileHash -LiteralPath (Join-Path $Folder.Before 'resources\app.asar')).Hash
  # The log goes with the folder when the folder is renamed, and the older
  # release's starts are in it: those are the count to get past.
  $before = Get-Started $Data.Before
  $code = Invoke-Setup $Installer @('--updated', '/S', '--force-run')
  Expect ($code -eq 0) 'the installer, run as the updater runs it, ends well' "it ended with $code"
  Expect ($older.WaitForExit(5000)) 'having closed the older launcher by itself'
  # An update stays where the program was. Nobody is there to be asked.
  Expect-Installed -In $Folder.Before -NotIn $Folder.Now
  $programNow = (Get-FileHash -LiteralPath (Join-Path $Folder.Before 'resources\app.asar')).Hash
  Expect ($programNow -ne $programBefore) 'the program in that folder is the new one'

  $up = Wait-Started $Data.Now $before
  Expect $up 'the installer starts the launcher again, and it comes up'
  if (-not $up) { throw 'the launcher did not come back after the update' }
  Expect ((Get-LauncherFolder) -eq $Folder.Before) 'from the folder it was updated in' "from '$(Get-LauncherFolder)'"
  Expect (@(Get-Said $Data.Now 'Renamed the home from').Count -eq 1) 'it says that it renamed its data folder'
  Expect (@(Get-Said $Data.Now 'is in use, so it is the home').Count -eq 0) 'and not that the folder was in use'
  Expect (-not (Test-Path -LiteralPath $Data.Before)) "$($Data.Before) is gone"
  Expect (Test-Path -LiteralPath (Join-Path $Data.Now $world)) "and the world that was in it is in $($Data.Now)"
  Expect (Test-Path -LiteralPath (Join-Path $Data.Now 'settings.json')) 'with the settings'
  Start-Sleep -Seconds 4
  Save-Screen 'after-the-update'
  $launcher = Get-Launcher
  if ($launcher) { Expect-Closed (Close-Launcher $launcher) }
  # Only what this build wrote. The log came over with the folder, the older
  # release's lines in it, and this build's begin where it last said that it
  # was starting.
  $log = @(Get-Log $Data.Now)
  $from = [Array]::FindLastIndex([string[]] $log, [Predicate[string]] { param($line) $line.Contains('starting...') })
  $mine = if ($from -ge 0) { @($log[$from..($log.Count - 1)]) } else { $log }
  $errors = @($mine | Where-Object { $_.Contains('] [error]') })
  Expect ($errors.Count -eq 0) 'its log holds no error' ($errors -join ' | ')
  foreach ($line in @($mine | Where-Object { $_.Contains('] [warn]') })) { Note "warned: $line" }

  # ── 9 ──
  Scene 'And removed'
  Save-Log $Data.Now 'updated'
  Expect (Invoke-Uninstall $Folder.Before) 'the uninstaller finishes'
  Expect-Removed -From $Folder.Before
  Expect (Test-Path -LiteralPath (Join-Path $Data.Now $world)) 'the world is still there'
} catch {
  $script:Failures.Add("the run stopped: $($_.Exception.Message)")
  Write-Host "::error::the run stopped: $($_.Exception.Message)"
  Write-Host $_.ScriptStackTrace
} finally {
  Stop-Launchers
  Save-Log $Data.Now 'last'
  Save-Log $Data.Before 'last-release-before'
  if ($script:InScene) { Write-Host '::endgroup::' }
}

if ($script:Failures.Count -gt 0) {
  Write-Host "$($script:Failures.Count) thing(s) did not hold:"
  foreach ($failure in $script:Failures) { Write-Host "  - $failure" }
  exit 1
}
Write-Host 'Everything held.'
