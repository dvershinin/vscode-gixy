import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';

let diagnosticCollection: vscode.DiagnosticCollection;
let outputChannel: vscode.OutputChannel;

interface GixyIssue {
    plugin: string;
    summary: string;
    severity: string;
    description: string;
    reason: string;
    config: string;
    path: string;
    reference: string;
    line?: number;  // Line number from gixy (1-based)
    file?: string;  // Original file path
}

// Gixy outputs an array of issues, each with a 'path' field
type GixyResult = GixyIssue[];

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('Gixy');
    diagnosticCollection = vscode.languages.createDiagnosticCollection('gixy');
    
    context.subscriptions.push(diagnosticCollection);
    context.subscriptions.push(outputChannel);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('gixy.analyzeFile', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                analyzeFile(editor.document);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gixy.analyzeWorkspace', analyzeWorkspace)
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

    // Clear diagnostics when file is closed
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((doc) => {
            diagnosticCollection.delete(doc.uri);
        })
    );

    // Analyze already open nginx files
    vscode.workspace.textDocuments.forEach((doc) => {
        if (isNginxFile(doc) && getConfig('analyzeOnOpen')) {
            analyzeFile(doc);
        }
    });

    outputChannel.appendLine('Gixy extension activated');
}

function getConfig<T>(key: string): T {
    return vscode.workspace.getConfiguration('gixy').get(key) as T;
}

function isNginxFile(doc: vscode.TextDocument): boolean {
    // Check language ID (set by nginx syntax extensions)
    if (doc.languageId === 'nginx' || doc.languageId === 'NGINX') {
        return true;
    }
    
    const fileName = path.basename(doc.fileName);
    const ext = path.extname(doc.fileName);
    const filePath = doc.fileName;
    
    // Definitely nginx by name
    if (fileName === 'nginx.conf' || ext === '.nginx') {
        return true;
    }
    
    // Definitely nginx by path
    const nginxPaths = ['/nginx/', '/sites-available/', '/sites-enabled/', '/conf.d/', '/snippets/'];
    if (nginxPaths.some(p => filePath.includes(p))) {
        return true;
    }
    
    // For generic .conf files, check content for nginx patterns
    if (ext === '.conf' || fileName.includes('nginx')) {
        return looksLikeNginxConfig(doc.getText());
    }
    
    return false;
}

function looksLikeNginxConfig(content: string): boolean {
    // Look for nginx-specific directives/patterns
    const nginxPatterns = [
        /^\s*(server|http|events|stream|upstream)\s*\{/m,
        /^\s*location\s+[~^=@\/]/m,
        /^\s*(listen|server_name|root|index|proxy_pass|fastcgi_pass)\s+/m,
        /^\s*(add_header|proxy_set_header|set|rewrite|return)\s+/m,
        /^\s*(worker_processes|worker_connections|include)\s+/m,
        /^\s*error_log\s+.*\s+(debug|info|notice|warn|error|crit)/m,
    ];
    
    // Need at least 2 matches to be confident it's nginx
    let matches = 0;
    for (const pattern of nginxPatterns) {
        if (pattern.test(content)) {
            matches++;
            if (matches >= 2) {
                return true;
            }
        }
    }
    
    // Single strong indicator is enough
    if (/^\s*server\s*\{[\s\S]*listen\s+\d+/m.test(content)) {
        return true;
    }
    
    return false;
}

function analyzeFile(doc: vscode.TextDocument): void {
    const filePath = doc.fileName;
    const gixyPath = getConfig<string>('executable') || 'gixy';
    
    outputChannel.appendLine(`Analyzing: ${filePath}`);
    
    // Run gixy with JSON output
    const args = ['-f', 'json', filePath];
    
    cp.execFile(gixyPath, args, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (stderr) {
            outputChannel.appendLine(`Gixy stderr: ${stderr}`);
        }
        
        // Gixy returns non-zero if issues found, so we parse stdout regardless
        try {
            const result: GixyResult = JSON.parse(stdout || '[]');
            const diagnostics = parseGixyOutput(result, doc);
            diagnosticCollection.set(doc.uri, diagnostics);
            
            const issueCount = diagnostics.length;
            if (issueCount > 0) {
                outputChannel.appendLine(`Found ${issueCount} issue(s) in ${filePath}`);
            } else {
                outputChannel.appendLine(`No issues found in ${filePath}`);
            }
        } catch (parseError) {
            // If parsing fails, gixy might not be installed
            if (error && error.message.includes('ENOENT')) {
                vscode.window.showErrorMessage(
                    'Gixy not found. Install with: pip install gixy-ng',
                    'Install Instructions'
                ).then((selection) => {
                    if (selection) {
                        vscode.env.openExternal(
                            vscode.Uri.parse('https://github.com/dvershinin/gixy#installation')
                        );
                    }
                });
            } else {
                outputChannel.appendLine(`Parse error: ${parseError}`);
                outputChannel.appendLine(`Stdout: ${stdout}`);
            }
        }
    });
}

function parseGixyOutput(issues: GixyResult, doc: vscode.TextDocument): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    const severityMap = getConfig<Record<string, string>>('severityMap') || {};
    
    for (const issue of issues) {
        // Try to find the line in the document that matches the config snippet
        const range = findIssueRange(doc, issue);
        
        // Map severity based on config
        let severity: vscode.DiagnosticSeverity;
        const mappedSeverity = severityMap[issue.severity];
        switch (mappedSeverity || issue.severity) {
            case 'Error':
            case 'HIGH':
                severity = vscode.DiagnosticSeverity.Error;
                break;
            case 'Warning':
            case 'MEDIUM':
                severity = vscode.DiagnosticSeverity.Warning;
                break;
            case 'Information':
            case 'LOW':
                severity = vscode.DiagnosticSeverity.Information;
                break;
            default:
                severity = vscode.DiagnosticSeverity.Hint;
        }
        
        // Build message with reason if available
        let message = `[${issue.plugin}] ${issue.summary}`;
        if (issue.reason) {
            message += `\n${issue.reason}`;
        }
        
        const diagnostic = new vscode.Diagnostic(range, message, severity);
        diagnostic.source = 'gixy';
        diagnostic.code = {
            value: issue.plugin,
            target: vscode.Uri.parse(issue.reference || `https://github.com/dvershinin/gixy/blob/master/docs/en/plugins/${issue.plugin}.md`)
        };
        
        diagnostics.push(diagnostic);
    }
    
    return diagnostics;
}

function findIssueRange(doc: vscode.TextDocument, issue: GixyIssue): vscode.Range {
    // Use line number from gixy if available (convert from 1-based to 0-based)
    if (issue.line && issue.line > 0) {
        const lineIndex = issue.line - 1;
        const lineText = doc.lineAt(Math.min(lineIndex, doc.lineCount - 1));
        const trimmedStart = lineText.text.search(/\S/);
        const startChar = trimmedStart >= 0 ? trimmedStart : 0;
        return new vscode.Range(
            new vscode.Position(lineIndex, startChar),
            new vscode.Position(lineIndex, lineText.text.length)
        );
    }
    
    // Fallback: search for directive in document
    const text = doc.getText();
    const lines = text.split('\n');
    
    // Plugin-specific patterns to find the problematic directive
    const patterns: Record<string, RegExp> = {
        'ssrf': /proxy_pass\s+/i,
        'http_splitting': /add_header\s+/i,
        'host_spoofing': /proxy_set_header\s+Host/i,
        'add_header_redefinition': /add_header\s+/i,
        'valid_referers': /valid_referers\s+/i,
        'alias_traversal': /alias\s+/i,
        'missing_resolver': /proxy_pass\s+/i,
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
    
    // Default: first line
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
    
    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Gixy: Analyzing NGINX configs',
        cancellable: false
    }, async (progress) => {
        for (let i = 0; i < files.length; i++) {
            progress.report({
                message: `${i + 1}/${files.length}: ${path.basename(files[i].fsPath)}`,
                increment: 100 / files.length
            });
            
            const doc = await vscode.workspace.openTextDocument(files[i]);
            analyzeFile(doc);
        }
    });
}

export function deactivate() {
    diagnosticCollection?.dispose();
    outputChannel?.dispose();
}


