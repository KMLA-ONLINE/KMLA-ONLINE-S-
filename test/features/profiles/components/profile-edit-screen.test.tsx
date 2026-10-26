import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useActionData, useNavigationType, useParams } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import {
  ProfileEditScreen,
  readProfileEditForm,
  validateProfileEdit,
} from "~/features/profiles";
import type {
  EditableProfile,
  ProfileEditActionData,
} from "~/features/profiles/model/types";
import { renderRoute } from "../../../router";

const student: EditableProfile = {
  id: 26,
  pub_id: "hanbyeol-26",
  name: "이한별",
  type: "student",
  role: "member",
  cohort: 26,
  academic_track: "international",
  avatar_path: null,
  avatar_url: null,
  cover_path: null,
  cover_url: null,
  description: "",
  birthday: "2009-03-01",
  class_no: 2,
  dorm_room: 304,
  department: null,
  gender: "female",
  phone_number: null,
  contact_email: null,
  student_number: "260001",
  allow_timeline_posts: true,
  is_returning_student: false,
};

/** 화면이 실제로 내보내는 칸 이름. 생일은 년/월/일 세 칸으로 나간다. */
const SUBMITTED_FIELDS: Record<string, string> = {
  pubId: student.pub_id,
  name: student.name,
  description: "",
  birthdayYear: "2009",
  birthdayMonth: "03",
  birthdayDay: "01",
  phoneNumber: "",
  contactEmail: "",
  gender: "female",
  academicTrack: "international",
  department: "",
  classNo: "2",
  dormRoom: "304",
  allowTimelinePosts: "on",
};

/**
 * `clientAction`이 하는 일을 그대로 되풀이한다. 오류 문구를 테스트에 베껴 두면 실제 검증이
 * 바뀌어도 테스트는 통과해 버린다.
 */
function submit(overrides: Record<string, string>): ProfileEditActionData {
  const formData = new FormData();
  for (const [key, value] of Object.entries({
    ...SUBMITTED_FIELDS,
    ...overrides,
  })) {
    formData.set(key, value);
  }

  const values = { ...readProfileEditForm(formData), cohort: student.cohort };
  return { values, errors: validateProfileEdit(values, student.type) };
}

function renderScreen(actionData?: ProfileEditActionData) {
  return renderRoute(() => (
    <ProfileEditScreen
      profile={student}
      departments={[]}
      actionData={actionData}
    />
  ));
}

describe("ProfileEditScreen", () => {
  /** 프로필 → 편집으로 들어온 history에서 저장한다. 프로필 화면은 어떤 이동으로 왔는지 보여 준다. */
  function renderFromProfile(savedPubId: string) {
    function Profile() {
      const { pubId } = useParams();
      return <p>{`${pubId} ${useNavigationType()}`}</p>;
    }

    return renderRoute(
      () => (
        <ProfileEditScreen
          profile={student}
          departments={[]}
          actionData={useActionData<ProfileEditActionData>()}
        />
      ),
      {
        path: "/profile/:pubId/edit",
        action: () => ({ savedPubId }),
        routes: [{ path: "/profile/:pubId", Component: Profile }],
        initialEntries: [
          `/profile/${student.pub_id}`,
          `/profile/${student.pub_id}/edit`,
        ],
        initialIndex: 1,
      },
    );
  }

  // 프로필로 앞으로 보내면 저장 뒤 뒤로가기가 편집 화면을 다시 열고, 둘 사이를 맴돌게 된다.
  it("goes back to the profile it came from after saving", async () => {
    const { user } = renderFromProfile(student.pub_id);

    await user.type(screen.getByLabelText("반"), "3");
    await user.click(screen.getAllByRole("button", { name: "저장" })[0]);

    expect(
      await screen.findByText(`${student.pub_id} POP`),
    ).toBeInTheDocument();
  });

  // 편집 화면만 새 주소로 바꾸면 그 앞의 옛 프로필 주소가 history에 남아 뒤로가기가 없는 주소로 간다.
  // 돌아가서 옛 주소를 프로필 loader가 새 주소로 바꿔 든다.
  it("goes back to the old address when the public id changed", async () => {
    const { user } = renderFromProfile("byeol");

    await user.type(screen.getByLabelText("반"), "3");
    await user.click(screen.getAllByRole("button", { name: "저장" })[0]);

    expect(
      await screen.findByText(`${student.pub_id} POP`),
    ).toBeInTheDocument();
  });

  it("goes back instead of stacking another profile on cancel", async () => {
    const { user } = renderFromProfile(student.pub_id);

    await user.click(screen.getByRole("link", { name: "취소" }));

    expect(
      await screen.findByText(`${student.pub_id} POP`),
    ).toBeInTheDocument();
  });

  it("leaves a modified click on cancel to the browser", async () => {
    const { user } = renderFromProfile(student.pub_id);
    const cancel = screen.getByRole("link", { name: "취소" });

    await user.keyboard("{Control>}");
    await user.click(cancel);
    await user.keyboard("{/Control}");

    // 새 탭으로 여는 손짓이다. 이 탭은 고치던 화면에 그대로 있다.
    expect(cancel).toBeInTheDocument();
    expect(screen.queryByText(`${student.pub_id} POP`)).not.toBeInTheDocument();
  });

  it("shows every editable field without collapsing any section", () => {
    renderScreen();

    expect(screen.getByLabelText(/이름/)).toBeVisible();
    expect(screen.getByLabelText(/공개 ID/)).toBeVisible();
    expect(screen.getByRole("option", { name: "국내반" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "국제반" })).toBeInTheDocument();
    expect(screen.getByLabelText("반")).toBeVisible();
    expect(screen.getByLabelText("기숙사 방")).toBeVisible();
  });

  it("keeps save disabled until something changes", async () => {
    const user = userEvent.setup();
    renderScreen();

    const [save] = screen.getAllByRole("button", { name: "저장" });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("반"), "3");

    expect(save).toBeEnabled();
  });

  it("warns that changing the public ID disconnects old links and releases the address", async () => {
    const user = userEvent.setup();
    renderScreen();

    expect(
      screen.queryByText(/이전 주소는 더 이상 내 프로필로 연결되지 않으며/),
    ).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/공개 ID/), "x");

    expect(
      screen.getByText(
        "저장하면 프로필 주소가 바로 바뀝니다. 이전 주소는 더 이상 내 프로필로 연결되지 않으며, 다른 사용자가 사용할 수 있습니다.",
      ),
    ).toBeVisible();
  });

  it("explains that disabling timeline posts affects new posts, not existing ones", () => {
    renderScreen();

    expect(
      screen.getByText(
        "끄면 다른 사람이 내 타임라인에 새 글을 작성할 수 없습니다. 기존 게시물은 유지됩니다.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("switch", { name: "내 타임라인에 다른 사람의 글 허용" }),
    ).toBeChecked();
  });

  it("shows a rejected slug next to its field", () => {
    const actionData = submit({ pubId: "admin" });

    expect(actionData.errors?.pubId).toBeDefined();

    renderScreen(actionData);

    expect(screen.getByText(String(actionData.errors?.pubId))).toBeVisible();
    // 거절당해 돌아온 값은 사용자가 고친 값이라 바로 다시 저장할 수 있다.
    expect(screen.getAllByRole("button", { name: "저장" })[0]).toBeEnabled();
  });
});

describe("ProfileEditScreen in English", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("labels the form, sections and actions in English", () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    renderScreen();

    expect(
      screen.getAllByRole("heading", { name: "Edit profile" }),
    ).not.toHaveLength(0);
    expect(screen.getAllByRole("button", { name: "Save" })).not.toHaveLength(0);
    expect(screen.getByRole("link", { name: "Cancel" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Contact" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Class")).toBeInTheDocument();
    expect(screen.getByLabelText("Phone")).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Returning student" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Lowercase letters, numbers and hyphens, 5–15 characters.",
      ),
    ).toBeInTheDocument();
  });
});
