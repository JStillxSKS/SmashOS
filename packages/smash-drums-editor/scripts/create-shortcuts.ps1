param(
  [string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent)
)

$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "create-app-icon.ps1") -ProjectRoot $ProjectRoot
$iconPath = Join-Path $ProjectRoot "launchers\SmashDrumsEditor.ico"

$iconPath = (Resolve-Path $iconPath).Path
$launchersDir = Join-Path $ProjectRoot "launchers"
$cmdExe = Join-Path $env:SystemRoot "System32\cmd.exe"

$launchers = @(
  @{ Name = "Build Smash Drums Editor"; Bat = "Build Smash Drums Editor.bat" },
  @{ Name = "Dev Smash Drums Editor"; Bat = "Dev Smash Drums Editor.bat" },
  @{ Name = "Open Smash Drums Editor"; Bat = "Open Smash Drums Editor.bat" }
)

$shell = New-Object -ComObject WScript.Shell

foreach ($launcher in $launchers) {
  $batPath = Join-Path $launchersDir $launcher.Bat
  if (-not (Test-Path $batPath)) {
    throw "Missing batch file: $batPath"
  }

  $lnkPath = Join-Path $ProjectRoot ($launcher.Name + ".lnk")
  if (Test-Path $lnkPath) {
    Remove-Item -LiteralPath $lnkPath -Force
  }

  $shortcut = $shell.CreateShortcut($lnkPath)
  $shortcut.TargetPath = $cmdExe
  $shortcut.Arguments = "/c `"$batPath`""
  $shortcut.WorkingDirectory = $ProjectRoot
  $shortcut.WindowStyle = 1
  $shortcut.IconLocation = "$iconPath,0"
  $shortcut.Description = $launcher.Name
  $shortcut.Save()

  Write-Host "Created $lnkPath"
}