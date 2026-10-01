import type { Stage } from "../../src/feature.js";
import type { AppState } from "./api.js";

/** The review a decision in the panel goes to: the RDRA review first, then the design review. */
export function activeStage(state: Pick<AppState, "review" | "design">): Stage | null {
  if (state.review?.status === "pending") return "rdra";
  if (state.design.review?.status === "pending") return "design";
  return null;
}
