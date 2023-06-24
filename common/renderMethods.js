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

const generateInvoiceData = async (month, year, userId, hourlyRate, invoiceNo) => {
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
    return {
        ...user,
        companyName: process.env.INVOICE_COMPANY_NAME,
        companyAddress: process.env.INVOICE_COMPANY_ADDRESS,
        invoiceDate: endDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        invoiceDueDate: invoiceDueDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        hourlyRate,
        invoiceNo,
        totalLoggedHours: toHoursAndMinutes(totalLoggedHours).totalTime,
        monthlyTotals: Math.round(((totalLoggedHours / 60) * hourlyRate) * 100) / 100,
        loggingsData
    }
}

module.exports = {
    renderUsersLoggings,
    generateInvoiceData
}