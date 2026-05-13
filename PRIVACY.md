# agent_1 Privacy Policy

**Effective Date**: 2026-05-13
**Last Updated**: 2026-05-13
**Version**: 1.0

---

## 1. Overview

agent_1 ("we", "us", "our") is a CLI-based AI coding agent that helps developers write and modify code. This Privacy Policy explains how we collect, use, store, and protect your data when you use agent_1.

agent_1 is designed with **privacy-by-default** principles: data is stored locally on your machine, and AI API calls are initiated only at your explicit request.

---

## 2. Data We Collect

### 2.1 Data You Actively Provide
When you use agent_1, the following data may be sent to your chosen AI provider:
- **Dialog content**: Your prompts and instructions to the AI
- **Project context**: File listings, directory structures, and relevant code snippets needed to fulfill your request
- **Configuration**: Your provider selection, permission preferences, and model choice

### 2.2 Data We Do NOT Collect
We do **not** collect or transmit:
- Your name, email address, or any direct personal identity information
- Device hardware identifiers or advertising IDs
- Location data or IP addresses (in telemetry)
- Browsing history or application usage outside of agent_1

### 2.3 Local Data
The following data is stored **exclusively on your local machine** in `~/.agent_1/`:
- Session history (dialog messages and tool execution results)
- Configuration preferences
- Audit logs (tool execution types and permission decisions, without command text or file paths)
- API key references (stored in system keychain, not in plaintext)

---

## 3. How We Use Your Data

### 3.1 AI Provider Communication
- Your code snippets and instructions are **actively** transmitted to your chosen AI provider (Anthropic or OpenAI) only when you submit a query
- Data transmission is visible in the CLI status bar at all times, showing which provider is receiving data
- All transmissions use HTTPS with certificate pinning

### 3.2 Local Processing
- Session management, configuration, and audit logging occur entirely locally
- Telemetry data (if enabled) is anonymized: it records operation types and security event summaries, but does **not** contain command text, file paths, project names, or IP addresses

### 3.3 No Data Selling
We do **not** sell, rent, or share your data with any third parties beyond the AI provider you explicitly select.

---

## 4. Data Retention

| Data Type | Location | Retention Period | Deletion Method |
|-----------|----------|------------------|-----------------|
| Session history | `~/.agent_1/sessions/` | Until manually deleted or auto-cleaned (default 30 days) | `agent_1 purge --all` |
| Configuration | `~/.agent_1/config.json` | Until manually deleted | `agent_1 purge --all` |
| Audit logs | `~/.agent_1/audit/` | Until manually deleted | `agent_1 purge --all` |
| Telemetry | `~/.agent_1/logs/` | Rolling 30 days, max 100MB | `agent_1 purge --all` |

**Important**: Data already transmitted to AI providers (Anthropic/OpenAI) is subject to their respective data retention policies. agent_1 cannot recall data once sent. You must contact the provider directly to request deletion of transmitted data.

---

## 5. Third-Party Services

### 5.1 AI Provider SDKs

agent_1 integrates with the following SDKs:

| SDK | Version | Purpose | Data Destination |
|-----|---------|---------|------------------|
| `@anthropic-ai/sdk` | latest | Anthropic Messages API | Anthropic servers (default: US, configurable EU) |
| `openai` | latest | OpenAI Chat Completions API | OpenAI servers (configurable) |

These SDKs only transmit data you actively provide. They do not silently collect device information, personal identity data, or usage statistics.

### 5.2 Data Processing Agreements (DPA)
We have signed Data Processing Agreements with both Anthropic and OpenAI to ensure your data is processed in compliance with applicable data protection regulations.

---

## 6. Your Rights

### 6.1 Data Export
Export all local data in JSON format:
```bash
agent_1 export --format json
```

### 6.2 Data Deletion
Permanently delete all local data (sessions, audit logs, telemetry):
```bash
agent_1 purge --all
```

### 6.3 Telemetry Opt-Out
Disable telemetry collection:
```bash
agent_1 config set telemetry_enabled false
```

### 6.4 AI Provider Data Deletion
Data already sent to Anthropic or OpenAI must be deleted by contacting the respective provider directly. agent_1 cannot revoke transmitted data.

---

## 7. Security Measures

- **Certificate Pinning**: All API calls use certificate pinning to prevent man-in-the-middle attacks
- **Keychain Storage**: API keys are stored in the operating system's secure credential manager (Windows Credential Manager, macOS Keychain, Linux `secret-tool`)
- **Memory Security**: API keys are zeroed from memory immediately after use
- **Code Integrity**: CLI binary releases include SHA-256 checksums and digital signatures
- **Permission Pipeline**: All tool executions pass through a 4-layer permission check before execution

---

## 8. Compliance

### 8.1 GDPR (EU/EEA Users)
- Data processing is based on your explicit consent (Article 6(1)(a))
- Default API endpoints use EU regions where available
- You may exercise your rights to access, rectify, erase, and port your data at any time

### 8.2 PIPL (China Users)
- Data is processed with your explicit, informed consent
- Local data storage follows data minimization principles
- Cross-border data transmission occurs only when you select a non-China API endpoint

---

## 9. AI-Generated Code Copyright

Copyright status of AI-generated code is currently not uniformly established across jurisdictions. agent_1 does **not** claim copyright over generated code. We strongly recommend:
- Reviewing all generated content before use
- Being cautious with copyleft-licensed code (e.g., GPL) that may appear in training data

---

## 10. Changes to This Policy

We may update this Privacy Policy from time to time. Changes will be communicated through:
- Release notes on our GitHub repository
- CLI notification on first run after update

---

## 11. Contact Us

- **Email**: privacy@agent1.dev
- **GitHub Issues**: [github.com/agent_1/agent_1/issues](https://github.com/agent_1/agent_1/issues)

---

*This document was reviewed and approved by legal counsel before publication.*