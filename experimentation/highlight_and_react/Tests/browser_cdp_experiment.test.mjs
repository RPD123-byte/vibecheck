import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runBrowserExperiment } from "../scripts/browser_cdp_experiment.mjs";

const chrome =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test(
  "isolated Chrome exposes DOM, CSS, frames, shadow DOM, selection, and capture through CDP",
  { skip: !existsSync(chrome), timeout: 45_000 },
  async () => {
    const artifactDirectory = await mkdtemp(
      join(tmpdir(), "highlight-and-react-browser-artifacts-"),
    );
    try {
      const report = await runBrowserExperiment({
        artifactDirectory,
        browser: chrome,
        headless: true,
      });

      assert.equal(report.browser.isolatedProfile, true);
      assert.equal(report.pageAccess.cssMutationObserved, true);
      assert.match(
        report.pageAccess.targetText,
        /Selectable browser component/,
      );
      assert.match(report.pageAccess.sameOriginFrameText, /Selectable frame/);
      assert.equal(
        report.pageAccess.crossOriginBlockedFromPageJavaScript,
        true,
      );
      assert.equal(
        report.pageAccess.closedShadowHiddenFromPageJavaScript,
        true,
      );
      assert.equal(report.closedShadowPiercedByCdp, true);
      assert.equal(report.exactRangeSelection.toolbarOpened, true);
      assert.equal(report.exactRangeSelection.exactHighlightInstalled, true);
      assert.equal(report.exactRangeSelection.inputDispatchedByCdp, true);
      assert.equal(
        report.exactRangeSelection.selectedText,
        "This exact sentence",
      );
      assert.equal(report.elementSelection.hover, "hover");
      assert.equal(report.elementSelection.locked, true);
      assert.equal(report.elementSelection.underlyingActivations, 0);
      assert.equal(report.elementSelection.contextEvents, 1);
      assert.equal(report.elementSelection.inputDispatchedByCdp, true);
      assert.equal(
        report.strictContentSecurityPolicy.scriptInstalled,
        true,
      );
      assert.equal(
        report.strictContentSecurityPolicy.styleElementInstalled,
        true,
      );
      assert.equal(
        report.strictContentSecurityPolicy.inlineRuleCount,
        0,
      );
      assert.equal(
        report.strictContentSecurityPolicy
          .cdpStyleSheetContainsOverlayRule,
        true,
      );
      assert.equal(
        report.strictContentSecurityPolicy.selectorEntered.active,
        true,
      );
      assert.equal(
        report.strictContentSecurityPolicy.selectorEntered.overlayPosition,
        "fixed",
      );
      assert.equal(
        report.strictContentSecurityPolicy.selectorEntered.cursor,
        "crosshair",
      );
      assert.equal(report.continuousOwnership.autoAttachEnabled, true);
      assert.equal(
        report.continuousOwnership.newTabInjected.styleInstalled,
        true,
      );
      assert.match(
        report.continuousOwnership.newTabInjected.href,
        /navigation-one\.html/,
      );
      assert.equal(
        report.continuousOwnership.reinjectedAfterNavigation.styleInstalled,
        true,
      );
      assert.match(
        report.continuousOwnership.reinjectedAfterNavigation.href,
        /navigation-two\.html/,
      );
      assert.equal(
        report.continuousOwnership.crossOriginFrame.injected,
        true,
      );
      assert.equal(
        report.continuousOwnership.crossOriginFrame.targetType,
        "iframe",
      );
      assert.equal(report.capturedContext.length, 1);
      assert.equal(
        report.capturedContext[0].screenshot.mimeType,
        "image/png",
      );

      const frameDocuments = report.frames.filter((frame) =>
        frame.href?.endsWith("/frame.html"),
      );
      assert.equal(frameDocuments.length, 2);
      assert.ok(frameDocuments.every((frame) => frame.injected));
      assert.ok(frameDocuments.every((frame) => frame.styleInstalled));
      assert.ok(
        frameDocuments.every((frame) => frame.computedBorder === "2px"),
      );
    } finally {
      await rm(artifactDirectory, { recursive: true, force: true });
    }
  },
);
