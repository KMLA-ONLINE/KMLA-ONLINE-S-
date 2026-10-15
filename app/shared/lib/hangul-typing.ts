/**
 * 글자를 두벌식 키보드로 한 타씩 칠 때 화면에 보이는 문자열들.
 *
 * 한글은 자모 단위로 조합된다 — "가나"는 `ㄱ → 가 → 간 → 가나`처럼 받침이 다음 글자로
 * 넘어가고(도깨비불), "닭"은 `다 → 달 → 닭`처럼 겹받침이 붙는다. 한글이 아닌 문자와
 * 낱자(ㅋㅋ)는 한 번에 한 글자씩 그대로 찍힌다. 마지막 화면은 항상 `text` 자체다.
 */
export function typingFrames(text: string): string[] {
  const frames: string[] = [];
  let committed = "";
  let cur: Syllable | null = null;

  const push = () => {
    const frame = committed + (cur ? render(cur) : "");
    if (frames.at(-1) !== frame) frames.push(frame);
  };
  const commit = (syllable: Syllable | null) => {
    if (syllable) committed += render(syllable);
  };

  for (const char of text) {
    const keys = syllableKeys(char);
    if (!keys) {
      commit(cur);
      cur = null;
      committed += char;
      push();
      continue;
    }
    for (const key of keys) {
      cur = VOWELS.includes(key)
        ? typeVowel(cur, key, commit)
        : typeConsonant(cur, key, commit);
      push();
    }
  }
  return frames;
}

interface Syllable {
  cho?: string;
  jung?: string;
  jong?: string;
}

const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const VOWELS = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
// 인덱스 0은 받침 없음.
const JONG = ["", ..."ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"];

/** 두 타로 치는 모음과 받침. 키보드에 따로 없는 자모만 둔다(ㄲ·ㅆ은 Shift 한 타). */
const COMPOUND: Record<string, string> = {
  ㅘ: "ㅗㅏ",
  ㅙ: "ㅗㅐ",
  ㅚ: "ㅗㅣ",
  ㅝ: "ㅜㅓ",
  ㅞ: "ㅜㅔ",
  ㅟ: "ㅜㅣ",
  ㅢ: "ㅡㅣ",
  ㄳ: "ㄱㅅ",
  ㄵ: "ㄴㅈ",
  ㄶ: "ㄴㅎ",
  ㄺ: "ㄹㄱ",
  ㄻ: "ㄹㅁ",
  ㄼ: "ㄹㅂ",
  ㄽ: "ㄹㅅ",
  ㄾ: "ㄹㅌ",
  ㄿ: "ㄹㅍ",
  ㅀ: "ㄹㅎ",
  ㅄ: "ㅂㅅ",
};
const COMBINE = new Map(
  Object.entries(COMPOUND).map(([whole, pair]) => [pair, whole]),
);

function split(jamo: string): string[] {
  return [...(COMPOUND[jamo] ?? jamo)];
}

/** 완성형 한 글자를 키 입력 순서로 푼다. 완성형이 아니면 `null`. */
function syllableKeys(char: string): string[] | null {
  const code = char.charCodeAt(0) - 0xac00;
  if (code < 0 || code >= 11172) return null;
  const cho = CHO[Math.floor(code / 588)];
  const jung = VOWELS[Math.floor((code % 588) / 28)];
  const jong = JONG[code % 28];
  return [cho, ...split(jung), ...(jong ? split(jong) : [])];
}

function render({ cho, jung, jong }: Syllable): string {
  if (cho && jung) {
    const code =
      CHO.indexOf(cho) * 588 +
      VOWELS.indexOf(jung) * 28 +
      JONG.indexOf(jong ?? "");
    return String.fromCharCode(0xac00 + code);
  }
  return cho ?? jung ?? "";
}

function typeConsonant(
  cur: Syllable | null,
  key: string,
  commit: (syllable: Syllable | null) => void,
): Syllable {
  if (cur?.cho && cur.jung) {
    if (!cur.jong && JONG.includes(key)) return { ...cur, jong: key };
    const merged = cur.jong && COMBINE.get(cur.jong + key);
    if (merged) return { ...cur, jong: merged };
  }
  commit(cur);
  return { cho: key };
}

function typeVowel(
  cur: Syllable | null,
  key: string,
  commit: (syllable: Syllable | null) => void,
): Syllable {
  if (cur?.jong) {
    // 받침이 다음 글자의 초성으로 넘어간다. 겹받침이면 뒤쪽 자음만 넘어간다.
    const [first, second] = split(cur.jong);
    commit({ ...cur, jong: second ? first : undefined });
    return { cho: second ?? first, jung: key };
  }
  if (cur?.jung) {
    const merged = COMBINE.get(cur.jung + key);
    if (merged) return { ...cur, jung: merged };
  } else if (cur?.cho) {
    return { ...cur, jung: key };
  }
  commit(cur);
  return { jung: key };
}
