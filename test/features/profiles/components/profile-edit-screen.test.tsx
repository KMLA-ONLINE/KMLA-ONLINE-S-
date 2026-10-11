import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

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
  it("shows every editable field without collapsing any section", () => {
    renderScreen();

    expect(screen.getByLabelText(/이름/)).toBeVisible();
    expect(screen.getByLabelText(/slug/)).toBeVisible();
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

  /** 바꾸면 이전 주소로 공유한 링크가 끊긴다는 사실을 저장 전에 알린다(기능 명세 §12.2). */
  it("warns before a slug change breaks shared links", async () => {
    const user = userEvent.setup();
    renderScreen();

    expect(
      screen.queryByText(/더 이상 열리지 않습니다/),
    ).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/slug/), "x");

    expect(screen.getByText(/더 이상 열리지 않습니다/)).toBeVisible();
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
