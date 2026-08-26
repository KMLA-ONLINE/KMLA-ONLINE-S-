import { Linter, type Rule } from "eslint";
import { describe, expect, it } from "vitest";

// Local ESLint rules are loaded by the flat config as MJS.
// @ts-expect-error The rule is intentionally an untyped MJS module.
import requireTextField from "../../eslint-rules/require-text-field.mjs";

function lint(source: string) {
  const linter = new Linter({ configType: "eslintrc" });
  linter.defineRule("require-text-field", requireTextField as Rule.RuleModule);

  return linter.verify(source, {
    parserOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      ecmaFeatures: { jsx: true },
    },
    rules: { "require-text-field": "error" },
  });
}

describe("require-text-field", () => {
  it("requires an explicit type on Input", () => {
    const messages = lint(`
      import { Input } from "~/shared/ui/input";
      <Input />;
    `);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ messageId: "missingType" });
  });

  it("rejects a plain text Input", () => {
    const messages = lint(`
      import { Input } from "~/shared/ui/input";
      <Input type="text" />;
    `);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ messageId: "textType" });
  });

  it("permits native types, dynamic types, and pattern validation", () => {
    const messages = lint(`
      import { Input } from "~/shared/ui/input";
      <Input type="email" />;
      <Input type={visible ? "text" : "password"} />;
      <Input type="text" pattern="[a-z]+" />;
    `);

    expect(messages).toHaveLength(0);
  });
});
