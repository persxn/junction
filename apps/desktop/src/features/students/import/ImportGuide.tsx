import {
  PROGRAM_LABELS,
  STUDENT_IMPORT_FIELDS,
  STUDENT_IMPORT_FIELD_LABELS,
  STUDENT_IMPORT_HEADER_ALIASES,
  STUDENT_IMPORT_MAX_ROWS,
  STUDENT_IMPORT_REQUIRED_FIELDS,
  STUDENT_PROGRAMS,
} from '@compintel/contracts';

import { Guide } from '../../../components/Guide.js';

/**
 * The import's own guide (owner request, 2 Oct 2026): what the import does,
 * the steps, and **the accepted columns** — built from the same alias list the
 * server matches against, so the guide can never promise a heading the
 * importer would ignore.
 */

const FIELD_NOTES: Partial<Record<(typeof STUDENT_IMPORT_FIELDS)[number], string>> = {
  universityId: 'Identifies the student; a roll number already in Junction updates that student.',
  program: `One of ${STUDENT_PROGRAMS.map((program) => PROGRAM_LABELS[program]).join(', ')}. “BE”, “B.E.” and “B Tech” also work.`,
  graduationYear: 'A four-digit year, e.g. 2027.',
  homeDepartment:
    'The department’s name or code. Left empty, a new student joins the managing department.',
  skills:
    'Several, separated by commas or semicolons. Add a level after a colon — 1 Beginner, 2 Intermediate, 3 Advanced: “Python:3, SQL:1”.',
  interests: 'Several, separated by commas or semicolons.',
  phone: 'Imported only while an administrator has switched phone numbers on.',
};

/** "roll no" → "Roll No"; the guide shows headings the way a sheet would. */
const heading = (alias: string): string =>
  alias.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()).replace(/^E Mail/, 'E-mail');

export function ImportGuide(): React.JSX.Element {
  return (
    <Guide id="students-import" title="How importing works, and which columns are read">
      <ol className="list-decimal space-y-1 pl-5">
        <li>
          Choose a <strong>.csv</strong> or <strong>.xlsx</strong> file (Excel’s usual format) of up
          to 700 KB and {STUDENT_IMPORT_MAX_ROWS.toLocaleString('en-IN')} students. Only the first
          sheet is read; the first row must hold the column headings.
        </li>
        <li>
          Junction matches each heading to a field. A heading it does not recognise is shown as{' '}
          <strong>Not imported</strong> — it is never guessed. You can change any match.
        </li>
        <li>
          Every row is checked before anything is saved. Rows with a problem are marked and the
          problem is written next to the value; fix them in the file and choose it again, or import
          the rest without them.
        </li>
        <li>
          <strong>Import</strong> saves the rows without problems. A student who is already here is
          updated; skills and interests in the file are added to theirs, never removed. Nothing is
          saved before that, and an unfinished preview is forgotten after 30 minutes.
        </li>
      </ol>
      <table className="mt-1 w-full border-collapse text-left text-sm">
        <caption className="pb-1 text-left font-medium text-fg">Accepted columns</caption>
        <thead>
          <tr className="border-b border-line text-fg-subtle">
            <th scope="col" className="py-1 pr-3 font-medium">
              Field
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              Headings that are recognised
            </th>
            <th scope="col" className="py-1 font-medium">
              What to put in it
            </th>
          </tr>
        </thead>
        <tbody>
          {STUDENT_IMPORT_FIELDS.map((field) => (
            <tr key={field} className="border-b border-line align-top">
              <th scope="row" className="py-1 pr-3 font-medium text-fg">
                {STUDENT_IMPORT_FIELD_LABELS[field]}
                {STUDENT_IMPORT_REQUIRED_FIELDS.includes(field) && (
                  <span className="block text-xs font-normal text-fg-subtle">required</span>
                )}
              </th>
              <td className="py-1 pr-3">
                {STUDENT_IMPORT_HEADER_ALIASES[field].map(heading).join(', ')}
              </td>
              <td className="py-1">{FIELD_NOTES[field] ?? 'Free text.'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Capital letters, dots and extra spaces in a heading do not matter: “ROLL NO.” is the same as
        “roll no”.
      </p>
    </Guide>
  );
}
