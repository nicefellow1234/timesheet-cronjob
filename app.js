require("dotenv").config();
const express = require("express");
const app = express();
const morgan = require("morgan");
const bodyParser = require("body-parser");
const invoiceRoutes = require("./api/routes/invoice");
const renderUsersRoutes = require("./api/routes/Users");
const taskRoutes = require("./api/routes/task");
const { fetchAccessToken } = require("./common/authenticateRedbooth.js");
const {
  syncRedboothProjects,
  syncRedboothProjectsTasks,
  syncRedboothUsers,
  syncRedboothTasksLoggings,
} = require("./common/syncRedbooth.js");
const {
  // renderUsersLoggings,
  generateInvoiceData,
  generatePdfInvoice,
} = require("./common/renderMethods.js");
const User = require("./models/users");
const Logging = require("./models/logging");

// Set ejs as express view engine
app.set("views", "views");
app.set("view engine", "ejs");
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

//PREVENT CORS ERRORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  if (req.method === "OPTIONS") {
    res.header("Access-Control-Allow-Methods", "PUT, POST, PATCH, DELETE, GET");
    return res.status(200).json({});
  }
  next();
});

app.get("/", async (req, res) => {
  const userIdsWithLoggings = await Logging.find().distinct("rbUserId");
  const users = await User.find({
    rbUserId: { $in: userIdsWithLoggings },
  }).lean();
  res.render("index", { users });
});

app.get("/authorize", async (req, res) => {
  const accessToken = await fetchAccessToken(null, req.query.code);
  console.log("Access Token in Express Response: ", accessToken);
  res.json(accessToken);
});

app.get("/sync-data", async (req, res) => {
  const { syncDays, projects, tasks, users, loggings } = req.query;
  if (!projects) await syncRedboothProjects();
  if (!tasks) await syncRedboothProjectsTasks();
  if (!users) await syncRedboothUsers();
  if (!loggings) await syncRedboothTasksLoggings(syncDays);
  res.send("Synchronization has been completed!");
});

// app.get("/render-data", async (req, res) => {
//   const { json, month, year, invoice, userId } = req.query;
//   var loggingsData = await renderUsersLoggings({
//     month,
//     year,
//     invoice,
//     userId,
//   });
//   if (json) {
//     res.json(loggingsData);
//   } else {
//     res.render("renderDataView", { loggingsData, month, year });
//   }
// });

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
  } = req.query;
  let data = await generateInvoiceData(
    month,
    year,
    userId,
    hourlyRate,
    invoiceNo,
    customItem,
    customValue
  );
  if (generatePdf) {
    const invoiceFile = await generatePdfInvoice(data);
    res.download(invoiceFile);
  } else {
    res.render("generateInvoice", { data });
  }
});

//Routes which should handle requests
app.use("/invoice", invoiceRoutes);
app.use("/render-users", renderUsersRoutes);
app.use("/tasks", taskRoutes);

//handle error
app.use((req, res, next) => {
  const error = new Error("Not Found");
  error.status = 404;
  next(error);
});

app.use((error, req, res, next) => {
  res.status(error.status || 500);
  res.json({
    error: {
      message: error.message,
    },
  });
});

app.use((req, res, next) => {
  res.status(200).json({
    message: "It works!",
  });
});

module.exports = app;
