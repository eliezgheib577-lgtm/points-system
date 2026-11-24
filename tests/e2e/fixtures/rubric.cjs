/**
 * Builds a rubric shaped like LeMSIC's (a title above "Sheet | Type | Points", one
 * row per type, fixed points) for the upload tests: three sections, a row whose
 * points aren't a number, and a type listed twice.
 *
 * Expected: 5 categories in 3 sections, 2 rows skipped.
 */
const path = require('path');
const XLSX = require(path.join(__dirname, '..', '..', '..', 'node_modules', 'xlsx'));

module.exports = function writeRubric(file) {
  const rows = [
    ['Points Rubric'],
    ['Points given per entry for each type, by sheet of the event submission template'],
    [],
    ['Sheet', 'Type', 'Points'],
    ['Activity', 'NatOC Coordinator', 20],
    ['Activity', 'LocOC Coordinator', 15],
    ['Activity', 'Created Poster', 3],
    ['CB', 'Facilitated a session', 5],
    ['CB', 'Joined the training programme', 'two'],   // not a number: skipped
    ['Position', 'LO', 25],
    ['Activity', 'Created Poster', 3],                 // listed twice: skipped
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Rubric');
  XLSX.writeFile(wb, file);
  return file;
};
