import { PrismaClient, CourseStatus, SourceStatus } from "@prisma/client";

const prisma = new PrismaClient();
const defaultClerkOrganizationId = process.env.STUDIO_SEED_CLERK_ORG_ID ?? "org_obserra_seed";

const experts = [
  ["Executive Leadership", "Leadership"], ["Board Governance", "Governance"],
  ["Business Executive", "Business"], ["CISO", "Cybersecurity Leadership"],
  ["Cybersecurity Architect", "Cybersecurity Architecture"], ["Senior Security Engineer", "Security Engineering"],
  ["Secure Software Engineering", "Software Security"], ["Cloud Security", "Cloud"],
  ["Identity and Access Management", "Identity"], ["Operational Technology / ICS", "OT and ICS"],
  ["Privacy", "Privacy"], ["Regulatory", "Regulation"], ["FDA", "FDA"],
  ["CMMC", "CMMC"], ["PCI DSS", "PCI DSS"], ["Healthcare", "Healthcare"],
  ["Executive Protection", "Executive Protection"], ["Physical Security", "Physical Security"],
  ["Risk Management", "Risk"], ["Internal Audit", "Audit"], ["Adult Learning", "Instructional Design"],
  ["Visual Design", "Visual Production"], ["Video Production", "Video"],
  ["Editorial Quality", "Editorial"], ["Obserrian Doctrine", "Executive Stewardship"]
] as const;

const courses = [
  { slug: "cybersecurity-foundations", title: "Cybersecurity Foundations", status: CourseStatus.REVIEW, qualityScore: 92, productionOwner: "Cybersecurity Architect" },
  { slug: "board-ai-governance", title: "Board Oversight of Enterprise AI", status: CourseStatus.RESEARCH, qualityScore: 78, productionOwner: "Board Governance" },
  { slug: "secure-product-lifecycle", title: "Secure Product Lifecycle Leadership", status: CourseStatus.GENERATING, qualityScore: 84, productionOwner: "Secure Software Engineering" },
  { slug: "executive-protection-intelligence", title: "Executive Protection Intelligence", status: CourseStatus.MEDIA, qualityScore: 89, productionOwner: "Executive Protection" },
  { slug: "cmmc-executive-readiness", title: "CMMC Executive Readiness", status: CourseStatus.APPROVAL, qualityScore: 95, productionOwner: "CMMC" }
];

const sources = [
  { authority: "NIST", title: "NIST Authoritative Collection", canonicalUrl: "https://www.nist.gov/", status: SourceStatus.HEALTHY },
  { authority: "FDA", title: "FDA Cybersecurity Guidance Collection", canonicalUrl: "https://www.fda.gov/medical-devices/digital-health-center-excellence/cybersecurity", status: SourceStatus.HEALTHY },
  { authority: "CMMC", title: "CMMC Program Collection", canonicalUrl: "https://dodcio.defense.gov/CMMC/", status: SourceStatus.REVIEW_REQUIRED },
  { authority: "PCI SSC", title: "PCI Security Standards Collection", canonicalUrl: "https://www.pcisecuritystandards.org/", status: SourceStatus.HEALTHY },
  { authority: "OWASP", title: "OWASP Foundation Collection", canonicalUrl: "https://owasp.org/", status: SourceStatus.HEALTHY }
];

async function main() {
  const organization = await prisma.organization.upsert({
    where: { clerkOrganizationId: defaultClerkOrganizationId },
    update: { name: "Obserra Academy", slug: "obserra-academy", active: true },
    create: {
      clerkOrganizationId: defaultClerkOrganizationId,
      name: "Obserra Academy",
      slug: "obserra-academy",
      active: true,
    },
  });

  for (const [name, domain] of experts) {
    await prisma.expertAgent.upsert({
      where: { name },
      update: { domain, active: true },
      create: { name, domain, active: true },
    });
  }

  for (const course of courses) {
    await prisma.course.upsert({
      where: { organizationId_slug: { organizationId: organization.id, slug: course.slug } },
      update: course,
      create: {
        ...course,
        organizationId: organization.id,
        summary: `${course.title} production record managed by Obserra Academy Studio.`,
      },
    });
  }

  for (const source of sources) {
    await prisma.sourceDocument.upsert({
      where: { canonicalUrl: source.canonicalUrl },
      update: { ...source, lastCollectedAt: new Date() },
      create: { ...source, lastCollectedAt: new Date() },
    });
  }

  await prisma.auditEvent.create({
    data: {
      organizationId: organization.id,
      actorType: "SYSTEM",
      action: "DATABASE_SEEDED",
      resourceType: "STUDIO",
      outcome: "SUCCEEDED",
      metadata: { experts: experts.length, courses: courses.length, sources: sources.length },
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
