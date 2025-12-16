# Gixy - NGINX Config Security Analyzer for VS Code

[![Install from VS Code Marketplace](https://img.shields.io/badge/Install-VS%20Code%20Marketplace-007ACC?style=for-the-badge&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=getpagespeed.gixy)

![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/getpagespeed.gixy)
![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/getpagespeed.gixy)
[![Documentation](https://img.shields.io/badge/docs-gixy.getpagespeed.com-blue)](https://gixy.getpagespeed.com/)

Catch NGINX misconfigurations before they become vulnerabilities! This extension integrates [Gixy](https://gixy.getpagespeed.com/) directly into VS Code/Cursor to provide real-time security analysis.

**👉 [Install from VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=getpagespeed.gixy)**

## ✨ Features

- **🔴 Real-time Analysis** - Squiggles appear on save, highlighting exact lines with issues
- **📍 Accurate Line Numbers** - Issues point directly to problematic directives  
- **🎯 Severity Indicators** - 🔴 Critical, 🟠 Warning, 🟡 Info, 🔵 Hint
- **📖 One-Click Documentation** - Click issue codes to open detailed explanations
- **📁 Workspace Scanning** - Analyze all NGINX configs in your project at once
- **🔧 Quick Fixes** - One-click fixes for common issues like `$http_host` → `$host`
- **💡 Rich Hovers** - Detailed tooltips with severity, description, and problematic config
- **📊 Status Bar** - Live indicator showing analysis status and issue count
- **🎨 Modern UI** - Beautiful diagnostics with proper severity colors and icons

## 🛡️ Security Checks

Gixy detects over 25 different NGINX misconfigurations:

| Plugin | Severity | Description |
|--------|----------|-------------|
| `ssrf` | 🔴 HIGH | Server Side Request Forgery via user-controlled proxy_pass |
| `http_splitting` | 🔴 HIGH | HTTP Response Splitting via header injection |
| `origins` | 🔴 HIGH | Insecure Origin/Referer validation regex |
| `alias_traversal` | 🔴 HIGH | Path traversal via misconfigured `alias` |
| `valid_referers` | 🔴 HIGH | Insecure `valid_referers` allowing `none` |
| `if_is_evil` | 🔴 HIGH | Dangerous `if` constructs in location context |
| `allow_without_deny` | 🔴 HIGH | Missing `deny all;` after allow directives |
| `host_spoofing` | 🟠 MEDIUM | Host header spoofing via `$http_host` |
| `add_header_redefinition` | 🟠 MEDIUM | Nested `add_header` dropping parent headers |
| `missing_resolver` | 🟠 MEDIUM | DNS resolution without resolver directive |
| `proxy_pass_normalized` | 🟠 MEDIUM | Path encoding issues with proxy_pass |
| `regex_redos` | 🟠 MEDIUM | Regular Expression DoS vulnerabilities |
| And more... | | [Full plugin list](https://gixy.getpagespeed.com/) |

## 📦 Installation

### Prerequisites

Install Gixy (Python package):

```bash
pip install gixy-ng
```

### Extension Installation

1. **VS Code Marketplace**: Search "Gixy" in Extensions (Ctrl+Shift+X)
2. **Manual**: Download `.vsix` from [Releases](https://github.com/dvershinin/vscode-gixy/releases), then:
   ```bash
   code --install-extension gixy-0.3.0.vsix
   ```

## 🚀 Usage

1. Open any NGINX config file (`.conf`, `nginx.conf`, etc.)
2. Issues appear automatically as you edit/save
3. Hover over squiggles for rich details with config snippets
4. Click the issue code (e.g., `ssrf`) to open documentation
5. Use Quick Fixes (💡) for one-click remediation

### Commands

| Command | Description |
|---------|-------------|
| **Gixy: Analyze Current File** | Run analysis on active file |
| **Gixy: Analyze All NGINX Configs** | Scan entire workspace |
| **Gixy: Show Output** | Open Gixy output channel |
| **Gixy: Clear All Diagnostics** | Clear all Gixy diagnostics |

### Quick Fixes Available

The extension provides automated fixes for common issues:

- 🔧 **Host Spoofing**: Replace `$http_host` with `$host`
- 🔧 **Content-Type**: Replace `add_header Content-Type` with `default_type`
- 🔧 **Allow Without Deny**: Add `deny all;` after allow directives
- 🔧 **Valid Referers**: Remove `none` from valid_referers
- 🔧 **Error Log**: Set proper error_log path

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `gixy.executable` | `gixy` | Path to gixy binary |
| `gixy.analyzeOnSave` | `true` | Auto-analyze on save |
| `gixy.analyzeOnOpen` | `true` | Auto-analyze on open |
| `gixy.severityMap` | See below | Severity to VS Code diagnostic mapping |

### Default Severity Mapping

```json
{
  "HIGH": "Error",
  "MEDIUM": "Warning", 
  "LOW": "Information"
}
```

## 📸 Demo

```nginx
server {
    listen 80;
    
    # 🔴 SSRF vulnerability detected
    location /api/ {
        set $backend $arg_backend;
        proxy_pass http://$backend;  # ← Gixy flags this!
    }
    
    # 🟠 Host spoofing - Quick Fix available
    location /proxy {
        proxy_set_header Host $http_host;  # ← 💡 Fix: use $host
        proxy_pass http://backend;
    }
}
```

## 📚 Documentation

Full documentation available at **[gixy.getpagespeed.com](https://gixy.getpagespeed.com/)**

Each plugin has detailed documentation explaining:
- What the vulnerability is
- Why it's dangerous  
- How to fix it
- Safe configuration examples

## 🤝 Contributing

Issues and PRs welcome:
- **Extension**: [github.com/dvershinin/vscode-gixy](https://github.com/dvershinin/vscode-gixy)
- **Gixy CLI**: [github.com/dvershinin/gixy](https://github.com/dvershinin/gixy)

## 📄 License

MIT - Same as Gixy
