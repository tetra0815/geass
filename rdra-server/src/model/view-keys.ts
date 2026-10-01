export const VIEW_KEYS = [
  "system-context",
  "business-flow",
  "usecase-composite",
  "information-model",
  "state-model",
] as const;
export type ViewKey = (typeof VIEW_KEYS)[number];

export const VIEW_LABELS: Record<ViewKey, string> = {
  "system-context": "システムコンテキスト",
  "business-flow": "業務フロー",
  "usecase-composite": "ユースケース複合",
  "information-model": "情報モデル",
  "state-model": "状態モデル",
};

export interface Position {
  x: number;
  y: number;
}
export type Positions = Record<string, Position>;
export type Layout = Record<ViewKey, Positions>;

export function isViewKey(value: string): value is ViewKey {
  return (VIEW_KEYS as readonly string[]).includes(value);
}

export function emptyLayout(): Layout {
  return Object.fromEntries(VIEW_KEYS.map((v) => [v, {}])) as Layout;
}
