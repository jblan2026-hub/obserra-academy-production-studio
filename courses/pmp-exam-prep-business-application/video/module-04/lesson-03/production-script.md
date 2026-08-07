# Lesson 16 Production Script

## Estimation, Dependencies, Resources, Assumptions, and Data-Driven Decisions

**Course:** PMP® Exam Preparation and Business Application  
**Module:** 04, Process Domain I: Tailoring, Integration, Scope, and Value  
**Planned learner time:** 65 minutes  
**Target video runtime:** 34 to 37 minutes  
**Interactive work:** 21 to 24 minutes  
**Knowledge check and tutor handoff:** 8 to 10 minutes  
**Status:** Internal production draft  
**Classification:** OBSERRA PROPRIETARY INFORMATION. NOT FOR DISTRIBUTION.

## Opening ownership and independence slate, 00:00 to 00:09

**VISUAL**

The official gold Obserra mark appears above a project forecast. One date becomes a probability distribution. One cost becomes a range. Hidden dependencies illuminate across suppliers, approvals, resources, data, and technology.

**ON SCREEN TAGS**

PROPERTY OF OBSERRA  
AI NATIVE COURSE  
INTERNAL REVIEW  
PAID ACCESS CONTENT

**ON SCREEN DISCLAIMER**

Independent educational course. Not official PMI courseware. Estimates are evidence-based forecasts, not guarantees. Organizations must use appropriate professional, contractual, regulatory, engineering, financial, and statistical methods for their context.

**AUDIO**

A single metronome represents one deterministic estimate. Additional rhythmic variation introduces uncertainty and dependency. The final score resolves into a controlled forecast range. Final audio must pass the Academy media gate.

## Scene 1. Cold open: the date chosen in a meeting, 00:09 to 02:35

**VISUAL**

A sponsor asks when a global data migration will finish.

The project manager looks around the room.

Engineering says eight months.  
The vendor says six months.  
Operations says no more than nine.  
Finance budgeted seven.  
The sponsor announces:

> We will commit to seven months.

The timeline appears as a single line. Then hidden evidence enters:

1. Data quality is unknown.
2. Two regulatory approvals have variable duration.
3. One specialist supports three projects.
4. Supplier delivery has a four-week range.
5. Testing depends on environments not yet available.
6. The legacy freeze window occurs only twice each year.

**NARRATOR**

The date is precise. The evidence is not.

A credible estimate is built from scope, work, data, resources, dependencies, assumptions, uncertainty, and risk. It communicates a range and confidence appropriate to the decision.

**TITLE CARD**

Estimation, Dependencies, Resources, Assumptions, and Data-Driven Decisions

## Scene 2. Mission objective, 02:35 to 03:20

**NARRATOR**

By the end of this lesson, you will be able to select and combine estimating methods, expose assumptions, map dependencies, analyze resource constraints, use ranges and confidence, calculate three-point estimates, interpret critical path and float, update forecasts with actual data, and answer PMP scenarios involving estimates, uncertainty, dependencies, and management pressure.

**ON SCREEN OBJECTIVES**

1. Match estimating method to available evidence.
2. Build estimates from work, data, resources, and dependencies.
3. Communicate ranges, assumptions, confidence, and limitations.
4. Calculate and interpret three-point estimates.
5. Analyze critical path and resource constraints.
6. Update estimates as actual performance changes the evidence.

**SOURCE FRAME**

PMI ECO 2026  
ISO 21502 2020  
GAO SCHEDULE GUIDE 2015  
GAO COST GUIDE 2020  
GAO NASA MAJOR PROJECTS 2025

Verification date: 7 August 2026.

## Scene 3. Estimation is a decision process, 03:20 to 06:25

**VISUAL**

An estimate record appears with nine components.

1. Estimate subject and scope.
2. Method.
3. Data and source.
4. Assumptions.
5. Dependencies.
6. Resource basis.
7. Risk and uncertainty.
8. Range, confidence, and date.
9. Owner, review, and approval.

**NARRATOR**

A number without its basis is not a decision-quality estimate.

The project manager should clarify:

1. What is being estimated?
2. At what level of detail?
3. For which decision?
4. Using which information?
5. Under which assumptions?
6. With which confidence?
7. What would change the result?

**ON SCREEN PRINCIPLE**

> Precision should not exceed the evidence.

## Scene 4. Estimating methods and when they fit, 06:25 to 10:35

**VISUAL**

Six estimating methods appear.

### Expert judgment

Uses qualified experience. Stronger when assumptions, evidence, and bias controls are explicit.

### Analogous estimating

Uses a comparable prior project or component. Fast, but sensitive to similarity and normalization.

### Parametric estimating

Uses a measured relationship, such as cost per unit, effort per transaction, or duration per installation. Requires reliable data and a valid relationship.

### Bottom-up estimating

Estimates detailed work and aggregates it. Can be more traceable but requires sufficient definition and may create false confidence if dependencies or uncertainty are omitted.

### Three-point estimating

Uses optimistic, most likely, and pessimistic scenarios to represent uncertainty.

### Empirical adaptive forecasting

Uses observed throughput, cycle time, velocity, capacity, or flow history to forecast near-term delivery. Requires stable definitions and enough relevant data.

**NARRATOR**

Methods can be combined. A project may use analogous estimates early, bottom-up estimates for defined work, parametric estimates for repeatable units, three-point ranges for uncertainty, and empirical forecasting during execution.

## Scene 5. Three-point estimates and ranges, 10:35 to 14:30

**VISUAL**

Three values appear for an integration activity:

Optimistic: 8 days.  
Most likely: 14 days.  
Pessimistic: 26 days.

### Triangular average

> Expected duration = optimistic + most likely + pessimistic, divided by 3.

Calculation:

> 8 + 14 + 26 = 48.  
> 48 divided by 3 = 16 days.

### Beta or PERT-style weighted average

> Expected duration = optimistic + 4 times most likely + pessimistic, divided by 6.

Calculation:

> 8 + 56 + 26 = 90.  
> 90 divided by 6 = 15 days.

### Approximate standard deviation for the beta model

> Pessimistic minus optimistic, divided by 6.

Calculation:

> 26 minus 8 = 18.  
> 18 divided by 6 = 3 days.

**NARRATOR**

The formulas summarize assumptions. They do not prove that duration is normally distributed or that the selected values are accurate.

The project manager should understand why the optimistic and pessimistic cases differ. The range may reflect resource availability, supplier performance, data quality, rework, approval time, or technical uncertainty.

**LIMITATION CARD**

A weighted estimate is only as credible as the scenarios, data, and assumptions behind it.

## Scene 6. Dependencies and network logic, 14:30 to 18:40

**VISUAL**

A project network forms.

### Finish-to-start

The successor begins after the predecessor finishes.

### Start-to-start

The successor begins after the predecessor starts, subject to defined conditions.

### Finish-to-finish

The successor finishes after the predecessor finishes.

### Start-to-finish

A less common relationship in which a successor cannot finish until a predecessor starts.

**NARRATOR**

Dependencies may be:

1. Mandatory due to physical, technical, legal, or logical sequence.
2. Discretionary based on preferred practice.
3. External and controlled by another organization or event.
4. Internal and controlled within the project or organization.

Leads and lags should represent real work or waiting conditions. They should not hide unmodeled activities.

**ORIGINAL EXAMPLE**

A regulatory review cannot begin until a controlled evidence package is complete. If the team uses a thirty-day lag instead of modeling review preparation, submission, questions, and response, the schedule hides ownership and risk.

## Scene 7. Critical path and total float, 18:40 to 22:25

**VISUAL**

A small network appears.

Path A:

Design 5 days.  
Build 8 days.  
Test 6 days.  
Total 19 days.

Path B:

Contract 4 days.  
Supplier setup 7 days.  
Integration 5 days.  
Total 16 days.

**NARRATOR**

The longest-duration path through the current logical network is the critical path. In this simplified example, Path A is critical at 19 days.

If the project completion target is 19 days, Path B has approximately 3 days of total float, assuming no other constraints.

**ON SCREEN FORMULA**

> Total float = late start minus early start, or late finish minus early finish.

**NARRATOR**

Critical path can change as work, durations, logic, constraints, and actual performance change.

A critical activity is not necessarily the most important activity in every sense. A noncritical activity may carry major safety, quality, regulatory, cost, or strategic risk.

**EXAM TRAP**

Do not assume that adding resources to a critical activity automatically shortens the project. The activity may not be resource divisible, another path may become critical, or new coordination and risk may offset the gain.

## Scene 8. Resource constraints and leveling, 22:25 to 25:20

**VISUAL**

One cybersecurity specialist is assigned to three simultaneous activities. The unconstrained schedule shows all three occurring at once.

**NARRATOR**

A schedule without resource feasibility is not executable.

### Resource leveling

Adjusts dates or sequence to resolve over-allocation, potentially changing the critical path and completion date.

### Resource smoothing

Adjusts work within available float without changing the critical path or required completion date, when possible.

**ORIGINAL EXAMPLE**

Three validation activities require the same specialist. Two have float. One is critical. Smoothing may move the noncritical work within float. If no float is sufficient, leveling may extend the schedule or require a resource, scope, sequencing, or risk decision.

**NARRATOR**

The project manager should not silently assume overtime or impossible multitasking. Resource assumptions should be visible in schedule, cost, quality, and risk evidence.

## Scene 9. Data quality, bias, and estimate governance, 25:20 to 28:10

**VISUAL**

An estimate is challenged by five biases.

1. Optimism bias.
2. Anchoring on an early target.
3. Strategic understatement to secure approval.
4. Availability bias from one recent project.
5. Survivorship bias from successful comparisons.

**NARRATOR**

Estimate governance should include:

1. Independent review proportionate to consequence.
2. Historical data normalization.
3. Assumption and source documentation.
4. Risk and uncertainty analysis.
5. Reconciliation with scope, schedule, cost, resources, and procurement.
6. Approval and change authority.
7. Periodic update against actual performance.

**PMI ETHICS CONNECTION**

Honesty means not presenting a target as an estimate. Responsibility means communicating uncertainty and updating forecasts. Fairness means applying consistent assumptions. Respect means listening to specialist evidence even when the result is inconvenient.

## Scene 10. Documented public evidence: portfolio overruns and forecast discipline, 28:10 to 30:45

**SOURCE CARD**

U.S. Government Accountability Office  
NASA: Assessments of Major Projects  
GAO 25 107591  
Published 1 July 2025  
Source ID: GAO NASA MAJOR PROJECTS 2025

**NARRATOR**

GAO reported that four of 18 assessed NASA major projects had cost overruns and three had schedule delays in the assessed year. GAO also reported that a small number of historical projects accounted for a large share of total overruns.

The evidence reinforces the importance of current estimates, risk concentration, independent review, and visibility into the assumptions that drive portfolio forecasts.

**LIMITATIONS CARD**

The report does not prove that any one estimating method would have prevented overruns. Complex technical programs can face discovery, integration, acquisition, funding, workforce, and external uncertainty.

## Scene 11. Original enterprise scenario: Atlas Data Migration, 30:45 to 34:05

**LABEL**

Obserra original synthetic scenario. Not a documented public case.

**SCENARIO**

Atlas is migrating 240 million customer records.

1. A prior migration processed 12 million records per week.
2. The new source data has unknown defect rates.
3. The vendor promises 20 million records per week.
4. The test environment will be available only 60 percent of each week.
5. One data architect supports three workstreams.
6. Regulatory approval duration ranges from two to eight weeks.
7. The sponsor requires a single finish date.

**QUESTION**

What should the project manager do next?

**OPTIONS**

A. Commit to the vendor's highest throughput.  
B. Average the sponsor's target and vendor promise.  
C. Build a range using relevant historical and test data, model environment and resource constraints, map approval dependencies, document assumptions, and communicate confidence and decision options.  
D. Refuse to estimate until all uncertainty is gone.

**NARRATOR**

Option C is strongest. The project needs an evidence-based range and a plan to reduce uncertainty.

**WORKED APPROACH**

1. Normalize the prior throughput for data complexity.
2. Test vendor throughput under representative conditions.
3. Adjust for environment availability.
4. Model architect capacity and dependency sequence.
5. Use three-point approval duration.
6. Run schedule scenarios.
7. Present a range, confidence, risk drivers, and options.
8. Update after pilot performance.

**FOLLOW UP**

A pilot shows 14 million records per week at expected quality. The project updates the forecast rather than preserving the original target.

## Scene 12. Common PMP estimating traps, 34:05 to 36:00

### Trap 1. Commit to one date before analysis

Build the estimate and communicate uncertainty first.

### Trap 2. Use the most senior expert's number without evidence

Capture basis, assumptions, data, and independent challenge.

### Trap 3. Add all pessimistic estimates together

Model dependencies and correlated uncertainty rather than assuming every worst case occurs simultaneously.

### Trap 4. Ignore resource feasibility

Reconcile schedule with actual resource availability and skills.

### Trap 5. Protect the original estimate after actual data changes

Update the forecast and use governance for commitments.

### Trap 6. Confuse target, estimate, and commitment

A target is desired. An estimate forecasts. A commitment is authorized.

## Knowledge check package

### Question 1

An activity has optimistic, most likely, and pessimistic durations of 8, 14, and 26 days. What is the beta weighted expected duration?

A. 14 days.  
B. 15 days.  
C. 16 days.  
D. 18 days.

**Correct response:** B.

### Question 2

A resource is assigned to three simultaneous activities and no replacement is available. What should the project manager do?

A. Assume overtime.  
B. Analyze resource smoothing or leveling and the resulting schedule, cost, quality, and risk effects.  
C. Remove the resource from the plan.  
D. Keep the schedule unchanged.

**Correct response:** B.

### Question 3

Which path is critical in the simplified network: a 19-day path and a 16-day path?

A. The 16-day path.  
B. The 19-day path.  
C. Both always have zero float.  
D. Neither can be critical.

**Correct response:** B.

### Question 4

Actual pilot throughput is lower than the approved estimate. What should the project manager do?

A. Preserve the original forecast.  
B. Update the forecast with actual evidence, analyze impact and options, and use governance for any commitment change.  
C. Hide the result until closure.  
D. Change the actual data.

**Correct response:** B.

## Obserrian PMP Coach handoff

**STARTER PROMPTS**

1. Build a three-point estimate and explain the assumptions.
2. Help me map dependencies and identify the critical path.
3. Challenge the data quality and bias in this estimate.
4. Create an original PMP scenario involving resource leveling.
5. Distinguish target, estimate, forecast, baseline, and commitment.
6. Help me communicate an uncertainty range to an executive sponsor.

**TUTOR REQUIREMENTS**

1. Cite approved course sources.
2. Show calculations step by step.
3. State assumptions, range, confidence, and limitations.
4. Do not invent historical data or guarantee estimates.
5. Ask whether resources, dependencies, regulation, contracts, and quality are represented.
6. Do not reveal protected assessment answers during an active attempt.

## Closing summary, 36:00 to 37:10

**NARRATOR**

Estimates are evidence-based forecasts. Build them from defined work, relevant data, resources, dependencies, assumptions, and uncertainty. Select methods appropriate to the evidence. Use ranges and confidence. Maintain network logic and resource feasibility. Update forecasts when actual performance changes what is known.

On the PMP exam, resist arbitrary precision and management pressure. Clarify the estimate, analyze uncertainty, identify dependencies and authority, communicate the evidence, and update responsibly.

**ON SCREEN**

> Estimate from evidence. Model the dependencies. Communicate uncertainty. Update with reality.

## Required source cards

1. **PMI ECO 2026** for estimating, planning, schedule, resources, and data-driven decisions.
2. **ISO 21502 2020** for project planning and tailored estimation, paraphrased within copyright boundaries.
3. **GAO SCHEDULE GUIDE 2015** for network logic, critical path, schedule risk, and update practices.
4. **GAO COST GUIDE 2020** for reliable estimate methodology, risk, uncertainty, documentation, and update.
5. **GAO NASA MAJOR PROJECTS 2025** for documented cost and schedule performance context.

## Production asset list

1. Original Obserra arbitrary-date cold open.
2. Nine-component estimate record.
3. Six estimating-method visual system.
4. Three-point calculation animation.
5. Dependency-type and network model.
6. Critical-path and float calculation.
7. Resource smoothing and leveling example.
8. Estimate bias and governance model.
9. NASA portfolio evidence card.
10. Atlas Data Migration scenario.
11. Obserrian PMP Coach handoff.
12. Official Obserra proprietary, AI native, paid access, and internal review labels.

## Accessibility and media requirements

1. Final audio at 48 kHz and Academy compliant loudness.
2. Accurate captions and downloadable transcript.
3. Audio description for formulas, networks, ranges, and resource visuals.
4. Text alternatives for every calculation and diagram.
5. Keyboard-operable calculation exercises.
6. Reduced-motion alternative.
7. No color-only communication of critical path or resource conflict.
8. Screen-reader-friendly equations and worked examples.

## Final production review checklist

1. Every fact and formula maps to an approved source or is labeled original instruction.
2. Calculations are independently verified.
3. PMI and ISO content remains paraphrased within copyright boundaries.
4. GAO facts are reverified before mastering.
5. The Atlas scenario is clearly labeled synthetic.
6. Formula outputs are not presented as guaranteed outcomes.
7. Audio, captions, transcript, audio description, and reduced motion assets pass.
8. All media, voice, music, image, and graphic rights are documented.
9. Official Obserra branding and proprietary labels are correct.
10. PMP SME, schedule, cost, technical, legal, accessibility, media, AI, and owner reviews are approved.
