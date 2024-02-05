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
  syncRedboothTasksLoggings,
} = require("./common/syncRedbooth.js");
const {
  renderUsersLoggings,
  generateInvoiceData,
  generatePdfInvoice,
} = require("./common/renderMethods.js");
const { User, Logging, Project } = require("./common/db.js");

// Set ejs as express view engine
app.set("views", "views");
app.set("view engine", "ejs");
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", async (req, res) => {
  const userIdsWithLoggings = await Logging.find().distinct("rbUserId");
  const users = await User.find({
    rbUserId: { $in: userIdsWithLoggings },
  }).lean();
  const projects = await Project.find().lean();
  res.render("index", { users, projects });
});

app.get("/authorize", async (req, res) => {
  const accessToken = await fetchAccessToken(null, req.query.code);
  console.log("Access Token in Express Response: ", accessToken);
  res.json(accessToken);
});

app.get("/sync-data", async (req, res) => {
  let { syncDays, projects, tasks, users, loggings, userProjects } = req.query;
  // cast param to array if one project is selected or none
  userProjects = Array.isArray(userProjects) ? userProjects : (userProjects ? [userProjects] : []);
  if (!projects) await syncRedboothProjects();
  if (!tasks) await syncRedboothProjectsTasks(userProjects);
  if (!users) await syncRedboothUsers();
  if (!loggings) await syncRedboothTasksLoggings(syncDays, userProjects);
  res.send("Synchronization has been completed!");
});

app.get("/render-data", async (req, res) => {
  const { json, month, year, invoice, userId } = req.query;
  var loggingsData = await renderUsersLoggings({
    month,
    year,
    invoice,
    userId,
  });
  if (json) {
    res.json(loggingsData);
  } else {
    res.render("renderDataView", { loggingsData, month, year });
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
  } = req.query;
  var data = await generateInvoiceData(
    month,
    year,
    userId,
    hourlyRate,
    invoiceNo,
    customItem,
    customValue,
    overrideProject,
    overrideProjectRate
  );
  if (parseInt(generatePdf) == 1) {
    const invoiceFile = await generatePdfInvoice(data);
    res.download(invoiceFile);
  } else {
    // Pass all of the queryString params
    var queryParams = req.query;
    // Set generatePdf to 1
    queryParams.generatePdf = 1;
    // Convert the query params back to query string
    const queryString = querystring.stringify(queryParams);
    res.render("generateInvoice", { data, queryString });
  }
});

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});

// syncRedboothProjects();
// syncRedboothUsers();
// syncRedboothProjectsTasks;
// syncRedboothTasksLoggings();
