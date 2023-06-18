require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const mongoose = require('mongoose');
const express = require('express');
const app = express();
const port = 3000;

main().catch(err => console.log(err));
async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
}

const projectSchema = new mongoose.Schema({
    rbProjectId: Number,
    name: String
});
const Project = mongoose.model('projects', projectSchema);

const userSchema = new mongoose.Schema({
    rbUserId: Number,
    name: String,
    username: String,
    email: String,
    password: String,
    status: Boolean
});
const User = mongoose.model('users', userSchema);

const taskSchema = new mongoose.Schema({
    rbTaskId: Number,
    rbProjectId: Number,
    name: String
});
const Task = mongoose.model('tasks', taskSchema);

const loggingSchema = new mongoose.Schema({
    rbCommentId: Number,
    rbUserId: Number,
    rbTaskId: Number,
    minutes: Number,
    timeTrackingOn: String,
    createdAt: Number
});
const Logging = mongoose.model('loggings', loggingSchema);

const saveProject = async (projectData) => {
    const checkProject = await Project.find({ rbProjectId: projectData.id }).exec();
    if (checkProject.length == 0) {
        const project = new Project({
            rbProjectId: projectData.id,
            name: projectData.name
        });
        await project.save();
    }
}

const saveUser = async (userData) => {
    const checkUser = await User.find({ rbUserId: userData.id }).exec();
    if (checkUser.length == 0) {
        const user = new User({
            rbUserId: userData.id,
            name: `${userData.first_name} ${userData.last_name}`,
            username: userData.username,
            email: userData.email,
            password: Math.random().toString(36).slice(-8),
            status: true
        });
        await user.save();
    }
}

const saveTask = async (taskData) => {
    const checkTask = await Task.find({ rbTaskId: taskData.id }).exec();
    if (checkTask.length == 0) {
        const task = new Task({
            rbTaskId: taskData.id,
            rbProjectId: taskData.project_id,
            name: taskData.name
        });
        await task.save();
    }
}

const saveLogging = async (loggingData) => {
    const checkLogging = await Logging.find({ rbCommentId: loggingData.id }).exec();
    if (checkLogging.length == 0) {
        const logging = new Logging({
            rbCommentId: loggingData.id,
            rbUserId: loggingData.user_id,
            rbTaskId: loggingData.target_id,
            minutes: loggingData.minutes,
            timeTrackingOn: loggingData.time_tracking_on,
            createdAt: loggingData.created_at
        });
        await logging.save();
    }
}

const REDBOOTH_API_HOST = 'https://redbooth.com/api/3';
const USERS_ENDPOINT = '/users';
const PROJECTS_ENDPOINT = '/projects';
const TASKS_ENDPOINT = '/tasks';
const COMMENTS_ENDPOINT = '/comments';
const client_id = process.env.RB_CLIENT_ID;
const client_secret = process.env.RB_CLIENT_SECRET;
const redirect_uri = process.env.RB_REDIRECT_URI;

const fetchAccessToken = async (refreshToken = null, code = null) => {
    var accessToken = null;
    var error = null;
    var params = {
        client_id,
        client_secret
    }
    if (refreshToken) {
        params.refresh_token = refreshToken;
        params.grant_type = 'refresh_token';
    } else {
        params.code = code;
        params.redirect_uri = redirect_uri;
        params.grant_type = 'authorization_code';
    }
    await axios.post('https://redbooth.com/oauth2/token', params).then((response) => {
        accessToken = response.data;
        try {
            fs.writeFileSync('rb_token.json', JSON.stringify(accessToken));
        } catch (err) {
            console.error(err);
        }
    }).catch((err) => {
        if (err.response) {
            error = {};
            console.log(err.response.status);
            error.status = err.response.status;
            console.log(err.response.statusText);
            error.statusText = err.response.statusText;
            console.log(err.message);
            error.message = err.message;
            console.log(err.response.headers); // 👉️ {... response headers here}
            console.log(err.response.data); // 👉️ {... response data here}
            error.error = err.response.data.error;
            error.error_description = err.response.data.error_description;
        }
    });
    return accessToken != null ? accessToken : error;
}

const getAccessToken = async () => {
    let accessToken = JSON.parse(fs.readFileSync('rb_token.json'));
    let currentTimestamp = Math.floor(Date.now() / 1000);
    if ((currentTimestamp - accessToken.created_at) > 7200) {
        console.log('Access token is expired!');
        return await fetchAccessToken(accessToken.refresh_token);
    } else {
        console.log('Access token is still valid!');
        return accessToken;
    }
}

const syncRedboothProjects = async () => {
    const accessToken =  await getAccessToken();
    try {
        const response = await axios.get(REDBOOTH_API_HOST + PROJECTS_ENDPOINT, {
            params: {
                access_token: accessToken.access_token,
                order: 'created_at-DESC'
            }
        });
        const projects = response.data;
        for (const project of projects) {
            await saveProject(project);
            console.log(`Project with name ${[project.name]} has been successfully saved!`);
        }
        console.log('All projects saved successfully!');
    } catch (err) {
        console.error('Error fetching Redbooth projects: ',err);
    }
    console.log('All of the projects have been successfully saved!');
}

const syncRedboothUsers = async () => {
    const accessToken =  await getAccessToken();
    try {
        const response = await axios.get(REDBOOTH_API_HOST + USERS_ENDPOINT, {
            params: {
                access_token: accessToken.access_token,
                order: 'created_at-DESC'
            }
        });
        const users = response.data;
        for (const user of users) {
            await saveUser(user);
            console.log(`User with name ${user.first_name + ' ' + user.last_name} has been successfully saved!`);
        }
    } catch (err) {
        console.error('Error fetching Redbooth users: ',err);
    }
    console.log('All of the users have been successfully saved!');
}

const syncRedboothUsersTasks = async () => {
    const accessToken =  await getAccessToken();
    const users = await User.find();
    for (const user of users) {
        try {
            const response = await axios.get(REDBOOTH_API_HOST + TASKS_ENDPOINT, {
                params: {
                    access_token: accessToken.access_token,
                    assigned_user_id: user.rbUserId,
                    order: 'created_at-DESC'
                }
            });
            const tasks = response.data;
            for (const task of tasks) {
                await saveTask(task);
            }
            console.log(`All tasks saved successfully for ${user.email} user !`);
        } catch (err) {
            console.error('Error fetching Redbooth tasks: ',err);
        }
    }
    console.log('All of the tasks have been successfully saved!');
}

const syncRedboothTasksLoggings = async () => {
    const accessToken =  await getAccessToken();
    const tasks = await Task.find();
    for (const task of tasks) {
        try {
            const response = await axios.get(REDBOOTH_API_HOST + COMMENTS_ENDPOINT, {
                params: {
                    access_token: accessToken.access_token,
                    target_type: 'Task',
                    target_id: task.rbTaskId,
                    order: 'created_at-DESC'
                }
            });
            var loggingStatus = false;
            const loggings = response.data;
            for (const logging of loggings) {
                if (logging.minutes) {
                    loggingStatus = true;
                    await saveLogging(logging);
                }
            }
            if (loggingStatus) {
                console.log(`All loggings saved successfully for ${task.name} task !`);
            }
        } catch (err) {
            console.error('Error fetching Redbooth loggings: ',err);
        }
    }
    console.log('All of the loggings have been successfully saved!');
}

const toHoursAndMinutes = (totalMinutes) => {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return { 
        hours, 
        minutes, 
        totalTime: `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`
    };
}

const getLastMonday = (month, year) => {
    var d = new Date();
    d.setHours(0, 0, 0);
    if (year) { d.setFullYear(year); }
    d.setDate(1); // Roll to the first day of ...
    d.setMonth(month || d.getMonth() + 1); // ... the next month.
    do { // Roll the days backwards until Monday.
      d.setDate(d.getDate() - 1);
    } while (d.getDay() !== 1);
    return d;
}

const renderUsersLoggings = async (month = null, year = null, invoice = null) => {
    if (month && year && invoice) {
        var startDate = Math.floor(getLastMonday(month - 1, year).valueOf() / 1000);
        var endDate = Math.floor(getLastMonday(month, year).valueOf() / 1000);
    } else {
        var startDate = Math.floor(new Date(year, month - 1, 1).valueOf() / 1000);
        var endDate = Math.floor(new Date(year, month, 0).valueOf() / 1000);
    }
    const users = await User.find();
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
            if (month && year 
                && (userLogging.createdAt < startDate || userLogging.createdAt > endDate)) {
                continue;
            }
            const task = await Task.findOne({ rbTaskId: userLogging.rbTaskId }).exec();
            const project = await Project.findOne({ rbProjectId: task.rbProjectId }).exec();
            var loggingData = {
                startDate,
                endDate,
                rbCommentId: userLogging.rbCommentId,
                rbProjectId: task.rbProjectId,
                rbProjectName: project.name,
                rbTaskId: userLogging.rbTaskId,
                rbTaskName: task.name,
                loggingTime: toHoursAndMinutes(userLogging.minutes).totalTime,
                loggingDate: new Date(userLogging.timeTrackingOn).toLocaleDateString("en-US"),
                loggingTimestamp: Math.floor(new Date(userLogging.timeTrackingOn).valueOf() / 1000),
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

app.get('/authorize', async (req, res) => {
    const accessToken = await fetchAccessToken(null, req.query.code);
    console.log('Access Token in Express Response: ', accessToken);
    res.json(accessToken);
});

app.get('/sync-data', async (req, res) => {
    syncRedboothProjects()
      .then(() => syncRedboothUsers())
      .then(() => syncRedboothUsersTasks())
      .then(() => syncRedboothTasksLoggings())
      .then(() => res.send('Synchronization has been completed!'));
});

app.get('/render-data', async (req, res) => {
    const { month, year, invoice } = req.query;
    if (month != undefined && year != undefined && invoice != undefined) {
        var loggingsData = await renderUsersLoggings(month, year, invoice);
    } else if (month != undefined && year != undefined) {
        var loggingsData = await renderUsersLoggings(month, year);
    } else {
        var loggingsData = await renderUsersLoggings();
    }
    res.json(loggingsData);
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
});

// syncRedboothProjects();
// syncRedboothUsers();
// syncRedboothUsersTasks();
// syncRedboothTasksLoggings();