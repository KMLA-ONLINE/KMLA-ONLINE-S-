import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SendMessageButton } from "~/features/messaging/components/send-message-button";
import * as mutations from "~/features/messaging/data/mutations";
import { renderRoute } from "../../../router";

describe("SendMessageButton", () => {
  it("그 사람과의 1:1 대화를 열고 그 방으로 간다", async () => {
    const open = vi
      .spyOn(mutations, "openDirectConversation")
      .mockResolvedValue("c0000000-0000-0000-0000-000000000001");
    const { user } = renderRoute(() => <SendMessageButton profileId={25} />, {
      path: "/profile/hanbyeol-25",
      initialEntries: ["/profile/hanbyeol-25"],
      routes: [
        {
          path: "/messenger/:roomId",
          Component: () => <p>열린 대화</p>,
        },
      ],
    });

    await user.click(screen.getByRole("button", { name: "메시지 보내기" }));

    expect(open).toHaveBeenCalledWith("25");
    expect(await screen.findByText("열린 대화")).toBeInTheDocument();
    open.mockRestore();
  });

  it("열지 못하면 알리고 다시 누를 수 있게 둔다", async () => {
    const open = vi
      .spyOn(mutations, "openDirectConversation")
      .mockRejectedValue(new Error("offline"));
    const { user } = renderRoute(() => <SendMessageButton profileId={25} />, {
      path: "/profile/hanbyeol-25",
      initialEntries: ["/profile/hanbyeol-25"],
    });

    const button = screen.getByRole("button", { name: "메시지 보내기" });
    await user.click(button);

    expect(open).toHaveBeenCalledTimes(1);
    expect(button).toBeEnabled();
    open.mockRestore();
  });
});
