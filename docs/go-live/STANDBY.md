# A standby database: your steps (D27-384)

Written 6 November 2026, decided under D27-396. **Nothing here has been run, and nothing was read on the live
server to write it.** It needs your Oracle account, it changes the live database's settings (one restart of a few
seconds) and it may cost money, so every step is yours to type (D27-350). Each step says where it runs. Stop at the
first red ✗ and send me the output.

## What it is for

A second PostgreSQL, on a second server, that copies every change the live database makes **within a second or two**
(PostgreSQL's own streaming replication). If the live server dies, the standby is switched on as the database and
the PMS comes back with **seconds of work lost**, not up to an hour (restore to any minute, `deploy/README.md`) or a
day (last night's backup), and without the hour of copying data back (`deploy/IF-THE-SERVER-DIES.md`, step 6).

**It is not a backup.** A booking deleted by mistake is deleted on the standby a second later. The nightly backup
and restore to any minute stay exactly as they are; this is beside them.

It holds every guest's details, as live does: the same region as live, reached only with your SSH key, and its
database port open to the live server's private address and nothing else.

## What it costs, as far as Oracle's public pages say

The same facts as `STAGING.md`, "What it costs" (read 6 November 2026; Oracle's price list could not be read from
this PC, so **no figure is given: unknown until you read it**):

- The live server uses all of an Always Free account's Arm allowance (2 OCPU, 12 GB). Oracle's Arm page says paid
  and trial accounts get 4 OCPU and 24 GB of Arm free each month. The two pages disagree; T1 finds out which is yours.
- Live (2 OCPU, 12 GB) + staging (1, 6) + this standby (1, 6) is exactly 4 OCPU and 24 GB.
- Disk: 200 GB of boot and block volumes free in all. Three servers at about 50 GB each plus live's own may pass it;
  what is over is charged at a rate not read here.
- The two free AMD servers (1 GB each) are too small to take over as the server, so they are not used.

**The recommendation:** 1 OCPU, 6 GB, Arm, only if T1 says it is free or you accept the figure it shows.

## Part T · Making it (about 90 minutes, once; T4 at a quiet hour)

**T1 · the Oracle console, in your browser** - what this account is, and what it would cost
The four checks of `STAGING.md`, step S1 (Free Tier or Pay As You Go; the A1 core limit and usage; the boot
volumes' sizes; the Cost Estimator for 1 OCPU, 6 GB, 50 GB). Also Storage → Block volumes → the live server's boot
volume → its **region**: the standby goes in the same one. **Stop here** and send me the answers; anything that
costs money is your decision. Make the budget of `STAGING.md` S2 if you have not.

**T2 · the Oracle console** - the server
Compute → Instances → Create instance: name `fidato-standby`; image **Oracle Linux 9**; shape
**VM.Standard.A1.Flex, 1 OCPU, 6 GB**; the **same network and subnet** as the live server; your SSH key's public
half, as `STAGING.md` S3. When it is running, note two addresses from each server's page (Instance details →
Primary VNIC): the standby's **private IP**, and the live server's **private IP**. They start `10.`; below they are
`<standby private IP>` and `<live private IP>`.

**T3 · the Oracle console** - let the standby, and only the standby, reach the live database
Networking → Virtual cloud networks → the live server's network → Security Lists → the subnet's list → Add Ingress
Rules: source CIDR `<standby private IP>/32`, IP protocol TCP, destination port **5432**, description
`standby replication`. Nothing else: never `0.0.0.0/0`.

**T4 · the live server, over ssh as `opc`, at a quiet hour** - a login for copying, and the private address
Connect (*your PC, PowerShell*):

```powershell
ssh -i "$HOME\Downloads\ssh-key-2026-09-01.key" opc@130.210.49.220
```

Then a backup first, as every change to live (*the live server*):

```bash
sudo -u postgres /usr/local/bin/fidato-backup /var/backups/fidato
```

A login that may only copy, with a password you choose and keep in your password manager (it asks twice and shows
nothing):

```bash
sudo -u postgres psql -c "create role replicator with replication login"
sudo -u postgres psql -c "\password replicator"
```

Who may use it, from where; listening on the private address too; and a ceiling on what live keeps for a standby
that has stopped (5 GB), so a dead standby can never fill live's disk:

```bash
echo "host replication replicator <standby private IP>/32 scram-sha-256" | sudo tee -a "$(sudo -u postgres psql -tAc 'show hba_file')"
sudo -u postgres psql -c "alter system set listen_addresses = 'localhost,<live private IP>'" -c "alter system set max_slot_wal_keep_size = '5GB'"
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="<standby private IP>/32" port port="5432" protocol="tcp" accept'
sudo firewall-cmd --reload
sudo systemctl restart postgresql
systemctl is-active postgresql fidato-api
```

The last line must print `active` twice. The PMS is away for those few seconds. (`launch.sh` on later releases
touches only the loopback lines of that file, so the new line stays.)

**T5 · the standby server, over ssh** - PostgreSQL 16, as live has it, and the first copy
Connect (*your PC, PowerShell*): `ssh -i "$HOME\Downloads\ssh-key-2026-09-01.key" opc@<the standby's public IP>`.
Then (*the standby server*):

```bash
sudo dnf -y module reset postgresql && sudo dnf -y module enable postgresql:16
sudo dnf -y install postgresql-server postgresql-contrib
sudo -u postgres pg_basebackup -h <live private IP> -U replicator -D /var/lib/pgsql/data -R -X stream -C -S fidato_standby -P
sudo systemctl enable --now postgresql
```

`pg_basebackup` asks for the replicator's password, then copies the whole database (minutes, by its size) and ends
at 100%. `-R` makes this server a follower of live; `-S` gives it its own place in live's journal. If it says
*"could not connect"*: T3's rule or T4's firewall line. If *"directory exists but is not empty"*: send me the output.

**T6 · prove it**
*The live server*:

```bash
sudo -u postgres psql -xc "select client_addr, state, replay_lag from pg_stat_replication"
```

Expect `state | streaming` from the standby's private IP. *The standby server*:

```bash
sudo -u postgres psql -tAc "select pg_is_in_recovery(), now() - pg_last_xact_replay_timestamp()"
```

Expect `t` and a few seconds (a quiet hour can show minutes: it is the time since the last change, not a delay).
Then make a booking in the practice hotel and run the second line again: the seconds drop.

## Watching it (weekly, two minutes)

The Connection health screen does not know about the standby yet (adding it is a later task, if you want it). Once a
week, T6's first line on the live server. No row, or not `streaming`: the standby has stopped. Start it (*the standby
server*: `sudo systemctl start postgresql`) and look again. If live has dropped its place (more than 5 GB behind),
the standby says *"requested WAL segment has already been removed"*: do T5 again after
`sudo systemctl stop postgresql && sudo -u postgres rm -rf /var/lib/pgsql/data/*` on the **standby server only**,
and on live `sudo -u postgres psql -c "select pg_drop_replication_slot('fidato_standby')"` first.

## Part F · If the live server dies (about 40 minutes)

**F1 · the Oracle console** - is it really gone? `deploy/IF-THE-SERVER-DIES.md`, step 0. A live server that is only
stopped is started, not replaced. **Never let both run as the database**: once F2 is done, the old live server is
stopped and deleted, never started again.

**F2 · the standby server, over ssh** - it becomes the database

```bash
sudo -u postgres psql -c "select pg_promote()"
sudo -u postgres psql -tAc "select pg_is_in_recovery()"
```

Expect `t` from the first and `f` from the second: it now takes writes.

**F3** - the standby server becomes the server: `deploy/IF-THE-SERVER-DIES.md` steps 2 (the names to the
**standby's** public IP), 3 (the code), 4 (`launch.sh`, which finds PostgreSQL and the database already there and
only brings them up to date), 5 (the settings only you have), 7 (look), 8 and 9. **Skip step 6**: the data is
already here, to the last second or two.

**F4 · later** - this server is now live on 1 OCPU, 6 GB. At a quiet hour, the Oracle console: Stop → Edit → shape
2 OCPU, 12 GB → Start. Then a new standby, Part T again, with the roles swapped.

## What is deliberately not here

- Switching over by itself. A machine that promotes itself on a network blip makes two databases that disagree; F2
  is a person's decision.
- A second region. The standby is in live's region and network; a whole region down is the bucket's job
  (`deploy/IF-THE-SERVER-DIES.md`).
- n8n and the uploaded files: they come back from the bucket as in that page's steps 6 and 8.
