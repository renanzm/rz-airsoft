# RZ Airsoft — workshop management

[Português](README.md) · **English**

The RZ Airsoft workshop system: work orders, a bench board, PDF technical reports, customers, a service and price catalog, a promotional banner and a revenue dashboard.

It runs on this computer, with a username and password. The data lives in `dados/cloud/`, a folder synced by OneDrive. You can open it from anywhere in a browser using the internet shortcut.

The interface is available in Portuguese (default) and English: switch it on the login screen, in the user menu or in Settings › Appearance. The choice is saved per browser. It also applies to the PDFs, spreadsheets and WhatsApp messages generated from then on.

## How to open

1. Double-click **`INICIAR_RZ_WEB.bat`**.
2. The first time, create the username and a password (at least 8 characters; a long phrase is better).
3. The browser opens the **Dashboard**. Keep the black server window open while you work (`Ctrl+C` stops it).

If the system is already open, the shortcut just opens the browser on it. The default port is `8765` (if it is busy, it uses `8766` or `8767`).

**Install as an app:** in Chrome or Edge, click the install icon in the address bar. RZ Airsoft gets its own window and taskbar icon.

## Forgot your password

On the workshop computer, double-click **`REDEFINIR_SENHA.bat`** and type the new password twice (only asterisks appear). It works with the system open or closed; all open sessions are logged out and you log in again with the new password. The data is not touched.

From the terminal: `python server\app.py --reset-password` (or `--reset-password username`).

## From anywhere

1. Double-click **`INICIAR_RZ_INTERNET.bat`** (requires `tools\cloudflared.exe`).
2. The `https://….trycloudflare.com` address appears in the window and under **Settings › Remote access**.
3. Open that address on another computer or phone and log in with the same username and password.

This computer must stay on. The link changes each time it is opened and should not be shared. Don't open port 8765 on your router: the tunnel already takes care of it. After using someone else's computer, use **End other sessions** under Settings › Account & security.

Two devices can edit at the same time: the system fetches changes every few seconds and, if the same work order changed on both, merges the fields. With no connection, changes are kept in the browser and upload on their own when the server comes back (the indicator at the top shows "Offline · N pending").

## Screens

| Screen | What it does |
|---|---|
| **Dashboard** | Revenue for the month and the last 12 months, unpaid amounts, open work orders, average FPS gain, orders ready for pickup (with a WhatsApp notice), upcoming deliveries and most common services. |
| **Work orders** | List with search, filters (status, payment, period, with report), sorting, bulk selection and CSV or PDF export. Switches to the bench **board**: drag a work order across *In queue → On the bench → Waiting for parts → Ready → Delivered*. |
| **Work order (detail)** | Equipment, reported problem, services and parts (with catalog search), discount and total, FPS before/after with 0.20/0.28/0.32 BBs and calculated joules, payment, dates, warranty, internal notes and history. |
| **Technical report** | Form with a live preview of the A4 landscape PDF in the dark/gold branding: identification, performance, diagnosis, services performed, up to 6 photos (drag, paste or use the phone camera) and technical opinion. |
| **Customers** | Records with WhatsApp, Instagram, city, notes and equipment; amount paid, last visit and work order history for each customer. |
| **Services & pricing** | Catalog by category, used to add items to work orders and to generate the PDF price list. |
| **Marketing** | Editable 1080 × 1350 (4:5) banner, as PDF or PNG for Instagram and WhatsApp. |
| **Settings** | Workshop details (shown on documents), work order defaults and warranty terms, account and password, theme and language, data and backup, remote access. |

**Documents:** technical report (A4 landscape), work order with items, total, warranty and signatures (A4 portrait), work order list (A4 landscape, paginated), price list (A4 portrait) and banner. Each can be downloaded as PDF or sent to the printer.

**Keyboard shortcuts:** `Ctrl+K` searches anything (screens, actions, work orders, customers) · `N` new work order · `G` then `D/O/C/S` goes to Dashboard, Work orders, Customers, Services · `[` collapses the sidebar · `?` shows them all.

## Where the data lives

- `dados/cloud/db/` — work orders, customers, catalog and settings (JSON).
- `dados/cloud/files/` — report photos (already reduced before upload).
- `dados/cloud/backups/db/` — automatic copies every 10 minutes of use.
- `dados/cloud/.auth.json` — username and password hash. `dados/cloud/.secret` — session key. Don't delete either of them.

**Full backup:** Settings › Data & backup › **Download backup (.zip)**. Restoring a .zip replaces the current data; before that, the system keeps a copy of the current state in `dados/cloud/backups/completo/`.

The workshop's data does not go to GitHub (it is in `.gitignore`).

## Coming from the previous version

On first launch, the system automatically imports what the previous version saved in the `dados/cloud/` folder and in the browser: maintenance records, reports (with photos), customers, work order statuses, catalog and theme. Each browser that had old data imports its own once, without duplicates. The old files are not deleted.

`.json` files downloaded from the previous version (Controle, Histórico, Serviços or a report) can also be imported under Settings › Data & backup.

The old addresses (`controle.html`, `historico.html`, …) redirect to the new screens.

## Changing the logo

Replace `web/assets/logo-original.png` and run (requires Pillow):

```powershell
python -m pip install pillow
python process_logo.py
```

## For anyone working on the code

No build step and no dependencies: the server uses only the Python 3 standard library, and the app is HTML, CSS and JavaScript with native ES modules. `html2canvas` and `jsPDF` live in `web/vendor/` (loaded only when generating a PDF).

```text
relatorio-tecnico-rz-airsoft/
├── INICIAR_RZ_WEB.bat        opens the system on this computer
├── INICIAR_RZ_INTERNET.bat   also opens the public address (cloudflared)
├── REDEFINIR_SENHA.bat       changes the password from the terminal (forgot password)
├── server/
│   ├── app.py                command line: --port, --data-dir, --tunnel, --no-browser, --reset-password, --self-test
│   ├── rz/http.py            routes, static files, gzip, ETag, security headers (CSP)
│   ├── rz/storage.py         JSON collections with revisions, change feed, photos, .zip backup/restore
│   ├── rz/auth.py            PBKDF2-SHA256, signed sessions, attempt lockout
│   ├── rz/tunnel.py          cloudflared
│   └── tests/                server tests
├── web/
│   ├── index.html, login.html, manifest.webmanifest
│   ├── css/                  tokens, base, components, layout, screens, documents (PDF)
│   └── js/
│       ├── core/             router, API, store (optimistic, offline, sync), model, formatting, languages
│       ├── ui/               sidebar, Ctrl+K palette, menus, dialogs, toasts, charts, combobox
│       ├── views/            one screen per file
│       ├── docs/             PDF/print documents
│       └── migrate/          import from the previous version
├── tests/web/                front-end tests (node --test)
└── dados/cloud/              data (synced by OneDrive)
```

**Translations:** the Portuguese text is the key: `tr("Novo cliente")` looks it up in `web/js/core/locales/en.js`. Any new text needs an entry there; `tests/web/i18n.test.mjs` fails if one is missing. Values saved in the data (equipment type, billing unit) stay in Portuguese and are translated on display with `trValue()`.

Tests:

```bash
python server/app.py --self-test
```

```bash
node --test tests/web/
```

To test without touching the real data: `python server/app.py --port 8799 --data-dir dados/dev --no-browser`.

**API (v1, JSON, requires a session):** `GET /api/v1/data` (everything) · `GET /api/v1/changes?since=N` (changes from other devices) · `PUT /api/v1/c/{collection}/{id}` with `{doc, baseRev}` (409 on conflict, with the current version) · `DELETE /api/v1/c/{collection}/{id}?baseRev=N` · `POST/GET/DELETE /api/v1/files` (JPEG/PNG/WebP photos) · `GET /api/v1/backup` · `POST /api/v1/restore` · `GET /api/v1/system`. Collections: `orders`, `clients`, `catalog`, `settings`.

## License

Proprietary software — **all rights reserved**. The code is published for viewing only: copying, using, modifying or redistributing it without written permission is not allowed. Full terms in [`EULA.txt`](EULA.txt) (in Portuguese). The libraries in `web/vendor/` have their own license (MIT).
