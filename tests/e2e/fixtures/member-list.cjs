/**
 * Builds a member list (names, LeMSIC IDs, LCs — no points) for the upload tests:
 * a title row above the headings, people already in the registry, a spelling
 * variant, someone who is only missing their LeMSIC ID, an LC written out in full,
 * a row listed twice, an unknown university and a blank row.
 *
 * Expected when Lea Khoury (LEM-2341), Karim Nassar (LEM-2502), Maya Saad and
 * Omar Fakih (LEM-3107) are in the registry, and Nour Abou Jaoude (AUB) is there
 * without an ID: 3 new members, 1 ID filled in, 1 similar name treated as the same
 * person, 3 already here, 2 rows skipped.
 */
const path = require('path');
const XLSX = require(path.join(__dirname, '..', '..', '..', 'node_modules', 'xlsx'));

module.exports = function writeMemberList(file) {
  const rows = [
    ['LeMSIC members 2026-2027'],
    [],
    ['Full Name', 'LeMSIC ID', 'LC', 'Year'],
    ['Lea Khoury', 'LEM-2341', 'AUB', 'Med 3'],                 // same ID: already here
    ['Karim Nasar', '', 'AUB', ''],                             // close to Karim Nassar: same person
    ['Maya Saad', '', 'AUB', ''],                               // same name, same LC: already here
    ['Omar Fakih', 'LEM-3107', 'USJ', ''],                      // same ID: already here
    ['Nour Abou Jaoude', 'LEM-4005', 'AUB', ''],                // already here, gets the ID
    ['Jad Mansour', 'LEM-4001', 'LAU', 'Med 1'],                // new
    ['Tala Hamdan', 'LEM-4002', 'University of Balamand', ''],  // new, LC UOB
    ['tala hamdan', 'LEM-4002', 'UOB', ''],                     // listed twice: skipped
    ['Nadim Aoun', 'LEM-4003', 'Harvard', ''],                  // not an LC: skipped
    ['', '', '', ''],
    ['Rita Salameh', 'lem 4004', 'BAU', ''],                    // new
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Members');
  XLSX.writeFile(wb, file);
  return file;
};
