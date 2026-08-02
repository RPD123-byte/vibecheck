import assert from "node:assert/strict";
import { test } from "node:test";
import {
  runSafariExperiment,
} from "../scripts/safari_webdriver_experiment.mjs";

test(
  "Safari exposes DOM, CSS, frames, selection, capture, and navigation repair through WebDriver",
  { timeout: 45_000 },
  async (context) => {
    const report = await runSafariExperiment();
    if (!report.available) {
      context.skip(`Safari WebDriver unavailable: ${report.error}`);
      return;
    }

    assert.equal(report.pageAccess.cssMutationObserved, true);
    assert.match(report.pageAccess.text, /Selectable browser component/);
    assert.equal(report.pageAccess.closedShadowHidden, true);
    assert.equal(report.exactSelection.selectedText, "This exact sentence");
    assert.equal(report.exactSelection.toolbarOpened, true);
    assert.equal(report.exactSelection.exactHighlightInstalled, true);
    assert.equal(report.elementSelection.hover, "hover");
    assert.equal(report.elementSelection.locked, true);
    assert.equal(report.elementSelection.underlyingActivations, 0);
    assert.equal(report.elementSelection.contextEvents, 1);
    assert.equal(report.elementSelection.screenshotCaptured, true);
    assert.equal(report.sameOriginFrame.injected, true);
    assert.equal(report.sameOriginFrame.border, "2px");
    assert.equal(report.crossOriginFrame.injected, true);
    assert.equal(report.crossOriginFrame.border, "2px");
    assert.equal(report.screenshot.captured, true);
    assert.equal(report.navigation.injectionBeforeOwnerRepair, false);
    assert.equal(report.navigation.injected, true);
    assert.equal(report.navigation.styleInstalled, true);
  },
);
