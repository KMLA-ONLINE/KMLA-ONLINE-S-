import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminContactsScreen } from "~/features/admin/components/admin-contacts-screen";
import { renderRoute, screen } from "../../../router";

describe("AdminContactsScreen", () => {
  it("submits the edited list in display order", async () => {
    const submitted = vi.fn();
    const { user } = renderRoute(
      () => (
        <AdminContactsScreen
          contacts={[
            {
              kind: "email",
              label: "학생회 메일",
              value: "council@kmla.hs.kr",
            },
          ]}
        />
      ),
      {
        action: async ({ request }) => {
          submitted(
            JSON.parse((await request.formData()).get("contacts") as string),
          );
          return { ok: true };
        },
      },
    );

    await user.click(screen.getByRole("button", { name: /연락처 추가/ }));
    await user.type(screen.getAllByLabelText("이름")[1], "오픈채팅");
    await user.type(
      screen.getByLabelText("링크 주소"),
      "https://open.kakao.com/o/abc",
    );
    await user.click(screen.getByRole("button", { name: "2번 연락처 위로" }));
    await user.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText("저장했습니다.")).toBeVisible();
    expect(submitted).toHaveBeenCalledWith([
      {
        kind: "link",
        label: "오픈채팅",
        value: "https://open.kakao.com/o/abc",
      },
      { kind: "email", label: "학생회 메일", value: "council@kmla.hs.kr" },
    ]);
  });

  it("shows row errors returned by the action", async () => {
    const { user } = renderRoute(
      () => (
        <AdminContactsScreen
          contacts={[{ kind: "link", label: "사이트", value: "http://a.kr" }]}
        />
      ),
      {
        action: () => ({
          error: "입력을 확인해 주세요.",
          rowErrors: { 0: "링크는 https://로 시작해야 합니다." },
        }),
      },
    );

    await user.click(screen.getByRole("button", { name: "저장" }));

    expect(
      await screen.findByText("링크는 https://로 시작해야 합니다."),
    ).toBeVisible();
    expect(screen.getByLabelText("링크 주소")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("caps the list at ten contacts", () => {
    renderRoute(() => (
      <AdminContactsScreen
        contacts={Array.from({ length: 10 }, (_, index) => ({
          kind: "email" as const,
          label: `메일 ${index}`,
          value: `m${index}@kmla.hs.kr`,
        }))}
      />
    ));
    expect(screen.getByRole("button", { name: /연락처 추가/ })).toBeDisabled();
  });
});

describe("AdminContactsScreen in English", () => {
  afterEach(() => window.localStorage.clear());

  it("renders labels, buttons and the empty state in English", () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    renderRoute(() => <AdminContactsScreen contacts={[]} />);

    expect(screen.getByText("Admin contacts")).toBeVisible();
    expect(screen.getByText(/No contacts yet\./)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Add contact (0/10)" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeVisible();
  });
});
