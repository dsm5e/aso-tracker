import assert from "node:assert/strict";
import test from "node:test";
import { completedCohortWindow, normalizeCohorts } from "./adapty-analytics.ts";

test("uses the last three completed calendar months for mature cohort reporting", () => {
  assert.deepEqual(completedCohortWindow(new Date("2026-09-04T12:00:00Z"), 3), {
    start: "2026-06-01",
    end: "2026-08-31",
    months: 3,
  });
});

test("marks a Dn window mature only after the whole monthly cohort has aged n days", () => {
  const rows = normalizeCohorts([
    {
      segment_start_date: "2026-06-01",
      type: "single",
      title: "2026-06-01",
      total_installs: 100,
      values: [
        { period: 0, installs: 100, subscribers: 4, net_revenue_usd: 20 },
        { period: 60, installs: 100, subscribers: 8, net_revenue_usd: 80 },
      ],
    },
    {
      segment_start_date: "2026-07-01",
      type: "single",
      title: "2026-07-01",
      total_installs: 200,
      values: [
        { period: 0, installs: 200, subscribers: 6, net_revenue_usd: 30 },
        { period: 30, installs: 200, subscribers: 10, net_revenue_usd: 90 },
        { period: 60, installs: 200, subscribers: 11, net_revenue_usd: 100 },
      ],
    },
    {
      segment_start_date: "2026-08-01",
      type: "single",
      title: "2026-08-01",
      total_installs: 300,
      values: [
        { period: 0, installs: 300, subscribers: 7, net_revenue_usd: 40 },
        { period: 7, installs: 300, subscribers: 12, net_revenue_usd: 120 },
      ],
    },
  ], "2026-08-31");

  assert.equal(rows[0].values.find((value) => value.day === 60)?.mature, true);
  assert.equal(rows[1].values.find((value) => value.day === 30)?.mature, true);
  assert.equal(rows[1].values.find((value) => value.day === 60)?.mature, false);
  assert.equal(rows[2].values.find((value) => value.day === 0)?.mature, true);
  assert.equal(rows[2].values.find((value) => value.day === 7)?.mature, false);
  assert.equal(rows[0].values.find((value) => value.day === 0)?.netRevenuePerInstall, 0.2);
});
