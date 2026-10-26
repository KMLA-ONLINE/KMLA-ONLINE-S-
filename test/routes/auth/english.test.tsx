import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthProfile, ProfileFormValues } from "~/features/auth";
import BlockedPage from "~/routes/auth/blocked";
import ForgotPasswordPage from "~/routes/auth/forgot-password";
import LoginPage from "~/routes/auth/login";
import PendingPage from "~/routes/auth/pending";
import SetupPage from "~/routes/auth/setup";
import SignupPage from "~/routes/auth/signup";
import SuspendedPage from "~/routes/auth/suspended";
import { renderRoute, screen } from "../../router";

const profile = {
  name: "홍길동",
  type: "student",
  status: "draft",
  student_number: "260001",
  class_no: null,
  cohort: 31,
  gender: null,
  academic_track: null,
  phone_number: null,
  birthday: null,
  dorm_room: null,
  terms_agreed_at: "2026-10-20T00:00:00+00:00",
} as unknown as AuthProfile;

const values: ProfileFormValues = {
  name: "홍길동",
  type: "student",
  studentNumber: "260001",
  classNo: "",
  cohort: "31",
  gender: "",
  academicTrack: "",
  phoneNumber: "",
  birthday: "",
  dormRoom: "",
};

/** 영어를 고른 사람의 인증 화면. 기본 언어는 한국어라 다른 테스트는 영향을 받지 않는다. */
describe("auth screens in English", () => {
  beforeEach(() => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
  });

  afterEach(() => window.localStorage.clear());

  it("translates the login screen", async () => {
    renderRoute(LoginPage, { path: "/login" });

    expect(
      await screen.findByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
    expect(screen.getByText("KMLA community")).toBeVisible();
    expect(screen.getByLabelText("Email")).toBeRequired();
    expect(screen.getByLabelText("Password")).toBeRequired();
    expect(screen.getByRole("button", { name: "Show Password" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Log in" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/signup",
    );
    expect(
      screen.getByRole("link", { name: "Reset password" }),
    ).toHaveAttribute("href", "/forgot-password");
    expect(
      screen.getByRole("link", { name: "Terms of service" }),
    ).toHaveAttribute("href", "/terms-of-service");
  });

  it("translates the signup credential step", async () => {
    renderRoute(SignupPage as ComponentType<any>, {
      path: "/signup",
      loader: () => ({ draft: null, contacts: Promise.resolve([]) }),
    });

    expect(
      await screen.findByRole("heading", {
        name: "Get started with KMLA Online",
      }),
    ).toBeVisible();
    expect(screen.getByRole("list", { name: "Signup steps" })).toBeVisible();
    expect(screen.getByText("Account")).toBeVisible();
    expect(screen.getByText("Email verification")).toBeVisible();
    expect(screen.getByLabelText("Confirm password")).toBeRequired();
    expect(screen.getByRole("button", { name: "Next" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("translates the signup verification step", async () => {
    renderRoute(SignupPage as ComponentType<any>, {
      path: "/signup",
      loader: () => ({
        draft: { email: "student@kmla.hs.kr", values },
        contacts: Promise.resolve([]),
      }),
    });

    expect(await screen.findByLabelText("Verification code")).toBeVisible();
    expect(
      screen.getByText("Enter the 6-digit code we sent to student@kmla.hs.kr."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Resend verification code" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Submit application" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Start over with another email" }),
    ).toBeVisible();
  });

  it("translates the profile setup screen", () => {
    const Setup = SetupPage as ComponentType<any>;
    renderRoute(
      () => (
        <Setup
          loaderData={{
            email: "student@kmla.hs.kr",
            profile,
            rejection: { reason: "학번 오타" },
            values,
          }}
        />
      ),
      { path: "/setup" },
    );

    expect(
      screen.getByRole("heading", { name: "Resubmit your application" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Your application was rejected" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Name")).toHaveValue("홍길동");
    expect(screen.getByLabelText("Student ID")).toHaveValue("260001");
    expect(screen.getByLabelText("Cohort")).toHaveValue(31);
    expect(
      screen.getByRole("option", { name: "Current student" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Gender (optional)")).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: /Terms of service/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Submit application" }),
    ).toBeDisabled();
  });

  it("translates the pending approval screen", async () => {
    const Pending = PendingPage as ComponentType<any>;
    renderRoute(
      () => (
        <Pending
          loaderData={{
            email: "student@kmla.hs.kr",
            profile: { ...profile, status: "pending" },
            contacts: Promise.resolve([]),
          }}
        />
      ),
      { path: "/pending" },
    );

    expect(
      await screen.findByRole("heading", {
        name: "Reviewing your application",
      }),
    ).toBeVisible();
    expect(
      screen.getByText("An admin is reviewing 홍길동's information."),
    ).toBeVisible();
    expect(screen.getByText("Pending approval")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Check approval status" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Log in with another account" }),
    ).toBeVisible();
  });

  it("translates the blocked screen", async () => {
    const Blocked = BlockedPage as ComponentType<any>;
    renderRoute(
      () => (
        <Blocked
          loaderData={{
            email: "student@kmla.hs.kr",
            profile: { ...profile, status: "blocked" },
            contacts: Promise.resolve([]),
          }}
        />
      ),
      { path: "/blocked" },
    );

    expect(
      await screen.findByRole("heading", {
        name: "Your application was blocked",
      }),
    ).toBeVisible();
    expect(screen.getByText("Signup blocked")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Check block status" }),
    ).toBeVisible();
  });

  it("translates the suspended screen with an English end time", async () => {
    const Suspended = SuspendedPage as ComponentType<any>;
    renderRoute(
      () => (
        <Suspended
          loaderData={{
            profile: { ...profile, status: "accepted" },
            suspension: {
              reason: "분탕 행위 확인",
              expires_at: "2026-10-23T12:05:00Z",
            },
            contacts: Promise.resolve([]),
          }}
        />
      ),
      { path: "/suspended" },
    );

    expect(
      await screen.findByRole("heading", { name: "Your account is suspended" }),
    ).toBeVisible();
    expect(screen.getByText("Reason")).toBeVisible();
    expect(screen.getByText("분탕 행위 확인")).toBeVisible();
    expect(screen.getByText(/Oct 23, 2026, 21:05 KST/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Check suspension status" }),
    ).toBeVisible();
  });

  it("translates the forgot password screen", async () => {
    renderRoute(ForgotPasswordPage, { path: "/forgot-password" });

    expect(
      await screen.findByRole("heading", { name: "Forgot your password?" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "If you have an account, a verification code is on its way.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Send verification code" }),
    ).toBeVisible();
  });
});
