const assert = require("node:assert/strict");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const mysql = require("mysql2/promise");
const logger = require("../common/logger.js");

const setup = (t) => {
  const originalEnv = { ...process.env };
  Object.assign(process.env, {
    MYSQL_HOST: "test-mysql",
    MYSQL_PORT: "3307",
    MYSQL_USER: "test-user",
    MYSQL_PASSWORD: "test-password",
    MYSQL_DATABASE: "test_timesheets"
  });
  t.mock.method(logger, "addLog", () => {});
  delete require.cache[require.resolve("../common/db.js")];
  const db = require("../common/db.js");
  const queries = [];
  const connection = {
    ping: t.mock.fn(async () => {}),
    query: t.mock.fn(async (sql) => {
      queries.push(sql);
      if (sql.includes("AS tasksWithoutProject")) {
        return [[{ tasksWithoutProject: 0, loggingsWithoutTask: 0 }]];
      }
      return [[]];
    }),
    execute: t.mock.fn(async () => [[]]),
    release: t.mock.fn(),
    end: t.mock.fn(async () => {})
  };
  const pool = {
    getConnection: t.mock.fn(async () => connection),
    end: t.mock.fn(async () => {})
  };
  t.mock.method(mysql, "createPool", () => pool);
  t.mock.method(mysql, "createConnection", async () => connection);
  t.after(async () => {
    await db.closeDb();
    process.env = originalEnv;
    delete require.cache[require.resolve("../common/db.js")];
  });
  return { db, pool, connection, queries };
};

test("missing database gives a recovery command without creating it automatically", async (t) => {
  const { db, pool, queries } = setup(t);
  const cause = Object.assign(new Error("Unknown database"), { code: "ER_BAD_DB_ERROR" });
  pool.getConnection.mock.mockImplementation(async () => { throw cause; });

  await assert.rejects(db.connectDb(), (error) => {
    assert.equal(error.code, "ER_BAD_DB_ERROR");
    assert.equal(error.cause, cause);
    assert.match(error.message, /test_timesheets/);
    assert.match(error.message, /npm run db:init/);
    assert.match(error.message, /npm run db:restore -- --latest/);
    assert.match(error.message, /npm start/);
    assert.match(error.message, /empty database/);
    return true;
  });
  assert.equal(mysql.createConnection.mock.callCount(), 0);
  assert.equal(queries.length, 0);
  assert.equal(pool.end.mock.callCount(), 1);
});

test("connection refusal gives server guidance for both startup and initialization", async (t) => {
  const { db, pool } = setup(t);
  const refused = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  pool.getConnection.mock.mockImplementation(async () => { throw refused; });
  mysql.createConnection.mock.mockImplementation(async () => { throw refused; });

  for (const connect of [db.connectDb, db.initializeDb]) {
    await assert.rejects(connect(), (error) => {
      assert.match(error.message, /test-mysql:3307/);
      assert.match(error.message, /Start the MySQL server/);
      assert.match(error.message, /WSL/);
      assert.doesNotMatch(error.message, /npm run db:init/);
      return true;
    });
  }
});

test("authentication failures retain the original error", async (t) => {
  const { db, pool } = setup(t);
  const denied = Object.assign(new Error("Access denied"), { code: "ER_ACCESS_DENIED_ERROR" });
  pool.getConnection.mock.mockImplementation(async () => { throw denied; });
  await assert.rejects(db.connectDb(), (error) => error === denied);
  assert.equal(pool.end.mock.callCount(), 1);
});

test("initialization uses .env options without selecting a database, then prepares tables", async (t) => {
  const { db, connection, queries } = setup(t);
  process.env.MYSQL_DATABASE = "timesheet.archive`test";

  await db.initializeDb();

  assert.deepEqual(mysql.createConnection.mock.calls[0].arguments[0], {
    host: "test-mysql", port: 3307, user: "test-user", password: "test-password"
  });
  assert.equal(queries[0], "CREATE DATABASE IF NOT EXISTS `timesheet.archive``test` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
  assert.equal(mysql.createPool.mock.calls[0].arguments[0].database, process.env.MYSQL_DATABASE);
  for (const table of ["projects", "users", "tasks", "loggings"]) {
    assert.ok(queries.some((sql) => sql.startsWith(`CREATE TABLE IF NOT EXISTS ${table} (`)));
  }
  assert.equal(connection.end.mock.callCount(), 1);
  assert.equal(connection.release.mock.callCount(), 1);
});

test("initialization can be repeated without issuing destructive SQL", async (t) => {
  const { db, queries } = setup(t);
  await db.initializeDb();
  await db.closeDb();
  await db.initializeDb();
  assert.equal(queries.filter((sql) => sql.startsWith("CREATE DATABASE IF NOT EXISTS")).length, 2);
  assert.equal(queries.filter((sql) => sql.startsWith("CREATE TABLE IF NOT EXISTS")).length, 8);
  assert.ok(queries.every((sql) => !/\b(DROP|TRUNCATE|DELETE)\b/.test(sql.replace(/ON DELETE RESTRICT/g, ""))));
});

test("missing MYSQL_DATABASE fails before opening any connections", async (t) => {
  const { db } = setup(t);
  delete process.env.MYSQL_DATABASE;
  await assert.rejects(db.initializeDb(), /Set MYSQL_DATABASE in .env/);
  await assert.rejects(db.connectDb(), /Set MYSQL_DATABASE in .env/);
  assert.equal(mysql.createConnection.mock.callCount(), 0);
  assert.equal(mysql.createPool.mock.callCount(), 0);
});

test("database creation failure closes the setup connection and skips table setup", async (t) => {
  const { db, connection } = setup(t);
  const denied = Object.assign(new Error("CREATE command denied"), { code: "ER_DBACCESS_DENIED_ERROR" });
  connection.query.mock.mockImplementation(async () => { throw denied; });
  await assert.rejects(db.initializeDb(), (error) => error === denied);
  assert.equal(connection.end.mock.callCount(), 1);
  assert.equal(mysql.createPool.mock.callCount(), 0);
});

test("table setup failure releases connections and allows a retry", async (t) => {
  const { db, pool, connection } = setup(t);
  const implementation = connection.query;
  connection.query = t.mock.fn(async (sql) => {
    if (sql.startsWith("CREATE TABLE")) throw new Error("Table setup failed");
    return implementation(sql);
  });
  await assert.rejects(db.initializeDb(), /Table setup failed/);
  assert.equal(connection.end.mock.callCount(), 1);
  assert.equal(connection.release.mock.callCount(), 1);
  assert.equal(pool.end.mock.callCount(), 1);
  connection.query = implementation;
  await db.initializeDb();
  assert.equal(mysql.createPool.mock.callCount(), 2);
  assert.equal(connection.release.mock.callCount(), 2);
});

for (const fail of [false, true]) {
  test(`db:init CLI ${fail ? "reports failure" : "reports success"} and closes its pool`, () => {
    const result = spawnSync(process.execPath, ["-e", `
      require("dotenv").config = () => {};
      const db = require("./common/db.js");
      db.initializeDb = async () => { ${fail ? 'throw new Error("Setup denied");' : ''} };
      db.closeDb = async () => { console.log("POOL_CLOSED"); };
      require("./scripts/init-db.js");
    `], { cwd: require("node:path").resolve(__dirname, ".."), encoding: "utf8" });
    assert.equal(result.status, fail ? 1 : 0, result.stderr);
    assert.match(result.stdout, /POOL_CLOSED/);
    assert.match(result.stdout, fail ? /Database initialization failed: Setup denied/ : /Start the app with: npm start/);
  });
}
