export type Identity = {
  subject_id: string;
  display_name: string;
  department: string;
  role: "employee" | "hr_admin";
};

export type Session = { token: string; expires_at: number; identity: Identity };

export type StageEvent = {
  type: "stage";
  node: string;
  status: "start" | "done";
  label: string;
  ms?: number;
  detail?: string | null;
};

export type CandidateRow = {
  chunk_id: string;
  document_id: string;
  document_title: string;
  section: string;
  dense_rank: number | null;
  dense_score: number | null;
  bm25_rank: number | null;
  bm25_score: number | null;
  rrf_rank: number | null;
  rrf_score: number | null;
  rerank_score: number | null;
  final_rank: number | null;
};

export type RetrievalEvent = {
  type: "retrieval";
  stage: "first_stage" | "rerank";
  query?: string;
  timings: Record<string, number>;
  dense_hits?: number;
  bm25_hits?: number;
  fused?: number;
  candidates: CandidateRow[];
};

export type ToolEvent = { type: "tool"; tool: string; status: string; duration_ms: number; fields_returned: string[] };

export type Citation = {
  n: number;
  chunk_id: string;
  document_id: string;
  document_title: string;
  section: string;
  section_number: string;
  version: string;
  effective_date: string;
  source_file: string;
  excerpt: string;
  rerank_score: number;
  related_only?: boolean;
};

export type FinalPayload = {
  request_id: string;
  status: "answered" | "partial" | "not_in_documents" | "personal_data" | "abstained" | "refused" | "out_of_scope" | "denied" | "info" | "invalid";
  intent: string | null;
  route: string;
  classifier: string | null;
  answer: string;
  citations: Citation[];
  personal_data: { balances: Record<string, number>; unit: string; as_of: string | null; source: string } | null;
  tool_calls: { tool: string; status: string; duration_ms: number; fields_returned: string[] }[];
  escalation: { team: string; reason: string; ticket_created: boolean } | null;
  notices: string[];
  security: { blocked: boolean; category: string | null; flags: { category: string; rule: string; blocking: boolean }[]; output_flags: string[] };
  retrieval_query: string | null;
  timings: Record<string, number>;
};

export type Trace = {
  stages: StageEvent[];
  firstStage?: RetrievalEvent;
  rerank?: RetrievalEvent;
  tools: ToolEvent[];
};

export type ChatMessage =
  | { id: string; role: "user"; content: string; at: number }
  | { id: string; role: "assistant"; at: number; pending: boolean; final?: FinalPayload; error?: string; trace: Trace };

export type DocSummary = {
  document_id: string;
  title: string;
  owner: string;
  version: string;
  effective_date: string;
  status: string;
  sections: { number: string; title: string }[];
};

export type DocFull = Omit<DocSummary, "sections"> & { sections: { number: string; title: string; body: string }[] };
