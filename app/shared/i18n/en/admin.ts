export const admin: Record<string, string> = {
  // 허브
  관리자: "Admin",
  "가입 승인": "Sign-up approval",
  "대기 신청 승인, 차단 및 차단 해제":
    "Approve, block and unblock pending applications",
  "전체 인원": "All members",
  "승인된 사용자를 기수·유형별로 보고 CSV로 내려받기":
    "Browse approved users by cohort and type, and download a CSV",
  "공강 관리자": "Free period managers",
  "공강 관리 권한 부여 및 회수": "Grant and revoke free period management",
  "앱 관리자": "App admin",
  "앱 관리자 명단, 임명 및 강등":
    "App admin roster, appointments and demotions",
  "관리자 연락처": "Admin contacts",
  "앱 밖에서 관리자에게 연락할 링크와 이메일":
    "Links and emails for reaching admins outside the app",
  "파일 정리": "File cleanup",
  "사용하지 않는 파일의 정리 상태 확인":
    "Check the cleanup status of unused files",
  "학교 공지 계정": "School notice account",
  "공지 동기화에 쓰는 학교 계정 교체와 동기화 상태":
    "Replace the school account used for notice sync and view sync status",

  // 공통 표시
  재학생: "Current student",
  교사: "Teacher",
  졸업생: "Alumni",
  예: "Yes",
  아니요: "No",
  국내반: "Domestic",
  국제반: "International",
  남성: "Male",
  여성: "Female",
  "{cohort}기": "Cohort {cohort}",
  "{count}명": "{count} {count|person|people}",
  "{count}건": "{count}",
  취소: "Cancel",
  확인: "Confirm",
  "확인 중...": "Confirming...",
  저장: "Save",
  "저장했습니다.": "Saved.",
  검색: "Search",
  이름: "Name",
  이메일: "Email",
  링크: "Link",
  없음: "None",
  나: "Me",
  전체: "All",
  이전: "Previous",
  다음: "Next",
  사유: "Reason",
  "현재 비밀번호": "Current password",
  "기수 없음": "No cohort",
  "부서 없음": "No department",
  "이름, 공개 ID 또는 기수": "Name, public ID or cohort",
  "이름, 공개 ID 또는 부서": "Name, public ID or department",
  "검색 결과가 없습니다.": "No results.",
  "두 글자 이상 입력해 검색하세요.": "Type at least two characters to search.",
  "관리자 후보 검색": "Search candidates",
  "상태 새로고침": "Refresh status",

  // 가입 승인
  "신청 상태": "Application status",
  "승인 대기": "Pending approval",
  차단: "Block",
  "전체 선택": "Select all",
  "한 번에 최대 200명": "Up to 200 at a time",
  승인: "Approve",
  반려: "Return",
  "{name} 신청 다른 처리": "{name}: other actions",
  "{name} 선택": "{name} select",
  "{count}명 선택됨": "{count} selected",
  "선택 해제": "Clear selection",
  "대기 중인 신청이 없습니다.": "No pending applications.",
  "차단 해제": "Unblock",
  "차단된 사용자가 없습니다.": "No blocked users.",
  "{count}명의 가입 차단을 해제할까요?":
    "Unblock {count} {count|sign-up|sign-ups}?",
  "{count}명의 차단을 해제했습니다.": "Unblocked {count} {count|user|users}.",
  "{count}명의 가입을 승인할까요?": "Approve {count} {count|sign-up|sign-ups}?",
  "{count}명을 승인했습니다.": "Approved {count} {count|user|users}.",
  "가입 차단": "Block sign-up",
  "{count}명의 가입을 차단할까요?": "Block {count} {count|sign-up|sign-ups}?",
  "{count}명을 차단했습니다.": "Blocked {count} {count|user|users}.",
  "학번 {number}": "Student ID {number}",
  "생일 {date}": "Birthday {date}",
  복학생: "Returning student",
  "신청 {time}": "Applied {time}",
  "이전 반려 {count}회": "Returned {count} {count|time|times} before",
  "신청 목록 페이지": "Application pages",
  "가입 반려": "Return sign-up",
  "{name}님은 사유를 보고 정보를 고쳐 다시 제출할 수 있습니다. 사유는 본인에게 이메일과 학교 프로필 설정 화면으로 공개됩니다.":
    "{name} can read the reason, fix their details and resubmit. The reason is shown to them by email and on their school profile settings.",
  "기수·학번": "Cohort/student ID",
  "사용자 유형": "User type",
  "무엇을 고쳐야 하는지 적어 주세요.": "Describe what needs to be fixed.",
  "반려했습니다.": "Returned.",

  // 전체 인원
  "승인된 사용자 {count}명": "{count} approved {count|user|users}",
  "정지 중": "Suspended",
  기수: "Cohort",
  "사용자 검색": "Search users",
  정렬: "Sort",
  이름순: "By name",
  "최신 기수순": "Newest cohort",
  "최근 승인순": "Recently approved",
  "정지 중 · {until}까지": "Suspended · until {until}",
  "정지 중 · 무기한": "Suspended · indefinitely",
  "정지 해제": "Lift suspension",
  정지: "Suspend",
  "조건에 맞는 사용자가 없습니다.": "No users match these filters.",
  "더 보기 ({count}명 남음)": "Show more ({count} left)",
  "이용 정지를 해제할까요?": "Lift the suspension?",
  "이용 정지": "Suspension",
  "{name}님이 바로 다시 앱을 이용할 수 있습니다.":
    "{name} can use the app again right away.",
  "{name}님은 정지 기간 동안 앱을 이용할 수 없습니다. 사유와 해제 예정 시각은 본인에게 공개됩니다.":
    "{name} cannot use the app while suspended. The reason and the end time are shown to them.",
  "정지 사유를 입력하세요.": "Enter the reason for the suspension.",
  "기간(일)": "Duration (days)",
  무기한: "Indefinite",

  // 공강 관리자
  "현재 관리자 {count}명": "{count} current {count|manager|managers}",
  "현재 공강 관리자가 없습니다.": "No free period managers yet.",
  "권한 회수": "Revoke access",
  "공강 관리자 후보 검색": "Search free period manager candidates",
  "관리 중": "Managing",
  "권한 부여": "Grant access",
  "공강 관리 권한 회수": "Revoke free period management",
  "공강 관리 권한 부여": "Grant free period management",
  "{name}(@{pubId})님의 공강 관리 권한을 회수합니다.":
    "Revoke free period management from {name} (@{pubId}).",
  "{name}(@{pubId})님의 공강 관리 권한을 부여합니다.":
    "Grant free period management to {name} (@{pubId}).",
  회수: "Revoke",
  부여: "Grant",

  // 앱 관리자
  "비밀번호 확인": "Confirm password",
  "관리자 명단은 민감한 정보입니다. 현재 계정의 비밀번호를 다시 입력해 주세요.":
    "The admin roster is sensitive. Enter your current password again.",
  "앱 관리자 {count}명": "{count} app {count|admin|admins}",
  "권한 해제": "Remove admin",
  "앱 관리자 후보 검색": "Search app admin candidates",
  "관리자 임명": "Appoint admin",
  "앱 관리자 강등 확인": "Confirm app admin demotion",
  "앱 관리자 임명 확인": "Confirm app admin appointment",
  "{name}(@{pubId})님의 역할을 일반 사용자로 강등합니다. 대상과 역할 변경이 맞는지 확인해 주세요.":
    "Demote {name} (@{pubId}) to a regular user. Check that the person and the role change are correct.",
  "{name}(@{pubId})님의 역할을 앱 관리자로 임명합니다. 대상과 역할 변경이 맞는지 확인해 주세요.":
    "Appoint {name} (@{pubId}) as an app admin. Check that the person and the role change are correct.",
  강등: "Demote",
  임명: "Appoint",

  // 관리자 연락처
  "로그인에 실패했을 때, 회원가입 인증 단계, 승인 대기, 가입 차단 화면에서 볼 수 있습니다. 로그인하지 않은 사람도 볼 수 있으니 개인 연락처 대신 공용 메일이나 오픈채팅 링크를 넣어 주세요.":
    "Shown after a failed login, during sign-up verification, and on the pending approval and blocked screens. Anyone can see them without logging in, so use a shared mailbox or open chat link instead of personal contacts.",
  종류: "Type",
  "예: 학생회 오픈채팅": "e.g. Student council open chat",
  "이메일 주소": "Email address",
  "링크 주소": "Link URL",
  "{n}번 연락처 위로": "Move contact {n} up",
  "{n}번 연락처 아래로": "Move contact {n} down",
  "{n}번 연락처 삭제": "Delete contact {n}",
  "등록된 연락처가 없습니다. 연락처가 없으면 문의 영역이 표시되지 않습니다.":
    "No contacts yet. Without contacts the help section is not shown.",
  "연락처 추가 ({count}/{limit})": "Add contact ({count}/{limit})",
  "입력을 확인해 주세요.": "Check your input.",

  // 파일 정리
  "정리 상태를 불러오지 못했습니다.": "Could not load the cleanup status.",
  "사용하지 않는 첨부·이미지 파일을 자동으로 정리합니다. 이 화면에서는 정리 상태만 확인할 수 있습니다.":
    "Unused attachments and images are cleaned up automatically. This screen only shows the cleanup status.",
  "정리 상태를 새로고치는 중입니다.": "Refreshing the cleanup status.",
  "자동 정리 설정": "Automatic cleanup settings",
  "{a}과 {b} 모두 있음": "Both {a} and {b} are set",
  "{a}과 {b}을 Vault에 설정해 주세요.": "Set {a} and {b} in Vault.",
  "삭제 대기 파일": "Files awaiting deletion",
  "대기 중": "Pending",
  "재시도 포함": "Including retries",
  "그중 재시도": "Of which retries",
  "정리 후보": "Cleanup candidates",
  "미리보기 · 실제로 삭제하지 않음": "Preview · nothing is deleted",
  "가장 오래된 대기": "Oldest pending",
  "마지막 실행": "Last run",
  "최근 실행 한 번의 결과입니다.": "Results of the most recent run.",
  시작: "Started",
  "응답 코드": "Status code",
  "삭제한 파일": "Files removed",
  "이미 없던 파일 포함": "Including files already gone",
  "못 지운 파일": "Files not removed",
  "예약 실행:": "Scheduled run:",
  "기록 없음": "No record",
  "정리가 멈춰 있습니다": "Cleanup is stalled",
  "Vault 시크릿이 없어 워커를 부르지 못합니다.":
    "The worker cannot be called because the Vault secrets are missing.",
  "아직 한 번도 실행되지 않았습니다": "Has not run yet",
  "대기 파일 {count}개가 실행을 기다리고 있습니다.":
    "{count} pending {count|file is|files are} waiting for a run.",
  "지울 파일이 없습니다": "Nothing to delete",
  "대기 파일도 실행 기록도 없습니다.": "No pending files and no run history.",
  "마지막 실행이 실패했습니다": "The last run failed",
  "대기 파일은 큐에 남아 다시 시도합니다.":
    "Pending files stay in the queue and will be retried.",
  "정리가 실행 중입니다": "Cleanup is running",
  "워커 응답을 기다리고 있습니다.": "Waiting for the worker to respond.",
  "일부 파일을 지우지 못했습니다": "Some files could not be removed",
  "요청은 성공했지만 {count}개가 남아 다시 시도합니다.":
    "The request succeeded, but {count} {count|file remains|files remain} and will be retried.",
  "정상 동작 중입니다": "Running normally",
  "{count}개가 다음 차례를 기다립니다.":
    "{count} {count|file is|files are} waiting for the next run.",
  "대기 중인 파일이 없습니다.": "No files are pending.",
  실패: "Failed",
  "진행 중": "In progress",
  "부분 실패": "Partially failed",
  성공: "Succeeded",

  // 학교 공지 계정
  "학교 계정이 설정되지 않았습니다.": "The school account is not set up.",
  "공지 목록을 끝까지 읽지 못했습니다. 학교 아이디·비밀번호가 맞는지 확인해 주세요.":
    "Could not read the full notice list. Check the school ID and password.",
  "공지 본문을 읽지 못했습니다. 도중에 학교 로그인이 풀렸을 수 있어 다음 동기화 때 다시 시도합니다.":
    "Could not read a notice body. The school login may have expired midway; it will be retried on the next sync.",
  "학교 서버에 연결하지 못했습니다.": "Could not connect to the school server.",
  "학교 서버가 제때 응답하지 않았습니다.":
    "The school server did not respond in time.",
  "학교 서버가 오류({status})를 돌려줬습니다.":
    "The school server returned an error ({status}).",
  "동기화 상태를 불러오지 못했습니다.": "Could not load the sync status.",
  "학교 계정으로 인트라넷에 로그인해 최신 공지 30건을 30분마다 가져옵니다.":
    "Logs in to the intranet with the school account and fetches the latest 30 notices every 30 minutes.",
  "동기화 설정이 없습니다": "Sync is not configured",
  "학교 계정을 입력해 주세요": "Enter the school account",
  "동기화 요청에 응답이 없습니다": "No response to the sync request",
  "마지막 동기화가 실패했습니다": "The last sync failed",
  "아직 동기화하지 않았습니다": "Not synced yet",
  "Vault에 {a}과 {b}을 설정해 주세요.": "Set {a} and {b} in Vault.",
  "{fn} 함수 배포와 함수 시크릿을 확인해 주세요.":
    "Check the {fn} function deployment and its secrets.",
  "학교 아이디": "School ID",
  "마지막 성공": "Last success",
  "보관 중인 공지": "Stored notices",
  "지금 동기화": "Sync now",
  "동기화를 요청했습니다. 잠시 뒤 상태를 새로고침해 주세요.":
    "Sync requested. Refresh the status in a moment.",
  "학교 계정 바꾸기": "Change school account",
  "학교가 허락한 공지 열람용 계정을 넣어 주세요. 저장하면 바로 한 번 동기화합니다.":
    "Enter the account the school allows for reading notices. Saving syncs once right away.",
  "마지막 변경:": "Last changed:",
  "학교 비밀번호": "School password",
  "저장한 비밀번호는 다시 볼 수 없습니다.":
    "The saved password cannot be viewed again.",
  "저장했습니다. 잠시 뒤 상태를 새로고침해 결과를 확인해 주세요.":
    "Saved. Refresh the status in a moment to see the result.",

  // route action / RPC 오류
  "마지막 앱 관리자는 강등할 수 없습니다.":
    "The last app admin cannot be demoted.",
  "앱 관리자는 정지할 수 없습니다. 먼저 관리자에서 내려 주세요.":
    "App admins cannot be suspended. Remove them as admin first.",
  "이미 정지 중인 사용자입니다.": "This user is already suspended.",
  "정지 중인 사용자가 아닙니다.": "This user is not suspended.",
  "이미 처리된 신청입니다. 목록을 새로고침해 주세요.":
    "This application was already handled. Refresh the list.",
  "사유를 5~300자로 입력해 주세요.": "Enter a reason of 5 to 300 characters.",
  "기간은 1~180일로 입력해 주세요.": "Enter a duration of 1 to 180 days.",
  "보안을 위해 현재 비밀번호를 다시 확인해 주세요.":
    "For security, confirm your current password again.",
  "비밀번호가 올바르지 않습니다.": "The password is incorrect.",
  "동기화 설정(Vault)이 없어 실행하지 못했습니다.":
    "Could not run because the sync configuration (Vault) is missing.",
  "학교 아이디를 입력해 주세요.": "Enter the school ID.",
  "학교 비밀번호를 입력해 주세요.": "Enter the school password.",
  "관리자 권한이 필요합니다.": "Admin access is required.",
  "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.":
    "Could not complete the request. Try again later.",
  "현재 비밀번호를 입력해 주세요.": "Enter your current password.",
  "잘못된 대상입니다.": "Invalid target.",
  "잘못된 요청입니다.": "Invalid request.",
  "지원하지 않는 요청입니다.": "Unsupported request.",
  "지원하지 않는 처리입니다.": "Unsupported action.",
  "1명에서 200명까지 선택해 주세요.": "Select between 1 and 200 people.",
};
