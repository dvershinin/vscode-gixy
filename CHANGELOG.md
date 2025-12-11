# Changelog

## [0.5.0] - 2024-12-12

### ✨ New Features
- **Auto-Install Gixy**: Extension now automatically installs gixy-ng if not found
  - Creates private venv in VSCode's extension storage (cleaned up on uninstall)
  - User consent prompt with options: Install, Install Manually, Never Ask Again
  - New command: `Gixy: Install/Reinstall Gixy`
  - Configurable via `gixy.autoInstall` setting
- **Live Analysis**: Analyze as you type with debouncing
  - Writes to temp file for unsaved changes
  - Content hash deduplication (skips unchanged content)
  - Process cancellation on rapid edits
  - Configurable debounce delay: `gixy.analyzeDebounceMs` (default 750ms)
- **Quick Fixes from Gixy**: Fixes now come directly from gixy's JSON output
  - Works for any IDE that consumes gixy's output
  - More accurate and consistent fixes

### 🔧 Developer Experience
- **Pre-commit hooks**: Husky + ESLint + Prettier
- **CI/CD**: Comprehensive GitHub Actions workflow
  - Linting, security audit, VSIX size check
  - Multi-platform testing (Ubuntu, macOS, Windows)
  - Manifest validation, code quality checks
- **Smaller VSIX**: Optimized `.vscodeignore` (49KB vs 75KB)
- **ESLint + Prettier**: Code quality and formatting

### 🐛 Fixed
- "Learn more about object" bug - now correctly extracts plugin name from diagnostic code
- "command '' not found" bug - removed invalid empty command in CodeAction
- Double-reporting of version_disclosure issues

### 📋 Configuration
- `gixy.autoInstall`: Auto-install gixy if not found (default: true)
- `gixy.analyzeOnType`: Analyze as you type (default: true)
- `gixy.analyzeDebounceMs`: Debounce delay in ms (default: 750)

## [0.3.0] - 2024-12-12

### ✨ New Features
- **Quick Fixes**: One-click fixes for common issues:
  - Replace `$http_host` with `$host` (host spoofing)
  - Replace `add_header Content-Type` with `default_type`
  - Add `deny all;` after allow directives
  - Remove `none` from valid_referers
  - Set proper error_log path
- **Rich Hover Tooltips**: Detailed issue information with:
  - Severity badges with icons
  - Full description and reason
  - Problematic config snippet with syntax highlighting
  - Direct link to documentation
- **Status Bar**: Live indicator showing:
  - Analysis status (idle/analyzing)
  - Issue count with warning background
  - Click to show output
- **New Commands**:
  - `Gixy: Show Output` - Open output channel
  - `Gixy: Clear All Diagnostics` - Clear all issues

### 🔗 Improved
- **Documentation URLs**: All links now point to the official docs at [gixy.getpagespeed.com](https://gixy.getpagespeed.com/)
- **Better diagnostics**: Rich messages with detailed reasons
- **Editor context menu**: Analyze file directly from right-click menu
- **Editor title button**: Quick access to analyze current file
- **Cancellable workspace analysis**: Stop long-running workspace scans

### 🧪 Testing
- Comprehensive test suite covering:
  - Extension activation
  - Command registration
  - NGINX file detection
  - Quick fix patterns
  - Severity mapping
- Test configuration files for local verification

## [0.2.0] - 2024-12-11

### Improved
- **Smart file detection**: Now analyzes content to detect nginx configs, not just file extensions
- Generic `.conf` files are checked for nginx-specific patterns before analysis
- Avoids false positives on Apache, systemd, and other config formats

### Fixed
- Accurate line number reporting using gixy's native line tracking

## [0.1.0] - 2024-12-11

### Added
- Initial release
- Real-time NGINX config analysis on open/save
- Accurate line number reporting for all issues
- Severity-based diagnostics (Error/Warning/Information)
- Clickable issue codes linking to documentation
- Workspace-wide scanning command
- Configurable gixy executable path
- Custom severity mapping

### Security Checks
- SSRF detection
- HTTP Response Splitting
- Header Redefinition
- Host Spoofing
- Alias Path Traversal
- Valid Referers misconfiguration
- And all other Gixy plugins
