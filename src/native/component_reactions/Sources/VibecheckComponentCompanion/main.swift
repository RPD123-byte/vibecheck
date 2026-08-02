import AppKit
import Foundation

final class Companion {
    private let expander = PasteExpander()
    private let targetApplications = TargetApplicationObserver()
    private var stopping = false

    func run() {
        FileHandle.standardInput.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty {
                DispatchQueue.main.async {
                    self?.stop()
                }
                return
            }
            self?.consume(data)
        }
        CFRunLoopRun()
    }

    private var inputBuffer = Data()

    private func consume(_ data: Data) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            inputBuffer.append(data)
            while let newline = inputBuffer.firstIndex(of: 0x0a) {
                let frame = inputBuffer.prefix(upTo: newline)
                inputBuffer.removeSubrange(...newline)
                handle(Data(frame))
            }
            if inputBuffer.count > maximumCommandBytes {
                writeFailure(id: "unknown", error: .invalid("command frame exceeds limit"))
                stop()
            }
        }
    }

    private func handle(_ data: Data) {
        let command: CompanionCommand
        do {
            guard data.count <= maximumCommandBytes else {
                throw CompanionError.invalid("command frame exceeds limit")
            }
            guard
                let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                Set(raw.keys).isSubset(of: Set(CompanionCommand.CodingKeys.allCases.map(\.rawValue)))
            else {
                throw CompanionError.invalid("command contains unknown fields")
            }
            command = try JSONDecoder().decode(CompanionCommand.self, from: data)
            try command.validate()
        } catch let error as CompanionError {
            writeFailure(id: decodedID(data) ?? "unknown", error: error)
            return
        } catch {
            writeFailure(id: decodedID(data) ?? "unknown", error: .invalid("invalid command"))
            return
        }

        do {
            switch command.type {
            case .ping:
                writeSuccess(id: command.id, result: ResponseResult())
            case .setEnabled:
                try expander.setEnabled(command.enabled == true)
                writeSuccess(
                    id: command.id,
                    result: ResponseResult(enabled: command.enabled)
                )
            case .permissionStatus:
                writeSuccess(
                    id: command.id,
                    result: ResponseResult(
                        permission: expander.permissionGranted ? "granted" : "denied"
                    )
                )
            case .listTargets:
                writeSuccess(
                    id: command.id,
                    result: ResponseResult(targets: targetApplications.snapshot())
                )
            case .relaunchTarget:
                TargetApplications.relaunch(
                    bundlePath: command.bundlePath!,
                    debugPort: command.debugPort!,
                    ownershipMarker: command.ownershipMarker!,
                    launchProfile: command.launchProfile ?? .standard
                ) { [weak self] result in
                    switch result {
                    case .success:
                        self?.writeSuccess(
                            id: command.id,
                            result: ResponseResult(relaunched: true)
                        )
                    case let .failure(error as CompanionError):
                        self?.writeFailure(id: command.id, error: error)
                    case let .failure(error):
                        self?.writeFailure(
                            id: command.id,
                            error: .operation(error.localizedDescription)
                        )
                    }
                }
            case .appendBundle, .replaceBundle:
                let pngURL = try validatedRuntimePNG(command.pngPath!)
                let png = try Data(contentsOf: pngURL, options: .mappedIfSafe)
                let bundle = try command.type == .replaceBundle
                    ? ClipboardBundleCodec.replace(text: command.text!, png: png)
                    : ClipboardBundleCodec.append(text: command.text!, png: png)
                writeSuccess(
                    id: command.id,
                    result: ResponseResult(entryCount: bundle.entries.count, marked: true)
                )
            case .clipboardStatus:
                let bundle = ClipboardBundleCodec.read()
                writeSuccess(
                    id: command.id,
                    result: ResponseResult(
                        entryCount: bundle?.entries.count ?? 0,
                        marked: bundle != nil
                    )
                )
            case .tapbackAssets:
                writeSuccess(
                    id: command.id,
                    result: ResponseResult(tapbackAssets: SystemTapbacks.render())
                )
            case .openSafariExtensionPreferences:
                BrowserSetup.openSafariExtensionPreferences { [weak self] result in
                    switch result {
                    case .success:
                        self?.writeSuccess(id: command.id, result: ResponseResult())
                    case let .failure(error):
                        self?.writeFailure(
                            id: command.id,
                            error: .operation(error.localizedDescription)
                        )
                    }
                }
            case .shutdown:
                writeSuccess(id: command.id, result: ResponseResult())
                stop()
            }
        } catch let error as CompanionError {
            writeFailure(id: command.id, error: error)
        } catch {
            writeFailure(id: command.id, error: .operation(error.localizedDescription))
        }
    }

    private func decodedID(_ data: Data) -> String? {
        (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["id"] as? String
    }

    private func validatedRuntimePNG(_ value: String) throws -> URL {
        let url = URL(fileURLWithPath: value).standardizedFileURL
        let resolved = url.resolvingSymlinksInPath()
        let parent = resolved.deletingLastPathComponent()
        let expectedPrefix = "vibecheck-\(getuid())-"
        guard resolved.pathExtension.lowercased() == "png",
              parent.lastPathComponent.hasPrefix(expectedPrefix),
              let attributes = try? FileManager.default.attributesOfItem(
                  atPath: resolved.path
              ),
              attributes[.type] as? FileAttributeType == .typeRegular
        else {
            throw CompanionError.invalid("PNG path is outside the owned runtime")
        }
        return resolved
    }

    private func writeSuccess(id: String, result: ResponseResult) {
        write(CompanionResponse(id: id, ok: true, result: result))
    }

    private func writeFailure(id: String, error: CompanionError) {
        write(CompanionResponse(id: id, ok: false, error: error.response))
    }

    private func write(_ response: CompanionResponse) {
        guard let data = try? JSONEncoder().encode(response) else { return }
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0a]))
    }

    private func stop() {
        guard !stopping else { return }
        stopping = true
        try? expander.setEnabled(false)
        FileHandle.standardInput.readabilityHandler = nil
        CFRunLoopStop(CFRunLoopGetMain())
    }
}

let companion = Companion()
companion.run()
