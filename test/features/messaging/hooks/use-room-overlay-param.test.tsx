import { useNavigate } from "react-router";
import { describe, expect, it } from "vitest";

import { useRoomOverlayParam } from "~/features/messaging/hooks/use-room-overlay-param";
import { renderRoute, screen } from "../../../router";

function OverlayScreen() {
  const panels = useRoomOverlayParam();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="열린 화면">{panels.overlay?.kind ?? "room"}</output>
      <button onClick={() => panels.open({ kind: "details" })}>
        정보 열기
      </button>
      <button onClick={() => panels.open({ kind: "nicknames" })}>
        별명 열기
      </button>
      <button onClick={panels.close}>X 닫기</button>
      <button onClick={() => void navigate(-1)}>브라우저 뒤로</button>
    </>
  );
}

describe("대화방 별명 화면 뒤로가기", () => {
  it("별명을 history에 쌓고 X와 브라우저 뒤로 모두 정보 화면으로 돌아온다", async () => {
    const { user } = renderRoute(OverlayScreen);
    await user.click(screen.getByRole("button", { name: "정보 열기" }));
    await user.click(screen.getByRole("button", { name: "별명 열기" }));
    expect(screen.getByLabelText("열린 화면")).toHaveTextContent("nicknames");
    await user.click(screen.getByRole("button", { name: "브라우저 뒤로" }));
    expect(screen.getByLabelText("열린 화면")).toHaveTextContent("details");
    await user.click(screen.getByRole("button", { name: "별명 열기" }));
    await user.click(screen.getByRole("button", { name: "X 닫기" }));
    expect(screen.getByLabelText("열린 화면")).toHaveTextContent("details");
    await user.click(screen.getByRole("button", { name: "브라우저 뒤로" }));
    expect(screen.getByLabelText("열린 화면")).toHaveTextContent("room");
  });
});
