## ADDED Requirements

### Requirement: Schema isolation

The system SHALL persist interview sessions in a dedicated Postgres schema named `chatbot_interview`, separate from the Hindsight tables. The schema SHALL be created on application startup if it does not exist.

#### Scenario: Schema auto-created

- **WHEN** application starts and `chatbot_interview` schema does not exist
- **THEN** system creates the schema and the `interview_sessions` table

#### Scenario: No Hindsight table pollution

- **WHEN** sessions are written
- **THEN** no rows appear in any Hindsight-owned table

### Requirement: Session CRUD operations

The system SHALL provide operations to create, read, update, and delete interview sessions via the `session_id` primary key.

#### Scenario: Create session

- **WHEN** POST `/api/interview/session` is called with `{bank_id, query, classification}`
- **THEN** system inserts a row with a generated UUID and returns `session_id`

#### Scenario: Read session by id

- **WHEN** GET `/api/interview/session?session_id=X` is called
- **AND** session X exists
- **THEN** system returns the full session state

#### Scenario: Read missing session returns 404

- **WHEN** GET `/api/interview/session?session_id=X` is called
- **AND** session X does not exist
- **THEN** system returns HTTP 404

#### Scenario: Update session via PATCH

- **WHEN** PATCH `/api/interview/session` is called with `{session_id, turns, round, state}`
- **THEN** system updates the corresponding row and bumps `updated_at`

### Requirement: Cross-device recovery

The system SHALL allow an expert to recover an in-progress session from any device using the `session_id` stored client-side.

#### Scenario: Refresh restores session

- **WHEN** expert refreshes the browser mid-interview
- **AND** `session_id` is in client storage
- **THEN** UI loads the existing session via GET and resumes

#### Scenario: Different device resumes same session

- **WHEN** expert opens the chatbot on a different device
- **AND** enters the same `session_id`
- **THEN** system restores the session state

### Requirement: Session state transitions

A session's `state` field SHALL transition through: `active` → `finished` (on 够了) OR `active` → `abandoned` (on 放弃). No other transitions are allowed.

#### Scenario: 够了 transitions to finished

- **WHEN** expert triggers 够了
- **THEN** session `state` becomes `finished` and turns are routed to retain

#### Scenario: 放弃 transitions to abandoned

- **WHEN** expert triggers 放弃
- **THEN** session `state` becomes `abandoned` and turns are discarded

#### Scenario: Invalid transition rejected

- **WHEN** code attempts to transition `finished` → `active`
- **THEN** system rejects the transition and logs a warning

### Requirement: TTL cleanup of abandoned sessions

The system SHALL provide a cleanup mechanism that marks sessions as eligible for deletion if they have been in `abandoned` state for more than 7 days. Cleanup SHALL be triggered by a scheduled job or manual admin command.

#### Scenario: Stale abandoned sessions purged

- **WHEN** cleanup runs and finds sessions with `state='abandoned'` and `updated_at < NOW() - INTERVAL '7 days'`
- **THEN** those rows are deleted

#### Scenario: Active sessions untouched

- **WHEN** cleanup runs
- **THEN** no `state='active'` sessions are deleted regardless of age

### Requirement: Bank isolation

Sessions SHALL be scoped by `bank_id`. Reading or updating a session MUST verify that the requesting expert's bank matches the session's bank.

#### Scenario: Cross-bank access denied

- **WHEN** expert from bank A attempts to read a session belonging to bank B
- **THEN** system returns HTTP 403
