// Maximum number of logs to store
const maxLogEntries = 1000;

// Initialize the logs array
let logs = [];

// Function to add a log message with current AM/PM time
const addLog = (message) => {
  // Check if the log array has reached its limit
  if (logs.length >= maxLogEntries) {
    logs.shift(); // Remove the oldest log
  }

  const now = new Date();

  // Helper function to pad numbers with leading zeros
  const pad = (num) => num.toString().padStart(2, "0");

  // Format the date as dd-mm-yyyy
  const day = pad(now.getDate());
  const month = pad(now.getMonth() + 1); // Month is 0-indexed
  const year = now.getFullYear();
  const currentDate = `${day}-${month}-${year}`;

  // Get hours, minutes, seconds and format in 12-hour format with leading zeros
  let hours = now.getHours();
  const minutes = pad(now.getMinutes());
  const seconds = pad(now.getSeconds());
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const currentTime = `${pad(hours)}:${minutes}:${seconds} ${ampm}`;

  // Prepend the timestamp (date and time) to the log message
  const formattedMessage = `[${currentDate} ${currentTime}] - ${message}`;

  // Add the new log message to the array
  logs.push(formattedMessage);

  // Optionally log it to the console as well
  console.log(formattedMessage);
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
