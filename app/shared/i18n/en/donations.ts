export const donations: Record<string, string> = {
  기부물품: "Donations",
  "처리 중 오류가 발생했습니다.": "Something went wrong.",
  "다시 시도": "Try again",
  "불러오는 중입니다.": "Loading…",
  "신청 기간이 아닙니다": "Applications are closed",
  "신청 기간이 아닙니다.": "Applications are closed.",
  "{date}까지 · 선착순": "Until {date} · first come, first served",
  "내 신청": "My applications",
  "기부물품은 재학생만 신청할 수 있습니다. 목록은 열람할 수 있습니다.":
    "Only current students can apply for donations. You can still browse the list.",
  "기부물품은 재학생만 신청할 수 있습니다.":
    "Only current students can apply for donations.",
  "‘{name}’ 신청이 완료되었습니다.": "Applied for ‘{name}’.",
  "‘{name}’ 신청을 취소했습니다.": "Cancelled the application for ‘{name}’.",
  "신청 취소": "Cancel application",
  "{name} 신청을 취소합니다. 취소하면 다른 학생이 바로 신청할 수 있습니다.":
    "This cancels your application for {name}. Another student can apply right away.",

  // Item list
  "물품 목록": "Item list",
  "물품 검색": "Search items",
  "물품명이나 색상·사이즈로 검색": "Search by item name, color or size",
  "신청 상태": "Application status",
  "물품 분류": "Item category",
  "모든 분류": "All categories",
  전체: "All",
  신청됨: "Applied",
  미신청: "Not applied",
  "신청 가능": "Available",
  "신청 마감": "Taken",
  신청: "Apply",
  취소: "Cancel",
  "{name} 신청": "Apply for {name}",
  "{name} 신청 취소": "Cancel application for {name}",
  "{cohort}기 {name}": "Cohort {cohort} {name}",
  "{cohort}기": "Cohort {cohort}",
  "기증자 {name}": "Donor {name}",
  "한 회차에 최대 {limit}개까지 신청할 수 있습니다. 다른 물품을 신청하려면 기존 신청을 취소해 주세요.":
    "You can apply for up to {limit} items per round. Cancel an existing application to apply for another item.",
  "물품을 불러오는 중입니다.": "Loading items…",
  "등록된 물품이 없습니다.": "No items have been registered.",
  "조건에 맞는 물품이 없습니다.": "No items match the filters.",

  // Round phases
  "신청 진행 중": "Applications open",
  "신청 예정": "Applications upcoming",
  "신청 종료": "Applications ended",
  "진행 중": "Open",
  예정: "Upcoming",
  종료: "Ended",

  // Admin panel
  회차: "Round",
  "아직 회차가 없습니다. 첫 회차를 만들어 주세요.":
    "There are no rounds yet. Create the first round.",
  "새 회차": "New round",
  "예: 2026년 2학기": "e.g. Fall 2026",
  닫기: "Close",
  "회차 만들기": "Create round",
  "회차 이름과 신청 시작·종료 시간을 확인해 주세요.":
    "Check the round name and the opening and closing times.",
  "회차를 만들었습니다. 이제 물품 엑셀을 등록하세요.":
    "Round created. Now upload the item spreadsheet.",
  "물품 {count}개 · 신청 {claims}건":
    "{count} items · {claims} {claims|application|applications}",
  수정: "Edit",
  "신청 결과 엑셀 받기": "Download results (Excel)",
  "물품 엑셀 등록": "Upload item spreadsheet",
  "회차마다 한 번만 등록할 수 있습니다. 오류가 하나라도 있으면 등록되지 않으니 안내된 행을 고친 뒤 다시 선택하세요.":
    "Each round accepts one upload. Nothing is registered if there is any error, so fix the listed rows and choose the file again.",
  "물품 엑셀 파일": "Item spreadsheet file",
  "엑셀 파일을 검사하는 중입니다.": "Checking the spreadsheet…",
  "물품 {count}개": "{count} {count|item|items}",
  "· 오류 {count}건": "· {count} {count|error|errors}",
  "물품 등록": "Register items",
  "{count}개 물품을 등록합니다. 등록 후에는 이 회차에 다시 업로드할 수 없습니다.":
    "This registers {count} {count|item|items}. You cannot upload to this round again afterwards.",
  등록: "Register",
  "{count}개 물품을 등록했습니다.": "Registered {count} {count|item|items}.",
  "신청 결과 엑셀 파일을 저장했습니다.": "Saved the results spreadsheet.",
  "신청·취소 이력 {count}건":
    "{count} application and cancellation {count|record|records}",
  펼치기: "Expand",
  "알 수 없음": "Unknown",
  "신청 {date}": "Applied {date}",
  "취소 {date}": "Cancelled {date}",

  // Round editing
  "회차 이름": "Round name",
  "신청 시작 (한국 시간)": "Applications open (Korea time)",
  "신청 종료 (한국 시간)": "Applications close (Korea time)",
  "회차를 수정했습니다.": "Round updated.",
  "수정 중 오류가 발생했습니다.": "Something went wrong while saving.",
  "회차 이름과 신청 기간을 확인해 주세요.":
    "Check the round name and the application period.",
  저장: "Save",
  "신청 기간 변경": "Change application period",
  "이미 시작된 회차입니다. 기간을 바꾸면 학생 신청이 바로 열리거나 닫힐 수 있습니다.":
    "This round has already started. Changing the period may open or close student applications immediately.",
  변경: "Change",

  // Server error mapping
  "이미 다른 학생이 신청한 물품입니다.":
    "Another student has already applied for this item.",
  "접근 권한이 없습니다.": "You do not have access.",
  "한 회차에 최대 50개까지 신청할 수 있습니다.":
    "You can apply for up to 50 items per round.",
  "다른 회차와 신청 기간이 겹칩니다.":
    "The application period overlaps another round.",
  "이미 물품이 등록된 회차입니다. 새 회차에 업로드해 주세요.":
    "This round already has items. Upload to a new round.",
  "신청이 종료된 회차에는 업로드할 수 없습니다.":
    "You cannot upload to a round whose applications have ended.",

  // Workbook parsing (Korean column names match the Excel template)
  ".xlsx 파일만 업로드할 수 있습니다.": "Only .xlsx files can be uploaded.",
  "8MB 이하의 엑셀 파일만 업로드할 수 있습니다.":
    "Only spreadsheets up to 8MB can be uploaded.",
  "{sheet}: 지원하지 않는 시트입니다. 엑셀 양식을 확인해 주세요.":
    "{sheet}: unsupported sheet. Check the spreadsheet template.",
  "{sheet} {row}행: 필수 열 ‘물품명’이 없습니다.":
    "{sheet} row {row}: required column ‘물품명’ is missing.",
  "{sheet} {row}행: 필수 열 ‘색상’이 없습니다.":
    "{sheet} row {row}: required column ‘색상’ is missing.",
  "{sheet} {row}행: 필수 열 ‘기증자’가 없습니다.":
    "{sheet} row {row}: required column ‘기증자’ is missing.",
  "{sheet} {row}행": "{sheet} row {row}",
  "{location}: 반복된 헤더 행입니다. 중복 헤더를 제거해 주세요.":
    "{location}: repeated header row. Remove the duplicate header.",
  "{location}: 물품명은 1~300자의 텍스트로 입력해 주세요.":
    "{location}: the item name must be text of 1–300 characters.",
  "{location}: 상세 정보는 200자 이하의 텍스트로 입력해 주세요.":
    "{location}: details must be text of at most 200 characters.",
  "{location}: 기증자 이름은 100자 이하의 텍스트로 입력해 주세요.":
    "{location}: the donor name must be text of at most 100 characters.",
  "{location}: 색상이 필요합니다.": "{location}: a color is required.",
  "{location}: 기증자 이름이 필요합니다.":
    "{location}: a donor name is required.",
  "등록할 물품이 없습니다.": "There are no items to register.",
  "한 회차에 최대 3,000개까지 등록할 수 있습니다.":
    "You can register up to 3,000 items per round.",
};
