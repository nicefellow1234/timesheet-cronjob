# Timesheet Cronjob

This Node.js app syncs projects, users, tasks, and time logs from Redbooth into MySQL. Use its web dashboard to run syncs, inspect logged time, and create invoice previews or PDFs. It listens on port `3000` and does not schedule syncs by itself; use the sync URL from an external scheduler if you want recurring runs.

## Requirements

- Node.js and npm
- A MySQL-compatible server and a database for this app
- A Redbooth API application with a client ID and client secret
- Chrome or Edge for PDF generation, unless Puppeteer has already downloaded its browser
- For backup/restore: access to the running database container through Docker, or compatible local MySQL/MariaDB command-line clients

## Commands at a glance

Run these from the app directory in Windows PowerShell, Command Prompt, or a Linux shell:

| Command | Purpose |
| --- | --- |
| `npm start` | Start the web app on port `3000` |
| `npm run dev` | Start the app with automatic restarts |
| `npm run db:init` | Create the configured database if missing and initialize its tables |
| `npm run db:backup` | Save a timestamped SQL backup in the app's `backups/` folder |
| `npm run db:backups` | List completed backups for the configured database, newest first |
| `npm run db:restore -- "filename.sql"` | Restore a selected SQL backup |
| `npm run db:restore -- --latest` | Restore the newest completed backup for the configured database |
| `npm test` | Run database initialization and backup/restore regression tests |

Use `npm`, rather than `node run`, for these commands. Restore replaces the tables included in the backup; stop the app and other database writers before restoring.

## Install and configure

Clone the repository and install dependencies:

```sh
git clone https://github.com/nicefellow1234/timesheet-cronjob.git
cd timesheet-cronjob
npm install
```

Copy `.env.example` to `.env` and set the MySQL connection details. For the `ce_mysqldb_container` used in this workspace, connect to host port `28301`; use the port mapped by your own MySQL server elsewhere (commonly `3306`).

```dotenv
MYSQL_HOST='127.0.0.1'
MYSQL_PORT='28301'
MYSQL_USER='root'
MYSQL_PASSWORD='YOUR_MYSQL_PASSWORD'
MYSQL_DATABASE='timesheet_cronjob'
MYSQL_CONNECTION_LIMIT='10'
```

With MySQL running, create the configured database and initialize its tables:

```sh
npm run db:init
```

This command reads `.env`, creates `MYSQL_DATABASE` if it is missing, and runs the same table and relationship setup used at startup. It can be rerun without dropping the database or deleting existing records. It exits after setup without starting the web server or syncing Redbooth data. If the database was deleted, this creates an empty replacement; restore a backup to recover previous data, or sync again from Redbooth.

If startup reports a missing database, it prints the initialization and backup-recovery commands and exits with a failure status. It does not create an empty replacement automatically or wait for an interactive prompt. A refused connection instead prints guidance to start MySQL and check the host/port. `db:init` and the web app connect through `MYSQL_HOST`/`MYSQL_PORT`; Docker detection applies specifically to backup/restore. When running initialization or the web app in WSL, those connection settings must be reachable from WSL.

The initialization account needs permission to create the database. If your app account cannot do this, ask a MySQL administrator to create it using the name in `MYSQL_DATABASE`, for example:

```sql
CREATE DATABASE IF NOT EXISTS timesheet_cronjob
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
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

## Back up and restore MySQL

These commands work in Windows PowerShell, Command Prompt, and Linux shells. They read the app's `.env` and always save backups in the `backups` folder inside the app directory. Node handles file I/O directly, so shell redirection is unnecessary.

For a local database, the commands first check running Docker containers for a published port matching `MYSQL_PORT`. For example, this workspace's `127.0.0.1:28301->3306/tcp` mapping selects `ce_mysqldb_container` and uses port `3306` inside it. The backup is generated inside that container, copied into the app's `backups/` folder with `docker cp`, and then removed from the container. Restore also uses the container's tools. No MySQL client installation or host-to-database connection from WSL is needed in this mode. Docker must be running and accessible to the user running Node.

The commands prefer the container's MariaDB clients when available, otherwise its MySQL clients. Credentials still come from `.env`; they are supplied through a temporary configuration file, not command-line arguments. Temporary configuration and dump files are removed after use. In WSL, the commands try Docker Desktop's `docker.exe` if the Linux `docker` command is unavailable, and translate the destination path for copying files back to Windows. This avoids relying on WSL's `127.0.0.1` to reach Windows's published MySQL port.

To select a specific running container, including one without a published host port, set:

```dotenv
MYSQL_BACKUP_CONTAINER='ce_mysqldb_container'
MYSQL_BACKUP_CONTAINER_PORT='3306'
```

If multiple containers match, the command asks you to select one with `MYSQL_BACKUP_CONTAINER`. Automatic selection applies to local MySQL hosts; remote MySQL hosts use local clients unless a container is explicitly selected. To disable container detection, set `MYSQL_BACKUP_USE_DOCKER='0'`.

If no running Docker container matches, install the MySQL command-line tools (`mysqldump` and `mysql`) in the environment where Node runs. Use a client version compatible with your server. On Windows, include the command-line tools in your MySQL installation and add its `bin` directory to `PATH`. On Ubuntu/Debian, install the MySQL client with `sudo apt install mysql-client`. Direct connections from WSL need their own Linux clients and a host/port reachable from WSL.

For MariaDB (including this workspace's `ce_mysqldb_container`), use the matching MariaDB clients. On Ubuntu/Debian install `mariadb-client`, then set `MYSQL_DUMP_PATH='/usr/bin/mariadb-dump'` and `MYSQL_CLIENT_PATH='/usr/bin/mariadb'`. On Windows, use the full paths to `mariadb-dump.exe` and `mariadb.exe` from your MariaDB installation. Keep the dump and restore clients from the same vendor and a compatible version; newer MariaDB dumps include a sandbox command that MySQL clients cannot read. See [MariaDB dump compatibility](https://mariadb.org/mariadb-dump-file-compatibility-change/).

For direct connections, if the tools are not on `PATH`, set their full executable paths in `.env`. Paths containing spaces work without adding shell quotes inside the value:

```dotenv
# Windows example
MYSQL_DUMP_PATH='C:/Program Files/MySQL/MySQL Server 8.4/bin/mysqldump.exe'
MYSQL_CLIENT_PATH='C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe'

# Linux example (use these instead of the Windows paths)
# MYSQL_DUMP_PATH='/usr/bin/mysqldump'
# MYSQL_CLIENT_PATH='/usr/bin/mysql'
```

Create a timestamped SQL backup of the configured database:

```sh
npm run db:backup
```

Each run prints the saved file path. Backups include table definitions and data, using a transaction snapshot for the app's InnoDB tables. Avoid schema changes while a backup runs. Files become available for restore only after the dump succeeds; failed or empty dumps are removed. The account needs `SELECT`, and `SHOW VIEW`/`TRIGGER` if views/triggers exist. Passwords are passed through a temporary client configuration file that is removed afterward, rather than command-line arguments.

List completed backups for the configured database, newest first:

```sh
npm run db:backups
```

Stop the app and other database writers, then restore a filename copied from that list or the latest completed backup:

```sh
npm run db:restore -- "filename-from-the-list.sql"
npm run db:restore -- --latest
```

You can also pass an absolute SQL file path, or a path relative to the app directory, such as `backups/filename.sql`. The restore creates `MYSQL_DATABASE` if it is missing, then loads the SQL into it. It replaces the tables included in the backup, including their current data; extra tables absent from the backup are left in place. Take a fresh backup first if you need to preserve the current data. The restore account needs permission to create the database/tables and execute the statements in the dump. A failed restore may leave some tables restored because MySQL schema changes are not transactional; fix the error and rerun the restore. Restart with `npm start` after a successful restore.

The `backups/` directory is ignored by Git. Backups contain database data, so keep an additional copy outside the app directory if you need protection against disk loss. These are logical database backups, not backups of MySQL accounts, server settings, stored routines, or scheduled database events.

From another working directory, use npm's `--prefix` option with the absolute app path, for example:

```sh
npm --prefix "/path/to/timesheet-cronjob" run db:backup
```

On Windows, use your Windows app path, for example `npm --prefix "F:/intern-projects/timesheet-cronjob" run db:backup`. For direct connections, client paths must belong to the platform running Node; change or omit the optional overrides when moving the app between Windows and Linux. Docker mode uses the clients inside the selected container on either platform.

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

`.env.example` lists the supported settings. Database and backup settings are:

| Setting | Default | Purpose |
| --- | --- | --- |
| `MYSQL_HOST` | `127.0.0.1` | MySQL host for the app and direct client connections |
| `MYSQL_PORT` | `3306` | Host port; also used to find a matching running Docker container |
| `MYSQL_USER` | `root` | MySQL account used by initialization, the app, backup, and restore |
| `MYSQL_PASSWORD` | Empty | Password for that account |
| `MYSQL_DATABASE` | Required | Database to initialize, use, back up, or restore |
| `MYSQL_CONNECTION_LIMIT` | `10` | App connection pool size |
| `MYSQL_BACKUP_USE_DOCKER` | Enabled unless `0` | Automatically detect a database container before using local clients |
| `MYSQL_BACKUP_CONTAINER` | Unset | Explicit running container name or ID; overrides automatic selection |
| `MYSQL_BACKUP_CONTAINER_PORT` | Matching published mapping, otherwise `3306` | Internal MySQL port when a container is explicitly selected |
| `MYSQL_DUMP_PATH` | `mysqldump` on `PATH` | Local dump executable; ignored in Docker mode |
| `MYSQL_CLIENT_PATH` | `mysql` on `PATH` | Local restore executable; ignored in Docker mode |

Common Redbooth sync controls are:

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

## Tests and verification

```sh
npm test
```

The automated tests cover missing-database recovery, initialization failures and cleanup, backup/restore command parsing, Docker discovery and fallback, container copying and cleanup, paths with spaces, Unicode data, incomplete dumps, and restore errors. They use mocked database connections and temporary test processes/files; `npm test` does not read or modify the configured database. The suite has been run on Windows with Node.js 24 and Linux/WSL with Node.js 22.

Live backups were also verified from both Windows and WSL against the local MariaDB container. Separate manual round-trip checks used disposable databases to verify restoration after database deletion, foreign keys, Unicode text, large integers, decimals, and binary data. These live checks are not run by `npm test`.

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

- **Cannot find module `.../run`:** Use `npm start` or `npm run dev`, rather than `node run start` or `node run dev`.
- **MySQL connection refused:** Check that the MySQL/MariaDB server is running and that `MYSQL_HOST` and `MYSQL_PORT` match its host port mapping. In this workspace, `ce_mysqldb_container` uses port `28301`. When running Node.js in WSL, ensure that MySQL is reachable from WSL too. Creating a database does not fix a refused server connection.
- **Unknown database:** Check `MYSQL_DATABASE` in `.env`, then run `npm run db:init` to create an empty database and its tables, or `npm run db:restore -- --latest` to restore a saved backup. List available backups with `npm run db:backups`. Start the app with `npm start` afterward. Startup prints recovery commands and exits; it does not wait for interactive input.
- **Backup/restore cannot find MySQL tools:** If MySQL runs in Docker, ensure Docker is accessible, the database container is running, and its published port matches `MYSQL_PORT`. You can explicitly select it with `MYSQL_BACKUP_CONTAINER`. Otherwise install compatible command-line clients in the same Windows/Linux/WSL environment as Node, and add them to `PATH` or set `MYSQL_DUMP_PATH` and `MYSQL_CLIENT_PATH` in `.env`. Use matching MariaDB clients for MariaDB dumps.
- **Database initialization permission denied:** The account used by `db:init` needs permission to create `MYSQL_DATABASE`. Ask a MySQL administrator to create the database if the app account lacks that permission; startup will initialize the tables.
- **Foreign-key setup fails:** The startup account needs permission to alter tables and add constraints. Missing task/project references must be corrected by syncing the missing Redbooth parent records before restarting.
- **Redbooth authorization fails:** Check the client ID, client secret, and exact redirect URI. The app must be reachable at the configured callback URL.
- **Redbooth returns `429 Retry later`:** Increase request spacing or retry limits in `.env`. The sync uses backoff and retries failed logging fetches.
- **PDF generation cannot find Chrome:** Install Puppeteer's Chrome with `npx puppeteer browsers install chrome`, or set `PUPPETEER_EXECUTABLE_PATH`.
