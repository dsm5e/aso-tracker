import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildDesiredCampaigns, buildRebuildPlan, findOwnershipConflicts, type SemanticRegistry } from "./medscan-rebuild-plan.ts";

const REGISTRY_PATH = "/Users/qwar49/Desktop/MedScan — Semantic Registry DRAFT — 2026-09-04.json";
const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as SemanticRegistry;

test("desired state covers 89 paid storefronts, excludes CN, and preserves the approved budget envelope", () => {
  const plan = buildRebuildPlan(registry, [], []);
  assert.equal(plan.validation.paidStorefrontCount, 89);
  assert.equal(plan.validation.cnExcluded, true);
  assert.equal(plan.validation.totalDailyBudgetUsd, 100);
  assert.deepEqual(plan.validation.errors, []);
  assert.ok(plan.desiredCampaigns.every((campaign) => campaign.status === "PAUSED"));
});

test("global core has exactly one exact and one broad owner in each paid storefront", () => {
  const campaigns = buildDesiredCampaigns(registry);
  const paid = registry.eligibleStorefronts.filter((country) => country !== "CN");
  for (const country of paid) {
    for (const term of registry.policy.globalExact) {
      const owners = campaigns.filter((campaign) =>
        campaign.countriesOrRegions.includes(country) &&
        campaign.keywords.some((keyword) => keyword.text === term && keyword.matchType === "EXACT"),
      );
      assert.equal(owners.length, 1, `${country} ${term} exact owners`);
    }
    for (const term of registry.policy.globalBroad) {
      const owners = campaigns.filter((campaign) =>
        campaign.countriesOrRegions.includes(country) &&
        campaign.keywords.some((keyword) => keyword.text === term && keyword.matchType === "BROAD"),
      );
      assert.equal(owners.length, 1, `${country} ${term} broad owners`);
    }
  }
  assert.deepEqual(findOwnershipConflicts(campaigns), []);
  for (const country of paid) {
    assert.equal(campaigns.filter((campaign) =>
      campaign.countriesOrRegions.includes(country) &&
      campaign.keywords.some((keyword) => keyword.text === "dental dicom" && keyword.matchType === "EXACT"),
    ).length, 1, `${country} dental dicom exact owner`);
    for (const term of ["mri viewer", "ct viewer"]) {
      assert.equal(campaigns.filter((campaign) =>
        campaign.countriesOrRegions.includes(country) &&
        campaign.keywords.some((keyword) => keyword.text === term && keyword.matchType === "BROAD"),
      ).length, 1, `${country} ${term} broad owner`);
    }
  }
});

test("discovery has exact-owner and semantic-junk negatives but ambiguous typos remain review-only", () => {
  const plan = buildRebuildPlan(registry, [], []);
  const discovery = plan.desiredCampaigns.filter((campaign) =>
    campaign.portfolio === "DISC_BROAD" || campaign.portfolio === "DISC_SM",
  );
  assert.ok(discovery.length > 0);
  for (const campaign of discovery) {
    assert.ok(campaign.negativeExact.includes("dicom"));
    assert.ok(campaign.negativeExact.includes("dicom viewer"));
    assert.ok(campaign.negativeExact.includes("pubg"));
    assert.ok(campaign.negativeExact.includes("identity v"));
    assert.ok(!campaign.negativeExact.includes("dico"));
  }
  const competitorCampaigns = plan.desiredCampaigns.filter((campaign) => campaign.portfolio === "COMP_EXACT");
  for (const campaign of competitorCampaigns) {
    assert.ok(campaign.keywords.some((keyword) => keyword.text === "idv imaios dicom viewer"));
    assert.ok(campaign.keywords.some((keyword) => keyword.text === "horos mobile"));
  }
  assert.ok(plan.ambiguousNegativeReview.includes("dico"));
});

test("storefront-only evidence stays in its country and is excluded from discovery", () => {
  const plan = buildRebuildPlan(registry, [], []);
  const mxCore = plan.desiredCampaigns.find((campaign) => campaign.name === "M26 - MX - CORE-EXACT");
  const mxBroad = plan.desiredCampaigns.find((campaign) => campaign.name === "M26 - MX - DISC-BROAD");
  const esLocal = plan.desiredCampaigns.find((campaign) => campaign.name === "M26 - L10N-ES - LOCAL-EXACT");

  assert.ok(mxCore?.keywords.some((keyword) => keyword.text === "rayos x" && keyword.matchType === "EXACT"));
  assert.ok(mxBroad?.negativeExact.includes("rayos x"));
  for (const term of ["visor dicom", "rayos x", "resonancia magnetica", "visor de radiografias"]) {
    assert.ok(esLocal?.keywords.some((keyword) => keyword.text === term && keyword.matchType === "EXACT"));
  }
  assert.ok(esLocal?.countriesOrRegions.includes("ES"));
  assert.ok(esLocal?.countriesOrRegions.includes("AR"));

  const ptLocal = plan.desiredCampaigns.find((campaign) => campaign.name === "M26 - L10N-PT-BR - LOCAL-EXACT");
  assert.ok(ptLocal?.countriesOrRegions.includes("BR"));
  assert.ok(!ptLocal?.countriesOrRegions.includes("PT"));
  assert.ok(ptLocal?.keywords.some((keyword) => keyword.text === "visualizador dicom"));
  assert.ok(ptLocal?.keywords.some((keyword) => keyword.text === "raio x"));
  const ptPortugal = plan.desiredCampaigns.find((campaign) => campaign.name === "M26 - L10N-PT - LOCAL-EXACT");
  assert.deepEqual(ptPortugal?.countriesOrRegions, ["PT"]);
  assert.ok(ptPortugal?.keywords.some((keyword) => keyword.text === "visualizador dicom" && keyword.bidAmount === 0.18));
  assert.ok(ptPortugal?.keywords.some((keyword) => keyword.text === "raio x" && keyword.bidAmount === 0.12));

  const jaLocal = plan.desiredCampaigns.find((campaign) => campaign.name === "M26 - L10N-JA - LOCAL-EXACT");
  assert.ok(!jaLocal?.keywords.some((keyword) => keyword.text === "dcmアプリ"));
  assert.ok(!jaLocal?.keywords.some((keyword) => keyword.text === "dcm"));
  for (const term of ["dicom ビューア", "ct ビューア", "mri ビューア", "歯科 dicom"]) {
    assert.ok(jaLocal?.keywords.some((keyword) => keyword.text === term && keyword.matchType === "EXACT"));
  }
  const koLocal = plan.desiredCampaigns.find((campaign) => campaign.name === "M26 - L10N-KO - LOCAL-EXACT");
  for (const term of ["dicom 뷰어", "ct 뷰어", "mri 뷰어", "엑스레이 뷰어", "치과 dicom"]) {
    assert.ok(koLocal?.keywords.some((keyword) => keyword.text === term && keyword.matchType === "EXACT"));
  }
  const zhHantLocal = plan.desiredCampaigns.find((campaign) => campaign.name === "M26 - L10N-ZH-HANT - LOCAL-EXACT");
  assert.deepEqual(zhHantLocal?.countriesOrRegions, ["HK", "TW"]);
  assert.ok(zhHantLocal?.keywords.some((keyword) => keyword.text === "dicom 查看器" && keyword.bidAmount === 0.14));
  assert.ok(zhHantLocal?.keywords.some((keyword) => keyword.text === "醫學影像" && keyword.bidAmount === 0.12));
  const kgLocal = plan.desiredCampaigns.find((campaign) => campaign.name === "M26 - KG - LOCAL-EXACT");
  assert.deepEqual(kgLocal?.countriesOrRegions, ["KG"]);
  assert.ok(kgLocal?.keywords.some((keyword) => keyword.text === "мрт снимки" && keyword.bidAmount === 0.1));
  const kgBroad = plan.desiredCampaigns.find((campaign) => campaign.name === "M26 - T4-EMERGING - DISC-BROAD");
  assert.ok(kgBroad?.negativeExact.includes("мрт снимки"));
  const moLocal = plan.desiredCampaigns.find((campaign) => campaign.name === "M26 - MO - LOCAL-EXACT");
  assert.deepEqual(moLocal?.countriesOrRegions, ["MO"]);
  assert.ok(moLocal?.keywords.some((keyword) => keyword.text === "dicom 查看器" && keyword.bidAmount === 0.14));
  assert.ok(moLocal?.keywords.some((keyword) => keyword.text === "醫學影像" && keyword.bidAmount === 0.12));

  const gbCore = plan.desiredCampaigns.find((campaign) => campaign.name === "M26 - GB - CORE-EXACT");
  const gbBroad = plan.desiredCampaigns.find((campaign) => campaign.name === "M26 - GB - DISC-BROAD");
  for (const term of ["mri viewer", "ct scan viewer", "x-ray viewer"]) {
    assert.ok(gbCore?.keywords.some((keyword) => keyword.text === term && keyword.matchType === "EXACT"));
    assert.ok(gbBroad?.negativeExact.includes(term));
  }
  assert.ok(gbCore?.keywords.some((keyword) => keyword.text === "dicom viewer free" && keyword.bidAmount === 0.2));
  const enLocal = plan.desiredCampaigns.find((campaign) => campaign.name === "M26 - L10N-EN - LOCAL-EXACT");
  assert.ok(enLocal?.countriesOrRegions.includes("CA"));
  assert.ok(enLocal?.keywords.some((keyword) => keyword.text === "dicom viewer free" && keyword.bidAmount === 0.18));
  assert.ok(enLocal?.keywords.some((keyword) => keyword.text === "xray app" && keyword.bidAmount === 0.16));
  assert.ok(enLocal?.keywords.some((keyword) => keyword.text === "x-ray viewer" && keyword.bidAmount === 0.18));

  const deCore = plan.desiredCampaigns.find((campaign) => campaign.name === "M26 - DE - CORE-EXACT");
  const deBroad = plan.desiredCampaigns.find((campaign) => campaign.name === "M26 - DE - DISC-BROAD");
  const deLocal = plan.desiredCampaigns.find((campaign) => campaign.name === "M26 - L10N-DE - LOCAL-EXACT");
  for (const term of ["mrt viewer", "mri viewer", "röntgen app", "radiologie", "medical imaging"]) {
    assert.ok(deCore?.keywords.some((keyword) => keyword.text === term && keyword.matchType === "EXACT"));
    assert.ok(deBroad?.negativeExact.includes(term));
    assert.ok(deLocal?.keywords.some((keyword) => keyword.text === term && keyword.matchType === "EXACT"));
  }
  assert.ok(deLocal?.countriesOrRegions.includes("AT"));
  assert.ok(deLocal?.countriesOrRegions.includes("CH"));
  for (const term of ["metro", "citymapper", "drone scanner", "röntgenkamera"]) {
    assert.ok(deBroad?.negativeExact.includes(term));
  }

  const frLocal = plan.desiredCampaigns.find((campaign) => campaign.name === "M26 - L10N-FR - LOCAL-EXACT");
  for (const term of ["visionneuse dicom", "irm", "radiographie", "imagerie médicale"]) {
    assert.ok(frLocal?.keywords.some((keyword) => keyword.text === term && keyword.matchType === "EXACT"));
  }
  for (const country of ["FR", "BE", "CH", "CA", "LU"]) {
    assert.ok(frLocal?.countriesOrRegions.includes(country));
  }
  const t1Broad = plan.desiredCampaigns.find((campaign) => campaign.name === "M26 - T1-WEST - DISC-BROAD");
  assert.ok(t1Broad?.negativeExact.includes("ma carte vitale"));
  assert.ok(t1Broad?.negativeExact.includes("endoscope tool"));
});
