import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import fs from "node:fs";
import path from "node:path";
import packageManifest from "./package.json";

const releaseSigning = process.env.VIBECHECK_RELEASE_SIGNING === "1";
const localSigning = process.env.VIBECHECK_LOCAL_SIGNING === "1";
const releaseNotarization = process.env.VIBECHECK_RELEASE_NOTARIZATION === "1";
const signingEnabled = releaseSigning || localSigning;
const runtimePath = path.resolve(
  __dirname,
  "../../dist/runtime/vibecheck-runtime",
);
const componentCompanionPath = path.resolve(
  __dirname,
  "../../dist/component-reactions",
);
const safariExtensionPath = path.resolve(
  __dirname,
  "../../dist/component-reactions/safari/Vibecheck Browser Reactions Extension.appex",
);
const mainEntitlements = path.resolve(
  __dirname,
  "resources/entitlements.plist",
);
const childEntitlements = path.resolve(
  __dirname,
  "resources/entitlements-child.plist",
);
const cameraWorkerEntitlements = path.resolve(
  __dirname,
  "resources/entitlements-camera-worker.plist",
);
const nativeEntitlements = path.resolve(
  __dirname,
  "resources/entitlements-native.plist",
);

if (releaseNotarization && !releaseSigning) {
  throw new Error("VIBECHECK_RELEASE_NOTARIZATION requires release signing");
}

function entitlementsForFile(filePath: string): string {
  if (filePath.endsWith("/Vibecheck.app")) {
    return mainEntitlements;
  }
  if (
    filePath.endsWith("/Contents/Resources/vibecheck-runtime/vibecheck-runtime")
  ) {
    return cameraWorkerEntitlements;
  }
  if (filePath.includes("Helper")) {
    return childEntitlements;
  }
  return nativeEntitlements;
}

const config: ForgeConfig = {
  packagerConfig: {
    appBundleId: "com.rithvikprakki.vibecheck",
    appCategoryType: "public.app-category.utilities",
    asar: true,
    executableName: "Vibecheck",
    icon: path.resolve(__dirname, "resources/app-icon.icns"),
    extendInfo: {
      LSUIElement: true,
      NSCameraUsageDescription:
        "Vibecheck uses the camera on device to recognize facial expressions.",
      NSAppleEventsUsageDescription:
        "Vibecheck may control ChatGPT to restart an interrupted Codex response.",
    },
    extraResource: [
      runtimePath,
      path.resolve(__dirname, "../../THIRD_PARTY_NOTICES.md"),
      path.resolve(__dirname, "resources/trayTemplate.png"),
      path.resolve(__dirname, "resources/trayTemplate@2x.png"),
    ],
    afterCopyExtraResources: [
      (buildPath, _electronVersion, platform, _arch, done) => {
        if (platform !== "darwin") {
          done();
          return;
        }
        try {
          const packagedApp = path.join(
            buildPath,
            `${packageManifest.productName}.app`,
          );
          if (!fs.existsSync(path.join(packagedApp, "Contents"))) {
            throw new Error(`Packaged application is missing: ${packagedApp}`);
          }
          const companionResources = path.join(
            packagedApp,
            "Contents",
            "Resources",
            "component-reactions",
          );
          fs.mkdirSync(companionResources, { recursive: true });
          for (const name of [
            "vibecheck-component-companion",
            "vibecheck-component-input.node",
          ]) {
            const source = path.join(componentCompanionPath, name);
            if (!fs.existsSync(source)) {
              throw new Error(`Component resource is missing: ${source}`);
            }
            fs.copyFileSync(source, path.join(companionResources, name));
          }
          const browserSource = path.join(
            componentCompanionPath,
            "browser-extension",
          );
          if (!fs.existsSync(path.join(browserSource, "manifest.json"))) {
            throw new Error(`Browser extension is missing: ${browserSource}`);
          }
          fs.cpSync(
            browserSource,
            path.join(companionResources, "browser-extension"),
            { recursive: true },
          );
          if (!fs.existsSync(safariExtensionPath)) {
            throw new Error(
              `Safari extension is missing: ${safariExtensionPath}`,
            );
          }
          const plugIns = path.join(packagedApp, "Contents", "PlugIns");
          fs.mkdirSync(plugIns, { recursive: true });
          fs.cpSync(
            safariExtensionPath,
            path.join(plugIns, path.basename(safariExtensionPath)),
            { recursive: true },
          );
          done();
        } catch (error) {
          done(error instanceof Error ? error : new Error(String(error)));
        }
      },
    ],
    osxSign: signingEnabled
      ? {
          identity:
            process.env.VIBECHECK_DEVELOPER_IDENTITY ??
            "Developer ID Application",
          optionsForFile: (filePath) => {
            return {
              hardenedRuntime: true,
              entitlements: entitlementsForFile(filePath),
              signatureFlags: "runtime",
              ...(releaseSigning
                ? { timestamp: "http://timestamp.apple.com/ts01" }
                : {}),
            };
          },
        }
      : undefined,
    osxNotarize: releaseNotarization
      ? {
          appleApiKey: process.env.APPLE_API_KEY_PATH!,
          appleApiKeyId: process.env.APPLE_API_KEY_ID!,
          appleApiIssuer: process.env.APPLE_API_ISSUER!,
        }
      : undefined,
  },
  rebuildConfig: {},
  makers: [
    new MakerDMG(
      {
        format: "ULFO",
        icon: path.resolve(__dirname, "resources/app-icon.icns"),
        name: `Vibecheck-${packageManifest.version}-arm64`,
      },
      ["darwin"],
    ),
    new MakerZIP({}, ["darwin"]),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
      ],
      renderer: [],
    }),
  ],
};

export default config;
