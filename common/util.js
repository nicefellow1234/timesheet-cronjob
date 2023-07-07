const toHoursAndMinutes = (totalMinutes) => {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return {
    hours,
    minutes,
    totalTime: `${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`,
  };
};

const getLastSundayOfMonth = (month, year, shiftDays = null) => {
  // Create a new date object for the first day of the next month
  let firstDayOfNextMonth = new Date(year, month - 1 + 1, 1);
  // Subtract one day to get the last day of the current month
  let lastDayOfMonth = new Date(firstDayOfNextMonth - 24 * 60 * 60 * 1000);
  // Find the day of the week for the last day of the month (0 - Sunday, 1 - Monday, etc.)
  let lastDayOfWeek = lastDayOfMonth.getDay();
  // Calculate the number of days to subtract to get the last Sunday
  let daysToSubtract = (lastDayOfWeek + 7 - 0) % 7;
  // Subtract the number of days to get the last Sunday of the month
  let lastSundayOfMonth = new Date(
    lastDayOfMonth - daysToSubtract * 24 * 60 * 60 * 1000
  );
  // Set the time to the end of the day (23:59:59)
  lastSundayOfMonth.setHours(23, 59, 59);
  // Check if shift days is set then shift the date by shift days
  if (shiftDays) {
    lastSundayOfMonth.setDate(lastSundayOfMonth.getDate() + shiftDays);
  }
  return lastSundayOfMonth;
};

const getWeeklyRanges = (startDate, endDate) => {
  const weeklyRanges = [];
  // Adjust the startDate to the nearest Monday
  startDate = new Date(startDate);
  const startDay = startDate.getDay();
  const diff = startDate.getDate() - startDay + (startDay === 0 ? -6 : 1);
  startDate.setDate(diff);
  while (startDate <= endDate) {
    const rangeStart = new Date(startDate);
    rangeStart.setHours(0, 0, 0);
    const rangeEnd = new Date(startDate);
    rangeEnd.setDate(rangeStart.getDate() + 6);
    rangeEnd.setHours(23, 59, 59);
    // Format the dates as strings
    const formattedStart = rangeStart.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const formattedEnd = rangeEnd.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    weeklyRanges.push({
      range: `${formattedStart} to ${formattedEnd}`,
      rangeStart: dateToUnixTimestamp(rangeStart),
      rangeEnd: dateToUnixTimestamp(rangeEnd),
    });
    // Increment startDate for the next week
    startDate.setDate(startDate.getDate() + 7);
  }
  return weeklyRanges;
};

const dateToUnixTimestamp = (date) => {
  return Math.floor(date.valueOf() / 1000);
};

const unixTimestampToDate = (timestamp) => {
  return new Date(timestamp * 1000);
};

module.exports = {
  toHoursAndMinutes,
  getLastSundayOfMonth,
  getWeeklyRanges,
  dateToUnixTimestamp,
  unixTimestampToDate,
};
