import { describe, expect, it } from "vitest";

import type { CreateGroupValues } from "~/features/groups/model/types";
import {
  hasGroupFormErrors,
  readCreateGroupForm,
  validateCreateGroup,
} from "~/features/groups/model/validation";

const VALID_GROUP: CreateGroupValues = {
  kind: "unofficial",
  name: "메이커스 랩",
  description: "함께 만들고 배웁니다.",
  slug: "makers-lab",
  joinPolicy: "open",
  identityPolicy: "optional_anonymous",
  postingPolicy: "members",
};

describe("group creation validation", () => {
  it("accepts a valid public group", () => {
    expect(validateCreateGroup(VALID_GROUP)).toEqual({});
  });

  it("rejects custom addresses for invite-only groups", () => {
    const errors = validateCreateGroup({
      ...VALID_GROUP,
      joinPolicy: "invite_only",
    });

    expect(errors.slug).toMatch(/임의 주소/);
    expect(hasGroupFormErrors(errors)).toBe(true);
  });

  it("rejects reserved, malformed, and overlong values", () => {
    expect(
      validateCreateGroup({ ...VALID_GROUP, slug: "discover" }).slug,
    ).toBeDefined();
    expect(
      validateCreateGroup({ ...VALID_GROUP, slug: "Bad Slug" }).slug,
    ).toBeDefined();
    expect(
      validateCreateGroup({ ...VALID_GROUP, name: "" }).name,
    ).toBeDefined();
    expect(
      validateCreateGroup({ ...VALID_GROUP, description: "가".repeat(2001) })
        .description,
    ).toBeDefined();
  });

  it("normalizes submitted text and address casing", () => {
    const formData = new FormData();
    formData.set("kind", "unofficial");
    formData.set("name", "  메이커스 랩  ");
    formData.set("description", "  설명  ");
    formData.set("slug", "Makers-Lab");
    formData.set("joinPolicy", "open");
    formData.set("identityPolicy", "identified");
    formData.set("postingPolicy", "staff");

    expect(readCreateGroupForm(formData)).toEqual({
      kind: "unofficial",
      name: "메이커스 랩",
      description: "설명",
      slug: "makers-lab",
      joinPolicy: "open",
      identityPolicy: "identified",
      postingPolicy: "staff",
    });
  });
});
