## ADDED Requirements

### Requirement: Multi-turn interview flow

The interview agent SHALL conduct a multi-turn interview (3-5 rounds) when the Complexity Classifier determines the user's question is `decision` or `abstract` complexity, and SHALL conduct a single-turn interview when complexity is `simple`.

#### Scenario: Abstract question triggers multi-turn

- **WHEN** user asks "为什么 Python 比 Java 更适合写 ETL"
- **AND** Complexity Classifier returns `{complexity: 'abstract'}`
- **THEN** system initiates multi-turn interview (3-5 rounds)

#### Scenario: Simple question stays single-turn

- **WHEN** user asks "北京是哪个国家的首都"
- **AND** Complexity Classifier returns `{complexity: 'simple'}`
- **THEN** system uses Phase 2 single-turn flow

#### Scenario: Multi-turn round limit

- **WHEN** interview reaches 5 rounds without expert action
- **THEN** system auto-finishes the interview and routes to retain pipeline

### Requirement: Pure function state machine

The interview orchestration SHALL be implemented as a pure function `nextTurn(state, action, deps)` that returns `{state, ui}` without side effects beyond the injected `deps`. All IO (LLM, recall, persistence) SHALL go through the `deps` argument.

#### Scenario: Deterministic transitions

- **WHEN** `nextTurn` is called with the same `(state, action, deps)`
- **THEN** it returns the same `{state, ui}` every time

#### Scenario: Testable in isolation

- **WHEN** unit test mocks `deps.llm` / `deps.recall` / `deps.persist`
- **THEN** `nextTurn` can be exercised without a real LLM or database

### Requirement: UI directive emission

`nextTurn` SHALL return one of four UI directives: `ask_question`, `show_conflict`, `finished`, or `abandoned`. The frontend SHALL render each directive distinctly.

#### Scenario: ask_question directive

- **WHEN** interview needs expert's next answer
- **THEN** `ui.kind === 'ask_question'` with `question` text

#### Scenario: show_conflict directive

- **WHEN** recall conflicts with current interview context
- **THEN** `ui.kind === 'show_conflict'` with `facts` array for expert judgment

#### Scenario: finished directive

- **WHEN** interview reaches natural end (rounds exhausted or expert said 够了)
- **THEN** `ui.kind === 'finished'` with `items` ready for retain

#### Scenario: abandoned directive

- **WHEN** expert clicked 放弃
- **THEN** `ui.kind === 'abandoned'`

### Requirement: Feature flag fallback

The system SHALL respect the `ENABLE_MULTI_TURN_INTERVIEW` environment flag. When the flag is `false` or unset, the system SHALL use the Phase 2 single-turn behavior unchanged.

#### Scenario: Flag off uses single-turn

- **WHEN** `ENABLE_MULTI_TURN_INTERVIEW=false`
- **AND** user asks a complex question
- **THEN** system uses Phase 2 single-turn flow (recall → ask → answer → retain)

#### Scenario: Flag on uses multi-turn

- **WHEN** `ENABLE_MULTI_TURN_INTERVIEW=true`
- **AND** user asks a complex question
- **THEN** system uses Phase 3 multi-turn state machine

### Requirement: Session lifecycle management

The interview orchestration SHALL create a session on first entry, restore an existing session on re-entry (after refresh or close-tab), and SHALL NOT allow concurrent sessions for the same expert in the demo phase.

#### Scenario: New session on first entry

- **WHEN** expert triggers interview mode for a query that triggers multi-turn
- **THEN** system POSTs `/api/interview/session` to create a new session

#### Scenario: Session restored after refresh

- **WHEN** expert refreshes the browser mid-interview
- **AND** session exists for this expert + bank
- **THEN** system GETs `/api/interview/session?session_id=X` and resumes

#### Scenario: No concurrent sessions

- **WHEN** expert already has an active session
- **AND** expert asks a new question that would trigger a new interview
- **THEN** system resumes the existing session instead of creating a new one
