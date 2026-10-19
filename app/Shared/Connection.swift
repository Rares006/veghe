import Foundation
import Security

/// Unde e agentul și cu ce token intrăm. Stă în Keychain, nu în preferințe.
struct Connection: Codable, Equatable {
    var url: String
    var token: String

    /// Link-ul din codul QR afișat de aplicația de Mac, în oricare din forme:
    /// http://100.x.y.z:8787/#token=…  (web app; aplicația nativă îl citește cu scannerul)
    /// controllaptop://pair?url=http://100.x.y.z:8787&token=…
    init?(pairingURL: URL) {
        if pairingURL.scheme == "http" || pairingURL.scheme == "https" {
            guard let host = pairingURL.host,
                  let fragment = pairingURL.fragment,
                  let token = URLComponents(string: "x:?" + fragment)?.queryItems?.first(where: { $0.name == "token" })?.value,
                  !token.isEmpty
            else { return nil }
            let port = pairingURL.port.map { ":\($0)" } ?? ""
            self.url = "\(pairingURL.scheme!)://\(host)\(port)"
            self.token = token
            return
        }
        guard pairingURL.scheme == "controllaptop",
              let items = URLComponents(url: pairingURL, resolvingAgainstBaseURL: false)?.queryItems,
              let url = items.first(where: { $0.name == "url" })?.value, !url.isEmpty,
              let token = items.first(where: { $0.name == "token" })?.value, !token.isEmpty
        else { return nil }
        self.url = url
        self.token = token
    }

    init(url: String, token: String) {
        self.url = url
        self.token = token
    }

    var pairingURL: URL? {
        var c = URLComponents()
        c.scheme = "controllaptop"
        c.host = "pair"
        c.queryItems = [URLQueryItem(name: "url", value: url), URLQueryItem(name: "token", value: token)]
        return c.url
    }
}

enum ConnectionStore {
    private static let service = "ro.betania.controllaptop"
    private static let account = "connection"

    static func load() -> Connection? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return nil }
        return try? JSONDecoder().decode(Connection.self, from: data)
    }

    static func save(_ connection: Connection) {
        guard let data = try? JSONEncoder().encode(connection) else { return }
        clear()
        let attrs: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        SecItemAdd(attrs as CFDictionary, nil)
    }

    static func clear() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }

    #if os(macOS)
    /// Pe Mac nu e nevoie de împerechere: citim direct config-ul agentului.
    static func localAgent() -> Connection? {
        let url = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/ControlLaptop/config.json")
        guard let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = json["token"] as? String
        else { return nil }
        let port = json["port"] as? Int ?? 8787
        return Connection(url: "http://127.0.0.1:\(port)", token: token)
    }
    #endif
}
