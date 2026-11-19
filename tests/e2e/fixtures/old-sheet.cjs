/**
 * Builds a deliberately messy "old points sheet" for the import tests: a title row
 * above the headings, one person written two ways, a typo, lowercase names, a role
 * in brackets, committees spelled out in full, points stored as text, a row with no
 * points, and a university the app doesn't know.
 *
 * Expected after import, with Lea Khoury (LEM-2341) and Karim Nassar already in the
 * registry: 8 starting balances, 6 new members, 450 points (Lea 84 + 12 merged).
 */
const path = require('path');
const XLSX = require(path.join(__dirname, '..', '..', '..', 'node_modules', 'xlsx'));

module.exports = function writeOldSheet(file) {
  const totals = [
    ['LeMSIC Points 2025-2026'],
    [],
    ['#', 'Student Name', 'ID', 'University', 'Year', 'Total Points', 'Last Activity'],
    [1, 'Lea Khoury', 'LEM-2341', 'AUB', 'Med 3', 84, 'Blood drive'],
    [2, 'L. Khoury', '', 'AUB', '', 12, ''],
    [3, 'Karim Nasar', '', 'AUB', 'Med 2', 38, ''],
    [4, 'nour abou jaoude', '', 'American University of Beirut', '', 26, ''],
    [5, 'Rami Haddad (LO)', '', 'AUB', '', 44, ''],
    [6, 'Elias Rizk', 'LEM-2015', 'USJ', '', '58', ''],
    [7, 'Perla Gemayel', '', 'University of Balamand', '', 63, ''],
    [8, 'Hadi Zein', '', 'LU', '', 74, ''],
    [9, 'Ghost Row', '', 'AUB', '', '', ''],
    [10, 'Sara Itani', '', 'Unknown College', '', 51, ''],
  ];
  const scoph = [['Event', 'Volunteer', 'Points'], ['WDD', 'Lea Khoury', 12], ['Blood drive', 'Karim Nassar', 8]];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(totals), 'TOTALS');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(scoph), 'SCOPH');
  XLSX.writeFile(wb, file);
  return file;
};
