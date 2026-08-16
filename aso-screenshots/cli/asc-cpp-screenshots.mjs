#!/usr/bin/env node

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createHash, createPrivateKey, sign } from "node:crypto";

const ASC_BASE = "https://api.appstoreconnect.apple.com/v1";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function base64url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function createToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(
    JSON.stringify({
      alg: "ES256",
      kid: requiredEnv("ASC_KEY_ID"),
      typ: "JWT",
    }),
  );
  const payload = base64url(
    JSON.stringify({
      iss: requiredEnv("ASC_ISSUER_ID"),
      aud: "appstoreconnect-v1",
      iat: now,
      exp: now + 19 * 60,
    }),
  );
  const input = `${header}.${payload}`;
  const privateKey = createPrivateKey(
    readFileSync(requiredEnv("ASC_PRIVATE_KEY_PATH"), "utf8"),
  );
  const signature = sign("sha256", Buffer.from(input), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${input}.${base64url(signature)}`;
}

const providedToken = process.env.ASC_BEARER_TOKEN?.trim();
let token = providedToken || createToken();
let tokenCreatedAt = Date.now();

function currentToken() {
  if (providedToken) return token;
  if (Date.now() - tokenCreatedAt > 15 * 60 * 1000) {
    token = createToken();
    tokenCreatedAt = Date.now();
  }
  return token;
}

async function ascRequest(method, path, body) {
  const response = await fetch(`${ASC_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${currentToken()}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message =
      parsed?.errors?.map((error) => error.detail || error.title).join("; ") ||
      `${response.status} ${response.statusText}`;
    throw new Error(`${method} ${path}: ${message}`);
  }
  return parsed;
}

async function listSets(localizationId) {
  return ascRequest(
    "GET",
    `/appCustomProductPageLocalizations/${localizationId}/appScreenshotSets?limit=200&include=appScreenshots`,
  );
}

async function listLocalizations(versionId) {
  return ascRequest(
    "GET",
    `/appCustomProductPageVersions/${versionId}/appCustomProductPageLocalizations?limit=200`,
  );
}

async function createSet(localizationId, displayType) {
  return ascRequest("POST", "/appScreenshotSets", {
    data: {
      type: "appScreenshotSets",
      attributes: { screenshotDisplayType: displayType },
      relationships: {
        appCustomProductPageLocalization: {
          data: {
            type: "appCustomProductPageLocalizations",
            id: localizationId,
          },
        },
      },
    },
  });
}

async function listScreenshots(setId) {
  return ascRequest(
    "GET",
    `/appScreenshotSets/${setId}/appScreenshots?limit=200`,
  );
}

async function deleteScreenshot(id) {
  await ascRequest("DELETE", `/appScreenshots/${id}`);
}

async function uploadScreenshot(setId, filePath) {
  const fileSize = statSync(filePath).size;
  const fileName = basename(filePath);
  const reservation = await ascRequest("POST", "/appScreenshots", {
    data: {
      type: "appScreenshots",
      attributes: { fileName, fileSize },
      relationships: {
        appScreenshotSet: {
          data: { type: "appScreenshotSets", id: setId },
        },
      },
    },
  });

  const screenshotId = reservation.data.id;
  const operations = reservation.data.attributes.uploadOperations || [];
  const file = readFileSync(filePath);

  for (const operation of operations) {
    const offset = Number(operation.offset || 0);
    const length = Number(operation.length || file.length);
    const chunk = file.subarray(offset, offset + length);
    const headers = Object.fromEntries(
      (operation.requestHeaders || []).map(({ name, value }) => [name, value]),
    );
    const response = await fetch(operation.url, {
      method: operation.method || "PUT",
      headers,
      body: chunk,
    });
    if (!response.ok) {
      throw new Error(
        `Asset upload failed for ${fileName}: ${response.status} ${response.statusText}`,
      );
    }
  }

  const checksum = createHash("md5").update(file).digest("hex");
  await ascRequest("PATCH", `/appScreenshots/${screenshotId}`, {
    data: {
      type: "appScreenshots",
      id: screenshotId,
      attributes: { uploaded: true, sourceFileChecksum: checksum },
    },
  });
  return screenshotId;
}

async function replaceSet(localizationId, displayType, filePaths) {
  if (filePaths.length > 10) {
    throw new Error(
      `Screenshot set ${localizationId} has ${filePaths.length} new files; App Store Connect allows at most 10`,
    );
  }
  const sets = await listSets(localizationId);
  let set = sets.data.find(
    (candidate) =>
      candidate.attributes?.screenshotDisplayType === displayType,
  );
  if (!set) {
    set = (await createSet(localizationId, displayType)).data;
  }

  const existing = await listScreenshots(set.id);
  const existingScreenshots = existing.data || [];
  const keepOldCount = Math.min(
    existingScreenshots.length,
    Math.max(0, 10 - filePaths.length),
  );
  const keptOldScreenshots = existingScreenshots.slice(0, keepOldCount);
  const preUploadDeletes = existingScreenshots.slice(keepOldCount);

  // Keep as many old screenshots as the ten-slot limit permits. If a new
  // upload fails, the localization still retains a recoverable visual instead
  // of becoming completely empty.
  for (const screenshot of preUploadDeletes) {
    await deleteScreenshot(screenshot.id);
  }

  const uploaded = [];
  try {
    for (const [index, filePath] of filePaths.entries()) {
      const id = await uploadScreenshot(set.id, filePath);
      uploaded.push(id);
      console.log(
        `uploaded ${index + 1}/${filePaths.length}: ${basename(filePath)}`,
      );
    }
  } catch (error) {
    // Remove incomplete replacement files while retaining the staged old
    // screenshots. The pre-deleted screenshots cannot be restored through
    // ASC, so surface the failure immediately for a targeted retry.
    for (const screenshotId of uploaded) {
      await deleteScreenshot(screenshotId).catch(() => {});
    }
    throw error;
  }

  for (const screenshot of keptOldScreenshots) {
    await deleteScreenshot(screenshot.id);
  }

  const finalScreenshots = await listScreenshots(set.id);
  const finalIds = new Set((finalScreenshots.data || []).map((item) => item.id));
  const missingUploads = uploaded.filter((id) => !finalIds.has(id));
  if (
    (finalScreenshots.data?.length || 0) !== filePaths.length ||
    missingUploads.length
  ) {
    throw new Error(
      `Post-upload verification failed for ${localizationId}: expected ${filePaths.length}, got ${finalScreenshots.data?.length || 0}, missing ${missingUploads.length}`,
    );
  }
  return { setId: set.id, uploaded };
}

async function syncManifest(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const displayType = manifest.displayType || "APP_IPHONE_67";
  const tasks = [];

  for (const page of manifest.pages) {
    const localizations = await listLocalizations(page.versionId);
    for (const localization of localizations.data || []) {
      const locale = localization.attributes.locale;
      const directory = resolve(page.imagesRoot, locale);
      const filePaths = readdirSync(directory)
        .filter((name) => name.toLowerCase().endsWith(".png"))
        .sort((left, right) =>
          left.localeCompare(right, "en", { numeric: true }),
        )
        .map((name) => resolve(directory, name));
      if (!filePaths.length) {
        throw new Error(`No PNG files found in ${directory}`);
      }
      tasks.push({
        page: page.name,
        locale,
        localizationId: localization.id,
        filePaths,
      });
    }
  }

  const concurrency = Math.max(
    1,
    Math.min(Number(process.env.ASC_CPP_UPLOAD_CONCURRENCY || 3), 6),
  );
  let cursor = 0;
  let completed = 0;
  const results = [];

  async function worker() {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      console.log(
        `start ${task.page}/${task.locale} (${task.filePaths.length} screenshots)`,
      );
      const result = await replaceSet(
        task.localizationId,
        displayType,
        task.filePaths,
      );
      const sets = await listSets(task.localizationId);
      const set = sets.data.find(
        (candidate) =>
          candidate.attributes?.screenshotDisplayType === displayType,
      );
      const screenshots = set ? await listScreenshots(set.id) : { data: [] };
      if ((screenshots.data?.length || 0) !== task.filePaths.length) {
        throw new Error(
          `Verification failed for ${task.page}/${task.locale}: expected ${task.filePaths.length}, got ${screenshots.data?.length || 0}`,
        );
      }
      completed += 1;
      results.push({
        page: task.page,
        locale: task.locale,
        setId: result.setId,
        count: task.filePaths.length,
      });
      console.log(
        `done ${completed}/${tasks.length}: ${task.page}/${task.locale}`,
      );
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results.sort(
    (left, right) =>
      left.page.localeCompare(right.page) ||
      left.locale.localeCompare(right.locale),
  );
}

async function verifyManifest(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const displayType = manifest.displayType || "APP_IPHONE_67";
  const results = [];

  for (const page of manifest.pages) {
    const localizations = await listLocalizations(page.versionId);
    for (const localization of localizations.data || []) {
      const locale = localization.attributes.locale;
      const expected = readdirSync(resolve(page.imagesRoot, locale)).filter(
        (name) => name.toLowerCase().endsWith(".png"),
      ).length;
      const sets = await listSets(localization.id);
      const set = sets.data.find(
        (candidate) =>
          candidate.attributes?.screenshotDisplayType === displayType,
      );
      const screenshots = set ? await listScreenshots(set.id) : { data: [] };
      const actual = screenshots.data?.length || 0;
      results.push({
        page: page.name,
        locale,
        expected,
        actual,
        ok: expected === actual,
      });
      console.log(
        `${expected === actual ? "ok" : "FAIL"} ${page.name}/${locale}: ${actual}/${expected}`,
      );
    }
  }
  return results;
}

async function validateKeywordPlan(manifestPath, planPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const rows = [];

  for (const page of manifest.pages) {
    const localizations = await listLocalizations(page.versionId);
    for (const localization of localizations.data || []) {
      const locale = localization.attributes.locale;
      const selected = plan.pages?.[page.name]?.[locale] || [];
      const [availableResponse, currentResponse] = await Promise.all([
        ascRequest(
          "GET",
          `/apps/${plan.appId}/searchKeywords?filter%5Blocale%5D=${encodeURIComponent(locale)}&filter%5Bplatform%5D=IOS&limit=200`,
        ),
        ascRequest(
          "GET",
          `/appCustomProductPageLocalizations/${localization.id}/searchKeywords?limit=200`,
        ),
      ]);
      const available = new Set(
        (availableResponse.data || []).map((keyword) => keyword.id),
      );
      const current = (currentResponse.data || []).map(
        (keyword) => keyword.id,
      );
      const unavailable = selected.filter((keyword) => !available.has(keyword));
      const additions = selected.filter((keyword) => !current.includes(keyword));
      rows.push({
        page: page.name,
        locale,
        localizationId: localization.id,
        current,
        selected,
        additions,
        unavailable,
        ok: unavailable.length === 0,
      });
      console.log(
        `${unavailable.length ? "FAIL" : "ok"} ${page.name}/${locale}: current=${current.length} selected=${selected.length} add=${additions.length}`,
      );
    }
  }
  return rows;
}

async function applyKeywordPlan(manifestPath, planPath, mutationLogPath) {
  const before = await validateKeywordPlan(manifestPath, planPath);

  const mutations = [];
  for (const row of before) {
    const availableAdditions = row.additions.filter(
      (keyword) => !row.unavailable.includes(keyword),
    );
    if (!availableAdditions.length) continue;
    await ascRequest(
      "POST",
      `/appCustomProductPageLocalizations/${row.localizationId}/relationships/searchKeywords`,
      {
        data: availableAdditions.map((id) => ({ type: "appKeywords", id })),
      },
    );
    mutations.push({
      page: row.page,
      locale: row.locale,
      localizationId: row.localizationId,
      added: availableAdditions,
    });
    console.log(
      `added ${availableAdditions.length} keyword(s): ${row.page}/${row.locale}`,
    );
  }

  const after = await validateKeywordPlan(manifestPath, planPath);
  const verification = after.map((row) => {
    const missingAvailable = row.additions.filter(
      (keyword) => !row.unavailable.includes(keyword),
    );
    return {
      page: row.page,
      locale: row.locale,
      missingAvailable,
      pendingUnavailable: row.unavailable,
      ok: missingAvailable.length === 0,
    };
  });
  const failed = verification.filter((row) => !row.ok);
  const pending = verification.filter(
    (row) => row.pendingUnavailable.length > 0,
  );
  const log = {
    appliedAt: new Date().toISOString(),
    mode: "add-only-available",
    before,
    mutations,
    after,
    verification,
    summary: {
      checked: after.length,
      changedLocalizations: mutations.length,
      addedRelations: mutations.reduce(
        (sum, mutation) => sum + mutation.added.length,
        0,
      ),
      verified: after.length - failed.length,
      pendingUnavailableRelations: pending.reduce(
        (sum, row) => sum + row.pendingUnavailable.length,
        0,
      ),
      pending,
      failed,
    },
  };
  writeFileSync(mutationLogPath, `${JSON.stringify(log, null, 2)}\n`);
  if (failed.length) {
    throw new Error(
      `Post-mutation verification failed for ${failed.length} localization(s); see ${mutationLogPath}`,
    );
  }
  return log.summary;
}

function usage() {
  console.error(
    [
      "Usage:",
      "  asc-cpp-screenshots.mjs list <localization-id>",
      "  asc-cpp-screenshots.mjs replace <localization-id> <display-type> <png> [png...]",
      "  asc-cpp-screenshots.mjs sync-manifest <manifest.json>",
      "  asc-cpp-screenshots.mjs verify-manifest <manifest.json>",
      "  asc-cpp-screenshots.mjs list-app-keywords <app-id> <locale> [platform]",
      "  asc-cpp-screenshots.mjs list-localization-keywords <localization-id>",
      "  asc-cpp-screenshots.mjs validate-keyword-plan <upload-manifest.json> <keyword-plan.json>",
      "  asc-cpp-screenshots.mjs apply-keyword-plan <upload-manifest.json> <keyword-plan.json> <mutation-log.json>",
    ].join("\n"),
  );
}

const [, , command, ...args] = process.argv;

if (command === "list" && args.length === 1) {
  const result = await listSets(args[0]);
  const rows = [];
  for (const set of result.data) {
    const screenshots = await listScreenshots(set.id);
    rows.push({
      id: set.id,
      displayType: set.attributes?.screenshotDisplayType,
      screenshotCount: screenshots.data?.length || 0,
    });
  }
  console.log(
    JSON.stringify(
      {
        sets: rows,
      },
      null,
      2,
    ),
  );
} else if (command === "replace" && args.length >= 3) {
  const [localizationId, displayType, ...filePaths] = args;
  const result = await replaceSet(localizationId, displayType, filePaths);
  console.log(JSON.stringify(result, null, 2));
} else if (command === "sync-manifest" && args.length === 1) {
  const result = await syncManifest(resolve(args[0]));
  console.log(JSON.stringify({ completed: result.length, results: result }, null, 2));
} else if (command === "verify-manifest" && args.length === 1) {
  const result = await verifyManifest(resolve(args[0]));
  const failed = result.filter((row) => !row.ok);
  console.log(
    JSON.stringify(
      {
        checked: result.length,
        passed: result.length - failed.length,
        failed,
      },
      null,
      2,
    ),
  );
  if (failed.length) process.exitCode = 1;
} else if (command === "list-app-keywords" && args.length >= 2) {
  const [appId, locale, platform = "IOS"] = args;
  const result = await ascRequest(
    "GET",
    `/apps/${appId}/searchKeywords?filter%5Blocale%5D=${encodeURIComponent(locale)}&filter%5Bplatform%5D=${encodeURIComponent(platform)}&limit=200`,
  );
  console.log(JSON.stringify(result, null, 2));
} else if (
  command === "list-localization-keywords" &&
  args.length === 1
) {
  const result = await ascRequest(
    "GET",
    `/appCustomProductPageLocalizations/${args[0]}/searchKeywords?limit=200`,
  );
  console.log(JSON.stringify(result, null, 2));
} else if (command === "validate-keyword-plan" && args.length === 2) {
  const result = await validateKeywordPlan(resolve(args[0]), resolve(args[1]));
  const failed = result.filter((row) => !row.ok);
  console.log(
    JSON.stringify(
      {
        checked: result.length,
        passed: result.length - failed.length,
        additions: result.reduce(
          (sum, row) => sum + row.additions.length,
          0,
        ),
        failed,
        rows: result,
      },
      null,
      2,
    ),
  );
  if (failed.length) process.exitCode = 1;
} else if (command === "apply-keyword-plan" && args.length === 3) {
  const result = await applyKeywordPlan(
    resolve(args[0]),
    resolve(args[1]),
    resolve(args[2]),
  );
  console.log(JSON.stringify(result, null, 2));
} else {
  usage();
  process.exitCode = 1;
}
