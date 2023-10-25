const axios = require('axios');
const { getAccessToken } = require('./authenticateRedbooth.js');
const { Project, User, Task, Logging, saveRecord } = require('./db.js');
const { dateToUnixTimestamp, delay } = require('./util.js');

const REDBOOTH_API_HOST = 'https://redbooth.com/api/3';
const PROJECTS_ENDPOINT = '/projects';
const TASKS_ENDPOINT = '/tasks';
const USERS_ENDPOINT = '/users';
const COMMENTS_ENDPOINT = '/comments';
const last_year_start_date = dateToUnixTimestamp(new Date(new Date().getFullYear() - 1, 0, 1));
const current_year_start_date = dateToUnixTimestamp(new Date(new Date().getFullYear(), 0, 1));
const current_end_date = dateToUnixTimestamp(new Date());
var delayTime = 0;

const fetchRedboothData = async ({endpoint, endpointParams, setDelay}) => {
    // If setDelay is true then increment delayTime by 1 second
    if (setDelay) {
        delayTime++;
    }
    // If delayTime is more than 0 seconds then make sure that you wait for the set delay time
    if (delayTime > 0) {
        console.log('Waiting for ' + delayTime + ' seconds!')
        await delay(delayTime * 1000);
    }
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
                    var recordData = {
                        model: Task,
                        modelData: {
                            rbTaskId: task.id,
                            rbProjectId: task.project_id,
                            name: task.name,
                            updatedAt: task.updated_at
                        },
                        modelSearchData: { 
                            rbTaskId: task.id
                        },
                        recordData: task
                    };
                    // Make sure that we only store tasks which have been updated in current year
                    if (task.updated_at >= current_year_start_date) {
                        await saveRecord(recordData);
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

const syncRedboothTasksLoggings = async (syncDays = null) => {
    if (syncDays) {
        var d = new Date();
        d.setDate(d.getDate() - syncDays);
        var updatedAtTimestamp = dateToUnixTimestamp(d);
    } else {
        var updatedAtTimestamp = current_year_start_date;
    }
    const tasks = await Task.find({ updatedAt: { $gt: updatedAtTimestamp } });
    for (const task of tasks) {
        var loggingParams = {
            endpoint: COMMENTS_ENDPOINT,
            endpointParams: {
                target_type: 'Task',
                target_id: task.rbTaskId,
                created_from: updatedAtTimestamp,
                created_to: current_end_date,
                order: 'created_at-DESC'
            }
        }
        try {
            var loggings = await fetchRedboothData(loggingParams);
        } catch (err) {
            console.error('Error fetching Redbooth loggings: ',err);
            var loggings = await fetchRedboothData({
                ...loggingParams,
                setDelay: true
            });
        }
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
    }
    console.log('All of the loggings have been successfully saved!');
}

module.exports = {
    syncRedboothProjects,
    syncRedboothProjectsTasks,
    syncRedboothUsers,
    syncRedboothTasksLoggings
}