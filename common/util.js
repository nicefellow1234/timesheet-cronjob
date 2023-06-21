const toHoursAndMinutes = (totalMinutes) => {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return { 
        hours, 
        minutes, 
        totalTime: `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`
    };
}

const getLastSundayOfMonth = (month, year) => {
    // Create a new date object for the first day of the next month
    var firstDayOfNextMonth = new Date(year, month - 1 + 1, 1);
    // Subtract one day to get the last day of the current month
    var lastDayOfMonth = new Date(firstDayOfNextMonth - 24 * 60 * 60 * 1000);
    // Find the day of the week for the last day of the month (0 - Sunday, 1 - Monday, etc.)
    var lastDayOfWeek = lastDayOfMonth.getDay();
    // Calculate the number of days to subtract to get the last Sunday
    var daysToSubtract = (lastDayOfWeek + 7 - 0) % 7;
    // Subtract the number of days to get the last Sunday of the month
    var lastSundayOfMonth = new Date(lastDayOfMonth - daysToSubtract * 24 * 60 * 60 * 1000);
    // Set the time to the end of the day (23:59:59)
    lastSundayOfMonth.setHours(23, 59, 59);
    return lastSundayOfMonth;
}

module.exports = {
    toHoursAndMinutes,
    getLastSundayOfMonth
}