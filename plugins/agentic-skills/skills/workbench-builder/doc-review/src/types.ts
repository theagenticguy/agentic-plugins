export type Block = { id: number; tag: string; text: string };

export type Annotation = {
  id: number;
  block_id: number;
  start: number;
  end: number;
  quote: string;
  kind: "comment" | "redline";
  body: string;
  status: "open" | "resolved" | "wontfix";
  reply: string;
  created_at: string;
};

export type Request = {
  id: number;
  kind: string;
  body: string;
  status: "queued" | "working" | "answered";
  response: string;
};
