import { screen } from "@testing-library/react";
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
  it("keeps rarely edited identity fields collapsed behind a summary", () => {
    renderScreen();

    // 값은 요약 줄로 계속 보인다. 뒤로 미룬 것은 확인이 아니라 편집이다.
    expect(
      screen.getByText(
        "@hanbyeol-26 · 이한별 · 2009년 3월 1일 · 여성 · 국제 계열",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText(/이름/)).not.toBeVisible();
    expect(screen.getByLabelText(/slug/)).not.toBeVisible();

    // 학기마다 고치는 값은 접지 않는다.
    expect(screen.getByLabelText("반")).toBeVisible();
    expect(screen.getByLabelText("기숙사 방")).toBeVisible();
  });

  /**
   * slug는 프로필 주소라 되돌릴 수 없는 값이 아니지만, 예약어나 이미 쓰이는 값은 저장이
   * 거절된다. 그 오류가 접힌 칸 안에 있으면 아무도 못 본다(기능 명세 §12.2).
   */
  it("opens the identity section when the slug is rejected", () => {
    const actionData = submit({ pubId: "admin" });

    expect(actionData.errors?.pubId).toBeDefined();

    renderScreen(actionData);

    expect(screen.getByLabelText(/slug/)).toBeVisible();
    expect(screen.getByText(String(actionData.errors?.pubId))).toBeVisible();
  });

  it("opens the identity section when a submission is rejected inside it", () => {
    const actionData = submit({
      birthdayYear: "",
      birthdayMonth: "",
      birthdayDay: "",
    });

    expect(actionData.errors?.birthday).toBeDefined();

    renderScreen(actionData);

    // 접힌 칸의 오류는 아무도 못 본다. 펼친 채로 렌더돼야 한다.
    expect(screen.getByLabelText(/이름/)).toBeVisible();
    expect(screen.getByText(String(actionData.errors?.birthday))).toBeVisible();
  });
});
