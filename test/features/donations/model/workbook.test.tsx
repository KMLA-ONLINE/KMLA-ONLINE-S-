import { afterEach, describe, expect, it, vi } from "vitest";
import readExcelFile from "read-excel-file/browser";
import writeExcelFile from "write-excel-file/node";

import {
  downloadDonationResults,
  parseDonationWorkbook,
  type DonationExportRecord,
} from "~/features/donations/model/workbook";

async function workbookFile(
  data: (string | number | null)[][],
  sheet = "domestic",
) {
  const buffer = await writeExcelFile(data, { sheet }).toBuffer();
  return new File([new Uint8Array(buffer).buffer], "donations.xlsx");
}

afterEach(() => vi.unstubAllGlobals());

describe("donation workbook upload", () => {
  it("recognizes spaced column names and excludes the index column", async () => {
    const file = await workbookFile([
      ["번 호", "물품 명", "설 명"],
      [1, "수학 교재", "깨끗함"],
    ]);
    expect(await parseDonationWorkbook(file)).toEqual({
      items: [
        {
          category: "국내반 교재",
          name: "수학 교재",
          detail: "깨끗함",
          donorName: null,
          sourceSheet: "domestic",
          sourceRow: 2,
        },
      ],
      errors: [],
    });
  });
});

describe("donation workbook validation", () => {
  it("keeps separate physical copies and reports their original sheet rows", async () => {
    const buffer = await writeExcelFile([
      { sheet: "domestic", data: [["같은 교재"], [null], ["같은 교재"]] },
      { sheet: "uniform_female", data: [["하복", null, "흰색", "김기증"]] },
    ]).toBuffer();
    const preview = await parseDonationWorkbook(
      new File([new Uint8Array(buffer).buffer], "sample.xlsx"),
    );
    expect(preview.errors).toEqual([]);
    expect(preview.items).toEqual([
      {
        category: "국내반 교재",
        name: "같은 교재",
        detail: null,
        donorName: null,
        sourceSheet: "domestic",
        sourceRow: 1,
      },
      {
        category: "국내반 교재",
        name: "같은 교재",
        detail: null,
        donorName: null,
        sourceSheet: "domestic",
        sourceRow: 3,
      },
      {
        category: "여학생 교복",
        name: "하복",
        detail: "흰색",
        donorName: "김기증",
        sourceSheet: "uniform_female",
        sourceRow: 1,
      },
    ]);
  });

  it("reports the row of a missing required column without an extra empty-file error", async () => {
    const result = await parseDonationWorkbook(
      await workbookFile([
        ["번호", "기증자"],
        [1, "기증자"],
      ]),
    );
    expect(result.errors).toEqual([
      "domestic 1행: 필수 컬럼 '물품명'이 없습니다.",
    ]);
  });

  it("reports repeated headers and invalid values at their Excel row numbers", async () => {
    const result = await parseDonationWorkbook(
      await workbookFile([
        ["물품명", "상세 정보"],
        ["교재", "좋음"],
        ["물품명", "상세 정보"],
        ["가".repeat(301), "좋음"],
      ]),
    );
    expect(result.items).toHaveLength(1);
    expect(result.errors).toEqual([
      "domestic 3행: 반복된 헤더 행입니다. 중복 헤더를 제거해주세요.",
      "domestic 4행: 물품명은 1~300자의 문자여야 합니다.",
    ]);
  });

  it("reads numeric cells such as sizes and numeric titles as text", async () => {
    const result = await parseDonationWorkbook(
      await workbookFile(
        [
          ["물품명", "사이즈", "기증자"],
          [1984, 95, 2026],
        ],
        "uniform_male",
      ),
    );
    expect(result).toEqual({
      items: [
        {
          category: "남학생 교복",
          name: "1984",
          detail: "95",
          donorName: "2026",
          sourceSheet: "uniform_male",
          sourceRow: 2,
        },
      ],
      errors: [],
    });
  });

  it("rejects sheet names that match inherited object properties", async () => {
    const result = await parseDonationWorkbook(
      await workbookFile([["교재"]], "constructor"),
    );
    expect(result).toEqual({
      items: [],
      errors: [
        "constructor: 지원하지 않는 시트입니다. 엑셀 양식을 확인해주세요.",
      ],
    });
  });

  it("requires the uniform template's color and donor columns", async () => {
    const result = await parseDonationWorkbook(
      await workbookFile([["물품명"], ["하복"]], "uniform_male"),
    );
    expect(result.errors).toEqual([
      "uniform_male 1행: 필수 컬럼 '색상'이 없습니다.",
      "uniform_male 1행: 필수 컬럼 '기증자'가 없습니다.",
    ]);
  });

  it("rejects non-xlsx files before attempting to read them", async () => {
    await expect(
      parseDonationWorkbook(new File(["bad"], "items.csv")),
    ).rejects.toThrow(".xlsx 파일만 업로드할 수 있습니다.");
  });
});

describe("donation result download", () => {
  it("downloads a readable workbook with only active applications and one header", async () => {
    let downloaded: Blob | undefined;
    let filename = "";
    const NativeURL = URL;
    vi.stubGlobal(
      "URL",
      class extends NativeURL {
        static createObjectURL(blob: Blob) {
          downloaded = blob;
          return "blob:donation-results";
        }
        static revokeObjectURL = vi.fn();
      },
    );
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      filename = this.download;
    });
    const active: DonationExportRecord = {
      item_id: 1,
      category: "국내반 교재",
      item_name: "수학 교재",
      detail: null,
      donor_name: null,
      applicant: "학생",
      applicant_pub_id: "student-test",
      applicant_cohort: 29,
      applied_at: "2026-10-14T00:00:00Z",
      cancelled_at: null,
    };
    await downloadDonationResults(
      [
        active,
        {
          ...active,
          item_id: 2,
          item_name: "취소 교재",
          cancelled_at: "2026-10-14T01:00:00Z",
        },
        {
          ...active,
          item_id: 3,
          item_name: "미신청 교재",
          applicant: null,
          applied_at: null,
        },
      ],
      "가을/기부",
    );
    expect(filename).toBe("기부물품_가을_기부_신청결과.xlsx");
    expect(downloaded).toBeDefined();
    const sheets = await readExcelFile(downloaded!);
    expect(sheets).toEqual([
      {
        sheet: "신청 결과",
        data: [
          [
            "분류",
            "물품명",
            "상세 정보",
            "기증자",
            "신청자",
            "사용자 ID",
            "기수",
          ],
          ["국내반 교재", "수학 교재", null, null, "학생", "student-test", 29],
        ],
      },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
});
