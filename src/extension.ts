import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';

let diagnosticCollection: vscode.DiagnosticCollection;
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
const issueStore: Map<string, GixyIssue[]> = new Map();

// For debounced analysis on edit
const debounceTimers: Map<string, NodeJS.Timeout> = new Map();
const pendingProcesses: Map<string, cp.ChildProcess> = new Map();
const contentHashes: Map<string, string> = new Map();
const tempFiles: Map<string, string> = new Map();

// For auto-setup
let cachedGixyPath: string | null = null;
let setupInProgress = false;
let extensionContext: vscode.ExtensionContext | null = null;

// ============================================================================
// Auto-Setup: Private venv with gixy-ng
// ============================================================================

function getGixyVenvDir(): string {
    // Use VSCode's extension global storage (proper location for extension data)
    // This path is managed by VSCode and cleaned up on uninstall
    if (extensionContext?.globalStorageUri) {
        return extensionContext.globalStorageUri.fsPath;
    }
    // Fallback for edge cases (shouldn't happen in normal use)
    const homeDir = os.homedir();
    return path.join(homeDir, '.vscode-gixy');
}

function getVenvGixyPath(): string {
    const venvDir = getGixyVenvDir();
    const isWindows = process.platform === 'win32';
    const binDir = isWindows ? 'Scripts' : 'bin';
    const gixyBin = isWindows ? 'gixy.exe' : 'gixy';
    return path.join(venvDir, 'venv', binDir, gixyBin);
}

function getVenvPipPath(): string {
    const venvDir = getGixyVenvDir();
    const isWindows = process.platform === 'win32';
    const binDir = isWindows ? 'Scripts' : 'bin';
    const pipBin = isWindows ? 'pip.exe' : 'pip';
    return path.join(venvDir, 'venv', binDir, pipBin);
}

async function findPython3(): Promise<string | null> {
    const candidates =
        process.platform === 'win32' ? ['python', 'python3', 'py -3'] : ['python3', 'python'];

    for (const cmd of candidates) {
        try {
            const result = await execAsync(`${cmd} --version`);
            if (result.stdout.includes('Python 3')) {
                // Return the actual command that works
                return cmd.split(' ')[0]; // 'py' from 'py -3'
            }
        } catch {
            // Try next
        }
    }
    return null;
}

function execAsync(
    command: string,
    options?: cp.ExecOptions
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        cp.exec(command, { ...options, timeout: 120000 }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
            }
        });
    });
}

async function isGixyInstalled(gixyPath: string): Promise<boolean> {
    try {
        await execAsync(`"${gixyPath}" --version`);
        return true;
    } catch {
        return false;
    }
}

async function resolveGixyPath(): Promise<string | null> {
    // 1. Check user-configured path
    const configuredPath = getConfig<string>('executable');
    if (configuredPath && configuredPath !== 'gixy') {
        if (await isGixyInstalled(configuredPath)) {
            return configuredPath;
        }
    }

    // 2. Check cached path
    if (cachedGixyPath && (await isGixyInstalled(cachedGixyPath))) {
        return cachedGixyPath;
    }

    // 3. Check private venv
    const venvGixy = getVenvGixyPath();
    if (fs.existsSync(venvGixy) && (await isGixyInstalled(venvGixy))) {
        cachedGixyPath = venvGixy;
        return venvGixy;
    }

    // 4. Check system PATH
    try {
        await execAsync('gixy --version');
        cachedGixyPath = 'gixy';
        return 'gixy';
    } catch {
        // Not in PATH
    }

    return null;
}

async function setupGixyVenv(
    progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<boolean> {
    const venvDir = getGixyVenvDir();
    const venvPath = path.join(venvDir, 'venv');

    outputChannel.appendLine('🔧 Setting up Gixy...');

    // Find Python 3
    progress.report({ message: 'Finding Python 3...', increment: 10 });
    const python = await findPython3();
    if (!python) {
        outputChannel.appendLine('❌ Python 3 not found. Please install Python 3.8+ first.');
        vscode.window
            .showErrorMessage(
                'Python 3 not found. Please install Python 3.8+ and try again.',
                'Download Python'
            )
            .then((selection) => {
                if (selection === 'Download Python') {
                    vscode.env.openExternal(vscode.Uri.parse('https://www.python.org/downloads/'));
                }
            });
        return false;
    }
    outputChannel.appendLine(`   Found Python: ${python}`);

    // Create directory
    progress.report({ message: 'Creating directory...', increment: 10 });
    if (!fs.existsSync(venvDir)) {
        fs.mkdirSync(venvDir, { recursive: true });
    }

    // Create venv
    progress.report({ message: 'Creating virtual environment...', increment: 20 });
    try {
        const venvCmd =
            process.platform === 'win32' && python === 'py'
                ? `py -3 -m venv "${venvPath}"`
                : `"${python}" -m venv "${venvPath}"`;
        outputChannel.appendLine(`   Running: ${venvCmd}`);
        await execAsync(venvCmd);
    } catch (err) {
        outputChannel.appendLine(`❌ Failed to create venv: ${err}`);
        return false;
    }

    // Install gixy-ng
    progress.report({ message: 'Installing gixy-ng (this may take a minute)...', increment: 30 });
    const pipPath = getVenvPipPath();
    try {
        outputChannel.appendLine(`   Running: "${pipPath}" install gixy-ng`);
        const result = await execAsync(`"${pipPath}" install gixy-ng`);
        outputChannel.appendLine(result.stdout);
        if (result.stderr) {
            outputChannel.appendLine(result.stderr);
        }
    } catch (err) {
        outputChannel.appendLine(`❌ Failed to install gixy-ng: ${err}`);
        return false;
    }

    // Verify installation
    progress.report({ message: 'Verifying installation...', increment: 20 });
    const gixyPath = getVenvGixyPath();
    if (await isGixyInstalled(gixyPath)) {
        cachedGixyPath = gixyPath;
        outputChannel.appendLine(`✅ Gixy installed successfully at: ${gixyPath}`);
        return true;
    } else {
        outputChannel.appendLine('❌ Installation verification failed');
        return false;
    }
}

async function ensureGixyAvailable(): Promise<string | null> {
    // Try to resolve existing gixy
    const gixyPath = await resolveGixyPath();
    if (gixyPath) {
        return gixyPath;
    }

    // Gixy not found - check if auto-install is enabled
    if (setupInProgress) {
        return null; // Already setting up
    }

    const autoInstall = getConfig<boolean>('autoInstall');

    if (autoInstall === false) {
        // User explicitly disabled auto-install
        return null;
    }

    // Prompt for installation
    const choice = await vscode.window.showWarningMessage(
        'Gixy is not installed. Would you like to install it automatically?',
        'Install Gixy',
        'Install Manually',
        'Never Ask Again'
    );

    if (choice === 'Install Gixy') {
        setupInProgress = true;

        const success = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Installing Gixy',
                cancellable: false,
            },
            async (progress) => {
                return await setupGixyVenv(progress);
            }
        );

        setupInProgress = false;

        if (success) {
            vscode.window.showInformationMessage('Gixy installed successfully! Analyzing...');
            return await resolveGixyPath();
        } else {
            vscode.window.showErrorMessage('Failed to install Gixy. Check the output for details.');
            outputChannel.show();
            return null;
        }
    } else if (choice === 'Install Manually') {
        vscode.env.openExternal(vscode.Uri.parse('https://gixy.getpagespeed.com/'));
        return null;
    } else if (choice === 'Never Ask Again') {
        await vscode.workspace.getConfiguration('gixy').update('autoInstall', false, true);
        return null;
    }

    return null;
}

// Severity icons and colors for a polished look
const SEVERITY_CONFIG = {
    HIGH: {
        icon: '🔴',
        label: 'Critical',
        diagnostic: vscode.DiagnosticSeverity.Error,
        priority: 1,
    },
    MEDIUM: {
        icon: '🟠',
        label: 'Warning',
        diagnostic: vscode.DiagnosticSeverity.Warning,
        priority: 2,
    },
    LOW: {
        icon: '🟡',
        label: 'Info',
        diagnostic: vscode.DiagnosticSeverity.Information,
        priority: 3,
    },
    UNSPECIFIED: {
        icon: '🔵',
        label: 'Hint',
        diagnostic: vscode.DiagnosticSeverity.Hint,
        priority: 4,
    },
};

interface GixyFix {
    title: string;
    search: string;
    replace: string;
    description?: string;
}

interface GixyIssue {
    plugin: string;
    summary: string;
    severity: keyof typeof SEVERITY_CONFIG;
    description: string;
    reason: string;
    config: string;
    path: string;
    reference: string;
    line?: number;
    file?: string;
    fixes?: GixyFix[]; // Quick fixes from gixy
}

type GixyResult = GixyIssue[];

export function activate(context: vscode.ExtensionContext) {
    // Store context for global storage access
    extensionContext = context;

    outputChannel = vscode.window.createOutputChannel('Gixy', { log: true });
    diagnosticCollection = vscode.languages.createDiagnosticCollection('gixy');

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'gixy.showOutput';
    updateStatusBar('idle');
    statusBarItem.show();

    context.subscriptions.push(diagnosticCollection);
    context.subscriptions.push(outputChannel);
    context.subscriptions.push(statusBarItem);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('gixy.analyzeFile', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                analyzeFile(editor.document);
            }
        }),
        vscode.commands.registerCommand('gixy.analyzeWorkspace', analyzeWorkspace),
        vscode.commands.registerCommand('gixy.showOutput', () => {
            outputChannel.show();
        }),
        vscode.commands.registerCommand('gixy.openDocs', (url: string) => {
            vscode.env.openExternal(vscode.Uri.parse(url));
        }),
        vscode.commands.registerCommand('gixy.clearDiagnostics', () => {
            diagnosticCollection.clear();
            issueStore.clear();
            updateStatusBar('idle');
            vscode.window.showInformationMessage('Gixy: Diagnostics cleared');
        }),
        vscode.commands.registerCommand('gixy.installGixy', async () => {
            // Force reinstall
            cachedGixyPath = null;
            setupInProgress = true;

            const success = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Installing Gixy',
                    cancellable: false,
                },
                async (progress) => {
                    return await setupGixyVenv(progress);
                }
            );

            setupInProgress = false;

            if (success) {
                vscode.window.showInformationMessage('Gixy installed successfully!');
            } else {
                vscode.window.showErrorMessage(
                    'Failed to install Gixy. Check the output for details.'
                );
                outputChannel.show();
            }
        })
    );

    // Register Code Action provider for quick fixes and "Learn More"
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            [{ language: 'nginx' }, { pattern: '**/*.conf' }, { pattern: '**/nginx.conf' }],
            new GixyCodeActionProvider(),
            { providedCodeActionKinds: GixyCodeActionProvider.providedCodeActionKinds }
        )
    );

    // Register Hover provider for rich issue details
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            [{ language: 'nginx' }, { pattern: '**/*.conf' }, { pattern: '**/nginx.conf' }],
            new GixyHoverProvider()
        )
    );

    // Auto-analyze on open
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((doc) => {
            if (isNginxFile(doc) && getConfig('analyzeOnOpen')) {
                analyzeFile(doc);
            }
        })
    );

    // Auto-analyze on save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((doc) => {
            if (isNginxFile(doc) && getConfig('analyzeOnSave')) {
                analyzeFile(doc);
            }
        })
    );

    // Auto-analyze on edit (debounced, uses temp file)
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            const doc = event.document;
            if (isNginxFile(doc) && getConfig<boolean>('analyzeOnType')) {
                scheduleAnalysis(doc);
            }
        })
    );

    // Clear diagnostics and cleanup when file is closed
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((doc) => {
            const uriStr = doc.uri.toString();

            // Cancel any pending analysis
            cancelPendingAnalysis(uriStr);

            // Clean up temp file
            const tempFile = tempFiles.get(uriStr);
            if (tempFile) {
                try {
                    fs.unlinkSync(tempFile);
                } catch {
                    /* ignore */
                }
                tempFiles.delete(uriStr);
            }

            // Clear state
            diagnosticCollection.delete(doc.uri);
            issueStore.delete(uriStr);
            contentHashes.delete(uriStr);
            updateStatusBarFromAllDiagnostics();
        })
    );

    // Analyze already open nginx files
    vscode.workspace.textDocuments.forEach((doc) => {
        if (isNginxFile(doc) && getConfig('analyzeOnOpen')) {
            analyzeFile(doc);
        }
    });

    outputChannel.appendLine('✨ Gixy extension activated');
    outputChannel.appendLine(`   Documentation: https://gixy.getpagespeed.com/`);
}

function updateStatusBar(state: 'idle' | 'analyzing' | 'success' | 'issues', issueCount?: number) {
    switch (state) {
        case 'idle':
            statusBarItem.text = '$(shield) Gixy';
            statusBarItem.tooltip = 'NGINX Security Analyzer - Click to show output';
            statusBarItem.backgroundColor = undefined;
            break;
        case 'analyzing':
            statusBarItem.text = '$(loading~spin) Gixy: Analyzing...';
            statusBarItem.tooltip = 'Analyzing NGINX configuration...';
            statusBarItem.backgroundColor = undefined;
            break;
        case 'success':
            statusBarItem.text = '$(shield-check) Gixy: Secure';
            statusBarItem.tooltip = 'No security issues found';
            statusBarItem.backgroundColor = undefined;
            break;
        case 'issues':
            const count = issueCount ?? 0;
            statusBarItem.text = `$(shield-x) Gixy: ${count} issue${count !== 1 ? 's' : ''}`;
            statusBarItem.tooltip = `Found ${count} security issue${count !== 1 ? 's' : ''} - Click for details`;
            statusBarItem.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.warningBackground'
            );
            break;
    }
}

function updateStatusBarFromAllDiagnostics() {
    let totalIssues = 0;
    diagnosticCollection.forEach((uri, diagnostics) => {
        totalIssues += diagnostics.length;
    });

    if (totalIssues > 0) {
        updateStatusBar('issues', totalIssues);
    } else {
        updateStatusBar('idle');
    }
}

function getConfig<T>(key: string): T {
    return vscode.workspace.getConfiguration('gixy').get(key) as T;
}

function isNginxFile(doc: vscode.TextDocument): boolean {
    if (doc.languageId === 'nginx' || doc.languageId === 'NGINX') {
        return true;
    }

    const fileName = path.basename(doc.fileName);
    const ext = path.extname(doc.fileName);
    const filePath = doc.fileName;

    if (fileName === 'nginx.conf' || ext === '.nginx') {
        return true;
    }

    const nginxPaths = [
        '/nginx/',
        '/sites-available/',
        '/sites-enabled/',
        '/conf.d/',
        '/snippets/',
    ];
    if (nginxPaths.some((p) => filePath.includes(p))) {
        return true;
    }

    if (ext === '.conf' || fileName.includes('nginx')) {
        return looksLikeNginxConfig(doc.getText());
    }

    return false;
}

function looksLikeNginxConfig(content: string): boolean {
    const nginxPatterns = [
        /^\s*(server|http|events|stream|upstream)\s*\{/m,
        /^\s*location\s+[~^=@/]/m,
        /^\s*(listen|server_name|root|index|proxy_pass|fastcgi_pass)\s+/m,
        /^\s*(add_header|proxy_set_header|set|rewrite|return)\s+/m,
        /^\s*(worker_processes|worker_connections|include)\s+/m,
        /^\s*error_log\s+.*\s+(debug|info|notice|warn|error|crit)/m,
    ];

    let matches = 0;
    for (const pattern of nginxPatterns) {
        if (pattern.test(content)) {
            matches++;
            if (matches >= 2) {
                return true;
            }
        }
    }

    if (/^\s*server\s*\{[\s\S]*listen\s+\d+/m.test(content)) {
        return true;
    }

    return false;
}

async function analyzeFile(doc: vscode.TextDocument): Promise<void> {
    const filePath = doc.fileName;

    // Ensure gixy is available (auto-install if needed)
    const gixyPath = await ensureGixyAvailable();
    if (!gixyPath) {
        updateStatusBar('idle');
        return;
    }

    updateStatusBar('analyzing');
    outputChannel.appendLine(`\n🔍 Analyzing: ${filePath}`);

    const args = ['-f', 'json', filePath];

    cp.execFile(gixyPath, args, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (stderr) {
            outputChannel.appendLine(`⚠️  Gixy stderr: ${stderr}`);
        }

        try {
            const result: GixyResult = JSON.parse(stdout || '[]');
            const diagnostics = parseGixyOutput(result, doc);
            diagnosticCollection.set(doc.uri, diagnostics);

            // Store issues for hover/code actions
            issueStore.set(doc.uri.toString(), result);

            const issueCount = diagnostics.length;
            if (issueCount > 0) {
                outputChannel.appendLine(
                    `❌ Found ${issueCount} issue(s) in ${path.basename(filePath)}`
                );
                result.forEach((issue) => {
                    const config = SEVERITY_CONFIG[issue.severity] || SEVERITY_CONFIG.UNSPECIFIED;
                    outputChannel.appendLine(
                        `   ${config.icon} [${issue.plugin}] ${issue.summary}`
                    );
                });
            } else {
                outputChannel.appendLine(`✅ No issues found in ${path.basename(filePath)}`);
            }

            updateStatusBarFromAllDiagnostics();
        } catch (parseError) {
            outputChannel.appendLine(`❌ Parse error: ${parseError}`);
            outputChannel.appendLine(`   Stdout: ${stdout}`);
            updateStatusBar('idle');
        }
    });
}

// Cancel any pending analysis for a document
function cancelPendingAnalysis(uriStr: string): void {
    // Cancel debounce timer
    const timer = debounceTimers.get(uriStr);
    if (timer) {
        clearTimeout(timer);
        debounceTimers.delete(uriStr);
    }

    // Kill pending process
    const proc = pendingProcesses.get(uriStr);
    if (proc) {
        proc.kill();
        pendingProcesses.delete(uriStr);
    }
}

// Schedule debounced analysis (for on-type analysis)
function scheduleAnalysis(doc: vscode.TextDocument): void {
    const uriStr = doc.uri.toString();
    const debounceMs = getConfig<number>('analyzeDebounceMs') || 750;

    // Cancel any existing pending analysis
    cancelPendingAnalysis(uriStr);

    // Check if content actually changed (using hash)
    const content = doc.getText();
    const hash = crypto.createHash('md5').update(content).digest('hex');
    if (contentHashes.get(uriStr) === hash) {
        return; // Content unchanged, skip
    }

    // Schedule new analysis
    const timer = setTimeout(async () => {
        debounceTimers.delete(uriStr);
        await analyzeBuffer(doc, content, hash);
    }, debounceMs);

    debounceTimers.set(uriStr, timer);
}

// Analyze the in-memory buffer (writes to temp file)
async function analyzeBuffer(
    doc: vscode.TextDocument,
    content: string,
    hash: string
): Promise<void> {
    const uriStr = doc.uri.toString();

    // For on-type analysis, only use cached/quick path resolution (no install prompts)
    const gixyPath = await resolveGixyPath();
    if (!gixyPath) {
        // Gixy not available - silently skip for on-type
        // User will be prompted when they explicitly run analyzeFile
        return;
    }

    // Get or create temp file for this document
    let tempFile = tempFiles.get(uriStr);
    if (!tempFile) {
        const ext = path.extname(doc.fileName) || '.conf';
        const basename = path.basename(doc.fileName, ext);
        tempFile = path.join(os.tmpdir(), `gixy-${basename}-${Date.now()}${ext}`);
        tempFiles.set(uriStr, tempFile);
    }

    // Write current content to temp file
    try {
        fs.writeFileSync(tempFile, content, 'utf8');
    } catch (err) {
        outputChannel.appendLine(`❌ Failed to write temp file: ${err}`);
        return;
    }

    updateStatusBar('analyzing');

    const args = ['-f', 'json', tempFile];
    const proc = cp.execFile(
        gixyPath,
        args,
        { maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
            pendingProcesses.delete(uriStr);

            // Check if document was closed while analyzing
            if (!vscode.workspace.textDocuments.find((d) => d.uri.toString() === uriStr)) {
                return;
            }

            if (stderr && !error?.killed) {
                outputChannel.appendLine(`⚠️  Gixy stderr: ${stderr}`);
            }

            try {
                const result: GixyResult = JSON.parse(stdout || '[]');

                // Update content hash on successful analysis
                contentHashes.set(uriStr, hash);

                const diagnostics = parseGixyOutput(result, doc);
                diagnosticCollection.set(doc.uri, diagnostics);
                issueStore.set(uriStr, result);

                updateStatusBarFromAllDiagnostics();
            } catch (parseError) {
                if (!error?.killed) {
                    // Only log if not cancelled
                    outputChannel.appendLine(`❌ Parse error: ${parseError}`);
                    updateStatusBar('idle');
                }
            }
        }
    );

    pendingProcesses.set(uriStr, proc);
}

function getDocumentationUrl(plugin: string, providedReference?: string): string {
    // Use provided reference if it's a valid URL
    if (providedReference && providedReference.startsWith('https://')) {
        return providedReference;
    }

    // Map plugin names to documentation slugs
    const pluginDocMap: Record<string, string> = {
        ssrf: 'ssrf',
        http_splitting: 'httpsplitting',
        origins: 'origins',
        add_header_redefinition: 'addheaderredefinition',
        host_spoofing: 'hostspoofing',
        valid_referers: 'validreferers',
        add_header_multiline: 'addheadermultiline',
        alias_traversal: 'aliastraversal',
        if_is_evil: 'if_is_evil',
        allow_without_deny: 'allow_without_deny',
        add_header_content_type: 'add_header_content_type',
        resolver_external: 'resolver_external',
        proxy_pass_normalized: 'proxy_pass_normalized',
        version_disclosure: 'version_disclosure',
        return_bypasses_allow_deny: 'return_bypasses_allow_deny',
        default_server_flag: 'default_server_flag',
        error_log_off: 'error_log_off',
        hash_without_default: 'hash_without_default',
        unanchored_regex: 'unanchored_regex',
        regex_redos: 'regex_redos',
        invalid_regex: 'invalid_regex',
        try_files_is_evil_too: 'try_files_is_evil_too',
        worker_rlimit_nofile_vs_connections: 'worker_rlimit_nofile_vs_connections',
        low_keepalive_requests: 'low_keepalive_requests',
        missing_resolver: 'missing_resolver',
    };

    const slug = pluginDocMap[plugin] || plugin;
    return `https://gixy.getpagespeed.com/plugins/${slug}/`;
}

function parseGixyOutput(issues: GixyResult, doc: vscode.TextDocument): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];

    for (const issue of issues) {
        const range = findIssueRange(doc, issue);
        const config = SEVERITY_CONFIG[issue.severity] || SEVERITY_CONFIG.UNSPECIFIED;

        // Create rich diagnostic message
        let message = `${issue.summary}`;
        if (issue.reason) {
            message += `\n\n${issue.reason}`;
        }

        const diagnostic = new vscode.Diagnostic(range, message, config.diagnostic);
        diagnostic.source = 'gixy';

        // Add diagnostic code with link to documentation
        const docUrl = getDocumentationUrl(issue.plugin, issue.reference);
        diagnostic.code = {
            value: `${issue.plugin}`,
            target: vscode.Uri.parse(docUrl),
        };

        // Add related information if we have config snippet
        if (issue.config) {
            diagnostic.relatedInformation = [
                new vscode.DiagnosticRelatedInformation(
                    new vscode.Location(doc.uri, range),
                    `Config: ${issue.config.substring(0, 100)}${issue.config.length > 100 ? '...' : ''}`
                ),
            ];
        }

        // Add tags for deprecated patterns
        if (issue.plugin === 'add_header_multiline') {
            diagnostic.tags = [vscode.DiagnosticTag.Deprecated];
        }

        diagnostics.push(diagnostic);
    }

    // Sort by severity (HIGH first)
    diagnostics.sort((a, b) => {
        const severityOrder = { 0: 1, 1: 2, 2: 3, 3: 4 }; // Error, Warning, Info, Hint
        return (severityOrder[a.severity] || 4) - (severityOrder[b.severity] || 4);
    });

    return diagnostics;
}

function findIssueRange(doc: vscode.TextDocument, issue: GixyIssue): vscode.Range {
    // Use line number from gixy if available
    if (issue.line && issue.line > 0) {
        const lineIndex = Math.min(issue.line - 1, doc.lineCount - 1);
        const lineText = doc.lineAt(lineIndex);
        const trimmedStart = lineText.text.search(/\S/);
        const startChar = trimmedStart >= 0 ? trimmedStart : 0;
        return new vscode.Range(
            new vscode.Position(lineIndex, startChar),
            new vscode.Position(lineIndex, lineText.text.length)
        );
    }

    // Search for directive in document based on plugin type
    const text = doc.getText();
    const lines = text.split('\n');

    const patterns: Record<string, RegExp> = {
        ssrf: /proxy_pass\s+/i,
        http_splitting: /(add_header|rewrite|return|proxy_set_header|proxy_pass)\s+/i,
        host_spoofing: /proxy_set_header\s+Host/i,
        add_header_redefinition: /add_header\s+/i,
        add_header_multiline: /add_header\s+/i,
        add_header_content_type: /add_header\s+Content-Type/i,
        valid_referers: /valid_referers\s+/i,
        alias_traversal: /alias\s+/i,
        missing_resolver: /(proxy_pass|fastcgi_pass|uwsgi_pass|scgi_pass|grpc_pass)\s+/i,
        origins: /if\s*\(\s*\$http_(origin|referer)/i,
        if_is_evil: /if\s*\(/i,
        allow_without_deny: /allow\s+/i,
        resolver_external: /resolver\s+/i,
        proxy_pass_normalized: /proxy_pass\s+/i,
        version_disclosure: /server_tokens\s+/i,
        return_bypasses_allow_deny: /(return|allow|deny)\s+/i,
        default_server_flag: /listen\s+/i,
        error_log_off: /error_log\s+/i,
        hash_without_default: /(map|geo)\s+/i,
        unanchored_regex: /location\s+~/i,
        regex_redos: /(location|if|rewrite|server_name|map)\s+/i,
        invalid_regex: /rewrite\s+/i,
        try_files_is_evil_too: /try_files\s+/i,
        worker_rlimit_nofile_vs_connections: /worker_(connections|rlimit_nofile)\s+/i,
        low_keepalive_requests: /keepalive_requests\s+/i,
    };

    const pattern = patterns[issue.plugin];
    if (pattern) {
        for (let i = 0; i < lines.length; i++) {
            const match = pattern.exec(lines[i]);
            if (match) {
                return new vscode.Range(
                    new vscode.Position(i, match.index),
                    new vscode.Position(i, lines[i].length)
                );
            }
        }
    }

    // Default to first line
    return new vscode.Range(
        new vscode.Position(0, 0),
        new vscode.Position(0, lines[0]?.length || 0)
    );
}

async function analyzeWorkspace(): Promise<void> {
    const files = await vscode.workspace.findFiles(
        '**/{nginx.conf,*.nginx,sites-available/*,sites-enabled/*,conf.d/*.conf}',
        '**/node_modules/**'
    );

    if (files.length === 0) {
        vscode.window.showInformationMessage('No NGINX configuration files found in workspace');
        return;
    }

    outputChannel.appendLine(`\n📁 Analyzing ${files.length} file(s) in workspace...`);

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Gixy: Analyzing NGINX configs',
            cancellable: true,
        },
        async (progress, token) => {
            for (let i = 0; i < files.length; i++) {
                if (token.isCancellationRequested) {
                    outputChannel.appendLine('⏹️  Analysis cancelled');
                    break;
                }

                progress.report({
                    message: `${i + 1}/${files.length}: ${path.basename(files[i].fsPath)}`,
                    increment: 100 / files.length,
                });

                const doc = await vscode.workspace.openTextDocument(files[i]);
                await new Promise<void>((resolve) => {
                    analyzeFile(doc);
                    setTimeout(resolve, 100); // Small delay between files
                });
            }
        }
    );

    outputChannel.appendLine('📁 Workspace analysis complete');
}

// Code Action Provider for quick fixes and "Learn More" links
// Now uses fixes from gixy's JSON output for any IDE to use!
class GixyCodeActionProvider implements vscode.CodeActionProvider {
    static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix,
        vscode.CodeActionKind.Source,
    ];

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];
        const issues = issueStore.get(document.uri.toString()) || [];

        for (const diagnostic of context.diagnostics) {
            if (diagnostic.source !== 'gixy') {
                continue;
            }

            // Extract plugin name from diagnostic code
            // Code is either a string or { value: string, target: Uri }
            const codeValue = diagnostic.code;
            let plugin: string;
            if (typeof codeValue === 'object' && codeValue !== null && 'value' in codeValue) {
                plugin = String(codeValue.value);
            } else {
                plugin = String(codeValue || '');
            }

            // Find the matching issue from gixy's JSON output
            const issue =
                issues.find(
                    (i) => i.plugin === plugin && i.line === diagnostic.range.start.line + 1
                ) || issues.find((i) => i.plugin === plugin);

            // Add fixes from gixy's JSON output (preferred - works for any IDE!)
            if (issue?.fixes && issue.fixes.length > 0) {
                const lineText = document.lineAt(diagnostic.range.start.line).text;

                for (let i = 0; i < issue.fixes.length; i++) {
                    const gixyFix = issue.fixes[i];

                    // Check if the search pattern exists in the line
                    if (lineText.includes(gixyFix.search)) {
                        const fix = new vscode.CodeAction(
                            `🔧 ${gixyFix.title}`,
                            vscode.CodeActionKind.QuickFix
                        );
                        fix.edit = new vscode.WorkspaceEdit();
                        const newText = lineText.replace(gixyFix.search, gixyFix.replace);
                        fix.edit.replace(
                            document.uri,
                            document.lineAt(diagnostic.range.start.line).range,
                            newText
                        );
                        fix.diagnostics = [diagnostic];
                        fix.isPreferred = i === 0; // First fix is preferred

                        actions.push(fix);
                    }
                }
            }

            // "Learn More" action (always add)
            const learnMoreAction = new vscode.CodeAction(
                `📖 Learn more about ${plugin}`,
                vscode.CodeActionKind.QuickFix
            );

            // Get documentation URL from diagnostic code target or generate it
            let docUrl: string;
            if (typeof codeValue === 'object' && codeValue !== null && 'target' in codeValue) {
                docUrl = codeValue.target.toString();
            } else {
                docUrl = getDocumentationUrl(plugin);
            }

            learnMoreAction.command = {
                command: 'gixy.openDocs',
                title: 'Open Documentation',
                arguments: [docUrl],
            };
            learnMoreAction.diagnostics = [diagnostic];
            learnMoreAction.isPreferred = false;
            actions.push(learnMoreAction);
        }

        return actions;
    }
}

// Hover Provider for rich issue tooltips
class GixyHoverProvider implements vscode.HoverProvider {
    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.Hover | undefined {
        const diagnostics = vscode.languages.getDiagnostics(document.uri);
        const gixyDiagnostics = diagnostics.filter(
            (d) => d.source === 'gixy' && d.range.contains(position)
        );

        if (gixyDiagnostics.length === 0) {
            return undefined;
        }

        const issues = issueStore.get(document.uri.toString()) || [];
        const contents: vscode.MarkdownString[] = [];

        for (const diagnostic of gixyDiagnostics) {
            // Extract plugin name from diagnostic code
            const codeValue = diagnostic.code;
            let plugin: string;
            if (typeof codeValue === 'object' && codeValue !== null && 'value' in codeValue) {
                plugin = String(codeValue.value);
            } else {
                plugin = String(codeValue || '');
            }
            const issue = issues.find((i) => i.plugin === plugin);

            const md = new vscode.MarkdownString();
            md.isTrusted = true;
            md.supportHtml = true;

            const config =
                SEVERITY_CONFIG[issue?.severity || 'UNSPECIFIED'] || SEVERITY_CONFIG.UNSPECIFIED;

            // Header with severity badge
            md.appendMarkdown(
                `## ${config.icon} Gixy: ${issue?.summary || diagnostic.message.split('\n')[0]}\n\n`
            );

            // Severity badge
            md.appendMarkdown(`**Severity:** \`${config.label}\`\n\n`);

            // Description
            if (issue?.description) {
                md.appendMarkdown(`${issue.description}\n\n`);
            }

            // Reason (specific details)
            if (issue?.reason) {
                md.appendMarkdown(`---\n\n**Details:**\n\n${issue.reason}\n\n`);
            }

            // Config snippet
            if (issue?.config) {
                md.appendMarkdown(`---\n\n**Problematic configuration:**\n\n`);
                md.appendCodeblock(issue.config, 'nginx');
                md.appendMarkdown('\n');
            }

            // Show available fixes from gixy
            if (issue?.fixes && issue.fixes.length > 0) {
                md.appendMarkdown(`---\n\n**💡 Quick fixes available:**\n\n`);
                for (const fix of issue.fixes) {
                    md.appendMarkdown(`- **${fix.title}**`);
                    if (fix.description) {
                        md.appendMarkdown(`: ${fix.description}`);
                    }
                    md.appendMarkdown('\n');
                }
                md.appendMarkdown('\n*Click the lightbulb (💡) or press Ctrl+. to apply*\n');
            }

            // Documentation link
            const docUrl = getDocumentationUrl(plugin, issue?.reference);
            md.appendMarkdown(`---\n\n[📖 Read documentation](${docUrl})`);

            contents.push(md);
        }

        return new vscode.Hover(contents);
    }
}

export function deactivate() {
    // Cancel all pending analyses
    for (const uriStr of debounceTimers.keys()) {
        cancelPendingAnalysis(uriStr);
    }

    // Clean up all temp files
    for (const tempFile of tempFiles.values()) {
        try {
            fs.unlinkSync(tempFile);
        } catch {
            /* ignore */
        }
    }
    tempFiles.clear();

    // Clear all state
    diagnosticCollection?.dispose();
    outputChannel?.dispose();
    statusBarItem?.dispose();
    issueStore.clear();
    contentHashes.clear();
}
