import { describe, expect, it } from "vitest";
import { useNavigate } from "react-router";

import { CommentText } from "~/features/posts/components/comment/comment-text";
import { PostMarkdown } from "~/features/posts/components/post-markdown";
import { StoryLinkPill } from "~/features/stories/components/story-canvas";
import { ContentLink } from "~/shared/components/content-link";

import { renderRoute, screen } from "../../router";

const IN_APP_URL = `${window.location.origin}/noti?tab=all`;
const EXTERNAL_URL = "https://example.com/page";

describe("ContentLink", () => {
  it("opens an in-app URL through the router and back returns to the page", async () => {
    function Source() {
      return <ContentLink href={IN_APP_URL}>이동</ContentLink>;
    }
    function Target() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => void navigate(-1)}>
          뒤로
        </button>
      );
    }

    const { user } = renderRoute(Source, {
      path: "/source",
      initialEntries: ["/source"],
      routes: [{ path: "/noti", Component: Target }],
    });

    const link = screen.getByRole("link", { name: "이동" });
    expect(link).toHaveAttribute("href", "/noti?tab=all");
    expect(link).not.toHaveAttribute("target");

    await user.click(link);
    await user.click(await screen.findByRole("button", { name: "뒤로" }));

    expect(await screen.findByRole("link", { name: "이동" })).toBeVisible();
  });

  it("opens an external URL in a new tab", () => {
    renderRoute(() => <ContentLink href={EXTERNAL_URL}>외부</ContentLink>);

    const link = screen.getByRole("link", { name: "외부" });
    expect(link).toHaveAttribute("href", EXTERNAL_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it.each([
    [
      "post body",
      () => <PostMarkdown>{`[이동](${IN_APP_URL})`}</PostMarkdown>,
      "이동",
    ],
    ["comment", () => <CommentText>{IN_APP_URL}</CommentText>, IN_APP_URL],
    ["story", () => <StoryLinkPill url={IN_APP_URL} interactive />, /./],
  ])(
    "keeps a %s link to the app in the same tab",
    (_surface, Surface, name) => {
      renderRoute(Surface);

      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", "/noti?tab=all");
      expect(link).not.toHaveAttribute("target");
    },
  );
});
