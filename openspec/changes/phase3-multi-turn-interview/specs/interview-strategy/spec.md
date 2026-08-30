## ADDED Requirements

### Requirement: Strategy template selection

The interview agent SHALL select a prompt template based on the Complexity Classifier's `event_type` output. When `event_type` is set, the agent SHALL use the corresponding strategy; when absent, the agent SHALL default to the `fiveWhys` strategy.

#### Scenario: success event uses success template

- **WHEN** Classification returns `{event_type: 'success'}`
- **THEN** agent uses the success template (场景 → 关键转折 → 为什么那么做 → 重来怎么做)

#### Scenario: failure event uses failure template

- **WHEN** Classification returns `{event_type: 'failure'}`
- **THEN** agent uses the failure template (最早哪里出问题 → 为什么没发现 → 后来怎么看 → 反常信号)

#### Scenario: misjudgment event uses misjudgment template

- **WHEN** Classification returns `{event_type: 'misjudgment'}`
- **THEN** agent uses the misjudgment template (原本怎么判断 → 实际发生什么 → 偏差出在哪个环节 → 下次怎么调)

#### Scenario: counterintuitive event uses counterintuitive template

- **WHEN** Classification returns `{event_type: 'counterintuitive'}`
- **THEN** agent uses the counterintuitive template (别人怎么看 → 你为什么坚持 → 关键变量 → 能复制吗)

#### Scenario: missing event_type defaults to fiveWhys

- **WHEN** Classification returns no `event_type`
- **THEN** agent defaults to `fiveWhys` template (触发事件 → 观察信号 → 判断标准 → 行动方案 → 结果验证)

### Requirement: Five-element extraction

Each interview round SHALL attempt to extract the five elements (Trigger, Signal, Criterion, Action, Outcome). The agent SHALL prioritize elements not yet captured in previous rounds.

#### Scenario: First round prioritizes Trigger and Signal

- **WHEN** interview starts and no elements are captured yet
- **THEN** agent's first question targets Trigger and Signal

#### Scenario: Subsequent rounds fill gaps

- **WHEN** Trigger is captured but Criterion is missing
- **THEN** agent's next question targets Criterion

#### Scenario: All elements captured triggers finish

- **WHEN** all five elements are captured
- **THEN** agent routes to retain pipeline (or offers 够了 confirmation)

### Requirement: Boundary probing

When the expert states a rule with the form "如果 A 就 B" or equivalent, the agent SHALL follow up with a boundary-probing question to surface exceptions. The boundary probe SHALL be triggered when the agent's classification of the prior answer detects rule-form language.

#### Scenario: Rule detected triggers boundary probe

- **WHEN** expert says "客户连续 3 次改会就是假商机"
- **AND** agent classifies this as a rule statement
- **THEN** next question is a boundary probe: "有没有改会 3 次但不是假商机的情况？边界在哪？"

#### Scenario: Boundary probe captures exceptions

- **WHEN** expert answers the boundary probe
- **THEN** the exceptions are stored in the session's turns for downstream extraction

### Requirement: Round progression

The agent SHALL not ask more than 5 rounds in a single interview. After 5 rounds, the agent SHALL auto-finish the interview regardless of completeness.

#### Scenario: Fifth round reached

- **WHEN** interview is in round 5 and the expert has just answered
- **THEN** agent returns `{state: finished, items: [...]}` instead of asking another question

#### Scenario: Earlier finish allowed

- **WHEN** expert says 够了 at any round ≤ 5
- **THEN** agent finishes the interview immediately (does not force more rounds)
