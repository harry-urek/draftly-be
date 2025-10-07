/**
 * @jest-environment node
 */

import { describe } from "node:test";

describe("Application Health", () => {
  it("should be able to import main modules", async () => {
    expect(() => require("../config")).not.toThrow();
    expect(() => require("../types")).not.toThrow();
  });

  it("should have required environment variables in test", () => {
    expect(process.env.NODE_ENV).toBe("test");
  });
});

