/**
 * Builds a member list shaped like LeMSIC's own (Full Name, Phone Number, ID_to_email,
 * Local Commitee — no points) for the upload tests: a title row above the headings, people already in the registry, a spelling
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
  // LeMSIC's own headings, with the columns that used to fool the reader placed
  // before the right ones: a phone number before the ID, a standing committee
  // before the local committee (spelt "Commitee", as in the real file).
  const rows = [
    ['LeMSIC members 2026-2027'],
    [],
    ['Timestamp', 'Full Name', 'Phone Number', 'Standing Committee', 'ID_to_email', 'Local Commitee', 'Year'],
    ['2026-10-01', 'Lea Khoury', '+961 3 111 111', 'SCOPH', 'LEM-2341', 'AUB', 'Med 3'],               // same ID: already here
    ['2026-10-01', 'Karim Nasar', 96170222222, 'SCORA', '', 'AUB', ''],                               // close to Karim Nassar: same person
    ['2026-10-02', 'Maya Saad', '+961 71 333 333', 'SCOME', '', 'LeMSIC AUB', ''],                    // same name, same LC: already here
    ['2026-10-02', 'Omar Fakih', '+961 3 444 444', 'SCOPH', 'LEM-3107', 'Saint Joseph University', ''], // same ID: already here
    ['2026-10-03', 'Nour Abou Jaoude', '+961 3 555 555', 'SCORP', 'LEM-4005', 'AUB', ''],             // already here, gets the ID
    ['2026-10-03', 'Jad Mansour', '+961 3 666 666', 'SCOPE', 'LEM-4001', 'LeMSIC-LAU', 'Med 1'],      // new
    ['2026-10-04', 'Tala Hamdan', '+961 3 777 777', 'SCOPH', 'LEM-4002', 'University of Balamand', ''], // new, LC UOB
    ['2026-10-04', 'tala hamdan', '+961 3 777 777', 'SCOPH', 'LEM-4002', 'UOB', ''],                  // listed twice: skipped
    ['2026-10-05', 'Nadim Aoun', '+961 3 888 888', 'SCORA', 'LEM-4003', 'Harvard', ''],               // not an LC: skipped
    ['', '', '', '', '', '', ''],
    ['2026-10-06', 'Rita Salameh', '+961 3 999 999', 'SCOME', 'lem 4004', 'Beirut Arab Uni', ''],     // new, LC BAU
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Members');
  XLSX.writeFile(wb, file);
  return file;
};
