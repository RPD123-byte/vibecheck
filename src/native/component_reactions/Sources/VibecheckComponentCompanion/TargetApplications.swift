import AppKit
import Darwin
import Foundation
import Security

struct ManagedLaunchMetadata: Equatable {
    let debugPort: Int
    let ownershipMarker: String
}

struct TargetApplication: Encodable, Equatable {
    let name: String
    let bundleIdentifier: String
    let bundlePath: String
    let processIdentifier: Int32
    let managedLaunch: ManagedLaunchMetadata?

    enum CodingKeys: String, CodingKey {
        case name
        case bundleIdentifier = "bundle_id"
        case bundlePath = "bundle_path"
        case processIdentifier = "pid"
        case managedDebugPort = "managed_debug_port"
        case managedOwnershipMarker = "managed_ownership_marker"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(name, forKey: .name)
        try container.encode(bundleIdentifier, forKey: .bundleIdentifier)
        try container.encode(bundlePath, forKey: .bundlePath)
        try container.encode(processIdentifier, forKey: .processIdentifier)
        try container.encodeIfPresent(
            managedLaunch?.debugPort,
            forKey: .managedDebugPort
        )
        try container.encodeIfPresent(
            managedLaunch?.ownershipMarker,
            forKey: .managedOwnershipMarker
        )
    }
}

enum TargetApplications {
    private static let excludedBundleIdentifiers: Set<String> = [
        "com.rithvikprakki.vibecheck",
        "com.apple.Safari",
        "com.google.Chrome",
        "com.microsoft.edgemac",
        "org.mozilla.firefox",
    ]
    private static let codexBundleIdentifiers: Set<String> = [
        "com.openai.codex",
        "com.openai.chat",
    ]

    static func isExcluded(_ bundleIdentifier: String) -> Bool {
        excludedBundleIdentifiers.contains(bundleIdentifier)
    }

    static func running() -> [TargetApplication] {
        NSWorkspace.shared.runningApplications.compactMap(describe)
    }

    static func describe(_ application: NSRunningApplication) -> TargetApplication? {
        guard let bundleIdentifier = application.bundleIdentifier,
          !isExcluded(bundleIdentifier),
          let bundleURL = application.bundleURL,
          isSupportedBundle(bundleURL, bundleIdentifier: bundleIdentifier),
          hasValidCodeSignature(bundleURL)
        else {
            return nil
        }
        return TargetApplication(
            name: application.localizedName ?? bundleURL.deletingPathExtension().lastPathComponent,
            bundleIdentifier: bundleIdentifier,
            bundlePath: bundleURL.path,
            processIdentifier: application.processIdentifier,
            managedLaunch: managedLaunchMetadata(
                arguments: processArguments(pid: application.processIdentifier)
            )
        )
    }

    static func managedLaunchMetadata(arguments: [String]) -> ManagedLaunchMetadata? {
        guard arguments.contains("--remote-debugging-address=127.0.0.1"),
              let portArgument = arguments.first(where: {
                  $0.hasPrefix("--remote-debugging-port=")
              }),
              let markerArgument = arguments.first(where: {
                  $0.hasPrefix("--vibecheck-owned-launch=")
              }),
              let port = Int(portArgument.dropFirst("--remote-debugging-port=".count)),
              (43_000 ... 49_999).contains(port)
        else {
            return nil
        }
        let marker = String(markerArgument.dropFirst("--vibecheck-owned-launch=".count))
        guard marker.count == 32,
              marker.unicodeScalars.allSatisfy({
                  (48 ... 57).contains($0.value) || (97 ... 102).contains($0.value)
              })
        else {
            return nil
        }
        return ManagedLaunchMetadata(debugPort: port, ownershipMarker: marker)
    }

    private static func processArguments(pid: pid_t) -> [String] {
        var mib = [CTL_KERN, KERN_PROCARGS2, pid]
        var size = 0
        guard sysctl(&mib, 3, nil, &size, nil, 0) == 0, size > 0 else {
            return []
        }
        var buffer = [UInt8](repeating: 0, count: size)
        guard sysctl(&mib, 3, &buffer, &size, nil, 0) == 0,
              size >= MemoryLayout<Int32>.size
        else {
            return []
        }
        var argc: Int32 = 0
        withUnsafeMutableBytes(of: &argc) { destination in
            buffer.withUnsafeBytes { source in
                destination.copyBytes(
                    from: source.prefix(MemoryLayout<Int32>.size)
                )
            }
        }
        guard argc > 0 else { return [] }
        var index = MemoryLayout<Int32>.size
        while index < size, buffer[index] != 0 { index += 1 }
        while index < size, buffer[index] == 0 { index += 1 }
        var arguments: [String] = []
        while index < size, arguments.count < Int(argc) {
            let start = index
            while index < size, buffer[index] != 0 { index += 1 }
            if index > start,
               let value = String(bytes: buffer[start ..< index], encoding: .utf8)
            {
                arguments.append(value)
            }
            while index < size, buffer[index] == 0 { index += 1 }
        }
        return arguments
    }

    static func validateBundle(at url: URL) throws -> Bundle {
        let standardized = url.standardizedFileURL
        guard standardized.pathExtension == "app",
              standardized.isFileURL,
              let bundle = Bundle(url: standardized),
              let bundleIdentifier = bundle.bundleIdentifier,
              bundleIdentifier.utf8.count <= maximumBundleIdentifierBytes,
              !isExcluded(bundleIdentifier),
              bundle.executableURL != nil,
              isSupportedBundle(standardized, bundleIdentifier: bundleIdentifier),
              hasValidCodeSignature(standardized)
        else {
            throw CompanionError.invalid("unsupported application bundle")
        }
        return bundle
    }

    static func relaunch(
        bundlePath: String,
        debugPort: Int,
        ownershipMarker: String,
        launchProfile: LaunchProfile,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        let url = URL(fileURLWithPath: bundlePath)
        let bundle: Bundle
        do {
            bundle = try validateBundle(at: url)
            if launchProfile == .managedCodex,
               !codexBundleIdentifiers.contains(bundle.bundleIdentifier ?? "")
            {
                throw CompanionError.invalid(
                    "managed_codex is valid only for the ChatGPT application"
                )
            }
        } catch {
            completion(.failure(error))
            return
        }
        if launchProfile == .managedCodex {
            ensureManagedCodexDaemon { result in
                switch result {
                case .success:
                    relaunchValidated(
                        bundle: bundle,
                        url: url,
                        debugPort: debugPort,
                        ownershipMarker: ownershipMarker,
                        launchProfile: launchProfile,
                        completion: completion
                    )
                case let .failure(error):
                    completion(.failure(error))
                }
            }
            return
        }
        relaunchValidated(
            bundle: bundle,
            url: url,
            debugPort: debugPort,
            ownershipMarker: ownershipMarker,
            launchProfile: launchProfile,
            completion: completion
        )
    }

    private static func relaunchValidated(
        bundle: Bundle,
        url: URL,
        debugPort: Int,
        ownershipMarker: String,
        launchProfile: LaunchProfile,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        let running = NSRunningApplication.runningApplications(
            withBundleIdentifier: bundle.bundleIdentifier ?? ""
        )
        for application in running {
            guard application.terminate() else {
                completion(.failure(CompanionError.operation("target refused graceful termination")))
                return
            }
        }
        waitForExit(running, deadline: Date().addingTimeInterval(8)) {
            guard running.allSatisfy({ $0.isTerminated }) else {
                completion(.failure(CompanionError.operation("target did not terminate gracefully")))
                return
            }
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.arguments = [
                "--remote-debugging-address=127.0.0.1",
                "--remote-debugging-port=\(debugPort)",
                "--vibecheck-owned-launch=\(ownershipMarker)",
            ]
            if launchProfile == .managedCodex {
                configuration.environment = [
                    "CODEX_APP_SERVER_USE_LOCAL_DAEMON": "1",
                    "CODEX_APP_SERVER_FORCE_CLI": "0",
                ]
            }
            configuration.activates = true
            NSWorkspace.shared.openApplication(
                at: url,
                configuration: configuration
            ) { _, error in
                if let error {
                    completion(.failure(error))
                } else {
                    completion(.success(()))
                }
            }
        }
    }

    private static func ensureManagedCodexDaemon(
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        let executable = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".codex/packages/standalone/current/codex")
        guard FileManager.default.isExecutableFile(atPath: executable.path) else {
            completion(
                .failure(
                    CompanionError.operation(
                        "standalone Codex is unavailable for the managed ChatGPT launch"
                    )
                )
            )
            return
        }
        let process = Process()
        process.executableURL = executable
        process.arguments = ["app-server", "daemon", "start"]
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        let errors = Pipe()
        process.standardError = errors
        var finished = false
        let finish: (Result<Void, Error>) -> Void = { result in
            guard !finished else { return }
            finished = true
            completion(result)
        }
        process.terminationHandler = { process in
            DispatchQueue.main.async {
                if process.terminationStatus == 0 {
                    finish(.success(()))
                } else {
                    let data = errors.fileHandleForReading.readDataToEndOfFile()
                    let detail = String(data: data, encoding: .utf8)?
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                    finish(
                        .failure(
                            CompanionError.operation(
                                detail?.isEmpty == false
                                    ? detail!
                                    : "managed Codex daemon start failed"
                            )
                        )
                    )
                }
            }
        }
        do {
            try process.run()
        } catch {
            finish(.failure(CompanionError.operation(error.localizedDescription)))
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
            guard !finished else { return }
            if process.isRunning {
                process.terminate()
            }
            finish(.failure(CompanionError.operation("managed Codex daemon start timed out")))
        }
    }

    private static func waitForExit(
        _ applications: [NSRunningApplication],
        deadline: Date,
        completion: @escaping () -> Void
    ) {
        if applications.allSatisfy(\.isTerminated) || Date() >= deadline {
            completion()
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            waitForExit(applications, deadline: deadline, completion: completion)
        }
    }

    private static func isSupportedBundle(
        _ url: URL,
        bundleIdentifier: String
    ) -> Bool {
        let frameworks = url.appendingPathComponent("Contents/Frameworks")
        guard let children = try? FileManager.default.contentsOfDirectory(
            at: frameworks,
            includingPropertiesForKeys: nil
        ) else {
            return false
        }
        return children.contains {
            $0.lastPathComponent.contains("Electron Framework")
                || $0.lastPathComponent.contains("Chromium Embedded Framework")
                || (
                    codexBundleIdentifiers.contains(bundleIdentifier)
                        && $0.lastPathComponent == "Codex Framework.framework"
                )
        }
    }

    private static func hasValidCodeSignature(_ url: URL) -> Bool {
        var code: SecStaticCode?
        guard SecStaticCodeCreateWithPath(
            url as CFURL,
            SecCSFlags(rawValue: 0),
            &code
        ) == errSecSuccess, let code else {
            return false
        }
        let flags = SecCSFlags(
            rawValue: UInt32(kSecCSCheckAllArchitectures | kSecCSStrictValidate)
        )
        return SecStaticCodeCheckValidity(code, flags, nil) == errSecSuccess
    }
}

final class TargetApplicationObserver {
    private let workspace: NSWorkspace
    private var applications: [String: TargetApplication]
    private var observers: [NSObjectProtocol] = []

    init(workspace: NSWorkspace = .shared) {
        self.workspace = workspace
        applications = Dictionary(
            uniqueKeysWithValues: TargetApplications.running().map {
                ($0.bundleIdentifier, $0)
            }
        )
        let center = workspace.notificationCenter
        observers.append(
            center.addObserver(
                forName: NSWorkspace.didLaunchApplicationNotification,
                object: workspace,
                queue: .main
            ) { [weak self] notification in
                self?.applicationDidLaunch(notification)
            }
        )
        observers.append(
            center.addObserver(
                forName: NSWorkspace.didTerminateApplicationNotification,
                object: workspace,
                queue: .main
            ) { [weak self] notification in
                self?.applicationDidTerminate(notification)
            }
        )
    }

    deinit {
        for observer in observers {
            workspace.notificationCenter.removeObserver(observer)
        }
    }

    func snapshot() -> [TargetApplication] {
        applications.values.sorted {
            if $0.bundleIdentifier == $1.bundleIdentifier {
                return $0.processIdentifier < $1.processIdentifier
            }
            return $0.bundleIdentifier < $1.bundleIdentifier
        }
    }

    private func applicationDidLaunch(_ notification: Notification) {
        guard
            let application = notification.userInfo?[
                NSWorkspace.applicationUserInfoKey
            ] as? NSRunningApplication,
            let target = TargetApplications.describe(application)
        else {
            return
        }
        applications[target.bundleIdentifier] = target
    }

    private func applicationDidTerminate(_ notification: Notification) {
        guard
            let application = notification.userInfo?[
                NSWorkspace.applicationUserInfoKey
            ] as? NSRunningApplication,
            let bundleIdentifier = application.bundleIdentifier,
            applications[bundleIdentifier]?.processIdentifier
                == application.processIdentifier
        else {
            return
        }
        applications.removeValue(forKey: bundleIdentifier)
    }
}
