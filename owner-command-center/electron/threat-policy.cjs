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

function classifyResponse({ severity, mappings = [], confidence = 0, authorized = false, sensitiveScope = false }) {
  const mapped = Array.isArray(mappings) && mappings.length > 0;
  const knownBad = mapped && ["high", "critical"].includes(severity) && Number(confidence) >= 0.85;
  if (knownBad && sensitiveScope && !authorized) {
    return { action: "block", knownBad: true, alert: true, recommend: true, ownerOverrideAllowed: true };
  }
  if (["medium", "high", "critical"].includes(severity) || mapped) {
    return { action: "recommend", knownBad: false, alert: true, recommend: true, ownerOverrideAllowed: false };
  }
  return { action: "alert", knownBad: false, alert: true, recommend: false, ownerOverrideAllowed: false };
}

function shouldRecommendBlock(input) {
  return classifyResponse({ ...input, confidence: input.confidence ?? 1 }).action === "block";
}

module.exports = { MAPPINGS, mapThreatEvidence, classifyResponse, shouldRecommendBlock };
