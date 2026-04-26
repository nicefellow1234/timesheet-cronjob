const axios = require("axios");
const { getAccessToken } = require("./authenticateRedbooth.js");
const { Project, User, Task, Logging, saveRecord } = require("./db.js");
const { dateToUnixTimestamp, delay } = require("./util.js");
const { addLog } = require("./logger.js");

const REDBOOTH_API_HOST = "https://redbooth.com/api/3";
const PROJECTS_ENDPOINT = "/projects";
const TASKS_ENDPOINT = "/tasks";
const USERS_ENDPOINT = "/users";
const COMMENTS_ENDPOINT = "/comments";
const MIN_REDBOOTH_REQUEST_INTERVAL_MS = parseInt(
  process.env.REDBOOTH_REQUEST_INTERVAL_MS || "1000"
);
const MAX_REDBOOTH_RETRIES = parseInt(process.env.REDBOOTH_MAX_RETRIES || "8");
const MAX_REDBOOTH_RETRY_DELAY_SECONDS = parseInt(
  process.env.REDBOOTH_MAX_RETRY_DELAY_SECONDS || "120"
);
const FAILED_LOGGING_RETRY_ATTEMPTS = parseInt(
  process.env.REDBOOTH_FAILED_LOGGING_RETRY_ATTEMPTS || "5"
);
const last_year_start_date = dateToUnixTimestamp(
  new Date(new Date().getFullYear() - 1, 0, 1)
);
const current_year_start_date = dateToUnixTimestamp(
  new Date(new Date().getFullYear(), 0, 1)
);
const countRecords = (records) => (Array.isArray(records) ? records.length : 0);
let lastRedboothRequestAt = 0;

const waitForRedboothRequestSlot = async () => {
  const elapsed = Date.now() - lastRedboothRequestAt;
  const waitMs = MIN_REDBOOTH_REQUEST_INTERVAL_MS - elapsed;

  if (waitMs > 0) {
    await delay(waitMs);
  }

  lastRedboothRequestAt = Date.now();
};

const formatErrorMessage = (errorData) => {
  if (!errorData) {
    return "Unknown error";
  }

  return typeof errorData === "string" ? errorData : JSON.stringify(errorData);
};

const getRetryDelaySeconds = (err, retries) => {
  const retryAfter = err.response?.headers?.["retry-after"];

  if (retryAfter) {
    const retryAfterSeconds = parseInt(retryAfter);

    if (!Number.isNaN(retryAfterSeconds)) {
      return retryAfterSeconds;
    }

    const retryAfterDate = new Date(retryAfter);
    const retryAfterDateSeconds = Math.ceil(
      (retryAfterDate.getTime() - Date.now()) / 1000
    );

    if (retryAfterDateSeconds > 0) {
      return retryAfterDateSeconds;
    }
  }

  const exponentialDelay = Math.min(
    5 * Math.pow(2, retries),
    MAX_REDBOOTH_RETRY_DELAY_SECONDS
  );
  const jitter = Math.floor(Math.random() * 3);

  return exponentialDelay + jitter;
};

const fetchRedboothData = async ({
  endpoint,
  endpointParams,
  maxRetries = MAX_REDBOOTH_RETRIES
}) => {
  let delayTime = 0;
  let retries = 0;
  while (retries < maxRetries) {
    try {
      // If delayTime is more than 0 seconds then make sure that you wait for the set delay time
      if (delayTime > 0) {
        addLog("Waiting for " + delayTime + " seconds!");
        await delay(delayTime * 1000);
      }

      const accessToken = await getAccessToken();
      addLog(`Fetching Redbooth data: ${endpoint}.`);
      await waitForRedboothRequestSlot();
      const response = await axios.get(REDBOOTH_API_HOST + endpoint, {
        params: {
          access_token: accessToken.access_token,
          ...endpointParams
        }
      });

      addLog(
        `Fetched Redbooth data: ${endpoint} (${countRecords(response.data)} records).`
      );
      return response.data;
    } catch (err) {
      // Extract and log the error message and status code (if available)
      const errorMessage = formatErrorMessage(err.response?.data) || err.message;
      const statusCode = err.response?.status || "Unknown Status Code";
      addLog(
        `Failed to fetch data! Error: ${errorMessage}, Status Code: ${statusCode}`
      );

      delayTime = getRetryDelaySeconds(err, retries);
      retries++;
      if (retries < maxRetries) {
        addLog(
          `Retrying request in ${delayTime} seconds (retry attempt ${retries}/${maxRetries})...`
        );
      }
    }
  }

  addLog(`Max retries (${maxRetries}) reached. Request failed.`);
  return false;
};

const syncRedboothProjects = async () => {
  addLog("Fetching projects from Redbooth.");
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
    addLog("Error fetching Redbooth projects: " + err.message);
  }
  addLog("All of the projects have been successfully saved!");
};

const getProjects = async (userProjectIds = []) => {
  addLog(
    `Loading projects from database: ${userProjectIds.length ? userProjectIds.length + " selected projects" : "all projects"}.`
  );
  const searchCriteria = userProjectIds.length
    ? { _id: { $in: userProjectIds } }
    : {};
  return Project.find(searchCriteria);
};
const syncRedboothProjectsTasks = async (userProjectIds = []) => {
  addLog("Fetching project tasks from Redbooth.");
  const projects = await getProjects(userProjectIds);
  addLog(`Loaded ${projects.length} projects for task synchronization.`);
  for (const project of projects) {
    addLog(`Synchronizing tasks for project ${project.name}.`);
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
        addLog(`Fetched ${countRecords(tasks)} ${v ? "resolved" : "unresolved"} tasks for ${project.name}.`);
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
  addLog("Fetching users from Redbooth.");
  try {
    const users = await fetchRedboothData({
      endpoint: USERS_ENDPOINT,
      endpointParams: {
        order: "created_at-DESC"
      }
    });
    addLog(`Fetched ${countRecords(users)} users from Redbooth.`);
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

const getLoggingParams = ({ task, updatedAtTimestamp, endAtTimestamp }) => {
  return {
    endpoint: COMMENTS_ENDPOINT,
    endpointParams: {
      target_type: "Task",
      target_id: task.rbTaskId,
      created_from: updatedAtTimestamp,
      created_to: endAtTimestamp,
      order: "created_at-DESC"
    }
  };
};

const saveTaskLoggings = async ({ task, updatedAtTimestamp, endAtTimestamp, maxRetries }) => {
  const loggingParams = getLoggingParams({
    task,
    updatedAtTimestamp,
    endAtTimestamp
  });
  const loggings = await fetchRedboothData({
    ...loggingParams,
    maxRetries
  });

  addLog(
    `Fetched ${countRecords(loggings)} loggings for task ${task.name}.`
  );

  if (!loggings || !(Symbol.iterator in Object(loggings))) {
    return false;
  }

  let loggingStatus = false;
  for (const logging of loggings) {
    if (logging.minutes) {
      loggingStatus = true;

      // Fetch the user using rbUserId
      const user = await User.findOne({ rbUserId: logging.user_id });
      const userName = user ? user.name : "Unknown User";

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
      addLog(
        `${userName} logged ${toHoursMinutes(logging.minutes)} for task "${
          task.name
        }" on ${logging.time_tracking_on}.`
      );
    }
  }

  if (loggingStatus) {
    addLog(`All loggings saved successfully for ${task.name} task !`);
  }

  return true;
};

const syncRedboothTasksLoggings = async (
  syncDays = null,
  userProjectIds = [],
  options = {}
) => {
  const { startDate = null, endDate = null } = options;
  addLog(
    `Fetching task loggings from Redbooth: syncDays=${syncDays || "current year"}, selectedProjects=${userProjectIds.length}, startDate=${startDate ? startDate.toLocaleDateString("en-US") : "default"}, endDate=${endDate ? endDate.toLocaleDateString("en-US") : "today"}.`
  );
  if (startDate) {
    var updatedAtTimestamp = dateToUnixTimestamp(startDate);
  } else if (syncDays) {
    var d = new Date();
    d.setDate(d.getDate() - syncDays);
    var updatedAtTimestamp = dateToUnixTimestamp(d);
  } else {
    var updatedAtTimestamp = current_year_start_date;
  }
  const endAtTimestamp = endDate
    ? dateToUnixTimestamp(endDate)
    : dateToUnixTimestamp(new Date());
  const projects = await getProjects(userProjectIds);
  addLog(`Loaded ${projects.length} projects for logging synchronization.`);
  const rbProjectIds = [];
  for (const project of projects) {
    rbProjectIds.push(project.rbProjectId);
  }
  const filters = rbProjectIds.length
    ? {
        rbProjectId: { $in: rbProjectIds }
      }
    : {};
  if (!startDate) {
    filters.updatedAt = { $gt: updatedAtTimestamp };
  }
  const tasks = await Task.find(filters);
  addLog(`Loaded ${tasks.length} tasks for logging synchronization.`);
  const failedTasks = [];
  for (const task of tasks) {
    addLog(`Fetching loggings for task ${task.name}.`);
    const taskLoggingSaved = await saveTaskLoggings({
      task,
      updatedAtTimestamp,
      endAtTimestamp,
      maxRetries: 1
    });

    if (!taskLoggingSaved) {
      failedTasks.push(task);
      addLog(
        `Skipping ${task.name} for now. It has been added to the failed logging retry queue.`
      );
    }
  }

  if (failedTasks.length) {
    addLog(
      `Retrying ${failedTasks.length} failed logging fetches at the end of processing.`
    );
  }

  let unresolvedFailedTasks = 0;
  for (const task of failedTasks) {
    addLog(
      `Retrying failed logging fetch for task ${task.name} with up to ${FAILED_LOGGING_RETRY_ATTEMPTS} attempts.`
    );
    const taskLoggingSaved = await saveTaskLoggings({
      task,
      updatedAtTimestamp,
      endAtTimestamp,
      maxRetries: FAILED_LOGGING_RETRY_ATTEMPTS
    });

    if (!taskLoggingSaved) {
      unresolvedFailedTasks++;
      addLog(
        `Failed to fetch loggings for ${task.name} task after ${FAILED_LOGGING_RETRY_ATTEMPTS} end-of-processing retry attempts.`
      );
    }
  }

  if (unresolvedFailedTasks) {
    addLog(
      `Logging synchronization completed with ${unresolvedFailedTasks} unresolved failed tasks.`
    );
  } else {
    addLog("All of the loggings have been successfully saved!");
  }
};

const toHoursMinutes = (m) => `${Math.floor(m / 60)}h ${m % 60}m`;

const formatDate = (ts) => new Date(ts * 1000).toLocaleDateString("en-GB");

module.exports = {
  syncRedboothProjects,
  syncRedboothProjectsTasks,
  syncRedboothUsers,
  syncRedboothTasksLoggings
};
