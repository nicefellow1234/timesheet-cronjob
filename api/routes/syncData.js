const express = require("express");
const router = express.Router();
const {
  syncRedboothProjects,
  syncRedboothProjectsTasks,
  syncRedboothUsers,
  syncRedboothTasksLoggings,
} = require("../../common/syncRedbooth");

router.get("/", async (req, res) => {
  const { syncDays, projects, tasks, users, loggings } = req.query;
  if (!projects) await syncRedboothProjects();
  if (!tasks) await syncRedboothProjectsTasks();
  if (!users) await syncRedboothUsers();
  if (!loggings) await syncRedboothTasksLoggings(syncDays);
  res.send("Synchronization has been completed!");
});

module.exports = router;
