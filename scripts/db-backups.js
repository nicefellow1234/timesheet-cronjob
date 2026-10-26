const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const { backupDatabase, listBackups, restoreDatabase, BACKUP_DIRECTORY } = require("../common/dbBackups.js");
const { getDatabaseName } = require("../common/db.js");
const { addLog } = require("../common/logger.js");

const main = async () => {
  const [command, ...args] = process.argv.slice(2);
  if (command === "backup" && !args.length) {
    const filePath = await backupDatabase();
    addLog(`Backup saved: ${filePath}`);
  } else if (command === "list" && !args.length) {
    const files = await listBackups();
    if (!files.length) addLog(`No backups found for ${getDatabaseName()} in ${BACKUP_DIRECTORY}. Run: npm run db:backup`);
    for (const file of files) {
      console.log(`${file.name}\t${file.size} bytes\t${file.modifiedAt.toISOString()}`);
    }
  } else if (command === "restore" && args.length === 1) {
    addLog(`Restoring into ${JSON.stringify(getDatabaseName())}. Tables included in the SQL backup will be replaced. Stop the app and other database writers before restoring.`);
    const filePath = await restoreDatabase(args[0]);
    addLog(`Database restored from: ${filePath}`);
  } else {
    throw new Error("Usage: npm run db:backup | npm run db:backups | npm run db:restore -- <filename.sql> | npm run db:restore -- --latest");
  }
};

main().catch((error) => {
  addLog("Database backup/restore failed: " + error.message);
  process.exitCode = 1;
});
