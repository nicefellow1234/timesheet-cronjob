const axios = require("axios");
const { getAccessToken } = require("./authenticateRedbooth.js");
const {
  saveRecord,
  getProjects: getDbProjects,
  getUserByRedboothId,
  getTaskByRedboothId,
  getTasksForLoggingSync: getDbTasksForLoggingSync,
  getTasksByRedboothIds
} = require("./db.js");
const { dateToUnixTimestamp, delay } = require("./util.js");
const { addLog } = require("./logger.js");

const REDBOOTH_API_HOST = "https://redbooth.com/api/3";
const PROJECTS_ENDPOINT = "/projects";
const TASKS_ENDPOINT = "/tasks";
const USERS_ENDPOINT = "/users";
const COMMENTS_ENDPOINT = "/comments";
const ACTIVITIES_ENDPOINT = "/activities";
const getIntegerEnv = (name, defaultValue) => {
  const parsed = parseInt(process.env[name] || `${defaultValue}`);

  return Number.isNaN(parsed) ? defaultValue : parsed;
};
const MIN_REDBOOTH_REQUEST_INTERVAL_MS = getIntegerEnv(
  "REDBOOTH_REQUEST_INTERVAL_MS",
  1000
);
const MAX_REDBOOTH_RETRIES = getIntegerEnv("REDBOOTH_MAX_RETRIES", 8);
const MAX_REDBOOTH_RETRY_DELAY_SECONDS = getIntegerEnv(
  "REDBOOTH_MAX_RETRY_DELAY_SECONDS",
  120
);
const FAILED_LOGGING_RETRY_ATTEMPTS = getIntegerEnv(
  "REDBOOTH_FAILED_LOGGING_RETRY_ATTEMPTS",
  5
);
const REDBOOTH_ACTIVITY_INDEX_SYNC_ENABLED =
  process.env.REDBOOTH_ACTIVITY_INDEX_SYNC_ENABLED !== "0";
const REDBOOTH_FALLBACK_TASK_COMMENT_SYNC =
  process.env.REDBOOTH_FALLBACK_TASK_COMMENT_SYNC === "1";
const REDBOOTH_ACTIVITY_PAGE_SIZE = getIntegerEnv(
  "REDBOOTH_ACTIVITY_PAGE_SIZE",
  1000
);
const REDBOOTH_COMMENTS_PAGE_SIZE = getIntegerEnv(
  "REDBOOTH_COMMENTS_PAGE_SIZE",
  1000
);
const REDBOOTH_DIRECT_TIME_LOG_SYNC_ENABLED =
  process.env.REDBOOTH_DIRECT_TIME_LOG_SYNC_ENABLED !== "0";
const REDBOOTH_TIME_LOG_ACTIVITY_CREATED_LOOKBACK_DAYS = getIntegerEnv(
  "REDBOOTH_TIME_LOG_ACTIVITY_CREATED_LOOKBACK_DAYS",
  0
);
const last_year_start_date = dateToUnixTimestamp(
  new Date(new Date().getFullYear() - 1, 0, 1)
);
const current_year_start_date = dateToUnixTimestamp(
  new Date(new Date().getFullYear(), 0, 1)
);
const countRecords = (records) => {
  if (Array.isArray(records)) {
    return records.length;
  }

  return records && typeof records === "object" ? 1 : 0;
};
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

const fetchRedboothPages = async ({
  endpoint,
  endpointParams,
  perPage,
  maxRetries = MAX_REDBOOTH_RETRIES
}) => {
  let page = 1;
  const records = [];

  while (true) {
    const pageRecords = await fetchRedboothData({
      endpoint,
      endpointParams: {
        ...endpointParams,
        per_page: perPage,
        page
      },
      maxRetries
    });

    if (!Array.isArray(pageRecords)) {
      return false;
    }

    records.push(...pageRecords);
    addLog(
      `Fetched Redbooth page ${page} from ${endpoint}: ${pageRecords.length} records.`
    );

    if (pageRecords.length < perPage) {
      return records;
    }

    page++;
  }
};

const formatDateKey = (date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const isTimeTrackingOnInRange = ({ timeTrackingOn, startDate, endDate }) => {
  if (!timeTrackingOn) {
    return false;
  }

  return (
    timeTrackingOn >= formatDateKey(startDate) &&
    timeTrackingOn <= formatDateKey(endDate)
  );
};

const getActivityCreatedFromDate = (startDate) => {
  const activityCreatedFromDate = new Date(startDate);
  activityCreatedFromDate.setDate(
    activityCreatedFromDate.getDate() -
      REDBOOTH_TIME_LOG_ACTIVITY_CREATED_LOOKBACK_DAYS
  );

  return activityCreatedFromDate;
};

const getCreatedToDateForLoggingFetch = (endDate) => {
  const now = new Date();

  if (!endDate || endDate < now) {
    return now;
  }

  return endDate;
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
        table: "projects",
        modelData: {
          rbProjectId: project.id,
          name: project.name
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
  return getDbProjects(userProjectIds);
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
            table: "tasks",
            modelData: {
              rbTaskId: task.id,
              rbProjectId: task.project_id,
              name: task.name,
              updatedAt: task.updated_at
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
        table: "users",
        modelData: {
          rbUserId: user.id,
          name: `${user.first_name} ${user.last_name}`,
          username: user.username,
          email: user.email,
          status: true
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

const getLoggingParams = ({ task, updatedAtTimestamp, createdToTimestamp }) => {
  return {
    endpoint: COMMENTS_ENDPOINT,
    endpointParams: {
      target_type: "Task",
      target_id: task.rbTaskId,
      created_from: updatedAtTimestamp,
      created_to: createdToTimestamp,
      per_page: REDBOOTH_COMMENTS_PAGE_SIZE,
      order: "created_at-DESC"
    }
  };
};

const saveLoggingRecord = async ({ logging, task }) => {
  if (!logging.minutes) {
    return false;
  }

  const user = await getUserByRedboothId(logging.user_id);
  const userName = user ? user.name : "Unknown User";

  await saveRecord({
    table: "loggings",
    modelData: {
      rbCommentId: logging.id,
      rbUserId: logging.user_id,
      rbTaskId: logging.target_id,
      minutes: logging.minutes,
      timeTrackingOn: logging.time_tracking_on,
      createdAt: logging.created_at
    }
  });
  addLog(
    `${userName} logged ${toHoursMinutes(logging.minutes)} for task "${
      task.name
    }" on ${logging.time_tracking_on}.`
  );

  return true;
};

const saveTaskLoggings = async ({
  task,
  updatedAtTimestamp,
  createdToTimestamp,
  startDate,
  endDate,
  maxRetries
}) => {
  const loggingParams = getLoggingParams({
    task,
    updatedAtTimestamp,
    createdToTimestamp
  });
  const loggings = await fetchRedboothPages({
    ...loggingParams,
    perPage: REDBOOTH_COMMENTS_PAGE_SIZE,
    maxRetries
  });

  addLog(
    `Fetched ${countRecords(loggings)} loggings for task ${task.name}.`
  );

  if (!loggings || !(Symbol.iterator in Object(loggings))) {
    return {
      completed: false,
      savedCount: 0
    };
  }

  let savedCount = 0;
  for (const logging of loggings) {
    if (
      startDate &&
      endDate &&
      !isTimeTrackingOnInRange({
        timeTrackingOn: logging.time_tracking_on,
        startDate,
        endDate
      })
    ) {
      continue;
    }

    const savedLogging = await saveLoggingRecord({ logging, task });
    if (savedLogging) {
      savedCount++;
    }
  }

  if (savedCount) {
    addLog(`All loggings saved successfully for ${task.name} task !`);
  }

  return {
    completed: true,
    savedCount
  };
};

const getTaskFromTimeLogActivity = async (activity) => {
  const taskData = {
    rbTaskId: activity.comment_target_id,
    rbProjectId: activity.project_id,
    name: activity.title || `Redbooth task ${activity.comment_target_id}`,
    updatedAt: activity.updated_at || activity.created_at || 0
  };
  const savedTask = await getTaskByRedboothId(taskData.rbTaskId);

  if (savedTask) {
    return savedTask;
  }

  await saveRecord({
    table: "tasks",
    modelData: taskData
  });

  return taskData;
};

const getTimeLogActivitiesForProject = async ({
  project,
  startDate,
  endDate,
  maxRetries
}) => {
  const activityCreatedFromDate = getActivityCreatedFromDate(startDate);
  const activities = await fetchRedboothPages({
    endpoint: ACTIVITIES_ENDPOINT,
    endpointParams: {
      project_id: project.rbProjectId,
      target_type: "Comment",
      created_from: dateToUnixTimestamp(activityCreatedFromDate),
      created_to: dateToUnixTimestamp(getCreatedToDateForLoggingFetch(endDate)),
      order: "created_at-DESC"
    },
    perPage: REDBOOTH_ACTIVITY_PAGE_SIZE,
    maxRetries
  });

  if (!activities) {
    return false;
  }

  const timeLogActivitiesByCommentId = new Map();
  for (const activity of activities) {
    if (
      activity.target_id &&
      activity.comment_target_id &&
      isTimeTrackingOnInRange({
        timeTrackingOn: activity.time_tracking_on,
        startDate,
        endDate
      })
    ) {
      timeLogActivitiesByCommentId.set(activity.target_id, activity);
    }
  }

  addLog(
    `Activity index found ${timeLogActivitiesByCommentId.size} time logging comments for ${project.name}.`
  );
  return Array.from(timeLogActivitiesByCommentId.values());
};

const fetchTimeLoggingComment = async ({ activity, maxRetries }) => {
  return fetchRedboothData({
    endpoint: `${COMMENTS_ENDPOINT}/${activity.target_id}`,
    endpointParams: {},
    maxRetries
  });
};

const getLoggingFromTimeLogActivity = (activity) => {
  if (!activity.minutes) {
    return null;
  }

  return {
    id: activity.target_id,
    user_id: activity.user_id || activity.creator_id || activity.user?.id,
    target_id: activity.comment_target_id,
    minutes: activity.minutes,
    time_tracking_on: activity.time_tracking_on,
    created_at: activity.created_at
  };
};

const syncDirectTimeLogActivity = async ({ activity, startDate, endDate, maxRetries }) => {
  const activityLogging = getLoggingFromTimeLogActivity(activity);

  if (activityLogging) {
    const task = await getTaskFromTimeLogActivity(activity);
    const savedLogging = await saveLoggingRecord({ logging: activityLogging, task });

    return {
      completed: true,
      savedCount: savedLogging ? 1 : 0
    };
  }

  const logging = await fetchTimeLoggingComment({ activity, maxRetries });

  if (!logging) {
    return {
      completed: false,
      savedCount: 0
    };
  }

  if (
    !isTimeTrackingOnInRange({
      timeTrackingOn: logging.time_tracking_on,
      startDate,
      endDate
    })
  ) {
    addLog(
      `Skipping comment ${logging.id}; time tracking date ${logging.time_tracking_on || "not set"} is outside the selected range.`
    );
    return {
      completed: true,
      savedCount: 0
    };
  }

  const task = await getTaskFromTimeLogActivity(activity);
  const savedLogging = await saveLoggingRecord({ logging, task });

  return {
    completed: true,
    savedCount: savedLogging ? 1 : 0
  };
};

const syncProjectTimeLoggingsFromActivities = async ({
  project,
  startDate,
  endDate
}) => {
  addLog(
    `Fetching time logging activity index for ${project.name} from ${formatDateKey(startDate)} to ${formatDateKey(endDate)}.`
  );
  const activities = await getTimeLogActivitiesForProject({
    project,
    startDate,
    endDate,
    maxRetries: 1
  });

  if (!activities) {
    return {
      completed: false,
      savedCount: 0,
      indexedCount: 0
    };
  }

  const failedActivities = [];
  let savedCount = 0;
  for (const activity of activities) {
    const loggingResult = await syncDirectTimeLogActivity({
      activity,
      startDate,
      endDate,
      maxRetries: 1
    });

    savedCount += loggingResult.savedCount;

    if (!loggingResult.completed) {
      failedActivities.push(activity);
      addLog(
        `Skipping time logging comment ${activity.target_id} for now. It has been added to the failed retry queue.`
      );
    }
  }

  let unresolvedFailedActivities = 0;
  for (const activity of failedActivities) {
    addLog(
      `Retrying failed time logging comment ${activity.target_id} with up to ${FAILED_LOGGING_RETRY_ATTEMPTS} attempts.`
    );
    const loggingResult = await syncDirectTimeLogActivity({
      activity,
      startDate,
      endDate,
      maxRetries: FAILED_LOGGING_RETRY_ATTEMPTS
    });

    savedCount += loggingResult.savedCount;

    if (!loggingResult.completed) {
      unresolvedFailedActivities++;
      addLog(
        `Failed to fetch time logging comment ${activity.target_id} after ${FAILED_LOGGING_RETRY_ATTEMPTS} retry attempts.`
      );
    }
  }

  return {
    completed: unresolvedFailedActivities === 0,
    savedCount,
    indexedCount: activities.length
  };
};

const syncTimeLoggingsFromActivities = async ({ projects, startDate, endDate }) => {
  const failedProjects = [];
  let savedCount = 0;
  let indexedCount = 0;

  for (const project of projects) {
    const projectResult = await syncProjectTimeLoggingsFromActivities({
      project,
      startDate,
      endDate
    });

    savedCount += projectResult.savedCount;
    indexedCount += projectResult.indexedCount;

    if (!projectResult.completed) {
      failedProjects.push(project);
      addLog(
        `Skipping ${project.name} for direct time logging sync. It will be retried at the end.`
      );
    }
  }

  if (!failedProjects.length) {
    return {
      completed: true,
      savedCount,
      indexedCount
    };
  }

  addLog(`Retrying ${failedProjects.length} failed project time logging indexes.`);
  let unresolvedFailedProjects = 0;
  for (const project of failedProjects) {
    const projectResult = await syncProjectTimeLoggingsFromActivities({
      project,
      startDate,
      endDate
    });

    savedCount += projectResult.savedCount;
    indexedCount += projectResult.indexedCount;

    if (!projectResult.completed) {
      unresolvedFailedProjects++;
    }
  }

  return {
    completed: unresolvedFailedProjects === 0,
    savedCount,
    indexedCount
  };
};

const getActivityIndexedTasksForProject = async ({
  project,
  updatedAtTimestamp,
  endAtTimestamp,
  maxRetries
}) => {
  addLog(
    `Building logging activity index for project ${project.name} from Redbooth activities.`
  );
  const activities = await fetchRedboothPages({
    endpoint: ACTIVITIES_ENDPOINT,
    endpointParams: {
      project_id: project.rbProjectId,
      target_type: "Comment",
      created_from: updatedAtTimestamp,
      created_to: endAtTimestamp,
      order: "created_at-DESC"
    },
    perPage: REDBOOTH_ACTIVITY_PAGE_SIZE,
    maxRetries
  });

  if (!activities) {
    addLog(`Failed to build logging activity index for project ${project.name}.`);
    return false;
  }

  const taskIndex = new Map();
  for (const activity of activities) {
    if (!activity.comment_target_id) {
      continue;
    }

    if (!taskIndex.has(activity.comment_target_id)) {
      taskIndex.set(activity.comment_target_id, {
        rbTaskId: activity.comment_target_id,
        rbProjectId: activity.project_id || project.rbProjectId,
        name: activity.title || `Redbooth task ${activity.comment_target_id}`,
        updatedAt: activity.updated_at || activity.created_at || 0
      });
    }
  }

  addLog(
    `Activity index found ${taskIndex.size} tasks with comment activity for ${project.name}.`
  );
  return Array.from(taskIndex.values());
};

const getActivityIndexedTasks = async ({
  projects,
  updatedAtTimestamp,
  endAtTimestamp,
  maxRetries
}) => {
  const indexedTasks = new Map();
  const failedProjects = [];

  for (const project of projects) {
    const projectTasks = await getActivityIndexedTasksForProject({
      project,
      updatedAtTimestamp,
      endAtTimestamp,
      maxRetries
    });

    if (!projectTasks) {
      failedProjects.push(project);
      continue;
    }

    for (const task of projectTasks) {
      indexedTasks.set(task.rbTaskId, task);
    }
  }

  return {
    tasks: Array.from(indexedTasks.values()),
    failedProjects
  };
};

const getDatabaseTasksForLoggingSync = async ({
  rbProjectIds,
  updatedAtTimestamp,
  scanAllProjectTasks = false
}) => {
  return getDbTasksForLoggingSync({
    rbProjectIds,
    updatedAtTimestamp,
    scanAllProjectTasks
  });
};

const hydrateIndexedTasksFromDatabase = async (indexedTasks) => {
  if (!indexedTasks.length) {
    return [];
  }

  const taskIds = indexedTasks.map((task) => task.rbTaskId);
  const savedTasks = await getTasksByRedboothIds(taskIds);
  const savedTasksById = new Map(
    savedTasks.map((task) => [task.rbTaskId, task])
  );
  const hydratedTasks = [];

  for (const indexedTask of indexedTasks) {
    const savedTask = savedTasksById.get(indexedTask.rbTaskId);

    if (savedTask) {
      hydratedTasks.push(savedTask);
      continue;
    }

    await saveRecord({
      table: "tasks",
      modelData: indexedTask,
    });
    hydratedTasks.push(indexedTask);
  }

  return hydratedTasks;
};

const getTasksForLoggingSync = async ({
  projects,
  rbProjectIds,
  updatedAtTimestamp,
  endAtTimestamp,
  startDate
}) => {
  if (!REDBOOTH_ACTIVITY_INDEX_SYNC_ENABLED) {
    addLog("Activity-indexed logging sync is disabled. Using database task list.");
    return getDatabaseTasksForLoggingSync({
      rbProjectIds,
      updatedAtTimestamp
    });
  }

  const activityIndex = await getActivityIndexedTasks({
    projects,
    updatedAtTimestamp,
    endAtTimestamp,
    maxRetries: 1
  });
  let indexedTasks = activityIndex.tasks;
  let unresolvedFailedProjects = 0;

  if (activityIndex.failedProjects.length) {
    addLog(
      `Retrying ${activityIndex.failedProjects.length} failed activity index fetches at the end of project indexing.`
    );
  }

  for (const project of activityIndex.failedProjects) {
    const retryIndex = await getActivityIndexedTasksForProject({
      project,
      updatedAtTimestamp,
      endAtTimestamp,
      maxRetries: FAILED_LOGGING_RETRY_ATTEMPTS
    });

    if (!retryIndex) {
      unresolvedFailedProjects++;
      addLog(
        `Activity index failed for ${project.name} after ${FAILED_LOGGING_RETRY_ATTEMPTS} retry attempts.`
      );
      continue;
    }

    indexedTasks = indexedTasks.concat(retryIndex);
  }

  const indexedTasksById = new Map(
    indexedTasks.map((task) => [task.rbTaskId, task])
  );

  if (unresolvedFailedProjects && REDBOOTH_FALLBACK_TASK_COMMENT_SYNC) {
    addLog(
      `Falling back to database task list for ${unresolvedFailedProjects} projects because REDBOOTH_FALLBACK_TASK_COMMENT_SYNC is enabled.`
    );
    const fallbackTasks = await getDatabaseTasksForLoggingSync({
      rbProjectIds,
      updatedAtTimestamp
    });

    for (const task of fallbackTasks) {
      indexedTasksById.set(task.rbTaskId, task);
    }
  }

  if (unresolvedFailedProjects && !REDBOOTH_FALLBACK_TASK_COMMENT_SYNC) {
    addLog(
      `${unresolvedFailedProjects} projects could not be activity-indexed. Enable REDBOOTH_FALLBACK_TASK_COMMENT_SYNC=1 to fall back to the slower full task scan.`
    );
  }

  return hydrateIndexedTasksFromDatabase(Array.from(indexedTasksById.values()));
};

const syncTaskCommentLoggings = async ({
  tasks,
  updatedAtTimestamp,
  createdToTimestamp,
  startDate,
  endDate
}) => {
  const failedTasks = [];
  let savedCount = 0;

  for (const task of tasks) {
    addLog(`Fetching loggings for task ${task.name}.`);
    const taskLoggingResult = await saveTaskLoggings({
      task,
      updatedAtTimestamp,
      createdToTimestamp,
      startDate,
      endDate,
      maxRetries: 1
    });

    savedCount += taskLoggingResult.savedCount;

    if (!taskLoggingResult.completed) {
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
    const taskLoggingResult = await saveTaskLoggings({
      task,
      updatedAtTimestamp,
      createdToTimestamp,
      startDate,
      endDate,
      maxRetries: FAILED_LOGGING_RETRY_ATTEMPTS
    });

    savedCount += taskLoggingResult.savedCount;

    if (!taskLoggingResult.completed) {
      unresolvedFailedTasks++;
      addLog(
        `Failed to fetch loggings for ${task.name} task after ${FAILED_LOGGING_RETRY_ATTEMPTS} end-of-processing retry attempts.`
      );
    }
  }

  return {
    savedCount,
    unresolvedFailedTasks
  };
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
    var loggingStartDate = startDate;
    var updatedAtTimestamp = dateToUnixTimestamp(loggingStartDate);
  } else if (syncDays) {
    var d = new Date();
    d.setDate(d.getDate() - syncDays);
    var loggingStartDate = d;
    var updatedAtTimestamp = dateToUnixTimestamp(loggingStartDate);
  } else {
    var loggingStartDate = new Date(new Date().getFullYear(), 0, 1);
    var updatedAtTimestamp = current_year_start_date;
  }
  const loggingEndDate = endDate || new Date();
  const createdToTimestamp = dateToUnixTimestamp(
    getCreatedToDateForLoggingFetch(loggingEndDate)
  );
  const projects = await getProjects(userProjectIds);
  addLog(`Loaded ${projects.length} projects for logging synchronization.`);

  if (REDBOOTH_DIRECT_TIME_LOG_SYNC_ENABLED) {
    const directTimeLogSyncResult = await syncTimeLoggingsFromActivities({
      projects,
      startDate: loggingStartDate,
      endDate: loggingEndDate
    });

    addLog(
      `Direct activity sync indexed ${directTimeLogSyncResult.indexedCount} time logging activities and saved ${directTimeLogSyncResult.savedCount} loggings. Scanning task comments to catch entries Redbooth activities can miss.`
    );
  }

  const rbProjectIds = [];
  for (const project of projects) {
    rbProjectIds.push(project.rbProjectId);
  }
  const updatedTasks = await getDatabaseTasksForLoggingSync({
    rbProjectIds,
    updatedAtTimestamp
  });
  addLog(`Loaded ${updatedTasks.length} recently updated tasks for logging synchronization.`);
  let taskScanResult = await syncTaskCommentLoggings({
    tasks: updatedTasks,
    updatedAtTimestamp,
    createdToTimestamp,
    startDate: loggingStartDate,
    endDate: loggingEndDate
  });

  if (!taskScanResult.savedCount) {
    addLog(
      "Recently updated task scan did not save any loggings. Scanning all selected project tasks as a reliability fallback."
    );
    const allProjectTasks = await getDatabaseTasksForLoggingSync({
      rbProjectIds,
      updatedAtTimestamp,
      scanAllProjectTasks: true
    });
    addLog(`Loaded ${allProjectTasks.length} total selected project tasks for fallback logging synchronization.`);
    taskScanResult = await syncTaskCommentLoggings({
      tasks: allProjectTasks,
      updatedAtTimestamp,
      createdToTimestamp,
      startDate: loggingStartDate,
      endDate: loggingEndDate
    });
  }

  if (taskScanResult.unresolvedFailedTasks) {
    addLog(
      `Logging synchronization completed with ${taskScanResult.unresolvedFailedTasks} unresolved failed tasks.`
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
