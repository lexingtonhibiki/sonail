# Security / 安全说明

Sonail 0.1 is a local preview for a trusted computer. The Windows launcher binds API/UI to loopback. It is not a hosted multi-user service or hardened sandbox. Authentication is optional in inherited server code; do not expose this launcher to a LAN/public network.

Harnesses execute with native permissions. A read-only prompt is not OS isolation. Review gates check evidence/revisions; they cannot prove the absence of malicious changes. Fully managed mode expands workflow authority within disclosed boundaries.

Endpoint keys are local plaintext in data/workflow.json. An OS keyring is not implemented. Backups may contain keys. Keep data/, .env and logs private. Do not execute untrusted repositories on the assumption that review guarantees safety.

Sonail 为受信任电脑上的本地预览版，不是多用户云服务或系统沙箱。密钥本地明文存储；只读提示词不构成权限隔离。请勿公开服务、数据和日志；完全托管须理解披露的授权。

Use repository private vulnerability reporting if available, or request a private channel via the maintainer GitHub profile. Do not post exploit details/credentials publicly.
