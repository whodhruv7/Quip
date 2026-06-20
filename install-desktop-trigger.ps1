$ErrorActionPreference = "Stop"

$repoRoot = $PSScriptRoot
$desktop = [Environment]::GetFolderPath("Desktop")
$target = Join-Path $repoRoot "run-quip.cmd"
$shortcutPath = Join-Path $desktop "Quip.lnk"

if (-not (Test-Path $target)) {
  throw "Missing launcher: $target"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = $repoRoot
$shortcut.WindowStyle = 1
$shortcut.Description = "Launch Quip with fresh build"
$shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,167"
$shortcut.Save()

Write-Host "Created desktop shortcut: $shortcutPath"
