# Opens one Claude Code window per lane, each on the owner's own API key (D27-318).
#
#   your PC, PowerShell:
#   powershell -ExecutionPolicy Bypass -File "D:\fidato pms\docs\briefs\lanes\start-lanes.ps1"
#
# It asks for the API key ONCE (typed hidden), keeps it only in this window's memory,
# and every lane window it opens inherits it. The key is never written to a file,
# never shown, and never passed on a command line. Close the lane windows to stop them.
# Pick lanes with -Lanes A,B (default: all four).

param([string[]]$Lanes = @("A", "B", "D", "E"))

$root = "D:\fidato pms"
$all = @{
  A = @{ model = "opus";   brief = "early-checkout-a.md";        title = "Lane A - leaving early" }
  B = @{ model = "opus";   brief = "money-roundoff-refunds.md";  title = "Lane B - round-off and refunds" }
  D = @{ model = "sonnet"; brief = "watch-it-done.md";           title = "Lane D - Watch it done" }
  E = @{ model = "sonnet"; brief = "film-1.md";                  title = "Lane E - Film 1" }
}

$secure = Read-Host "Your Anthropic API key (typed hidden; it stays in memory only)" -AsSecureString
$env:ANTHROPIC_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if (-not $env:ANTHROPIC_API_KEY) { Write-Host "No key typed - nothing started."; return }

New-Item -ItemType Directory -Force "$root\.local\lanes" | Out-Null
foreach ($l in $Lanes) {
  $x = $all[$l]
  if (-not $x) { Write-Host "No lane $l"; continue }
  $prompt = "read docs/briefs/lanes/$($x.brief) and do it"
  $cmd = "`$host.UI.RawUI.WindowTitle = '$($x.title)'; Set-Location '$root'; " +
         "claude --model $($x.model) --permission-mode bypassPermissions '$prompt'"
  Start-Process powershell -ArgumentList "-NoExit", "-Command", $cmd
  Add-Content "$root\.local\lanes\progress.log" ("{0:dd MMM HH:mm} | lane {1} | started ({2})" -f (Get-Date), $l, $x.model)
  Write-Host "Started $($x.title) on $($x.model)."
  Start-Sleep -Seconds 3
}
Write-Host "Done. Each lane writes its progress to $root\.local\lanes\progress.log"
