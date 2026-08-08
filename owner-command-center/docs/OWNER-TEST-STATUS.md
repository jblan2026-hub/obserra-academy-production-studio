# Owner Command Center Owner Test Status

**Status date:** 2026-08-08  
**Controlled state:** Active owner-test record  
**Applies to:** Obserra Owner AI Command Center desktop package, Academy review workflow, interactive action buttons, AI worker monitoring, AI usage visibility, web and network monitoring, and course-release controls.

## Truth rule

No dashboard card, recommendation, action button, AI monitor, course review item, device enrollment status, webpage monitor, network analysis, or release control may be represented as live unless the renderer control is connected to an Electron main-process handler, the handler returns real evidence, the action is authorization checked, the result is displayed to the owner, and the failure path is visible.

## Owner test result

Owner testing showed that the current desktop dashboard is not acceptable for operational use. The application can install, but the owner interface is not yet fully functional. Several visible dashboard buttons are presentation controls or partial controls rather than verified live actions.

Observed owner issues:

- dashboard is too long and must be organized into functional tabs and pages;
- all dashboard cards and recommendations must be interactive;
- every recommendation must expose action buttons for details, remediation, blocking, override, release, or revision where applicable;
- device enrollment is not fully usable from the installed owner experience;
- connection analysis and network analysis are not fully operational from the dashboard;
- Owner AI bot health is not visible enough;
- AI worker heartbeat/EKG monitoring is missing from the owner dashboard;
- AI usage, performance, token/credit use, and worker throughput are not visible enough;
- webpage monitoring must verify HTTPS and HTML for approved webpages;
- Academy review must show a course-by-course pending review list, not only summary counts;
- Academy review must allow the owner to inspect course materials, scripts, video evidence or video placeholders, assessments, certificates, readiness findings, and release status from one review dashboard;
- approval and release controls must remain gated, but the buttons must be real and must show the result, blocker, or next action.

## Current Academy course build state

The latest accelerated protected Academy run successfully completed AI authoring for all 61 governed course packages. The follow-up learner-catalog validation did not pass. Current evidence shows:

- 61 course manifests audited;
- 61 owner-review-eligible manifests;
- 61 governed AI course packages generated;
- protected owner-review learner catalog generated with 61 courses;
- 60 learner-content-ready courses;
- 0 publication-approved courses;
- public catalog remains 0 approved courses;
- LCMS loading was skipped because learner-catalog validation failed first;
- courses are not production released;
- purchase-to-entitlement-to-content-to-certificate is not yet verified for these packages.

The current blocking readiness findings are concentrated in `ciso-leadership-playbook`, including missing workbooks, missing video scripts, insufficient slide narrative, insufficient accessibility notes, missing lesson narrative, missing learning objectives, insufficient key concepts, missing scenario, missing exercise, insufficient knowledge checks, and insufficient final assessment. The learner catalog also reported an unsupported schema version finding.

## Required Command Center makeover

The next owner-usable Command Center build must replace the long-scroll dashboard with functional pages:

1. **Executive Overview:** enterprise status, top blockers, live recommendations, and latest action outcomes.
2. **AI Worker Heartbeat:** EKG-style worker health timeline, worker status, assigned job, last heartbeat, queue state, throughput, failures, cost, token use, and controls.
3. **AI Usage and Performance:** provider, model, token usage, credit state, latency, retries, failed calls, cost trend, and per-worker consumption.
4. **Devices and Endpoint Enrollment:** enroll, revoke, heartbeat, local health, installed version, encryption, bootstrap, and readiness blockers.
5. **Web and Network Monitoring:** approved HTTPS/HTML webpage monitor, TLS, DNS, HTTP status, content type, route scan, approved service connectivity, and local network evidence.
6. **Recommendations and Remediation:** live recommendations with buttons for Details, Remediate, Block, Override, Acknowledge, Create Task, and View Evidence.
7. **Academy Review:** searchable course queue with one row/card per course, material inventory, video/script viewer, workbook viewer, assessment viewer, certificate preview, readiness findings, AI revise, approve, return for revision, reject, and release-prep controls.
8. **Academy Release Gate:** portfolio-level approval status, current blockers, owner decision, publication lock, checkout lock, and production release evidence.
9. **Connections and Recovery:** connector authorization, credentials, recovery bundle, and fail-safe states.

## Button-live requirement

Every visible button must map to one of these states:

- **Live:** a verified handler exists and the action executed;
- **Blocked:** the handler exists but a required gate blocks execution;
- **Unavailable:** the handler is missing or the connector is not configured;
- **Read-only:** the action intentionally displays details without mutation;
- **Owner approval required:** action is staged but requires explicit confirmation.

No silent button, fake button, empty click handler, or visual-only action is acceptable.

## Production boundary

The desktop package is not the live `owner.obserrallc.com` cloud Command Center. The cloud owner site, EIOS backend, live worker registry, production database, provider provisioners, device enrollment service, authenticated worker heartbeats, AI usage ledger, and owner release execution remain separate production gates.
