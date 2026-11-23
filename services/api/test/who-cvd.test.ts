import { describe, expect, it } from "vitest";
import { estimateWhoCvd, whoCvdInputSchema } from "../src/ai/who-cvd.js";

describe("WHO South Asia non-laboratory chart lookup", () => {
  it("matches published chart cells", () => {
    expect(estimateWhoCvd({ age: 70, sex: "Male", smoker: false, bmi: 27, systolicBp: 180 }).percent).toBe(28);
    expect(estimateWhoCvd({ age: 40, sex: "Female", smoker: true, bmi: 36, systolicBp: 119 }).percent).toBe(4);
  });
  it("uses WHO age, BMI, and SBP bands without interpolation", () => {
    const base = { sex: "Male" as const, smoker: false, bmi: 20, systolicBp: 120 };
    expect(estimateWhoCvd({ ...base, age: 44 }).percent).toBe(2);
    expect(estimateWhoCvd({ ...base, age: 45 }).percent).toBe(3);
    expect(estimateWhoCvd({ ...base, age: 44, systolicBp: 140 }).percent).toBe(3);
  });
  it("rejects ages outside the published 40–74 chart", () => {
    expect(whoCvdInputSchema.safeParse({ age: 39, sex: "Male", smoker: false, bmi: 25, systolicBp: 120 }).success).toBe(false);
    expect(whoCvdInputSchema.safeParse({ age: 75, sex: "Male", smoker: false, bmi: 25, systolicBp: 120 }).success).toBe(false);
  });
});
