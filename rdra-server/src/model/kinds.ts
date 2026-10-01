import { z } from "zod";

export const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const slugPattern = new RegExp(`^${SLUG}$`);

export const KIND_KEYS = [
  "actors",
  "externalSystems",
  "bucs",
  "usecases",
  "screens",
  "events",
  "information",
  "states",
  "principles",
  "components",
  "tables",
  "decisions",
] as const;
export type KindKey = (typeof KIND_KEYS)[number];
export type Layer = "rdra" | "design";

function idSchema(prefix: string) {
  return z.string().regex(new RegExp(`^${prefix}\\.${SLUG}$`), `id は ${prefix}.<スラッグ> の形式にしてください`);
}

function common(prefix: string) {
  return { id: idSchema(prefix), name: z.string().min(1), description: z.string().optional() };
}

const idList = () => z.array(z.string()).default(() => []);

export const AccessSchema = z.enum(["create", "read", "update", "delete"]);

export const AcceptanceSchema = z.strictObject({
  id: z.string().regex(slugPattern, "受け入れ条件の id はスラッグ（英小文字・数字・ハイフン）にしてください"),
  given: z.string().optional(),
  when: z.string(),
  then: z.string(),
});
export type Acceptance = z.output<typeof AcceptanceSchema>;

export function acceptanceRef(usecaseId: string, acId: string): string {
  return `${usecaseId}#${acId}`;
}

export const ActorSchema = z.strictObject({ ...common("act") });
export const ExternalSystemSchema = z.strictObject({ ...common("ext") });
export const ScreenSchema = z.strictObject({ ...common("scr") });
export const BucSchema = z.strictObject({
  ...common("buc"),
  business: z.string().optional(),
  actors: idList(),
  usecases: idList(),
});
export const UsecaseSchema = z.strictObject({
  ...common("uc"),
  actors: idList(),
  screens: idList(),
  events: idList(),
  information: z.array(z.strictObject({ ref: z.string(), access: AccessSchema })).default(() => []),
  transitions: idList(),
  acceptance: z.array(AcceptanceSchema).default(() => []),
});
export const EventSchema = z.strictObject({
  ...common("evt"),
  source: z.string().nullish(),
  target: z.string().nullish(),
});
export const InformationSchema = z.strictObject({
  ...common("inf"),
  attributes: z.array(z.string()).default(() => []),
  related: z.array(z.strictObject({ ref: z.string(), label: z.string().optional() })).default(() => []),
});
export const StateModelSchema = z.strictObject({
  ...common("st"),
  information: z.string().nullish(),
  states: z
    .array(z.strictObject({ id: z.string().regex(slugPattern, "状態の id はスラッグ（英小文字・数字・ハイフン）にしてください"), name: z.string().min(1) }))
    .default(() => []),
  transitions: z.array(z.strictObject({ from: z.string(), to: z.string() })).default(() => []),
});

export const PRINCIPLE_CATEGORIES = ["business", "quality", "security", "engineering", "technology"] as const;
export const PrincipleCategorySchema = z.enum(PRINCIPLE_CATEGORIES);
export const PrincipleLevelSchema = z.enum(["must", "should"]);
export const PrincipleSchema = z.strictObject({
  ...common("pr"),
  category: PrincipleCategorySchema,
  level: PrincipleLevelSchema,
  scope: idList(),
});

const labelledRefs = () => z.array(z.strictObject({ ref: z.string(), label: z.string().optional() })).default(() => []);

export const COMPONENT_TYPES = ["app", "worker", "datastore", "queue", "external"] as const;
export const ComponentSchema = z.strictObject({
  ...common("comp"),
  type: z.enum(COMPONENT_TYPES),
  tech: z.string().optional(),
  dependsOn: labelledRefs(),
  realizes: idList(),
  holds: idList(),
  doc: z.string().optional(),
});
export const TableSchema = z.strictObject({
  ...common("tbl"),
  store: z.string({ error: "store（置き場所の comp.*）が必要です" }),
  realizes: z.array(z.string()).min(1, "realizes には実現する情報（inf.*）を 1 つ以上指定してください"),
  states: idList(),
  key: z.string().optional(),
  related: labelledRefs(),
  doc: z.string().optional(),
});
export const DECISION_STATUSES = ["proposed", "accepted", "superseded"] as const;
export const DecisionSchema = z.strictObject({
  ...common("adr"),
  status: z.enum(DECISION_STATUSES),
  context: z.string().min(1, "context（背景）が必要です"),
  decision: z.string().min(1, "decision（決定内容）が必要です"),
  alternatives: z.array(z.string()).default(() => []),
  affects: idList(),
  basis: idList(),
  supersededBy: z.string().nullish(),
});

export type Actor = z.output<typeof ActorSchema>;
export type ExternalSystem = z.output<typeof ExternalSystemSchema>;
export type Screen = z.output<typeof ScreenSchema>;
export type Buc = z.output<typeof BucSchema>;
export type Usecase = z.output<typeof UsecaseSchema>;
export type RdraEvent = z.output<typeof EventSchema>;
export type Information = z.output<typeof InformationSchema>;
export type StateModel = z.output<typeof StateModelSchema>;
export type Principle = z.output<typeof PrincipleSchema>;
export type Component = z.output<typeof ComponentSchema>;
export type Table = z.output<typeof TableSchema>;
export type Decision = z.output<typeof DecisionSchema>;

export interface Model {
  actors: Actor[];
  externalSystems: ExternalSystem[];
  bucs: Buc[];
  usecases: Usecase[];
  screens: Screen[];
  events: RdraEvent[];
  information: Information[];
  states: StateModel[];
  principles: Principle[];
  components: Component[];
  tables: Table[];
  decisions: Decision[];
}
export type AnyElement = Model[KindKey][number];

export interface KindDef {
  key: KindKey;
  layer: Layer;
  prefix: string;
  file: string;
  table: string;
  label: string;
  schema: z.ZodType;
}

export const KINDS: readonly KindDef[] = [
  { key: "actors", layer: "rdra", prefix: "act", file: "actors.yaml", table: "actors", label: "アクター", schema: ActorSchema },
  { key: "externalSystems", layer: "rdra", prefix: "ext", file: "external-systems.yaml", table: "external_systems", label: "外部システム", schema: ExternalSystemSchema },
  { key: "bucs", layer: "rdra", prefix: "buc", file: "bucs.yaml", table: "bucs", label: "BUC", schema: BucSchema },
  { key: "usecases", layer: "rdra", prefix: "uc", file: "usecases.yaml", table: "usecases", label: "ユースケース", schema: UsecaseSchema },
  { key: "screens", layer: "rdra", prefix: "scr", file: "screens.yaml", table: "screens", label: "画面", schema: ScreenSchema },
  { key: "events", layer: "rdra", prefix: "evt", file: "events.yaml", table: "events", label: "イベント", schema: EventSchema },
  { key: "information", layer: "rdra", prefix: "inf", file: "information.yaml", table: "information", label: "情報", schema: InformationSchema },
  { key: "states", layer: "rdra", prefix: "st", file: "states.yaml", table: "state_models", label: "状態モデル", schema: StateModelSchema },
  { key: "principles", layer: "rdra", prefix: "pr", file: "principles.yaml", table: "principles", label: "原則", schema: PrincipleSchema },
  { key: "components", layer: "design", prefix: "comp", file: "components.yaml", table: "components", label: "コンポーネント", schema: ComponentSchema },
  { key: "tables", layer: "design", prefix: "tbl", file: "tables.yaml", table: "tables", label: "テーブル", schema: TableSchema },
  { key: "decisions", layer: "design", prefix: "adr", file: "decisions.yaml", table: "decisions", label: "設計判断", schema: DecisionSchema },
];

export function kindDef(key: KindKey): KindDef {
  const def = KINDS.find((k) => k.key === key);
  if (!def) throw new Error(`unknown kind: ${key}`);
  return def;
}

export function kindOfId(id: string): KindDef | undefined {
  const prefix = id.split(/[.:]/, 1)[0];
  return KINDS.find((k) => k.prefix === prefix);
}

export function emptyModel(): Model {
  return {
    actors: [],
    externalSystems: [],
    bucs: [],
    usecases: [],
    screens: [],
    events: [],
    information: [],
    states: [],
    principles: [],
    components: [],
    tables: [],
    decisions: [],
  };
}

export function findElement(
  model: Model,
  id: string,
): { kind: KindDef; element: AnyElement; index: number } | undefined {
  const kind = kindOfId(id);
  if (!kind) return undefined;
  const list = model[kind.key] as AnyElement[];
  const index = list.findIndex((e) => e.id === id);
  return index >= 0 ? { kind, element: list[index], index } : undefined;
}
