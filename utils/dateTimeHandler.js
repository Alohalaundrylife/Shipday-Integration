function applyOffset(dateString, offsetInSeconds) {
  const hours = Math.floor(Math.abs(offsetInSeconds / 3600));
  const minutes = Math.abs(offsetInSeconds % 3600 / 60);
  const sign = offsetInSeconds >= 0 ? '+' : '-';
  const absHours = Math.abs(hours);
  const gmtFormat = `GMT${sign}${absHours.toString().padStart(2, '0')}${minutes.toString().padStart(2, '0')}`;
  return gmtFormat;
}

async function getTimeZoneFromCoordinates(lat, lng, timestamp) {
  const apiKey = process.env.GOOGLE_API_KEY;
  timestamp = Math.floor(timestamp / 1000);
  console.log(timestamp)
  const timeZoneUrl = `https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lng}&timestamp=${timestamp}&key=${apiKey}`;

  const response = await fetch(timeZoneUrl);
  const data = await response.json();

  if (data.status === 'OK') {
    console.log('timexone is', data)
    return data.rawOffset;
  } else {
    throw new Error('Time zone lookup failed: ' + data.status);
  }
}

module.exports = {
    applyOffset,
    getTimeZoneFromCoordinates
};
  