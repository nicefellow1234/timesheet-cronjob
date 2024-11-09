// Maximum number of logs to store
const maxLogEntries = 1000;

// Initialize the logs array
let logs = [];

// Function to add a log message
const addLog = (message) => {
  // Check if the log array has reached its limit
  if (logs.length >= maxLogEntries) {
    logs.shift(); // Remove the oldest log
  }

  // Add the new log message to the array
  logs.push(message);

  // Optionally log it to the console as well
  console.log(message);
};

// Example of getting logs
const getLogs = () => {
  return logs;
};

// Example of clearing logs
const clearLogs = () => {
  logs = []; // Empty the log array
};

// Export functions if needed
module.exports = { addLog, getLogs, clearLogs };
