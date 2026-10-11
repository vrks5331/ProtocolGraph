export type NodeType =
  'objective' | 'endpoint' | 'procedure' | 'visit' | 'eligibility' | 'analysis';
export type EdgeType = 'SUPPORTS' | 'MEASURED_BY' | 'SCHEDULED_AT' | 'ANALYZED_BY' | 'REQUIRES_AT';
export interface Concept {
  id: string;
  type: NodeType;
  label?: string | null;
  description?: string | null;
  page?: number | null;
  source_text?: string | null;
  confidence?: number | null;
  field?: string | null;
  value?: unknown;
  required_day?: number | null;
  day?: number | null;
  window_before_days?: number | null;
  window_after_days?: number | null;
  [key: string]: unknown;
}
export interface Relationship {
  id?: string | null;
  source: string;
  target: string;
  type: EdgeType;
  confidence?: number | null;
  required?: boolean | null;
  condition_text?: string | null;
  arm_ids?: string[] | null;
  pop_ids?: string[] | null;
  [key: string]: unknown;
}
export interface GraphPayload {
  nodes: Concept[];
  edges: Relationship[];
}
export interface Evidence {
  node_id: string;
  page?: number | null;
  quote?: string | null;
}
export interface Finding {
  id: string;
  check_id: string;
  node_id: string;
  title: string;
  tier: string;
  evidence: Evidence[];
}
export type ExtractionAction =
  | 'dropped_node'
  | 'dropped_edge'
  | 'merged_edge'
  | 'stripped_field'
  | 'corrected_page'
  | 'fuzzy_match';
export interface ExtractionIssue {
  rule: string;
  action: ExtractionAction;
  item_id: string;
  message: string;
}
export interface AnalysisResponse {
  analysis_id: string;
  filename?: string | null;
  created_at?: string | null;
  graph: GraphPayload;
  findings: Finding[];
  extraction_issues?: ExtractionIssue[];
}
export interface AnalysisSummary {
  analysis_id: string;
  filename: string;
  created_at: string;
  scenario_count?: number;
}
export type EditEntity = 'node' | 'edge';
export interface Edit {
  entity: EditEntity;
  target_id: string;
  field: string;
  before: unknown;
  after: unknown;
}
export type ScenarioStatus = 'saved' | 'analyzed';
export interface ScenarioSummary {
  scenario_id: string;
  analysis_id: string;
  name: string;
  created_at: string;
  edit_count: number;
  status: ScenarioStatus;
}
export interface ScenarioResponse {
  scenario_id: string;
  analysis_id: string;
  name: string;
  created_at: string;
  edits: Edit[];
  status: ScenarioStatus;
  graph?: GraphPayload | null;
  findings?: Finding[] | null;
  new_issues?: Finding[] | null;
  resolved_issues?: Finding[] | null;
  remaining_issues?: Finding[] | null;
  affected_nodes?: string[] | null;
}
export interface HistoryResponse {
  analyses: AnalysisSummary[];
}
export interface JargonTerm {
  term: string;
  meaning: string;
}
export interface ExplanationResponse {
  item_id: string;
  summary: string;
  terms: JargonTerm[];
}
export type Selection =
  | { kind: 'node'; id: string }
  | { kind: 'finding'; id: string }
  | { kind: 'edge'; id: string }
  | null;
