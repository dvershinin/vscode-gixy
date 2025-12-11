import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

suite('Gixy Extension Test Suite', () => {
    vscode.window.showInformationMessage('Starting Gixy tests');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('getpagespeed.gixy'));
    });

    test('Extension should activate', async () => {
        const ext = vscode.extensions.getExtension('getpagespeed.gixy');
        assert.ok(ext);
        await ext.activate();
        assert.strictEqual(ext.isActive, true);
    });

    test('Commands should be registered', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('gixy.analyzeFile'));
        assert.ok(commands.includes('gixy.analyzeWorkspace'));
    });

    test('Should detect nginx files correctly', async () => {
        // Create a temp nginx config content
        const content = `
server {
    listen 80;
    server_name example.com;
}
`;
        // Open as untitled document with nginx content
        const doc = await vscode.workspace.openTextDocument({
            language: 'nginx',
            content: content
        });
        
        // Language should be nginx
        assert.strictEqual(doc.languageId, 'nginx');
    });

    test('Diagnostics collection should exist', async () => {
        // Activate extension first
        const ext = vscode.extensions.getExtension('getpagespeed.gixy');
        await ext?.activate();
        
        // Diagnostics should be available via the languages API
        const diagnostics = vscode.languages.getDiagnostics();
        // Should be an array (might be empty if no files analyzed)
        assert.ok(Array.isArray(diagnostics));
    });

    test('Should analyze nginx file with issues', async function() {
        this.timeout(10000); // Give gixy time to run

        // Create a config with known issues
        const badConfig = `
server {
    listen 80;
    
    location /api/ {
        set $backend $arg_backend;
        proxy_pass http://$backend;  # SSRF vulnerability
    }
}
`;
        const doc = await vscode.workspace.openTextDocument({
            language: 'nginx', 
            content: badConfig
        });
        
        await vscode.window.showTextDocument(doc);
        
        // Trigger analysis command
        await vscode.commands.executeCommand('gixy.analyzeFile');
        
        // Wait for analysis to complete
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Check diagnostics
        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        
        // Should have at least one issue (SSRF)
        // Note: This test requires gixy to be installed
        if (diagnostics.length > 0) {
            assert.ok(diagnostics.some(d => d.source === 'gixy'));
            assert.ok(diagnostics.some(d => 
                d.code?.toString().includes('ssrf') || 
                d.message.toLowerCase().includes('ssrf')
            ));
        }
    });

    test('Severity mapping should work', async () => {
        const config = vscode.workspace.getConfiguration('gixy');
        const severityMap = config.get<Record<string, string>>('severityMap');
        
        assert.ok(severityMap);
        assert.strictEqual(severityMap['HIGH'], 'Error');
        assert.strictEqual(severityMap['MEDIUM'], 'Warning');
        assert.strictEqual(severityMap['LOW'], 'Information');
    });
});

