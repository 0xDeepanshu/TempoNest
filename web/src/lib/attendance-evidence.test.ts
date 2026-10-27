import { describe, expect, it } from "vitest";

import { privateEvidenceImageUrl } from "./attendance-evidence";

describe("privateEvidenceImageUrl", () => {
  it("routes local API evidence through the same-origin proxy", () => {
    expect(
      privateEvidenceImageUrl(
        "http://192.168.29.165:4000/api/v1/attendance-files/eyJhbGciOi.payload.signature",
      ),
    ).toBe("/api/v1/attendance-files/eyJhbGciOi.payload.signature");
  });

  it("keeps the query string of a signed link", () => {
    expect(
      privateEvidenceImageUrl(
        "https://api.example.com/api/v1/attendance-files/token?expires=1",
      ),
    ).toBe("/api/v1/attendance-files/token?expires=1");
  });

  it("leaves presigned object-storage URLs untouched", () => {
    const url =
      "https://bucket.s3.eu-west-1.amazonaws.com/evidence/photo.jpg?X-Amz-Signature=abc";
    expect(privateEvidenceImageUrl(url)).toBe(url);
  });

  it("leaves unrelated URLs and unreadable values untouched", () => {
    expect(privateEvidenceImageUrl("https://cdn.example.com/photo.jpg")).toBe(
      "https://cdn.example.com/photo.jpg",
    );
    expect(privateEvidenceImageUrl("/already/relative.jpg")).toBe(
      "/already/relative.jpg",
    );
    expect(privateEvidenceImageUrl("not a url")).toBe("not a url");
  });
});
