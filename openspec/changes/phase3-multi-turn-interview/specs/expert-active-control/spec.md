## ADDED Requirements

### Requirement: Finish button (够了)

The interview UI SHALL provide a 「够了」 button visible on every round of the interview. Clicking it SHALL trigger the finish flow.

#### Scenario: 够了 button visible on every round

- **WHEN** interview is in round 1, 2, 3, 4, or 5
- **THEN** 「够了」 button is visible in the interview mode header

#### Scenario: 够了 triggers finish flow

- **WHEN** expert clicks 「够了」
- **THEN** system POSTs `/api/interview/session/[id]/finish`
- **AND** session state becomes `finished`
- **AND** accumulated turns are routed to retain pipeline (Phase 4/5)

### Requirement: Abandon button (放弃)

The interview UI SHALL provide a 「放弃」 button visible on every round. Clicking it SHALL trigger the abandon flow.

#### Scenario: 放弃 button visible on every round

- **WHEN** interview is in any round
- **THEN** 「放弃」 button is visible in the interview mode header

#### Scenario: 放弃 triggers abandon flow

- **WHEN** expert clicks 「放弃」
- **THEN** system POSTs `/api/interview/session/[id]/abandon`
- **AND** session state becomes `abandoned`
- **AND** accumulated turns are discarded (not retained)

### Requirement: UI reset on abandon

After expert triggers 放弃, the system SHALL reset the UI to default chat mode (no interview mode indicator).

#### Scenario: Interview indicator removed

- **WHEN** abandon completes
- **THEN** the interview mode header banner disappears
- **AND** 「够了」/「放弃」 buttons are removed
- **AND** subsequent user messages route to main chat mode

### Requirement: UI preserves turns on finish

After expert triggers 够了, the system SHALL display the accumulated Q/A turns as a summary before transitioning to the Phase 5 review UI.

#### Scenario: Turn summary shown

- **WHEN** 够了 is triggered
- **THEN** UI displays all rounds of Q/A pairs
- **AND** expert can review before final retain (in Phase 5)

#### Scenario: Turn summary is editable

- **WHEN** expert sees the turn summary
- **THEN** expert can edit any Q/A pair before final retain (Phase 5 scope)

### Requirement: Confirmation for destructive action

The 放弃 button SHALL require an additional confirmation click to prevent accidental data loss. The 够了 button does NOT require confirmation (low risk, expert just wants to wrap up).

#### Scenario: 放弃 requires confirmation

- **WHEN** expert clicks 放弃
- **THEN** a confirmation dialog appears: "确认放弃本次访谈？所有回答都不会保留"
- **AND** expert must click 确认 in the dialog to actually abandon

#### Scenario: 够了 has no confirmation

- **WHEN** expert clicks 够了
- **THEN** system proceeds immediately without confirmation

### Requirement: Buttons available throughout interview

The 够了 and 放弃 buttons SHALL remain accessible throughout the entire interview, including during loading states (LLM call in progress) and conflict prompts.

#### Scenario: Buttons enabled during loading

- **WHEN** system is waiting for LLM response
- **THEN** 「够了」 and 「放弃」 buttons are still clickable (triggers compete with in-flight LLM call)

#### Scenario: Buttons enabled during conflict prompt

- **WHEN** expert is viewing a conflict prompt
- **THEN** 「够了」 and 「放弃」 buttons are still clickable (expert can exit without resolving conflict)
