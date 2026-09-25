import assert from "node:assert/strict";
import test from "node:test";
import { buildStagedReconcilePlan } from "./medscan-rebuild-reconcile.ts";

test("removes only extras from a paused staged campaign", () => {
  const desired = [{
    name: "M26 - TEST - CORE-EXACT",
    portfolio: "CORE_EXACT",
    tier: "TEST",
    countriesOrRegions: ["US"],
    dailyBudgetAmount: 1,
    defaultBidAmount: 0.2,
    automatedKeywordsOptIn: false,
    adGroupName: "Core exact",
    keywords: [{ text: "dicom", matchType: "EXACT", bidAmount: 0.3, rationale: "test" }],
    negativeExact: ["dicom viewer"],
    ref: "campaign:test",
    status: "PAUSED",
  }];
  const remote = [{
    id: 1,
    adamId: 6762091560,
    name: "M26 - TEST - CORE-EXACT",
    status: "PAUSED",
    dailyBudgetAmount: { amount: "1", currency: "USD" },
    countriesOrRegions: ["US"],
    deleted: false,
    negativeKeywords: [
      { id: 31, text: "dicom viewer", matchType: "EXACT", deleted: false },
      { id: 32, text: "mri viewer", matchType: "EXACT", deleted: false },
    ],
    adGroups: [{
      id: 2,
      campaignId: 1,
      name: "Core exact",
      status: "PAUSED",
      defaultBidAmount: { amount: "0.2", currency: "USD" },
      automatedKeywordsOptIn: false,
      deleted: false,
      negativeKeywords: [],
      keywords: [
        { id: 21, text: "dicom", matchType: "EXACT", bidAmount: { amount: "0.3" }, status: "ACTIVE", deleted: false },
        { id: 22, text: "mri viewer", matchType: "EXACT", bidAmount: { amount: "0.1" }, status: "ACTIVE", deleted: false },
      ],
    }],
  }];
  const diff = buildStagedReconcilePlan(desired as never, remote as never);
  assert.deepEqual(diff.errors, []);
  assert.deepEqual(diff.keywordRemovals.map((item) => item.id), [22]);
  assert.deepEqual(diff.negativeRemovals.map((item) => item.id), [32]);
});

test("fails closed when a staged campaign is not paused", () => {
  const desired = [{
    name: "M26 - TEST", countriesOrRegions: ["US"], dailyBudgetAmount: 1,
    defaultBidAmount: 0.2, automatedKeywordsOptIn: false, keywords: [], negativeExact: [],
  }];
  const remote = [{
    id: 1, name: "M26 - TEST", status: "ENABLED", countriesOrRegions: ["US"],
    dailyBudgetAmount: { amount: "1" }, deleted: false, negativeKeywords: [],
    adGroups: [{ id: 2, status: "PAUSED", defaultBidAmount: { amount: "0.2" }, automatedKeywordsOptIn: false, deleted: false, keywords: [], negativeKeywords: [] }],
  }];
  const diff = buildStagedReconcilePlan(desired as never, remote as never);
  assert.match(diff.errors.join("\n"), /campaign is not PAUSED/);
  assert.equal(diff.keywordRemovals.length, 0);
  assert.equal(diff.negativeRemovals.length, 0);
});
