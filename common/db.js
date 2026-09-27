const mysql = require("mysql2/promise");
const { addLog } = require("./logger.js");

let pool;

const tables = {
  projects: {
    key: "rbProjectId",
    fields: ["rbProjectId", "name"]
  },
  users: {
    key: "rbUserId",
    fields: ["rbUserId", "name", "username", "email", "status"]
  },
  tasks: {
    key: "rbTaskId",
    fields: ["rbTaskId", "rbProjectId", "name", "updatedAt"]
  },
  loggings: {
    key: "rbCommentId",
    fields: [
      "rbCommentId",
      "rbUserId",
      "rbTaskId",
      "minutes",
      "timeTrackingOn",
      "createdAt"
    ]
  }
};

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS projects (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    rbProjectId BIGINT NOT NULL,
    name VARCHAR(255) NOT NULL,
    UNIQUE KEY uq_projects_rbProjectId (rbProjectId)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    rbUserId BIGINT NOT NULL,
    name VARCHAR(255) NOT NULL,
    username VARCHAR(255) NULL,
    email VARCHAR(320) NULL,
    status TINYINT(1) NOT NULL DEFAULT 1,
    UNIQUE KEY uq_users_rbUserId (rbUserId)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    rbTaskId BIGINT NOT NULL,
    rbProjectId BIGINT NOT NULL,
    name TEXT NULL,
    updatedAt BIGINT NULL,
    UNIQUE KEY uq_tasks_rbTaskId (rbTaskId),
    KEY idx_tasks_project_updated (rbProjectId, updatedAt)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS loggings (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    rbCommentId BIGINT NOT NULL,
    rbUserId BIGINT NOT NULL,
    rbTaskId BIGINT NOT NULL,
    minutes INT NOT NULL,
    timeTrackingOn VARCHAR(64) NOT NULL,
    createdAt BIGINT NOT NULL,
    UNIQUE KEY uq_loggings_rbCommentId (rbCommentId),
    KEY idx_loggings_user_created (rbUserId, createdAt),
    KEY idx_loggings_task (rbTaskId)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];

const connectDb = async () => {
  if (pool) {
    return;
  }

  if (!process.env.MYSQL_DATABASE) {
    throw new Error("MYSQL_DATABASE must be set before starting the app.");
  }

  addLog("Connecting to MySQL.");
  const nextPool = mysql.createPool({
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number.parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: Number.parseInt(process.env.MYSQL_CONNECTION_LIMIT || "10", 10),
    queueLimit: 0,
    supportBigNumbers: true,
    bigNumberStrings: false,
    decimalNumbers: true
  });

  try {
    const connection = await nextPool.getConnection();
    try {
      await connection.ping();
      for (const statement of schemaStatements) {
        await connection.query(statement);
      }
    } finally {
      connection.release();
    }
    pool = nextPool;
    addLog("MySQL connected and tables are ready.");
  } catch (error) {
    await nextPool.end();
    throw error;
  }
};

const closeDb = async () => {
  if (!pool) {
    return;
  }

  const activePool = pool;
  pool = null;
  await activePool.end();
};

const execute = async (sql, values = []) => {
  if (!pool) {
    throw new Error("MySQL is not connected. Start the app through app.js first.");
  }
  return pool.execute(sql, values);
};

const saveRecord = async ({ table, modelData }) => {
  const tableDefinition = tables[table];
  if (!tableDefinition) {
    throw new Error(`Unsupported database table: ${table}`);
  }

  const fields = Object.keys(modelData).filter((field) =>
    tableDefinition.fields.includes(field)
  );
  if (!fields.length || !fields.includes(tableDefinition.key)) {
    throw new Error(`A ${tableDefinition.key} value is required to save ${table}.`);
  }

  const columns = fields.map((field) => `\`${field}\``).join(", ");
  const placeholders = fields.map(() => "?").join(", ");
  const updateFields = fields.filter((field) => field !== tableDefinition.key);
  const updateClause = updateFields.length
    ? updateFields
        .map((field) => `\`${field}\` = VALUES(\`${field}\`)`)
        .join(", ")
    : `\`${tableDefinition.key}\` = VALUES(\`${tableDefinition.key}\`)`;
  const values = fields.map((field) =>
    modelData[field] === undefined ? null : modelData[field]
  );
  const sql = `INSERT INTO \`${table}\` (${columns}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updateClause}`;
  const [result] = await execute(sql, values);
  const searchData = { [tableDefinition.key]: modelData[tableDefinition.key] };

  if (result.affectedRows === 1) {
    addLog(`${table} created: ${JSON.stringify(searchData)}.`);
  } else if (result.affectedRows > 1) {
    addLog(`${table} updated: ${JSON.stringify(searchData)}.`);
  } else {
    addLog(`${table} unchanged: ${JSON.stringify(searchData)}.`);
  }
};

const getProjects = async (projectIds = []) => {
  if (!projectIds.length) {
    const [rows] = await execute("SELECT * FROM projects ORDER BY name");
    return rows;
  }

  const placeholders = projectIds.map(() => "?").join(", ");
  const [rows] = await execute(
    `SELECT * FROM projects WHERE id IN (${placeholders}) ORDER BY name`,
    projectIds
  );
  return rows;
};

const getProjectById = async (id) => {
  const [rows] = await execute("SELECT * FROM projects WHERE id = ? LIMIT 1", [id]);
  return rows[0] || null;
};

const getProjectByRedboothId = async (rbProjectId) => {
  const [rows] = await execute(
    "SELECT * FROM projects WHERE rbProjectId = ? LIMIT 1",
    [rbProjectId]
  );
  return rows[0] || null;
};

const getProjectByName = async (name) => {
  const [rows] = await execute(
    "SELECT * FROM projects WHERE LOWER(name) = LOWER(?) LIMIT 1",
    [name]
  );
  return rows[0] || null;
};

const getUsers = async ({ rbUserId } = {}) => {
  if (rbUserId === undefined || rbUserId === null || rbUserId === "") {
    const [rows] = await execute("SELECT * FROM users ORDER BY name");
    return rows;
  }

  const [rows] = await execute("SELECT * FROM users WHERE rbUserId = ?", [rbUserId]);
  return rows;
};

const getUsersWithLoggings = async () => {
  const [rows] = await execute(
    `SELECT DISTINCT users.*
     FROM users
     INNER JOIN loggings ON loggings.rbUserId = users.rbUserId
     ORDER BY users.name`
  );
  return rows;
};

const getUserByRedboothId = async (rbUserId) => {
  const [rows] = await execute(
    "SELECT * FROM users WHERE rbUserId = ? LIMIT 1",
    [rbUserId]
  );
  return rows[0] || null;
};

const getUserByName = async (name) => {
  const [rows] = await execute(
    "SELECT * FROM users WHERE LOWER(name) = LOWER(?) LIMIT 1",
    [name]
  );
  return rows[0] || null;
};

const getTaskByRedboothId = async (rbTaskId) => {
  const [rows] = await execute(
    "SELECT * FROM tasks WHERE rbTaskId = ? LIMIT 1",
    [rbTaskId]
  );
  return rows[0] || null;
};

const getTasksForLoggingSync = async ({
  rbProjectIds = [],
  updatedAtTimestamp,
  scanAllProjectTasks = false
}) => {
  const conditions = [];
  const values = [];

  if (rbProjectIds.length) {
    conditions.push(`rbProjectId IN (${rbProjectIds.map(() => "?").join(", ")})`);
    values.push(...rbProjectIds);
  }
  if (!scanAllProjectTasks && updatedAtTimestamp !== undefined) {
    conditions.push("updatedAt > ?");
    values.push(updatedAtTimestamp);
  }

  const whereClause = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await execute(`SELECT * FROM tasks${whereClause}`, values);
  return rows;
};

const getTasksByRedboothIds = async (rbTaskIds = []) => {
  if (!rbTaskIds.length) {
    return [];
  }

  const placeholders = rbTaskIds.map(() => "?").join(", ");
  const [rows] = await execute(
    `SELECT * FROM tasks WHERE rbTaskId IN (${placeholders})`,
    rbTaskIds
  );
  return rows;
};

const getLoggingsByUserId = async (rbUserId) => {
  const [rows] = await execute(
    "SELECT * FROM loggings WHERE rbUserId = ? ORDER BY createdAt DESC",
    [rbUserId]
  );
  return rows;
};

module.exports = {
  connectDb,
  closeDb,
  saveRecord,
  getProjects,
  getProjectById,
  getProjectByRedboothId,
  getProjectByName,
  getUsers,
  getUsersWithLoggings,
  getUserByRedboothId,
  getUserByName,
  getTaskByRedboothId,
  getTasksForLoggingSync,
  getTasksByRedboothIds,
  getLoggingsByUserId
};
