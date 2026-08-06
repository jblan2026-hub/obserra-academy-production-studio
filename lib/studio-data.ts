export type QueueStatus = "Research" | "Generating" | "Review" | "Media" | "Approval" | "Ready";

export const expertPanel = [
  "Executive Leadership", "Board Governance", "Business Executive", "CISO",
  "Cybersecurity Architect", "Senior Security Engineer", "Secure Software Engineering",
  "Cloud Security", "Identity and Access Management", "Operational Technology / ICS",
  "Privacy", "Regulatory", "FDA", "CMMC", "PCI DSS", "Healthcare",
  "Executive Protection", "Physical Security", "Risk Management", "Internal Audit",
  "Adult Learning", "Visual Design", "Video Production", "Editorial Quality",
  "Obserrian Doctrine"
] as const;

export const productionQueue = [
  { id: "cybersecurity-foundations", title: "Cybersecurity Foundations", status: "Review" as QueueStatus, quality: 92, owner: "Cybersecurity Architect", updated: "Today" },
  { id: "board-ai-governance", title: "Board Oversight of Enterprise AI", status: "Research" as QueueStatus, quality: 78, owner: "Board Governance", updated: "Today" },
  { id: "secure-product-lifecycle", title: "Secure Product Lifecycle Leadership", status: "Generating" as QueueStatus, quality: 84, owner: "Secure Software Engineering", updated: "Today" },
  { id: "executive-protection-intelligence", title: "Executive Protection Intelligence", status: "Media" as QueueStatus, quality: 89, owner: "Executive Protection", updated: "Yesterday" },
  { id: "cmmc-executive-readiness", title: "CMMC Executive Readiness", status: "Approval" as QueueStatus, quality: 95, owner: "CMMC", updated: "Yesterday" }
];

export const sourceSystems = [
  { name: "NIST", status: "Healthy", lastCollection: "2 hours ago", impactedCourses: 3 },
  { name: "FDA", status: "Healthy", lastCollection: "5 hours ago", impactedCourses: 1 },
  { name: "CMMC", status: "Review Required", lastCollection: "1 day ago", impactedCourses: 2 },
  { name: "PCI SSC", status: "Healthy", lastCollection: "1 day ago", impactedCourses: 0 },
  { name: "OWASP", status: "Healthy", lastCollection: "2 days ago", impactedCourses: 4 }
];

export const metrics = {
  activeCourses: productionQueue.length,
  averageQuality: Math.round(productionQueue.reduce((sum, item) => sum + item.quality, 0) / productionQueue.length),
  reviewQueue: productionQueue.filter((item) => item.status === "Review" || item.status === "Approval").length,
  expertAgents: expertPanel.length,
  sourceSystems: sourceSystems.length,
  releaseReadiness: 84
};
