# Gixy - NGINX Config Security Analyzer for VS Code

![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/getpagespeed.gixy)
![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/getpagespeed.gixy)

Catch NGINX misconfigurations before they become vulnerabilities! This extension integrates [Gixy](https://github.com/dvershinin/gixy) directly into VS Code/Cursor to provide real-time security analysis.

## ✨ Features

- **Real-time Analysis** - Squiggles appear on save, highlighting exact lines with issues
- **Accurate Line Numbers** - Issues point directly to problematic directives
- **Severity Indicators** - 🔴 Errors (HIGH), 🟡 Warnings (MEDIUM), 🔵 Info (LOW)
- **One-Click Documentation** - Click issue codes to open detailed explanations
- **Workspace Scanning** - Analyze all NGINX configs in your project at once

## 🛡️ Security Checks

Gixy detects:

| Plugin | Description |
|--------|-------------|
| `ssrf` | Server Side Request Forgery via user-controlled proxy_pass |
| `http_splitting` | HTTP Response Splitting via header injection |
| `valid_referers` | Insecure `valid_referers` allowing `none` |
| `add_header_redefinition` | Nested `add_header` dropping parent security headers |
| `host_spoofing` | Host header spoofing via `$http_host` |
| `alias_traversal` | Path traversal via misconfigured `alias` |
| `if_is_evil` | Dangerous `if` constructs in location context |
| And more... | [Full plugin list](https://github.com/dvershinin/gixy#plugins) |

## 📦 Installation

### Prerequisites

Install Gixy (Python package):

```bash
pip install gixy-ng
```

### Extension Installation

1. **VS Code Marketplace**: Search "Gixy" in Extensions (Ctrl+Shift+X)
2. **Manual**: Download `.vsix` from [Releases](https://github.com/dvershinin/gixy/releases), then:
   ```bash
   code --install-extension gixy-0.1.0.vsix
   ```

## 🚀 Usage

1. Open any NGINX config file (`.conf`, `nginx.conf`, etc.)
2. Issues appear automatically as you edit/save
3. Hover over squiggles for details
4. Click the issue code (e.g., `ssrf`) to open documentation

### Commands

- **Gixy: Analyze Current File** - Run analysis on active file
- **Gixy: Analyze All NGINX Configs** - Scan entire workspace

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `gixy.executable` | `gixy` | Path to gixy binary |
| `gixy.analyzeOnSave` | `true` | Auto-analyze on save |
| `gixy.analyzeOnOpen` | `true` | Auto-analyze on open |
| `gixy.severityMap` | `{HIGH: Error, MEDIUM: Warning, LOW: Information}` | Severity mapping |

## 📸 Screenshot

```
server {
    listen 80;
    
    location /api/ {
        set $backend $arg_backend;
        proxy_pass http://$backend;  ← 🔴 [ssrf] Possible SSRF
    }
}
```

## 🤝 Contributing

Issues and PRs welcome at [github.com/dvershinin/gixy](https://github.com/dvershinin/gixy)

## 📄 License

MIT - Same as Gixy
