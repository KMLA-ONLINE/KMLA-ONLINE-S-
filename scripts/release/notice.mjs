/**
 * 릴리즈 공지 초안을 받을 때까지 Gemini 모델을 차례로 부른다. 요청·시계·대기는 인자로 받아
 * `release.mjs`가 실제 `fetch`를, 테스트가 가짜를 넘긴다.
 */
import { noticeRetry } from "./plan.mjs";

// job 제한(10분) 안에서 GitHub 조회와 출력에 쓸 시간을 남긴다.
const BUDGET_MS = 7 * 60_000;
// thinking 모델이 큰 릴리즈를 읽는 시간은 넉넉히 두되, 응답 없는 모델 하나가 예산을 다 쓰지 않게 한다.
const REQUEST_MS = 120_000;

/**
 * 실패하면 `noticeRetry`에 따라 같은 모델로 다시 시도하거나 다음 모델로 넘어간다.
 * `request(model, timeoutMs)`는 `{ status, text }`를 돌려준다.
 */
export async function draftNotice({
  models,
  request,
  now,
  sleep,
  random,
  log,
}) {
  const deadline = now() + BUDGET_MS;
  let attempts = 0;
  let last = "no model was tried";
  // 실행 요약의 annotation은 첫 줄만 보이므로 실패마다 이유를 한 줄로 남긴다.
  const fail = (line) => {
    attempts++;
    last = line;
    log(`::notice::${line}`);
  };

  models: for (const model of models) {
    for (let attempt = 1; ; attempt++) {
      const left = deadline - now();
      if (left <= 0) break models;
      let status, text;
      try {
        ({ status, text } = await request(model, Math.min(REQUEST_MS, left)));
      } catch (error) {
        // 응답 없는 모델은 다시 기다려도 대개 같으므로 남은 시간을 다음 모델에 쓴다.
        if (error?.name === "TimeoutError") {
          fail(`${model} attempt ${attempt}: timed out`);
          continue models;
        }
        // `fetch`의 네트워크 실패만 일시 오류인 503으로 다시 시도한다. 설정 오류 같은 다른 예외는
        // 다시 시도해도 같으므로 그대로 던진다.
        if (!(error instanceof TypeError)) throw error;
        ({ status, text } = { status: 503, text: error.message });
      }
      if (status === 200) {
        const notice = noticeText(text);
        if (notice.text) return notice.text;
        fail(`${model} attempt ${attempt}: ${notice.error}`);
        continue models;
      }

      fail(`${model} attempt ${attempt}: ${status} ${reason(text)}`);
      const next = noticeRetry({ status, body: text, attempt });
      if (next.fail) break models;
      if (next.next) continue models;
      // 같은 순간에 몰린 재시도끼리 다시 부딪히지 않게 최대 20%를 더 기다린다.
      const wait = next.retry * 1000 * (1 + random() * 0.2);
      // 기다리면 예산을 넘기면 남은 시간을 기다리지 않고 다음 모델에 쓴다.
      if (now() + wait >= deadline) continue models;
      await sleep(wait);
    }
  }
  throw new Error(`Gemini failed after ${attempts} attempts; last: ${last}`);
}

/** 오류 응답에서 Google API의 `error.message`를 한 줄로 뽑는다. JSON이 아니면 본문 앞부분을 쓴다. */
function reason(text) {
  let message = text;
  try {
    message = JSON.parse(text).error?.message ?? text;
  } catch {
    // JSON이 아닌 본문(프록시 오류 페이지 등)
  }
  return String(message).replace(/\s+/g, " ").trim().slice(0, 200);
}

/** 성공 응답의 초안 본문. 생각(thought) 부분은 뺀다. 잘렸거나 비었으면 `error`를 돌려준다. */
function noticeText(text) {
  let candidate;
  try {
    candidate = JSON.parse(text).candidates?.[0];
  } catch {
    return { error: "returned a body that is not JSON" };
  }
  if (candidate?.finishReason !== "STOP") {
    return {
      error: `stopped with ${candidate?.finishReason ?? "no candidate"}`,
    };
  }
  const notice = (candidate.content?.parts ?? [])
    .filter((part) => !part.thought)
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  return notice ? { text: notice } : { error: "returned no text" };
}
