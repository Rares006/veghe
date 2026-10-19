import Foundation

// Răspunsurile agentului de pe Mac (vezi agent/server.js).

struct StatusResponse: Decodable {
    let agent: AgentInfo
    let system: SystemInfo
    let sessions: [SessionSummary]
    let queue: QueueInfo
    let cameras: CameraBridgeStatus
}

struct AgentInfo: Decodable {
    let version: String
    let uptimeSeconds: Int
    let claudeFound: Bool
}

struct SystemInfo: Decodable {
    let host: String
    let battery: Battery?
    let frontApp: String?
    let userIdleSeconds: Int?
}

struct Battery: Decodable {
    let percent: Int?
    let onAC: Bool
    let charging: Bool
}

struct QueueInfo: Decodable {
    let running: Int
    let queued: Int
    let isIdle: Bool
    let minutesSinceActivity: Double?
    let idleMinutes: Double
}

struct CameraBridgeStatus: Decodable {
    /// Integrarea cu CamFlow e pornită în config.json (lipsește la agenții vechi).
    let enabled: Bool?
    let connected: Bool
    let pages: [BridgePage]
}

struct BridgePage: Decodable, Hashable {
    let title: String
    let cameras: Int
}

enum SessionState: String, Decodable {
    case working, waiting, question, idle

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = SessionState(rawValue: raw) ?? .idle
    }
}

struct SessionSummary: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let cwd: String
    let project: String
    let state: SessionState
    let stateLabel: String
    let lastActivity: Date
    let lastText: String
    let lastTool: String
    let lastPrompt: String
    let isTask: Bool
}

struct SessionDetail: Decodable {
    let id: String
    let title: String
    let cwd: String?
    let state: SessionState
    let stateLabel: String
    let lastActivity: Date
    let timeline: [TimelineItem]
}

struct TimelineItem: Decodable, Identifiable {
    let at: Date?
    let kind: String
    let text: String

    // Stabil între reîncărcări, ca lista să nu sară la fiecare 3 secunde.
    var id: String { "\(at?.timeIntervalSince1970 ?? 0)|\(kind)|\(text.hashValue)" }
}

enum TaskStatus: String, Decodable {
    case queued, running, done, failed, cancelled

    var label: String {
        switch self {
        case .queued: return "În coadă"
        case .running: return "Rulează"
        case .done: return "Gata"
        case .failed: return "Eșuat"
        case .cancelled: return "Oprit"
        }
    }

    var isActive: Bool { self == .queued || self == .running }
}

struct TaskItem: Decodable, Identifiable, Hashable {
    let id: String
    let prompt: String
    let cwd: String
    let permissionMode: String
    let provider: String?
    let model: String?
    let resumeSessionId: String?
    let status: TaskStatus
    let createdAt: Date
    let startedAt: Date?
    let endedAt: Date?
    let sessionId: String?
    let result: String?
    let error: String?
    let costUsd: Double?
    let events: [TaskEvent]?

    var projectName: String { (cwd as NSString).lastPathComponent }
}

struct TaskEvent: Decodable, Hashable {
    let at: Date
    let kind: String
    let text: String
}

struct NewTaskRequest: Encodable {
    var prompt: String
    var cwd: String
    var permissionMode: String
    var provider: String
    var model: String
    var resumeSessionId: String
    var startNow: Bool
}

/// Modelele locale din Ollama (GET /api/ollama).
struct OllamaResponse: Decodable {
    let url: String
    let running: Bool
    let defaultModel: String?
    let models: [OllamaModel]
    let error: String?
}

struct OllamaModel: Decodable, Hashable {
    let name: String
    let parameterSize: String?
}

struct ProjectsResponse: Decodable {
    let projects: [Project]
}

struct Project: Decodable, Hashable, Identifiable {
    let path: String
    let name: String
    var id: String { path }
}

struct CamerasResponse: Decodable {
    let at: Date?
    let cameras: [CameraFrame]
    let error: String?
}

struct CameraFrame: Decodable, Identifiable {
    let label: String
    let width: Int
    let height: Int
    let jpeg: String
    var id: String { label }

    var imageData: Data? { Data(base64Encoded: jpeg) }
}

struct PairingResponse: Decodable {
    let urls: [String]
    let port: Int
}

struct ErrorResponse: Decodable {
    let error: String
}

enum PermissionMode: String, CaseIterable, Identifiable {
    case plan, acceptEdits, auto, bypassPermissions
    var id: String { rawValue }

    var title: String {
        switch self {
        case .plan: return "Plan"
        case .acceptEdits: return "Editări"
        case .auto: return "Auto"
        case .bypassPermissions: return "Complet"
        }
    }

    var explanation: String {
        switch self {
        case .plan: return "Doar citește și propune un plan. Nu modifică nimic."
        case .acceptEdits: return "Modifică fișiere. Comenzile din terminal care ar cere aprobare sunt refuzate."
        case .auto: return "Claude decide singur ce e sigur să ruleze și oprește acțiunile riscante."
        case .bypassPermissions: return "Face orice, fără nicio întrebare. Folosește doar în proiecte pe care le poți reface."
        }
    }
}

extension JSONDecoder {
    // Agentul trimite date ISO 8601 cu milisecunde („2026-10-17T13:49:58.954Z”).
    static let agent: JSONDecoder = {
        let d = JSONDecoder()
        let withMs = ISO8601DateFormatter()
        withMs.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        d.dateDecodingStrategy = .custom { decoder in
            let s = try decoder.singleValueContainer().decode(String.self)
            if let date = withMs.date(from: s) ?? plain.date(from: s) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Dată invalidă: \(s)"))
        }
        return d
    }()
}
