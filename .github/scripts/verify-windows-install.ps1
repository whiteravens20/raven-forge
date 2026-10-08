# Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

# Installs the Windows build on the Windows this runs on and uses it the way a
# player does: installed, started, installed over while it is open, updated
# from the release before, uninstalled — without the installer's pages, as an
# update runs it, and through them, as somebody at the machine does.
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

# Something of the player's, put into the release before's data to be found
# again after whatever replaces that release.
$World = 'profiles\probe\.minecraft\saves\World\level.dat'

# Where a debugger would listen, were one to open.
$InspectPort = 9229
$DevToolsPort = 9222

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace RavenForge {
  public static class Windows {
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
  }

  // One thing in a dialog: a button, a line of text, a field.
  public sealed class Control {
    public IntPtr Handle;
    public string Kind;
    public int Id;
    public string Text;
    public bool Shown;
    public bool Enabled;
    public int Style;
  }

  // A dialog on the desktop: an installer's window, or a question it asks.
  public sealed class Dialog {
    public IntPtr Handle;
    public int ProcessId;
    public string Title;
    public List<Control> Controls = new List<Control>();
  }

  public static class Dialogs {
    delegate bool Each(IntPtr window, IntPtr unused);

    [DllImport("user32.dll")] static extern bool EnumWindows(Each each, IntPtr unused);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, Each each, IntPtr unused);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr GetDlgItem(IntPtr dialog, int id);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder name, int size);
    [DllImport("user32.dll", EntryPoint = "PostMessageW")] static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode)]
    static extern IntPtr GetText(IntPtr window, uint message, IntPtr size, StringBuilder text, uint flags, uint milliseconds, out IntPtr copied);
    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW")]
    static extern IntPtr Send(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint milliseconds, out IntPtr answer);

    const uint WM_GETTEXT = 0x000D, WM_COMMAND = 0x0111, BM_SETCHECK = 0x00F1, BM_CLICK = 0x00F5, SMTO_ABORTIFHUNG = 0x0002;

    static string KindOf(IntPtr window) {
      var name = new StringBuilder(256);
      GetClassName(window, name, name.Capacity);
      return name.ToString();
    }

    // Asked of the window itself: across programs that is the only way to the
    // text of a field, and the program may be one that is not answering.
    static string TextOf(IntPtr window) {
      var text = new StringBuilder(8192);
      IntPtr copied;
      GetText(window, WM_GETTEXT, (IntPtr)text.Capacity, text, SMTO_ABORTIFHUNG, 2000, out copied);
      return text.ToString();
    }

    // Every dialog that is on the desktop now, with what is in it.
    public static List<Dialog> All() {
      var found = new List<Dialog>();
      EnumWindows((window, unused) => {
        if (!IsWindowVisible(window) || KindOf(window) != "#32770") return true;
        uint owner;
        GetWindowThreadProcessId(window, out owner);
        var dialog = new Dialog { Handle = window, ProcessId = (int)owner, Title = TextOf(window) };
        EnumChildWindows(window, (child, alsoUnused) => {
          dialog.Controls.Add(new Control {
            Handle = child,
            Kind = KindOf(child),
            Id = GetDlgCtrlID(child),
            Text = TextOf(child),
            Shown = IsWindowVisible(child),
            Enabled = IsWindowEnabled(child),
            Style = GetWindowLong(child, -16),
          });
          return true;
        }, IntPtr.Zero);
        found.Add(dialog);
        return true;
      }, IntPtr.Zero);
      return found;
    }

    public static bool IsThere(IntPtr dialog) {
      return IsWindow(dialog) && IsWindowVisible(dialog);
    }

    // A button pressed the way its dialog hears of a press: told so, with the
    // button's number. No pointer is moved and no key is sent, so it does not
    // matter what else is on the screen or which window is in front.
    public static bool Press(IntPtr dialog, int button) {
      return PostMessage(dialog, WM_COMMAND, (IntPtr)button, GetDlgItem(dialog, button));
    }

    // The same press made on the button itself, for a dialog that did not
    // take the first.
    public static void Click(IntPtr button) {
      IntPtr answer;
      Send(button, BM_CLICK, IntPtr.Zero, IntPtr.Zero, SMTO_ABORTIFHUNG, 2000, out answer);
    }

    public static void Tick(IntPtr box, bool ticked) {
      IntPtr answer;
      Send(box, BM_SETCHECK, (IntPtr)(ticked ? 1 : 0), IntPtr.Zero, SMTO_ABORTIFHUNG, 2000, out answer);
    }
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

# Everything is started through this, with the module path every program on
# the machine gets and not this script's own. An installer asks Windows' own
# PowerShell which programs are running from its folder. Handed the module
# path of the newer PowerShell this script runs in, that one finds none of its
# commands, and the installer falls back to asking by the program's name —
# which is not what it does on a player's machine, and closes a launcher that
# the other way would not have found.
function Start-Program {
  param([hashtable] $As)
  $mine = $env:PSModulePath
  $env:PSModulePath = [Environment]::GetEnvironmentVariable('PSModulePath', 'Machine')
  try {
    $program = Start-Process @As -PassThru
    # Asked for now, or the exit code is not there to be read afterwards.
    if ($program) { $null = $program.Handle }
    return $program
  } finally {
    $env:PSModulePath = $mine
  }
}

function Invoke-Setup {
  param([string] $File, [string[]] $Switches, [int] $Seconds = 600)
  $setup = Start-Program @{ FilePath = $File; ArgumentList = $Switches }
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
  $run = Start-Program @{ FilePath = $uninstaller; ArgumentList = (@('/currentuser', '/S') + $Switches) }
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

# The release before as a player has it: installed, started, and with a world
# in its data. Left open, because both ways of replacing it are tried on a
# launcher that is open.
function Start-ReleaseBefore {
  param([string[]] $Switches = @(), [string] $Heard = '')
  $code = Invoke-Setup $Previous @('/S')
  Expect ($code -eq 0) 'its installer ends well' "it ended with $code"
  Expect-Installed -In $Folder.Before -NotIn $Folder.Now
  $before = Get-Started $Data.Before
  $older = Start-Launcher $Folder.Before $Switches $Heard
  if (-not (Wait-Started $Data.Before $before)) { throw 'the release before does not start, so there is nothing to replace' }
  $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent (Join-Path $Data.Before $World))
  Set-Content -LiteralPath (Join-Path $Data.Before $World) -Value 'a world'
  return $older
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
  $start = @{ FilePath = (Join-Path $From $ExeName); WorkingDirectory = $From }
  if ($Switches.Count -gt 0) { $start.ArgumentList = $Switches }
  if ($Heard) {
    $start.RedirectStandardOutput = "$Heard.out.txt"
    $start.RedirectStandardError = "$Heard.err.txt"
  }
  return (Start-Program $start)
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

# ── The pages ────────────────────────────────────────────────────────────────

# The buttons a question can be answered with, by the numbers Windows gives
# them. In an installer's own window the one that leads on — Next, I Agree,
# Install, Finish — is number 1 on every page.
$Reply = @{ OK = 1; Cancel = 2; Yes = 6; No = 7 }
$LeadsOn = 1

# The two things an installer or an uninstaller may ask, by a piece of their
# wording, in English and in Polish: whether to close a launcher that is open,
# and whether to keep the data.
$AsksToClose = 'Raven Forge Launcher is running|Raven Forge Launcher jest uruchomiona'
$AsksToKeep = 'Keep your Raven Forge data|Zachować dane Raven Forge'

function Get-Dialogs([int[]] $Of) {
  return @([RavenForge.Dialogs]::All() | Where-Object { $Of -contains $_.ProcessId })
}

function Push-Button($Dialog, [int] $Number) {
  $null = [RavenForge.Dialogs]::Press($Dialog.Handle, $Number)
}

# The same press made on the button itself, for a page that did not take the
# first.
function Push-ButtonItself($Button) {
  [RavenForge.Dialogs]::Click($Button.Handle)
}

function Set-Box($Box, [bool] $Ticked) {
  [RavenForge.Dialogs]::Tick($Box.Handle, $Ticked)
}

function Test-Dialog($Dialog) {
  return [RavenForge.Dialogs]::IsThere($Dialog.Handle)
}

# What a dialog is, told by what is in it and never by its wording, which is
# in the language of the Windows it runs on. An installer's window keeps a
# place for its pages, number 1018, whatever page is in it. A dialog without
# one is a question when it has a button to answer with, and otherwise
# something that only says it is busy. A page is known by the one thing only
# it has.
function Get-Page($Dialog) {
  $shown = @($Dialog.Controls | Where-Object { $_.Shown })
  if (@($Dialog.Controls | Where-Object { $_.Id -eq 1018 }).Count -eq 0) {
    if (@($shown | Where-Object { $_.Kind -eq 'Button' }).Count -gt 0) { return 'a question' }
    return 'a notice'
  }
  if (@($shown | Where-Object { $_.Kind -eq '#32770' }).Count -eq 0) { return 'between pages' }
  if (@($shown | Where-Object { $_.Kind -like 'RichEdit*' }).Count -gt 0) { return 'the licence' }
  if (@($shown | Where-Object { $_.Kind -eq 'Edit' -and $_.Id -eq 1019 }).Count -gt 0) { return 'the folder' }
  if (@($shown | Where-Object { $_.Kind -eq 'msctls_progress32' }).Count -gt 0) { return 'the work' }
  if (@($shown | Where-Object { $_.Kind -eq 'Button' -and ($_.Style -band 0xF) -eq 9 }).Count -ge 2) { return 'for whom' }
  return 'words'
}

# Goes through the pages of an installer or an uninstaller as somebody at the
# machine does: on to the next page from each, an answer to each question, and
# at the end the box that offers to start the launcher ticked or not. Says
# what it met.
#
# `-Whose` gives the processes whose dialogs these are, and none once the
# program has left. `-Answers` holds, for a piece of a question's wording, the
# button to answer it with; a question that nothing there fits stops the run,
# which is better than answering what nobody has read.
function Step-Through {
  param(
    [scriptblock] $Whose,
    [System.Collections.IDictionary] $Answers = @{},
    [bool] $RunAfter = $false,
    [string] $Pictures = '',
    [int] $Seconds = 600
  )
  $met = [pscustomobject]@{
    Pages     = [System.Collections.Generic.List[string]]::new()
    Folder    = ''
    Questions = [System.Collections.Generic.List[string]]::new()
  }
  $pressed = @{}
  $clicked = @{}
  $worked = $false
  $started = $false
  $idleSince = $null
  $until = [DateTime]::UtcNow.AddSeconds($Seconds)
  while ([DateTime]::UtcNow -lt $until) {
    $ids = @(& $Whose)
    if ($ids.Count -eq 0) {
      if ($started) { return $met }
      Start-Sleep -Milliseconds 200
      continue
    }
    $started = $true
    $dialogs = @(Get-Dialogs $ids)

    $question = @($dialogs | Where-Object { (Get-Page $_) -eq 'a question' }) | Select-Object -First 1
    if ($question) {
      $asked = (@($question.Controls | Where-Object { $_.Kind -eq 'Static' -and $_.Text } | ForEach-Object Text) -join ' ') -replace '\s+', ' '
      $met.Questions.Add($asked)
      if ($Pictures) { Save-Screen "$Pictures-question-$($met.Questions.Count)" }
      $with = $null
      foreach ($about in $Answers.Keys) {
        if ($asked -match $about) { $with = $Answers[$about]; break }
      }
      if ($null -eq $with) { throw "asked something nobody expected: $asked" }
      Push-Button $question $with
      if (-not (Wait-Until { -not (Test-Dialog $question) } 20)) { throw "a question would not take its answer: $asked" }
      continue
    }

    $window = @($dialogs | Where-Object { (Get-Page $_) -notin 'a question', 'a notice' }) | Select-Object -First 1
    $page = if ($window) { Get-Page $window } else { 'between pages' }
    if ($page -eq 'words') { $page = if ($worked) { 'the end' } else { 'the welcome' } }
    $button = if ($window) { @($window.Controls | Where-Object { $_.Kind -eq 'Button' -and $_.Id -eq $LeadsOn }) | Select-Object -First 1 } else { $null }
    $ready = $button -and $button.Shown -and $button.Enabled

    if ($page -eq 'the work') {
      $worked = $true
      # An installer with a page after this one goes to it by itself when the
      # work is done. One that waits here to be told is told.
      if (-not $ready) { $idleSince = $null }
      elseif ($null -eq $idleSince) { $idleSince = [DateTime]::UtcNow }
      elseif (([DateTime]::UtcNow - $idleSince).TotalSeconds -gt 8) { Push-Button $window $LeadsOn; $idleSince = $null }
    } elseif ($page -ne 'between pages' -and $ready) {
      if (-not $pressed.ContainsKey($page)) {
        $met.Pages.Add($page)
        if ($page -eq 'the folder') {
          $met.Folder = (@($window.Controls | Where-Object { $_.Kind -eq 'Edit' -and $_.Id -eq 1019 }) | Select-Object -First 1).Text
        }
        if ($page -eq 'the end') {
          foreach ($box in @($window.Controls | Where-Object { $_.Kind -eq 'Button' -and $_.Shown -and (($_.Style -band 0xF) -in 2, 3) })) {
            Set-Box $box $RunAfter
          }
        }
        if ($Pictures) { Save-Screen "$Pictures-$($met.Pages.Count)-$($page -replace ' ', '-')" }
        Push-Button $window $LeadsOn
        $pressed[$page] = [DateTime]::UtcNow
      } else {
        $waited = ([DateTime]::UtcNow - $pressed[$page]).TotalSeconds
        if ($waited -gt 10 -and -not $clicked.ContainsKey($page)) {
          # Told once already and still here.
          Push-ButtonItself $button
          $clicked[$page] = $true
        } elseif ($waited -gt 40) {
          throw "$page does not lead on"
        }
      }
    }
    Start-Sleep -Milliseconds 200
  }
  throw "its pages were not over after $Seconds s, having met: $($met.Pages -join ', ')"
}

# An installer's pages are its own process. An uninstaller copies itself out
# of the folder it is about to delete and shows its pages from the copy: a
# process the one that was started leaves behind it, under a name NSIS gives.
function Get-UninstallersAtWork($Started) {
  $ids = @(Get-Process | Where-Object { $_.ProcessName -match '^(Un_[A-Z]|Au_)$' } | ForEach-Object Id)
  $ids += @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($Started.Id)" | ForEach-Object ProcessId)
  if (-not $Started.HasExited) { $ids += $Started.Id }
  return @($ids | Sort-Object -Unique)
}

function Expect-Pages {
  param($Met, [string[]] $Are)
  Expect (($Met.Pages -join ', ') -eq ($Are -join ', ')) "its pages are $($Are -join ', ')" "they were $($Met.Pages -join ', ')"
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
  # The question an installer puts to Windows' own PowerShell before it relies
  # on it, put the same way and to the same one: the 32-bit, which is the one
  # a 32-bit installer finds.
  $asked = Start-Program @{
    FilePath     = (Join-Path $env:SystemRoot 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe')
    ArgumentList = '-NoProfile -Command "if (Get-Command Get-CimInstance -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"'
    WindowStyle  = 'Hidden'
  }
  if (-not $asked.WaitForExit(120000)) { Stop-Process -Id $asked.Id -Force }
  Expect ($asked.HasExited -and $asked.ExitCode -eq 0) "Windows' own PowerShell answers an installer here, as it does on a player's machine" "it left with $($asked.ExitCode)"

  # ── 1 ──
  Scene 'On a Windows that has never had the launcher'
  $code = Invoke-Setup $Installer @('/S')
  Expect ($code -eq 0) 'the installer, run without its pages, ends well' "it ended with $code"
  Expect-Installed -In $Folder.Now -NotIn $Folder.Before

  $before = Get-Started $Data.Now
  $null = Start-Program @{ FilePath = (Get-ShortcutPath 'Desktop') }
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
  # Windows takes a secret only up to a size, and how long a token is is for
  # whoever issues it to say. No account is listed with them: nothing is to
  # be signed in.
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
  Note "the longest secret Windows took was $fits characters"
  Expect ($fits -ge 2048) 'a secret of two thousand characters fits' "the longest that fitted was $fits"
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
  $older = Start-ReleaseBefore @("--remote-debugging-port=$DevToolsPort") (Join-Path $Evidence 'release-before')
  # The other half of scene 2. That release opens a debugger when asked, and
  # here it is asked in the same words: an answer from it is what makes the
  # silence above mean something on this machine.
  $script:debugger = $null
  $null = Wait-Until { $script:debugger = Get-Debugger $DevToolsPort; $null -ne $script:debugger } 20 500
  Expect ($null -ne $script:debugger) 'asked for a debugger in the same words, that release opens one'
  if ($script:debugger) { Note "it answers as $($script:debugger.Browser)" }
  Start-Sleep -Seconds 4
  Save-Screen 'release-before'
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
  Expect (Test-Path -LiteralPath (Join-Path $Data.Now $World)) "and the world that was in it is in $($Data.Now)"
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
  Expect (Test-Path -LiteralPath (Join-Path $Data.Now $World)) 'the world is still there'

  # ── 10 ──
  Scene "The release before again, and the installer's pages gone through over it"
  # From the beginning: with data under the new name already there, nothing
  # would be renamed.
  Remove-Item -LiteralPath $Data.Now -Recurse -Force
  $older = Start-ReleaseBefore
  $before = Get-Started $Data.Before
  $setup = Start-Program @{ FilePath = $Installer }
  $met = Step-Through -Whose { if ($setup.HasExited) { @() } else { @($setup.Id) } } -Answers @{ $AsksToClose = $Reply.OK } -RunAfter $true -Pictures 'installer-over-the-release-before'
  Expect-Pages $met 'the licence', 'for whom', 'the folder', 'the end'
  Expect ($met.Folder -eq $Folder.Now) "the folder page names $($Folder.Now)" "it names '$($met.Folder)'"
  foreach ($asked in $met.Questions) { Note "it asked: $asked" }
  Expect ($setup.ExitCode -eq 0) 'the installer ends well' "it ended with $($setup.ExitCode)"
  Expect ($older.WaitForExit(5000)) 'the older launcher, which was open, has been closed'
  Expect-Installed -In $Folder.Now -NotIn $Folder.Before
  $up = Wait-Started $Data.Now $before
  Expect $up 'left ticked, the box on the last page starts the launcher'
  if (-not $up) { throw 'the launcher did not start from the last page' }
  Expect ((Get-LauncherFolder) -eq $Folder.Now) 'from the folder the page named' "from '$(Get-LauncherFolder)'"
  Expect (@(Get-Said $Data.Now 'Renamed the home from').Count -eq 1) 'which renames its data folder'
  Expect (-not (Test-Path -LiteralPath $Data.Before)) "$($Data.Before) is gone"
  Expect (Test-Path -LiteralPath (Join-Path $Data.Now $World)) "and the world that was in it is in $($Data.Now)"

  # ── 11 ──
  Scene "The installer's pages gone through while the launcher is open"
  $launcher = Get-Launcher
  if ($null -eq $launcher) { throw 'the launcher that was just started is not running' }
  $setup = Start-Program @{ FilePath = $Installer }
  $met = Step-Through -Whose { if ($setup.HasExited) { @() } else { @($setup.Id) } } -Answers @{ $AsksToClose = $Reply.OK } -RunAfter $false -Pictures 'installer-over-the-open-launcher'
  Expect-Pages $met 'the licence', 'for whom', 'the folder', 'the end'
  Expect ($met.Folder -eq $Folder.Now) 'the folder page names the folder the launcher is in' "it names '$($met.Folder)'"
  Expect ($met.Questions.Count -eq 1) 'it asks one thing' "it asked $($met.Questions.Count): $($met.Questions -join ' | ')"
  foreach ($asked in $met.Questions) {
    Expect ($asked -match $AsksToClose) 'which is whether to close the launcher that is open' "it asked: $asked"
  }
  Expect ($setup.ExitCode -eq 0) 'the installer ends well' "it ended with $($setup.ExitCode)"
  Expect ($launcher.WaitForExit(5000)) 'and the launcher was closed on the one OK'
  Expect-Installed -In $Folder.Now -NotIn $Folder.Before
  Start-Sleep -Seconds 3
  Expect (@(Get-LauncherProcesses).Count -eq 0) 'unticked, the box on the last page starts nothing'

  # ── 12 ──
  Scene "The uninstaller's pages gone through, the data kept"
  $run = Start-Program @{ FilePath = (Join-Path $Folder.Now $UninstallerName) }
  $met = Step-Through -Whose { Get-UninstallersAtWork $run } -Answers @{ $AsksToKeep = $Reply.Yes } -Pictures 'uninstaller-keeping'
  Expect-Pages $met 'the welcome', 'the end'
  Expect ($met.Questions.Count -eq 1) 'it asks one thing' "it asked $($met.Questions.Count): $($met.Questions -join ' | ')"
  foreach ($asked in $met.Questions) {
    Expect ($asked.Contains($Data.Now)) "which names $($Data.Now) as where the data is" "it asked: $asked"
  }
  Expect (Wait-Until { -not (Test-Path -LiteralPath $Folder.Now) -and @(Get-Listed).Count -eq 0 } 60 500) 'the uninstaller finishes'
  Expect-Removed -From $Folder.Now
  Expect (Test-Path -LiteralPath (Join-Path $Data.Now $World)) 'answered yes, it leaves the world where it was'

  # ── 13 ──
  Scene "The uninstaller's pages gone through with the launcher open, the data deleted"
  $code = Invoke-Setup $Installer @('/S')
  Expect ($code -eq 0) 'the installer ends well' "it ended with $code"
  $before = Get-Started $Data.Now
  $launcher = Start-Launcher $Folder.Now
  if (-not (Wait-Started $Data.Now $before)) { throw 'the launcher did not start again' }
  $run = Start-Program @{ FilePath = (Join-Path $Folder.Now $UninstallerName) }
  $met = Step-Through -Whose { Get-UninstallersAtWork $run } -Answers ([ordered]@{ $AsksToClose = $Reply.OK; $AsksToKeep = $Reply.No }) -Pictures 'uninstaller-deleting'
  Expect-Pages $met 'the welcome', 'the end'
  Expect ($met.Questions.Count -eq 2) 'it asks two things' "it asked $($met.Questions.Count): $($met.Questions -join ' | ')"
  if ($met.Questions.Count -eq 2) {
    Expect ($met.Questions[0] -match $AsksToClose) 'first whether to close the launcher that is open' "it asked: $($met.Questions[0])"
    Expect ($met.Questions[1].Contains($Data.Now)) "then about the data, naming $($Data.Now)" "it asked: $($met.Questions[1])"
  }
  Expect ($launcher.WaitForExit(5000)) 'the launcher was closed'
  Expect (Wait-Until { -not (Test-Path -LiteralPath $Folder.Now) -and @(Get-Listed).Count -eq 0 } 60 500) 'the uninstaller finishes'
  Expect-Removed -From $Folder.Now
  Expect (-not (Test-Path -LiteralPath $Data.Now)) 'answered no, it deletes the data folder'
} catch {
  $script:Failures.Add("the run stopped: $($_.Exception.Message)")
  Write-Host "::error::the run stopped: $($_.Exception.Message)"
  Write-Host $_.ScriptStackTrace
} finally {
  # A page nobody answered would sit there for as long as the machine lives.
  foreach ($left in @(Get-Process | Where-Object { $_.ProcessName -match '^(Un_[A-Z]|Au_|Raven-Forge-Launcher-Setup-.*)$' })) {
    Stop-Process -Id $left.Id -Force -ErrorAction SilentlyContinue
  }
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
