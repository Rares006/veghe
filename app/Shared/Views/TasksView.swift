import SwiftUI

/// Task-urile trimise de pe telefon: cele din coadă, cele care rulează și istoricul.
struct TasksView: View {
    @EnvironmentObject private var model: AppModel
    @State private var showingNew = false

    var body: some View {
        NavigationStack {
            Screen {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        ScreenHeader(title: "Task-uri", subtitle: summary) {
                            IconButton(symbol: "plus") { showingNew = true }
                        }
                        if model.tasks.isEmpty {
                            Panel {
                                EmptyState(title: "Niciun task încă",
                                           symbol: "tray",
                                           message: "Apasă + și scrie ce să facă Claude pe laptop. Task-ul pornește când nu mai lucrează nimic altceva.")
                                Button { showingNew = true } label: {
                                    Label("Task nou", systemImage: "plus")
                                }
                                .buttonStyle(.cfPrimary)
                            }
                        }
                        ForEach(model.tasks) { task in
                            NavigationLink(value: task.id) { TaskRow(task: task) }
                                .buttonStyle(.plain)
                                .contextMenu {
                                    if !task.status.isActive {
                                        Button(role: .destructive) {
                                            Task { try? await model.deleteTask(task.id) }
                                        } label: { Label("Șterge", systemImage: "trash") }
                                    }
                                }
                        }
                    }
                    .padding(16)
                }
                .refreshable { await model.refreshTasks() }
            }
            .hiddenNavigationBar()
            .navigationDestination(for: String.self) { TaskDetailView(taskId: $0) }
            .sheet(isPresented: $showingNew) { NewTaskView() }
        }
    }

    private var summary: String? {
        let running = model.tasks.filter { $0.status == .running }.count
        let queued = model.tasks.filter { $0.status == .queued }.count
        if running == 0 && queued == 0 { return nil }
        return "\(running) rulează · \(queued) în coadă"
    }
}

private struct TaskRow: View {
    let task: TaskItem

    var body: some View {
        Panel(padding: 16) {
            HStack {
                Badge(text: task.status.label, symbol: task.status.symbol,
                      color: task.status.color, pulsing: task.status == .running)
                Spacer()
                Text(task.createdAt, format: .relative(presentation: .named))
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.faint)
            }
            Text(task.prompt)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Theme.title)
                .lineLimit(3)
                .multilineTextAlignment(.leading)
            HStack(spacing: 6) {
                Image(systemName: "folder.fill")
                Text(task.projectName)
                Spacer()
                Image(systemName: "chevron.right").fontWeight(.semibold)
            }
            .font(.system(size: 12))
            .foregroundStyle(Theme.faint)
        }
    }
}

/// Un task: progresul în timp real, rezultatul și butoanele.
struct TaskDetailView: View {
    let taskId: String
    @EnvironmentObject private var model: AppModel
    @State private var task: TaskItem?
    @State private var error: String?
    @State private var showingContinue = false
    @State private var confirmStop = false

    var body: some View {
        Screen {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if let task {
                            header(task)
                            if let result = task.result, !result.isEmpty, task.status == .done {
                                Panel(title: "Rezultat") {
                                    Text(result)
                                        .font(.system(size: 14))
                                        .foregroundStyle(Theme.text)
                                        .textSelection(.enabled)
                                }
                            }
                            if let err = task.error, !err.isEmpty {
                                Panel(title: "Eroare") {
                                    Text(err)
                                        .font(.system(size: 14))
                                        .foregroundStyle(Theme.red)
                                        .textSelection(.enabled)
                                    if err.contains("/login") {
                                        Text("Pe Mac, dă dublu-click pe scripts/login-claude.command și autentifică-te o dată.")
                                            .font(.system(size: 13))
                                            .foregroundStyle(Theme.muted)
                                    }
                                }
                            }
                            Panel(title: "Desfășurare") {
                                VStack(alignment: .leading, spacing: 12) {
                                    ForEach(Array((task.events ?? []).enumerated()), id: \.offset) { index, event in
                                        EventRow(event: event).id(index)
                                    }
                                }
                            }
                        } else if let error {
                            ErrorBanner(message: error)
                        } else {
                            ProgressView().tint(Theme.green).frame(maxWidth: .infinity).padding(40)
                        }
                    }
                    .padding(16)
                }
                .onChange(of: task?.events?.count) { count in
                    if let count, count > 0, task?.status == .running {
                        withAnimation { proxy.scrollTo(count - 1, anchor: .bottom) }
                    }
                }
            }
        }
        .navigationTitle("Task")
        .inlineTitle()
        .darkNavigationBar()
        .sheet(isPresented: $showingContinue) {
            if let task {
                NewTaskView(cwd: task.cwd, resumeSessionId: task.sessionId ?? "", contextTitle: task.prompt)
            }
        }
        .confirmationDialog("Oprești task-ul?", isPresented: $confirmStop, titleVisibility: .visible) {
            Button("Oprește", role: .destructive) { run { try await model.cancelTask(taskId) } }
        }
        .task(id: taskId) {
            while !Task.isCancelled {
                await load()
                let active = task?.status.isActive ?? true
                try? await Task.sleep(nanoseconds: active ? 2_000_000_000 : 10_000_000_000)
            }
        }
    }

    private func header(_ task: TaskItem) -> some View {
        Panel {
            HStack {
                Badge(text: task.status.label, symbol: task.status.symbol,
                      color: task.status.color, pulsing: task.status == .running)
                Spacer()
                if let cost = task.costUsd {
                    Text(cost, format: .currency(code: "USD").precision(.fractionLength(2...3)))
                        .font(.system(size: 13, weight: .semibold).monospacedDigit())
                        .foregroundStyle(Theme.muted)
                }
            }
            Text(task.prompt)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Theme.title)
                .textSelection(.enabled)
            VStack(spacing: 8) {
                InfoRow(label: "Folder", value: task.projectName)
                InfoRow(label: "Permisiuni", value: PermissionMode(rawValue: task.permissionMode)?.title ?? task.permissionMode)
                InfoRow(label: "Motor", value: (task.provider == "ollama" ? "Ollama" : "Claude") + ((task.model ?? "").isEmpty ? "" : " · \(task.model!)"))
            }
            if task.status == .queued {
                Text("Așteaptă ca nicio sesiune Claude să nu mai lucreze. Poți să-l pornești și acum.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.muted)
            }
            actions(task)
        }
    }

    @ViewBuilder
    private func actions(_ task: TaskItem) -> some View {
        VStack(spacing: 10) {
            if task.status == .queued {
                Button { run { try await model.startTaskNow(taskId) } } label: {
                    Label("Pornește acum", systemImage: "play.fill")
                }
                .buttonStyle(.cfPrimary)
            }
            if task.status.isActive {
                Button { confirmStop = true } label: {
                    Label(task.status == .running ? "Oprește" : "Scoate din coadă", systemImage: "stop.fill")
                }
                .buttonStyle(.cfDanger)
            }
            if !task.status.isActive, let sid = task.sessionId, !sid.isEmpty {
                Button { showingContinue = true } label: {
                    Label("Continuă conversația", systemImage: "arrowshape.turn.up.right.fill")
                }
                .buttonStyle(.cfSecondary)
            }
        }
    }

    private func load() async {
        do {
            task = try await model.task(taskId)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func run(_ action: @escaping () async throws -> Void) {
        Task {
            do { try await action(); await load() } catch { self.error = error.localizedDescription }
        }
    }
}

private struct EventRow: View {
    let event: TaskEvent

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: event.kind == "tool" ? "wrench.fill" : event.kind == "info" ? "info" : "sparkles")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(event.kind == "text" ? Theme.green : Theme.gray)
                .frame(width: 22, height: 22)
                .background((event.kind == "text" ? Theme.green : Theme.gray).opacity(0.15), in: Circle())
            Text(event.text)
                .font(event.kind == "tool" ? .system(size: 12, design: .monospaced) : .system(size: 14))
                .foregroundStyle(event.kind == "text" ? Theme.text : Theme.muted)
                .textSelection(.enabled)
        }
    }
}
