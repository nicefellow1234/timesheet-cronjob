const { Project, User, Task, Logging } = require('./db.js');
const { toHoursAndMinutes, getLastSundayOfMonth } = require('./util.js');

const renderUsersLoggings = async ({month, year, invoice, userId}) => {
    if (month && year && invoice) {
        var startDate = Math.floor(getLastSundayOfMonth(month - 1, year).valueOf() / 1000);
        var endDate = Math.floor(getLastSundayOfMonth(month, year).valueOf() / 1000);
    } else {
        var startDate = Math.floor(new Date(year, month - 1, 1).valueOf() / 1000);
        var endDate = Math.floor(new Date(year, month, 0).valueOf() / 1000);
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
            var loggingTimestamp = Math.floor(loggingDate.valueOf() / 1000);
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
                createdAtDate: new Date(userLogging.createdAt * 1000).toLocaleDateString("en-US")
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

module.exports = {
    renderUsersLoggings
}