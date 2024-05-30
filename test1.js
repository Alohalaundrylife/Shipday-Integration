let deliveryTime = "03/31/2024 04:00 am".split(' ');

const pacificTime = "05/16/2024 08:30 pm";
const pacificDate = new Date(pacificTime + " GMT-0700");
console.log(pacificDate)
const year = pacificDate.getUTCFullYear();
const month = String(pacificDate.getUTCMonth() + 1).padStart(2, '0'); // Months are zero-based
const day = String(pacificDate.getUTCDate()).padStart(2, '0');

// Extract the time components
const hours = String(pacificDate.getUTCHours()).padStart(2, '0');
const minutes = String(pacificDate.getUTCMinutes()).padStart(2, '0');
const seconds = String(pacificDate.getUTCSeconds()).padStart(2, '0');

// Format date and time strings
const date = `${year}-${month}-${day}`;
const time = `${hours}:${minutes}:${seconds}`;

console.log("Date:", date); // Output the date part
console.log("Time:", time);

// console.log()
// const utcDate = new Date(pacificDate.getTime() + (7 * 60 * 60 * 1000)); // Pacific Daylight Time (PDT) is UTC-7
// console.log(utcDate.getHours() + 7)
// pacificDate.setHours(pacificDate.getHours() + 7);
// console.log(pacificDate.toUTCString());

// Convert Pacific Time to UTC
// console.log(new Date(pacificTime))
// console.log(pacificTime.getTimezoneOffset())
// console.log(pacificTime.getTimezoneOffset()  * 60000)
// const utcTime = new Date(pacificTime.getTime() + pacificTime.getTimezoneOffset() * 60000);

// console.log("UTC Time:", utcTime.toISOString());

// console.log(convertTo24Hour(deliveryTime[1] + " " + deliveryTime[2]))

// deliveryTime = deliveryTime
function convertTo24Hour(time12h) {
    const [time, period] = time12h.split(' ');
  
    let [hours, minutes] = time.split(':');
  
    hours = parseInt(hours);
    minutes = parseInt(minutes);
  
    if (period.toLowerCase() === 'pm' && hours < 12) {
        hours += 12;
    } else if (period.toLowerCase() === 'am' && hours === 12) {
        hours = 0;
    }
  
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
}


// const localDate = parseLocalDateTime("03/31/2024 04:00 am");

// Convert to UTC
// const utcDateString = localDate.toISOString();

// console.log(`Local Date: ${localDate}`);
// console.log(`UTC Date: ${utcDateString}`);

