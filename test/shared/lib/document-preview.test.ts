import { afterEach, describe, expect, it, vi } from "vitest";

import {
  openDocumentPreview,
  shouldPreviewDocument,
  sniffPreviewableDocument,
} from "~/shared/lib/document-preview";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];
const ZIP = [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00];
const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const HTML = [...new TextEncoder().encode("<html><script>")];

function useUserAgent(userAgent: string) {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: userAgent,
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "userAgent");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("sniffPreviewableDocument", () => {
  it("returns a fixed MIME type when the bytes match the extension", () => {
    expect(sniffPreviewableDocument("시간표.pdf", new Uint8Array(PDF))).toBe(
      "application/pdf",
    );
    expect(sniffPreviewableDocument("명단.XLSX", new Uint8Array(ZIP))).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(sniffPreviewableDocument("예전.xls", new Uint8Array(CFB))).toBe(
      "application/vnd.ms-excel",
    );
  });

  it("rejects bytes that do not match the extension", () => {
    expect(sniffPreviewableDocument("a.pdf", new Uint8Array(HTML))).toBeNull();
    expect(sniffPreviewableDocument("a.xlsx", new Uint8Array(PDF))).toBeNull();
    expect(sniffPreviewableDocument("a.xls", new Uint8Array(ZIP))).toBeNull();
  });

  it("rejects other extensions even with matching bytes", () => {
    expect(sniffPreviewableDocument("a.docx", new Uint8Array(ZIP))).toBeNull();
    expect(sniffPreviewableDocument("pdf", new Uint8Array(PDF))).toBeNull();
  });
});

describe("shouldPreviewDocument", () => {
  it("previews PDF on phones and Excel only on iOS", () => {
    useUserAgent(IPHONE_SAFARI);
    expect(shouldPreviewDocument("a.pdf")).toBe(true);
    expect(shouldPreviewDocument("a.xlsx")).toBe(true);
    expect(shouldPreviewDocument("a.hwp")).toBe(false);

    useUserAgent(ANDROID_CHROME);
    expect(shouldPreviewDocument("a.pdf")).toBe(true);
    expect(shouldPreviewDocument("a.xlsx")).toBe(false);

    useUserAgent(DESKTOP_CHROME);
    expect(shouldPreviewDocument("a.pdf")).toBe(false);
  });
});

describe("openDocumentPreview", () => {
  function stubTab() {
    const tab = { location: { href: "" }, opener: {}, close: vi.fn() };
    const open = vi
      .spyOn(window, "open")
      .mockReturnValue(tab as unknown as Window);
    return { tab, open };
  }

  it("opens the verified bytes as a controlled Blob in the new tab", async () => {
    const { tab, open } = stubTab();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(new Uint8Array(PDF))),
    );
    const createObjectURL = vi.fn().mockReturnValue("blob:preview");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL }));

    await openDocumentPreview({
      url: "https://storage.example/a",
      downloadUrl: "https://storage.example/a?download=a.pdf",
      fileName: "a.pdf",
    });

    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(tab.opener).toBeNull();
    expect((createObjectURL.mock.calls[0][0] as Blob).type).toBe(
      "application/pdf",
    );
    expect(tab.location.href).toBe("blob:preview");
    expect(tab.close).not.toHaveBeenCalled();
  });

  it("closes the tab when the bytes are not the claimed format", async () => {
    const { tab } = stubTab();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(new Uint8Array(HTML))),
    );
    const assign = vi.fn();

    await openDocumentPreview(
      {
        url: "https://storage.example/a",
        downloadUrl: "https://storage.example/a?download=a.pdf",
        fileName: "a.pdf",
      },
      assign,
    );

    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe("");
    expect(assign).toHaveBeenCalledWith(
      "https://storage.example/a?download=a.pdf",
    );
  });
});
