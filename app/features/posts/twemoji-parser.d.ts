declare module "@twemoji/parser" {
  export interface EmojiEntity {
    indices: [number, number];
    text: string;
    type: "emoji";
    url: string;
  }

  export function parse(
    text: string,
    options?: {
      assetType?: "svg" | "png";
      buildUrl?: (codepoints: string, assetType: string) => string;
    },
  ): EmojiEntity[];
}
