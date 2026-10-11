import { describe, expect, it } from "vitest";

import { clipboardImageFiles } from "~/shared/lib/clipboard";

function clipboard(text: Record<string, string>, files: File[]): DataTransfer {
  return {
    getData: (type: string) => text[type] ?? "",
    items: files.map((file) => ({
      kind: "file",
      type: file.type,
      getAsFile: () => file,
    })),
  } as unknown as DataTransfer;
}

const png = new File(["x"], "shot.png", { type: "image/png" });
const jpeg = new File(["x"], "photo.jpg", { type: "image/jpeg" });
const gif = new File(["x"], "anim.gif", { type: "image/gif" });
const pdf = new File(["x"], "doc.pdf", { type: "application/pdf" });

describe("clipboardImageFiles", () => {
  it("takes every supported image from a screenshot or copied images", () => {
    expect(clipboardImageFiles(clipboard({}, [png, jpeg]))).toEqual([
      png,
      jpeg,
    ]);
    expect(
      clipboardImageFiles(
        clipboard({ "text/html": '<img src="a.png" alt="설명">' }, [png]),
      ),
    ).toEqual([png]);
  });

  it("keeps image copies that carry a file name or address as text", () => {
    // Finder는 파일 이름을, Slack·Notion은 주소를 `text/plain`에 함께 싣는다.
    expect(
      clipboardImageFiles(clipboard({ "text/plain": "shot.png" }, [png])),
    ).toEqual([png]);
    expect(
      clipboardImageFiles(
        clipboard(
          {
            "text/plain": "https://example.com/a.png",
            "text/html": '<img src="https://example.com/a.png">',
          },
          [png],
        ),
      ),
    ).toEqual([png]);
  });

  it("leaves spreadsheet and document copies to text paste", () => {
    // Excel·Word는 표·문단 HTML과 함께 그 영역의 PNG를 싣는다.
    expect(
      clipboardImageFiles(
        clipboard(
          {
            "text/plain": "a\tb",
            "text/html":
              "<html><head><style>td{}</style></head><body><table><tr><td>a</td><td>b</td></tr></table></body></html>",
          },
          [png],
        ),
      ),
    ).toEqual([]);
    expect(
      clipboardImageFiles(
        clipboard({ "text/plain": "문단", "text/html": "<p>문단</p>" }, [png]),
      ),
    ).toEqual([]);
    expect(clipboardImageFiles(null)).toEqual([]);
  });

  it("skips files that cannot be attached as photos", () => {
    expect(clipboardImageFiles(clipboard({}, [gif, pdf]))).toEqual([]);
  });
});
