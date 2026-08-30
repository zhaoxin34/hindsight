## ADDED Requirements

### Requirement: Classifier interface contract

The system SHALL define a `ComplexityClassifier` interface with a single method `classify(input: {query, recall}): Promise<Classification>`. All implementations MUST conform to this interface.

#### Scenario: Interface defined

- **WHEN** TypeScript code imports ComplexityClassifier
- **THEN** the type is exported from `chatbot/lib/chat/classifier/types.ts`

#### Scenario: Custom implementation pluggable

- **WHEN** a new implementation (e.g., a fine-tuned classifier) is provided
- **THEN** the orchestrator can swap it via DI without changing `nextTurn`

### Requirement: Default rule-based implementation

The system SHALL provide a `RuleBasedClassifier` as the default implementation. This implementation SHALL use keyword matching, regex patterns, and heuristics to classify the query, returning a confidence score in [0, 1].

#### Scenario: Rule-based classification returns confidence

- **WHEN** RuleBasedClassifier classifies a query
- **THEN** it returns `{complexity, event_type?, needs_conflict_check, confidence, reasoning?}`

#### Scenario: High confidence on clear-cut queries

- **WHEN** query contains strong abstract-judgment keywords (e.g., "为什么", "怎么判断", "基于什么")
- **THEN** confidence ≥ 0.8 and complexity = 'abstract' or 'decision'

#### Scenario: Low confidence on ambiguous queries

- **WHEN** query is ambiguous (e.g., "你喜欢什么")
- **THEN** confidence < 0.6 to signal fallback

### Requirement: LLM fallback

The system SHALL provide a `HybridClassifier` that wraps `RuleBasedClassifier` and falls back to `LLMClassifier` when the rule-based confidence is below 0.6. The LLM-based classification MUST use the same `Classification` schema.

#### Scenario: High confidence skips LLM

- **WHEN** RuleBasedClassifier returns confidence ≥ 0.6
- **THEN** HybridClassifier returns the rule-based result without calling LLM

#### Scenario: Low confidence triggers LLM fallback

- **WHEN** RuleBasedClassifier returns confidence < 0.6
- **THEN** HybridClassifier calls LLMClassifier with the same input and returns the LLM result

#### Scenario: LLM fallback is logged

- **WHEN** HybridClassifier triggers LLM fallback
- **THEN** an entry is written to the classifier fallback log (type, query, rule confidence, llm result)

### Requirement: Output schema

The `Classification` object SHALL conform to this schema:

- `complexity`: one of `'simple' | 'decision' | 'abstract'`
- `event_type` (optional): one of `'success' | 'failure' | 'misjudgment' | 'counterintuitive' | 'fact'`
- `needs_conflict_check`: boolean
- `confidence`: number in [0, 1]
- `reasoning` (optional): human-readable explanation for debugging

#### Scenario: Validation rejects malformed output

- **WHEN** an implementation returns a Classification with invalid `complexity` value
- **THEN** Zod schema validation fails and the error is surfaced to logs

### Requirement: Heuristic rule coverage

The `RuleBasedClassifier` SHALL cover at least 80% of expected query patterns with explicit rules. Rules SHALL be unit-tested individually.

#### Scenario: Rule tested in isolation

- **WHEN** a unit test exercises a single rule with sample queries
- **THEN** the rule's expected output matches actual output

#### Scenario: Coverage metric tracked

- **WHEN** a test suite runs against a representative query corpus (≥50 queries)
- **THEN** at least 80% of queries are classified correctly without LLM fallback
