// Storage 미디어 캐시의 합계 상한. 이미지와 동영상 route가 함께 쓴다. workbox-build가 route 함수를
// 문자열로 굳히므로 공용 함수를 import할 수 없어 sw.js가 importScripts로 불러온다.
const CAP = 300 * 1024 * 1024;
// 상한 바로 아래까지만 지우면 다음 항목에 또 넘어 항목마다 전체를 다시 센다. 여유를 두고 지운다.
const LOW_WATER = 270 * 1024 * 1024;
// 합계를 쓰기 전에 담은 항목은 예전 상한인 1MiB로 친다.
const UNKNOWN_SIZE = 1024 * 1024;

let used = null;

self.kmlaTrimStorageCache = async (cache, added) => {
  // 합계는 덮어쓰기나 계정 정리로 실제보다 클 수 있지만 그때도 다시 셀 뿐이다.
  if (used !== null) {
    used += added;
    if (used <= CAP) return;
  }
  const keys = await cache.keys();
  const sizes = await Promise.all(
    keys.map(async (key) => {
      const entry = await cache.match(key);
      return Number(entry?.headers.get("x-kmla-storage-size")) || UNKNOWN_SIZE;
    }),
  );
  let total = sizes.reduce((sum, size) => sum + size, 0);
  if (total > CAP) {
    for (const [index, key] of keys.entries()) {
      if (total <= LOW_WATER) break;
      await cache.delete(key);
      total -= sizes[index];
    }
  }
  used = total;
};
