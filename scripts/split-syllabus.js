const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const sourcePath = path.join(rootDir, 'syllabus.json');
const outputDir = path.join(rootDir, 'data', 'faculty-campus');
const mapPath = path.join(rootDir, 'data', 'faculty-campus-map.ts');
const indexPath = path.join(rootDir, 'data', 'faculty-campus-index.json');

const ALL_FACULTY = '全学部';
const ALL_CAMPUS = '全キャンパス';

const raw = fs.readFileSync(sourcePath, 'utf8');
const data = JSON.parse(raw);

if (!Array.isArray(data)) {
  throw new Error('syllabus.json must be an array.');
}

fs.mkdirSync(outputDir, { recursive: true });

const facultySet = new Set();
const campusSet = new Set();

const normalizeCampus = (value) => {
  if (typeof value !== 'string') {
    return { campuses: [], hasWildcard: false };
  }
  const rawTokens = value.split('/').map((token) => token.trim());
  const campuses = [];
  let hasWildcard = false;
  rawTokens.forEach((token) => {
    if (!token) {
      return;
    }
    if (token === '*') {
      hasWildcard = true;
      return;
    }
    if (!campuses.includes(token)) {
      campuses.push(token);
    }
  });
  return { campuses, hasWildcard };
};

for (const course of data) {
  const faculties = Array.isArray(course.faculties) ? course.faculties : [];
  for (const faculty of faculties) {
    facultySet.add(faculty);
  }
  const { campuses } = normalizeCampus(course.campus);
  campuses.forEach((campus) => campusSet.add(campus));
}

const faculties = Array.from(facultySet).sort((a, b) => a.localeCompare(b, 'ja'));
const campuses = Array.from(campusSet).sort((a, b) => a.localeCompare(b, 'ja'));

const facultyList = [ALL_FACULTY, ...faculties];
const campusList = [ALL_CAMPUS, ...campuses];

const byFacultyCampus = new Map();
const ensureBucket = (faculty, campus) => {
  if (!byFacultyCampus.has(faculty)) {
    byFacultyCampus.set(faculty, new Map());
  }
  const campusMap = byFacultyCampus.get(faculty);
  if (!campusMap.has(campus)) {
    campusMap.set(campus, []);
  }
  return campusMap.get(campus);
};

const addToFacultyCampus = (faculty, campus, course) => {
  ensureBucket(faculty, campus).push(course);
};

const addToAllCampuses = (faculty, course) => {
  campuses.forEach((campus) => addToFacultyCampus(faculty, campus, course));
};

for (const course of data) {
  const faculties = Array.isArray(course.faculties) ? course.faculties : [];
  const { campuses: courseCampuses, hasWildcard } = normalizeCampus(course.campus);

  for (const faculty of faculties) {
    addToFacultyCampus(faculty, ALL_CAMPUS, course);
    if (courseCampuses.length > 0) {
      courseCampuses.forEach((campus) => addToFacultyCampus(faculty, campus, course));
    } else if (hasWildcard) {
      addToAllCampuses(faculty, course);
    }
  }

  addToFacultyCampus(ALL_FACULTY, ALL_CAMPUS, course);
  if (courseCampuses.length > 0) {
    courseCampuses.forEach((campus) => addToFacultyCampus(ALL_FACULTY, campus, course));
  } else if (hasWildcard) {
    addToAllCampuses(ALL_FACULTY, course);
  }
}

const padIndex = (value) => String(value).padStart(3, '0');
const fileMap = {};

facultyList.forEach((faculty, facultyIndex) => {
  fileMap[faculty] = {};
  campusList.forEach((campus, campusIndex) => {
    const fileName = `fc-${padIndex(facultyIndex + 1)}-${padIndex(campusIndex + 1)}.json`;
    fileMap[faculty][campus] = fileName;
    const campusMap = byFacultyCampus.get(faculty);
    const payload = campusMap?.get(campus) ?? [];
    fs.writeFileSync(path.join(outputDir, fileName), JSON.stringify(payload, null, 2), 'utf8');
  });
});

const indexPayload = {
  faculties: facultyList,
  campuses: campusList,
  files: fileMap,
};

fs.writeFileSync(indexPath, JSON.stringify(indexPayload, null, 2), 'utf8');

const mapLines = [];
mapLines.push(`export const facultyList = ${JSON.stringify(facultyList, null, 2)} as const;`);
mapLines.push(`export const campusList = ${JSON.stringify(campusList, null, 2)} as const;`);
mapLines.push('');
mapLines.push('export const facultyCampusLoaders: Record<string, Record<string, () => unknown[]>> = {');
facultyList.forEach((faculty) => {
  mapLines.push(`  ${JSON.stringify(faculty)}: {`);
  campusList.forEach((campus) => {
    const fileName = fileMap[faculty][campus];
    mapLines.push(
      `    ${JSON.stringify(campus)}: () => require("./faculty-campus/${fileName}") as unknown[],`
    );
  });
  mapLines.push('  },');
});
mapLines.push('};');
mapLines.push('');

fs.writeFileSync(mapPath, mapLines.join('\n'), 'utf8');

console.log(
  `Wrote ${facultyList.length * campusList.length} faculty-campus files to ${outputDir}`
);
