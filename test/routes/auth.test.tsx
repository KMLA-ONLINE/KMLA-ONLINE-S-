import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";

import type { AuthProfile, AuthState } from "~/features/auth";
import { getProfileDestination } from "~/features/auth";
import BlockedPage from "~/routes/auth/blocked";
import LoginPage from "~/routes/auth/login";
import SetupPage from "~/routes/auth/setup";
import SignupPage from "~/routes/auth/signup";
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

describe("auth routes", () => {
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

  it("renders signup credential fields", () => {
    renderRoute(SignupPage, { path: "/signup" });

    expect(
      screen.getByRole("heading", { name: "KMLA Online 시작하기" }),
    ).toBeVisible();
    expect(screen.getByLabelText("이메일")).toBeRequired();
    expect(screen.getByLabelText("비밀번호 확인")).toBeRequired();
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

  it("prefills a draft profile for review and resubmission", () => {
    const Setup = SetupPage as ComponentType<any>;

    renderRoute(
      () => (
        <Setup
          loaderData={{
            email: "student@kmla.hs.kr",
            profile: draftProfile,
            requiresOtp: false,
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
  });

  it("shows blocked external-member guidance and account actions", () => {
    const state = {
      email: "student@kmla.hs.kr",
      profile: { ...draftProfile, status: "blocked" },
    } as AuthState;

    renderRoute(() => <BlockedPage loaderData={state} />, {
      path: "/blocked",
    });

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
