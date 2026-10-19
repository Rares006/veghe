import SwiftUI

/// Prima filă: cum stă Mac-ul și ce face fiecare sesiune Claude.
struct StatusView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        NavigationStack {
            Screen {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        ScreenHeader(title: "Laptop", subtitle: model.status?.system.host) {
                            HStack(spacing: 8) {
                                StatusDot(color: model.isOnline ? Theme.green : Theme.gray, pulsing: model.isOnline)
                                Text(model.isOnline ? "Online" : "Offline")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(model.isOnline ? Theme.text : Theme.muted)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(Color.white.opacity(0.03), in: RoundedRectangle(cornerRadius: 12))
                        }

                        if let error = model.error { ErrorBanner(message: error) }

                        if let status = model.status {
                            MacPanel(status: status)
                            QueuePanel(queue: status.queue)
                            sessionsPanel(status.sessions)
                        } else if model.error == nil {
                            Panel {
                                HStack(spacing: 12) {
                                    ProgressView().tint(Theme.green)
                                    Text("Mă conectez la Mac…").foregroundStyle(Theme.muted)
                                }
                                .frame(maxWidth: .infinity)
                            }
                        }
                    }
                    .padding(16)
                }
                .refreshable { await model.refresh() }
            }
            .hiddenNavigationBar()
            .navigationDestination(for: SessionSummary.self) { SessionDetailView(session: $0) }
        }
    }

    private func sessionsPanel(_ sessions: [SessionSummary]) -> some View {
        let active = sessions.filter { $0.state != .idle }.count
        return Panel(title: "Sesiuni Claude",
                     trailing: AnyView(Badge(text: active > 0 ? "\(active) active" : "toate libere",
                                             color: active > 0 ? Theme.green : Theme.gray))) {
            if sessions.isEmpty {
                Text("Nicio sesiune în ultimele 3 zile.").foregroundStyle(Theme.muted).font(.system(size: 14))
            }
            VStack(spacing: 0) {
                ForEach(Array(sessions.enumerated()), id: \.element.id) { index, session in
                    NavigationLink(value: session) { SessionRow(session: session) }
                        .buttonStyle(.plain)
                    if index < sessions.count - 1 {
                        Rectangle().fill(Theme.border).frame(height: 1).padding(.vertical, 2)
                    }
                }
            }
        }
    }
}

private struct MacPanel: View {
    let status: StatusResponse

    var body: some View {
        Panel(title: "Mac") {
            VStack(spacing: 10) {
                if let b = status.system.battery, let pct = b.percent {
                    HStack {
                        Text("Baterie").foregroundStyle(Theme.muted)
                        Spacer()
                        BatteryBar(percent: pct, onAC: b.onAC)
                    }
                    .font(.system(size: 14))
                }
                if let app = status.system.frontApp, !app.isEmpty {
                    InfoRow(label: "În față", value: app)
                }
                if let idle = status.system.userIdleSeconds {
                    InfoRow(label: "Ultima atingere", value: idle < 60 ? "chiar acum" : "acum \(formatDuration(seconds: idle))")
                }
                if !status.agent.claudeFound {
                    Label("Agentul nu găsește programul claude: task-urile nu pot porni.", systemImage: "exclamationmark.triangle.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.amber)
                }
            }
        }
    }
}

private struct BatteryBar: View {
    let percent: Int
    let onAC: Bool

    var body: some View {
        HStack(spacing: 8) {
            if onAC { Image(systemName: "bolt.fill").foregroundStyle(Theme.green).font(.system(size: 11)) }
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.08))
                Capsule()
                    .fill(percent < 20 && !onAC ? AnyShapeStyle(Theme.red) : AnyShapeStyle(Theme.primaryGradient))
                    .frame(width: 70 * CGFloat(max(4, percent)) / 100)
            }
            .frame(width: 70, height: 8)
            Text("\(percent)%")
                .font(.system(size: 14, weight: .semibold).monospacedDigit())
                .foregroundStyle(Theme.text)
        }
    }
}

private struct QueuePanel: View {
    let queue: QueueInfo

    var body: some View {
        Panel(title: "Coada de task-uri",
              trailing: AnyView(Badge(text: queue.isIdle ? "liber" : "ocupat",
                                      color: queue.isIdle ? Theme.green : Theme.amber))) {
            HStack(spacing: 10) {
                counter(queue.running, "rulează", queue.running > 0 ? Theme.green : Theme.gray)
                counter(queue.queued, "așteaptă", queue.queued > 0 ? Theme.amber : Theme.gray)
            }
            Text(explanation)
                .font(.system(size: 13))
                .foregroundStyle(Theme.muted)
        }
    }

    private func counter(_ n: Int, _ label: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(n)")
                .font(.system(size: 26, weight: .bold).monospacedDigit())
                .foregroundStyle(color)
            Text(label)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.muted)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.03), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border))
    }

    private var explanation: String {
        let idle = Int(queue.idleMinutes)
        if queue.isIdle {
            return "Nicio sesiune n-a lucrat în ultimele \(idle) min: un task nou pornește imediat."
        }
        let since = queue.minutesSinceActivity.map { $0 < 1 ? "chiar acum" : "acum \(Int($0)) min" } ?? "recent"
        return "Ultima activitate: \(since). Task-urile pornesc după \(idle) min fără activitate."
    }
}

struct SessionRow: View {
    let session: SessionSummary

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            StatusDot(color: session.state.color, pulsing: session.state == .working)
                .padding(.top, 6)
            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .firstTextBaseline) {
                    Text(session.title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.title)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 8)
                    Badge(text: session.stateLabel, color: session.state.color)
                }
                HStack(spacing: 6) {
                    if session.isTask { Image(systemName: "iphone").foregroundStyle(Theme.green) }
                    Text(session.project)
                    Text("·")
                    Text(session.lastActivity, format: .relative(presentation: .named))
                }
                .font(.system(size: 12))
                .foregroundStyle(Theme.faint)
                if !session.lastTool.isEmpty && session.state != .idle {
                    Text(session.lastTool)
                        .font(.system(size: 12, design: .monospaced))
                        .lineLimit(1)
                        .foregroundStyle(session.state.color)
                }
                if !session.lastText.isEmpty {
                    Text(session.lastText)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
            }
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.faint)
                .padding(.top, 6)
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }
}
