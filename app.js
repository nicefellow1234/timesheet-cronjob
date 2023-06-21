require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const express = require('express');
const app = express();
const port = 3000;
const { Project, User, Task, Logging, saveRecord } = require('./common/db.js');
const { toHoursAndMinutes, getLastSundayOfMonth } = require('./common/util.js');

const REDBOOTH_API_HOST = 'https://redbooth.com/api/3';
const USERS_ENDPOINT = '/users';
const PROJECTS_ENDPOINT = '/projects';
const TASKS_ENDPOINT = '/tasks';
const COMMENTS_ENDPOINT = '/comments';
const client_id = process.env.RB_CLIENT_ID;
const client_secret = process.env.RB_CLIENT_SECRET;
const redirect_uri = process.env.RB_REDIRECT_URI;
const last_year_start_date = Math.floor(new Date(new Date().getFullYear() - 1, 0, 1).valueOf() / 1000);
const current_year_start_date = Math.floor(new Date(new Date().getFullYear(), 0, 1).valueOf() / 1000);
const current_end_date = Math.floor(new Date().valueOf() / 1000);

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
        return accessToken;
    }
}

const fetchRedboothData = async ({endpoint, endpointParams}) => {
    const accessToken =  await getAccessToken();
    const response = await axios.get(REDBOOTH_API_HOST + endpoint, {
        params: {
            access_token: accessToken.access_token,
            ...endpointParams
        }
    });
    return response.data;
}

const syncRedboothProjects = async () => {
    try {
        const projects = await fetchRedboothData({
            endpoint: PROJECTS_ENDPOINT,
            endpointParams: {
                order: 'created_at-DESC'
            }
        });
        for (const project of projects) {
            await saveRecord({
                model: Project,
                modelData: {
                    rbProjectId: project.id,
                    name: project.name
                },
                modelSearchData: { 
                    rbProjectId: project.id 
                }
            });
            console.log(`Project with name ${[project.name]} has been successfully saved!`);
        }
        console.log('All projects saved successfully!');
    } catch (err) {
        console.error('Error fetching Redbooth projects: ',err);
    }
    console.log('All of the projects have been successfully saved!');
}

const syncRedboothUsers = async () => {
    try {
        const users = await fetchRedboothData({
            endpoint: USERS_ENDPOINT,
            endpointParams: {
                order: 'created_at-DESC'
            }
        });
        for (const user of users) {
            await saveRecord({
                model: User,
                modelData: {
                    rbUserId: user.id,
                    name: `${user.first_name} ${user.last_name}`,
                    username: user.username,
                    email: user.email,
                    password: Math.random().toString(36).slice(-8),
                    status: true
                },
                modelSearchData: { 
                    rbUserId: user.id
                 }
            });
            console.log(`User with name ${user.first_name + ' ' + user.last_name} has been successfully saved!`);
        }
    } catch (err) {
        console.error('Error fetching Redbooth users: ',err);
    }
    console.log('All of the users have been successfully saved!');
}

const syncRedboothProjectsTasks = async () => {
    const projects = await Project.find();
    for (const project of projects) {
        for (const v of [true, false]) {
            try {
                const tasks = await fetchRedboothData({
                    endpoint: TASKS_ENDPOINT,
                    endpointParams: {
                        project_id: project.rbProjectId,
                        archived: v,
                        order: 'updated_at-DESC'
                    }
                });
                for (const task of tasks) {
                    // To ensure that we only store tasks which have been updated in current year
                    if (task.updated_at >= current_year_start_date) {
                        await saveRecord({
                            model: Task,
                            modelData: {
                                rbTaskId: task.id,
                                rbProjectId: task.project_id,
                                name: task.name,
                                updatedAt: task.updated_at
                            },
                            modelSearchData: { 
                                rbTaskId: task.id
                            }
                        });
                    }
                }
                console.log(`All ${v ? `resolved` : 'unresolved'} tasks saved successfully for ${project.name} project !`);
            } catch (err) {
                console.error('Error fetching Redbooth tasks: ',err);
            }
        }
    }
    console.log('All of the tasks have been successfully saved!');
}

const syncRedboothTasksLoggings = async () => {
    const tasks = await Task.find({ updatedAt: { $gt: current_year_start_date } });
    for (const task of tasks) {
        try {
            const loggings = await fetchRedboothData({
                endpoint: COMMENTS_ENDPOINT,
                endpointParams: {
                    target_type: 'Task',
                    target_id: task.rbTaskId,
                    created_from: current_year_start_date,
                    created_to: current_end_date,
                    order: 'created_at-DESC'
                }
            });
            var loggingStatus = false;
            for (const logging of loggings) {
                if (logging.minutes) {
                    loggingStatus = true;
                    await saveRecord({
                        model: Logging,
                        modelData: {
                            rbCommentId: logging.id,
                            rbUserId: logging.user_id,
                            rbTaskId: logging.target_id,
                            minutes: logging.minutes,
                            timeTrackingOn: logging.time_tracking_on,
                            createdAt: logging.created_at
                        },
                        modelSearchData: { 
                            rbCommentId: logging.id
                        }
                    });
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

app.get('/authorize', async (req, res) => {
    const accessToken = await fetchAccessToken(null, req.query.code);
    console.log('Access Token in Express Response: ', accessToken);
    res.json(accessToken);
});

app.get('/sync-data', async (req, res) => {
    syncRedboothProjects()
      .then(() => syncRedboothUsers())
      .then(() => syncRedboothProjectsTasks())
      .then(() => syncRedboothTasksLoggings())
      .then(() => res.send('Synchronization has been completed!'));
});

app.get('/render-data', async (req, res) => {
    const { month, year, invoice, userId } = req.query;
    var loggingsData = await renderUsersLoggings({month, year, invoice, userId});
    res.json(loggingsData);
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
});

// syncRedboothProjects();
// syncRedboothUsers();
// syncRedboothProjectsTasks;
// syncRedboothTasksLoggings();