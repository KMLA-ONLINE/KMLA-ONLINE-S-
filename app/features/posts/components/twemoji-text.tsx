import { parse } from "@twemoji/parser";
import { Fragment, useState } from "react";

interface EmojiEntity {
  indices: [number, number];
  text: string;
  url: string;
}

export function TwemojiText({ children }: { children: string }) {
  const entities = parse(children, {
    assetType: "svg",
    buildUrl: (codepoints: string) => `/twemoji/15.0.0/${codepoints}.svg`,
  }) as EmojiEntity[];
  if (!entities.length) return children;

  let cursor = 0;
  return entities.map((entity, index) => {
    const before = children.slice(cursor, entity.indices[0]);
    cursor = entity.indices[1];
    return (
      <Fragment key={`${entity.indices[0]}-${entity.text}`}>
        {before}
        <Twemoji entity={entity} />
        {index === entities.length - 1 ? children.slice(cursor) : null}
      </Fragment>
    );
  });
}

function Twemoji({ entity }: { entity: EmojiEntity }) {
  const [failed, setFailed] = useState(false);
  if (failed) return entity.text;
  return (
    <img
      className="twemoji"
      src={entity.url}
      alt={entity.text}
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
