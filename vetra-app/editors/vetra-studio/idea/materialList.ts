/** The files on the idea screen: what is uploading, ready or failed. */
import type { MaterialCard } from "../hooks/workshop-client.js";

export type MaterialItem = {
  key: string;
  name: string;
  status: "uploading" | "ready" | "failed";
  card?: MaterialCard;
  error?: string;
};

export type MaterialsAction =
  | { type: "uploading"; key: string; name: string }
  | { type: "added"; key: string; card: MaterialCard }
  | { type: "failed"; key: string; error: string }
  | { type: "remove"; key: string };

export function materialsReducer(
  state: MaterialItem[],
  action: MaterialsAction,
): MaterialItem[] {
  switch (action.type) {
    case "uploading":
      return [
        ...state,
        { key: action.key, name: action.name, status: "uploading" },
      ];
    case "added":
      return state.map((i) =>
        i.key === action.key
          ? { key: i.key, name: i.name, status: "ready", card: action.card }
          : i,
      );
    case "failed":
      return state.map((i) =>
        i.key === action.key
          ? { key: i.key, name: i.name, status: "failed", error: action.error }
          : i,
      );
    case "remove":
      return state.filter((i) => i.key !== action.key);
  }
}

export function readyCards(items: readonly MaterialItem[]): MaterialCard[] {
  return items.flatMap((i) => (i.card ? [i.card] : []));
}
