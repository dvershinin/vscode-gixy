# Changelog

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

