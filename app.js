require("dotenv").config();
const express = require("express");
const querystring = require("querystring");
const app = express();
const port = 3000;
const { fetchAccessToken } = require("./common/authenticateRedbooth.js");
const {
  syncRedboothProjects,
  syncRedboothProjectsTasks,
  syncRedboothUsers,
  syncRedboothTasksLoggings
} = require("./common/syncRedbooth.js");
const { getLastSundayOfMonth } = require("./common/util.js");
const {
  renderUsersLoggings,
  generateInvoiceData,
  generatePdfInvoice
} = require("./common/renderMethods.js");
const { addLog, getLogs, clearLogs } = require("./common/logger.js");
const { User, Logging, Project } = require("./common/db.js");

const DEFAULT_AUTO_INVOICE_SETTINGS = {
  enabled: process.env.AUTO_INVOICE_ENABLED === "1",
  projectName: process.env.AUTO_INVOICE_PROJECT_NAME || "CX:CE",
  userName: process.env.AUTO_INVOICE_USER_NAME || "Umair Shah",
  hourlyRate: process.env.AUTO_INVOICE_HOURLY_RATE || "15",
  baseInvoiceNo: process.env.AUTO_INVOICE_BASE_INVOICE_NO || "154",
  baseInvoiceMonth: process.env.AUTO_INVOICE_BASE_MONTH || "4",
  baseInvoiceYear: process.env.AUTO_INVOICE_BASE_YEAR || "2026",
  syncTasks: process.env.AUTO_INVOICE_SYNC_TASKS !== "0"
};

const escapeRegex = (value) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const normalizeName = (value) => {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
};

const findProjectByName = async (projectName) => {
  const exactProject = await Project.findOne({
    name: new RegExp(`^${escapeRegex(projectName)}$`, "i")
  }).lean();

  if (exactProject) {
    return exactProject;
  }

  const projects = await Project.find().lean();
  const normalizedProjectName = normalizeName(projectName);
  return projects.find((project) => {
    return normalizeName(project.name) === normalizedProjectName;
  });
};

const getAutoInvoiceSettings = (overrides = {}) => {
  const now = new Date();
  const month = parseInt(overrides.month || now.getMonth() + 1);
  const year = parseInt(overrides.year || now.getFullYear());
  const baseInvoiceNo = parseInt(
    overrides.baseInvoiceNo || DEFAULT_AUTO_INVOICE_SETTINGS.baseInvoiceNo
  );
  const baseInvoiceMonth = parseInt(
    overrides.baseInvoiceMonth || DEFAULT_AUTO_INVOICE_SETTINGS.baseInvoiceMonth
  );
  const baseInvoiceYear = parseInt(
    overrides.baseInvoiceYear || DEFAULT_AUTO_INVOICE_SETTINGS.baseInvoiceYear
  );
  const invoiceOffset = (year - baseInvoiceYear) * 12 + (month - baseInvoiceMonth);

  return {
    enabled: DEFAULT_AUTO_INVOICE_SETTINGS.enabled,
    projectId: overrides.projectId || null,
    projectName:
      overrides.projectName || DEFAULT_AUTO_INVOICE_SETTINGS.projectName,
    userId: overrides.userId || null,
    userName: overrides.userName || DEFAULT_AUTO_INVOICE_SETTINGS.userName,
    hourlyRate:
      overrides.hourlyRate || DEFAULT_AUTO_INVOICE_SETTINGS.hourlyRate,
    baseInvoiceNo,
    baseInvoiceMonth,
    baseInvoiceYear,
    month,
    year,
    invoiceNo: baseInvoiceNo + invoiceOffset,
    syncTasks:
      overrides.syncTasks === undefined
        ? DEFAULT_AUTO_INVOICE_SETTINGS.syncTasks
        : overrides.syncTasks === "1" || overrides.syncTasks === "true"
  };
};

const getInvoicePeriod = ({ month, year }) => {
  const startDate = getLastSundayOfMonth(month - 1, year, 1);
  const endDate = getLastSundayOfMonth(month, year);

  return { startDate, endDate };
};

process.on("unhandledRejection", (reason) => {
  addLog("Unhandled promise rejection: " + (reason?.stack || reason));
});

process.on("uncaughtException", (error) => {
  addLog("Uncaught exception: " + (error?.stack || error));
  process.exit(1);
});

// Set ejs as express view engine
app.set("views", "views");
app.set("view engine", "ejs");
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const startedAt = Date.now();
  addLog(`Request started: ${req.method} ${req.originalUrl}`);

  res.on("finish", () => {
    addLog(
      `Request completed: ${req.method} ${req.originalUrl} - ${res.statusCode} (${Date.now() - startedAt}ms)`
    );
  });

  next();
});

app.get("/", async (req, res) => {
  addLog("Loading dashboard data.");
  const userIdsWithLoggings = await Logging.find().distinct("rbUserId");
  const users = await User.find({
    rbUserId: { $in: userIdsWithLoggings }
  }).lean();
  const projects = await Project.find().lean();
  addLog(`Dashboard data loaded: ${users.length} users, ${projects.length} projects.`);
  res.render("index", {
    users,
    projects,
    autoInvoiceSettings: getAutoInvoiceSettings(),
    autoInvoiceEnabled: DEFAULT_AUTO_INVOICE_SETTINGS.enabled
  });
});

app.get("/authorize", async (req, res) => {
  addLog("Redbooth authorization callback received.");
  const accessToken = await fetchAccessToken(null, req.query.code);
  addLog("Redbooth authorization completed.");
  res.json(accessToken);
});

// Real-time logs endpoint using Server-Sent Events (SSE)
app.get("/sync-logs", (req, res) => {
  addLog("Sync log stream opened.");
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Keep the connection open
  res.flushHeaders();

  // Interval to send logs every 100ms
  const intervalId = setInterval(() => {
    const logs = getLogs();
    if (logs.length > 0) {
      res.write(`${logs.join("\n")}\n`); // Proper SSE format with "data:"
      clearLogs(); // Clear logs after sending
    }
  }, 100);

  // Clean up when the connection is closed by the client
  req.on("close", () => {
    addLog("Sync log stream closed.");
    clearInterval(intervalId); // Stop sending logs
    res.end(); // Close the connection
  });
});

// Main sync-data route to initiate synchronization
app.get("/sync-data", async (req, res) => {
  let { syncDays, projects, tasks, users, loggings, userProjects } = req.query;
  try {
    addLog(
      `Synchronization requested with filters: syncDays=${syncDays || "default"}, projects=${projects || "enabled"}, users=${users || "enabled"}, tasks=${tasks || "enabled"}, loggings=${loggings || "enabled"}.`
    );
    userProjects = Array.isArray(userProjects)
      ? userProjects
      : userProjects
      ? [userProjects]
      : [];
    if (!projects) {
      addLog("Project synchronization started.");
      await syncRedboothProjects();
      addLog("Project synchronization finished.");
    }
    if (!users) {
      addLog("User synchronization started.");
      await syncRedboothUsers(addLog);
      addLog("User synchronization finished.");
    }
    if (!tasks) {
      addLog("Task synchronization started.");
      await syncRedboothProjectsTasks(userProjects);
      addLog("Task synchronization finished.");
    }
    if (!loggings) {
      addLog("Task logging synchronization started.");
      await syncRedboothTasksLoggings(syncDays, userProjects);
      addLog("Task logging synchronization finished.");
    }
    addLog("Synchronization completed!");
    res.send("Synchronization has been completed!");
  } catch (error) {
    addLog("Error during synchronization: " + error.message);
    res.status(500).send("Synchronization failed.");
  }
});

app.get("/render-data", async (req, res) => {
  const { json, month, year, invoice, userId } = req.query;
  addLog(
    `Render data requested: month=${month || "all"}, year=${year || "all"}, invoice=${invoice || "no"}, userId=${userId || "all"}, format=${json ? "json" : "html"}.`
  );
  var loggingsData = await renderUsersLoggings({
    month,
    year,
    invoice,
    userId
  });
  addLog(`Render data completed: ${loggingsData.length} users with loggings.`);
  if (json) {
    res.json(loggingsData);
  } else {
    res.render("renderDataView", { loggingsData, month, year });
  }
});

app.get("/auto-sync-invoice", async (req, res) => {
  if (!DEFAULT_AUTO_INVOICE_SETTINGS.enabled) {
    addLog("Auto sync invoice requested but AUTO_INVOICE_ENABLED is disabled.");
    return res.status(404).send("Auto invoice is disabled.");
  }

  try {
    const settings = getAutoInvoiceSettings(req.query);
    const { startDate, endDate } = getInvoicePeriod(settings);

    addLog(
      `Auto sync invoice requested: project=${settings.projectName}, user=${settings.userName}, month=${settings.month}, year=${settings.year}, invoiceNo=${settings.invoiceNo}.`
    );

    let project = settings.projectId
      ? await Project.findById(settings.projectId).lean()
      : await findProjectByName(settings.projectName);

    if (!project) {
      addLog(
        `Project ${settings.projectName} was not found locally. Syncing projects before retrying.`
      );
      await syncRedboothProjects();
      project = settings.projectId
        ? await Project.findById(settings.projectId).lean()
        : await findProjectByName(settings.projectName);
    }

    if (!project) {
      addLog(`Auto sync invoice failed: project ${settings.projectName} not found.`);
      return res
        .status(404)
        .send(`Project "${settings.projectName}" was not found.`);
    }

    let user = settings.userId
      ? await User.findOne({ rbUserId: settings.userId }).lean()
      : await User.findOne({
          name: new RegExp(`^${escapeRegex(settings.userName)}$`, "i")
        }).lean();

    if (!user) {
      addLog(
        `User ${settings.userName} was not found locally. Syncing users before retrying.`
      );
      await syncRedboothUsers();
      user = settings.userId
        ? await User.findOne({ rbUserId: settings.userId }).lean()
        : await User.findOne({
            name: new RegExp(`^${escapeRegex(settings.userName)}$`, "i")
          }).lean();
    }

    if (!user) {
      addLog(`Auto sync invoice failed: user ${settings.userName} not found.`);
      return res.status(404).send(`User "${settings.userName}" was not found.`);
    }

    if (settings.syncTasks) {
      addLog(`Auto sync invoice syncing tasks for project ${project.name}.`);
      await syncRedboothProjectsTasks([project._id]);
    }

    addLog(
      `Auto sync invoice syncing loggings from ${startDate.toLocaleDateString("en-US")} to ${endDate.toLocaleDateString("en-US")} for project ${project.name}.`
    );
    await syncRedboothTasksLoggings(null, [project._id], {
      startDate,
      endDate
    });

    const invoiceQuery = querystring.stringify({
      userId: user.rbUserId,
      year: settings.year,
      month: settings.month,
      hourlyRate: settings.hourlyRate,
      invoiceNo: settings.invoiceNo,
      generatePdf: "0",
      invoiceProject: project.rbProjectId
    });

    addLog(`Auto sync invoice completed. Opening invoice preview for ${user.name}.`);
    res.redirect(`/generate-invoice?${invoiceQuery}`);
  } catch (error) {
    addLog("Auto sync invoice failed: " + error.message);
    res.status(500).send("Auto sync invoice failed.");
  }
});

app.get("/generate-invoice", async (req, res) => {
  const {
    month,
    year,
    userId,
    hourlyRate,
    invoiceNo,
    generatePdf,
    customItem,
    customValue,
    overrideProject,
    overrideProjectRate,
    invoiceProject
  } = req.query;
  addLog(
    `Invoice generation requested: invoiceNo=${invoiceNo || "not provided"}, userId=${userId || "all"}, month=${month || "all"}, year=${year || "all"}, generatePdf=${generatePdf || "0"}.`
  );
  var data = await generateInvoiceData(
    month,
    year,
    userId,
    hourlyRate,
    invoiceNo,
    customItem,
    customValue,
    overrideProject,
    overrideProjectRate,
    invoiceProject
  );
  addLog(`Invoice data generated for ${data.name} with total ${data.monthlyTotals}.`);
  if (parseInt(generatePdf) == 1) {
    addLog(`PDF invoice generation started for invoice ${data.invoiceNo}.`);
    const invoiceFile = await generatePdfInvoice(data);
    addLog(`PDF invoice generated: ${invoiceFile}.`);
    res.download(invoiceFile);
  } else {
    // Pass all of the queryString params
    var queryParams = req.query;
    // Set generatePdf to 1
    queryParams.generatePdf = 1;
    // Convert the query params back to query string
    const queryString = querystring.stringify(queryParams);
    addLog(`Invoice preview rendered for invoice ${data.invoiceNo}.`);
    res.render("generateInvoice", { data, queryString });
  }
});

app.listen(port, () => {
  addLog(`App listening on port ${port}`);
});

// syncRedboothProjects();
// syncRedboothUsers();
// syncRedboothProjectsTasks;
// syncRedboothTasksLoggings();
