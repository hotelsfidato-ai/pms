/* ══════════════════════════════════════════════════════════════════
   THE ONE-CLICK KOT COMPUTER SETUP (the owner's D27-299, 10 October)

   "Make it simple: the team just connects the KOT device." The website
   cannot print by itself, so a KOT computer needs a Chrome window that may
   print without asking (--kiosk-printing), the receipt printer as Windows'
   default, the window starting with Windows, and no sleep. This writes ONE
   Windows file that does all four on the computer it is run on, for one
   hotel, and then opens the KOT section in that window - the name and the
   ticks are all that is left by hand (KOT-STATION-SETUP.md).

   A plain .cmd, so it runs with a double-click and no PowerShell script
   policy: PowerShell is only ever called with -Command. ASCII only (cmd
   prints in the console's code page) and CRLF (cmd needs it). Run with
   /check it changes nothing and says what it would do.
   ══════════════════════════════════════════════════════════════════ */

const SAFE_ORIGIN = /^(https:\/\/[a-z0-9.-]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;
const SAFE_CODE = /^[A-Z0-9]{2,10}$/;

/** The file's name for this hotel: KOT-station-setup-AMR.cmd */
export function kotSetupFileName(code: string): string {
  return `KOT-station-setup-${code.toUpperCase()}.cmd`;
}

/** The whole file, CRLF. Throws on an origin or code it will not write into a command line. */
export function kotSetupScript(origin: string, code: string): string {
  const base = origin.replace(/\/+$/, "");
  const hotel = code.toUpperCase();
  if (!SAFE_ORIGIN.test(base)) throw new Error(`Not an address this file can use: ${origin}`);
  if (!SAFE_CODE.test(hotel)) throw new Error(`Not a hotel code: ${code}`);

  const lines = [
    "@echo off",
    `rem Fidato PMS - KOT station setup for ${hotel}, made by Restaurant setup - KOT section.`,
    "rem It changes this Windows user's default printer, startup and sleep settings,",
    "rem and makes one shortcut. Nothing else. Run it with /check to change nothing.",
    "setlocal",
    `title Fidato - set up this computer for printing (${hotel})`,
    `set "URL=${base}/pos/${hotel}/kitchen"`,
    `set "SETUP=${base}/pos/${hotel}/setup#kot"`,
    `set "KOTPROFILE=C:\\KOT-Chrome"`,
    'set "CHECK="',
    'if /i "%~1"=="/check" set "CHECK=1"',
    "echo.",
    `echo  Fidato PMS - set up this computer for printing KOTs and bills (${hotel})`,
    "echo  ----------------------------------------------------------------",
    "echo.",
    "",
    "rem 1 - Google Chrome",
    'set "CHROME=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"',
    'if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"',
    'if not exist "%CHROME%" set "CHROME=%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe"',
    'if exist "%CHROME%" goto chrome_ok',
    "echo  Google Chrome is not installed on this computer.",
    "echo  Install it from google.com/chrome, then run this file again.",
    "pause",
    "exit /b 1",
    ":chrome_ok",
    "echo  1. Google Chrome is installed.",
    "",
    "rem 2 - the receipt printer becomes the default",
    "echo.",
    "echo  2. The printers on this computer:",
    `powershell -NoProfile -Command "$i=0; Get-CimInstance Win32_Printer | Sort-Object Name | ForEach-Object { $i++; '     {0}. {1}' -f $i, $_.Name }"`,
    'set "TRIES="',
    ":ask",
    "echo.",
    /* At most five answers: with nothing left to read (an empty or closed
       input) set /p returns at once, and an unlimited "ask again" would
       loop for ever - it did, on 10 October, before this line. */
    'set "TRIES=%TRIES%x"',
    'if "%TRIES%"=="xxxxxx" (',
    "  echo      No printer was chosen. Nothing was changed. Run this file again.",
    "  pause",
    "  exit /b 1",
    ")",
    'set "N="',
    'set "PRINTER="',
    'set /p "N=     Type the number of the receipt (KOT) printer, then press Enter: "',
    `for /f "usebackq delims=" %%P in (\`powershell -NoProfile -Command "$p = @(Get-CimInstance Win32_Printer | Sort-Object Name); $n = 0; if ([int]::TryParse('%N%', [ref]$n) -and $n -ge 1 -and $n -le $p.Count) { $p[$n-1].Name }"\`) do set "PRINTER=%%P"`,
    "if not defined PRINTER (",
    "  echo      That is not one of the numbers above. Try again.",
    "  goto ask",
    ")",
    "if defined CHECK goto check_only",
    'reg add "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows" /v LegacyDefaultPrinterMode /t REG_DWORD /d 1 /f >nul',
    'rundll32 printui.dll,PrintUIEntry /y /n "%PRINTER%"',
    'echo     "%PRINTER%" is now the default printer, and Windows will not change it.',
    "",
    "rem 3 - the KOT station shortcut, on the desktop and in Startup",
    `powershell -NoProfile -Command "$w = New-Object -ComObject WScript.Shell; foreach ($d in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Startup'))) { $s = $w.CreateShortcut((Join-Path $d 'KOT station.lnk')); $s.TargetPath = $env:CHROME; $s.Arguments = '--kiosk-printing --user-data-dir=' + $env:KOTPROFILE + ' --app=' + $env:URL; $s.Description = 'Fidato KOT station - prints KOTs and bills'; $s.Save() }"`,
    'echo  3. "KOT station" is on the desktop, and starts with Windows.',
    "",
    "rem 4 - never sleep while plugged in",
    "powercfg /change standby-timeout-ac 0",
    "echo  4. This computer will not go to sleep while it is plugged in.",
    "",
    "rem 5 - the KOT section, in the KOT station window",
    "echo.",
    "echo  5. Opening the KOT station window now. Sign in, then under This computer:",
    "echo     type its name, tick what it prints, and press Save.",
    "echo     If slips come out too wide, set the printer's paper to 80 mm once",
    "echo     (Printers and scanners - the printer - Printing preferences).",
    'start "" "%CHROME%" --kiosk-printing --user-data-dir=%KOTPROFILE% --app=%SETUP%',
    "echo.",
    "echo  Done. You can close this window.",
    "pause",
    "exit /b 0",
    "",
    ":check_only",
    "echo.",
    "echo  CHECK ONLY - nothing was changed. Run without /check, it would:",
    'echo    - make "%PRINTER%" the default printer',
    "echo    - put KOT station on the desktop and in Startup, opening %URL%",
    "echo    - stop this computer sleeping while plugged in",
    "echo    - open %SETUP% in the KOT station window",
    "exit /b 0",
    "",
  ];
  const text = lines.join("\r\n");
  /* cmd reads the file in the console's code page: anything beyond ASCII
     prints as noise, or breaks a line. */
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(text)) throw new Error("The KOT setup file must be plain ASCII.");
  return text;
}

/** Hands the file to the browser as a download. */
export function downloadKotSetup(origin: string, code: string): string {
  const name = kotSetupFileName(code);
  const blob = new Blob([kotSetupScript(origin, code)], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}
