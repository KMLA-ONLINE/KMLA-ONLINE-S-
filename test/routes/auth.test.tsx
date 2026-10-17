import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";

import type {
  AuthProfile,
  AuthState,
  ProfileFormValues,
} from "~/features/auth";
import { getProfileDestination, sanitizeLoginNext } from "~/features/auth";
import BlockedPage from "~/routes/auth/blocked";
import LoginPage from "~/routes/auth/login";
import SetupPage from "~/routes/auth/setup";
import SignupPage, { clientAction as signupAction } from "~/routes/auth/signup";
import { renderRoute, screen } from "../router";

const draftProfile = {
  academic_track: "international",
  birthday: "2009-03-01",
  class_no: 2,
  cohort: 31,
  dorm_room: 304,
  gender: "female",
  name: "홍길동",
  phone_number: "010-1234-5678",
  status: "draft",
  student_number: "260001",
  type: "student",
} as AuthProfile;

const draftValues: ProfileFormValues = {
  academicTrack: "international",
  birthday: "2009-03-01",
  classNo: "2",
  cohort: "31",
  dormRoom: "304",
  gender: "female",
  name: "홍길동",
  phoneNumber: "010-1234-5678",
  studentNumber: "260001",
  type: "student",
};

/** `clientAction` expects the framework's arg shape; the stub only supplies a request. */
const signupStubAction = ({ request }: { request: Request }) =>
  (signupAction as (args: { request: Request }) => unknown)({ request });

/**
 * Enter와 모바일 키보드의 '이동'이 누르는 버튼. HTML은 tree order상 첫 submit 버튼을
 * 폼의 기본 버튼으로 삼으므로, 보조 동작이 submit이면 그쪽이 대신 실행된다.
 */
function defaultButtons() {
  return screen
    .getAllByRole("button")
    .filter((button) => (button as HTMLButtonElement).type === "submit");
}

describe("auth routes", () => {
  it("offers admin contacts on login only after a failed sign-in", async () => {
    const contacts = Promise.resolve([
      { kind: "email", label: "학생회 메일", value: "council@kmla.hs.kr" },
    ]);
    const { user } = renderRoute(LoginPage as ComponentType<any>, {
      path: "/login",
      loader: () => ({ contacts }),
      action: () => ({
        errors: { form: "이메일 또는 비밀번호가 올바르지 않습니다." },
        email: "student@kmla.hs.kr",
      }),
    });

    await screen.findByRole("heading", { name: "다시 만나서 반가워요" });
    expect(
      screen.queryByRole("button", { name: "계속 로그인이 안 되나요?" }),
    ).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("이메일"), "student@kmla.hs.kr");
    await user.type(screen.getByLabelText("비밀번호"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "로그인" }));

    expect(
      await screen.findByRole("button", { name: "계속 로그인이 안 되나요?" }),
    ).toBeVisible();
  });

  // 인증을 안 끝낸 계정은 로그인 화면에서 코드를 받을 길이 없다. 가입을 다시 진행하면
  // 같은 이메일로 코드를 새로 받을 수 있으니 그쪽으로 이어 준다.
  it("links an unconfirmed account back to signup", async () => {
    const { user } = renderRoute(LoginPage as ComponentType<any>, {
      path: "/login",
      loader: () => ({ contacts: Promise.resolve([]) }),
      action: () => ({
        errors: { form: "이메일 인증이 끝나지 않은 계정이에요." },
        email: "student@kmla.hs.kr",
        unconfirmed: true,
      }),
    });

    await user.type(
      await screen.findByLabelText("이메일"),
      "student@kmla.hs.kr",
    );
    await user.type(screen.getByLabelText("비밀번호"), "password123");
    await user.click(screen.getByRole("button", { name: "로그인" }));

    expect(
      await screen.findByRole("link", { name: "회원가입에서 인증 이어가기" }),
    ).toHaveAttribute("href", "/signup");
  });

  it("renders login controls and toggles password visibility", async () => {
    const { user } = renderRoute(LoginPage, { path: "/login" });
    const password = screen.getByLabelText("비밀번호");

    expect(
      screen.getByRole("heading", { name: "다시 만나서 반가워요" }),
    ).toBeVisible();
    expect(password).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "비밀번호 표시하기" }));
    expect(password).toHaveAttribute("type", "text");
  });

  it("renders signup credential fields", async () => {
    renderRoute(SignupPage as ComponentType<any>, {
      path: "/signup",
      loader: () => ({ draft: null, contacts: Promise.resolve([]) }),
    });

    expect(
      await screen.findByRole("heading", { name: "KMLA Online 시작하기" }),
    ).toBeVisible();
    expect(screen.getByLabelText("이메일")).toBeRequired();
    expect(screen.getByLabelText("비밀번호 확인")).toBeRequired();
  });

  it("collects the profile before asking for a verification code", async () => {
    const { user } = renderRoute(SignupPage as ComponentType<any>, {
      path: "/signup",
      loader: () => ({ draft: null, contacts: Promise.resolve([]) }),
      action: signupStubAction,
    });

    await user.type(
      await screen.findByLabelText("이메일"),
      "student@kmla.hs.kr",
    );
    await user.type(screen.getByLabelText("비밀번호"), "password123");
    await user.type(screen.getByLabelText("비밀번호 확인"), "password123");
    await user.click(screen.getByRole("button", { name: "다음" }));

    // 프로필 단계에서는 아직 계정도 코드도 만들어지지 않는다.
    expect(await screen.findByLabelText("이름")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "인증 코드 받기" }),
    ).toBeVisible();
    expect(screen.queryByLabelText("인증 코드")).not.toBeInTheDocument();

    // '이전'이 기본 버튼이면 프로필 칸에서 Enter를 눌렀을 때 단계가 되감긴다.
    expect(defaultButtons()).toHaveLength(1);
    expect(defaultButtons()[0]).toHaveAccessibleName("인증 코드 받기");
  });

  it("keeps submission as the default button on the verification step", async () => {
    renderRoute(SignupPage as ComponentType<any>, {
      path: "/signup",
      loader: () => ({
        draft: { email: "student@kmla.hs.kr", values: draftValues },
        contacts: Promise.resolve([]),
      }),
    });

    expect(await screen.findByLabelText("인증 코드")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "인증 코드 다시 보내기" }),
    ).toBeVisible();
    // 다시 로드돼 돌아온 인증 단계라 비밀번호가 없다. 계정을 넘겨받으려면 다시 받아야 한다.
    expect(screen.getByLabelText("비밀번호")).toBeVisible();
    expect(screen.getByLabelText("비밀번호 확인")).toBeVisible();

    // 코드를 입력하고 '이동'을 눌렀을 때 재발송이 아니라 제출이 실행되어야 한다.
    expect(defaultButtons()).toHaveLength(1);
    expect(defaultButtons()[0]).toHaveAccessibleName("가입 신청 제출");
  });

  it("routes every profile state to its auth destination", () => {
    expect(getProfileDestination(null)).toBe("/setup");
    expect(getProfileDestination({ status: "draft" } as AuthProfile)).toBe(
      "/setup",
    );
    expect(getProfileDestination({ status: "pending" } as AuthProfile)).toBe(
      "/pending",
    );
    expect(getProfileDestination({ status: "blocked" } as AuthProfile)).toBe(
      "/blocked",
    );
    expect(getProfileDestination({ status: "accepted" } as AuthProfile)).toBe(
      "/",
    );
    expect(getProfileDestination({ status: "withdrawn" } as AuthProfile)).toBe(
      "/login",
    );
  });

  it("restores only safe app-relative login destinations for accepted users", () => {
    expect(sanitizeLoginNext("/noti/open/notification-id")).toBe(
      "/noti/open/notification-id",
    );
    expect(sanitizeLoginNext("//evil.example/path")).toBeNull();
    expect(sanitizeLoginNext("https://evil.example/path")).toBeNull();
    expect(
      getProfileDestination(
        { status: "accepted" } as AuthProfile,
        "/noti/open/notification-id",
      ),
    ).toBe("/noti/open/notification-id");
    expect(
      getProfileDestination(
        { status: "pending" } as AuthProfile,
        "/noti/open/notification-id",
      ),
    ).toBe("/pending");
  });

  it("prefills a draft profile for review and resubmission", () => {
    const Setup = SetupPage as ComponentType<any>;

    renderRoute(
      () => (
        <Setup
          loaderData={{
            email: "student@kmla.hs.kr",
            profile: draftProfile,
            values: draftValues,
          }}
        />
      ),
      { path: "/setup" },
    );

    expect(screen.getByLabelText("이름")).toHaveValue("홍길동");
    expect(screen.getByLabelText("학번")).toHaveValue("260001");
    expect(
      screen.getByText(
        "입력한 정보를 확인하고 필요한 내용을 수정한 뒤 다시 제출해 주세요.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/거절/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("인증 코드")).not.toBeInTheDocument();
  });

  it("shows blocked external-member guidance and account actions", async () => {
    const state = {
      email: "student@kmla.hs.kr",
      profile: { ...draftProfile, status: "blocked" },
    } as AuthState;
    const Blocked = BlockedPage as ComponentType<any>;
    const contacts = Promise.resolve([
      { kind: "email", label: "학생회 메일", value: "council@kmla.hs.kr" },
    ]);

    const { user } = renderRoute(
      () => <Blocked loaderData={{ ...state, contacts }} />,
      { path: "/blocked" },
    );

    await user.click(
      await screen.findByRole("button", { name: "차단이 잘못된 것 같나요?" }),
    );
    expect(
      screen.getByRole("link", { name: "council@kmla.hs.kr" }),
    ).toHaveAttribute("href", "mailto:council@kmla.hs.kr");

    expect(
      screen.getByRole("heading", { name: "가입 신청이 차단되었어요" }),
    ).toBeVisible();
    expect(screen.getByText("가입 차단")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "차단 상태 확인" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "다른 계정으로 로그인" }),
    ).toBeVisible();
  });
});
