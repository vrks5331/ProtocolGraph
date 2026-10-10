export type NodeType = 'objective' | 'endpoint' | 'procedure' | 'visit' | 'eligibility' | 'analysis';
export type EdgeType = 'SUPPORTS' | 'MEASURED_BY' | 'SCHEDULED_AT' | 'ANALYZED_BY' | 'REQUIRES_AT';
export interface Concept { id: string; type: NodeType; label?: string | null; description?: string | null; page?: number | null; source_text?: string | null; confidence?: number | null; field?: string | null; value?: unknown; required_day?: number | null; day?: number | null; window_before_days?: number | null; window_after_days?: number | null; [key: string]: unknown }
export interface Relationship { id?: string | null; source: string; target: string; type: EdgeType; confidence?: number | null; [key: string]: unknown }
export interface GraphPayload { nodes: Concept[]; edges: Relationship[] }
export interface Evidence { node_id: string; page?: number | null; quote?: string | null }
export interface Finding { id: string; check_id: string; node_id: string; title: string; tier: string; evidence: Evidence[] }
export interface AnalysisResponse { analysis_id: string; graph: GraphPayload; findings: Finding[] }
export interface HistoryResponse { analyses: { analysis_id: string; filename: string; created_at: string }[] }
export type DatasetId = 'baseline' | 'injected';
export type Selection = { kind: 'node'; id: string } | { kind: 'finding'; id: string } | { kind: 'edge'; index: number } | null;
export type ScheduleField = 'required_day' | 'day' | 'window_before_days' | 'window_after_days';
export interface SimulationResult { changed_node: string; affected_nodes: string[]; new_issues: Finding[]; resolved_issues: Finding[]; remaining_issues: Finding[] }
