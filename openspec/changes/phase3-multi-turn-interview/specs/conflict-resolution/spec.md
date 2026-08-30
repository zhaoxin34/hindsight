## ADDED Requirements

### Requirement: Conflict detection

When the interview's recall results contain facts that semantically contradict the current interview context, the system SHALL surface this as a conflict for expert review. Detection SHALL use the `needs_conflict_check` flag from the Classification output plus semantic similarity analysis.

#### Scenario: Contradictory recall detected

- **WHEN** recall returns a fact "用户在 Google 工作" (from previous interview)
- **AND** current interview topic is "用户的职业经历"
- **THEN** system detects a potential conflict (assuming expert's current answer implies Google is no longer current)

#### Scenario: No conflict when recall is consistent

- **WHEN** recall returns facts that align with current interview context
- **THEN** system does NOT trigger conflict prompt

### Requirement: Expert prompt with options

When a conflict is detected, the system SHALL present the conflicting facts to the expert with two clear options: "口误" (typo/correction) and "认真" (intentional update).

#### Scenario: Conflict prompt UI

- **WHEN** conflict is detected
- **THEN** UI shows both facts side-by-side with buttons 「口误」and 「认真」

#### Scenario: Expert can dismiss without choosing

- **WHEN** expert neither clicks 口误 nor 认真 within the prompt
- **THEN** system waits (does not auto-decide)

### Requirement: Typo path preserves both

When the expert chooses 口误, the system SHALL continue the interview without modifying any persisted facts. The next retained fact SHALL be tagged with `context="correction_of_session_<original_id>"` for audit purposes.

#### Scenario: Typo continues interview

- **WHEN** expert chooses 口误
- **THEN** session continues to the next round
- **AND** no Hindsight memory is modified

#### Scenario: Typo tags audit context

- **WHEN** expert eventually finishes and facts are retained
- **THEN** retained items carry `context="correction_of_session_<id>"` metadata

### Requirement: Serious path replaces old fact

When the expert chooses 认真, the system SHALL execute a two-step atomic replacement:

1. `PATCH /v1/default/banks/{bank}/memories/{old_id}` with body `{"state": "invalidated"}`
2. Only after PATCH succeeds, `POST /v1/default/banks/{bank}/memories` to retain the new fact

#### Scenario: PATCH succeeds then POST

- **WHEN** expert chooses 认真
- **AND** PATCH returns HTTP 200
- **THEN** system proceeds to POST the new fact

#### Scenario: PATCH fails aborts replacement

- **WHEN** expert chooses 认真
- **AND** PATCH returns non-200
- **THEN** system does NOT POST the new fact
- **AND** expert sees an error message with retry option

#### Scenario: POST fails after PATCH

- **WHEN** PATCH succeeds but POST fails
- **THEN** old fact is invalidated but new fact is missing
- **AND** on next recall, the contradiction may resurface (handled by future session)

### Requirement: Post-replacement verification

After a successful replacement, the system SHALL verify that the old fact no longer appears in recall for the same query.

#### Scenario: Recall no longer returns old fact

- **WHEN** expert confirms 认真 and replacement completes
- **AND** a subsequent recall is performed with the same query
- **THEN** the invalidated old fact is not in the results

#### Scenario: Verification failure surfaces warning

- **WHEN** post-replacement recall still returns the invalidated fact
- **THEN** system logs a warning (possibly Hindsight indexing lag) and surfaces it to the expert
