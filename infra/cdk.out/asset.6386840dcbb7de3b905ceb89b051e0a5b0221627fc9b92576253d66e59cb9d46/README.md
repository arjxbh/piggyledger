# Allowance Tracker

A self-hosted family chore & allowance tracker. Runs entirely on your own
Mac mini, Raspberry Pi, or any spare computer on your home network — no
cloud service, no external database, no accounts to pay for.

- **Adults** create chores, set their dollar value, mark them done, and can
  add or subtract money from a kid's balance with a note.
- **Kids** log in from a tablet with a 4-digit PIN, see their chore list and
  running balance, and can see their own history.
- Every balance change (chore payout or manual adjustment) is recorded as a
  permanent, timestamped ledger entry — that ledger *is* the audit trail,
  filterable by kid, date range, and reason, and nothing can drift out of
  sync with it because the balance is always just the sum of the ledger.

## 1. Requirements

- [Node.js](https://nodejs.org) 18 or newer, on the machine that will act as
  the server (the Mac mini or the Pi). Everyone else just needs a web
  browser — nothing to install on the kids' tablets.

Check if you already have it:

```bash
node -v
```

If that fails, install Node:
- **Mac mini:** `brew install node` (or download the installer from nodejs.org)
- **Raspberry Pi (Raspberry Pi OS):** `sudo apt update && sudo apt install -y nodejs npm`
  (if that gives you a very old version, use [NodeSource](https://github.com/nodesource/distributions) or [nvm](https://github.com/nvm-sh/nvm) instead)

## 2. Install & run

Copy this `allowance-tracker` folder onto the server machine, then:

```bash
cd allowance-tracker
npm install
npm start
```

You should see:

```
Allowance Tracker running at http://localhost:3000
On your local network, use this machine's IP address, e.g. http://192.168.1.X:3000
```

Find that machine's local IP address:
- **Mac:** System Settings → Wi-Fi/Network → Details (or `ipconfig getifaddr en0` in Terminal)
- **Raspberry Pi:** `hostname -I` in the terminal

On each kid's tablet, open a browser and go to `http://<that-ip>:3000`. Bookmark
it or "Add to Home Screen" so it's a one-tap icon.

> The app only listens on your local network — nobody outside your house can
> reach it unless you deliberately expose it (e.g. via port forwarding),
> which this guide does not set up and isn't recommended for something with
> logins like this.

## 3. First login

A default adult profile is created automatically the first time the login
page loads:

- **Name:** Parent
- **Password:** `changeme`

Log in with that, then immediately go to the **People** tab and click
**Reset login** on "Parent" to set a real password. From the same tab, add
each of your kids (name + a 4-digit PIN they'll remember) and any other
adults in the house.

## 4. Everyday use

- **Chores tab:** add a chore with a title and dollar value, optionally
  assigned to a specific kid (or leave it "Anyone" if the chore is up for
  grabs). Check **"Reusable chore"** for things like dishes or tidying the
  playroom that can be paid out over and over, instead of a one-time task
  that disappears after it's marked done — a reusable chore always stays
  available, shows how many times it's been completed and by whom last, and
  its **Undo last** button only reverses the most recent payout rather than
  the whole thing.
  Click **Mark done** when a chore is finished — for an unassigned chore
  you'll be asked which kid did it. This immediately credits their balance.
  For one-time chores, **Undo** reverses the completion (it adds an
  offsetting ledger entry rather than deleting history, so the audit trail
  stays complete).
- **Balances tab:** click any kid's card to add or subtract money by hand,
  with a required reason (allowance top-up, birthday cash, a fine for
  something, a correction, etc.).
- **Audit trail tab:** every ledger entry ever created, filterable by kid,
  date range, and text search on the reason.
- **People tab:** add/remove adults and kids, and reset anyone's
  password/PIN.

Kids only see their own chores, their own balance, and their own history —
they can't see siblings' balances or make any changes.

## 5. Keeping it running (optional)

By default the app stops if you close the terminal window or the machine
restarts. To have it start automatically and stay running:

**Easiest option (works on Mac or Pi) — [pm2](https://pm2.keymetrics.io/):**

```bash
npm install -g pm2
pm2 start server.js --name allowance-tracker
pm2 save
pm2 startup   # follow the printed instructions to enable on-boot startup
```

**Raspberry Pi (systemd) alternative:** create
`/etc/systemd/system/allowance-tracker.service`:

```ini
[Unit]
Description=Allowance Tracker
After=network.target

[Service]
ExecStart=/usr/bin/node /home/pi/allowance-tracker/server.js
WorkingDirectory=/home/pi/allowance-tracker
Restart=always
User=pi

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl enable --now allowance-tracker
```

## 6. Data & backups

Everything lives in one file: `data/db.json`. To back up, just copy that
file somewhere safe (an external drive, a cloud-synced folder, etc.) — no
database export needed. To move the app to a different machine, copy the
whole folder including `data/db.json`.

## 7. Notes & limits

- Designed for casual home use over your own Wi-Fi — not hardened for
  exposure to the open internet.
- Money is stored as integer cents internally to avoid floating-point
  rounding issues; the UI always shows dollars.
- If you ever want to wipe everything and start over, stop the server and
  delete `data/db.json` — it will be recreated with a fresh default "Parent"
  login the next time you start the app.
