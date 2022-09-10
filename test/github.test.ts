import { describe, expect, test } from "@jest/globals";
import { exportedForTesting } from "../src/github";

const { repoSearchValueToString, repoSearchKeywordToString } =
  exportedForTesting;

describe("searchValueToString", () => {
  test("numerical value", () => {
    expect(repoSearchValueToString(10)).toBe("10");
    expect(repoSearchValueToString(-10)).toBe("-10");
    expect(repoSearchValueToString(3.14)).toBe("3.14");
  });

  test("date value", () => {
    const date = new Date("2020-02-05T10:33:22.965+01:00");
    expect(repoSearchValueToString(date)).toBe("2020-02-05T09:33:22.965Z");
  });
});

describe("searchKeywordToString", () => {
  describe("numeric", () => {
    test("with no values", () => {
      expect(repoSearchKeywordToString({})).toBe("");
    });
    test("with min value", () => {
      expect(repoSearchKeywordToString({ minValue: 100 })).toBe("100..*");
    });
    test("with max value", () => {
      expect(repoSearchKeywordToString({ maxValue: 100 })).toBe("*..100");
    });
    test("with min and max values", () => {
      expect(
        repoSearchKeywordToString({
          minValue: 100,
          maxValue: 200,
        })
      ).toBe("100..200");
    });
  });

  describe("date", () => {
    test("with no dates", () => {
      expect(repoSearchKeywordToString({})).toBe("");
    });
    test("with min date", () => {
      const date = new Date("2020-02-05T10:33:22.965+01:00");
      expect(repoSearchKeywordToString({ minValue: date })).toBe(
        "2020-02-05T09:33:22.965Z..*"
      );
    });
    test("with max date", () => {
      const date = new Date("2020-02-05T10:33:22.965+01:00");
      expect(repoSearchKeywordToString({ maxValue: date })).toBe(
        "*..2020-02-05T09:33:22.965Z"
      );
    });
    test("with min and max dates", () => {
      const minDate = new Date("2020-02-05T10:33:22.965+01:00");
      const maxDate = new Date("2020-02-06T10:33:22.965+01:00");
      expect(
        repoSearchKeywordToString({
          minValue: minDate,
          maxValue: maxDate,
        })
      ).toBe("2020-02-05T09:33:22.965Z..2020-02-06T09:33:22.965Z");
    });
  });
});
