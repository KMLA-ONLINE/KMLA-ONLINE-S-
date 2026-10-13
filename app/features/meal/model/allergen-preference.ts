const STORAGE_KEY = "kmla-online:meal-allergens:v1";

/** 저장소를 못 쓰는 환경(사생활 보호 모드 등)에서는 꺼진 채로 둔다. */
export function readShowAllergens(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeShowAllergens(show: boolean): void {
  try {
    if (show) window.localStorage.setItem(STORAGE_KEY, "on");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 이번 화면에서만 적용된다.
  }
}
