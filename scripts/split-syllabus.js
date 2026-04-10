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
const rawData = JSON.parse(raw);
const baseList = Array.isArray(rawData)
  ? rawData
  : Array.isArray(rawData?.selectKogiDtoList)
    ? rawData.selectKogiDtoList
    : null;

if (!baseList) {
  throw new Error('syllabus.json must be an array or include selectKogiDtoList.');
}

fs.mkdirSync(outputDir, { recursive: true });

const facultySet = new Set();
const campusSet = new Set();

const normalizeTerm = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.includes('前期')) {
    return '春セメスター';
  }
  if (trimmed.includes('後期')) {
    return '秋セメスター';
  }
  if (trimmed.includes('通年')) {
    return '通年';
  }
  return trimmed;
};

const normalizeDay = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const noWeekday = trimmed.replace(/曜日|曜/g, '');
  const dayChar = noWeekday.charAt(0);
  if ('月火水木金土日'.includes(dayChar)) {
    return dayChar;
  }
  return null;
};

const normalizePeriod = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  );
  const match = normalized.match(/\d+/);
  if (!match) {
    return null;
  }
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseSchedule = (entry) => {
  const day = normalizeDay(entry.yobi) ?? normalizeDay(entry.daihyoYobiNm);
  const period = normalizePeriod(entry.jigen) ?? normalizePeriod(entry.daihyoJigenNm);
  if (day && period) {
    return { day, period, schedule: `${day}${period}` };
  }
  const jikanwari = typeof entry.jikanwari === 'string' ? entry.jikanwari : '';
  const dayMatch = jikanwari.match(/(月|火|水|木|金|土|日)/);
  const periodMatch = jikanwari.match(/[0-9０-９]+/);
  if (dayMatch && periodMatch) {
    const fallbackDay = dayMatch[1];
    const fallbackPeriod = normalizePeriod(periodMatch[0]);
    if (fallbackDay && fallbackPeriod) {
      return { day: fallbackDay, period: fallbackPeriod, schedule: `${fallbackDay}${fallbackPeriod}` };
    }
  }
  return { day: null, period: null, schedule: jikanwari };
};

const extractFaculty = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/.+?学部/);
  if (match) {
    return match[0];
  }
  const fallback = trimmed.match(/.+?(研究科|学群|学域|学科)/);
  return fallback ? fallback[0] : trimmed;
};

const splitInstructors = (value) => {
  if (typeof value !== 'string') {
    return [];
  }
  return value
    .split(/[、,／/]/)
    .map((name) => name.trim())
    .filter(Boolean);
};

const toCourse = (entry) => {
  const courseCode = Number(entry.kogiCd);
  const { day, period, schedule } = parseSchedule(entry);
  const faculty = extractFaculty(entry.sekininBushoNm);
  const instructors = splitInstructors(entry.tantoKyoin || entry.daihyoKyoinNm);
  return {
    course_codes: Number.isFinite(courseCode) ? [courseCode] : [],
    course_title: entry.kogiNm || entry.gakusokuKamokuNm || '未設定',
    academic_year: Number(entry.kaikoNendo) || 0,
    term: normalizeTerm(entry.kogiKaikojikiNm),
    schedule: schedule || '',
    slots: day && period ? [{ day, period }] : [],
    instructors: instructors.length > 0 ? instructors : ['未設定'],
    credits: 0,
    campus: typeof entry.kochiNm === 'string' ? entry.kochiNm.trim() : '',
    classroom: entry.kBasho || entry.kBiko1 || '未設定',
    is_online: false,
    faculties: faculty ? [faculty] : [],
    url: entry.syllabusUrl || '',
  };
};

const data = baseList.map(toCourse);

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
