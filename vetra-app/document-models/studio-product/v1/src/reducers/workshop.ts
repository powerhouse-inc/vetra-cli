import type { StudioProductWorkshopOperations } from "document-models/studio-product/v1";
import {
  CostChangeNotFoundError,
  DuplicateQuestionIdError,
  DuplicateRowImportError,
  InvalidCostError,
  InvalidGuidedLoopTransitionError,
  InvalidLanguageError,
  InvalidQuestionError,
  InvalidUnderstoodError,
  QuestionAlreadyAnsweredError,
  QuestionChangeNotFoundError,
  QuestionNotFoundError,
  RowImportNotFoundError,
} from "../../gen/workshop/error.js";
import type {
  GuidedLoopStatus,
  StudioProductState,
} from "../../gen/schema/types.js";
import { normalizeProduct } from "../normalize.js";

/** The understanding is stored as JSON text of at most this many characters. */
const UNDERSTOOD_MAX = 200_000;
/** Languages the Studio speaks. */
const LANGUAGES = ["de", "en"];
/** A room question is short and offers at most 4 options. */
const QUESTION_TEXT_MAX = 200;
const QUESTION_OPTIONS_MAX = 4;

/**
 * The guided first loop only moves forward along this order; skipping ahead
 * is allowed, going back or repeating a status is not. DISMISSED is outside
 * the order: it is reachable from every status except DONE and DISMISSED,
 * and nothing follows it.
 */
const GUIDED_LOOP_ORDER: GuidedLoopStatus[] = [
  "NOT_STARTED",
  "POINTED",
  "CHANGED",
  "WENT_BACK",
  "DONE",
];
const GUIDED_LOOP_FINAL: GuidedLoopStatus[] = ["DONE", "DISMISSED"];

function canMoveGuidedLoop(
  from: GuidedLoopStatus,
  to: GuidedLoopStatus,
): boolean {
  if (GUIDED_LOOP_FINAL.includes(from)) return false;
  if (to === "DISMISSED") return true;
  return GUIDED_LOOP_ORDER.indexOf(to) > GUIDED_LOOP_ORDER.indexOf(from);
}

function isJsonObject(json: string): boolean {
  try {
    const parsed: unknown = JSON.parse(json);
    return (
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    );
  } catch {
    return false;
  }
}

function findChange(
  state: StudioProductState,
  changeId: string,
): StudioProductState["changes"][number] | undefined {
  normalizeProduct(state);
  return state.changes.find((c) => c.id === changeId);
}

export const studioProductWorkshopOperations: StudioProductWorkshopOperations =
  {
    setUnderstoodOperation(state, action) {
      normalizeProduct(state);
      const { json, language, at, materials } = action.input;
      if (json.length > UNDERSTOOD_MAX || !isJsonObject(json)) {
        throw new InvalidUnderstoodError(
          `The understanding is a JSON object of at most ${UNDERSTOOD_MAX} characters.`,
        );
      }
      if (!LANGUAGES.includes(language)) {
        throw new InvalidLanguageError(
          `The language is "de" or "en", not "${language}".`,
        );
      }
      state.understood = {
        json,
        language,
        at,
        materials: materials.map(({ id, name, kind }) => ({ id, name, kind })),
      };
    },

    markExplainersSeenOperation(state, action) {
      normalizeProduct(state);
      for (const id of action.input.ids) {
        if (!state.explainersSeen.includes(id)) state.explainersSeen.push(id);
      }
    },

    setGuidedLoopOperation(state, action) {
      normalizeProduct(state);
      const { status, at } = action.input;
      const from = state.guidedLoop.status;
      if (!canMoveGuidedLoop(from, status)) {
        throw new InvalidGuidedLoopTransitionError(
          `The guided loop can't go from ${from} to ${status}.`,
        );
      }
      state.guidedLoop = { status, at };
    },

    askQuestionOperation(state, action) {
      const input = action.input;
      const change = findChange(state, input.changeId);
      if (!change) {
        throw new QuestionChangeNotFoundError(
          `No change "${input.changeId}" exists.`,
        );
      }
      if (change.questions.some((q) => q.id === input.id)) {
        throw new DuplicateQuestionIdError(
          `Change "${change.id}" already has a question "${input.id}".`,
        );
      }
      const text = input.text.trim();
      const defaultAnswer = input.defaultAnswer.trim();
      if (
        !text ||
        text.length > QUESTION_TEXT_MAX ||
        input.options.length > QUESTION_OPTIONS_MAX ||
        !defaultAnswer ||
        !LANGUAGES.includes(input.language)
      ) {
        throw new InvalidQuestionError(
          `A question has 1 to ${QUESTION_TEXT_MAX} characters, at most ${QUESTION_OPTIONS_MAX} options, a default answer and the language "de" or "en".`,
        );
      }
      change.questions.push({
        id: input.id,
        text,
        options: input.options,
        defaultAnswer,
        language: input.language,
        askedAt: input.askedAt,
        answer: null,
        answeredAt: null,
        answeredBy: null,
      });
    },

    answerQuestionOperation(state, action) {
      const { changeId, id, answer, answeredBy, answeredAt } = action.input;
      const question = findChange(state, changeId)?.questions.find(
        (q) => q.id === id,
      );
      if (!question) {
        throw new QuestionNotFoundError(
          `No question "${id}" exists on change "${changeId}".`,
        );
      }
      if (question.answeredBy) {
        throw new QuestionAlreadyAnsweredError(
          `Question "${id}" was already answered.`,
        );
      }
      question.answer = answer;
      question.answeredBy = answeredBy;
      question.answeredAt = answeredAt;
    },

    setChangeCostOperation(state, action) {
      const { changeId, startUsd, endUsd } = action.input;
      const change = findChange(state, changeId);
      if (!change) {
        throw new CostChangeNotFoundError(`No change "${changeId}" exists.`);
      }
      if ((startUsd ?? 0) < 0 || (endUsd ?? 0) < 0) {
        throw new InvalidCostError("A cost is 0 or more.");
      }
      // Only the given side(s) are set; 0 is a valid cost.
      const cost = change.cost ?? { startUsd: null, endUsd: null };
      if (startUsd !== undefined && startUsd !== null) cost.startUsd = startUsd;
      if (endUsd !== undefined && endUsd !== null) cost.endUsd = endUsd;
      change.cost = cost;
    },

    startRowImportOperation(state, action) {
      normalizeProduct(state);
      const input = action.input;
      if (state.rowImports.some((r) => r.id === input.id)) {
        throw new DuplicateRowImportError(
          `A row import "${input.id}" already exists.`,
        );
      }
      state.rowImports.push({
        id: input.id,
        materialId: input.materialId,
        sheet: input.sheet,
        documentType: input.documentType,
        rows: input.rows,
        imported: 0,
        status: "CONFIRMED",
        at: input.at,
        failure: null,
      });
    },

    finishRowImportOperation(state, action) {
      normalizeProduct(state);
      const { id, imported, status, failure, at } = action.input;
      const rowImport = state.rowImports.find((r) => r.id === id);
      if (!rowImport) {
        throw new RowImportNotFoundError(`No row import "${id}" exists.`);
      }
      rowImport.imported = imported;
      rowImport.status = status;
      rowImport.failure = failure || null;
      rowImport.at = at;
    },
  };
