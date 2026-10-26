const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { randomUUID, createHash } = require("node:crypto");
const childProcess = require("node:child_process");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const mysql = require("mysql2/promise");
const { getDatabaseName, getConnectionOptions } = require("./db.js");
const { addLog } = require("./logger.js");

const APP_DIRECTORY = path.resolve(__dirname, "..");
const BACKUP_DIRECTORY = path.join(APP_DIRECTORY, "backups");

// Keep filenames short and portable; the hash separates similarly named databases.
const backupPrefix = () => {
  const database = getDatabaseName();
  const name = database.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  const hash = createHash("sha256").update(database).digest("hex").slice(0, 8);
  return `${name}-${hash}-`;
};

const quoteOption = (value) => `"${String(value)
  .replace(/\\/g, "\\\\")
  .replace(/"/g, '\\"')
  .replace(/\n/g, "\\n")
  .replace(/\r/g, "\\r")
  .replace(/\t/g, "\\t")
  .replace(/\u0008/g, "\\b")}"`;

const withClientConfig = async (action, target) => {
  const options = getConnectionOptions();
  const { user, password } = options;
  const host = target ? "127.0.0.1" : options.host;
  const port = target ? target.port : options.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Set MYSQL_PORT in .env to a valid TCP port (1-65535).");
  }
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "timesheet-mysql-"));
  const configPath = path.join(directory, "client.cnf");
  try {
    // Keep passwords out of command-line arguments and remove the file after use.
    await fsp.writeFile(configPath, [
      "[client]", "protocol=TCP", `host=${quoteOption(host)}`, `port=${port}`,
      `user=${quoteOption(user)}`, `password=${quoteOption(password)}`, ""
    ].join("\n"), { mode: 0o600 });
    return await action(configPath);
  } finally {
    await fsp.rm(configPath, { force: true });
    await fsp.rmdir(directory);
  }
};

const runClient = async (executable, args, input, { captureOutput = false } = {}) => {
  const child = childProcess.spawn(executable, args, {
    shell: false,
    windowsHide: true,
    stdio: [input ? "pipe" : "ignore", captureOutput ? "pipe" : "ignore", "pipe"]
  });
  let stderr = "";
  let stdout = "";
  if (captureOutput) child.stdout.on("data", (chunk) => {
    stdout = (stdout + chunk.toString("utf8")).slice(-1048576);
  });
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-16384);
  });
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(executable)} exited with ${signal || code}: ${stderr.trim()}`));
    });
  });
  const transfer = input ? pipeline(input, child.stdin).catch((error) => {
    child.kill();
    throw error;
  }) : Promise.resolve();
  const [processResult, transferResult] = await Promise.allSettled([completion, transfer]);
  if (processResult.status === "rejected") {
    const error = processResult.reason;
    if (error.code === "ENOENT") {
      throw Object.assign(new Error(`Cannot find MySQL tool ${JSON.stringify(executable)}. Install the MySQL command-line tools and add their bin directory to PATH, or set MYSQL_DUMP_PATH and MYSQL_CLIENT_PATH in .env to their full executable paths (.exe on Windows). For a containerized database, ensure Docker is running so its tools can be used automatically.`), { code: "ENOENT" });
    }
    const password = process.env.MYSQL_PASSWORD;
    if (password) error.message = error.message.split(password).join("[redacted]");
    throw error;
  }
  if (transferResult.status === "rejected") throw transferResult.reason;
  return stdout;
};

const findDockerDatabase = async () => {
  if (process.env.MYSQL_BACKUP_USE_DOCKER === "0") return null;
  const { host, port } = getConnectionOptions();
  const requested = process.env.MYSQL_BACKUP_CONTAINER;
  const localHosts = ["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"];
  if (!requested && !localHosts.includes(host.toLowerCase())) return null;

  // A WSL distro can have a non-functional `docker` shim while Docker Desktop's
  // Windows CLI is available through interop as `docker.exe`.
  const executables = ["docker"];
  if (process.platform === "linux" && process.env.WSL_DISTRO_NAME) executables.push("docker.exe");
  let lastError;
  for (const executable of executables) {
    let output;
    try {
      output = await runClient(executable, ["ps", "--format", "{{json .}}"], null, { captureOutput: true });
    } catch (error) {
      lastError = error;
      continue;
    }
    const containers = output.trim() ? output.trim().split(/\r?\n/).map(JSON.parse) : [];
    const matches = [];
    for (const container of containers) {
      const ports = [...(container.Ports || "").matchAll(/:(\d+)->(\d+)\/tcp/g)];
      const mapping = ports.find((match) => Number(match[1]) === port);
      if (requested ? container.Names === requested || container.ID === requested : Boolean(mapping)) {
        matches.push({ executable, container: container.ID, name: container.Names,
          port: requested && process.env.MYSQL_BACKUP_CONTAINER_PORT
            ? Number(process.env.MYSQL_BACKUP_CONTAINER_PORT) : Number(mapping?.[2] || 3306) });
      }
    }
    if (matches.length > 1) throw new Error("More than one Docker container matches MYSQL_PORT. Set MYSQL_BACKUP_CONTAINER to the database container name in .env.");
    if (matches.length) return matches[0];
    if (requested) throw new Error(`Docker database container ${JSON.stringify(requested)} is not running. Start it before backing up or restoring.`);
    return null;
  }
  if (requested) throw new Error(`Cannot access Docker for MYSQL_BACKUP_CONTAINER. Start Docker Desktop or the Docker service. ${lastError?.message || ""}`);
  return null;
};

const dockerPath = async (target, hostPath) => {
  if (target.executable === "docker.exe" && process.platform === "linux") {
    return (await runClient("wslpath", ["-w", path.resolve(hostPath)], null, { captureOutput: true })).trim();
  }
  return path.resolve(hostPath);
};

const withContainerFiles = async (target, configPath, action) => {
  const directory = `/tmp/timesheet-db-${randomUUID()}`;
  const remoteConfig = `${directory}/client.cnf`;
  const remoteBackup = `${directory}/backup.sql`;
  const docker = (args, input) => runClient(target.executable, args, input);
  await docker(["exec", target.container, "mkdir", "-m", "700", "--", directory]);
  let failure;
  try {
    await docker(["exec", "-i", target.container, "sh", "-c", 'umask 077; cat > "$1"',
      "timesheet-config", remoteConfig], Readable.from([await fsp.readFile(configPath)]));
    return await action({ remoteConfig, remoteBackup, docker });
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      // Delete only these two files in the unique directory created above.
      await docker(["exec", target.container, "rm", "-f", "--", remoteConfig, remoteBackup]);
      await docker(["exec", target.container, "rmdir", "--", directory]);
    } catch (error) {
      if (!failure) throw error;
      addLog(`Could not clean up Docker temporary directory ${directory}: ${error.message}`);
    }
  }
};

const containerClient = (kind) => kind === "dump"
  ? 'umask 077; if command -v mariadb-dump >/dev/null 2>&1; then exec mariadb-dump "$@"; else exec mysqldump "$@"; fi'
  : 'if command -v mariadb >/dev/null 2>&1; then exec mariadb "$@"; else exec mysql "$@"; fi';

const backupDatabase = async ({ directory = BACKUP_DIRECTORY } = {}) => {
  const database = getDatabaseName();
  const target = await findDockerDatabase();
  await fsp.mkdir(directory, { recursive: true });
  const filename = `${backupPrefix()}${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.sql`;
  const filePath = path.join(directory, filename);
  const partialPath = `${filePath}.partial`;
  try {
    const file = await fsp.open(partialPath, "wx", 0o600);
    await file.close();
    await withClientConfig(async (configPath) => {
      const dumpOptions = ["--single-transaction", "--quick",
        "--skip-lock-tables", "--no-tablespaces", "--hex-blob",
        "--loose-set-gtid-purged=OFF", "--loose-column-statistics=0",
        "--default-character-set=utf8mb4"];
      if (target) {
        addLog(`Backing up through Docker container ${target.name} (internal port ${target.port}).`);
        await withContainerFiles(target, configPath, async ({ remoteConfig, remoteBackup, docker }) => {
          await docker(["exec", target.container, "sh", "-c", containerClient("dump"), "timesheet-dump",
            `--defaults-file=${remoteConfig}`, ...dumpOptions, `--result-file=${remoteBackup}`, "--", database]);
          await docker(["cp", `${target.container}:${remoteBackup}`, await dockerPath(target, partialPath)]);
        });
      } else {
        await runClient(process.env.MYSQL_DUMP_PATH || "mysqldump",
          [`--defaults-file=${configPath}`, ...dumpOptions, `--result-file=${partialPath}`, "--", database]);
      }
    }, target);
    await fsp.chmod(partialPath, 0o600);
    if (!(await fsp.stat(partialPath)).size) {
      throw new Error("MySQL produced an empty backup; no backup was saved.");
    }
    await fsp.rename(partialPath, filePath);
    return filePath;
  } catch (error) {
    await fsp.rm(partialPath, { force: true });
    throw error;
  }
};

const listBackups = async ({ directory = BACKUP_DIRECTORY } = {}) => {
  const prefix = backupPrefix();
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".sql"))
    .map(async (entry) => {
      const filePath = path.join(directory, entry.name);
      const stat = await fsp.stat(filePath);
      return { name: entry.name, path: filePath, size: stat.size, modifiedAt: stat.mtime };
    }));
  return files.filter((file) => file.size > 0)
    .sort((a, b) => b.modifiedAt - a.modifiedAt || b.name.localeCompare(a.name));
};

const restoreDatabase = async (selection, { directory = BACKUP_DIRECTORY } = {}) => {
  const database = getDatabaseName();
  if (!selection) {
    throw new Error("Choose a backup: npm run db:restore -- <filename.sql> or npm run db:restore -- --latest. List backups with: npm run db:backups");
  }
  let filePath;
  if (selection === "--latest") {
    const [latest] = await listBackups({ directory });
    if (!latest) throw new Error("No backups found for MYSQL_DATABASE. Create one with: npm run db:backup");
    filePath = latest.path;
  } else {
    filePath = path.isAbsolute(selection) ? selection : path.resolve(
      path.basename(selection) === selection ? directory : APP_DIRECTORY, selection
    );
  }
  if (path.extname(filePath).toLowerCase() !== ".sql") {
    throw new Error("Select a .sql backup file.");
  }
  // Open and check the source before sending any SQL to the server.
  const file = await fsp.open(filePath, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || !stat.size) throw new Error("The backup must be a non-empty SQL file.");
    const target = await findDockerDatabase();
    const databaseId = mysql.escapeId(database, true);
    const input = () => Readable.from((async function* () {
      yield `CREATE DATABASE IF NOT EXISTS ${databaseId} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\nUSE ${databaseId};\n`;
      yield* file.createReadStream({ autoClose: false });
    })());
    const restoreOptions = ["--default-character-set=utf8mb4", "--binary-mode"];
    await withClientConfig(async (configPath) => {
      if (target) {
        addLog(`Restoring through Docker container ${target.name} (internal port ${target.port}).`);
        await withContainerFiles(target, configPath, ({ remoteConfig, docker }) => docker(
          ["exec", "-i", target.container, "sh", "-c", containerClient("restore"), "timesheet-restore",
            `--defaults-file=${remoteConfig}`, ...restoreOptions], input()));
      } else {
        await runClient(process.env.MYSQL_CLIENT_PATH || "mysql",
          [`--defaults-file=${configPath}`, ...restoreOptions], input());
      }
    }, target);
  } finally {
    await file.close();
  }
  return filePath;
};

module.exports = { backupDatabase, listBackups, restoreDatabase, BACKUP_DIRECTORY };
