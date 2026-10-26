const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const childProcess = require("node:child_process");
const { backupDatabase, listBackups, restoreDatabase, BACKUP_DIRECTORY } = require("../common/dbBackups.js");

const nativeSpawn = childProcess.spawn;
const SQL = "-- UTF-8 backup\nCREATE TABLE example (value TEXT);\nINSERT INTO example VALUES ('test 🐧 漢字');\n";
// Exercise real child-process I/O without needing MySQL or touching the user's DB.
const FAKE_CLIENT = `
  const fs = require("node:fs");
  const [tool, ...args] = process.argv.slice(1);
  const configPath = args[0].slice("--defaults-file=".length);
  const config = fs.readFileSync(configPath, "utf8");
  fs.appendFileSync(process.env.TEST_AUDIT, JSON.stringify({ tool, args, config, configPath }) + "\\n");
  if (tool.includes("mysqldump")) {
    const output = args.find((arg) => arg.startsWith("--result-file=")).slice("--result-file=".length);
    fs.writeFileSync(output, process.env.TEST_SQL, "utf8");
    if (process.env.TEST_FAIL) { console.error("dump permission denied"); process.exitCode = 2; }
  } else {
    if (process.env.TEST_FAIL_EARLY) { console.error("restore permission denied"); process.exit(3); }
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      fs.writeFileSync(process.env.TEST_RESTORED, Buffer.concat(chunks));
      if (process.env.TEST_FAIL) { console.error("restore SQL error"); process.exitCode = 1; }
    });
  }
`;

const FAKE_DOCKER = `
  const fs = require("node:fs");
  const path = require("node:path");
  const args = process.argv.slice(1);
  const root = process.env.TEST_DOCKER_ROOT;
  const local = (remote) => path.join(root, remote.replace(/^.*?:/, "").replace(/^\\/tmp\\//, ""));
  fs.appendFileSync(process.env.TEST_DOCKER_AUDIT, JSON.stringify(args) + "\\n");
  const [command, ...rest] = args;
  if (command === "ps") {
    console.log(JSON.stringify({ID: "test-db-id", Names: "test-db", Ports: "127.0.0.1:3307->3306/tcp"}));
    if (process.env.TEST_DOCKER_AMBIGUOUS) console.log(JSON.stringify({ID: "another-db-id", Names: "another-db", Ports: "127.0.0.1:3307->3306/tcp"}));
  } else if (command === "cp") {
    if (process.env.TEST_DOCKER_COPY_FAIL) { console.error("copy failed"); process.exit(1); }
    fs.copyFileSync(local(rest[0]), rest[1]);
  } else if (command === "exec") {
    const commands = rest[0] === "-i" ? rest.slice(2) : rest.slice(1);
    if (commands[0] === "mkdir") fs.mkdirSync(local(commands.at(-1)));
    else if (commands[0] === "rm") { for (const file of commands.slice(3)) fs.rmSync(local(file), {force: true}); }
    else if (commands[0] === "rmdir") fs.rmdirSync(local(commands.at(-1)));
    else if (commands.includes("timesheet-config")) {
      const chunks = [];
      process.stdin.on("data", (chunk) => chunks.push(chunk));
      process.stdin.on("end", () => fs.writeFileSync(local(commands.at(-1)), Buffer.concat(chunks)));
    } else {
      const configPath = commands.find((arg) => arg.startsWith("--defaults-file=")).slice("--defaults-file=".length);
      const config = fs.readFileSync(local(configPath), "utf8");
      if (!config.includes('host="127.0.0.1"') || !config.includes("port=3306")) { console.error("wrong internal endpoint"); process.exit(2); }
      if (commands.includes("timesheet-dump")) {
        const output = commands.find((arg) => arg.startsWith("--result-file=")).slice("--result-file=".length);
        fs.writeFileSync(local(output), process.env.TEST_SQL);
      } else {
        const chunks = [];
        process.stdin.on("data", (chunk) => chunks.push(chunk));
        process.stdin.on("end", () => fs.writeFileSync(process.env.TEST_RESTORED, Buffer.concat(chunks)));
      }
    }
  } else { console.error("unexpected Docker command"); process.exit(1); }
`;

const setup = async (t) => {
  const originalEnv = { ...process.env };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "timesheet backup tests "));
  const directory = path.join(root, "backups with spaces");
  const auditPath = path.join(root, "audit.jsonl");
  const restoredPath = path.join(root, "restored.sql");
  Object.assign(process.env, {
    MYSQL_HOST: "127.0.0.1", MYSQL_PORT: "3307", MYSQL_USER: "test-user",
    MYSQL_PASSWORD: 'p a#ss"\\word\nnext', MYSQL_DATABASE: "test_timesheets",
    MYSQL_BACKUP_USE_DOCKER: "0",
    MYSQL_DUMP_PATH: path.join(root, "MySQL bin", process.platform === "win32" ? "mysqldump.exe" : "mysqldump"),
    MYSQL_CLIENT_PATH: path.join(root, "MySQL bin", process.platform === "win32" ? "mysql.exe" : "mysql"),
    TEST_AUDIT: auditPath, TEST_RESTORED: restoredPath, TEST_SQL: SQL
  });
  delete process.env.TEST_FAIL;
  delete process.env.TEST_FAIL_EARLY;
  delete process.env.MYSQL_BACKUP_CONTAINER;
  delete process.env.MYSQL_BACKUP_CONTAINER_PORT;
  delete process.env.TEST_DOCKER_COPY_FAIL;
  delete process.env.TEST_DOCKER_AMBIGUOUS;
  const spawn = t.mock.method(childProcess, "spawn", (executable, args, options) => {
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    return nativeSpawn(process.execPath, ["-e", FAKE_CLIENT, "--", executable, ...args], options);
  });
  t.after(async () => {
    process.env = originalEnv;
    // Only remove this test's verified, freshly allocated temporary directory.
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith("timesheet backup tests "));
    await fs.rm(root, { recursive: true, force: true });
  });
  const audit = async () => (await fs.readFile(auditPath, "utf8")).trim().split("\n").map(JSON.parse);
  return { directory, root, audit, auditPath, restoredPath, spawn };
};

const setupDocker = async (t) => {
  const fixture = await setup(t);
  process.env.MYSQL_BACKUP_USE_DOCKER = "1";
  process.env.TEST_DOCKER_ROOT = path.join(fixture.root, "container");
  process.env.TEST_DOCKER_AUDIT = path.join(fixture.root, "docker-audit.jsonl");
  await fs.mkdir(process.env.TEST_DOCKER_ROOT);
  fixture.spawn.mock.mockImplementation((executable, args, options) => {
    assert.equal(executable, "docker");
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    return nativeSpawn(process.execPath, ["-e", FAKE_DOCKER, "--", ...args], options);
  });
  fixture.dockerAudit = async () => (await fs.readFile(process.env.TEST_DOCKER_AUDIT, "utf8")).trim().split("\n").map(JSON.parse);
  return fixture;
};

test("Docker backup detects the published port, dumps inside the container, then copies the SQL", async (t) => {
  const { directory, dockerAudit, restoredPath } = await setupDocker(t);
  const filePath = await backupDatabase({ directory });
  assert.equal(await fs.readFile(filePath, "utf8"), SQL);
  await restoreDatabase(path.basename(filePath), { directory });
  assert.ok((await fs.readFile(restoredPath, "utf8")).endsWith(SQL));
  const calls = await dockerAudit();
  const dump = calls.find((args) => args.includes("timesheet-dump"));
  assert.ok(dump.includes("test-db-id"));
  assert.ok(dump.some((arg) => arg.startsWith("--result-file=/tmp/timesheet-db-")));
  assert.ok(dump.some((arg) => arg.includes("mariadb-dump")));
  const copy = calls.find((args) => args[0] === "cp");
  assert.ok(copy[1].startsWith("test-db-id:/tmp/timesheet-db-"));
  assert.equal(copy[2], `${filePath}.partial`);
  assert.ok(calls.some((args) => args.includes("timesheet-restore")));
  assert.ok(calls.every((args) => args.every((arg) => !arg.includes(process.env.MYSQL_PASSWORD))));
  assert.deepEqual(await fs.readdir(process.env.TEST_DOCKER_ROOT), []);
});

test("a failed Docker copy removes partial backups and temporary container files", async (t) => {
  const { directory } = await setupDocker(t);
  process.env.TEST_DOCKER_COPY_FAIL = "1";
  await assert.rejects(backupDatabase({ directory }), /copy failed/);
  assert.deepEqual(await fs.readdir(directory), []);
  assert.deepEqual(await fs.readdir(process.env.TEST_DOCKER_ROOT), []);
});

test("ambiguous or explicitly missing Docker targets fail instead of backing up another DB", async (t) => {
  const { directory } = await setupDocker(t);
  process.env.TEST_DOCKER_AMBIGUOUS = "1";
  await assert.rejects(backupDatabase({ directory }), /More than one Docker container/);
  delete process.env.TEST_DOCKER_AMBIGUOUS;
  process.env.MYSQL_BACKUP_CONTAINER = "missing-db";
  await assert.rejects(backupDatabase({ directory }), /is not running/);
  process.env.MYSQL_BACKUP_CONTAINER = "test-db";
  assert.ok(await backupDatabase({ directory }));
});

test("remote database hosts bypass automatic local Docker detection", async (t) => {
  const { directory, spawn } = await setup(t);
  process.env.MYSQL_BACKUP_USE_DOCKER = "1";
  process.env.MYSQL_HOST = "remote-db.example.com";
  await backupDatabase({ directory });
  assert.equal(spawn.mock.callCount(), 1);
  assert.equal(spawn.mock.calls[0].arguments[0], process.env.MYSQL_DUMP_PATH);
});

test("unavailable Docker falls back to local clients", async (t) => {
  const { directory, root, spawn } = await setup(t);
  process.env.MYSQL_BACKUP_USE_DOCKER = "1";
  spawn.mock.mockImplementation((executable, args, options) => {
    if (executable === "docker" || executable === "docker.exe") {
      return nativeSpawn(path.join(root, "missing-docker"), args, options);
    }
    return nativeSpawn(process.execPath, ["-e", FAKE_CLIENT, "--", executable, ...args], options);
  });
  assert.equal(await fs.readFile(await backupDatabase({ directory }), "utf8"), SQL);
  assert.ok(spawn.mock.calls.some((call) => call.arguments[0] === "docker"));
  assert.equal(spawn.mock.calls.at(-1).arguments[0], process.env.MYSQL_DUMP_PATH);
});

test("backup and restore preserve SQL bytes and handle executable/file paths with spaces", async (t) => {
  const { directory, audit, restoredPath } = await setup(t);
  const filePath = await backupDatabase({ directory });
  assert.equal(await fs.readFile(filePath, "utf8"), SQL);
  assert.equal(path.dirname(filePath), directory);
  assert.match(path.basename(filePath), /^test_timesheets-.*\.sql$/);
  assert.doesNotMatch(path.basename(filePath), /[:<>"/\\|?*]/);

  assert.equal(await restoreDatabase(path.basename(filePath), { directory }), filePath);
  assert.equal(await fs.readFile(restoredPath, "utf8"), "CREATE DATABASE IF NOT EXISTS `test_timesheets` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\nUSE `test_timesheets`;\n" + SQL);
  const [dump, restore] = await audit();
  assert.equal(dump.tool, process.env.MYSQL_DUMP_PATH);
  assert.equal(restore.tool, process.env.MYSQL_CLIENT_PATH);
  assert.ok(dump.args.includes("--single-transaction"));
  assert.ok(dump.args.includes("--hex-blob"));
  assert.deepEqual(dump.args.slice(-2), ["--", "test_timesheets"]);
  assert.ok(restore.args.includes("--binary-mode"));
  for (const call of [dump, restore]) {
    assert.match(call.config, /protocol=TCP\nhost="127.0.0.1"\nport=3307/);
    assert.ok(call.config.includes('password="p a#ss\\"\\\\word\\nnext"'));
    assert.ok(call.args.every((arg) => !arg.includes(process.env.MYSQL_PASSWORD)));
    await assert.rejects(fs.stat(call.configPath), { code: "ENOENT" });
  }
});

test("latest restores only completed backups belonging to the current database", async (t) => {
  const { directory, restoredPath } = await setup(t);
  const first = await backupDatabase({ directory });
  process.env.TEST_SQL = "-- second backup\n";
  const latest = await backupDatabase({ directory });
  const oldDate = new Date("2020-01-01T00:00:00Z");
  await fs.utimes(first, oldDate, oldDate);
  await fs.writeFile(`${latest}.partial`, "incomplete");
  process.env.MYSQL_DATABASE = "test_timesheets-extra";
  await backupDatabase({ directory });
  process.env.MYSQL_DATABASE = "test_timesheets";

  const files = await listBackups({ directory });
  assert.equal(files.length, 2);
  assert.equal(files[0].path, latest);
  assert.equal(await restoreDatabase("--latest", { directory }), latest);
  assert.ok((await fs.readFile(restoredPath, "utf8")).endsWith("-- second backup\n"));
});

test("failed and empty dumps are removed rather than listed as valid backups", async (t) => {
  const { directory, audit } = await setup(t);
  process.env.TEST_FAIL = "1";
  await assert.rejects(backupDatabase({ directory }), /dump permission denied/);
  delete process.env.TEST_FAIL;
  process.env.TEST_SQL = "";
  await assert.rejects(backupDatabase({ directory }), /empty backup/);
  assert.deepEqual(await fs.readdir(directory), []);
  for (const call of await audit()) {
    await assert.rejects(fs.stat(call.configPath), { code: "ENOENT" });
  }
});

test("missing clients give installation guidance and clean up temporary files", async (t) => {
  const { directory, root, spawn } = await setup(t);
  spawn.mock.mockImplementation((executable, args, options) => nativeSpawn(executable, args, options));
  await assert.rejects(backupDatabase({ directory }), /Install the MySQL command-line tools.*MYSQL_DUMP_PATH/);
  assert.deepEqual(await fs.readdir(directory), []);
  const source = path.join(root, "restore.sql");
  await fs.writeFile(source, SQL);
  await assert.rejects(restoreDatabase(source, { directory }), /Cannot find MySQL tool/);
  for (const call of spawn.mock.calls) {
    const configPath = call.arguments[1][0].slice("--defaults-file=".length);
    await assert.rejects(fs.stat(configPath), { code: "ENOENT" });
  }
});

test("default client names and long Unicode database names work on either platform", async (t) => {
  const { directory, audit } = await setup(t);
  delete process.env.MYSQL_DUMP_PATH;
  delete process.env.MYSQL_CLIENT_PATH;
  process.env.MYSQL_DATABASE = "\u6f22".repeat(64);
  const filePath = await backupDatabase({ directory });
  assert.ok(path.basename(filePath).length < 150);
  assert.doesNotMatch(path.basename(filePath), /[:<>"/\\|?*]/);
  await restoreDatabase("--latest", { directory });
  const calls = await audit();
  assert.deepEqual(calls.map((call) => call.tool), ["mysqldump", "mysql"]);
});

test("restore validates absent, missing, and empty backups before starting a client", async (t) => {
  const { directory, root, spawn } = await setup(t);
  assert.deepEqual(await listBackups({ directory }), []);
  await assert.rejects(restoreDatabase(undefined, { directory }), /Choose a backup/);
  await assert.rejects(restoreDatabase("--latest", { directory }), /No backups found/);
  await assert.rejects(restoreDatabase("missing.sql", { directory }), { code: "ENOENT" });
  await assert.rejects(restoreDatabase("wrong.txt", { directory }), /Select a .sql/);
  const emptyPath = path.join(root, "empty.sql");
  await fs.writeFile(emptyPath, "");
  await assert.rejects(restoreDatabase(emptyPath, { directory }), /non-empty SQL/);
  assert.equal(spawn.mock.callCount(), 0);
});

test("restore handles SQL errors and early client exits without hanging", { timeout: 15000 }, async (t) => {
  const { directory, root, audit } = await setup(t);
  const source = path.join(root, "restore.sql");
  await fs.writeFile(source, SQL);
  process.env.TEST_FAIL = "1";
  await assert.rejects(restoreDatabase(source, { directory }), /restore SQL error/);
  delete process.env.TEST_FAIL;
  process.env.TEST_FAIL_EARLY = "1";
  await fs.writeFile(source, "-- data\n".repeat(200000));
  await assert.rejects(restoreDatabase(source, { directory }), /restore permission denied|SIGTERM|EPIPE/);
  for (const call of await audit()) {
    await assert.rejects(fs.stat(call.configPath), { code: "ENOENT" });
  }
});

test("restore quotes database identifiers and creates the target before importing", async (t) => {
  const { directory, root, restoredPath } = await setup(t);
  process.env.MYSQL_DATABASE = "test.archive`db";
  const source = path.join(root, "restore.sql");
  await fs.writeFile(source, SQL);
  await restoreDatabase(source, { directory });
  assert.match(await fs.readFile(restoredPath, "utf8"), /^CREATE DATABASE IF NOT EXISTS `test\.archive``db`/);
});

test("backup commands find the app directory when launched from another working directory", async (t) => {
  const { root } = await setup(t);
  const script = path.resolve(__dirname, "../scripts/db-backups.js");
  // Stub the operations in a child so command parsing can be checked without actual DB access.
  const scriptSource = `
    const backups = require(${JSON.stringify(path.resolve(__dirname, "../common/dbBackups.js"))});
    backups.backupDatabase = async () => backups.BACKUP_DIRECTORY;
    process.argv = [process.execPath, ${JSON.stringify(script)}, "backup"];
    require(${JSON.stringify(script)});
  `;
  const result = childProcess.spawnSync(process.execPath, ["-e", scriptSource], {
    cwd: root, encoding: "utf8", env: process.env
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`Backup saved: ${BACKUP_DIRECTORY}`));
  assert.equal(BACKUP_DIRECTORY, path.resolve(__dirname, "../backups"));
});

test("invalid CLI arguments fail with usage guidance", async (t) => {
  const { root } = await setup(t);
  const result = childProcess.spawnSync(process.execPath, [path.resolve(__dirname, "../scripts/db-backups.js"), "restore"], {
    cwd: root, encoding: "utf8", env: process.env
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Usage: npm run db:backup/);
});
