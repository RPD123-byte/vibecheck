import SafariServices

enum BrowserSetup {
    static let safariExtensionIdentifier =
        "com.rithvikprakki.vibecheck.browser.Extension"

    static func openSafariExtensionPreferences(
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        SFSafariApplication.showPreferencesForExtension(
            withIdentifier: safariExtensionIdentifier
        ) { error in
            if let error {
                completion(.failure(error))
            } else {
                completion(.success(()))
            }
        }
    }
}
