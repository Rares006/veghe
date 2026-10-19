import SwiftUI

/// Formularul pentru un task nou (sau pentru continuarea unei conversații).
struct NewTaskView: View {
    var cwd: String = ""
    var resumeSessionId: String = ""
    var contextTitle: String = ""

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var prompt = ""
    @State private var folder = ""
    @State private var projects: [Project] = []
    @State private var mode: PermissionMode = .acceptEdits
    @State private var modelName = ""
    /// Ultimul motor ales rămâne implicit pentru task-urile următoare.
    @AppStorage("provider") private var provider = "claude"
    @State private var ollama: OllamaResponse?
    @State private var ollamaLoading = false
    @State private var ollamaModel = ""
    @State private var startNow = false
    @State private var sending = false
    @State private var error: String?
    @FocusState private var focus: Field?

    private enum Field { case prompt, folder }

    private let models: [(String, String)] = [("", "Implicit"), ("opus", "Opus"), ("sonnet", "Sonnet"), ("haiku", "Haiku")]
    private let providers: [(String, String)] = [("claude", "Claude"), ("ollama", "Ollama")]

    var body: some View {
        NavigationStack {
            Screen {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if !resumeSessionId.isEmpty {
                            Panel {
                                Label("Continuă: \(contextTitle)", systemImage: "arrowshape.turn.up.right.fill")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(Theme.green)
                                    .lineLimit(2)
                                Text("Claude pornește cu tot contextul conversației, într-o sesiune separată de aplicația Claude.")
                                    .font(.system(size: 13))
                                    .foregroundStyle(Theme.muted)
                            }
                        }

                        Panel(title: "Ce să facă") {
                            TextField("Ex.: rulează testele din proiect și repară ce pică", text: $prompt, axis: .vertical)
                                .lineLimit(4...12)
                                .focused($focus, equals: .prompt)
                                .cfField(focused: focus == .prompt)
                        }

                        Panel(title: "Unde") {
                            Menu {
                                ForEach(projects) { p in
                                    Button(p.name) { folder = p.path }
                                }
                            } label: {
                                HStack {
                                    Image(systemName: "folder.fill").foregroundStyle(Theme.green)
                                    Text(folder.isEmpty ? "Alege proiectul" : (folder as NSString).lastPathComponent)
                                        .foregroundStyle(Theme.text)
                                    Spacer()
                                    Image(systemName: "chevron.up.chevron.down").foregroundStyle(Theme.faint)
                                }
                                .cfField()
                            }
                            .menuStyle(.borderlessButton)
                            FieldLabel(text: "sau calea completă")
                            TextField("/Users/…", text: $folder)
                                .font(.system(size: 13, design: .monospaced))
                                .autocorrectionDisabled()
                                #if os(iOS)
                                .textInputAutocapitalization(.never)
                                #endif
                                .focused($focus, equals: .folder)
                                .cfField(focused: focus == .folder)
                        }

                        Panel(title: "Cum") {
                            FieldLabel(text: "permisiuni")
                            SegmentedChoice(options: PermissionMode.allCases.map { ($0, $0.title) }, selection: $mode)
                            Text(mode.explanation)
                                .font(.system(size: 13))
                                .foregroundStyle(mode == .bypassPermissions ? Theme.red : Theme.muted)
                            FieldLabel(text: "motor").padding(.top, 4)
                            SegmentedChoice(options: providers, selection: $provider)
                            FieldLabel(text: "model").padding(.top, 4)
                            if provider == "ollama" {
                                ollamaPicker
                            } else {
                                SegmentedChoice(options: models, selection: $modelName)
                            }
                            Toggle(isOn: $startNow) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Pornește acum").foregroundStyle(Theme.text)
                                    Text(startNow ? "Nu așteaptă celelalte sesiuni." : "Așteaptă până nu mai lucrează nicio sesiune Claude.")
                                        .font(.system(size: 12))
                                        .foregroundStyle(Theme.muted)
                                }
                            }
                            .tint(Theme.green)
                            .padding(.top, 4)
                        }

                        if let error { ErrorBanner(message: error) }

                        Button { send() } label: {
                            if sending {
                                ProgressView().tint(.white)
                            } else {
                                Label("Trimite task-ul", systemImage: "paperplane.fill")
                            }
                        }
                        .buttonStyle(.cfPrimary)
                        .disabled(sending || prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || folder.isEmpty
                                  || (provider == "ollama" && ollamaModel.isEmpty))
                    }
                    .padding(16)
                }
                #if os(iOS)
                .scrollDismissesKeyboard(.interactively)
                #endif
            }
            .navigationTitle(resumeSessionId.isEmpty ? "Task nou" : "Continuă")
            .inlineTitle()
            .darkNavigationBar()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Renunță") { dismiss() }.tint(Theme.muted)
                }
            }
            .task {
                projects = await model.projects()
                if folder.isEmpty { folder = cwd.isEmpty ? (projects.first?.path ?? "") : cwd }
            }
            .task(id: provider) {
                guard provider == "ollama", ollama == nil else { return }
                ollamaLoading = true
                ollama = await model.ollama()
                ollamaLoading = false
                if ollamaModel.isEmpty {
                    ollamaModel = ollama?.defaultModel.flatMap { $0.isEmpty ? nil : $0 } ?? ollama?.models.first?.name ?? ""
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 540, minHeight: 640)
        #endif
    }

    @ViewBuilder private var ollamaPicker: some View {
        if ollamaLoading {
            ProgressView().tint(Theme.green)
        } else if let ollama, !ollama.models.isEmpty {
            Menu {
                ForEach(ollama.models, id: \.self) { m in
                    Button(m.name + ((m.parameterSize ?? "").isEmpty ? "" : " · \(m.parameterSize!)")) { ollamaModel = m.name }
                }
            } label: {
                HStack {
                    Image(systemName: "cpu").foregroundStyle(Theme.green)
                    Text(ollamaModel.isEmpty ? "Alege modelul" : ollamaModel).foregroundStyle(Theme.text)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down").foregroundStyle(Theme.faint)
                }
                .cfField()
            }
            .menuStyle(.borderlessButton)
            Text("Rulează local pe Mac, gratuit, dar mai încet și mai puțin priceput decât Claude. Alege un model care știe unelte (ex. qwen2.5-coder, qwen3, llama3.1).")
                .font(.system(size: 13))
                .foregroundStyle(Theme.muted)
        } else {
            Text(ollama?.error ?? "Ollama nu are niciun model instalat. Pe Mac: ollama pull qwen2.5-coder:7b")
                .font(.system(size: 13))
                .foregroundStyle(Theme.amber)
        }
    }

    private func send() {
        sending = true
        error = nil
        let request = NewTaskRequest(
            prompt: prompt,
            cwd: folder,
            permissionMode: mode.rawValue,
            provider: provider,
            model: provider == "ollama" ? ollamaModel : modelName,
            resumeSessionId: resumeSessionId,
            startNow: startNow
        )
        Task {
            do {
                _ = try await model.createTask(request)
                dismiss()
            } catch {
                self.error = error.localizedDescription
                sending = false
            }
        }
    }
}
