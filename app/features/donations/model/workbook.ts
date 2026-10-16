export interface DonationUploadItem {
  category: string;
  name: string;
  detail: string | null;
  donorName: string | null;
  sourceSheet: string;
  sourceRow: number;
}

export interface DonationImportPreview {
  items: DonationUploadItem[];
  errors: string[];
}

export interface DonationExportRecord {
  item_id: number;
  category: string;
  item_name: string;
  detail: string | null;
  donor_name: string | null;
  applicant: string | null;
  applicant_pub_id: string | null;
  applicant_cohort: number | null;
  applied_at: string | null;
  cancelled_at: string | null;
}

const CATEGORIES: Record<string, string> = {
  domestic: "국내반 교재",
  international: "국제반 교재",
  literature: "문학 도서",
  textbook: "교과서",
  daily: "생활용품",
  uniform_female: "여학생 교복",
  uniform_male: "남학생 교복",
};

function readText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  // Excel stores sizes such as 95 and titles such as 1984 as numbers.
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  return value.trim();
}

export async function parseDonationWorkbook(
  file: File,
): Promise<DonationImportPreview> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error(".xlsx 파일만 업로드할 수 있습니다.");
  }

  if (file.size > 8 * 1024 * 1024) {
    throw new Error("8MB 이하의 엑셀 파일만 업로드할 수 있습니다.");
  }

  const { default: readExcelFile } = await import("read-excel-file/browser");
  const sheets = await readExcelFile(file);
  const items: DonationUploadItem[] = [];
  const errors: string[] = [];

  const normalize = (value: unknown): string =>
    (typeof value === "string" ? value : "")
      .trim()
      .replace(/[\s·:_()[\]-]/g, "")
      .toLowerCase();

  const nameHeaders = new Set([
    "물품명",
    "물품이름",
    "품목명",
    "품명",
    "도서명",
    "교재명",
    "상품명",
    "책이름",
    "name",
  ]);

  const detailHeaders = new Set([
    "상세정보",
    "세부정보",
    "상세",
    "설명",
    "색상",
    "사이즈",
    "규격",
    "비고",
    "상태",
    "detail",
  ]);

  const donorHeaders = new Set([
    "기증자",
    "기증자명",
    "기증자이름",
    "기증자성함",
    "기부자",
    "기부자명",
    "donor",
    "donorname",
  ]);

  const indexHeaders = new Set(["index", "번호", "순번", "no", "id"]);

  const isEmpty = (row: readonly unknown[]) =>
    row.every(
      (value) =>
        value === null ||
        value === undefined ||
        (typeof value === "string" && value.trim() === ""),
    );

  for (const { sheet, data } of sheets) {
    const category = Object.hasOwn(CATEGORIES, sheet)
      ? CATEGORIES[sheet]
      : undefined;

    if (!category) {
      errors.push(
        `${sheet}: 지원하지 않는 시트입니다. 엑셀 양식을 확인해 주세요.`,
      );
      continue;
    }

    const firstRowIndex = data.findIndex((row) => !isEmpty(row));

    if (firstRowIndex === -1) {
      continue;
    }

    const firstRow = data[firstRowIndex];
    const headerCells = firstRow.map(normalize);

    const hasHeader = headerCells.some(
      (value) =>
        nameHeaders.has(value) ||
        detailHeaders.has(value) ||
        donorHeaders.has(value) ||
        indexHeaders.has(value),
    );

    const nameColumn = hasHeader
      ? headerCells.findIndex((value) => nameHeaders.has(value))
      : 0;

    const detailColumn = hasHeader
      ? headerCells.findIndex((value) => detailHeaders.has(value))
      : 2;

    const donorColumn = hasHeader
      ? headerCells.findIndex((value) => donorHeaders.has(value))
      : 3;

    if (hasHeader && nameColumn === -1) {
      errors.push(
        `${sheet} ${firstRowIndex + 1}행: 필수 열 ‘물품명’이 없습니다.`,
      );
      continue;
    }

    if (hasHeader && sheet.startsWith("uniform_")) {
      let missing = false;

      if (detailColumn === -1) {
        errors.push(
          `${sheet} ${firstRowIndex + 1}행: 필수 열 ‘색상’이 없습니다.`,
        );
        missing = true;
      }

      if (donorColumn === -1) {
        errors.push(
          `${sheet} ${firstRowIndex + 1}행: 필수 열 ‘기증자’가 없습니다.`,
        );
        missing = true;
      }

      if (missing) continue;
    }

    const dataStart = hasHeader ? firstRowIndex + 1 : firstRowIndex;

    for (let index = dataStart; index < data.length; index++) {
      const row = data[index];

      if (isEmpty(row)) continue;

      const rowNumber = index + 1;
      const location = `${sheet} ${rowNumber}행`;

      // 시트 중간에 반복된 헤더가 있으면 물품으로 취급하지 않는다.
      if (
        hasHeader &&
        nameColumn >= 0 &&
        nameHeaders.has(normalize(row[nameColumn]))
      ) {
        errors.push(
          `${location}: 반복된 헤더 행입니다. 중복 헤더를 제거해 주세요.`,
        );
        continue;
      }

      const name = readText(nameColumn >= 0 ? row[nameColumn] : null);

      const detail = readText(detailColumn >= 0 ? row[detailColumn] : null);

      const donorName = readText(donorColumn >= 0 ? row[donorColumn] : null);

      let invalid = false;

      if (!name || name.length > 300) {
        errors.push(`${location}: 물품명은 1~300자의 텍스트로 입력해 주세요.`);
        invalid = true;
      }

      if (detail === null || detail.length > 200) {
        errors.push(
          `${location}: 상세 정보는 200자 이하의 텍스트로 입력해 주세요.`,
        );
        invalid = true;
      }

      if (donorName === null || donorName.length > 100) {
        errors.push(
          `${location}: 기증자 이름은 100자 이하의 텍스트로 입력해 주세요.`,
        );
        invalid = true;
      }

      if (sheet.startsWith("uniform_")) {
        if (!detail) {
          errors.push(`${location}: 색상이 필요합니다.`);
          invalid = true;
        }

        if (!donorName) {
          errors.push(`${location}: 기증자 이름이 필요합니다.`);
          invalid = true;
        }
      }

      if (invalid || !name || detail === null || donorName === null) {
        continue;
      }

      items.push({
        category,
        name,
        detail: detail || null,
        donorName: donorName || null,
        sourceSheet: sheet,
        sourceRow: rowNumber,
      });
    }
  }

  if (items.length === 0 && errors.length === 0) {
    errors.push("등록할 물품이 없습니다.");
  }

  if (items.length > 3000) {
    errors.push("한 회차에 최대 3,000개까지 등록할 수 있습니다.");
  }

  return { items, errors };
}

export async function downloadDonationResults(
  records: DonationExportRecord[],
  roundTitle: string,
): Promise<void> {
  const headers = [
    "분류",
    "물품명",
    "상세 정보",
    "기증자",
    "신청자",
    "사용자 ID",
    "기수",
  ];

  const activeRecords = records.filter(
    (record) => record.applied_at !== null && record.cancelled_at === null,
  );

  const data: (string | number | null)[][] = [
    headers,
    ...activeRecords.map((record) => [
      record.category,
      record.item_name,
      record.detail ?? "",
      record.donor_name ?? "",
      record.applicant ?? "",
      record.applicant_pub_id ?? "",
      record.applicant_cohort,
    ]),
  ];

  const safeTitle = roundTitle.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);

  const { default: writeExcelFile } = await import("write-excel-file/browser");
  await writeExcelFile(data, {
    sheet: "신청 결과",
  }).toFile(`기부물품_${safeTitle}_신청결과.xlsx`);
}
