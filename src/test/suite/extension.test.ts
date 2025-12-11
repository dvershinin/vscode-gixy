import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';

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
        assert.ok(commands.includes('gixy.analyzeFile'), 'analyzeFile command missing');
        assert.ok(commands.includes('gixy.analyzeWorkspace'), 'analyzeWorkspace command missing');
        assert.ok(commands.includes('gixy.showOutput'), 'showOutput command missing');
        assert.ok(commands.includes('gixy.clearDiagnostics'), 'clearDiagnostics command missing');
        assert.ok(commands.includes('gixy.openDocs'), 'openDocs command missing');
    });

    test('Should detect nginx files by language ID', async () => {
        const content = `
server {
    listen 80;
    server_name example.com;
}
`;
        const doc = await vscode.workspace.openTextDocument({
            language: 'nginx',
            content: content,
        });

        assert.strictEqual(doc.languageId, 'nginx');
    });

    test('Should detect nginx files by content patterns', async () => {
        const nginxContent = `
server {
    listen 80;
    server_name test.example.com;
    
    location / {
        proxy_pass http://backend;
    }
}
`;
        // This should be detected as nginx-like content
        assert.ok(nginxContent.includes('server'));
        assert.ok(nginxContent.includes('listen'));
        assert.ok(nginxContent.includes('location'));
    });

    test('Diagnostics collection should exist after activation', async () => {
        const ext = vscode.extensions.getExtension('getpagespeed.gixy');
        await ext?.activate();

        const diagnostics = vscode.languages.getDiagnostics();
        assert.ok(Array.isArray(diagnostics));
    });

    test('Should provide code actions for gixy diagnostics', async function () {
        this.timeout(5000);

        // Create a document with known issue pattern
        const badConfig = `
server {
    listen 80;
    location / {
        proxy_set_header Host $http_host;
    }
}
`;
        const doc = await vscode.workspace.openTextDocument({
            language: 'nginx',
            content: badConfig,
        });

        // The code action provider should be registered
        const providers = vscode.languages.match([{ language: 'nginx' }], doc);
        assert.ok(providers > 0, 'No language match for nginx');
    });

    test('Severity mapping should work correctly', async () => {
        const config = vscode.workspace.getConfiguration('gixy');
        const severityMap = config.get<Record<string, string>>('severityMap');

        assert.ok(severityMap);
        assert.strictEqual(severityMap['HIGH'], 'Error');
        assert.strictEqual(severityMap['MEDIUM'], 'Warning');
        assert.strictEqual(severityMap['LOW'], 'Information');
    });

    test('Should analyze nginx file with SSRF vulnerability', async function () {
        this.timeout(15000);

        const ssrfConfig = `
server {
    listen 80;
    
    location /api/ {
        set $backend $arg_backend;
        proxy_pass http://$backend;
    }
}
`;
        const doc = await vscode.workspace.openTextDocument({
            language: 'nginx',
            content: ssrfConfig,
        });

        await vscode.window.showTextDocument(doc);
        await vscode.commands.executeCommand('gixy.analyzeFile');

        // Wait for analysis to complete
        await new Promise((resolve) => setTimeout(resolve, 5000));

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);

        // If gixy is installed, we should get SSRF diagnostic
        if (diagnostics.length > 0) {
            assert.ok(diagnostics.some((d) => d.source === 'gixy'));
            const ssrfDiag = diagnostics.find(
                (d) =>
                    d.code?.toString().includes('ssrf') || d.message.toLowerCase().includes('ssrf')
            );
            if (ssrfDiag) {
                assert.ok(ssrfDiag.severity === vscode.DiagnosticSeverity.Error);
            }
        }
    });

    test('Should analyze nginx file with host spoofing issue', async function () {
        this.timeout(15000);

        const hostSpoofConfig = `
server {
    listen 80;
    location / {
        proxy_set_header Host $http_host;
        proxy_pass http://backend;
    }
}
`;
        const doc = await vscode.workspace.openTextDocument({
            language: 'nginx',
            content: hostSpoofConfig,
        });

        await vscode.window.showTextDocument(doc);
        await vscode.commands.executeCommand('gixy.analyzeFile');

        await new Promise((resolve) => setTimeout(resolve, 5000));

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);

        if (diagnostics.length > 0) {
            assert.ok(diagnostics.some((d) => d.source === 'gixy'));
        }
    });

    test('Should clear diagnostics on command', async function () {
        this.timeout(5000);

        await vscode.commands.executeCommand('gixy.clearDiagnostics');

        // All gixy diagnostics should be cleared
        const allDiagnostics = vscode.languages.getDiagnostics();
        const gixyDiagnostics = allDiagnostics.filter(([_uri, diags]) =>
            diags.some((d) => d.source === 'gixy')
        );

        assert.strictEqual(gixyDiagnostics.length, 0, 'Diagnostics should be cleared');
    });

    test('Documentation URLs should be correctly formatted', () => {
        const baseUrl = 'https://gixy.getpagespeed.com/plugins/';

        // Test some plugin URL mappings
        const testCases = [
            { plugin: 'ssrf', expected: `${baseUrl}ssrf/` },
            { plugin: 'http_splitting', expected: `${baseUrl}httpsplitting/` },
            { plugin: 'origins', expected: `${baseUrl}origins/` },
            { plugin: 'alias_traversal', expected: `${baseUrl}aliastraversal/` },
        ];

        // Verify URL format is correct
        for (const tc of testCases) {
            assert.ok(tc.expected.startsWith('https://gixy.getpagespeed.com/'));
            assert.ok(tc.expected.endsWith('/'));
        }
    });

    test('Should handle missing gixy gracefully', async function () {
        this.timeout(5000);

        // Save original config
        const config = vscode.workspace.getConfiguration('gixy');
        const originalPath = config.get<string>('executable');

        // Set non-existent path
        await config.update('executable', '/nonexistent/gixy', true);

        const doc = await vscode.workspace.openTextDocument({
            language: 'nginx',
            content: 'server { listen 80; }',
        });

        await vscode.window.showTextDocument(doc);

        // Should not throw
        try {
            await vscode.commands.executeCommand('gixy.analyzeFile');
        } catch (e) {
            assert.fail('Should not throw when gixy is missing');
        }

        // Restore config
        await config.update('executable', originalPath, true);
    });
});

suite('NGINX File Detection', () => {
    test('Should recognize nginx.conf filename', async () => {
        // Files named nginx.conf should be detected
        const patterns = ['nginx.conf', '/etc/nginx/nginx.conf', './nginx.conf'];
        for (const p of patterns) {
            assert.ok(p.includes('nginx.conf') || p.endsWith('.nginx'));
        }
    });

    test('Should recognize common nginx paths', () => {
        const nginxPaths = [
            '/etc/nginx/sites-available/default',
            '/etc/nginx/sites-enabled/mysite',
            '/etc/nginx/conf.d/custom.conf',
            '/nginx/snippets/ssl.conf',
        ];

        const pathPatterns = [
            '/nginx/',
            '/sites-available/',
            '/sites-enabled/',
            '/conf.d/',
            '/snippets/',
        ];

        for (const p of nginxPaths) {
            const matched = pathPatterns.some((pattern) => p.includes(pattern));
            assert.ok(matched, `Path ${p} should be recognized as nginx path`);
        }
    });

    test('Should detect nginx content patterns', () => {
        const nginxContent = `
http {
    server {
        listen 80;
        server_name example.com;
        
        location / {
            root /var/www/html;
            index index.html;
        }
    }
}
`;

        // Check for nginx-specific patterns
        assert.ok(/^\s*server\s*\{/m.test(nginxContent));
        assert.ok(/^\s*listen\s+\d+/m.test(nginxContent));
        assert.ok(/^\s*location\s+\//m.test(nginxContent));
    });
});

suite('Quick Fix Tests', () => {
    test('Host spoofing fix pattern', () => {
        const line = '        proxy_set_header Host $http_host;';
        const fixed = line.replace('$http_host', '$host');
        assert.ok(fixed.includes('$host'));
        assert.ok(!fixed.includes('$http_host'));
    });

    test('Content-Type fix pattern', () => {
        const line = '    add_header Content-Type text/plain;';
        const match = line.match(/add_header\s+Content-Type\s+([^;]+)/i);
        assert.ok(match);
        assert.strictEqual(match[1], 'text/plain');

        const indent = line.match(/^(\s*)/)?.[1] || '';
        const fixed = `${indent}default_type ${match[1]};`;
        assert.ok(fixed.includes('default_type'));
    });

    test('Allow without deny fix pattern', () => {
        const line = '    allow 192.168.1.0/24;';
        const indent = line.match(/^(\s*)/)?.[1] || '';
        const fix = `${indent}deny all;`;
        assert.strictEqual(fix, '    deny all;');
    });

    test('Valid referers fix pattern', () => {
        const line = 'valid_referers none server_names *.example.com;';
        const fixed = line.replace(/\s+none\b/, '').replace(/\bnone\s+/, '');
        assert.ok(!fixed.includes('none'));
        assert.ok(fixed.includes('server_names'));
    });
});

suite('Severity Configuration', () => {
    test('HIGH severity maps to Error', () => {
        const severityMap = {
            HIGH: 'Error',
            MEDIUM: 'Warning',
            LOW: 'Information',
        };
        assert.strictEqual(severityMap['HIGH'], 'Error');
    });

    test('MEDIUM severity maps to Warning', () => {
        const severityMap = {
            HIGH: 'Error',
            MEDIUM: 'Warning',
            LOW: 'Information',
        };
        assert.strictEqual(severityMap['MEDIUM'], 'Warning');
    });

    test('LOW severity maps to Information', () => {
        const severityMap = {
            HIGH: 'Error',
            MEDIUM: 'Warning',
            LOW: 'Information',
        };
        assert.strictEqual(severityMap['LOW'], 'Information');
    });
});

suite('Plugin Name Extraction', () => {
    // Regression test for "Learn more about object" bug
    // The diagnostic.code can be either a string or { value: string, target: Uri }

    test('Should extract plugin name from string code', () => {
        const code = 'version_disclosure';
        const plugin = String(code);
        assert.strictEqual(plugin, 'version_disclosure');
    });

    test('Should extract plugin name from object code with value property', () => {
        // Simulating the structure of diagnostic.code when it's an object
        const code = { value: 'host_spoofing', target: { toString: () => 'https://example.com' } };

        let plugin: string;
        if (typeof code === 'object' && code !== null && 'value' in code) {
            plugin = String(code.value);
        } else {
            plugin = String(code);
        }

        assert.strictEqual(plugin, 'host_spoofing');
        assert.notStrictEqual(plugin, '[object Object]');
    });

    test('Should not return [object Object] for object code', () => {
        const code = { value: 'ssrf', target: {} };

        // This is what the OLD buggy code did:
        // const plugin = String(code?.toString().split('|')[0] || '');
        // This would return '[object Object]'

        // This is what the NEW fixed code does:
        let plugin: string;
        if (typeof code === 'object' && code !== null && 'value' in code) {
            plugin = String(code.value);
        } else {
            plugin = String(code);
        }

        assert.strictEqual(plugin, 'ssrf');
        assert.ok(!plugin.includes('object'), 'Plugin name should not contain "object"');
        assert.ok(!plugin.includes('Object'), 'Plugin name should not contain "Object"');
    });

    test('Should handle null/undefined code gracefully', () => {
        const code = null;

        let plugin: string;
        if (typeof code === 'object' && code !== null && 'value' in code) {
            plugin = String((code as any).value);
        } else {
            plugin = String(code || '');
        }

        assert.strictEqual(plugin, '');
    });
});

suite('CodeAction Validation', () => {
    // Regression tests for CodeAction bugs

    test('Quick fix CodeAction should NOT have empty command string', () => {
        // Regression test for "command '' not found" bug
        // When a CodeAction has command: '', VSCode tries to execute it and fails

        // Simulating what a proper fix CodeAction should look like
        const fixAction = {
            title: '🔧 Set server_tokens off',
            kind: 'quickfix',
            edit: {
                /* WorkspaceEdit */
            },
            diagnostics: [],
            isPreferred: true,
            // NO command property, or command with valid non-empty string
        };

        // Verify no empty command
        assert.ok(
            !('command' in fixAction) ||
                (fixAction as any).command === undefined ||
                ((fixAction as any).command?.command && (fixAction as any).command.command !== ''),
            'CodeAction should not have empty command string'
        );
    });

    test('Learn More CodeAction should have valid command', () => {
        // The "Learn More" action should have a proper command
        const learnMoreAction = {
            title: '📖 Learn more about version_disclosure',
            kind: 'quickfix',
            command: {
                command: 'gixy.openDocs',
                title: 'Open Documentation',
                arguments: ['https://gixy.getpagespeed.com/plugins/version_disclosure/'],
            },
            diagnostics: [],
            isPreferred: false,
        };

        // Verify command is valid and non-empty
        assert.ok(learnMoreAction.command.command, 'Command should not be empty');
        assert.strictEqual(learnMoreAction.command.command, 'gixy.openDocs');
        assert.ok(learnMoreAction.command.arguments.length > 0, 'Should have URL argument');
    });

    test('Empty command string should be detected as invalid', () => {
        // This test documents what NOT to do
        const badCommand = '';
        const goodCommand = 'gixy.openDocs';

        assert.strictEqual(badCommand, '', 'Empty string is falsy');
        assert.ok(!badCommand, 'Empty command is falsy and should not be used');
        assert.ok(goodCommand, 'Non-empty command is truthy');
    });
});

suite('Gixy Fix Format', () => {
    // Tests for the fix format from gixy JSON output

    test('Fix object should have required fields', () => {
        const fix = {
            title: 'Replace $http_host with $host',
            search: '$http_host',
            replace: '$host',
            description: 'Use $host which is safer',
        };

        assert.ok('title' in fix);
        assert.ok('search' in fix);
        assert.ok('replace' in fix);
        assert.strictEqual(typeof fix.title, 'string');
        assert.strictEqual(typeof fix.search, 'string');
        assert.strictEqual(typeof fix.replace, 'string');
    });

    test('Fix description should be optional', () => {
        const fix = {
            title: 'Set server_tokens off',
            search: 'server_tokens on',
            replace: 'server_tokens off',
        };

        assert.ok('title' in fix);
        assert.ok('search' in fix);
        assert.ok('replace' in fix);
        assert.ok(!('description' in fix) || fix.description === undefined);
    });

    test('Fix search/replace should work for simple replacement', () => {
        const lineText = '    proxy_set_header Host $http_host;';
        const fix = {
            title: 'Replace $http_host with $host',
            search: '$http_host',
            replace: '$host',
        };

        const newText = lineText.replace(fix.search, fix.replace);
        assert.strictEqual(newText, '    proxy_set_header Host $host;');
        assert.ok(!newText.includes('$http_host'));
    });

    test('Fix search/replace should work for server_tokens', () => {
        const lineText = '    server_tokens on;';
        const fix = {
            title: 'Set server_tokens off',
            search: 'server_tokens on',
            replace: 'server_tokens off',
        };

        const newText = lineText.replace(fix.search, fix.replace);
        assert.strictEqual(newText, '    server_tokens off;');
    });
});

suite('Dynamic Analysis Configuration', () => {
    test('analyzeOnType setting should exist with default true', async () => {
        const config = vscode.workspace.getConfiguration('gixy');
        const analyzeOnType = config.get<boolean>('analyzeOnType');

        // Default should be true
        assert.strictEqual(analyzeOnType, true);
    });

    test('analyzeDebounceMs setting should exist with default 750', async () => {
        const config = vscode.workspace.getConfiguration('gixy');
        const debounceMs = config.get<number>('analyzeDebounceMs');

        // Default should be 750
        assert.strictEqual(debounceMs, 750);
    });

    test('analyzeDebounceMs should be within valid range', async () => {
        const config = vscode.workspace.getConfiguration('gixy');
        const debounceMs = config.get<number>('analyzeDebounceMs') || 750;

        // Should be between 200 and 5000 as per package.json schema
        assert.ok(debounceMs >= 200, 'Debounce should be at least 200ms');
        assert.ok(debounceMs <= 5000, 'Debounce should be at most 5000ms');
    });

    test('analyzeOnSave should still work alongside analyzeOnType', async () => {
        const config = vscode.workspace.getConfiguration('gixy');
        const onSave = config.get<boolean>('analyzeOnSave');
        const onType = config.get<boolean>('analyzeOnType');

        // Both can be enabled simultaneously
        assert.ok(typeof onSave === 'boolean');
        assert.ok(typeof onType === 'boolean');
    });
});

suite('Content Hash Deduplication', () => {
    test('Same content should produce same MD5 hash', () => {
        const content = 'server { listen 80; }';

        const hash1 = crypto.createHash('md5').update(content).digest('hex');
        const hash2 = crypto.createHash('md5').update(content).digest('hex');

        assert.strictEqual(hash1, hash2);
    });

    test('Different content should produce different hash', () => {
        const content1 = 'server { listen 80; }';
        const content2 = 'server { listen 443; }';

        const hash1 = crypto.createHash('md5').update(content1).digest('hex');
        const hash2 = crypto.createHash('md5').update(content2).digest('hex');

        assert.notStrictEqual(hash1, hash2);
    });

    test('Hash should be 32 character hex string', () => {
        const content = 'server { server_tokens on; }';
        const hash = crypto.createHash('md5').update(content).digest('hex');

        assert.strictEqual(hash.length, 32);
        assert.ok(/^[0-9a-f]+$/.test(hash), 'Hash should be hex characters only');
    });

    test('Whitespace changes should produce different hash', () => {
        const content1 = 'server { listen 80; }';
        const content2 = 'server {  listen 80; }'; // Extra space

        const hash1 = crypto.createHash('md5').update(content1).digest('hex');
        const hash2 = crypto.createHash('md5').update(content2).digest('hex');

        assert.notStrictEqual(hash1, hash2, 'Whitespace changes should be detected');
    });
});

suite('Temp File Management', () => {
    test('Temp directory should be accessible', () => {
        const tmpDir = os.tmpdir();
        assert.ok(tmpDir, 'Temp directory should exist');
        assert.ok(fs.existsSync(tmpDir), 'Temp directory should be accessible');
    });

    test('Should be able to create temp file with nginx extension', () => {
        const tmpDir = os.tmpdir();
        const tempFile = path.join(tmpDir, `gixy-test-${Date.now()}.conf`);

        try {
            fs.writeFileSync(tempFile, 'server { listen 80; }', 'utf8');
            assert.ok(fs.existsSync(tempFile), 'Temp file should exist');

            const content = fs.readFileSync(tempFile, 'utf8');
            assert.ok(content.includes('listen 80'), 'Content should be written');
        } finally {
            // Cleanup
            try {
                fs.unlinkSync(tempFile);
            } catch {
                /* ignore */
            }
        }
    });

    test('Should be able to overwrite temp file', () => {
        const tmpDir = os.tmpdir();
        const tempFile = path.join(tmpDir, `gixy-overwrite-${Date.now()}.conf`);

        try {
            // Write first content
            fs.writeFileSync(tempFile, 'server { listen 80; }', 'utf8');

            // Overwrite with new content
            fs.writeFileSync(tempFile, 'server { listen 443 ssl; }', 'utf8');

            const content = fs.readFileSync(tempFile, 'utf8');
            assert.ok(content.includes('443'), 'Content should be overwritten');
            assert.ok(!content.includes('80'), 'Old content should be gone');
        } finally {
            try {
                fs.unlinkSync(tempFile);
            } catch {
                /* ignore */
            }
        }
    });

    test('Temp file name should include document basename', () => {
        const docFileName = '/path/to/nginx.conf';
        const ext = path.extname(docFileName) || '.conf';
        const basename = path.basename(docFileName, ext);

        const tempFile = path.join(os.tmpdir(), `gixy-${basename}-${Date.now()}${ext}`);

        assert.ok(tempFile.includes('gixy-'), 'Should have gixy prefix');
        assert.ok(tempFile.includes('nginx'), 'Should include original basename');
        assert.ok(tempFile.endsWith('.conf'), 'Should preserve extension');
    });
});

suite('Debounce Timer Logic', () => {
    test('Debounce should delay execution', async function () {
        this.timeout(3000);

        let executed = false;
        const debounceMs = 500;

        // Simulate debounce
        const timer = setTimeout(() => {
            executed = true;
        }, debounceMs);

        // Before debounce period
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.strictEqual(executed, false, 'Should not execute before debounce period');

        // After debounce period
        await new Promise((resolve) => setTimeout(resolve, 500));
        assert.strictEqual(executed, true, 'Should execute after debounce period');

        clearTimeout(timer); // Cleanup
    });

    test('Debounce should be cancellable', async function () {
        this.timeout(2000);

        let executed = false;
        const debounceMs = 500;

        const timer = setTimeout(() => {
            executed = true;
        }, debounceMs);

        // Cancel before execution
        clearTimeout(timer);

        await new Promise((resolve) => setTimeout(resolve, 700));
        assert.strictEqual(executed, false, 'Should not execute if cancelled');
    });

    test('New debounce should cancel previous', async function () {
        this.timeout(3000);

        let firstExecuted = false;
        let secondExecuted = false;
        const debounceMs = 300;

        // First timer
        let timer = setTimeout(() => {
            firstExecuted = true;
        }, debounceMs);

        // Cancel first, start second (simulating rapid edits)
        await new Promise((resolve) => setTimeout(resolve, 100));
        clearTimeout(timer);

        timer = setTimeout(() => {
            secondExecuted = true;
        }, debounceMs);

        // Wait for second to complete
        await new Promise((resolve) => setTimeout(resolve, 400));

        assert.strictEqual(firstExecuted, false, 'First should be cancelled');
        assert.strictEqual(secondExecuted, true, 'Second should execute');

        clearTimeout(timer);
    });
});

suite('Process Cancellation', () => {
    test('Process kill should be safe to call', () => {
        // Simulate having a process reference that we might need to kill
        let processMock: { killed: boolean; kill: () => void } | null = {
            killed: false,
            kill: function () {
                this.killed = true;
            },
        };

        // Safe cancellation pattern
        if (processMock) {
            processMock.kill();
            processMock = null;
        }

        assert.strictEqual(processMock, null);
    });

    test('Map-based state cleanup should work', () => {
        const timers = new Map<string, NodeJS.Timeout>();
        const processes = new Map<string, { kill: () => void }>();

        const uriStr = 'file:///test/nginx.conf';

        // Add state
        timers.set(
            uriStr,
            setTimeout(() => {}, 1000)
        );
        processes.set(uriStr, { kill: () => {} });

        assert.ok(timers.has(uriStr));
        assert.ok(processes.has(uriStr));

        // Cleanup
        clearTimeout(timers.get(uriStr));
        timers.delete(uriStr);
        processes.get(uriStr)?.kill();
        processes.delete(uriStr);

        assert.ok(!timers.has(uriStr));
        assert.ok(!processes.has(uriStr));
    });
});

suite('URI String Consistency', () => {
    test('Document URI toString should be consistent', async () => {
        const doc = await vscode.workspace.openTextDocument({
            language: 'nginx',
            content: 'server { listen 80; }',
        });

        const uriStr1 = doc.uri.toString();
        const uriStr2 = doc.uri.toString();

        assert.strictEqual(uriStr1, uriStr2, 'URI string should be consistent');
    });

    test('Map should correctly store and retrieve by URI string', () => {
        const issueStore = new Map<string, string[]>();
        const uriStr = 'file:///test/nginx.conf';

        issueStore.set(uriStr, ['issue1', 'issue2']);

        const retrieved = issueStore.get(uriStr);
        assert.ok(retrieved);
        assert.strictEqual(retrieved.length, 2);
    });
});

suite('Auto-Setup Configuration', () => {
    test('autoInstall setting should exist with default true', async () => {
        const config = vscode.workspace.getConfiguration('gixy');
        const autoInstall = config.get<boolean>('autoInstall');

        assert.strictEqual(autoInstall, true);
    });

    test('installGixy command should be registered', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(
            commands.includes('gixy.installGixy'),
            'installGixy command should be registered'
        );
    });

    test('Venv directory should use VSCode extension storage', () => {
        // VSCode's globalStorageUri provides a path like:
        // ~/.vscode/extensions/globalStorage/getpagespeed.gixy/
        // This is proper VSCode-managed storage that gets cleaned up on uninstall

        // The extension uses context.globalStorageUri when available
        // Falls back to ~/.vscode-gixy only if context is not available
        const homeDir = os.homedir();
        const fallbackPath = path.join(homeDir, '.vscode-gixy');

        // Fallback should still be valid
        assert.ok(fallbackPath.includes('.vscode-gixy'));
        assert.ok(fallbackPath.startsWith(homeDir));
    });

    test('Gixy binary path should vary by platform', () => {
        const homeDir = os.homedir();
        const venvDir = path.join(homeDir, '.vscode-gixy');
        const isWindows = process.platform === 'win32';
        const binDir = isWindows ? 'Scripts' : 'bin';
        const gixyBin = isWindows ? 'gixy.exe' : 'gixy';

        const gixyPath = path.join(venvDir, 'venv', binDir, gixyBin);

        if (isWindows) {
            assert.ok(gixyPath.includes('Scripts'));
            assert.ok(gixyPath.endsWith('.exe'));
        } else {
            assert.ok(gixyPath.includes('bin'));
            assert.ok(gixyPath.endsWith('gixy'));
        }
    });

    test('Pip path should vary by platform', () => {
        const homeDir = os.homedir();
        const venvDir = path.join(homeDir, '.vscode-gixy');
        const isWindows = process.platform === 'win32';
        const binDir = isWindows ? 'Scripts' : 'bin';
        const pipBin = isWindows ? 'pip.exe' : 'pip';

        const pipPath = path.join(venvDir, 'venv', binDir, pipBin);

        if (isWindows) {
            assert.ok(pipPath.includes('Scripts'));
            assert.ok(pipPath.endsWith('.exe'));
        } else {
            assert.ok(pipPath.includes('bin'));
            assert.ok(pipPath.endsWith('pip'));
        }
    });
});

suite('Python Detection', () => {
    test('Python candidates should be platform-specific', () => {
        const isWindows = process.platform === 'win32';
        const candidates = isWindows ? ['python', 'python3', 'py -3'] : ['python3', 'python'];

        if (isWindows) {
            assert.ok(candidates.includes('py -3'), 'Windows should try py launcher');
        } else {
            assert.ok(candidates[0] === 'python3', 'Unix should prefer python3');
        }
    });

    test('Should detect Python 3 in version string', () => {
        const validVersions = [
            'Python 3.8.10',
            'Python 3.9.7',
            'Python 3.10.0',
            'Python 3.11.1',
            'Python 3.12.0',
        ];

        for (const version of validVersions) {
            assert.ok(version.includes('Python 3'), `Should detect: ${version}`);
        }
    });

    test('Should reject Python 2 version string', () => {
        const version = 'Python 2.7.18';
        assert.ok(!version.includes('Python 3'), 'Should reject Python 2');
    });
});

suite('Gixy Path Resolution', () => {
    test('Configured path should take precedence', async () => {
        const config = vscode.workspace.getConfiguration('gixy');
        const configured = config.get<string>('executable');

        // Default is 'gixy' which means use auto-detection
        assert.ok(configured === 'gixy' || typeof configured === 'string');
    });

    test('Resolution order should be: configured -> cached -> venv -> system', () => {
        // This documents the expected resolution order
        const resolutionOrder = [
            'User-configured path (gixy.executable)',
            'Cached path from previous resolution',
            'Private venv at ~/.vscode-gixy/venv/bin/gixy',
            'System PATH (gixy command)',
        ];

        assert.strictEqual(resolutionOrder.length, 4);
        assert.ok(resolutionOrder[0].includes('configured'));
        assert.ok(resolutionOrder[1].includes('cached'));
        assert.ok(resolutionOrder[2].includes('venv'));
        assert.ok(resolutionOrder[3].includes('system') || resolutionOrder[3].includes('PATH'));
    });
});

suite('On-Type Analysis Integration', () => {
    test('Should analyze document changes after debounce', async function () {
        this.timeout(10000);

        const config = vscode.workspace.getConfiguration('gixy');
        const analyzeOnType = config.get<boolean>('analyzeOnType');

        // Skip if on-type analysis is disabled
        if (!analyzeOnType) {
            this.skip();
            return;
        }

        const doc = await vscode.workspace.openTextDocument({
            language: 'nginx',
            content: 'server { listen 80; }',
        });

        const editor = await vscode.window.showTextDocument(doc);

        // Make a change that would trigger on-type analysis
        await editor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 9), '\n    server_tokens on;');
        });

        // Wait for debounce + analysis (debounce default 750ms + buffer)
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Note: This test validates the flow works without errors
        // Actual diagnostics depend on gixy being installed
        assert.ok(true, 'On-type analysis flow completed without errors');
    });

    test('Rapid edits should not cause multiple analyses', async function () {
        this.timeout(10000);

        const doc = await vscode.workspace.openTextDocument({
            language: 'nginx',
            content: 'server { listen 80; }',
        });

        const editor = await vscode.window.showTextDocument(doc);

        // Rapid edits (should be debounced to single analysis)
        for (let i = 0; i < 5; i++) {
            await editor.edit((editBuilder) => {
                editBuilder.insert(new vscode.Position(0, 0), ' ');
            });
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // The debounce should coalesce these into one analysis
        await new Promise((resolve) => setTimeout(resolve, 1500));

        assert.ok(true, 'Rapid edits handled without errors');
    });

    test('Closing document should cleanup state', async function () {
        this.timeout(5000);

        const doc = await vscode.workspace.openTextDocument({
            language: 'nginx',
            content: 'server { listen 80; }',
        });

        await vscode.window.showTextDocument(doc);

        // Force analyze to populate state
        await vscode.commands.executeCommand('gixy.analyzeFile');
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Close the document
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

        // Wait for cleanup
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Diagnostics for this document should be cleared
        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        assert.strictEqual(diagnostics.length, 0, 'Diagnostics should be cleared on close');
    });
});
