import { z } from "zod";

export const whoCvdInputSchema = z.object({
  age: z.number().int().min(40).max(74), sex: z.enum(["Male", "Female"]), smoker: z.boolean(),
  bmi: z.number().finite().positive(), systolicBp: z.number().finite().positive()
}).strict();
export type WhoCvdInput = z.infer<typeof whoCvdInputSchema>;

// WHO 2019 South Asia non-laboratory chart cells, transcribed in published order.
// Per age: 5 SBP rows (>=180, 160-179, 140-159, 120-139, <120), each row has
// 20 values: men non-smoker, men smoker, women non-smoker, women smoker;
// each sex/smoking group has BMI columns <20, 20-24, 25-29, 30-35, >=35.
const raw = [
  `24 26 28 30 32 31 33 35 37 40 21 22 22 23 24 29 30 31 32 33
20 22 23 25 27 26 28 30 32 34 17 18 19 19 20 25 26 26 27 28
17 18 19 21 22 22 23 25 27 28 15 15 16 16 17 21 22 22 23 24
14 15 16 17 18 18 19 21 22 24 12 13 13 14 14 18 18 19 20 20
11 12 13 14 15 15 16 17 18 20 10 11 11 12 12 15 15 16 17 17`,
  `19 20 22 24 26 26 28 30 33 36 16 17 18 18 19 25 26 27 28 29
15 17 18 20 22 21 23 25 27 30 13 14 14 15 16 21 21 22 23 24
12 14 15 16 18 17 19 21 22 25 11 11 12 12 13 17 18 19 19 20
10 11 12 13 14 14 15 17 18 20 9 9 10 10 11 14 15 15 16 17
8 9 10 11 12 11 12 14 15 16 7 8 8 8 9 12 12 13 13 14`,
  `15 16 18 20 22 21 24 26 29 32 13 13 14 14 15 21 22 23 24 26
12 13 14 16 18 17 19 21 24 26 10 11 11 12 12 17 18 19 20 21
9 10 11 13 14 14 15 17 19 21 8 9 9 9 10 14 15 15 16 17
7 8 9 10 11 11 12 14 15 17 7 7 7 8 8 11 12 12 13 14
6 6 7 8 9 9 10 11 12 13 5 5 6 6 6 9 9 10 11 11`,
  `11 13 14 16 18 18 20 23 26 29 10 10 11 11 12 18 19 20 21 22
9 10 11 13 14 14 16 18 20 23 8 8 9 9 10 14 15 16 17 18
7 8 9 10 11 11 12 14 16 18 6 6 7 7 7 11 12 13 13 14
5 6 7 8 9 9 10 11 12 14 5 5 5 6 6 9 9 10 11 11
4 5 5 6 7 7 7 8 10 11 4 4 4 4 5 7 7 8 8 9`,
  `9 10 11 13 15 15 17 20 22 26 8 8 9 9 10 15 16 17 18 19
7 8 9 10 11 11 13 15 17 20 6 6 7 7 7 12 13 13 14 15
5 6 7 8 9 9 10 12 13 15 5 5 5 5 6 9 10 10 11 12
4 4 5 6 7 7 8 9 10 12 3 4 4 4 4 7 7 8 9 10
3 3 4 4 5 5 6 7 8 9 3 3 3 3 3 5 6 6 7 7`,
  `7 8 9 11 12 12 14 17 20 23 6 6 7 7 8 13 14 15 16 17
5 6 7 8 9 9 11 13 15 17 5 5 5 5 6 10 10 11 12 13
4 4 5 6 7 7 8 9 11 13 3 4 4 4 4 7 8 8 9 10
3 3 4 4 5 5 6 7 8 10 2 3 3 3 3 6 6 6 7 7
2 2 3 3 4 4 4 5 6 7 2 2 2 2 2 4 4 5 5 6`,
  `5 6 7 9 10 10 12 14 17 20 5 5 5 6 6 11 12 13 14 15
4 5 5 6 7 8 9 11 13 15 3 4 4 4 4 8 9 9 10 11
3 3 4 5 5 5 6 8 9 11 2 3 3 3 3 6 6 7 7 8
2 2 3 3 4 4 5 6 7 8 2 2 2 2 2 4 5 5 6 6
2 2 2 2 3 3 3 4 5 6 1 1 1 2 2 3 3 4 4 4`
].map((block) => block.trim().split(/\s+/).map(Number));

export function estimateWhoCvd(input: WhoCvdInput) {
  const ageBand = Math.floor((74 - input.age) / 5);
  const bmiBand = input.bmi < 20 ? 0 : input.bmi < 25 ? 1 : input.bmi < 30 ? 2 : input.bmi < 35 ? 3 : 4;
  const sbpBand = input.systolicBp >= 180 ? 0 : input.systolicBp >= 160 ? 1 : input.systolicBp >= 140 ? 2 : input.systolicBp >= 120 ? 3 : 4;
  const group = (input.sex === "Male" ? 0 : 2) + (input.smoker ? 1 : 0);
  const percent = raw[ageBand]![sbpBand * 20 + group * 5 + bmiBand]!;
  const category = percent < 5 ? "low" : percent < 10 ? "moderate" : percent < 20 ? "high" : percent < 30 ? "very_high" : "critical";
  return { percent, category, horizonYears: 10, model: "WHO 2019 CVD Risk Chart — South Asia, non-laboratory based" };
}
