const puppeteer = require("puppeteer");
const ejs = require("ejs");
const fs = require("fs");
const path = require("path");
const { Project, User, Task, Logging } = require("./db.js");
const { addLog } = require("./logger.js");
const {
  toHoursAndMinutes,
  getLastSundayOfMonth,
  getWeeklyRanges,
  dateToUnixTimestamp,
  unixTimestampToDate
} = require("./util.js");

const renderUsersLoggings = async ({ month, year, invoice, userId }) => {
  addLog(
    `Preparing user loggings: month=${month || "all"}, year=${year || "all"}, invoice=${invoice || "no"}, userId=${userId || "all"}.`
  );
  if (month && year && invoice) {
    var startDate = dateToUnixTimestamp(getLastSundayOfMonth(month - 1, year));
    var endDate = dateToUnixTimestamp(getLastSundayOfMonth(month, year));
  } else {
    var startDate = dateToUnixTimestamp(new Date(year, month - 1, 1));
    var endDate = dateToUnixTimestamp(new Date(year, month, 0));
  }
  const users = userId
    ? await User.find({ rbUserId: userId })
    : await User.find();
  addLog(`Found ${users.length} users to process for rendered loggings.`);
  var loggingsData = [];
  for (const user of users) {
    addLog(`Processing loggings for ${user.name}.`);
    var userData = {
      rbUserId: user.rbUserId,
      name: user.name,
      email: user.email
    };
    var usertotalLoggedHours = null;
    var userLoggingsData = [];
    const userLoggings = await Logging.find({ rbUserId: user.rbUserId })
      .sort({ createdAt: "desc" })
      .exec();
    for (const userLogging of userLoggings) {
      var loggingDate = new Date(userLogging.timeTrackingOn);
      var loggingTimestamp = dateToUnixTimestamp(loggingDate);
      if (
        month &&
        year &&
        (loggingTimestamp < startDate || loggingTimestamp > endDate)
      ) {
        continue;
      }
      const task = await Task.findOne({
        rbTaskId: userLogging.rbTaskId
      }).exec();
      const project = await Project.findOne({
        rbProjectId: task.rbProjectId
      }).exec();
      var loggingData = {
        rbCommentId: userLogging.rbCommentId,
        rbProjectId: task.rbProjectId,
        rbProjectName: project.name,
        rbTaskId: userLogging.rbTaskId,
        rbTaskName: task.name,
        loggingTime: toHoursAndMinutes(userLogging.minutes).totalTime,
        loggingDate: loggingDate.toLocaleDateString("en-US"),
        loggingTimestamp,
        createdAtDate: unixTimestampToDate(
          userLogging.createdAt
        ).toLocaleDateString("en-US")
      };
      usertotalLoggedHours += userLogging.minutes;
      userLoggingsData.push(loggingData);
    }
    userData.totalLoggedHours =
      toHoursAndMinutes(usertotalLoggedHours).totalTime;
    userData.loggings = userLoggingsData;
    if (userData.loggings.length) {
      loggingsData.push(userData);
    }
    addLog(`Processed ${userData.loggings.length} loggings for ${user.name}.`);
  }
  addLog(`Prepared rendered loggings for ${loggingsData.length} users.`);
  return loggingsData;
};

const generateInvoiceData = async (
  month,
  year,
  userId,
  hourlyRate,
  invoiceNo,
  customItem = null,
  customValue = null,
  overrideProject = null,
  overrideProjectRate = null,
  invoiceProject = null
) => {
  addLog(
    `Preparing invoice data: invoiceNo=${invoiceNo || "not provided"}, userId=${userId || "all"}, hourlyRate=${hourlyRate || "not provided"}.`
  );
  const startDate = getLastSundayOfMonth(month - 1, year, 1);
  const endDate = getLastSundayOfMonth(month, year);
  const invoiceDueDate = getLastSundayOfMonth(month, year);
  invoiceDueDate.setDate(invoiceDueDate.getDate() + 30);
  const weeklyRanges = getWeeklyRanges(startDate, endDate);
  const projects = await Project.find().lean();
  const invoiceProjectIds = invoiceProject
    ? Array.isArray(invoiceProject)
      ? invoiceProject.map((projectId) => projectId.toString())
      : [invoiceProject.toString()]
    : [];
  const invoiceProjects = invoiceProjectIds.length
    ? projects.filter((project) => {
        return (
          invoiceProjectIds.includes(project.rbProjectId.toString()) ||
          invoiceProjectIds.includes(project._id.toString())
        );
      })
    : projects;
  const user = await User.findOne({ rbUserId: userId }, { password: 0 }).lean();
  const loggings = await Logging.find({ rbUserId: userId })
    .sort({ createdAt: "desc" })
    .exec();
  addLog(
    `Invoice source data loaded: ${invoiceProjects.length} projects, ${loggings.length} loggings, user=${user ? user.name : "not found"}.`
  );
  var totalLoggedHours = 0;
  var monthlyTotals = 0;
  var loggingsData = [];
  if (loggings.length) {
    for (const project of invoiceProjects) {
      var projectLoggingsData = [];
      for (const weeklyRange of weeklyRanges) {
        var weeklyLoggingsData = [];
        var weeklyTotalLoggedHours = 0;
        for (const logging of loggings) {
          var loggingDate = dateToUnixTimestamp(
            new Date(logging.timeTrackingOn)
          );
          if (
            loggingDate > weeklyRange.rangeStart &&
            loggingDate < weeklyRange.rangeEnd
          ) {
            const task = await Task.findOne({
              rbTaskId: logging.rbTaskId
            }).exec();
            if (task.rbProjectId == project.rbProjectId) {
              weeklyLoggingsData.push({
                rbCommentId: logging.rbCommentId,
                rbProjectId: task.rbProjectId,
                rbProjectName: project.name,
                rbTaskId: logging.rbTaskId,
                rbTaskName: task.name,
                loggingTime: toHoursAndMinutes(logging.minutes).totalTime,
                loggingDate:
                  unixTimestampToDate(loggingDate).toLocaleDateString("en-US"),
                loggingTimestamp: loggingDate,
                createdAtDate: unixTimestampToDate(logging.createdAt)
              });
              totalLoggedHours += logging.minutes;
              weeklyTotalLoggedHours += logging.minutes;
            }
          }
        }
        let projectRate = hourlyRate;
        if (weeklyLoggingsData.length) {
          // Logic for overriding project rates
          if (overrideProject && overrideProjectRate) {
            if (
              typeof overrideProject == "object" &&
              typeof overrideProjectRate == "object"
            ) {
              let projectIndex = overrideProject.indexOf(project.rbProjectId);
              if (projectIndex) {
                projectRate = parseFloat(overrideProjectRate[projectIndex]);
                addLog(`Applied override rate ${projectRate} for project ${project.name}.`);
              }
            } else {
              if (project.rbProjectId == overrideProject) {
                projectRate = parseFloat(overrideProjectRate);
                addLog(`Applied override rate ${projectRate} for project ${project.name}.`);
              }
            }
          }

          // Weekly totals
          let weeklyTotals =
            Math.round((weeklyTotalLoggedHours / 60) * projectRate * 100) / 100;

          projectLoggingsData.push({
            ...weeklyRange,
            weeklyTotalLoggedHours: toHoursAndMinutes(weeklyTotalLoggedHours)
              .totalTime,
            projectRate,
            weeklyTotals,
            weeklyLoggingsData
          });

          // Add the weekly totals to monthly totals
          monthlyTotals += weeklyTotals;
        }
      }
      if (projectLoggingsData.length) {
        loggingsData.push({
          ...project,
          projectLoggingsData
        });
      }
    }
  }
  var data = {
    ...user,
    currency: process.env.CURRENCY,
    companyName: process.env.INVOICE_COMPANY_NAME,
    companyAddress: process.env.INVOICE_COMPANY_ADDRESS,
    month,
    year,
    userId,
    hourlyRate,
    invoiceNo,
    invoiceDate: endDate.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric"
    }),
    invoiceDueDate: invoiceDueDate.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric"
    }),
    totalLoggedHours: toHoursAndMinutes(totalLoggedHours).totalTime,
    monthlyTotals,
    loggingsData
  };

  if (customItem && customValue) {
    addLog("Applying custom invoice items.");
    var customItems = [];
    if (typeof customItem == "object" && typeof customValue == "object") {
      for (let i = 0; i < customItem.length; i++) {
        if (customItem[i] && customValue[i]) {
          customItems.push({
            item: customItem[i],
            value: customValue[i]
          });
          data.monthlyTotals += parseFloat(customValue[i]);
        }
      }
    } else {
      customItems.push({
        item: customItem,
        value: customValue
      });
      data.monthlyTotals += parseFloat(customValue);
    }
    data.customItems = customItems;
  }

  data.monthlyTotals = Math.round(data.monthlyTotals * 100) / 100;
  addLog(`Invoice totals calculated: ${data.monthlyTotals}.`);

  const invoiceTemplate = fs.readFileSync(
    "./views/invoiceTemplate.ejs",
    "utf-8"
  );
  data.renderedInvoiceTemplate = ejs.render(invoiceTemplate, { data });
  addLog(`Invoice template rendered for invoice ${invoiceNo}.`);
  return data;
};

const findChromeExecutable = () => {
  const envPaths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_SHIM
  ];

  const installPaths = [
    process.env.PROGRAMFILES &&
      path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] &&
      path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    process.env.PROGRAMFILES &&
      path.join(process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env["PROGRAMFILES(X86)"] &&
      path.join(process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ];

  const executablePath = [...envPaths, ...installPaths].find((chromePath) => {
    return chromePath && fs.existsSync(chromePath);
  });
  addLog(
    executablePath
      ? `Chrome executable found: ${executablePath}.`
      : "No local Chrome executable found. Puppeteer will use its configured browser cache."
  );
  return executablePath;
};

const generatePdfInvoice = async (invoiceData) => {
  addLog(`Starting PDF generation for invoice ${invoiceData.invoiceNo}.`);
  const executablePath = findChromeExecutable();
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: ["--no-sandbox", "--disable-setuid-sandbox"] // Add these arguments to bypass sandboxing
    });
    addLog("Puppeteer browser launched.");
    const page = await browser.newPage();
    addLog("Puppeteer page created.");
    await page.setContent(invoiceData.renderedInvoiceTemplate, {
      waitUntil: "domcontentloaded"
    });
    addLog("Invoice HTML loaded into Puppeteer.");
    // To reflect CSS used for screens instead of print
    await page.emulateMediaType("screen");
    //await page.screenshot({path: "canvas.png"})
    var invoiceFile = `./invoices/${invoiceData.invoiceNo} - ${invoiceData.name} - ${invoiceData.invoiceDate}.pdf`;
    let height = await page.evaluate(() => document.documentElement.offsetHeight);
    await page.pdf({
      path: invoiceFile,
      height: 30 + height + "px"
    });
    addLog(`PDF written to ${invoiceFile}.`);
    return invoiceFile;
  } finally {
    if (browser) {
      await browser.close();
      addLog("Puppeteer browser closed.");
    }
  }
};

module.exports = {
  renderUsersLoggings,
  generateInvoiceData,
  generatePdfInvoice
};
