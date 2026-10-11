import type {
  Conversation,
  ConversationMessage,
} from "~/features/messaging/model/types";

const viewer = {
  id: "viewer",
  name: "김한결",
  avatarUrl: null,
};

/** 서버가 마지막 메시지 미리보기를 따로 주는 모양을 흉내 낸다. */
function lastMessageOf(messages: ConversationMessage[]) {
  const last = messages.at(-1);
  return last
    ? { senderId: last.senderId, body: last.body, sentAt: last.sentAt }
    : null;
}

const studentCouncilMessages: ConversationMessage[] = [
  {
    id: "m1",
    senderId: null,
    body: "박서현님이 대화 이름을 ‘학생회 기획부’로 변경했습니다.",
    sentAt: "2026-08-28T15:08:00+09:00",
    system: true,
  },
  {
    id: "m2",
    senderId: "seo",
    body: "축제 부스 배치 초안 확인했어요?",
    sentAt: "2026-08-28T15:12:05+09:00",
  },
  {
    id: "m3",
    senderId: "seo",
    body: "수정할 부분 있으면 오늘 안에 알려주세요.",
    sentAt: "2026-08-28T15:12:30+09:00",
    reactions: [{ reaction: "like", count: 3 }],
  },
  {
    id: "m4",
    senderId: "viewer",
    body: "확인했습니다! 2층 체험 부스 동선만 조금 넓히면 좋을 것 같아요.",
    sentAt: "2026-08-28T15:18:00+09:00",
    unreadMemberCount: 0,
  },
  {
    id: "m5",
    senderId: "min",
    body: "관련 자료는 여기에도 정리해 두었어요.\nhttps://www.kmlaonline.net",
    sentAt: "2026-08-28T15:25:00+09:00",
    pinned: true,
  },
  {
    id: "m6",
    senderId: "viewer",
    body: "고마워요 🙌",
    sentAt: "2026-08-28T15:31:00+09:00",
    unreadMemberCount: 2,
  },
  {
    id: "m7",
    senderId: "min",
    body: "삭제된 메시지입니다",
    sentAt: "2026-08-28T15:32:00+09:00",
    deleted: true,
  },
  {
    id: "m8",
    senderId: "seo",
    body: "자료는 내일 다시 공유할게요.",
    sentAt: "2026-08-28T15:34:00+09:00",
    replyToMessageId: "m7",
  },
  {
    id: "m9",
    senderId: "seo",
    body: "내일 점심시간에 최종 확인할게요!",
    sentAt: "2026-08-28T15:36:00+09:00",
  },
];

const hyunwooMessages: ConversationMessage[] = [
  {
    id: "h1",
    senderId: "hyunwoo-user",
    body: "오늘 자습 끝나고 잠깐 볼 수 있어?",
    sentAt: "2026-08-28T14:41:00+09:00",
  },
  {
    id: "h2",
    senderId: "viewer",
    body: "응, 9시쯤이면 괜찮아.",
    sentAt: "2026-08-28T14:43:00+09:00",
    unreadMemberCount: 0,
  },
  {
    id: "h3",
    senderId: "hyunwoo-user",
    body: "좋아, 도서관 앞에서 보자",
    sentAt: "2026-08-28T14:44:00+09:00",
  },
];

const scienceProjectMessages: ConversationMessage[] = [
  {
    id: "s1",
    senderId: "eun",
    body: "실험 결과 파일 올렸습니다",
    sentAt: "2026-08-28T13:54:00+09:00",
  },
];

const room203Messages: ConversationMessage[] = [
  {
    id: "r1",
    senderId: "do",
    body: "우산 주인 찾았습니다 ☂️",
    sentAt: "2026-08-28T11:22:00+09:00",
  },
];

const broadcastingMessages: ConversationMessage[] = [
  {
    id: "b1",
    senderId: "jae",
    body: "다음 주 방송 순서 공유할게요",
    sentAt: "2026-08-27T20:10:00+09:00",
  },
];

export const mockConversations: Conversation[] = [
  {
    id: "student-council",
    type: "group",
    name: "학생회 기획부",
    viewerId: viewer.id,
    participants: [
      viewer,
      { id: "seo", name: "박서현", avatarUrl: null },
      { id: "min", name: "최민준", avatarUrl: null },
      { id: "ji", name: "윤지우", avatarUrl: null },
    ],
    lastMessage: lastMessageOf(studentCouncilMessages),
    unreadCount: 3,
    muted: false,
    sharedMediaCount: 18,
    sharedFileCount: 6,
    sharedLinkCount: 9,
    messages: studentCouncilMessages,
  },
  {
    id: "hyunwoo",
    type: "direct",
    name: "이현우",
    viewerId: viewer.id,
    participants: [
      viewer,
      { id: "hyunwoo-user", name: "이현우", avatarUrl: null },
    ],
    lastMessage: lastMessageOf(hyunwooMessages),
    unreadCount: 0,
    muted: false,
    sharedMediaCount: 7,
    sharedFileCount: 2,
    sharedLinkCount: 3,
    messages: hyunwooMessages,
  },
  {
    id: "science-project",
    type: "group",
    name: "과학전람회 준비",
    viewerId: viewer.id,
    participants: [
      viewer,
      { id: "eun", name: "정은재", avatarUrl: null },
      { id: "ha", name: "송하린", avatarUrl: null },
    ],
    lastMessage: lastMessageOf(scienceProjectMessages),
    unreadCount: 1,
    muted: true,
    sharedMediaCount: 4,
    sharedFileCount: 12,
    sharedLinkCount: 2,
    messages: scienceProjectMessages,
  },
  {
    id: "room-203",
    type: "group",
    name: "203호",
    viewerId: viewer.id,
    participants: [
      viewer,
      { id: "jun", name: "강준호", avatarUrl: null },
      { id: "ye", name: "김예린", avatarUrl: null },
      { id: "do", name: "남도윤", avatarUrl: null },
    ],
    lastMessage: lastMessageOf(room203Messages),
    unreadCount: 0,
    muted: false,
    sharedMediaCount: 22,
    sharedFileCount: 1,
    sharedLinkCount: 5,
    messages: room203Messages,
  },
  {
    id: "broadcasting",
    type: "group",
    name: "방송부",
    viewerId: viewer.id,
    participants: [
      viewer,
      { id: "su", name: "한수빈", avatarUrl: null },
      { id: "jae", name: "오재원", avatarUrl: null },
    ],
    lastMessage: lastMessageOf(broadcastingMessages),
    unreadCount: 0,
    muted: false,
    sharedMediaCount: 35,
    sharedFileCount: 8,
    sharedLinkCount: 11,
    messages: broadcastingMessages,
  },
];
