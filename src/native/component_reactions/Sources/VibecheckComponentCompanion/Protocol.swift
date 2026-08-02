import Foundation

let companionProtocolVersion = 1
let maximumCommandBytes = 64 * 1024
let maximumTextBytes = 32 * 1024
let maximumPNGBytes = 25 * 1024 * 1024
let maximumBundleIdentifierBytes = 256

struct CompanionCommand: Decodable {
    let version: Int
    let id: String
    let type: CommandType
    let enabled: Bool?
    let text: String?
    let pngPath: String?
    let bundlePath: String?
    let debugPort: Int?
    let ownershipMarker: String?
    let launchProfile: LaunchProfile?

    enum CodingKeys: String, CodingKey, CaseIterable {
        case version, id, type, enabled, text
        case pngPath = "png_path"
        case bundlePath = "bundle_path"
        case debugPort = "debug_port"
        case ownershipMarker = "ownership_marker"
        case launchProfile = "launch_profile"
    }

    func validate() throws {
        guard version == companionProtocolVersion else {
            throw CompanionError.invalid("unsupported protocol version")
        }
        guard !id.isEmpty, id.utf8.count <= 128 else {
            throw CompanionError.invalid("invalid command id")
        }
        switch type {
        case .setEnabled:
            guard enabled != nil else {
                throw CompanionError.invalid("set_enabled requires enabled")
            }
        case .appendBundle, .replaceBundle:
            guard let text, text.utf8.count <= maximumTextBytes,
                  let pngPath, !pngPath.isEmpty
            else {
                throw CompanionError.invalid("clipboard bundle payload is invalid")
            }
        case .relaunchTarget:
            guard let bundlePath, !bundlePath.isEmpty,
                  let debugPort, (1 ... 65_535).contains(debugPort),
                  let ownershipMarker,
                  !ownershipMarker.isEmpty,
                  ownershipMarker.utf8.count <= 128
            else {
                throw CompanionError.invalid("relaunch_target payload is invalid")
            }
        case .ping, .permissionStatus, .listTargets, .clipboardStatus,
             .tapbackAssets, .openSafariExtensionPreferences, .shutdown:
            break
        }
    }
}

enum LaunchProfile: String, Decodable {
    case standard
    case managedCodex = "managed_codex"
}

enum CommandType: String, Decodable {
    case ping
    case setEnabled = "set_enabled"
    case permissionStatus = "permission_status"
    case listTargets = "list_targets"
    case relaunchTarget = "relaunch_target"
    case replaceBundle = "replace_bundle"
    case appendBundle = "append_bundle"
    case clipboardStatus = "clipboard_status"
    case tapbackAssets = "tapback_assets"
    case openSafariExtensionPreferences = "open_safari_extension_preferences"
    case shutdown
}

struct CompanionResponse: Encodable {
    let version = companionProtocolVersion
    let id: String
    let ok: Bool
    var result: ResponseResult?
    var error: ResponseError?
}

struct ResponseResult: Encodable {
    var enabled: Bool?
    var permission: String?
    var entryCount: Int?
    var marked: Bool?
    var targets: [TargetApplication]?
    var relaunched: Bool?
    var tapbackAssets: [String: String]?

    enum CodingKeys: String, CodingKey {
        case enabled, permission, marked, targets, relaunched
        case entryCount = "entry_count"
        case tapbackAssets = "tapback_assets"
    }
}

struct ResponseError: Encodable {
    let code: String
    let message: String
}

enum CompanionError: Error {
    case invalid(String)
    case permission(String)
    case operation(String)

    var response: ResponseError {
        switch self {
        case let .invalid(message):
            return ResponseError(code: "invalid_command", message: message)
        case let .permission(message):
            return ResponseError(code: "needs_permission", message: message)
        case let .operation(message):
            return ResponseError(code: "operation_failed", message: message)
        }
    }
}
