import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import path from "node:path";

const releaseSigning = process.env.VIBECHECK_RELEASE_SIGNING === "1";
const runtimePath = path.resolve(
  __dirname,
  "../../dist/runtime/vibecheck-runtime",
);

const config: ForgeConfig = {
  packagerConfig: {
    appBundleId: "com.rithvikprakki.vibecheck",
    appCategoryType: "public.app-category.utilities",
    asar: true,
    executableName: "Vibecheck",
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
    ],
    osxSign: releaseSigning
      ? {
          identity: process.env.VIBECHECK_DEVELOPER_IDENTITY,
          optionsForFile: (filePath) => {
            const isMain = filePath.endsWith("/Contents/MacOS/Vibecheck");
            const isElectronHelper = filePath.includes("Helper");
            return {
              hardenedRuntime: true,
              entitlements: isMain
                ? path.resolve(__dirname, "resources/entitlements.plist")
                : isElectronHelper
                  ? path.resolve(
                      __dirname,
                      "resources/entitlements-child.plist",
                    )
                  : path.resolve(
                      __dirname,
                      "resources/entitlements-native.plist",
                    ),
              signatureFlags: "runtime",
              timestamp: "http://timestamp.apple.com/ts01",
            };
          },
        }
      : undefined,
    osxNotarize: releaseSigning
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
        name: "Vibecheck-${version}-arm64",
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
        {
          entry: "src/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
  ],
};

export default config;
