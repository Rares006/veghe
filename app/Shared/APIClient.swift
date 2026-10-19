import Foundation

struct APIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// Vorbește cu agentul de pe Mac. Fiecare cerere poartă tokenul din config.json.
struct APIClient {
    let baseURL: URL
    let token: String

    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.waitsForConnectivity = false
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config)
    }()

    init?(_ connection: Connection) {
        var raw = connection.url.trimmingCharacters(in: .whitespacesAndNewlines)
        if !raw.contains("://") { raw = "http://" + raw }
        while raw.hasSuffix("/") { raw.removeLast() }
        guard let url = URL(string: raw), url.host != nil else { return nil }
        baseURL = url
        token = connection.token.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = [], timeout: TimeInterval = 15) async throws -> T {
        let data = try await raw(path, query: query, timeout: timeout)
        return try decode(data)
    }

    func raw(_ path: String, query: [URLQueryItem] = [], timeout: TimeInterval = 15) async throws -> Data {
        var request = URLRequest(url: url(path, query: query))
        request.timeoutInterval = timeout
        return try await send(request)
    }

    func post<T: Decodable, Body: Encodable>(_ path: String, body: Body) async throws -> T {
        var request = URLRequest(url: url(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try decode(try await send(request))
    }

    func post<T: Decodable>(_ path: String) async throws -> T {
        var request = URLRequest(url: url(path))
        request.httpMethod = "POST"
        return try decode(try await send(request))
    }

    func delete(_ path: String) async throws {
        var request = URLRequest(url: url(path))
        request.httpMethod = "DELETE"
        _ = try await send(request)
    }

    private func url(_ path: String, query: [URLQueryItem] = []) -> URL {
        var c = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { c.queryItems = query }
        return c.url!
    }

    private func send(_ request: URLRequest) async throws -> Data {
        var request = request
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await Self.session.data(for: request)
        } catch let error as URLError {
            throw APIError(message: Self.describe(error))
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIError(message: "Răspuns necunoscut de la Mac.")
        }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 { throw APIError(message: "Tokenul nu se potrivește. Împerechează din nou telefonul.") }
            let message = (try? JSONDecoder().decode(ErrorResponse.self, from: data))?.error
            throw APIError(message: message ?? "Eroare \(http.statusCode) de la Mac.")
        }
        return data
    }

    private func decode<T: Decodable>(_ data: Data) throws -> T {
        do {
            return try JSONDecoder.agent.decode(T.self, from: data)
        } catch {
            throw APIError(message: "Nu înțeleg răspunsul agentului (\(error.localizedDescription)). Actualizează agentul.")
        }
    }

    private static func describe(_ error: URLError) -> String {
        switch error.code {
        case .timedOut:
            return "Mac-ul nu răspunde. E pornit, treaz și conectat la Tailscale?"
        case .cannotConnectToHost, .cannotFindHost, .networkConnectionLost, .notConnectedToInternet:
            return "Nu ajung la Mac. Verifică Tailscale pe ambele dispozitive și că agentul rulează."
        case .appTransportSecurityRequiresSecureConnection:
            return "Conexiunea a fost blocată de iOS (ATS)."
        default:
            return error.localizedDescription
        }
    }
}
