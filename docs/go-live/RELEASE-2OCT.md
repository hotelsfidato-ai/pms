# The second release: contracts, loyalty and room systems

Written 2 October 2026 (D27-232). **You type every command** (D21-50). Nothing here was run by
Claude. Each step says where it runs. Stop at the first red ✗ and send me the output.
The same steps, with copy buttons and ticks: https://claude.ai/artifact/E2je4qa2vYqEdHUQ4gJcAn

The release: **the branch `release/second-2oct`**. Its code was fully checked at **`7a2946b0`**
(gates `second-2oct-b`: website 928, server 2,233 of 2,233, database 1,419, all 179 migrations re-runnable; `npm run build` passes). Every commit after it is notes only.
Live today: `adc8e846` (the launch release, 2 October). This is a fast-forward from it (checked).
It holds contracts (corporate and booking-site rates, Add and Edit company, the contract price on
New booking, D27-184, D27-185, D27-233), loyalty (points and tiers, D27-179) and room systems
(key cards, off until a lock is connected, D27-178, D27-182). Database changes 177 to 179 run in
A6, in one go.

---

## Part A · The release itself (about 30 minutes, never during a night audit)

**A1 · your PC, PowerShell**
```powershell
cd "D:\fidato pms"; git checkout release/second-2oct; git status --short; git diff --stat 7a2946b0 HEAD
```
Expect no files from the first part (your design chat's files may show), then only `.md` files.

**A2 · your PC, PowerShell, same folder**
```powershell
git push origin release/second-2oct:main
```
Expect a fast-forward from `adc8e846`.

**A3 · your PC, PowerShell**
```powershell
ssh -i "$HOME\Downloads\ssh-key-2026-09-01.key" opc@130.210.49.220
```

**A4 · the server** — a backup first
```bash
sudo -u postgres /usr/local/bin/fidato-backup /var/backups/fidato
```

**A5 · the server**
```bash
sudo GIT_SSH_COMMAND="ssh -i /home/opc/.ssh/fidato_deploy -o IdentitiesOnly=yes" git -C /opt/fidato pull
```
Expect "Fast-forward" from `adc8e846`.

**A6 · the server** — database changes 177 to 179 run here
```bash
cd /opt/fidato && sudo DOMAIN=api.fidatohotels.com APP_ORIGIN=https://pms.fidatohotels.com EMAIL=influvateseo@gmail.com deploy/launch.sh
```
Expect green: `https://api.fidatohotels.com is live.` Red ✗: stop and send me the output.

**A7 · your PC, PowerShell**
```powershell
curl.exe -s https://api.fidatohotels.com/health
```

**A8 · your PC, PowerShell** — build the website (always before A9)
```powershell
cd "D:\fidato pms"; $env:API_URL="https://api.fidatohotels.com"; npm run build:app
```

**A9 · your PC, PowerShell**
```powershell
firebase deploy --only hosting:app
```

**A10 · look at it**: Contracts, Loyalty, a guest on Guest 360 (a Loyalty card), New booking with
a company named, a stay's Key cards panel (no lock connected).

**A11 · your PC, PowerShell**
```powershell
cd "D:\fidato pms"; git checkout cp6
```

---

## Part B · Right after, in the live PMS

1. **Loyalty**: your rules on the Loyalty screen; switch it on per hotel in Settings.
2. **Contracts**: the companies and booking sites, each contract's rates (before GST); the GM
   ticks credit for each booking site that pays later (D27-185).
3. **Room systems**: nothing until a lock is connected.

Last night's Parts B to D (GST, 5EL's test data, AMR and GLM, connections, the ID-photo check)
still stand in `RELEASE-1OCT.md`.
