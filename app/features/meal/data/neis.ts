import { getKoreaDateIso } from "~/shared/lib/korea-date";

const NEIS_MEAL_URL = "https://open.neis.go.kr/hub/mealServiceDietInfo";

const EDUCATION_OFFICE_CODE = "K10";
const SCHOOL_CODE = "7801132";

export interface MealItem {
  name: string;
  allergens: string[];
}

export interface MealMenu {
  code: string;
  label: string;
  items: MealItem[];
  servings: string;
  calories: string;
  origin: string[];
  nutrition: string[];
}

export interface MealDay {
  date: string;
  meals: MealMenu[];
  unavailable: boolean;
}

interface NeisMealRow {
  MMEAL_SC_CODE?: unknown;
  MMEAL_SC_NM?: unknown;
  MLSV_YMD?: unknown;
  MLSV_FGR?: unknown;
  DDISH_NM?: unknown;
  ORPLC_INFO?: unknown;
  CAL_INFO?: unknown;
  NTR_INFO?: unknown;
}

const MEAL_LABELS: Record<string, string> = {
  "1": "조식",
  "2": "중식",
  "3": "석식",
};

const cache = new Map<string, Promise<MealDay>>();

function splitLines(value: unknown) {
  if (typeof value !== "string") return [];

  return value
    .split(/<br\s*\/?>/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseDish(value: string): MealItem {
  const match = /\s*(?:\(([0-9.]+)\)|([0-9]+(?:\.[0-9]+)*\.))\s*$/.exec(value);

  if (!match) {
    return {
      name: value.trim(),
      allergens: [],
    };
  }

  const allergyText = (match[1] ?? match[2] ?? "").replace(/\.$/, "");

  return {
    name: value.slice(0, match.index).trim(),
    allergens: allergyText.split(".").filter(Boolean),
  };
}

function readRows(payload: unknown): NeisMealRow[] {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("mealServiceDietInfo" in payload)
  ) {
    return [];
  }

  const sections = (
    payload as {
      mealServiceDietInfo?: unknown;
    }
  ).mealServiceDietInfo;

  if (!Array.isArray(sections)) return [];

  const mealSections: unknown[] = sections;

  return mealSections.flatMap((section) => {
    if (!section || typeof section !== "object") {
      return [];
    }

    const row = (
      section as {
        row?: unknown;
      }
    ).row;

    if (!Array.isArray(row)) {
      return [];
    }

    return row as NeisMealRow[];
  });
}

export function getKoreaDate(now = new Date()) {
  return getKoreaDateIso(now).replaceAll("-", "");
}

export function getKoreaHour(now = new Date()) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
}

function toUtcDate(value: string) {
  return new Date(
    Date.UTC(
      Number(value.slice(0, 4)),
      Number(value.slice(4, 6)) - 1,
      Number(value.slice(6, 8)),
    ),
  );
}

function formatUtcDate(date: Date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");
}

export function getMealReferenceDate(now = new Date()) {
  const today = getKoreaDate(now);
  const hour = getKoreaHour(now);

  if (hour < 19) return today;

  const tomorrow = toUtcDate(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  return formatUtcDate(tomorrow);
}

export function getDefaultMeal(now = new Date()) {
  const hour = getKoreaHour(now);

  if (hour >= 14 && hour < 19) return "석식";
  if (hour >= 8 && hour < 14) return "중식";

  return "조식";
}

export function getKoreaWeekDates(referenceDate = getMealReferenceDate()) {
  const date = toUtcDate(referenceDate);
  const weekday = date.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;

  date.setUTCDate(date.getUTCDate() + mondayOffset);

  return Array.from({ length: 7 }, (_, offset) => {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + offset);

    return formatUtcDate(next);
  });
}

export async function getMealDay(date: string): Promise<MealDay> {
  const existing = cache.get(date);

  if (existing) return existing;

  const request = fetchMealDay(date);

  cache.set(date, request);

  return request;
}

async function fetchMealDay(date: string): Promise<MealDay> {
  const params = new URLSearchParams({
    Type: "json",
    pIndex: "1",
    pSize: "10",
    ATPT_OFCDC_SC_CODE: EDUCATION_OFFICE_CODE,
    SD_SCHUL_CODE: SCHOOL_CODE,
    MLSV_YMD: date,
  });

  try {
    const response = await fetch(`${NEIS_MEAL_URL}?${params}`);

    if (!response.ok) {
      throw new Error(String(response.status));
    }

    const rows = readRows(await response.json());

    const meals = rows
      .filter(
        (row) =>
          typeof row.MLSV_YMD === "string" &&
          row.MLSV_YMD === date &&
          typeof row.DDISH_NM === "string",
      )
      .map((row): MealMenu => {
        const code =
          typeof row.MMEAL_SC_CODE === "string" ? row.MMEAL_SC_CODE : "";

        const apiLabel =
          typeof row.MMEAL_SC_NM === "string" ? row.MMEAL_SC_NM : "";

        return {
          code,
          label: MEAL_LABELS[code] ?? apiLabel,
          items: splitLines(row.DDISH_NM).map(parseDish),
          servings: typeof row.MLSV_FGR === "string" ? row.MLSV_FGR : "",
          calories: typeof row.CAL_INFO === "string" ? row.CAL_INFO : "",
          origin: splitLines(row.ORPLC_INFO),
          nutrition: splitLines(row.NTR_INFO),
        };
      })
      .sort((a, b) => Number(a.code) - Number(b.code));

    return {
      date,
      meals,
      unavailable: false,
    };
  } catch {
    cache.delete(date);

    return {
      date,
      meals: [],
      unavailable: true,
    };
  }
}
