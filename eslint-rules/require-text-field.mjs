const INPUT_MODULE = "~/shared/ui/input";

function getAttribute(openingElement, name) {
  return openingElement.attributes.find(
    (attribute) =>
      attribute.type === "JSXAttribute" && attribute.name.name === name,
  );
}

function getLiteralValue(attribute) {
  if (!attribute?.value) return undefined;
  if (attribute.value.type === "Literal") return attribute.value.value;
  if (
    attribute.value.type === "JSXExpressionContainer" &&
    attribute.value.expression.type === "Literal"
  ) {
    return attribute.value.expression.value;
  }

  return undefined;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "require TextField for generic single-line text",
    },
    messages: {
      missingType:
        "Input requires an explicit native type. Use TextField for a generic one-line string.",
      textType:
        'Use TextField instead of Input type="text" unless native pattern validation is required.',
    },
    schema: [],
  },
  create(context) {
    const inputNames = new Set();

    return {
      ImportDeclaration(node) {
        if (node.source.value !== INPUT_MODULE) return;

        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.imported.name === "Input"
          ) {
            inputNames.add(specifier.local.name);
          }
        }
      },
      JSXOpeningElement(node) {
        if (
          node.name.type !== "JSXIdentifier" ||
          !inputNames.has(node.name.name)
        ) {
          return;
        }

        const type = getAttribute(node, "type");
        if (!type) {
          context.report({ node, messageId: "missingType" });
          return;
        }

        if (
          getLiteralValue(type) === "text" &&
          !getAttribute(node, "pattern")
        ) {
          context.report({ node: type, messageId: "textType" });
        }
      },
    };
  },
};
