import { detectPlatform } from "../src/pal/index.js";

describe("Platform Detection", () => {
  test("should detect platform without error", () => {
    const platform = detectPlatform();
    expect(platform).toBeDefined();
    expect(platform.os).toBeDefined();
    expect(["windows", "macos", "linux"]).toContain(platform.os);
    expect(platform.homeDir).toBeDefined();
    expect(platform.tempDir).toBeDefined();
    expect(platform.nodeVersion).toBeDefined();
    expect(platform.arch).toBeDefined();
  });

  test("should have valid terminal type", () => {
    const platform = detectPlatform();
    expect(platform.terminal).toBeDefined();
    expect(typeof platform.terminal).toBe("string");
  });

  test("should detect isElevated as boolean", () => {
    const platform = detectPlatform();
    expect(typeof platform.isElevated).toBe("boolean");
  });
});