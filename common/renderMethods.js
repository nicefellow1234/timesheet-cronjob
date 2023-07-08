const puppeteer = require('puppeteer');
const ejs = require('ejs');
const fs = require('fs');
const { Project, User, Task, Logging } = require('./db.js');
const { toHoursAndMinutes, getLastSundayOfMonth, getWeeklyRanges, dateToUnixTimestamp, unixTimestampToDate } = require('./util.js');

const renderUsersLoggings = async ({month, year, invoice, userId}) => {
    if (month && year && invoice) {
        var startDate = dateToUnixTimestamp(getLastSundayOfMonth(month - 1, year));
        var endDate = dateToUnixTimestamp(getLastSundayOfMonth(month, year));
    } else {
        var startDate = dateToUnixTimestamp(new Date(year, month - 1, 1));
        var endDate = dateToUnixTimestamp(new Date(year, month, 0));
    }
    const users = userId ? await User.find({ rbUserId: userId }) : await User.find();
    var loggingsData = [];
    for (const user of users) {
        var userData = {
            rbUserId: user.rbUserId,
            name: user.name,
            email: user.email
        };
        var usertotalLoggedHours = null;
        var userLoggingsData = [];
        const userLoggings = await Logging.find({ rbUserId: user.rbUserId }).sort({createdAt: 'desc'}).exec();
        for (const userLogging of userLoggings) {
            var loggingDate = new Date(userLogging.timeTrackingOn);
            var loggingTimestamp = dateToUnixTimestamp(loggingDate);
            if (month && year 
                && (loggingTimestamp < startDate || loggingTimestamp > endDate)) {
                continue;
            }
            const task = await Task.findOne({ rbTaskId: userLogging.rbTaskId }).exec();
            const project = await Project.findOne({ rbProjectId: task.rbProjectId }).exec();
            var loggingData = {
                rbCommentId: userLogging.rbCommentId,
                rbProjectId: task.rbProjectId,
                rbProjectName: project.name,
                rbTaskId: userLogging.rbTaskId,
                rbTaskName: task.name,
                loggingTime: toHoursAndMinutes(userLogging.minutes).totalTime,
                loggingDate: loggingDate.toLocaleDateString("en-US"),
                loggingTimestamp,
                createdAtDate: unixTimestampToDate(userLogging.createdAt).toLocaleDateString("en-US")
            };
            usertotalLoggedHours += userLogging.minutes;
            userLoggingsData.push(loggingData);
        }
        userData.totalLoggedHours = toHoursAndMinutes(usertotalLoggedHours).totalTime;
        userData.loggings = userLoggingsData;
        if (userData.loggings.length) {
            loggingsData.push(userData);
        }
    }
    return loggingsData;
}

const generateInvoiceData = async (month, year, userId, hourlyRate, invoiceNo, customItem = null, customValue = null) => {
    const startDate = getLastSundayOfMonth(month - 1, year, 1);
    const endDate = getLastSundayOfMonth(month, year);
    const invoiceDueDate = getLastSundayOfMonth(month, year);
    invoiceDueDate.setDate(invoiceDueDate.getDate() + 30);
    const weeklyRanges = getWeeklyRanges(startDate, endDate);
    const projects = await Project.find().lean();
    const user = await User.findOne({ rbUserId: userId }, { password: 0 }).lean();
    const loggings = await Logging.find({ rbUserId: userId }).sort({ createdAt: 'desc' }).exec();
    var totalLoggedHours = 0;
    var loggingsData = [];
    if (loggings.length) {
        for (const project of projects) {
            var projectLoggingsData = [];
            for (const weeklyRange of weeklyRanges) {
                var weeklyLoggingsData = [];
                var weeklyTotalLoggedHours = 0;
                for (const logging of loggings) {
                    var loggingDate = dateToUnixTimestamp(new Date(logging.timeTrackingOn));
                    if (loggingDate > weeklyRange.rangeStart && loggingDate < weeklyRange.rangeEnd) {
                        const task = await Task.findOne({ rbTaskId: logging.rbTaskId }).exec();
                        if (task.rbProjectId == project.rbProjectId) {
                            weeklyLoggingsData.push({
                                rbCommentId: logging.rbCommentId,
                                rbProjectId: task.rbProjectId,
                                rbProjectName: project.name,
                                rbTaskId: logging.rbTaskId,
                                rbTaskName: task.name,
                                loggingTime: toHoursAndMinutes(logging.minutes).totalTime,
                                loggingDate: unixTimestampToDate(loggingDate).toLocaleDateString("en-US"),
                                loggingTimestamp: loggingDate,
                                createdAtDate: unixTimestampToDate(logging.createdAt)
                            });
                            totalLoggedHours += logging.minutes;
                            weeklyTotalLoggedHours += logging.minutes;
                        }
                    }
                }
                if (weeklyLoggingsData.length) {
                    projectLoggingsData.push({
                        ...weeklyRange,
                        weeklyTotalLoggedHours: toHoursAndMinutes(weeklyTotalLoggedHours).totalTime,
                        weeklyTotals: Math.round(((weeklyTotalLoggedHours / 60) * hourlyRate) * 100) / 100,
                        weeklyLoggingsData
                    });
                }
            }
            if (projectLoggingsData.length) {
                loggingsData.push({
                    ...project,
                    projectLoggingsData
                })
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
        invoiceDate: endDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        invoiceDueDate: invoiceDueDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        totalLoggedHours: toHoursAndMinutes(totalLoggedHours).totalTime,
        monthlyTotals: ((totalLoggedHours / 60) * hourlyRate),
        loggingsData
    }

    if (customItem && customValue) {
        var customItems = [];
        if (typeof customItem == 'object' && typeof customValue == 'object') {
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

    const invoiceTemplate = fs.readFileSync('./views/invoiceTemplate.ejs', 'utf-8');
    data.renderedInvoiceTemplate = ejs.render(invoiceTemplate, {data});
    return data;
}

const generatePdfInvoice = async (invoiceData) => {
    const browser = await puppeteer.launch({headless: "new"});
    const page = await browser.newPage();
    await page.setContent(invoiceData.renderedInvoiceTemplate, { waitUntil: 'domcontentloaded'});
    // To reflect CSS used for screens instead of print
    await page.emulateMediaType('screen');
    //await page.screenshot({path: "canvas.png"})
    var invoiceFile = `./invoices/${invoiceData.invoiceNo} - ${invoiceData.name} - ${invoiceData.invoiceDate}.pdf`;
    let height = await page.evaluate(() => document.documentElement.offsetHeight);
    await page.pdf({
        path: invoiceFile, 
        height: height + 'px'
    });
    await browser.close();
    return invoiceFile;
}

module.exports = {
    renderUsersLoggings,
    generateInvoiceData,
    generatePdfInvoice
}