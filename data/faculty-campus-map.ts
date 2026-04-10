export const facultyList = [
  "全学部",
  "看護学部",
  "健康栄養学部",
  "社会福祉学部",
  "文化学部"
] as const;
export const campusList = [
  "全キャンパス",
  "永国寺キャンパス",
  "池キャンパス"
] as const;

export const facultyCampusLoaders: Record<string, Record<string, () => unknown[]>> = {
  "全学部": {
    "全キャンパス": () => require("./faculty-campus/fc-001-001.json") as unknown[],
    "永国寺キャンパス": () => require("./faculty-campus/fc-001-002.json") as unknown[],
    "池キャンパス": () => require("./faculty-campus/fc-001-003.json") as unknown[],
  },
  "看護学部": {
    "全キャンパス": () => require("./faculty-campus/fc-002-001.json") as unknown[],
    "永国寺キャンパス": () => require("./faculty-campus/fc-002-002.json") as unknown[],
    "池キャンパス": () => require("./faculty-campus/fc-002-003.json") as unknown[],
  },
  "健康栄養学部": {
    "全キャンパス": () => require("./faculty-campus/fc-003-001.json") as unknown[],
    "永国寺キャンパス": () => require("./faculty-campus/fc-003-002.json") as unknown[],
    "池キャンパス": () => require("./faculty-campus/fc-003-003.json") as unknown[],
  },
  "社会福祉学部": {
    "全キャンパス": () => require("./faculty-campus/fc-004-001.json") as unknown[],
    "永国寺キャンパス": () => require("./faculty-campus/fc-004-002.json") as unknown[],
    "池キャンパス": () => require("./faculty-campus/fc-004-003.json") as unknown[],
  },
  "文化学部": {
    "全キャンパス": () => require("./faculty-campus/fc-005-001.json") as unknown[],
    "永国寺キャンパス": () => require("./faculty-campus/fc-005-002.json") as unknown[],
    "池キャンパス": () => require("./faculty-campus/fc-005-003.json") as unknown[],
  },
};
