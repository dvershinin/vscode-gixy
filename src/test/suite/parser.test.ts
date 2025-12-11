import * as assert from 'assert';

// Test the JSON parsing logic (mock version since we can't import the extension directly)
suite('Gixy Parser Unit Tests', () => {
    
    interface GixyIssue {
        plugin: string;
        summary: string;
        severity: string;
        description: string;
        reason: string;
        config: string;
        path: string;
        reference: string;
        line?: number;
        file?: string;
    }

    test('Should parse gixy JSON output with line numbers', () => {
        const jsonOutput = `[
            {
                "config": "\\nserver {\\n\\tproxy_pass http://$backend;\\n}",
                "description": "SSRF vulnerability",
                "file": "/test/nginx.conf",
                "line": 11,
                "path": "/test/nginx.conf",
                "plugin": "ssrf",
                "reason": "User controlled backend",
                "reference": "https://example.com",
                "severity": "HIGH",
                "summary": "Possible SSRF"
            }
        ]`;
        
        const issues: GixyIssue[] = JSON.parse(jsonOutput);
        
        assert.strictEqual(issues.length, 1);
        assert.strictEqual(issues[0].plugin, 'ssrf');
        assert.strictEqual(issues[0].line, 11);
        assert.strictEqual(issues[0].file, '/test/nginx.conf');
        assert.strictEqual(issues[0].severity, 'HIGH');
    });

    test('Should handle issues without line numbers (backward compat)', () => {
        const jsonOutput = `[
            {
                "config": "\\nserver {\\n\\tproxy_pass http://backend;\\n}",
                "description": "Some issue",
                "path": "/test/nginx.conf",
                "plugin": "test_plugin",
                "reason": "",
                "reference": "",
                "severity": "LOW",
                "summary": "Test issue"
            }
        ]`;
        
        const issues: GixyIssue[] = JSON.parse(jsonOutput);
        
        assert.strictEqual(issues.length, 1);
        assert.strictEqual(issues[0].line, undefined);
        assert.strictEqual(issues[0].file, undefined);
    });

    test('Should parse multiple issues', () => {
        const jsonOutput = `[
            {"plugin": "ssrf", "line": 5, "severity": "HIGH", "summary": "SSRF", "config": "", "description": "", "path": "/a", "reason": "", "reference": ""},
            {"plugin": "valid_referers", "line": 15, "severity": "HIGH", "summary": "Bad referer", "config": "", "description": "", "path": "/a", "reason": "", "reference": ""},
            {"plugin": "add_header_redefinition", "line": 25, "severity": "MEDIUM", "summary": "Header issue", "config": "", "description": "", "path": "/a", "reason": "", "reference": ""}
        ]`;
        
        const issues: GixyIssue[] = JSON.parse(jsonOutput);
        
        assert.strictEqual(issues.length, 3);
        assert.strictEqual(issues[0].line, 5);
        assert.strictEqual(issues[1].line, 15);
        assert.strictEqual(issues[2].line, 25);
    });

    test('Should handle empty output', () => {
        const issues: GixyIssue[] = JSON.parse('[]');
        assert.strictEqual(issues.length, 0);
    });

    test('Line numbers should be 1-based (from gixy)', () => {
        // Verify that line 1 means first line of file
        const jsonOutput = `[{"plugin": "test", "line": 1, "severity": "LOW", "summary": "Test", "config": "", "description": "", "path": "/a", "reason": "", "reference": ""}]`;
        const issues: GixyIssue[] = JSON.parse(jsonOutput);
        
        // Line 1 from gixy = first line of file
        // VS Code uses 0-based, so we'd convert: lineIndex = line - 1 = 0
        assert.strictEqual(issues[0].line, 1);
        const vsCodeLineIndex = issues[0].line! - 1;
        assert.strictEqual(vsCodeLineIndex, 0);
    });

    test('Severity values should be uppercase strings', () => {
        const severities = ['HIGH', 'MEDIUM', 'LOW', 'UNSPECIFIED'];
        
        for (const sev of severities) {
            const json = `[{"plugin": "test", "severity": "${sev}", "summary": "", "config": "", "description": "", "path": "", "reason": "", "reference": ""}]`;
            const issues: GixyIssue[] = JSON.parse(json);
            assert.strictEqual(issues[0].severity, sev);
        }
    });
});

