require("dotenv").config();
const { initializeDb, closeDb } = require("../common/db.js");
const { addLog } = require("../common/logger.js");

const main = async () => {
  try {
    await initializeDb();
    addLog("Database and tables are ready. Start the app with: npm start");
  } finally {
    await closeDb();
  }
};

main().catch((error) => {
  addLog("Database initialization failed: " + error.message);
  process.exitCode = 1;
});
