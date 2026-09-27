# Timesheet Cronjob

This Node.js app syncs projects, users, tasks, and time logs from Redbooth into MySQL. Use its web dashboard to run syncs, inspect logged time, and create invoice previews or PDFs. It listens on port `3000` and does not schedule syncs by itself; use the sync URL from an external scheduler if you want recurring runs.

## Requirements

- Node.js and npm
- A MySQL-compatible server and a database for this app
- A Redbooth API application with a client ID and client secret
- Chrome or Edge for PDF generation, unless Puppeteer has already downloaded its browser

## Install and configure

Clone the repository and install dependencies:

```sh
git clone https://github.com/nicefellow1234/timesheet-cronjob.git
cd timesheet-cronjob
npm install
```

Create the database before starting the app:

```sql
CREATE DATABASE timesheet_cronjob
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

Copy `.env.example` to `.env` and set the MySQL connection details. `MYSQL_DATABASE` must already exist. For the `ce_mysqldb_container` used in this workspace, connect to host port `28301`; use the port mapped by your own MySQL server elsewhere (commonly `3306`).

```dotenv
MYSQL_HOST='127.0.0.1'
MYSQL_PORT='28301'
MYSQL_USER='root'
MYSQL_PASSWORD='YOUR_MYSQL_PASSWORD'
MYSQL_DATABASE='timesheet_cronjob'
MYSQL_CONNECTION_LIMIT='10'
```

The MySQL account needs permission to select, insert, update, create and alter tables, create indexes, and add foreign keys. The app creates its tables and applies relationship constraints at startup. Keep credentials and Redbooth secrets in `.env`; `.env` is ignored by Git.

### MySQL tables and relationships

The app creates four InnoDB tables. Each has an auto-increment `id` and a unique Redbooth ID:

| Table | Main data |
| --- | --- |
| `projects` | Redbooth project ID and name |
| `users` | Redbooth user ID, name, username, email, and active status |
| `tasks` | Redbooth task ID, project ID, task name, and last update time |
| `loggings` | Redbooth comment ID, user ID, task ID, minutes, tracked date, and creation time |

Foreign keys enforce the data relationships:

- One project has many tasks; `tasks.rbProjectId` references `projects.rbProjectId`.
- One user has many logging entries; `loggings.rbUserId` references `users.rbUserId`.
- One task has many logging entries; `loggings.rbTaskId` references `tasks.rbTaskId`.
- Each logging entry belongs to one user and one task. Its project is available through that task.

Parent records cannot be deleted while child rows reference them, and updates to referenced Redbooth IDs cascade. Startup adds these constraints to existing tables too. If a log refers to a Redbooth user missing from the users endpoint, the app creates a placeholder user so the log remains linked; a later user sync updates that record. Startup stops with an error if tasks or logs have missing project/task parents.

No MongoDB export is needed. The first sync after Redbooth authorization fills the MySQL tables from Redbooth using the app's default current-year sync window.

### Configure Redbooth authorization

Create an app in the [Redbooth API Console](https://redbooth.com/oauth2/applications/). Set its return URI to:

```text
http://localhost:3000/authorize
```

Add the credentials and callback URI to `.env`:

```dotenv
RB_CLIENT_ID='YOUR_CLIENT_ID'
RB_CLIENT_SECRET='YOUR_CLIENT_SECRET'
RB_REDIRECT_URI='http://localhost:3000/authorize'
```

For a deployed app, set `RB_REDIRECT_URI` and the Redbooth app's return URI to the deployed `/authorize` URL.

## Start the app and authorize Redbooth

Start the web server:

```sh
npm start
```

For development with automatic restarts:

```sh
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). In the Redbooth API Console, authorize the app. Redbooth redirects to `/authorize`; the app exchanges the authorization code and stores its access token in the ignored local file `rb_token.json`. Expired access tokens are refreshed automatically.

After authorization, use **Sync All Redbooth Data** on the dashboard or visit `/sync-data` to populate MySQL. The initial sync may take a while because Redbooth rate limits API requests. The dashboard's **Sync Logs** link opens the live log stream. Major actions are also printed to the app terminal.

## App features and how to use them

### 1. Sync Redbooth data

The dashboard's **Sync All Redbooth Data** action runs:

```text
GET /sync-data
```

By default it syncs projects, users, tasks, and logging entries. The first full sync starts from the current year for task and time-log data. Set a record-type parameter to `0` to skip that sync; omit the parameter to run it:

```text
GET /sync-data?projects=0&users=0
GET /sync-data?projects=0&users=0&tasks=0&loggings=0
```

Use `syncDays` to limit the time-log lookback and the recent tasks considered for logging sync. Task metadata sync still fetches the selected projects' task lists. The dashboard's specific-sync form also lets you choose projects:

```text
GET /sync-data?projects=0&users=0&syncDays=2
GET /sync-data?projects=0&users=0&userProjects=MYSQL_PROJECT_ROW_ID&syncDays=2
```

`userProjects` accepts one or more internal MySQL project row IDs from the dashboard. If omitted, sync runs for all projects. For a daily scheduled sync, a scheduler can request `/sync-data?projects=0&users=0&syncDays=2` while the app is running.

The sync uses Redbooth's activities endpoint to find time logs, then scans task comments to catch entries the activity feed may omit. Redbooth does not filter by `time_tracking_on` server-side, so the app filters tracked dates locally. If the recently updated task scan finds no logs, it falls back to the known tasks in the selected projects. Failed comment requests are retried.

### 2. View logged-time data

Use **Render Loggings Data** on the dashboard or open:

```text
GET /render-data
GET /render-data?json=1
```

The default is an HTML report; `json=1` returns JSON. Optional parameters:

- `userId`: Redbooth user ID to show one user
- `month` and `year`: limit the report to that month
- `invoice=1`: use the invoice period, from the previous month's last Sunday through the selected month's last Sunday

Examples:

```text
GET /render-data?userId=123456
GET /render-data?month=6&year=2026
GET /render-data?month=6&year=2026&invoice=1
```

### 3. Generate an invoice

Use **Generate Monthly Invoice** on the dashboard or call `/generate-invoice`. `userId`, `month`, and `year` identify the invoice period and user. The default response is an HTML preview; set `generatePdf=1` to download a PDF.

```text
GET /generate-invoice?userId=123456&year=2026&month=6&hourlyRate=15&invoiceNo=120
GET /generate-invoice?userId=123456&year=2026&month=6&hourlyRate=15&invoiceNo=120&generatePdf=1
```

Optional invoice parameters:

- `customItem` and `customValue`: add one or more custom invoice lines; repeat each parameter for multiple lines
- `overrideProject` and `overrideProjectRate`: override rates for selected Redbooth project IDs
- `invoiceProject`: restrict invoice entries to one or more project IDs (Redbooth IDs or local MySQL project row IDs)

Example with a custom line:

```text
GET /generate-invoice?userId=123456&year=2026&month=6&hourlyRate=15&invoiceNo=120&customItem=Expenses&customValue=25
```

The PDF preview includes a **Generate PDF Invoice** link. PDF creation uses Puppeteer's managed browser when available; otherwise install Chrome for Puppeteer or set `PUPPETEER_EXECUTABLE_PATH` to a local Chrome/Edge executable.

### 4. Automatically sync and review an invoice

Set `AUTO_INVOICE_ENABLED='1'` to show the **Auto Sync + Review Invoice** dashboard form and enable `/auto-sync-invoice`. Select a project and user, invoice month/year, and hourly rate. The route syncs the selected project's tasks when enabled, fetches its logs for the invoice period, and opens an HTML invoice preview. Review it before using the PDF link.

The default project and user names are `CX:CE` and `Umair Shah`; the default hourly rate is `15`. Project lookup ignores case and tolerates punctuation/spacing differences.

Configure defaults in `.env`:

```dotenv
AUTO_INVOICE_ENABLED='0'
AUTO_INVOICE_PROJECT_NAME='PROJECT_NAME'
AUTO_INVOICE_USER_NAME='USER_NAME'
AUTO_INVOICE_HOURLY_RATE='15'
AUTO_INVOICE_BASE_INVOICE_NO='154'
AUTO_INVOICE_BASE_MONTH='4'
AUTO_INVOICE_BASE_YEAR='2026'
AUTO_INVOICE_SYNC_TASKS='1'
```

The base invoice number and month/year determine invoice numbers for later months. For example, base invoice `154` for April 2026 makes May 2026 invoice `155`. The form values can be changed for an individual run.

### 5. Watch sync progress

Open **Sync Logs** on the dashboard or visit:

```text
GET /sync-logs
```

This streams recent timestamped activity while a sync is running. The same logs appear in the terminal.

## Environment settings

`.env.example` lists the supported settings. Common Redbooth sync controls are:

| Setting | Default | Purpose |
| --- | --- | --- |
| `REDBOOTH_REQUEST_INTERVAL_MS` | `1000` | Minimum delay between API requests |
| `REDBOOTH_MAX_RETRIES` | `8` | Retry attempts for API requests |
| `REDBOOTH_MAX_RETRY_DELAY_SECONDS` | `120` | Maximum retry backoff |
| `REDBOOTH_FAILED_LOGGING_RETRY_ATTEMPTS` | `5` | Final retries for failed comment fetches |
| `REDBOOTH_ACTIVITY_INDEX_SYNC_ENABLED` | `1` | Use activities to find candidate time logs |
| `REDBOOTH_ACTIVITY_PAGE_SIZE` | `1000` | Activities page size |
| `REDBOOTH_COMMENTS_PAGE_SIZE` | `1000` | Comments page size |
| `REDBOOTH_DIRECT_TIME_LOG_SYNC_ENABLED` | `1` | Run the direct activity-based time-log pass |
| `REDBOOTH_TIME_LOG_ACTIVITY_CREATED_LOOKBACK_DAYS` | `0` | Extra created-date lookback for activity sync |
| `REDBOOTH_FALLBACK_TASK_COMMENT_SYNC` | `0` | Fall back to the slower full task scan if activity indexing fails |

Invoice display and company details use `CURRENCY`, `INVOICE_COMPANY_NAME`, and `INVOICE_COMPANY_ADDRESS`. PDF browser location can be set with `PUPPETEER_EXECUTABLE_PATH`.

## Routes at a glance

| Route | Use |
| --- | --- |
| `/` | Dashboard for sync, reports, and invoices |
| `/authorize` | Redbooth OAuth callback |
| `/sync-data` | Sync Redbooth projects, users, tasks, and time logs |
| `/sync-logs` | Live sync activity stream |
| `/render-data` | HTML or JSON logging report |
| `/generate-invoice` | Invoice preview or PDF |
| `/auto-sync-invoice` | Sync one project and review its invoice; requires `AUTO_INVOICE_ENABLED=1` |

## Troubleshooting

- **MySQL connection refused:** Check that the MySQL/MariaDB server is running and that `MYSQL_HOST` and `MYSQL_PORT` match its host port mapping. In this workspace, `ce_mysqldb_container` uses port `28301`.
- **Unknown database:** Create `MYSQL_DATABASE` before starting the app.
- **Foreign-key setup fails:** The startup account needs permission to alter tables and add constraints. Missing task/project references must be corrected by syncing the missing Redbooth parent records before restarting.
- **Redbooth authorization fails:** Check the client ID, client secret, and exact redirect URI. The app must be reachable at the configured callback URL.
- **Redbooth returns `429 Retry later`:** Increase request spacing or retry limits in `.env`. The sync uses backoff and retries failed logging fetches.
- **PDF generation cannot find Chrome:** Install Puppeteer's Chrome with `npx puppeteer browsers install chrome`, or set `PUPPETEER_EXECUTABLE_PATH`.
