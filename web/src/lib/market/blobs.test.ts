import { describe, expect, it } from "vitest";
import { baseContentType, extensionFor } from "./blobs";

describe("container naming", () => {
  it("strips the codecs parameter Safari and Chromium both attach", () => {
    expect(baseContentType("video/mp4;codecs=avc1")).toBe("video/mp4");
    expect(baseContentType("video/webm;codecs=vp9,opus")).toBe("video/webm");
  });

  it("names an iPhone recording mp4 and an Android one webm", () => {
    expect(extensionFor("video/mp4;codecs=avc1")).toBe("mp4");
    expect(extensionFor("video/webm;codecs=vp9,opus")).toBe("webm");
  });

  it("falls back rather than guessing at a container it does not know", () => {
    expect(extensionFor(undefined)).toBe("bin");
    expect(extensionFor("video/quicktime")).toBe("bin");
  });
});
