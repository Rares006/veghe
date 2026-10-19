import Foundation
import SwiftUI

/// Starea aplicației: conexiunea, ultima stare primită de la Mac și task-urile.
/// Cât aplicația e deschisă, întreabă agentul la fiecare 3 secunde.
@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var connection: Connection?
    @Published private(set) var status: StatusResponse?
    @Published private(set) var tasks: [TaskItem] = []
    @Published private(set) var error: String?
    @Published private(set) var lastUpdate: Date?
    @Published var selectedTab: AppTab = .status

    private var pollTask: Task<Void, Never>?

    init() {
        connection = ConnectionStore.load()
        #if os(macOS)
        if connection == nil { connection = ConnectionStore.localAgent() }
        #endif
        #if DEBUG
        // Pentru testele din simulator, unde dialogul „Open in…” nu se poate apăsa:
        // SIMCTL_CHILD_CL_PAIR_URL=controllaptop://pair?… și SIMCTL_CHILD_CL_TAB=tasks
        let env = ProcessInfo.processInfo.environment
        if let raw = env["CL_PAIR_URL"], let url = URL(string: raw), let c = Connection(pairingURL: url) {
            ConnectionStore.save(c)
            connection = c
        }
        if let tab = env["CL_TAB"].flatMap(AppTab.init(rawValue:)) { selectedTab = tab }
        #endif
    }

    var client: APIClient? { connection.flatMap(APIClient.init) }

    var isOnline: Bool {
        guard let lastUpdate, error == nil else { return false }
        return Date().timeIntervalSince(lastUpdate) < 20
    }

    var workingCount: Int { status?.sessions.filter { $0.state == .working }.count ?? 0 }
    var waitingCount: Int { status?.sessions.filter { $0.state == .waiting || $0.state == .question }.count ?? 0 }

    // MARK: Conexiune

    /// Verifică întâi că agentul răspunde cu tokenul dat, abia apoi salvează.
    func connect(_ candidate: Connection) async throws {
        guard let client = APIClient(candidate) else {
            throw APIError(message: "Adresa nu e validă. Exemplu: http://100.101.102.103:8787")
        }
        let s: StatusResponse = try await client.get("api/status")
        ConnectionStore.save(candidate)
        connection = candidate
        apply(s)
        await refreshTasks()
        startPolling()
    }

    func disconnect() {
        stopPolling()
        ConnectionStore.clear()
        connection = nil
        status = nil
        tasks = []
        error = nil
        #if os(macOS)
        connection = ConnectionStore.localAgent()
        if connection != nil { startPolling() }
        #endif
    }

    func handle(url: URL) {
        guard let candidate = Connection(pairingURL: url) else { return }
        Task {
            do { try await connect(candidate) } catch { self.error = error.localizedDescription }
        }
    }

    // MARK: Actualizare

    func startPolling() {
        pollTask?.cancel()
        guard connection != nil else { return }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    func refresh() async {
        guard let client else { return }
        do {
            let s: StatusResponse = try await client.get("api/status")
            apply(s)
            await refreshTasks()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func refreshTasks() async {
        guard let client else { return }
        if let r: TasksResponse = try? await client.get("api/tasks") {
            tasks = r.tasks
        }
    }

    private func apply(_ s: StatusResponse) {
        status = s
        error = nil
        lastUpdate = Date()
    }

    // MARK: Task-uri

    func createTask(_ request: NewTaskRequest) async throws -> TaskItem {
        guard let client else { throw APIError(message: "Nu ești conectat.") }
        let task: TaskItem = try await client.post("api/tasks", body: request)
        await refreshTasks()
        return task
    }

    func task(_ id: String) async throws -> TaskItem {
        guard let client else { throw APIError(message: "Nu ești conectat.") }
        return try await client.get("api/tasks/\(id)")
    }

    func cancelTask(_ id: String) async throws {
        guard let client else { return }
        let _: TaskItem = try await client.post("api/tasks/\(id)/cancel")
        await refreshTasks()
    }

    func startTaskNow(_ id: String) async throws {
        guard let client else { return }
        let _: TaskItem = try await client.post("api/tasks/\(id)/start")
        await refreshTasks()
    }

    func deleteTask(_ id: String) async throws {
        guard let client else { return }
        try await client.delete("api/tasks/\(id)")
        tasks.removeAll { $0.id == id }
    }

    func projects() async -> [Project] {
        guard let client, let r: ProjectsResponse = try? await client.get("api/projects") else { return [] }
        return r.projects
    }

    func ollama() async -> OllamaResponse? {
        guard let client else { return nil }
        return try? await client.get("api/ollama")
    }
}

enum AppTab: String {
    case status, tasks, screen, cameras, settings
}

struct TasksResponse: Decodable {
    let tasks: [TaskItem]
}
