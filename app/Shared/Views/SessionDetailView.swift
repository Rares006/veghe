import SwiftUI

/// Ce a făcut o sesiune în ultima vreme: cererile, răspunsurile și uneltele.
struct SessionDetailView: View {
    let session: SessionSummary
    @EnvironmentObject private var model: AppModel
    @State private var detail: SessionDetail?
    @State private var error: String?
    @State private var showingContinue = false

    private var state: SessionState { detail?.state ?? session.state }

    var body: some View {
        Screen {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Panel {
                            HStack(spacing: 10) {
                                StatusDot(color: state.color, pulsing: state == .working)
                                Text(detail?.stateLabel ?? session.stateLabel)
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Theme.text)
                                Spacer()
                                Badge(text: session.project, color: Theme.gray)
                            }
                            Text(session.title)
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundStyle(Theme.title)
                            Button {
                                showingContinue = true
                            } label: {
                                Label("Continuă ca task", systemImage: "arrowshape.turn.up.right.fill")
                            }
                            .buttonStyle(.cfSecondary)
                        }
                        if let error { ErrorBanner(message: error) }

                        Panel(title: "Ultimele mesaje") {
                            if let detail {
                                VStack(alignment: .leading, spacing: 14) {
                                    ForEach(detail.timeline) { item in
                                        TimelineRow(item: item).id(item.id)
                                    }
                                }
                            } else if error == nil {
                                ProgressView().tint(Theme.green).frame(maxWidth: .infinity)
                            }
                        }
                    }
                    .padding(16)
                }
                .onChange(of: detail?.timeline.count) { _ in
                    if let last = detail?.timeline.last { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        }
        .navigationTitle(session.title)
        .inlineTitle()
        .darkNavigationBar()
        .sheet(isPresented: $showingContinue) {
            NewTaskView(cwd: session.cwd, resumeSessionId: session.id, contextTitle: session.title)
        }
        .task(id: session.id) {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
    }

    private func load() async {
        guard let client = model.client else { return }
        do {
            detail = try await client.get("api/sessions/\(session.id)")
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct TimelineRow: View {
    let item: TimelineItem

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(color)
                .frame(width: 24, height: 24)
                .background(color.opacity(0.15), in: Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text(item.text)
                    .font(item.kind == "tool" ? .system(size: 12, design: .monospaced) : .system(size: 14))
                    .foregroundStyle(item.kind == "tool" ? Theme.muted : Theme.text)
                    .textSelection(.enabled)
                if let at = item.at {
                    Text(at.clock)
                        .font(.system(size: 11).monospacedDigit())
                        .foregroundStyle(Theme.faint)
                }
            }
        }
    }

    private var symbol: String {
        switch item.kind {
        case "prompt": return "person.fill"
        case "tool": return "wrench.fill"
        default: return "sparkles"
        }
    }

    private var color: Color {
        switch item.kind {
        case "prompt": return Theme.text
        case "tool": return Theme.gray
        default: return Theme.green
        }
    }
}
