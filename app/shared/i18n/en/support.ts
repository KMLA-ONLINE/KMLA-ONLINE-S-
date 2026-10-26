export const support: Record<string, string> = {
  // 도움말 주제
  계정: "Account",
  알림: "Notifications",
  "피드 및 게시물": "Feed and posts",
  채팅: "Chat",
  "사진 및 첨부": "Photos and attachments",
  "익명 및 반응": "Anonymity and reactions",
  신고: "Report",
  "그룹 및 권한": "Groups and permissions",
  "기타 기능": "Other features",
  "문의 그룹": "Support group",

  // 계정
  "비밀번호를 바꾸고 싶어요.": "I want to change my password.",
  "설정 → [비밀번호 변경](/settings/password)에서 바꿉니다. 설정은 모바일에서는 메뉴 화면의 톱니바퀴, 데스크톱에서는 상단 프로필 아바타 메뉴에서 엽니다. 가입할 때 쓴 메일로 인증 코드를 보내 본인을 확인합니다.":
    "Go to Settings → [Change password](/settings/password). On mobile, open Settings from the gear icon on the Menu screen; on desktop, from the profile avatar menu at the top. We send a verification code to the email you signed up with to confirm it's you.",
  "주소창이 안보이게 앱처럼 설치할 수 있나요?":
    "Can I install it like an app, without the address bar?",
  "네. 그리고 **적극 추천**합니다. Chrome이나 Safari에서 브라우저 메뉴의 **앱 설치**(또는 **공유 - 홈 화면에 추가**)를 누르면 설치됩니다. 설치하면 전체 화면으로 열리고 알림도 더 안정적으로 받을 수 있습니다.":
    "Yes, and we **strongly recommend** it. In Chrome or Safari, choose **Install app** (or **Share → Add to Home Screen**) from the browser menu. Once installed, the app opens full screen and notifications are more reliable.",

  // 알림
  "기기 알림이 뭔가요?": "What are device notifications?",
  "휴대폰이나 컴퓨터의 알림창에 뜨는 알림입니다. 앱을 열어 두지 않아도 받을 수 있습니다.":
    "Notifications that appear in your phone's or computer's notification tray. You receive them even when the app is not open.",
  "알림 설정은 어디서 하나요?": "Where do I change notification settings?",
  "설정 → [알림 설정](/settings/noti)에서 기기 알림을 켜고 끄거나 받을 알림 종류를 고릅니다. 설정은 모바일에서는 메뉴 화면의 톱니바퀴, 데스크톱에서는 상단 프로필 아바타 메뉴에서 엽니다.":
    "Go to Settings → [Notification settings](/settings/noti) to turn device notifications on or off and choose which notifications you receive. On mobile, open Settings from the gear icon on the Menu screen; on desktop, from the profile avatar menu at the top.",
  "앱을 지웠다가 다시 설치했더니 기기 알림이 안 와요.":
    "I deleted and reinstalled the app, and device notifications stopped.",
  "앱을 지우면 기기의 알림 허용도 함께 초기화됩니다. 다시 설치한 뒤 [알림 설정](/settings/noti)에서 기기 알림을 다시 켜고 알림을 허용해 주세요.":
    "Deleting the app also resets the device's notification permission. After reinstalling, turn device notifications back on in [Notification settings](/settings/noti) and allow notifications again.",
  "기기 알림을 껐는데 앱 안에는 알림이 왜 떠요?":
    "I turned off device notifications, so why do notifications still show in the app?",
  "기기 알림과 앱 안의 알림함은 별개입니다. 기기 알림을 꺼도 앱 안 알림은 남을 수 있습니다.":
    "Device notifications and the in-app inbox are separate. Turning off device notifications does not clear the in-app ones.",
  "그룹별 알림은 어떻게 설정하나요?": "How do I set notifications per group?",
  "기본적으로 공식 그룹은 새 게시물을 받고, 비공식 그룹은 나와 관련된 활동만 받습니다. [알림 설정](/settings/noti)이나 그룹 화면의 ⋯ 메뉴에서 ‘알림 설정’을 선택해 바꿀 수 있습니다.":
    "By default, official groups notify you of new posts, and unofficial groups only of activity that involves you. Change this in [Notification settings](/settings/noti) or by choosing 'Notification settings' from the ⋯ menu on the group screen.",
  "알림 설정을 바꾸면 다른 기기에도 똑같이 적용되나요?":
    "If I change notification settings, do they apply to my other devices too?",
  "기기 알림 전체 켜기/끄기는 지금 쓰는 기기에만 적용됩니다. 반면 알림 종류나 그룹별 알림 수신 여부 같은 설정은 계정 전체에 적용됩니다. [알림 설정](/settings/noti)에서 확인할 수 있습니다.":
    "Turning device notifications on or off applies only to the device you are using. Settings such as notification types and per-group notifications apply to your whole account. You can check them in [Notification settings](/settings/noti).",

  // 피드 및 게시물
  "홈 피드는 최신순인가요?": "Is the home feed sorted by newest?",
  "최신순을 기준으로 하되, 게시 후 6시간 동안 댓글과 반응을 반영해 순서가 달라질 수 있습니다.":
    "It is mostly newest first, but for 6 hours after posting, comments and reactions can move a post up or down.",
  "#업이 무엇인가요?": "What is #업?",
  "#업은 그룹 게시물을 홈 피드 위쪽으로 다시 올리는 기능입니다. 그룹 내부 정렬과 개인 게시물에는 적용되지 않습니다.":
    "#업 bumps a group post back toward the top of the home feed. It does not affect the order inside a group or personal posts.",
  "#업은 어떻게 쓰나요?": "How do I use #업?",
  "그룹 게시물의 최상위 댓글에 실명 또는 운영진 명의로 정확히 **#업**을 입력해 주세요. 답글·익명 댓글·댓글 수정에는 적용되지 않으며, 한 번 적용된 글은 1시간 뒤 다시 사용할 수 있습니다. 적용된 #업 댓글은 수정하거나 삭제할 수 없습니다.":
    "Write exactly **#업** as a top-level comment on a group post, under your real name or as a group staff member. It does not work in replies, anonymous comments, or edited comments, and a post can be bumped again 1 hour after the last bump. A #업 comment that has taken effect cannot be edited or deleted.",

  // 채팅
  "채팅 메시지는 어떻게 저장되나요?": "How are chat messages stored?",
  "메시지 본문과 첨부 파일 이름은 암호화해 저장합니다. 데이터베이스 내용이나 백업을 직접 보더라도 평문은 보이지 않습니다.":
    "Message text and attachment file names are stored encrypted. Even someone looking directly at the database or a backup cannot read them in plain text.",
  "채팅방에 중간에 초대되면 이전 메시지도 보이나요?":
    "If I'm invited to a conversation later, can I see earlier messages?",
  "아니요. 초대된 이후에 온 메시지만 보입니다. 나갔다가 다시 초대되면 나가 있던 동안의 메시지는 보이지 않습니다.":
    "No. You only see messages sent after you were invited. If you leave and are invited again, messages sent while you were away stay hidden.",

  // 사진 및 첨부
  "사진이나 파일 업로드가 이상해요.":
    "Photo or file uploads aren't working right.",
  "사진은 최적화를 위해 WebP로 바꿔 업로드합니다. 그 밖의 문제라면 [문의 그룹](/groups/support)으로 알려 주세요.":
    "Photos are converted to WebP before upload to optimize them. For any other problem, let us know in the [Support group](/groups/support).",
  "어떤 파일을 올릴 수 있나요?": "Which files can I upload?",
  "사진은 JPG·PNG·WebP·HEIC·HEIF를 지원합니다. **동영상을 제외한** 일반 파일도 첨부할 수 있습니다. 원본 사진과 일반 파일은 파일당 최대 30MB, 게시물당 최대 30개까지 선택할 수 있습니다. 사진은 업로드 전에 최적화됩니다.":
    "Photos can be JPG, PNG, WebP, HEIC, or HEIF. You can also attach other files, **except videos**. Original photos and other files can be up to 30MB each and up to 30 per post. Photos are optimized before upload.",

  // 익명 및 반응
  "좋아요 같은 반응도 익명으로 남길 수 있나요?":
    "Can reactions like likes be anonymous too?",
  "아니요. 글이나 댓글은 그룹 설정에 따라 익명으로 쓸 수 있지만, 반응은 항상 실명으로 남습니다.":
    "No. Posts and comments can be anonymous depending on the group's settings, but reactions always show your real name.",
  "익명으로 쓴 글이나 댓글의 작성자가 관리자에게는 보이나요?":
    "Can admins see who wrote an anonymous post or comment?",
  "아니요. 관리자와 매니저 모두 실제 작성자를 확인할 수 없습니다. 신고된 익명 글을 운영진이 검토할 때도 작성자 정보는 공개되지 않습니다.":
    "No. Neither admins nor managers can see the real author. Even when group staff review a reported anonymous post, the author is not revealed.",
  "익명 글을 신고하면 운영진이 작성자를 알 수 있나요?":
    "If I report an anonymous post, can group staff find out who wrote it?",
  "아니요. 신고되더라도 익명 작성자의 실명은 공개되지 않습니다.":
    "No. Even when reported, an anonymous author's real name is not revealed.",

  // 신고
  "신고한 글은 누가 확인하나요?": "Who reviews reported posts?",
  "해당 그룹의 소유자, 관리자, 매니저가 신고 내용을 확인할 수 있습니다. 다만 신고된 글의 삭제나 처리는 소유자와 관리자만 가능하며, 매니저는 확인만 할 수 있습니다.":
    "The group's owner, admins, and managers can see reports. Only the owner and admins can delete or act on a reported post; managers can only view it.",
  "신고하면 제가 신고했다는 사실도 공개되나요?":
    "If I report something, will others know it was me?",
  "아니요. 신고자 정보는 공개되지 않습니다.":
    "No. The reporter's identity is not revealed.",

  // 그룹 및 권한
  "비공식 그룹에 다른 사람을 어떻게 초대하나요?":
    "How do I invite someone to an unofficial group?",
  "그룹 설정에서 초대 링크를 생성해 공유하는 방식으로만 초대할 수 있습니다. 특정 개인을 지정해 초대하는 기능은 없습니다.":
    "The only way is to create an invite link in the group settings and share it. There is no way to invite a specific person directly.",
  "공식 그룹에서 나갈 수 있나요?": "Can I leave an official group?",
  "재학생은 공식 그룹에 자동 가입되며, 탈퇴할 수 없습니다.":
    "Current students are added to official groups automatically and cannot leave them.",
  "그룹의 소유자와 관리자는 어떻게 다른가요?":
    "What is the difference between a group owner and an admin?",
  "소유자는 비공식 그룹 삭제와 소유권 이전 권한을 가집니다. 관리자는 소유권을 이전하거나 그룹을 삭제할 수 없습니다. 공식 그룹은 앱 관리자만 삭제할 수 있습니다.":
    "The owner can delete an unofficial group and transfer ownership. Admins cannot transfer ownership or delete the group. Official groups can only be deleted by an app admin.",
  "그룹의 관리자와 매니저는 어떻게 다른가요?":
    "What is the difference between a group admin and a manager?",
  "관리자는 그룹 전반을 관리하며, 멤버 관리, 가입 승인, 초대, 그룹 설정 변경, 타인의 글·댓글 삭제 권한을 갖습니다. 매니저는 게시물 고정, 카테고리 관리 등 게시판 운영을 담당하지만, 멤버 관리나 타인의 글 삭제는 할 수 없습니다.":
    "Admins manage the whole group: members, join approvals, invites, group settings, and deleting other people's posts and comments. Managers run the board, such as pinning posts and managing categories, but cannot manage members or delete other people's posts.",
  "그룹 운영진인 것을 가리고 싶어요":
    "I don't want people to see that I'm group staff",
  "그룹 설정에서 멤버 목록의 운영진 역할 표시를 숨길 수 있습니다. 소유자와 관리자는 모든 역할을 볼 수 있으며, 게시물·댓글의 운영진 표시는 유지됩니다.":
    "In the group settings you can hide staff roles from the member list. The owner and admins still see every role, and the staff badge on posts and comments stays.",
  "앱 전체 관리자의 권한은 무엇인가요?": "What can app admins do?",
  "회원가입 최초 수락, 공강 관리자 지정·해제, 공식 그룹 생성·삭제 권한을 가집니다. 특정 그룹, 메시지, 게시물의 열람 권한은 없습니다.":
    "They approve new sign-ups, assign and remove free-period admins, and create and delete official groups. They cannot read any particular group, message, or post.",

  // 기타 기능
  "스토리는 누구에게 보이나요?": "Who can see stories?",
  "교사의 스토리는 모두에게, 재학생의 스토리는 재학생과 교사에게 보입니다. 졸업생에게는 재학생의 스토리가 보이지 않습니다.":
    "Teachers' stories are visible to everyone; current students' stories are visible to current students and teachers. Alumni cannot see current students' stories.",
  "공강이나 노래방 예약은 언제 열리나요?":
    "When do free-period and karaoke bookings open?",
  "매주 월요일 0시에 그 주 예약이 열리며, 해당 주 일요일까지의 자리만 예약할 수 있습니다.":
    "Bookings for each week open at midnight on Monday, and you can only book slots through that week's Sunday.",

  // 오픈소스 라이선스
  "이모지 그래픽은 {twemoji} (© Twitter, Inc 및 기여자들)를 사용하며, {license} 라이선스를 따릅니다.":
    "Emoji graphics use {twemoji} (© Twitter, Inc and contributors) under the {license} license.",
  "HEIC/HEIF 이미지 변환에는 {heicTo} 및 libheif를 사용하며 LGPL-3.0 라이선스를 따릅니다.":
    "HEIC/HEIF image conversion uses {heicTo} and libheif under the LGPL-3.0 license.",
};
