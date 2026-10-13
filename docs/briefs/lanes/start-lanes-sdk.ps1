# Opens one window per lane, run through the Claude Agent SDK on the owner's API key,
# so the work draws on the promotional credit that names "Agent SDK" (D27-318).
# (Plain Claude Code windows - start-lanes.ps1 - need bought credit.)
#
#   your PC, PowerShell - first a 1-cent test:
#   powershell -ExecutionPolicy Bypass -File "D:\fidato pms\docs\briefs\lanes\start-lanes-sdk.ps1" -Test
#   then check the Console's promotional credit went down, and run the lanes:
#   powershell -ExecutionPolicy Bypass -File "D:\fidato pms\docs\briefs\lanes\start-lanes-sdk.ps1"
#
# It asks for the API key ONCE (typed hidden), keeps it only in this window's memory,
# and every lane window inherits it. Never written to a file, never shown, never on a
# command line. Each lane has a spending cap (runner.mjs): A $25, B $35, D $15, E $15.
# Close a lane's window to stop it. Pick lanes with -Lanes A,B.

param([string[]]$Lanes = @("A", "B", "D", "E"), [switch]$Test)

$root = "D:\fidato pms"
$runner = "$root\.local\lanes-runner\runner.mjs"
# "-Lanes D,E" through -File arrives as one string "D,E": split it.
$Lanes = @($Lanes | ForEach-Object { $_ -split "[,\s]+" } | Where-Object { $_ })
if (-not (Test-Path $runner)) { Write-Host "The runner is missing: $runner"; return }

$secure = Read-Host "Your Anthropic API key (typed hidden; it stays in memory only)" -AsSecureString
$env:ANTHROPIC_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if (-not $env:ANTHROPIC_API_KEY) { Write-Host "No key typed - nothing started."; return }

if ($Test) {
  Write-Host "Test: one tiny request through the Agent SDK (at most 5 cents)..."
  node $runner test
  Write-Host "Now open the Anthropic Console -> Billing: did the PROMOTIONAL credit go down (not bought credit)? Tell the master."
  return
}

New-Item -ItemType Directory -Force "$root\.local\lanes" | Out-Null
foreach ($l in $Lanes) {
  $cmd = "`$host.UI.RawUI.WindowTitle = 'Lane $l (Agent SDK)'; Set-Location '$root'; node '$runner' $l"
  Start-Process powershell -ArgumentList "-NoExit", "-Command", $cmd
  Add-Content "$root\.local\lanes\progress.log" ("{0:dd MMM HH:mm} | lane {1} | started through the Agent SDK" -f (Get-Date), $l)
  Write-Host "Started lane $l."
  Start-Sleep -Seconds 3
}
Write-Host "Done. Progress: $root\.local\lanes\progress.log (and .local\lanes\<lane>-sdk.log for detail)"
