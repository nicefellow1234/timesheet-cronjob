const axios = require("axios");
const { getAccessToken } = require("./authenticateRedbooth.js");
const { Project, User, Task, Logging, saveRecord } = require("./db.js");
const { dateToUnixTimestamp, delay } = require("./util.js");
const { addLog, getLogs, clearLogs } = require("./logger.js");

const REDBOOTH_API_HOST = "https://redbooth.com/api/3";
const PROJECTS_ENDPOINT = "/projects";
const TASKS_ENDPOINT = "/tasks";
const USERS_ENDPOINT = "/users";
const COMMENTS_ENDPOINT = "/comments";
const last_year_start_date = dateToUnixTimestamp(
  new Date(new Date().getFullYear() - 1, 0, 1)
);
const current_year_start_date = dateToUnixTimestamp(
  new Date(new Date().getFullYear(), 0, 1)
);
const current_end_date = dateToUnixTimestamp(new Date());

const fetchRedboothData = async ({ endpoint, endpointParams }) => {
  let delayTime = 0;
  let retries = 0;
  let maxRetries = 5;
  while (retries < maxRetries) {
    try {
      // If delayTime is more than 0 seconds then make sure that you wait for the set delay time
      if (delayTime > 0) {
        addLog("Waiting for " + delayTime + " seconds!");
        await delay(delayTime * 1000);
      }

      const accessToken = await getAccessToken();
      const response = await axios.get(REDBOOTH_API_HOST + endpoint, {
        params: {
          access_token: accessToken.access_token,
          ...endpointParams
        }
      });

      return response.data;
    } catch (err) {
      //addLog("Failed to fetch data!");
      // Increment delay time by 5 seconds each failed time
      delayTime += 5;
      retries++;
      addLog(`Retrying request (retry attempt ${retries}/${maxRetries})...`);
    }
  }

  addLog(`Max retries (${maxRetries}) reached. Request failed.`);
  return false;
};

const syncRedboothProjects = async () => {
  try {
    const projects = await fetchRedboothData({
      endpoint: PROJECTS_ENDPOINT,
      endpointParams: {
        order: "created_at-DESC"
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
      addLog(
        `Project with name ${[project.name]} has been successfully saved!`
      );
    }
    addLog("All projects saved successfully!");
  } catch (err) {
    addLog(logMessage + err);
  }
  addLog("All of the projects have been successfully saved!");
};

const getProjects = async (userProjectIds) => {
  const searchCriteria = userProjectIds.length
    ? { _id: { $in: userProjectIds } }
    : {};
  return Project.find(searchCriteria);
};
const syncRedboothProjectsTasks = async (userProjectIds) => {
  const projects = await getProjects(userProjectIds);
  for (const project of projects) {
    for (const v of [true, false]) {
      try {
        const tasks = await fetchRedboothData({
          endpoint: TASKS_ENDPOINT,
          endpointParams: {
            project_id: project.rbProjectId,
            archived: v,
            order: "updated_at-DESC"
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
            }
          };
          // Make sure that we only store tasks which have been updated in current year
          if (task.updated_at >= current_year_start_date) {
            await saveRecord(recordData);
          }
        }
        addLog(
          `All ${v ? `resolved` : "unresolved"} tasks saved successfully for ${
            project.name
          } project !`
        );
      } catch (err) {
        addLog("Error fetching Redbooth tasks: " + err);
      }
    }
  }
  addLog("All of the tasks have been successfully saved!");
};

const syncRedboothUsers = async (log) => {
  try {
    const users = await fetchRedboothData({
      endpoint: USERS_ENDPOINT,
      endpointParams: {
        order: "created_at-DESC"
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
      addLog(
        `User with name ${
          user.first_name + " " + user.last_name
        } has been successfully saved!`
      );
    }
  } catch (err) {
    addLog("Error fetching Redbooth users: " + err);
  }
  addLog("All of the users have been successfully saved!");
};

const syncRedboothTasksLoggings = async (syncDays = null, userProjectIds) => {
  if (syncDays) {
    var d = new Date();
    d.setDate(d.getDate() - syncDays);
    var updatedAtTimestamp = dateToUnixTimestamp(d);
  } else {
    var updatedAtTimestamp = current_year_start_date;
  }
  const projects = await getProjects(userProjectIds);
  const rbProjectIds = [];
  for (const project of projects) {
    rbProjectIds.push(project.rbProjectId);
  }
  const filters = rbProjectIds.length
    ? {
        rbProjectId: { $in: rbProjectIds },
        updatedAt: { $gt: updatedAtTimestamp }
      }
    : { updatedAt: { $gt: updatedAtTimestamp } };
  const tasks = await Task.find(filters);
  for (const task of tasks) {
    var loggingParams = {
      endpoint: COMMENTS_ENDPOINT,
      endpointParams: {
        target_type: "Task",
        target_id: task.rbTaskId,
        created_from: updatedAtTimestamp,
        created_to: current_end_date,
        order: "created_at-DESC"
      }
    };
    var loggings = await fetchRedboothData(loggingParams);
    var loggingStatus = false;
    if (loggings && Symbol.iterator in Object(loggings)) {
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
        addLog(`All loggings saved successfully for ${task.name} task !`);
      }
    } else {
      addLog(
        `Failed to fetch loggings for ${task.name} task after exhausting max 5 retries !`
      );
    }
  }
  addLog("All of the loggings have been successfully saved!");
};

module.exports = {
  syncRedboothProjects,
  syncRedboothProjectsTasks,
  syncRedboothUsers,
  syncRedboothTasksLoggings
};
