const MAPPINGS = Object.freeze([
  { id: "MITRE-T1110", framework: "MITRE ATT&CK", title: "Brute Force", terms: ["brute force", "password spray", "credential stuffing"] },
  { id: "MITRE-T1555", framework: "MITRE ATT&CK", title: "Credentials from Password Stores", terms: ["credential exposure", "credential theft", "token theft"] },
  { id: "MITRE-T1041", framework: "MITRE ATT&CK", title: "Exfiltration Over C2 Channel", terms: ["data exfiltration", "unexpected outbound transfer", "large unauthorized upload"] },
  { id: "MITRE-T1068", framework: "MITRE ATT&CK", title: "Exploitation for Privilege Escalation", terms: ["privilege escalation", "unauthorized owner role", "unauthorized admin role"] },
  { id: "OWASP-A01-2021", framework: "OWASP Top 10", title: "Broken Access Control", terms: ["broken access control", "authorization bypass", "unauthorized access"] },
  { id: "OWASP-A02-2021", framework: "OWASP Top 10", title: "Cryptographic Failures", terms: ["plaintext credential", "unencrypted secret", "weak encryption"] },
  { id: "OWASP-A03-2021", framework: "OWASP Top 10", title: "Injection", terms: ["injection detected", "script injection", "query injection"] },
  { id: "OWASP-A05-2021", framework: "OWASP Top 10", title: "Security Misconfiguration", terms: ["security misconfiguration", "default credential", "debug mode enabled"] },
  { id: "OWASP-A06-2021", framework: "OWASP Top 10", title: "Vulnerable and Outdated Components", terms: ["known vulnerable component", "known cve", "outdated vulnerable dependency"] },
  { id: "OWASP-A07-2021", framework: "OWASP Top 10", title: "Identification and Authentication Failures", terms: ["authentication failure", "session fixation", "credential stuffing"] },
  { id: "OWASP-A08-2021", framework: "OWASP Top 10", title: "Software and Data Integrity Failures", terms: ["unsigned artifact", "integrity failure", "hash mismatch"] },
  { id: "OWASP-A10-2021", framework: "OWASP Top 10", title: "Server-Side Request Forgery", terms: ["server side request forgery", "ssrf detected"] }
]);

function mapThreatEvidence(payload) {
  const text = JSON.stringify(payload || {}).toLowerCase();
  return MAPPINGS.filter((mapping) => mapping.terms.some((term) => text.includes(term))).map(({ terms, ...mapping }) => mapping);
}

function shouldRecommendBlock({ severity, mappings, authorized, sensitiveScope }) {
  return Boolean(sensitiveScope && !authorized && ["high", "critical"].includes(severity) && Array.isArray(mappings) && mappings.length > 0);
}

module.exports = { MAPPINGS, mapThreatEvidence, shouldRecommendBlock };
