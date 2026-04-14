import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useState } from 'react';
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  campusList,
  facultyCampusLoaders,
  facultyList,
} from '../../data/faculty-campus-map';

type CourseSlot = {
  day: string;
  period: number | null;
};

type Course = {
  course_codes: number[];
  course_title: string;
  academic_year: number;
  term: string;
  schedule: string;
  slots: CourseSlot[];
  instructors: string[];
  credits: number;
  campus: string;
  classroom: string;
  is_online: boolean;
  faculties: string[];
  url: string;
};

type DayKey = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
type Period = 1 | 2 | 3 | 4 | 5 | 6 | 7;

type Timetable = Record<DayKey, Record<Period, Course | null>>;
type CellRef = { day: DayKey; period: Period };

type TermOption = '春セメスター' | '秋セメスター';

type Settings = {
  faculty: string;
  campus: string;
  academicYear: number;
  term: TermOption;
  includeWeekend: boolean;
  maxPeriod: Period;
};

const dayKeysAll: DayKey[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const periodKeysAll: Period[] = [1, 2, 3, 4, 5, 6, 7];
const storageKey = 'timetable:v1';
const settingsKey = 'timetable:settings:v1';
const colorKey = 'timetable:colors:v1';

const dayToJp: Record<DayKey, string> = {
  Mon: '月',
  Tue: '火',
  Wed: '水',
  Thu: '木',
  Fri: '金',
  Sat: '土',
  Sun: '日',
};

const jpToDay: Record<string, DayKey> = {
  月: 'Mon',
  火: 'Tue',
  水: 'Wed',
  木: 'Thu',
  金: 'Fri',
  土: 'Sat',
  日: 'Sun',
};

const normalizeTermLabel = (value?: string | null): TermOption | '通年' | string => {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed === '前期' || trimmed === '春学期' || trimmed === '春') {
    return '春セメスター';
  }
  if (trimmed === '1学期' || trimmed === '１学期') {
    return '春セメスター';
  }
  if (trimmed === '後期' || trimmed === '秋学期' || trimmed === '秋') {
    return '秋セメスター';
  }
  if (trimmed === '2学期' || trimmed === '２学期') {
    return '秋セメスター';
  }
  if (trimmed.includes('前期')) {
    return '春セメスター';
  }
  if (trimmed.includes('1学期') || trimmed.includes('１学期')) {
    return '春セメスター';
  }
  if (trimmed.includes('後期')) {
    return '秋セメスター';
  }
  if (trimmed.includes('2学期') || trimmed.includes('２学期')) {
    return '秋セメスター';
  }
  if (trimmed === '通年') {
    return '通年';
  }
  return trimmed;
};

const normalizeSlotDay = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const noWeekday = trimmed.replace(/曜日|曜/g, '');
  const dayChar = noWeekday.charAt(0);
  if (dayToJp.Mon === dayChar || dayToJp.Tue === dayChar || dayToJp.Wed === dayChar) {
    return dayChar;
  }
  if (dayToJp.Thu === dayChar || dayToJp.Fri === dayChar || dayToJp.Sat === dayChar) {
    return dayChar;
  }
  if (dayToJp.Sun === dayChar) {
    return dayChar;
  }
  const englishMap: Record<string, string> = {
    Mon: '月',
    Tue: '火',
    Wed: '水',
    Thu: '木',
    Fri: '金',
    Sat: '土',
    Sun: '日',
  };
  return englishMap[trimmed] ?? noWeekday;
};

const normalizeSlotPeriod = (value: unknown): number | null => {
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

const extractScheduleSlot = (value?: string | null): CourseSlot | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const dayMatch = trimmed.match(/(月|火|水|木|金|土|日)/);
  const periodMatch = trimmed.match(/[0-9０-９]+/);
  if (!dayMatch || !periodMatch) {
    return null;
  }
  const day = normalizeSlotDay(dayMatch[1]);
  const period = normalizeSlotPeriod(periodMatch[0]);
  if (!day || !period) {
    return null;
  }
  return { day, period };
};

const defaultSettings: Settings = {
  faculty: '全学部',
  campus: '全キャンパス',
  academicYear: 2026,
  term: '春セメスター',
  includeWeekend: false,
  maxPeriod: 6,
};

const periodTimes: Record<Period, string> = {
  1: '8:50-10:25',
  2: '10:30-12:00',
  3: '13:00-14:30',
  4: '14:40-16:10',
  5: '16:20-17:50',
  6: '18:00-19:30',
  7: '19:40-21:10',
};

const campusAliasGroups: string[][] = [
  ['朝倉キャンパス', '永国寺キャンパス'],
  ['岡豊キャンパス', '池キャンパス'],
];

const getEquivalentCampuses = (campus: string): string[] => {
  if (!campus) {
    return [];
  }
  const group = campusAliasGroups.find((pair) => pair.includes(campus));
  if (!group) {
    return [campus];
  }
  return [...group];
};

const hasMatchingCampusCourse = (courses: Course[], campus: string): boolean => {
  if (campus === '全キャンパス') {
    return courses.length > 0;
  }
  const targets = getEquivalentCampuses(campus);
  return courses.some((course) => {
    const campusValue = (course.campus ?? '').trim();
    if (!campusValue) {
      return false;
    }
    if (campusValue === '*') {
      return true;
    }
    const tokens = campusValue.split('/').map((token) => token.trim()).filter(Boolean);
    if (tokens.length > 0) {
      return tokens.some((token) => targets.includes(token));
    }
    return targets.includes(campusValue);
  });
};

const pastelColors = [
  { name: 'Sky', value: '#CFE8FF' },
  { name: 'Mint', value: '#CFF5E7' },
  { name: 'Lavender', value: '#E6D9FF' },
  { name: 'Peach', value: '#FFD9C7' },
  { name: 'Butter', value: '#FFF1B8' },
  { name: 'Rose', value: '#F9D3E4' },
];

const hitSlopSmall = { top: 6, bottom: 6, left: 6, right: 6 };
const hitSlopMedium = { top: 10, bottom: 10, left: 10, right: 10 };

const createEmptyTable = (): Timetable => {
  return dayKeysAll.reduce((acc, day) => {
    acc[day] = { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null };
    return acc;
  }, {} as Timetable);
};

const normalizeTable = (input: unknown): Timetable => {
  const base = createEmptyTable();
  if (!input || typeof input !== 'object') {
    return base;
  }
  for (const day of dayKeysAll) {
    const dayValue = (input as Timetable)[day];
    if (!dayValue || typeof dayValue !== 'object') {
      continue;
    }
    for (const period of periodKeysAll) {
      const cell = (dayValue as Record<Period, Course | null>)[period];
      if (cell && typeof cell === 'object') {
        base[day][period] = cell as Course;
      }
    }
  }
  return base;
};


const makeTableKey = (term: TermOption, year: number) =>
  `${storageKey}:${year}:${term}`;
const makeColorKey = (term: TermOption, year: number) =>
  `${colorKey}:${year}:${term}`;

const loadStoredTable = async (key: string) => {
  if (Platform.OS === 'web') {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }
  const raw = await AsyncStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
};

const saveStoredTable = async (key: string, table: Timetable) => {
  const payload = JSON.stringify(table);
  if (Platform.OS === 'web') {
    window.localStorage.setItem(key, payload);
    return;
  }
  await AsyncStorage.setItem(key, payload);
};

const loadStoredSettings = async () => {
  if (Platform.OS === 'web') {
    const raw = window.localStorage.getItem(settingsKey);
    return raw ? JSON.parse(raw) : null;
  }
  const raw = await AsyncStorage.getItem(settingsKey);
  return raw ? JSON.parse(raw) : null;
};

const saveStoredSettings = async (settings: Settings) => {
  const payload = JSON.stringify(settings);
  if (Platform.OS === 'web') {
    window.localStorage.setItem(settingsKey, payload);
    return;
  }
  await AsyncStorage.setItem(settingsKey, payload);
};

const loadStoredColors = async (key: string) => {
  if (Platform.OS === 'web') {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }
  const raw = await AsyncStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
};

const saveStoredColors = async (key: string, colorMap: Record<string, string>) => {
  const payload = JSON.stringify(colorMap);
  if (Platform.OS === 'web') {
    window.localStorage.setItem(key, payload);
    return;
  }
  await AsyncStorage.setItem(key, payload);
};

const loadLocalCourses = (faculty: string, campus: string): Course[] => {
  const facultyMap =
    facultyCampusLoaders[faculty] ?? facultyCampusLoaders['全学部'];
  const equivalentCampuses = getEquivalentCampuses(campus);
  const loader =
    // Prefer all-campus payload and let UI filter by campus to avoid alias/file mismatch issues.
    facultyMap?.['全キャンパス'] ??
    facultyMap?.[campus] ??
    equivalentCampuses.map((name) => facultyMap?.[name]).find(Boolean) ??
    facultyMap?.['全キャンパス'];
  if (!loader) {
    return [];
  }
  const data = loader();
  return Array.isArray(data) ? (data as Course[]) : [];
};

export default function HomeScreen() {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [table, setTable] = useState<Timetable>(() => createEmptyTable());
  const [openCell, setOpenCell] = useState<CellRef | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [facultyOptions] = useState<string[]>(() => [...facultyList]);
  const [campusOptions] = useState<string[]>(() => [...campusList]);
  const [colorMap, setColorMap] = useState<Record<string, string>>({});
  const [selectedColor, setSelectedColor] = useState(pastelColors[0].value);
  const [classroomDraft, setClassroomDraft] = useState('');
  const [creditsDraft, setCreditsDraft] = useState('');
  const [customTitleDraft, setCustomTitleDraft] = useState('');
  const [customInstructorDraft, setCustomInstructorDraft] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const [tableKey, setTableKey] = useState(() =>
    makeTableKey(defaultSettings.term, defaultSettings.academicYear)
  );
  const [colorsStorageKey, setColorsStorageKey] = useState(() =>
    makeColorKey(defaultSettings.term, defaultSettings.academicYear)
  );

  useEffect(() => {
    const hydrate = async () => {
      try {
        const storedSettings = await loadStoredSettings();
        const nextSettings = storedSettings
          ? { ...defaultSettings, ...storedSettings }
          : defaultSettings;
        const normalizedSettings: Settings = {
          ...nextSettings,
          faculty: facultyList.includes(nextSettings.faculty)
            ? nextSettings.faculty
            : defaultSettings.faculty,
          campus: campusList.includes(nextSettings.campus)
            ? nextSettings.campus
            : defaultSettings.campus,
          term:
            nextSettings.term === '春セメスター' || nextSettings.term === '秋セメスター'
              ? nextSettings.term
              : defaultSettings.term,
          maxPeriod: periodKeysAll.includes(nextSettings.maxPeriod)
            ? nextSettings.maxPeriod
            : defaultSettings.maxPeriod,
        };
        setSettings(normalizedSettings);
        const nextTableKey = makeTableKey(
          normalizedSettings.term,
          normalizedSettings.academicYear
        );
        const nextColorsKey = makeColorKey(
          normalizedSettings.term,
          normalizedSettings.academicYear
        );
        setTableKey(nextTableKey);
        setColorsStorageKey(nextColorsKey);
        const [storedTable, storedColors] = await Promise.all([
          loadStoredTable(nextTableKey),
          loadStoredColors(nextColorsKey),
        ]);
        if (storedTable) {
          setTable(normalizeTable(storedTable));
        }
        if (storedColors && typeof storedColors === 'object') {
          setColorMap(storedColors as Record<string, string>);
        }
      } catch (err) {
        setTable(createEmptyTable());
      } finally {
        setHydrated(true);
      }
    };

    hydrate();
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    saveStoredTable(tableKey, table).catch(() => undefined);
  }, [hydrated, table, tableKey]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    saveStoredSettings(settings).catch(() => undefined);
  }, [hydrated, settings]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    saveStoredColors(colorsStorageKey, colorMap).catch(() => undefined);
  }, [hydrated, colorMap, colorsStorageKey]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const nextTableKey = makeTableKey(settings.term, settings.academicYear);
    const nextColorsKey = makeColorKey(settings.term, settings.academicYear);
    if (nextTableKey === tableKey && nextColorsKey === colorsStorageKey) {
      return;
    }
    const switchTermData = async () => {
      try {
        await Promise.all([
          saveStoredTable(tableKey, table),
          saveStoredColors(colorsStorageKey, colorMap),
        ]);
        const [storedTable, storedColors] = await Promise.all([
          loadStoredTable(nextTableKey),
          loadStoredColors(nextColorsKey),
        ]);
        setTable(storedTable ? normalizeTable(storedTable) : createEmptyTable());
        setColorMap(
          storedColors && typeof storedColors === 'object'
            ? (storedColors as Record<string, string>)
            : {}
        );
        setOpenCell(null);
      } catch (err) {
        setTable(createEmptyTable());
        setColorMap({});
      } finally {
        setTableKey(nextTableKey);
        setColorsStorageKey(nextColorsKey);
      }
    };

    switchTermData();
  }, [
    hydrated,
    settings.term,
    settings.academicYear,
    tableKey,
    colorsStorageKey,
    table,
    colorMap,
  ]);

  useEffect(() => {
    if (!openCell) {
      return;
    }
    const current = table[openCell.day][openCell.period];
    if (current?.url && colorMap[current.url]) {
      setSelectedColor(colorMap[current.url]);
    } else {
      setSelectedColor(pastelColors[0].value);
    }
  }, [openCell, table, colorMap]);

  useEffect(() => {
    if (!openCell) {
      return;
    }

    const fetchCourses = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            faculty: settings.faculty,
            academic_year: settings.academicYear,
            term: settings.term,
            day: dayToJp[openCell.day],
            period: openCell.period,
          }),
        });
        if (!response.ok) {
          throw new Error('Request failed');
        }
        const data = await response.json();
        if (Array.isArray(data)) {
          const nextCourses = data as Course[];
          if (nextCourses.length > 0 && hasMatchingCampusCourse(nextCourses, settings.campus)) {
            setCourses(nextCourses);
          } else {
            const fallback = loadLocalCourses(settings.faculty, settings.campus);
            setCourses(fallback);
            setError('API結果に必要な授業が含まれないため、ローカルデータを表示しています。');
          }
        } else if (data && Array.isArray((data as { data: Course[] }).data)) {
          const nextCourses = (data as { data: Course[] }).data;
          if (nextCourses.length > 0 && hasMatchingCampusCourse(nextCourses, settings.campus)) {
            setCourses(nextCourses);
          } else {
            const fallback = loadLocalCourses(settings.faculty, settings.campus);
            setCourses(fallback);
            setError('API結果に必要な授業が含まれないため、ローカルデータを表示しています。');
          }
        } else {
          const fallback = loadLocalCourses(settings.faculty, settings.campus);
          setCourses(fallback);
          setError('APIレスポンス形式が不正のため、ローカルデータを表示しています。');
        }
      } catch (err) {
        const fallback = loadLocalCourses(settings.faculty, settings.campus);
        setCourses(fallback);
        setError('APIに接続できなかったため、ローカルデータを表示しています。');
      } finally {
        setLoading(false);
      }
    };

    fetchCourses();
  }, [openCell, settings]);

  const selectedCourse = useMemo(() => {
    if (!openCell) {
      return null;
    }
    return table[openCell.day][openCell.period];
  }, [openCell, table]);

  useEffect(() => {
    if (!openCell) {
      setClassroomDraft('');
      setCreditsDraft('');
      setCustomTitleDraft('');
      setCustomInstructorDraft('');
      setCustomError(null);
      return;
    }
    setClassroomDraft(selectedCourse?.classroom ?? '');
    setCreditsDraft(
      selectedCourse && Number.isFinite(selectedCourse.credits)
        ? String(selectedCourse.credits)
        : ''
    );
  }, [openCell, selectedCourse]);

  const handleSelectCourse = (course: Course) => {
    if (!openCell) {
      return;
    }
    setTable((prev) => ({
      ...prev,
      [openCell.day]: {
        ...prev[openCell.day],
        [openCell.period]: course,
      },
    }));
    setColorMap((prev) => ({
      ...prev,
      [course.url]: selectedColor,
    }));
    setClassroomDraft(course.classroom ?? '');
    setCreditsDraft(Number.isFinite(course.credits) ? String(course.credits) : '');
    setCustomTitleDraft('');
    setCustomInstructorDraft('');
    setCustomError(null);
    setOpenCell(null);
  };

  const handleCreateCustomCourse = () => {
    if (!openCell) {
      return;
    }
    const title = customTitleDraft.trim();
    if (!title) {
      setCustomError('授業名を入力してください。');
      return;
    }

    const instructor = customInstructorDraft.trim();
    const customCourse: Course = {
      course_codes: [],
      course_title: title,
      academic_year: settings.academicYear,
      term: settings.term,
      schedule: `${dayToJp[openCell.day]}${openCell.period}`,
      slots: [{ day: dayToJp[openCell.day], period: openCell.period }],
      instructors: instructor ? [instructor] : ['未設定'],
      credits: 0,
      campus: settings.campus === '全キャンパス' ? '' : settings.campus,
      classroom: '未設定',
      is_online: false,
      faculties: settings.faculty === '全学部' ? [] : [settings.faculty],
      url: `custom://${settings.academicYear}/${settings.term}/${openCell.day}-${openCell.period}/${Date.now()}`,
    };

    handleSelectCourse(customCourse);
  };

  const handleClassroomChange = (value: string) => {
    setClassroomDraft(value);
    if (!openCell) {
      return;
    }
    setTable((prev) => {
      const current = prev[openCell.day][openCell.period];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [openCell.day]: {
          ...prev[openCell.day],
          [openCell.period]: {
            ...current,
            classroom: value,
          },
        },
      };
    });
  };

  const handleCreditsChange = (value: string) => {
    setCreditsDraft(value);
    if (!openCell) {
      return;
    }
    const parsed = Number(value);
    const nextCredits = Number.isFinite(parsed) ? parsed : 0;
    setTable((prev) => {
      const current = prev[openCell.day][openCell.period];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [openCell.day]: {
          ...prev[openCell.day],
          [openCell.period]: {
            ...current,
            credits: nextCredits,
          },
        },
      };
    });
  };

  const handleClearCell = () => {
    if (!openCell) {
      return;
    }
    setTable((prev) => ({
      ...prev,
      [openCell.day]: {
        ...prev[openCell.day],
        [openCell.period]: null,
      },
    }));
    // Keep the modal open so the course list is visible again.
  };

  const handleReset = () => {
    setTable(createEmptyTable());
  };

  const formatInstructors = (course: Course) => {
    return course.instructors.join(', ') || 'TBA';
  };

  const formatSchedule = (course: Course) => {
    const slots = Array.isArray(course.slots) ? course.slots : [];
    const slot = slots.find((item) => item.day && item.period);
    const scheduleFallback = extractScheduleSlot(course.schedule);
    const slotDay = normalizeSlotDay(slot?.day) ?? scheduleFallback?.day ?? null;
    const slotPeriod =
      normalizeSlotPeriod(slot?.period) ??
      normalizeSlotPeriod(scheduleFallback?.period) ??
      null;
    if (!slotDay || !slotPeriod) {
      return course.schedule || 'Flexible';
    }
    const day = jpToDay[slotDay] ?? slotDay;
    const dayLabel = typeof day === 'string' ? day : '';
    return `${dayLabel} P${slotPeriod}`;
  };

  const openSyllabus = () => {
    if (selectedCourse?.url) {
      Linking.openURL(selectedCourse.url).catch(() => undefined);
    }
  };

  const openCourseSyllabus = (course?: Course | null) => {
    if (course?.url) {
      Linking.openURL(course.url).catch(() => undefined);
    }
  };

  const termTitle = settings.term.replace('セメスター', '学期');
  const todayIndex = new Date().getDay();
  const todayKey: DayKey | null =
    todayIndex === 0
      ? 'Sun'
      : todayIndex === 1
        ? 'Mon'
        : todayIndex === 2
          ? 'Tue'
          : todayIndex === 3
            ? 'Wed'
            : todayIndex === 4
              ? 'Thu'
              : todayIndex === 5
                ? 'Fri'
                : 'Sat';

  const getCourseColor = (course?: Course | null) => {
    if (!course) {
      return '#FFFFFF';
    }
    return colorMap[course.url] ?? pastelColors[0].value;
  };

  const dayKeys = settings.includeWeekend
    ? dayKeysAll
    : (dayKeysAll.slice(0, 5) as DayKey[]);
  const periodKeys = periodKeysAll.slice(0, settings.maxPeriod);

  const gridGap = dayKeys.length > 5 ? 4 : 5;
  const periodWidth = dayKeys.length > 5 ? 32 : 40;
  const contentPadding = 4 * 2;
  const cardPadding = 0;
  const availableWidth = Math.max(0, windowWidth - contentPadding - cardPadding);
  const cellWidthRaw =
    (availableWidth - periodWidth - gridGap * dayKeys.length) / dayKeys.length;
  const cellWidth = Math.max(20, Math.floor(cellWidthRaw));
  const isCompact = cellWidth < 70;
  const visiblePeriods = Math.min(periodKeys.length, 6);
  const rowCount = visiblePeriods + 1;
  const availableHeight = Math.max(0, windowHeight - 320);
  const rowHeightRaw = Math.floor((availableHeight - gridGap * rowCount) / rowCount);
  const rowHeight = Math.max(30, Math.min(56, rowHeightRaw));

  const filteredCourses = useMemo(() => {
    const slotDay = openCell ? dayToJp[openCell.day] : null;
    return courses.filter((course) => {
      const normalizedTerm = normalizeTermLabel(course.term);
      const matchesFaculty =
        settings.faculty === '全学部' || course.faculties.includes(settings.faculty);
      const campusValue = course.campus ?? '';
      const campusTokens = campusValue.split('/').map((token) => token.trim()).filter(Boolean);
      const targetCampuses = getEquivalentCampuses(settings.campus);
      const hasCampusMatch =
        campusTokens.length > 0
          ? campusTokens.some((token) => targetCampuses.includes(token))
          : targetCampuses.includes(campusValue);
      const matchesCampus =
        settings.campus === '全キャンパス' ||
        hasCampusMatch ||
        campusValue === '*';
      const matchesYear = course.academic_year === settings.academicYear;
      const matchesTerm =
        normalizedTerm === settings.term || normalizedTerm === '通年';
      const matchesSlot = openCell
        ? (() => {
            const slots = Array.isArray(course.slots) ? course.slots : [];
            if (slots.length === 0 && course.schedule) {
              const fallbackSlot = extractScheduleSlot(course.schedule);
              return (
                fallbackSlot?.day === slotDay &&
                fallbackSlot?.period === openCell.period
              );
            }
            return slots.some((slot) => {
              const day = normalizeSlotDay(slot.day);
              const period = normalizeSlotPeriod(slot.period);
              return day === slotDay && period === openCell.period;
            });
          })()
        : true;
      return matchesFaculty && matchesCampus && matchesYear && matchesTerm && matchesSlot;
    });
  }, [courses, openCell, settings]);

  const totalCredits = useMemo(() => {
    const seen = new Set<string>();
    let total = 0;
    dayKeysAll.forEach((day) => {
      periodKeysAll.forEach((period) => {
        const course = table[day][period];
        if (!course) {
          return;
        }
        const key = course.url || `${day}-${period}`;
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        const credits = Number(course.credits) || 0;
        total += credits;
      });
    });
    return total;
  }, [table]);

  const toggleWeekend = () => {
    setSettings((prev) => ({ ...prev, includeWeekend: !prev.includeWeekend }));
  };

  const updateMaxPeriod = (value: Period) => {
    setSettings((prev) => ({ ...prev, maxPeriod: value }));
  };

  const updateTerm = (value: TermOption) => {
    setSettings((prev) => ({ ...prev, term: value }));
  };

  const updateYear = (value: number) => {
    setSettings((prev) => ({ ...prev, academicYear: value }));
  };

  const updateFaculty = (value: string) => {
    setSettings((prev) => ({ ...prev, faculty: value }));
  };

  const updateCampus = (value: string) => {
    setSettings((prev) => ({ ...prev, campus: value }));
  };

  const updateSelectedColor = (value: string) => {
    setSelectedColor(value);
    if (selectedCourse) {
      setColorMap((prev) => ({
        ...prev,
        [selectedCourse.url]: value,
      }));
    }
  };

  const isAutumnTerm = settings.term === '秋セメスター';

  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.topHeader}>
          <Text style={[styles.termTitle, isAutumnTerm ? styles.termTitleAutumn : null]}>
            {termTitle}
          </Text>
          <Text style={[styles.termSubtitle, isAutumnTerm ? styles.termSubtitleAutumn : null]}>
            2026
          </Text>
        </View>

        <View style={styles.card}>
          <ScrollView
            style={styles.gridScroll}
            contentContainerStyle={[styles.grid, { gap: gridGap }]}
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.row, { gap: gridGap }]}
            >
              <View
                style={[
                  styles.corner,
                  styles.headerCell,
                  { width: periodWidth, height: rowHeight },
                ]}
              />
              {dayKeys.map((day) => (
                <View
                  key={day}
                  style={[
                    styles.headerCell,
                    styles.dayCell,
                    { width: cellWidth, height: rowHeight },
                  ]}
                >
                  <View
                    style={
                      todayKey === day
                        ? styles.todayCircle
                        : styles.todayCircleMuted
                    }
                  >
                    <Text
                      style={[
                        styles.dayText,
                        isCompact ? styles.dayTextCompact : null,
                        todayKey === day ? styles.todayTextActive : null,
                      ]}
                    >
                      {dayToJp[day]}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
            {periodKeys.map((period) => (
              <View key={period} style={[styles.row, { gap: gridGap }]}
              >
                <View
                  style={[
                    styles.periodCell,
                    styles.headerCell,
                    { width: periodWidth, height: rowHeight },
                  ]}
                >
                  <Text style={[styles.periodText, isCompact ? styles.periodTextCompact : null]}>
                    {period}限
                  </Text>
                  <Text style={styles.periodTime}>{periodTimes[period]}</Text>
                </View>
                {dayKeys.map((day) => {
                  const course = table[day][period];
                  return (
                    <View
                      key={`${day}-${period}`}
                      style={[
                        styles.courseCell,
                        {
                          width: cellWidth,
                          height: rowHeight,
                          padding: isCompact ? 4 : 8,
                        },
                        course
                          ? [styles.courseFilled, { backgroundColor: getCourseColor(course) }]
                          : null,
                      ]}
                    >
                      <Pressable
                        style={styles.courseMain}
                        onPress={() => setOpenCell({ day, period })}
                        hitSlop={hitSlopMedium}
                        pressRetentionOffset={hitSlopMedium}
                      >
                        <Text
                          style={[styles.courseTitle, isCompact ? styles.courseTitleCompact : null]}
                          numberOfLines={3}
                        >
                          {course ? course.course_title : ''}
                        </Text>
                        <Text
                          style={[
                            styles.courseMeta,
                            isCompact ? styles.courseMetaCompact : null,
                            course ? styles.classroomText : styles.courseMetaHint,
                          ]}
                          numberOfLines={2}
                        >
                          {course ? `教室: ${course.classroom}` : ''}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </View>

        <View style={styles.headerActions}>
          <Pressable
            style={styles.settingsButton}
            onPress={() => setSettingsOpen(true)}
            hitSlop={hitSlopSmall}
          >
            <Ionicons name="settings" size={18} color="#FFFFFF" />
            <Text style={styles.settingsText}>設定</Text>
          </Pressable>
        </View>
      </View>

      <Modal visible={!!openCell} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalKicker}>Select course</Text>
                <Text style={styles.modalTitle}>
                  {openCell ? dayToJp[openCell.day] : ''} {openCell?.period}限
                </Text>
              </View>
              <Pressable style={styles.modalClose} onPress={() => setOpenCell(null)}>
                <Text style={styles.modalCloseText}>閉じる</Text>
              </Pressable>
            </View>

            {selectedCourse ? (
              <View style={styles.selectedCourseCard}>
                <Text style={styles.selectedCourseLabel}>現在の登録</Text>
                <Text style={styles.selectedCourseTitle}>{selectedCourse.course_title}</Text>
                <Text style={styles.selectedCourseMeta}>
                  教室: {selectedCourse.classroom || '未設定'}
                </Text>
              </View>
            ) : null}

            <View style={styles.colorPicker}>
              <Text style={styles.colorLabel}>カードカラー</Text>
              <View style={styles.colorRow}>
                {pastelColors.map((color) => (
                  <Pressable
                    key={color.value}
                    style={[
                      styles.colorChip,
                      { backgroundColor: color.value },
                      selectedColor === color.value ? styles.colorChipActive : null,
                    ]}
                    onPress={() => updateSelectedColor(color.value)}
                    hitSlop={hitSlopSmall}
                  />
                ))}
              </View>
            </View>

            {selectedCourse ? (
              <View style={styles.classroomInputCard}>
                <Text style={styles.classroomInputLabel}>教室</Text>
                <TextInput
                  style={styles.classroomInput}
                  placeholder="教室を入力"
                  placeholderTextColor="#94A3B8"
                  value={classroomDraft}
                  onChangeText={handleClassroomChange}
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="done"
                />
              </View>
            ) : null}

            {selectedCourse ? (
              <View style={styles.classroomInputCard}>
                <Text style={styles.classroomInputLabel}>単位数</Text>
                <TextInput
                  style={styles.classroomInput}
                  placeholder="単位数を入力"
                  placeholderTextColor="#94A3B8"
                  value={creditsDraft}
                  onChangeText={handleCreditsChange}
                  keyboardType="numeric"
                  autoCorrect={false}
                  returnKeyType="done"
                />
              </View>
            ) : null}

            {selectedCourse ? (
              <View style={styles.selectedActions}>
                <Pressable
                  style={styles.inlineSyllabus}
                  onPress={openSyllabus}
                  hitSlop={hitSlopSmall}
                >
                  <Text style={styles.inlineSyllabusText}>シラバスを見る</Text>
                </Pressable>
                <Pressable
                  style={styles.clearSelectedButton}
                  onPress={handleClearCell}
                  hitSlop={hitSlopSmall}
                >
                  <Text style={styles.clearSelectedText}>この枠を削除</Text>
                </Pressable>
              </View>
            ) : null}

            {!selectedCourse ? (
              <View style={styles.customCourseCard}>
                <Text style={styles.customCourseTitle}>見つからない授業を手入力</Text>
                <TextInput
                  style={styles.customCourseInput}
                  placeholder="授業名を入力"
                  placeholderTextColor="#94A3B8"
                  value={customTitleDraft}
                  onChangeText={(value) => {
                    setCustomTitleDraft(value);
                    if (customError) {
                      setCustomError(null);
                    }
                  }}
                  autoCorrect={false}
                  returnKeyType="next"
                />
                <TextInput
                  style={styles.customCourseInput}
                  placeholder="担当教員（任意）"
                  placeholderTextColor="#94A3B8"
                  value={customInstructorDraft}
                  onChangeText={setCustomInstructorDraft}
                  autoCorrect={false}
                  returnKeyType="done"
                />
                {customError ? (
                  <Text style={styles.customCourseError}>{customError}</Text>
                ) : null}
                <Pressable
                  style={styles.customCourseSubmit}
                  onPress={handleCreateCustomCourse}
                  hitSlop={hitSlopSmall}
                >
                  <Text style={styles.customCourseSubmitText}>この授業を登録</Text>
                </Pressable>
              </View>
            ) : null}

            {!selectedCourse && loading ? (
              <View style={styles.stateBox}>
                <Text style={styles.stateText}>読み込み中...</Text>
              </View>
            ) : null}

            {!selectedCourse && !loading && filteredCourses.length === 0 ? (
              <View style={styles.stateBox}>
                <Text style={styles.stateText}>授業が取得できませんでした。</Text>
              </View>
            ) : null}

            {!selectedCourse ? (
              <ScrollView
                style={styles.courseList}
                contentContainerStyle={styles.courseListContent}
              >
                {filteredCourses.map((course) => (
                  <View
                    key={course.url}
                    style={styles.courseCard}
                  >
                    <View style={styles.courseCardHeader}>
                      <View
                        style={[
                          styles.courseColorDot,
                          { backgroundColor: getCourseColor(course) },
                        ]}
                      />
                      <Text style={styles.courseCardTitle}>{course.course_title}</Text>
                    </View>
                    <Text style={styles.courseCardMeta}>{formatInstructors(course)}</Text>
                    <Text style={styles.courseCardMeta}>
                      {normalizeTermLabel(course.term)} · {formatSchedule(course)}
                    </Text>
                    <View style={styles.chipRow}>
                      <View style={styles.chip}>
                        <Text style={styles.chipText}>{course.credits} credits</Text>
                      </View>
                      <View style={styles.chip}>
                        <Text style={styles.chipText}>
                          {course.is_online ? 'Online' : 'On campus'}
                        </Text>
                      </View>
                      <Pressable
                        style={styles.syllabusInlineChip}
                        onPressIn={(event) => event.stopPropagation?.()}
                        onPress={(event) => {
                          event.stopPropagation?.();
                          openCourseSyllabus(course);
                        }}
                        hitSlop={hitSlopSmall}
                      >
                        <Text style={styles.syllabusInlineText}>シラバス</Text>
                      </Pressable>
                      <Pressable
                        style={styles.registerChip}
                        onPress={() => handleSelectCourse(course)}
                        hitSlop={hitSlopSmall}
                      >
                        <Text style={styles.registerChipText}>登録</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </ScrollView>
            ) : null}

          </View>
        </View>
      </Modal>

      <Modal visible={settingsOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.settingsCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalKicker}>Settings</Text>
                <View style={styles.modalTitleRow}>
                  <Ionicons name="settings" size={18} color="#0F172A" />
                  <Text style={styles.modalTitle}>表示設定</Text>
                </View>
              </View>
              <Pressable style={styles.modalClose} onPress={() => setSettingsOpen(false)}>
                <Text style={styles.modalCloseText}>完了</Text>
              </Pressable>
            </View>

            <ScrollView style={styles.settingsScroll} contentContainerStyle={styles.settingsBody}>
              <View style={styles.notice}>
                <Text style={styles.noticeText}>
                  事務室登録の授業はございません。申し訳ないです。
                </Text>
              </View>

              <View style={styles.totalCreditsCard}>
                <Text style={styles.totalCreditsLabel}>現在の合計単位</Text>
                <Text style={styles.totalCreditsValue}>{totalCredits}単位</Text>
              </View>

              <View style={styles.settingSection}>
                <Text style={styles.settingTitle}>学部</Text>
                <View style={styles.chipRow}>
                  {facultyOptions.map((faculty) => (
                    <Pressable
                      key={faculty}
                      style={[
                        styles.filterChip,
                        settings.faculty === faculty ? styles.filterChipActive : null,
                      ]}
                      onPress={() => updateFaculty(faculty)}
                      hitSlop={hitSlopSmall}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          settings.faculty === faculty ? styles.filterChipTextActive : null,
                        ]}
                      >
                        {faculty}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={styles.settingSection}>
                <Text style={styles.settingTitle}>キャンパス</Text>
                <View style={styles.chipRow}>
                  {campusOptions.map((campus) => (
                    <Pressable
                      key={campus}
                      style={[
                        styles.filterChip,
                        settings.campus === campus ? styles.filterChipActive : null,
                      ]}
                      onPress={() => updateCampus(campus)}
                      hitSlop={hitSlopSmall}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          settings.campus === campus ? styles.filterChipTextActive : null,
                        ]}
                      >
                        {campus}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={styles.settingSection}>
                <Text style={styles.settingTitle}>年度</Text>
                <View style={styles.chipRow}>
                  {[2025, 2026, 2027].map((year) => (
                    <Pressable
                      key={year}
                      style={[
                        styles.filterChip,
                        settings.academicYear === year ? styles.filterChipActive : null,
                      ]}
                      onPress={() => updateYear(year)}
                      hitSlop={hitSlopSmall}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          settings.academicYear === year ? styles.filterChipTextActive : null,
                        ]}
                      >
                        {year}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={styles.settingSection}>
                <Text style={styles.settingTitle}>セメスター</Text>
                <View style={styles.chipRow}>
                  {(['春セメスター', '秋セメスター'] as TermOption[]).map((term) => (
                    <Pressable
                      key={term}
                      style={[
                        styles.filterChip,
                        settings.term === term ? styles.filterChipActive : null,
                      ]}
                      onPress={() => updateTerm(term)}
                      hitSlop={hitSlopSmall}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          settings.term === term ? styles.filterChipTextActive : null,
                        ]}
                      >
                        {term}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={styles.settingSection}>
                <Text style={styles.settingTitle}>土日を表示</Text>
                <View style={styles.chipRow}>
                  <Pressable
                    style={[
                      styles.filterChip,
                      settings.includeWeekend ? styles.filterChipActive : null,
                    ]}
                    onPress={toggleWeekend}
                    hitSlop={hitSlopSmall}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        settings.includeWeekend ? styles.filterChipTextActive : null,
                      ]}
                    >
                      {settings.includeWeekend ? '表示中' : '非表示'}
                    </Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.settingSection}>
                <Text style={styles.settingTitle}>表示コマ数</Text>
                <View style={styles.chipRow}>
                  {periodKeysAll.map((period) => (
                    <Pressable
                      key={period}
                      style={[
                        styles.filterChip,
                        settings.maxPeriod === period ? styles.filterChipActive : null,
                      ]}
                      onPress={() => updateMaxPeriod(period)}
                      hitSlop={hitSlopSmall}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          settings.maxPeriod === period ? styles.filterChipTextActive : null,
                        ]}
                      >
                        {period}限
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  content: {
    flex: 1,
    padding: 4,
    paddingTop: 12,
  },
  topHeader: {
    marginTop: 24,
    marginBottom: 10,
    paddingHorizontal: 4,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  termTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#0F172A',
  },
  termTitleAutumn: {
    color: '#9A3412',
  },

  termSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 6,
  },
  termSubtitleAutumn: {
    color: '#C2410C',
  },
 
  selectedCourseCard: {
    backgroundColor: '#FEF08A',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FDE047',
  },
  selectedCourseLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400E',
    marginBottom: 6,
  },
  selectedCourseTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#7C2D12',
    marginBottom: 4,
  },
  selectedCourseMeta: {
    fontSize: 12,
    color: '#92400E',
  },
  headerActions: {
    marginTop: 'auto',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 12,
  },
  settingsButton: {
    alignSelf: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  settingsText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  card: {
    flex: 1,
    backgroundColor: 'transparent',
    borderRadius: 0,
    padding: 0,
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  gridScroll: {
    flex: 1,
  },
  grid: {
    gap: 8,
    paddingTop: 16,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  corner: {
    width: 56,
  },
  headerCell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    paddingVertical: 0,
  },
  dayCell: {
    width: 140,
  },
  dayText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  todayCircle: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  todayCircleMuted: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  todayTextActive: {
    color: '#FFFFFF',
  },
  dayTextCompact: {
    fontSize: 12,
  },
  periodCell: {
    width: 56,
  },
  periodText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  periodTime: {
    fontSize: 9,
    color: '#0F172A',
    marginTop: 2,
    textAlign: 'center',
  },
  periodTextCompact: {
    fontSize: 10,
  },
  courseCell: {
    minHeight: 84,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    padding: 10,
    justifyContent: 'space-between',
  },
  courseMain: {
    flex: 1,
    justifyContent: 'space-between',
    gap: 6,
  },
  courseFilled: {
    borderColor: 'rgba(15, 23, 42, 0.08)',
    shadowColor: '#1F2937',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  courseTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
  },
  courseTitleCompact: {
    fontSize: 11,
  },
  courseMeta: {
    fontSize: 10,
    color: '#64748B',
    textAlign: 'center',
  },
  courseMetaCompact: {
    fontSize: 9,
    textAlign: 'center',
  },
  classroomText: {
    fontWeight: '700',
    color: '#64748B',
  },
  courseMetaHint: {
    color: '#94A3B8',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    padding: 20,
    justifyContent: 'center',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    maxHeight: '90%',
  },
  settingsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    maxHeight: '92%',
    width: '92%',
    alignSelf: 'center',
  },
  settingsScroll: {
    marginTop: 8,
  },
  settingsBody: {
    gap: 16,
    paddingBottom: 10,
  },
  totalCreditsCard: {
    backgroundColor: '#FFF7ED',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  totalCreditsLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9A3412',
    marginBottom: 6,
  },
  totalCreditsValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#9A3412',
  },
  settingSection: {
    gap: 10,
  },
  settingTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalKicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: '#94A3B8',
    textTransform: 'uppercase',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalClose: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  modalCloseText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
  notice: {
    backgroundColor: '#FEF9C3',
    borderRadius: 14,
    padding: 10,
    marginBottom: 10,
  },
  colorPicker: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 10,
    marginBottom: 10,
  },
  colorLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 6,
  },
  colorRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  colorChip: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorChipActive: {
    borderColor: '#0F172A',
  },
  classroomInputCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 10,
    marginBottom: 10,
  },
  classroomInputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 6,
  },
  classroomInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
  },
  inlineSyllabus: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  selectedActions: {
    marginBottom: 10,
    gap: 8,
  },
  inlineSyllabusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E293B',
  },
  clearSelectedButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: 'transparent',
    paddingVertical: 8,
    alignItems: 'center',
  },
  clearSelectedText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#BE123C',
  },
  noticeText: {
    fontSize: 12,
    color: '#92400E',
  },
  stateBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  stateText: {
    fontSize: 12,
    color: '#64748B',
  },
  stateError: {
    backgroundColor: '#FFE4E6',
  },
  stateErrorText: {
    fontSize: 12,
    color: '#9F1239',
  },
  courseList: {
    marginBottom: 12,
  },
  courseListContent: {
    gap: 12,
  },
  courseCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
  },
  courseCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  courseColorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  courseCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  courseCardMeta: {
    fontSize: 11,
    color: '#64748B',
  },
  chipRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
    flexWrap: 'wrap',
  },
  filterChip: {
    backgroundColor: '#F1F5F9',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filterChipActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  chip: {
    backgroundColor: '#F1F5F9',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  syllabusInlineChip: {
    backgroundColor: '#E0E7FF',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  syllabusInlineText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4338CA',
  },
  registerChip: {
    backgroundColor: '#E76A7A',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  registerChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  customCourseCard: {
    backgroundColor: '#EFF6FF',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    gap: 8,
  },
  customCourseTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E3A8A',
  },
  customCourseInput: {
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
  },
  customCourseError: {
    fontSize: 12,
    color: '#BE123C',
  },
  customCourseSubmit: {
    backgroundColor: '#2563EB',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  customCourseSubmitText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  chipText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#475569',
  },
});
